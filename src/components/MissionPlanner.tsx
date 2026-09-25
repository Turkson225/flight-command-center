import { useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'firebase/database';
import type { AircraftTelemetry, TelemetrySource } from '../core/telemetry';
import {
  createMission,
  createWaypoint,
  missionMetrics,
  missionProgress,
  parseMissionJson,
  sealMission,
  simulateMissionAt,
  telemetryHome,
  updateMission,
  validateMission,
  type MissionAction,
  type MissionDocument,
  type MissionPosition,
  type MissionWaypoint,
} from '../core/missionPlanner';
import {
  deleteMission,
  saveMission,
  stageMission,
  subscribeMissionLibrary,
  subscribeMissionTransfer,
  type MissionAcknowledgement,
  type MissionCloudStatus,
  type MissionTransferState,
} from '../core/firebaseMissions';
import { MissionPlannerMap } from './MissionPlannerMap';
import './mission-planner.css';

type Theme = 'midnight' | 'monochrome' | 'blackwhite' | 'military';

const EMPTY_TRANSFER: MissionTransferState = { requestId: null, requestedAt: null, missionId: null, revision: null, checksum: null, nodeMcu: null, nano: null };

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positionFromTelemetry(snapshot: AircraftTelemetry | null): MissionPosition | null {
  return snapshot?.navigation.gpsFix && finite(snapshot.navigation.latitude) && finite(snapshot.navigation.longitude)
    ? { latitude: snapshot.navigation.latitude, longitude: snapshot.navigation.longitude }
    : null;
}

function distance(value: number | null | undefined) {
  if (!finite(value)) return '—';
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(2)} km`;
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainder}s`;
}

function downloadMission(mission: MissionDocument) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(mission, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${mission.id}-r${mission.revision}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ackLabel(ack: MissionAcknowledgement | null, expected: Pick<MissionTransferState, 'missionId' | 'revision' | 'checksum'>) {
  if (!ack) return { state: 'waiting', label: 'WAITING', detail: 'No acknowledgement received.' };
  const matches = ack.missionId === expected.missionId && ack.revision === expected.revision && ack.checksum === expected.checksum;
  if (!matches) return { state: 'warning', label: 'MISMATCH', detail: 'Acknowledgement is for another mission revision.' };
  if (ack.status === 'rejected') return { state: 'warning', label: 'REJECTED', detail: ack.detail || 'Device rejected the mission.' };
  return { state: 'ready', label: ack.status.toUpperCase(), detail: ack.detail || `Acknowledged ${new Date(ack.acknowledgedAt).toLocaleTimeString()}.` };
}

function NumericInput({ value, onChange, step = 1, min, max, label }: { value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; label: string }) {
  return <input aria-label={label} type="number" value={value} step={step} min={min} max={max} onChange={event => onChange(event.currentTarget.valueAsNumber)} />;
}

function WaypointEditor({ waypoint, index, total, home, selected, onSelect, onChange, onDelete, onMove, onDrop, onDragStart }: {
  waypoint: MissionWaypoint;
  index: number;
  total: number;
  home: MissionPosition;
  selected: boolean;
  onSelect: () => void;
  onChange: (waypoint: MissionWaypoint) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onDrop: () => void;
  onDragStart: () => void;
}) {
  function field(key: keyof MissionWaypoint, value: number) { onChange({ ...waypoint, [key]: Number.isFinite(value) ? value : 0 }); }
  function action(value: MissionAction) {
    onChange(value === 'return-home'
      ? { ...waypoint, action: value, latitude: home.latitude, longitude: home.longitude, loiterSeconds: 0 }
      : { ...waypoint, action: value });
  }
  return <article className={`waypoint-editor ${selected ? 'is-selected' : ''}`} draggable onDragStart={onDragStart} onDragOver={event => event.preventDefault()} onDrop={onDrop} onClick={onSelect}>
    <div className="waypoint-editor__order"><span>WP</span><strong>{String(index + 1).padStart(2, '0')}</strong><i title="Drag to reorder">⋮⋮</i></div>
    <div className="waypoint-editor__fields">
      <label>ACTION<select value={waypoint.action} onChange={event => action(event.target.value as MissionAction)}><option value="waypoint">Waypoint</option><option value="loiter">Loiter</option><option value="return-home">Return home</option></select></label>
      <label>LATITUDE<NumericInput label={`Waypoint ${index + 1} latitude`} value={waypoint.latitude} step={.000001} min={-90} max={90} onChange={value => field('latitude', value)}/></label>
      <label>LONGITUDE<NumericInput label={`Waypoint ${index + 1} longitude`} value={waypoint.longitude} step={.000001} min={-180} max={180} onChange={value => field('longitude', value)}/></label>
      <label>ALTITUDE AGL<NumericInput label={`Waypoint ${index + 1} altitude`} value={waypoint.altitudeM} min={10} max={500} onChange={value => field('altitudeM', value)}/><small>m</small></label>
      <label>TARGET GROUND SPEED<NumericInput label={`Waypoint ${index + 1} target speed`} value={waypoint.targetSpeedKmh} min={15} max={160} onChange={value => field('targetSpeedKmh', value)}/><small>km/h</small></label>
      <label>ACCEPTANCE RADIUS<NumericInput label={`Waypoint ${index + 1} acceptance radius`} value={waypoint.acceptanceRadiusM} min={10} max={300} onChange={value => field('acceptanceRadiusM', value)}/><small>m</small></label>
      {waypoint.action === 'loiter' && <label>LOITER TIME<NumericInput label={`Waypoint ${index + 1} loiter time`} value={waypoint.loiterSeconds} min={5} max={1800} onChange={value => field('loiterSeconds', value)}/><small>s</small></label>}
    </div>
    <div className="waypoint-editor__actions"><button onClick={event => { event.stopPropagation(); onMove(-1); }} disabled={index === 0} aria-label={`Move waypoint ${index + 1} up`}>↑</button><button onClick={event => { event.stopPropagation(); onMove(1); }} disabled={index === total - 1} aria-label={`Move waypoint ${index + 1} down`}>↓</button><button className="delete" onClick={event => { event.stopPropagation(); onDelete(); }}>DELETE</button></div>
  </article>;
}

export function MissionPlanner({ snapshot, status, source, theme, firebaseConfigured, database, userId, aircraftId }: {
  snapshot: AircraftTelemetry | null;
  status: string;
  source: TelemetrySource;
  theme: Theme;
  firebaseConfigured: boolean;
  database: Database | null;
  userId: string | null;
  aircraftId: string;
}) {
  const [mission, setMission] = useState(() => createMission(aircraftId, telemetryHome(snapshot)));
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [draggedWaypointId, setDraggedWaypointId] = useState<string | null>(null);
  const [savedMissions, setSavedMissions] = useState<MissionDocument[]>([]);
  const [cloudStatus, setCloudStatus] = useState<MissionCloudStatus>('empty');
  const [cloudMessage, setCloudMessage] = useState('Sign in to use the Firebase mission library.');
  const [transfer, setTransfer] = useState<MissionTransferState>(EMPTY_TRANSFER);
  const [operationMessage, setOperationMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationElapsed, setSimulationElapsed] = useState(0);
  const [simulationSpeed, setSimulationSpeed] = useState(4);
  const importRef = useRef<HTMLInputElement>(null);
  const simulationClockRef = useRef(Date.now());

  const metrics = useMemo(() => missionMetrics(mission), [mission]);
  const issues = useMemo(() => validateMission(mission), [mission]);
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const simulationFrame = useMemo(() => simulateMissionAt(mission, simulationElapsed), [mission, simulationElapsed]);
  const livePosition = positionFromTelemetry(snapshot);
  const displayPosition = simulationActive ? simulationFrame.position : livePosition;
  const matchingNanoIndex = transfer.nano && transfer.missionId === mission.id && transfer.revision === mission.revision && transfer.checksum === mission.checksum ? transfer.nano.currentWaypointIndex : null;
  const progressHint = simulationActive ? simulationFrame.activeWaypointIndex : matchingNanoIndex;
  const computedProgress = useMemo(() => missionProgress(mission, displayPosition, progressHint), [mission, displayPosition, progressHint]);
  const activeWaypointIndex = simulationActive ? simulationFrame.completed ? null : simulationFrame.activeWaypointIndex : matchingNanoIndex ?? computedProgress.activeWaypointIndex;
  const nodeAck = ackLabel(transfer.nodeMcu, transfer);
  const nanoAck = ackLabel(transfer.nano, transfer);
  const transferMatchesDraft = transfer.missionId === mission.id && transfer.revision === mission.revision && transfer.checksum === mission.checksum;
  const onboardReady = transferMatchesDraft && ['stored', 'validated'].includes(transfer.nodeMcu?.status ?? '') && transfer.nano?.status === 'validated';

  useEffect(() => {
    if (!database || !userId) {
      setSavedMissions([]);
      setCloudStatus(firebaseConfigured ? 'empty' : 'unavailable');
      setCloudMessage(firebaseConfigured ? 'Sign in on the Telemetry page to save missions.' : 'Firebase is not configured in this deployment.');
      return;
    }
    return subscribeMissionLibrary(database, userId, aircraftId, (missions, nextStatus, message) => {
      setSavedMissions(missions); setCloudStatus(nextStatus); setCloudMessage(message);
    });
  }, [database, userId, aircraftId, firebaseConfigured]);

  useEffect(() => {
    if (!database || !userId) { setTransfer(EMPTY_TRANSFER); return; }
    return subscribeMissionTransfer(database, aircraftId, setTransfer);
  }, [database, userId, aircraftId]);

  useEffect(() => {
    if (!simulationRunning) return;
    simulationClockRef.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const delta = Math.min(.5, (now - simulationClockRef.current) / 1000) * simulationSpeed;
      simulationClockRef.current = now;
      setSimulationElapsed(current => Math.min(metrics.estimatedDurationSec, current + delta));
    }, 100);
    return () => window.clearInterval(timer);
  }, [simulationRunning, simulationSpeed, metrics.estimatedDurationSec]);

  useEffect(() => {
    if (simulationRunning && simulationElapsed >= metrics.estimatedDurationSec) setSimulationRunning(false);
  }, [simulationRunning, simulationElapsed, metrics.estimatedDurationSec]);

  function mutate(changes: Partial<Omit<MissionDocument, 'schemaVersion' | 'id' | 'aircraftId' | 'createdAt' | 'checksum'>>) {
    setMission(current => updateMission(current, changes));
    setOperationMessage('Draft changed · save or stage the new revision.');
  }

  function setWaypoints(update: (waypoints: MissionWaypoint[]) => MissionWaypoint[]) {
    setMission(current => updateMission(current, { waypoints: update(current.waypoints) }));
    setOperationMessage('Draft changed · validation updated.');
  }

  function addWaypoint(position: MissionPosition) {
    setWaypoints(current => {
      const waypoint = createWaypoint(position, current.length);
      setSelectedWaypointId(waypoint.id);
      const returnIndex = current.findIndex(item => item.action === 'return-home');
      return returnIndex < 0 ? [...current, waypoint] : [...current.slice(0, returnIndex), waypoint, ...current.slice(returnIndex)];
    });
  }

  function moveHome(position: MissionPosition) {
    setMission(current => updateMission(current, {
      home: { ...position, confirmedByOperator: false },
      waypoints: current.waypoints.map(waypoint => waypoint.action === 'return-home' ? { ...waypoint, ...position } : waypoint),
    }));
    setOperationMessage('HOME moved · operator confirmation required again.');
  }

  function updateWaypoint(id: string, waypoint: MissionWaypoint) { setWaypoints(current => current.map(item => item.id === id ? waypoint : item)); }
  function deleteWaypointById(id: string) { setWaypoints(current => current.filter(item => item.id !== id)); if (selectedWaypointId === id) setSelectedWaypointId(null); }
  function moveWaypoint(id: string, direction: -1 | 1) {
    setWaypoints(current => { const index = current.findIndex(item => item.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }
  function dropWaypoint(targetId: string) {
    if (!draggedWaypointId || draggedWaypointId === targetId) return;
    setWaypoints(current => { const from = current.findIndex(item => item.id === draggedWaypointId); const to = current.findIndex(item => item.id === targetId); if (from < 0 || to < 0) return current; const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; });
    setDraggedWaypointId(null);
  }

  function addReturnHome() {
    if (mission.waypoints.some(waypoint => waypoint.action === 'return-home')) return;
    const waypoint = { ...createWaypoint(mission.home, mission.waypoints.length), action: 'return-home' as const, loiterSeconds: 0 };
    setWaypoints(current => [...current, waypoint]);
    setSelectedWaypointId(waypoint.id);
  }

  async function saveToCloud() {
    if (!database || !userId || errors.length) return;
    setBusy(true); setOperationMessage('Saving mission to Firebase…');
    try { const saved = await saveMission(database, userId, mission); setMission(saved); setOperationMessage('Mission saved in your Firebase library.'); }
    catch { setOperationMessage('Mission could not be saved. Check sign-in and database rules.'); }
    finally { setBusy(false); }
  }

  async function stageForTransfer() {
    if (!database || !userId || errors.length) return;
    if (!window.confirm('Stage this complete mission for NodeMCU → Nano transfer? This does not start the mission.')) return;
    setBusy(true); setOperationMessage('Staging the sealed mission package…');
    try {
      const result = await stageMission(database, userId, mission);
      setMission(result.mission);
      setOperationMessage(`Transfer ${result.requestId} staged. Waiting for NodeMCU and Nano acknowledgements.`);
    } catch { setOperationMessage('Mission transfer could not be staged. Check sign-in and database rules.'); }
    finally { setBusy(false); }
  }

  async function importMission(file: File | undefined) {
    if (!file) return;
    const parsed = parseMissionJson(await file.text());
    if (!parsed.ok) { setOperationMessage(`Import rejected: ${parsed.message}`); return; }
    if (parsed.mission.aircraftId !== aircraftId) { setOperationMessage(`Import rejected: mission belongs to ${parsed.mission.aircraftId}.`); return; }
    setMission(parsed.mission); setSelectedWaypointId(null); setSimulationActive(false); setSimulationElapsed(0);
    setOperationMessage(`Imported ${parsed.mission.name}. Review validation before saving.`);
  }

  function newMission() {
    if (mission.waypoints.length && !window.confirm('Replace the current draft with a new mission?')) return;
    setMission(createMission(aircraftId, telemetryHome(snapshot))); setSelectedWaypointId(null); setSimulationActive(false); setSimulationElapsed(0); setOperationMessage('New mission draft created. Confirm HOME before saving.');
  }

  const sourcePositionLabel = simulationActive ? `MISSION SIMULATION · ${simulationFrame.phase.toUpperCase()}` : `${source.toUpperCase()} POSITION · ${status}`;
  return <div className="mission-planner-page">
    <section className="mission-safety-banner"><div><strong>MISSION STAGING / NO EXECUTE CONTROL</strong><span>Firebase distributes one sealed mission package. The dashboard does not stream steering commands or start autonomous flight.</span></div><b>MANUAL OVERRIDE + FAILSAFE ALWAYS PRIORITY</b></section>

    <section className="mission-command-bar">
      <div className="mission-name"><span>MISSION NAME</span><input value={mission.name} maxLength={60} onChange={event => mutate({ name: event.target.value })}/><small>{mission.id} · REV {mission.revision} · CRC32 {mission.checksum}</small></div>
      <div className="mission-command-bar__actions"><button onClick={newMission}>NEW</button><button onClick={() => importRef.current?.click()}>IMPORT JSON</button><button onClick={() => downloadMission(sealMission(mission))}>EXPORT JSON</button><button className="primary" disabled={busy || !database || !userId || errors.length > 0} onClick={() => void saveToCloud()}>SAVE FIREBASE</button><button className="stage" disabled={busy || !database || !userId || errors.length > 0} onClick={() => void stageForTransfer()}>STAGE ONBOARD TRANSFER</button></div>
      <input ref={importRef} className="mission-file-input" type="file" accept="application/json,.json" onChange={event => { void importMission(event.target.files?.[0]); event.target.value = ''; }}/>
    </section>

    {operationMessage && <div className="mission-operation-message" role="status">{operationMessage}</div>}

    <div className="mission-planner-grid">
      <MissionPlannerMap mission={mission} displayPosition={displayPosition} activeWaypointIndex={activeWaypointIndex} heading={snapshot?.attitude.heading ?? snapshot?.navigation.course ?? 0} theme={theme} onAddWaypoint={addWaypoint} onMoveWaypoint={(id, position) => { const waypoint = mission.waypoints.find(item => item.id === id); if (waypoint) updateWaypoint(id, { ...waypoint, ...position, action: waypoint.action === 'return-home' ? 'waypoint' : waypoint.action }); }} onMoveHome={moveHome}/>
      <div className="mission-planner-side">
        <section className="mission-card mission-route-summary"><header><div><span>ROUTE CALCULATION</span><h2>Mission summary</h2></div><b>{errors.length ? 'INVALID' : 'VALIDATED'}</b></header><div className="mission-summary-grid"><div><span>WAYPOINTS</span><strong>{metrics.waypointCount}</strong></div><div><span>ROUTE</span><strong>{distance(metrics.routeDistanceM)}</strong></div><div><span>EST. DURATION</span><strong>{duration(metrics.estimatedDurationSec)}</strong></div><div><span>MAX ALTITUDE</span><strong>{metrics.maximumAltitudeM == null ? '—' : `${metrics.maximumAltitudeM.toFixed(0)} m`}</strong></div></div><p>Duration uses each waypoint’s target ground speed and loiter time. It does not model wind, turns, climb performance or battery reserve.</p></section>

        <section className="mission-card mission-home"><header><div><span>NAVIGATION ORIGIN</span><h2>HOME & geofence</h2></div><b className={mission.home.confirmedByOperator ? 'ready' : 'warning'}>{mission.home.confirmedByOperator ? 'CONFIRMED' : 'VERIFY'}</b></header><div className="mission-home__fields"><label>LAT<NumericInput label="Home latitude" value={mission.home.latitude} step={.000001} min={-90} max={90} onChange={value => moveHome({ latitude: Number.isFinite(value) ? value : 0, longitude: mission.home.longitude })}/></label><label>LON<NumericInput label="Home longitude" value={mission.home.longitude} step={.000001} min={-180} max={180} onChange={value => moveHome({ latitude: mission.home.latitude, longitude: Number.isFinite(value) ? value : 0 })}/></label><label>GEOFENCE<NumericInput label="Mission geofence radius" value={mission.geofenceRadiusM} min={100} max={5000} step={10} onChange={value => mutate({ geofenceRadiusM: Number.isFinite(value) ? value : 0 })}/><small>m</small></label></div><div className="mission-home__actions"><button disabled={!telemetryHome(snapshot)} onClick={() => { const home = telemetryHome(snapshot); if (home) moveHome(home); }}>USE REPORTED HOME</button><button disabled={!livePosition} onClick={() => { if (livePosition) moveHome(livePosition); }}>USE AIRCRAFT POSITION</button><button className="confirm" onClick={() => mutate({ home: { ...mission.home, confirmedByOperator: true } })}>CONFIRM HOME</button></div></section>

        <section className="mission-card mission-live-progress"><header><div><span>{sourcePositionLabel}</span><h2>Navigation progress</h2></div><b>{simulationActive ? `${simulationSpeed}×` : 'DERIVED'}</b></header><div><div><span>CURRENT WAYPOINT</span><strong>{activeWaypointIndex == null ? computedProgress.completed ? 'COMPLETE' : '—' : `WP ${activeWaypointIndex + 1}`}</strong></div><div><span>DISTANCE TO WP</span><strong>{distance(computedProgress.distanceToWaypointM)}</strong></div><div><span>ROUTE REMAINING</span><strong>{distance(computedProgress.distanceRemainingM)}</strong></div><div><span>CROSS-TRACK ERROR</span><strong>{finite(computedProgress.crossTrackErrorM) ? `${computedProgress.crossTrackErrorM > 0 ? 'R ' : 'L '}${Math.abs(computedProgress.crossTrackErrorM).toFixed(1)} m` : '—'}</strong></div></div><label className="mission-simulation-scrubber"><span>SIMULATION TIMELINE</span><input type="range" min={0} max={Math.max(metrics.estimatedDurationSec, 1)} step={.1} value={simulationElapsed} disabled={errors.length > 0} onChange={event => { setSimulationRunning(false); setSimulationActive(true); setSimulationElapsed(Number(event.target.value)); }}/></label><div className="mission-simulation-controls"><button className="primary" disabled={errors.length > 0} onClick={() => { setSimulationActive(true); if (simulationElapsed >= metrics.estimatedDurationSec) setSimulationElapsed(0); setSimulationRunning(value => !value); }}>{simulationRunning ? 'PAUSE SIMULATION' : simulationElapsed > 0 && simulationElapsed < metrics.estimatedDurationSec ? 'RESUME SIMULATION' : 'START SIMULATION'}</button><button onClick={() => { setSimulationRunning(false); setSimulationActive(false); setSimulationElapsed(0); }}>RESET</button><select value={simulationSpeed} onChange={event => setSimulationSpeed(Number(event.target.value))} aria-label="Mission simulation speed">{[1, 2, 4, 10, 20].map(value => <option key={value} value={value}>{value}×</option>)}</select><span>{duration(simulationElapsed)} / {duration(metrics.estimatedDurationSec)}</span></div></section>

        <section className="mission-card mission-validation"><header><div><span>PRE-SAVE GATE</span><h2>Mission validation</h2></div><b className={errors.length ? 'warning' : 'ready'}>{errors.length} ERRORS · {warnings.length} WARN</b></header><div className="mission-validation__list">{!issues.length && <div className="pass"><i/><span><strong>VALIDATION PASSED</strong><small>Mission package is structurally ready to save.</small></span></div>}{issues.map((issue, index) => <div className={issue.severity} key={`${issue.code}-${issue.waypointId ?? index}`}><i/><span><strong>{issue.code.replaceAll('-', ' ').toUpperCase()}</strong><small>{issue.message}</small></span></div>)}</div></section>
      </div>
    </div>

    <section className="mission-card waypoint-list"><header><div><span>ORDERED ROUTE / DRAG OR USE ARROWS</span><h2>Waypoint editor</h2></div><div><button onClick={() => addWaypoint(mission.waypoints.at(-1) ?? mission.home)}>ADD WAYPOINT</button><button onClick={addReturnHome} disabled={mission.waypoints.some(waypoint => waypoint.action === 'return-home')}>ADD RETURN HOME</button></div></header>{!mission.waypoints.length && <div className="waypoint-list__empty"><strong>CLICK THE MAP TO ADD THE FIRST WAYPOINT</strong><span>HOME must be confirmed and at least one waypoint is required before saving.</span></div>}<div className="waypoint-list__items">{mission.waypoints.map((waypoint, index) => <WaypointEditor key={waypoint.id} waypoint={waypoint} index={index} total={mission.waypoints.length} home={mission.home} selected={selectedWaypointId === waypoint.id} onSelect={() => setSelectedWaypointId(waypoint.id)} onChange={next => updateWaypoint(waypoint.id, next)} onDelete={() => deleteWaypointById(waypoint.id)} onMove={direction => moveWaypoint(waypoint.id, direction)} onDragStart={() => setDraggedWaypointId(waypoint.id)} onDrop={() => dropWaypoint(waypoint.id)}/>)}</div></section>

    <div className="mission-bottom-grid">
      <section className="mission-card mission-transfer"><header><div><span>FIREBASE → NODEMCU → NANO</span><h2>Onboard transfer acknowledgements</h2></div><b className={onboardReady ? 'ready' : 'warning'}>{onboardReady ? 'ONBOARD READY' : transfer.requestId ? 'TRANSFER PENDING' : 'NOT STAGED'}</b></header><div className="mission-transfer__identity"><span>STAGED PACKAGE</span><strong>{transfer.missionId ?? '—'} {transfer.revision == null ? '' : `· REV ${transfer.revision}`}</strong><small>{transfer.checksum ?? 'NO CHECKSUM'} {transfer.requestedAt ? `· ${new Date(transfer.requestedAt).toLocaleString()}` : ''}</small></div><div className="mission-transfer__steps"><div className={nodeAck.state}><i/><span><strong>1 / NODEMCU GATEWAY</strong><small>{nodeAck.detail}</small></span><b>{nodeAck.label}</b></div><div className={nanoAck.state}><i/><span><strong>2 / ARDUINO NANO</strong><small>{nanoAck.detail}</small></span><b>{nanoAck.label}</b></div></div>{transfer.requestId && !transferMatchesDraft && <p className="mission-transfer__mismatch">The current draft differs from the staged package. Stage the validated revision again before bench transfer.</p>}<p>No acknowledgement is generated by the dashboard. The Nano must independently validate schema, revision, checksum, waypoint limits, geofence and manual-mode interlock.</p></section>

      <section className="mission-card mission-library"><header><div><span>AUTHENTICATED FIREBASE STORAGE</span><h2>Mission library</h2></div><b className={cloudStatus === 'ready' ? 'ready' : ''}>{cloudStatus.toUpperCase()}</b></header><p className="mission-library__status">{cloudMessage}</p>{!userId && <a href="#/telemetry">SIGN IN ON TELEMETRY PAGE</a>}<div className="mission-library__list">{savedMissions.map(saved => <div key={saved.id}><button onClick={() => { setMission(saved); setSelectedWaypointId(null); setSimulationActive(false); setSimulationElapsed(0); setOperationMessage(`Loaded ${saved.name} revision ${saved.revision}.`); }}><span>{saved.name}</span><strong>REV {saved.revision}</strong><small>{saved.waypoints.length} WP · {distance(missionMetrics(saved).routeDistanceM)} · {new Date(saved.updatedAt).toLocaleString()}</small></button><button className="delete" onClick={() => { if (database && userId && window.confirm(`Delete ${saved.name} from Firebase?`)) void deleteMission(database, userId, saved); }}>DELETE</button></div>)}</div></section>
    </div>

    <section className="mission-boundary"><strong>FLIGHT-SAFETY BOUNDARY</strong><span>The entire mission must be stored and validated onboard before takeoff. A physical/manual switch determines whether mission mode is allowed. nRF24 manual override and onboard failsafe have priority. Losing Wi-Fi, Firebase, this dashboard or the NodeMCU must not stop Nano navigation or failsafe logic.</span></section>
  </div>;
}
