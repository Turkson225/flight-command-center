import { useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftTelemetry, FlightAlert } from '../core/telemetry';
import {
  analyzeControlResponse,
  buildPreflightChecks,
  computeFlightSummary,
  DEFAULT_ALERT_SETTINGS,
  flightToCsv,
  type AlertSettings,
  type FlightEvent,
  type RecordedFlight,
} from '../core/flightOperations';
import { NavigationMap } from './NavigationMap';
import { AirframeVisualizer } from './AirframeVisualizer';
import './flight-operations.css';

type Theme = 'midnight' | 'monochrome' | 'blackwhite' | 'military';

export interface FlightOperationsController {
  recording: boolean;
  activeSamples: AircraftTelemetry[];
  activeEvents: FlightEvent[];
  flights: RecordedFlight[];
  storageReady: boolean;
  storageError: string | null;
  settings: AlertSettings;
  configuredAlerts: FlightAlert[];
  startRecording: () => void;
  stopRecording: () => RecordedFlight | null;
  addNote: (detail: string) => void;
  deleteFlight: (id: string) => void;
  updateSettings: (next: AlertSettings) => void;
}

interface OperationsPageProps {
  snapshot: AircraftTelemetry | null;
  history: AircraftTelemetry[];
  status: string;
  theme: Theme;
  operations: FlightOperationsController;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fixed(value: number | null | undefined, digits = 1, suffix = '') {
  return finite(value) ? `${value.toFixed(digits)}${suffix}` : '—';
}

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes.toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function flightFilename(flight: RecordedFlight, extension: string) {
  const stamp = new Date(flight.startedAt).toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  return `${flight.aircraftId}-${stamp}.${extension}`;
}

function Trace({ values, color, label }: { values: (number | null | undefined)[]; color: string; label: string }) {
  const valid = values.filter(finite);
  if (valid.length < 2) return <div className="ops-chart-empty">Awaiting samples</div>;
  const low = Math.min(...valid);
  const high = Math.max(...valid);
  const span = Math.max(.01, high - low);
  let path = '';
  let connected = false;
  values.forEach((value, index) => {
    if (!finite(value)) { connected = false; return; }
    const x = index / Math.max(1, values.length - 1) * 400;
    const y = 92 - (value - low) / span * 80;
    path += `${connected ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    connected = true;
  });
  return <svg className="ops-trace" viewBox="0 0 400 104" preserveAspectRatio="none" role="img" aria-label={label}><line x1="0" y1="52" x2="400" y2="52"/><path d={path} stroke={color} fill="none" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg>;
}

export function PitchFocus({ snapshot, history, status }: { snapshot: AircraftTelemetry | null; history: AircraftTelemetry[]; status: string }) {
  const panelRef = useRef<HTMLElement>(null);
  const pitch = snapshot?.attitude.pitch;
  const rate = snapshot?.attitude.gyroY;
  const elevator = snapshot?.control.elevator;
  const stableElevator = history.slice(-150).filter(sample => finite(sample.control.elevator) && (!finite(sample.attitude.gyroY) || Math.abs(sample.attitude.gyroY) < 1.5)).map(sample => sample.control.elevator as number);
  const trimBias = stableElevator.length >= 10 ? stableElevator.reduce((sum, value) => sum + value, 0) / stableElevator.length : null;
  const visualPitch = finite(pitch) ? Math.max(-45, Math.min(45, pitch)) : 0;
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch { /* Fullscreen remains optional. */ }
  }
  return <section ref={panelRef} className="pitch-focus-mode">
    <header><div><span>PITCH-FOCUSED MODE / MPU9250</span><h2>Longitudinal attitude</h2></div><button className="ops-button ops-button--quiet" type="button" onClick={() => void fullscreen()}>FULLSCREEN</button></header>
    <div className="pitch-focus-grid">
      <div className={`pitch-ladder-large ${!finite(pitch) ? 'is-empty' : ''}`}>
        <div className="pitch-ladder-large__sky"/><div className="pitch-ladder-large__ground"/>
        <div className="pitch-ladder-large__scale" style={{ transform: `translateY(${visualPitch * 5}px)` }}>{[-40, -30, -20, -10, 0, 10, 20, 30, 40].map(mark => <div key={mark} style={{ top: `calc(50% - ${mark * 5}px)` }}><span>{mark > 0 ? `+${mark}` : mark}</span><i/><span>{mark > 0 ? `+${mark}` : mark}</span></div>)}</div>
        <div className="pitch-ladder-large__aircraft"><i/><b/><i/></div>
        {!finite(pitch) && <strong className="pitch-ladder-large__empty">PITCH UNAVAILABLE</strong>}
      </div>
      <div className="pitch-focus-readout"><span>CURRENT PITCH</span><strong>{fixed(pitch, 1, '°')}</strong><small>{!finite(pitch) ? status : Math.abs(pitch) < .5 ? 'LEVEL' : pitch > 0 ? 'NOSE UP' : 'NOSE DOWN'}</small></div>
      <div className="pitch-focus-stats">
        <div><span>PITCH RATE</span><strong>{fixed(rate, 2, '°/s')}</strong></div>
        <div><span>ELEVATOR COMMAND</span><strong>{fixed(elevator, 1, '°')}</strong></div>
        <div><span>OBSERVED TRIM BIAS</span><strong>{fixed(trimBias, 1, '°')}</strong><small>Mean elevator command during low pitch-rate samples</small></div>
      </div>
      <div className="pitch-rate-chart"><div><span>PITCH RATE / RECENT</span><strong>{history.length} samples</strong></div><Trace values={history.slice(-240).map(sample => sample.attitude.gyroY)} color="var(--cyan)" label="Recent pitch rate"/></div>
    </div>
    <p>Elevator is a commanded value, not a measured servo position. Trim bias is descriptive and must not be treated as an automatic trim recommendation.</p>
  </section>;
}

export function AlertConfiguration({ settings, onChange, activeAlerts }: { settings: AlertSettings; onChange: (value: AlertSettings) => void; activeAlerts: FlightAlert[] }) {
  function numberField(key: keyof AlertSettings, value: string, min: number, max: number) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) onChange({ ...settings, [key]: Math.max(min, Math.min(max, parsed)) });
  }
  return <section className="ops-card alert-config">
    <header><div><span>LOCAL ADVISORY RULES</span><h2>Configurable alerts</h2></div><strong className={activeAlerts.length ? 'is-warning' : ''}>{activeAlerts.length} ACTIVE</strong></header>
    <div className="alert-config__grid">
      <label>MAX PITCH <span><input type="number" min="1" max="90" value={settings.maxPitchDeg} onChange={event => numberField('maxPitchDeg', event.target.value, 1, 90)}/> °</span></label>
      <label>MAX BANK <span><input type="number" min="1" max="90" value={settings.maxRollDeg} onChange={event => numberField('maxRollDeg', event.target.value, 1, 90)}/> °</span></label>
      <label>MIN VOLTAGE <span><input type="number" min="0" max="60" step="0.1" value={settings.minBatteryVoltage} onChange={event => numberField('minBatteryVoltage', event.target.value, 0, 60)}/> V</span></label>
      <label>MIN BATTERY <span><input type="number" min="0" max="100" value={settings.minBatteryPercent} onChange={event => numberField('minBatteryPercent', event.target.value, 0, 100)}/> %</span></label>
      <label>GEOFENCE <span><input type="number" min="10" max="50000" step="10" value={settings.geofenceRadiusM} onChange={event => numberField('geofenceRadiusM', event.target.value, 10, 50_000)}/> m</span></label>
    </div>
    <div className="alert-config__switches">
      {([['warnGpsLoss', 'GPS loss'], ['warnTelemetryLoss', 'Telemetry loss'], ['warnFailsafe', 'Failsafe']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={event => onChange({ ...settings, [key]: event.target.checked })}/><span>{label}</span></label>)}
    </div>
    <div className="alert-config__actions"><button className="ops-button ops-button--quiet" type="button" onClick={() => onChange(DEFAULT_ALERT_SETTINGS)}>RESET DEFAULTS</button><span>Rules run in this browser and do not command the aircraft.</span></div>
  </section>;
}

export function PreflightChecklist({ snapshot, status, settings }: { snapshot: AircraftTelemetry | null; status: string; settings: AlertSettings }) {
  const checks = useMemo(() => buildPreflightChecks(snapshot, status, settings), [snapshot, status, settings]);
  const [manual, setManual] = useState<Record<string, boolean>>({ airframe: false, directions: false, area: false });
  const automaticReady = checks.every(check => check.state !== 'block');
  const manualReady = Object.values(manual).every(Boolean);
  return <section className="ops-card preflight">
    <header><div><span>GO / NO-GO SUPPORT</span><h2>Preflight checklist</h2></div><strong className={automaticReady && manualReady ? 'is-ready' : 'is-warning'}>{automaticReady && manualReady ? 'READY TO REVIEW' : 'NOT READY'}</strong></header>
    <div className="preflight__list">{checks.map(check => <div key={check.id} className={`preflight__row preflight__row--${check.state}`}><i/ ><div><strong>{check.label}</strong><span>{check.detail}</span></div><b>{check.state.toUpperCase()}</b></div>)}</div>
    <div className="preflight__manual"><span>OPERATOR CONFIRMATION</span>{([['airframe', 'Airframe and propeller inspected'], ['directions', 'Control directions verified'], ['area', 'Flight area and weather reviewed']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={manual[key]} onChange={event => setManual(current => ({ ...current, [key]: event.target.checked }))}/><span>{label}</span></label>)}</div>
    <p>This checklist supports the operator; it is not an airworthiness determination. Follow the aircraft’s approved procedure.</p>
  </section>;
}

function FlightSummaryPanel({ flight }: { flight: RecordedFlight }) {
  const summary = useMemo(() => computeFlightSummary(flight.samples), [flight]);
  const values = [
    ['DURATION', clock(summary.durationSec)], ['MAX ALTITUDE', fixed(summary.maxAltitudeM, 1, ' m')],
    ['GROUND DISTANCE', summary.distanceM >= 1000 ? fixed(summary.distanceM / 1000, 2, ' km') : fixed(summary.distanceM, 0, ' m')],
    ['MAX SPEED', fixed(summary.maxSpeedKmh, 1, ' km/h')], ['PITCH LIMIT', fixed(summary.maxAbsPitchDeg, 1, '°')],
    ['BANK LIMIT', fixed(summary.maxAbsRollDeg, 1, '°')], ['MIN VOLTAGE', fixed(summary.minVoltage, 2, ' V')],
    ['GPS QUALITY', `${fixed(summary.gpsFixPercent, 0, '% fix')} · ${fixed(summary.maxHdop, 1, ' max HDOP')}`],
  ];
  return <section className="ops-card flight-summary"><header><div><span>POST-FLIGHT READOUT</span><h2>Flight summary</h2></div><strong>{flight.samples.length} SAMPLES</strong></header><div>{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>;
}

function ResponseAnalysis({ samples }: { samples: AircraftTelemetry[] }) {
  const axes = useMemo(() => analyzeControlResponse(samples), [samples]);
  const recent = samples.slice(-400);
  const pairs = [
    { key: 'elevator-pitch', title: 'Elevator → pitch', command: recent.map(sample => sample.control.elevator), response: recent.map(sample => sample.attitude.pitch), colors: ['var(--amber)', 'var(--cyan)'] },
    { key: 'aileron-roll', title: 'Aileron → roll', command: recent.map(sample => sample.control.aileron), response: recent.map(sample => sample.attitude.roll), colors: ['var(--amber)', 'var(--green)'] },
    { key: 'rudder-heading', title: 'Rudder → heading', command: recent.map(sample => sample.control.rudder), response: recent.map(sample => sample.attitude.heading), colors: ['var(--amber)', 'var(--cyan)'] },
  ];
  return <section className="ops-card response-analysis"><header><div><span>COMMAND / MOTION COMPARISON</span><h2>Control-response analysis</h2></div><strong>{samples.length} SAMPLES</strong></header><div className="response-analysis__grid">{pairs.map(pair => { const axis = axes.find(item => item.key === pair.key)!; return <article key={pair.key}><div><h3>{pair.title}</h3><span className={`response-rating response-rating--${axis.rating.toLowerCase()}`}>{axis.rating}</span></div><div className="response-traces"><Trace values={pair.response} color={pair.colors[1]} label={`${pair.title} aircraft response`}/><Trace values={pair.command} color={pair.colors[0]} label={`${pair.title} control command`}/></div><footer><span>CORRELATION <b>{fixed(axis.correlation, 2)}</b></span><span>BEST LAG <b>{fixed(axis.lagMs, 0, ' ms')}</b></span><span>OSCILLATION <b>{fixed(axis.oscillationHz, 2, ' Hz')}</b></span></footer></article>; })}</div><p>Correlation, best lag and reversal frequency are screening indicators only. They do not prove causation, stability, or correct control direction; wind and pilot input can dominate the result.</p></section>;
}

function EventTimeline({ events, flight, onSeek }: { events: FlightEvent[]; flight: RecordedFlight; onSeek: (timestamp: number) => void }) {
  const duration = Math.max(1, flight.endedAt - flight.startedAt);
  return <section className="ops-card recorded-events"><header><div><span>ANNOTATED TIMELINE</span><h2>Event markers</h2></div><strong>{events.length} EVENTS</strong></header><div className="event-rail">{events.map(event => <button key={event.id} style={{ left: `${Math.max(0, Math.min(100, (event.timestamp - flight.startedAt) / duration * 100))}%` }} className={`event-rail__marker event-rail__marker--${event.severity}`} onClick={() => onSeek(event.timestamp)} title={`${event.label}: ${event.detail}`}/>)}</div><div className="recorded-events__list">{events.map(event => <button key={event.id} onClick={() => onSeek(event.timestamp)}><i className={`event-dot event-dot--${event.severity}`}/><div><strong>{event.label}</strong><span>{event.detail}</span></div><time>+{clock((event.timestamp - flight.startedAt) / 1000)}</time></button>)}</div></section>;
}

export function FlightOperationsPage({ snapshot, history, status, theme, operations }: OperationsPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [note, setNote] = useState('');
  const selectedFlight = operations.flights.find(flight => flight.id === selectedId) ?? operations.flights[0] ?? null;

  useEffect(() => {
    if (!selectedFlight) return;
    setSelectedId(selectedFlight.id);
    setReplayIndex(index => Math.min(index, Math.max(0, selectedFlight.samples.length - 1)));
  }, [selectedFlight?.id, selectedFlight?.samples.length]);

  useEffect(() => {
    if (!playing || !selectedFlight || replayIndex >= selectedFlight.samples.length - 1) { if (playing && selectedFlight && replayIndex >= selectedFlight.samples.length - 1) setPlaying(false); return; }
    const current = selectedFlight.samples[replayIndex];
    const next = selectedFlight.samples[replayIndex + 1];
    const delay = Math.max(35, Math.min(1_000, (next.timestamp - current.timestamp) / speed));
    const timer = window.setTimeout(() => setReplayIndex(index => Math.min(index + 1, selectedFlight.samples.length - 1)), delay);
    return () => window.clearTimeout(timer);
  }, [playing, selectedFlight, replayIndex, speed]);

  const replaySample = selectedFlight?.samples[replayIndex] ?? null;
  const replayHistory = selectedFlight ? selectedFlight.samples.slice(0, replayIndex + 1) : [];
  function stopAndSelect() {
    const flight = operations.stopRecording();
    if (flight) { setSelectedId(flight.id); setReplayIndex(0); }
  }
  function addNote() { operations.addNote(note); setNote(''); }
  function seek(timestamp: number) {
    if (!selectedFlight) return;
    let closest = 0;
    let distance = Infinity;
    selectedFlight.samples.forEach((sample, index) => { const next = Math.abs(sample.timestamp - timestamp); if (next < distance) { closest = index; distance = next; } });
    setReplayIndex(closest); setPlaying(false);
  }

  return <div className="flight-operations">
    <section className={`recorder-bar ${operations.recording ? 'is-recording' : ''}`}>
      <div><span className="recorder-bar__lamp"/><div><small>FLIGHT RECORDER / LOCAL</small><strong>{operations.recording ? `RECORDING · ${operations.activeSamples.length} SAMPLES` : 'READY'}</strong></div></div>
      <div className="recorder-bar__actions">{operations.recording && <><input value={note} onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addNote(); }} placeholder="Operator note…" aria-label="Operator event note"/><button className="ops-button ops-button--quiet" onClick={addNote} disabled={!note.trim()}>MARK EVENT</button></>}<button className={`ops-button ${operations.recording ? 'ops-button--danger' : 'ops-button--primary'}`} onClick={operations.recording ? stopAndSelect : operations.startRecording}>{operations.recording ? 'STOP & SAVE' : 'START RECORDING'}</button></div>
      <p>High-rate samples stay in this browser’s IndexedDB. Recording does not send extra writes to Firebase.</p>
    </section>

    {operations.storageError && <div className="ops-storage-warning">{operations.storageError}</div>}

    <div className="ops-setup-grid"><PreflightChecklist snapshot={snapshot} status={status} settings={operations.settings}/><AlertConfiguration settings={operations.settings} onChange={operations.updateSettings} activeAlerts={operations.configuredAlerts}/></div>

    <PitchFocus snapshot={snapshot} history={history} status={status}/>

    <section className="recording-library ops-card">
      <header><div><span>LOCAL FLIGHT LIBRARY</span><h2>Recordings & replay</h2></div><strong>{operations.storageReady ? `${operations.flights.length} SAVED` : 'LOADING'}</strong></header>
      {!operations.flights.length && <div className="recording-library__empty"><strong>NO COMPLETED FLIGHTS</strong><span>Start a recording above. Stop it to create a replayable local flight.</span></div>}
      {!!operations.flights.length && <div className="recording-library__body"><div className="recording-list">{operations.flights.map(flight => <button key={flight.id} className={selectedFlight?.id === flight.id ? 'is-selected' : ''} onClick={() => { setSelectedId(flight.id); setReplayIndex(0); setPlaying(false); }}><span>{new Date(flight.startedAt).toLocaleDateString()}</span><strong>{flight.name}</strong><small>{clock((flight.endedAt - flight.startedAt) / 1000)} · {flight.samples.length} samples · {flight.source.toUpperCase()}</small></button>)}</div>{selectedFlight && <div className="recording-actions"><button className="ops-button ops-button--quiet" onClick={() => download(flightFilename(selectedFlight, 'json'), JSON.stringify(selectedFlight, null, 2), 'application/json')}>EXPORT JSON</button><button className="ops-button ops-button--quiet" onClick={() => download(flightFilename(selectedFlight, 'csv'), flightToCsv(selectedFlight), 'text/csv')}>EXPORT CSV</button><button className="ops-button ops-button--danger-text" onClick={() => { if (window.confirm('Delete this local flight recording?')) { operations.deleteFlight(selectedFlight.id); setSelectedId(null); setReplayIndex(0); } }}>DELETE</button></div>}</div>}
    </section>

    {selectedFlight && replaySample && <>
      <section className="replay-console ops-card">
        <header><div><span>SYNCHRONIZED REPLAY</span><h2>{selectedFlight.name}</h2></div><strong>REPLAY · {speed}×</strong></header>
        <div className="replay-controls"><button className="ops-button ops-button--primary" onClick={() => setPlaying(value => !value)}>{playing ? 'PAUSE' : 'PLAY'}</button><button className="ops-button ops-button--quiet" onClick={() => { setPlaying(false); setReplayIndex(0); }}>RESET</button><span>+{clock((replaySample.timestamp - selectedFlight.startedAt) / 1000)}</span><input type="range" min="0" max={Math.max(0, selectedFlight.samples.length - 1)} value={replayIndex} onChange={event => { setReplayIndex(Number(event.target.value)); setPlaying(false); }} aria-label="Replay position"/><select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Replay speed">{[.5, 1, 2, 4].map(value => <option value={value} key={value}>{value}×</option>)}</select><span>{clock((selectedFlight.endedAt - selectedFlight.startedAt) / 1000)}</span></div>
      </section>
      <div className="replay-visuals"><div className="replay-map"><NavigationMap snapshot={replaySample} history={replayHistory} theme={theme} source={selectedFlight.source} status="SIMULATION" ageMs={0} freshnessNow={replaySample.timestamp} geofenceRadiusMeters={operations.settings.geofenceRadiusM}/></div><section className="ops-card replay-airframe"><header><div><span>ATTITUDE + COMMANDS</span><h2>Airframe state</h2></div><strong>FRAME {replayIndex + 1}</strong></header><AirframeVisualizer snapshot={replaySample} status="REPLAY"/></section></div>
      <PitchFocus snapshot={replaySample} history={replayHistory} status="REPLAY"/>
      <FlightSummaryPanel flight={selectedFlight}/>
      <ResponseAnalysis samples={selectedFlight.samples}/>
      <EventTimeline events={selectedFlight.events} flight={selectedFlight} onSeek={seek}/>
    </>}
    {!selectedFlight && <ResponseAnalysis samples={operations.recording ? operations.activeSamples : history}/>} 
    <p className="flight-operations__disclaimer">Mission features on this page are monitoring and post-flight analysis tools. They do not upload waypoints or provide a browser-to-aircraft control path.</p>
  </div>;
}
