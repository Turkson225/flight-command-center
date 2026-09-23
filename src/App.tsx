import { useEffect, useMemo, useState } from 'react'
import { NavigationMap } from './components/NavigationMap'
import { AircraftAttitude } from './components/AircraftAttitude'
import { useTelemetry } from './core/useTelemetry'
import type { AircraftTelemetry, FlightAlert, SimulationScenario, TelemetrySource } from './core/telemetry'
import './styles.css'

type View = 'command' | 'navigation' | 'instruments' | 'telemetry' | 'sensors' | 'alerts' | 'engineering'
type Theme = 'dark' | 'light'
type IconName = 'grid' | 'map' | 'horizon' | 'wave' | 'chip' | 'alert' | 'tool' | 'expand' | 'chevron' | 'play' | 'pause' | 'reset' | 'copy' | 'arrow' | 'radio' | 'clock' | 'download' | 'menu' | 'close' | 'plane' | 'pin' | 'bolt' | 'sun' | 'moon'

const THEME_STORAGE_KEY = 'flight-command-center-theme'

function savedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const NAV: { key: View; label: string; icon: IconName; section: string }[] = [
  { key: 'command', label: 'Command center', icon: 'grid', section: 'OPERATIONS' },
  { key: 'navigation', label: 'Navigation', icon: 'map', section: 'OPERATIONS' },
  { key: 'instruments', label: 'Instruments', icon: 'horizon', section: 'OPERATIONS' },
  { key: 'telemetry', label: 'Telemetry', icon: 'wave', section: 'SYSTEMS' },
  { key: 'sensors', label: 'Sensor health', icon: 'chip', section: 'SYSTEMS' },
  { key: 'alerts', label: 'Alerts & events', icon: 'alert', section: 'SYSTEMS' },
  { key: 'engineering', label: 'Engineering', icon: 'tool', section: 'SYSTEMS' },
]

const SCENARIOS: { key: SimulationScenario; label: string; code: string }[] = [
  { key: 'normal', label: 'Normal flight', code: '01' },
  { key: 'gpsFailure', label: 'GPS failure', code: '02' },
  { key: 'lowBattery', label: 'Low battery', code: '03' },
  { key: 'telemetryLoss', label: 'Telemetry loss', code: '04' },
  { key: 'failsafe', label: 'Failsafe test', code: '05' },
]

function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  const lines: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></>,
    horizon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h6l3-3 3 3h6M6 17h12" /></>,
    wave: <><path d="M2 12h3l2-6 4 12 3-9 2 3h6" /></>,
    chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /></>,
    alert: <><path d="M12 3 2 21h20L12 3z" /><path d="M12 9v5m0 3h.01" /></>,
    tool: <><path d="M14.5 6.5a5 5 0 0 0-6.7 6.7L3 18l3 3 4.8-4.8a5 5 0 0 0 6.7-6.7L14 13l-3-3z" /></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    play: <path d="m8 5 11 7-11 7z" />,
    pause: <><path d="M8 5v14m8-14v14" /></>,
    reset: <><path d="M4 11a8 8 0 1 1 1.9 5.2M4 5v6h6" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M7.1 7.1a7 7 0 0 0 0 9.8m9.8-9.8a7 7 0 0 1 0 9.8M3.6 3.6a12 12 0 0 0 0 16.8m16.8-16.8a12 12 0 0 1 0 16.8" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="M5 5 19 19M19 5 5 19" />,
    plane: <><path d="m12 2 2 8 7 4v2l-8-2-1 7-2-3-2 3-1-7-8 2v-2l7-4z" /></>,
    pin: <><path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="9" r="2" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.3 15.5A8.5 8.5 0 0 1 8.5 3.7 8.5 8.5 0 1 0 20.3 15.5Z" />,
  }
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{lines[name]}</svg>
}

function num(v: number | null | undefined, digits = 1) {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}
function signed(v: number | null | undefined, digits = 1) {
  return v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}`
}
function bearing(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? '—' : `${Math.round(((v % 360) + 360) % 360).toString().padStart(3, '0')}°`
}
function duration(sec: number) {
  const safe = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(safe / 3600).toString().padStart(2, '0')}:${Math.floor((safe % 3600) / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`
}
function ageText(ageMs: number | null) {
  if (ageMs == null) return 'NO PACKETS'
  return ageMs < 1000 ? `${Math.round(ageMs)} ms ago` : `${(ageMs / 1000).toFixed(1)} s ago`
}
function normalizedStatus(status: string, source: string, snapshot: AircraftTelemetry | null) {
  if (!snapshot) return source === 'offline' ? 'OFFLINE' : 'NO DATA'
  if (status.toLowerCase().includes('stal')) return 'STALE'
  if (status.toLowerCase().includes('lost')) return 'LOST'
  if (status.toLowerCase().includes('off')) return 'OFFLINE'
  if (status.toLowerCase().includes('reconnect')) return 'RECONNECTING'
  return source === 'simulation' ? 'SIMULATION' : 'LIVE'
}
function getView(): View {
  const key = window.location.hash.replace(/^#\/?/, '').split('/')[0] as View
  return NAV.some(item => item.key === key) ? key : 'command'
}

function Panel({ eyebrow, title, right, children, className = '' }: { eyebrow?: string; title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><div className="panel-head-right">{right}</div></div>{children}</section>
}

function Metric({ label, value, unit, hint, accent }: { label: string; value: string; unit?: string; hint?: string; accent?: 'cyan' | 'amber' | 'red' }) {
  return <div className={`metric ${accent || ''}`}><span className="metric-label">{label}</span><div className="metric-readout"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>{hint && <small>{hint}</small>}</div>
}

function PrimaryFlightDisplay({ snapshot, status }: { snapshot: AircraftTelemetry | null; status: string }) {
  const imuReady = snapshot?.sensors.imu.state === 'online' && snapshot.sensors.imu.calibrated === true
  const roll = imuReady ? snapshot.attitude.roll : null
  const pitch = imuReady ? snapshot.attitude.pitch : null
  const heading = snapshot?.sensors.magnetometer.state === 'online' && snapshot.sensors.magnetometer.calibrated === true ? snapshot.attitude.heading : null
  const hasAttitude = roll != null && pitch != null
  const h = heading == null ? null : Math.round(((heading % 360) + 360) % 360)
  const headingMarks = h == null ? [] : [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(offset => ({ offset, value: ((Math.round(h / 10) * 10 + offset * 10) % 360 + 360) % 360 }))
  return <div className="pfd">
    <div className="pfd-topline"><span>PRIMARY FLIGHT DISPLAY <em> / FD-X1</em></span><span className={`state-text ${status === 'STALE' || status === 'LOST' || status === 'OFFLINE' ? 'warn' : ''}`}>{status === 'LOST' ? 'TELEMETRY LOST' : status}</span></div>
    <div className="pfd-body">
      <div className="pfd-side pfd-speed"><span className="instrument-label">GROUND SPEED</span><div className="pfd-tape"><span>KM/H</span><strong>{num(snapshot?.navigation.groundSpeed, 1)}</strong></div><span className="pfd-small">GPS derived</span></div>
      <div className={`horizon-frame ${!hasAttitude ? 'unavailable' : ''} ${status === 'STALE' || status === 'LOST' ? 'stale-instrument' : ''}`}>
        {hasAttitude && <>
          <div className="horizon-scene" style={{ transform: `rotate(${-Math.max(-80, Math.min(80, roll))}deg) translateY(${Math.max(-45, Math.min(45, pitch)) * 2.4}px)` }}>
            <div className="sky"/><div className="ground"/><div className="horizon-line"/>
            <div className="pitch-ladder">{[-30, -20, -10, 10, 20, 30].map(level => <div key={level} className={`pitch-rung ${Math.abs(level) === 10 ? 'short' : ''}`} style={{ top: `calc(50% - ${level * 2.4}px)` }}><span>{Math.abs(level)}</span><i/><span>{Math.abs(level)}</span></div>)}</div>
          </div>
          <div className="bank-arc"><div className="bank-tick bank-0"/><div className="bank-tick bank-l1"/><div className="bank-tick bank-l2"/><div className="bank-tick bank-r1"/><div className="bank-tick bank-r2"/></div>
          <div className="bank-pointer" style={{ transform: `translateX(-50%) rotate(${Math.max(-80, Math.min(80, roll))}deg)` }}><span/></div>
          <div className="aircraft-reference"><span className="left-wing"/><span className="center-dot"/><span className="right-wing"/></div>
          <span className="horizon-vignette"/>
        </>}
        {!hasAttitude && <div className="pfd-no-data"><Icon name="horizon" size={28}/><strong>ATTITUDE UNAVAILABLE</strong><span>Waiting for validated sensor data</span></div>}
        {hasAttitude && (status === 'STALE' || status === 'LOST') && <div className="pfd-stale-label">LAST RECEIVED · {status === 'LOST' ? 'TELEMETRY LOST' : 'STALE'}</div>}
        <div className="horizon-bottom"><span>ROLL {signed(roll)}°</span><span>PITCH {signed(pitch)}°</span></div>
      </div>
      <div className="pfd-side pfd-alt"><span className="instrument-label">BARO ALTITUDE</span><div className="pfd-tape"><span>METERS</span><strong>{num(snapshot?.navigation.barometricAltitude, 1)}</strong></div><div className="vsi-block"><span>VERTICAL SPEED</span><strong>{signed(snapshot?.environment.verticalSpeed)} <small>m/s</small></strong></div></div>
    </div>
    <div className="pfd-heading"><span className="instrument-label">MAGNETIC HEADING</span><div className="heading-track"><div className="heading-marks">{headingMarks.map(({ offset, value }) => <div key={offset} className={offset === 0 ? 'major' : ''}><i/>{value % 30 === 0 ? value.toString().padStart(3, '0') : '·'}</div>)}</div><div className="heading-indicator">{bearing(heading)}</div></div></div>
    <div className="pfd-footer"><span><i className={snapshot?.navigation.gpsFix && (status === 'LIVE' || status === 'SIMULATION') ? 'dot good' : 'dot warn'}/> GPS {status === 'STALE' || status === 'LOST' ? 'LAST KNOWN' : !snapshot ? 'UNKNOWN' : snapshot.navigation.gpsFix ? 'FIX' : 'NO FIX'}</span><span>MODE <b>{snapshot?.system.flightMode ?? '—'}</b></span><span>IMU / MPU9250</span></div>
  </div>
}

function Sparkline({ values, color = '#6bbcd4', height = 54 }: { values: (number | null | undefined)[]; color?: string; height?: number }) {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (valid.length < 2) return <div className="chart-empty">Awaiting samples</div>
  const lo = Math.min(...valid), hi = Math.max(...valid), span = Math.max(hi - lo, 0.01)
  let path = ''
  let connected = false
  values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { connected = false; return } path += `${connected ? ' L' : ' M'} ${(i / Math.max(values.length - 1, 1)) * 100} ${height - 5 - ((v - lo) / span) * (height - 10)}`; connected = true })
  return <svg className="sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-label="Recent telemetry trend"><path d={path} stroke={color} strokeWidth="1.8" fill="none" vectorEffect="non-scaling-stroke"/></svg>
}

function PowerPanel({ snapshot, history }: { snapshot: AircraftTelemetry | null; history: AircraftTelemetry[] }) {
  const battery = snapshot?.power.batteryPercent
  const voltage = snapshot?.power.batteryVoltage
  const validVoltages = history.map(h => h.power.batteryVoltage).filter((v): v is number => v != null && Number.isFinite(v))
  return <Panel eyebrow="01 / POWER SYSTEM" title="Aircraft power" right={<Icon name="bolt" size={17}/>} className="power-panel">
    <div className="power-main"><div><span className="quiet-label">BATTERY VOLTAGE</span><div className="power-number">{num(voltage, 2)}<small> V</small></div></div><div className="battery-visual"><div className="battery-shell"><div style={{ width: `${Math.min(100, Math.max(0, battery ?? 0))}%` }} className={(battery ?? 100) < 22 ? 'low' : ''}/></div><strong>{num(battery, 0)}%</strong></div></div>
    <div className="voltage-chart"><div className="chart-meta"><span>VOLTAGE TREND</span><span>RECENT BUFFER</span></div><Sparkline values={history.slice(-100).map(h => h.power.batteryVoltage)} color={(battery ?? 100) < 22 ? '#e5a272' : '#91d0a9'}/></div>
    <div className="panel-foot"><span>MIN OBSERVED <b>{validVoltages.length ? `${Math.min(...validVoltages).toFixed(2)} V` : '—'}</b></span><span>ESTIMATED REMAINING <b>{num(battery, 0)}%</b></span></div>
    <p className="technical-note">Battery remaining is a voltage-based estimate. No current or capacity sensor is connected.</p>
  </Panel>
}

function HealthRow({ label, state, detail }: { label: string; state: 'good' | 'warn' | 'unknown'; detail: string }) {
  return <div className="health-row"><span><i className={`status-lamp ${state}`}/>{label}</span><strong className={state}>{detail}</strong></div>
}

function HealthPanel({ snapshot, status, ageMs }: { snapshot: AircraftTelemetry | null; status: string; ageMs: number | null }) {
  const online = status === 'LIVE' || status === 'SIMULATION'
  const aged = status === 'STALE' || status === 'LOST'
  const mag = snapshot?.sensors.magnetometer
  const magReady = mag?.state === 'online' && mag.calibrated === true
  return <Panel eyebrow="02 / SYSTEM INTEGRITY" title="Link & sensor health" right={<Icon name="radio" size={17}/>} className="health-panel">
    <div className="health-summary"><span className="quiet-label">LAST TELEMETRY</span><strong className={aged || status === 'OFFLINE' ? 'warn' : ''}>{ageText(ageMs)}</strong><span className="quiet-label">Uplink state / {status}</span></div>
    <div className="health-list">
      <HealthRow label="Nano ↔ ESP32 UART" state={!snapshot ? 'unknown' : aged ? 'warn' : snapshot.system.uartConnected ? 'good' : 'warn'} detail={!snapshot ? 'NO DATA' : aged ? 'LAST KNOWN' : snapshot.system.uartConnected ? 'CONNECTED' : 'LOST'}/>
      <HealthRow label="ESP32 telemetry" state={!snapshot ? 'unknown' : online && snapshot.system.telemetryConnected ? 'good' : 'warn'} detail={!snapshot ? 'NO DATA' : online && snapshot.system.telemetryConnected ? 'STREAMING' : 'UNAVAILABLE'}/>
      <HealthRow label="NEO-7 GPS" state={!snapshot ? 'unknown' : aged ? 'warn' : snapshot.navigation.gpsFix ? 'good' : 'warn'} detail={!snapshot ? 'NO DATA' : aged ? 'LAST KNOWN' : snapshot.navigation.gpsFix ? `${snapshot.navigation.satellites} SAT / FIX` : 'NO FIX'}/>
      <HealthRow label="MPU9250 / attitude" state={!snapshot ? 'unknown' : aged ? 'warn' : snapshot.attitude.roll != null && online ? 'good' : 'warn'} detail={!snapshot ? 'NO DATA' : aged ? 'LAST KNOWN' : snapshot.attitude.roll != null && online ? 'REPORTING' : 'UNAVAILABLE'}/>
      <HealthRow label="MPU9250 / magnetometer" state={!mag ? 'unknown' : aged ? 'warn' : magReady && online ? 'good' : 'warn'} detail={!mag ? 'NO DATA' : aged ? 'LAST KNOWN' : magReady && online ? 'CALIBRATED' : mag.calibrated === false ? 'CALIBRATION NEEDED' : 'UNAVAILABLE'}/>
    </div>
    <div className="health-bottom"><span>FAILSAFE</span><strong className={snapshot?.system.failsafe ? 'critical-text' : ''}>{!snapshot ? 'UNKNOWN' : aged ? 'LAST KNOWN' : snapshot.system.failsafe ? 'ENGAGED' : 'NOT ENGAGED'}</strong></div>
  </Panel>
}

function ControlPanel({ snapshot }: { snapshot: AircraftTelemetry | null }) {
  const surfaces = [
    ['THROTTLE', snapshot?.control.throttle, '%'],
    ['AILERON', snapshot?.control.aileron, '°'],
    ['ELEVATOR', snapshot?.control.elevator, '°'],
    ['RUDDER', snapshot?.control.rudder, '°'],
  ] as const
  return <Panel eyebrow="03 / NANO CONTROL STATE" title="Surface commands" right={<span className="mini-badge">COMMAND ONLY</span>} className="control-panel">
    <div className="aircraft-figure"><svg viewBox="0 0 360 185" role="img" aria-label="Fixed wing aircraft command diagram"><path className="aircraft-outline" d="M180 11 193 77 331 119 331 135 194 117 188 155 222 172 222 179 180 169 138 179 138 172 172 155 166 117 29 135 29 119 167 77Z"/><path className="aircraft-axis" d="M180 10v162M22 127h316"/><circle cx="180" cy="118" r="5"/><path className="surface-accent" d="m29 135 98-13m106 0 98 13M142 172l28-12m48 12-28-12"/></svg><span className="figure-label left">L AIL</span><span className="figure-label right">R AIL</span></div>
    <div className="surface-list">{surfaces.map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{label === 'THROTTLE' ? num(value, 0) : signed(value, 1)}<small>{value == null ? '' : unit}</small></strong></div>)}</div>
    <p className="technical-note">Values are commands reported by the Nano. Servo positions are not measured. Flight controls remain onboard.</p>
  </Panel>
}

function AlertList({ alerts, status, compact = false }: { alerts: FlightAlert[]; status: string; compact?: boolean }) {
  const entries = alerts.slice(0, compact ? 3 : 20)
  if (!entries.length) return <div className="empty-alert"><Icon name="alert" size={20}/><div><strong>{status === 'NO DATA' || status === 'OFFLINE' || status === 'STALE' || status === 'LOST' ? 'ALERT STATUS UNKNOWN' : 'NO ACTIVE ALERTS'}</strong><span>{status === 'NO DATA' || status === 'OFFLINE' ? 'No aircraft data received yet.' : status === 'STALE' || status === 'LOST' ? 'Alerts cannot be verified until telemetry resumes.' : 'New events will appear here.'}</span></div></div>
  return <div className="alert-list">{entries.map((entry, index) => {
    const a = entry as unknown as Record<string, unknown>
    const severity = String(a.severity ?? a.level ?? 'info').toLowerCase()
    const label = String(a.title ?? a.message ?? a.code ?? 'Telemetry alert')
    const message = a.title && a.message ? String(a.message) : ''
    const timestamp = typeof a.timestamp === 'number' ? new Date(a.timestamp).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) : '—'
    return <div className={`alert-item ${severity}`} key={String(a.id ?? `${index}-${label}`)}><div className="alert-indicator"/><div><strong>{label}</strong>{message && <span>{message}</span>}</div><time>{timestamp} UTC</time></div>
  })}</div>
}

function DataStrip({ snapshot, status }: { snapshot: AircraftTelemetry | null; status: string }) {
  return <div className="data-strip">
    <Metric label="BARO ALTITUDE" value={num(snapshot?.navigation.barometricAltitude, 1)} unit="m" hint="BMP180 / filtered"/>
    <Metric label="GROUND SPEED" value={num(snapshot?.navigation.groundSpeed, 1)} unit="km/h" hint="NEO-7 / GPS"/>
    <Metric label="MAG HEADING" value={bearing(snapshot?.sensors.magnetometer.state === 'online' && snapshot.sensors.magnetometer.calibrated === true ? snapshot.attitude.heading : null)} hint="MPU9250 / fused"/>
    <Metric label="VERTICAL SPEED" value={signed(snapshot?.environment.verticalSpeed, 1)} unit="m/s" hint="Barometric estimate"/>
    <Metric label="GPS ALTITUDE" value={num(snapshot?.navigation.gpsAltitude, 1)} unit="m" hint="Independent source"/>
    <Metric label="GPS QUALITY" value={snapshot ? status === 'STALE' || status === 'LOST' ? 'LAST KNOWN' : snapshot.navigation.gpsFix ? 'FIX' : 'NO FIX' : '—'} hint={snapshot ? `${snapshot.navigation.satellites} satellites · HDOP ${num(snapshot.navigation.hdop, 1)}` : 'Awaiting position'} accent={snapshot && (status === 'STALE' || status === 'LOST' || !snapshot.navigation.gpsFix) ? 'amber' : undefined}/>
  </div>
}

function Coordinates({ snapshot, history, status }: { snapshot: AircraftTelemetry | null; history: AircraftTelemetry[]; status: string }) {
  const [copied, setCopied] = useState(false)
  const fresh = status === 'LIVE' || status === 'SIMULATION'
  const sample = [snapshot, ...history.slice().reverse()].find(item => {
    const lat = item?.navigation.latitude, lon = item?.navigation.longitude
    return item != null && snapshot != null && item.aircraftId === snapshot.aircraftId && item.navigation.gpsFix &&
      lat != null && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      lon != null && Number.isFinite(lon) && Math.abs(lon) <= 180
  })
  const lat = sample?.navigation.latitude, lon = sample?.navigation.longitude
  const valid = lat != null && lon != null
  const current = valid && snapshot !== null && sample === snapshot && fresh &&
    Date.now() - snapshot.timestamp < 1_500 &&
    snapshot.navigation.gpsUpdatedAt != null && Date.now() - snapshot.navigation.gpsUpdatedAt < 1_500
  function copy() {
    if (lat == null || lon == null) return
    void navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }).catch(() => setCopied(false))
  }
  return <div className="coordinates"><div><span className="quiet-label">{!valid ? 'POSITION' : current ? 'CURRENT POSITION' : 'LAST KNOWN POSITION'}</span><strong>{valid ? `${lat.toFixed(6)}°, ${lon.toFixed(6)}°` : 'POSITION UNAVAILABLE'}</strong></div><button className="icon-button" aria-label="Copy displayed coordinates" title="Copy displayed coordinates" disabled={!valid} onClick={copy}><Icon name="copy" size={16}/></button>{copied && <span className="copied">COPIED</span>}</div>
}

function MapPanel({ snapshot, history, source, status, theme, large = false }: { snapshot: AircraftTelemetry | null; history: AircraftTelemetry[]; source: TelemetrySource; status: string; theme: Theme; large?: boolean }) {
  const fresh = status === 'LIVE' || status === 'SIMULATION'
  return <Panel eyebrow="NAVIGATION / NEO-7 GPS" title="Position & ground track" right={<span className="mini-badge">{!fresh && snapshot ? 'LAST KNOWN' : !snapshot ? 'GPS UNKNOWN' : snapshot.navigation.gpsFix ? `${snapshot.navigation.satellites} SAT / FIX` : 'NO GPS FIX'}</span>} className={`map-panel ${large ? 'large' : ''}`}>
    <div className="map-shell"><NavigationMap key={source} snapshot={snapshot} history={history} theme={theme} source={source}/></div>
    <Coordinates snapshot={snapshot} history={history} status={status}/>
    <div className="map-facts"><div><span>HOME DISTANCE</span><strong>{num(snapshot?.navigation.distanceHome, 1)} <small>m</small></strong></div><div><span>BEARING HOME</span><strong>{bearing(snapshot?.navigation.bearingHome)}</strong></div><div><span>COURSE OVER GROUND</span><strong>{bearing(snapshot?.navigation.course)}</strong></div></div>
  </Panel>
}

function TracePanel({ history }: { history: AircraftTelemetry[] }) {
  const last = history.at(-1)
  return <Panel eyebrow="RECENT TELEMETRY / MEMORY BUFFER" title="Live traces" right={<span className="mini-badge">{history.length} SAMPLES</span>} className="trace-panel"><div className="trace-grid">
    <div><div className="trace-title"><span>BARO ALTITUDE</span><strong>{num(last?.navigation.barometricAltitude)} m</strong></div><Sparkline values={history.slice(-120).map(h => h.navigation.barometricAltitude)}/></div>
    <div><div className="trace-title"><span>GROUND SPEED</span><strong>{num(last?.navigation.groundSpeed)} km/h</strong></div><Sparkline values={history.slice(-120).map(h => h.navigation.groundSpeed)} color="#c7b583"/></div>
    <div><div className="trace-title"><span>BATTERY VOLTAGE</span><strong>{num(last?.power.batteryVoltage, 2)} V</strong></div><Sparkline values={history.slice(-120).map(h => h.power.batteryVoltage)} color="#91d0a9"/></div>
  </div><p className="technical-note">Charts show samples in the current browser memory buffer. Persistent recording is not connected.</p></Panel>
}

function SimulationPanel({ scenario, running, setScenario, start, pause, reset }: { scenario: SimulationScenario; running: boolean; setScenario: (v: SimulationScenario) => void; start: () => void; pause: () => void; reset: () => void }) {
  return <Panel eyebrow="DEVELOPMENT / BUILT-IN" title="Simulation controls" right={<span className="mini-badge sim">SIM ONLY</span>} className="sim-panel">
    <p>Exercise instruments with generated aircraft data. Scenarios never issue commands to the aircraft.</p>
    <div className="scenario-grid">{SCENARIOS.map(item => <button key={item.key} className={scenario === item.key ? 'selected' : ''} onClick={() => setScenario(item.key)}><span>{item.code}</span><strong>{item.label}</strong></button>)}</div>
    <div className="sim-actions"><button className="button primary" onClick={running ? pause : start}><Icon name={running ? 'pause' : 'play'} size={15}/>{running ? 'PAUSE SIMULATION' : 'START SIMULATION'}</button><button className="button ghost" onClick={reset}><Icon name="reset" size={15}/>RESET</button></div>
  </Panel>
}

function EventPanel({ alerts, snapshot, durationSec }: { alerts: FlightAlert[]; snapshot: AircraftTelemetry | null; durationSec: number }) {
  const first = snapshot ? new Date(snapshot.timestamp).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) : '—'
  return <Panel eyebrow="SESSION / EVENT STREAM" title="Flight timeline" right={<Icon name="clock" size={17}/>} className="event-panel"><div className="timeline">
    <div className="timeline-row"><span className="timeline-marker current"/><div><strong>CURRENT STATE</strong><span>{snapshot ? `${snapshot.system.flightMode} · ${snapshot.system.failsafe ? 'FAILSAFE' : 'MONITORING'}` : 'Awaiting aircraft telemetry'}</span></div><time>{duration(durationSec)}</time></div>
    {alerts.slice(0, 3).map((entry, index) => { const a = entry as unknown as Record<string, unknown>; return <div className="timeline-row" key={String(a.id ?? index)}><span className="timeline-marker caution"/><div><strong>{String(a.title ?? a.message ?? a.code ?? 'Alert')}</strong><span>{String(a.severity ?? 'EVENT').toUpperCase()}</span></div><time>{typeof a.timestamp === 'number' ? new Date(a.timestamp).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) : '—'}</time></div> })}
    <div className="timeline-row"><span className="timeline-marker"/><div><strong>LAST SAMPLE</strong><span>{snapshot ? 'Telemetry packet received' : 'No packet available'}</span></div><time>{first}</time></div>
  </div></Panel>
}

export default function App() {
  const telemetry = useTelemetry()
  const { snapshot, source, status, ageMs, history, alerts, scenario, running, selectSource, setScenario, start, pause, reset, durationSec } = telemetry
  const [view, setView] = useState<View>(getView)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [utc, setUtc] = useState(new Date())
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme())
  const stateLabel = normalizedStatus(String(status), source, snapshot)
  const selectedView = NAV.find(item => item.key === view) ?? NAV[0]
  const sourceLabel = source === 'simulation' ? 'SIMULATION' : source === 'cloud' ? 'CLOUD' : source === 'direct' ? 'DIRECT' : 'OFFLINE'
  const mode = snapshot?.system.flightMode ?? '—'
  const latestAlerts = alerts.length

  useEffect(() => { const onHash = () => { setView(getView()); setSidebarOpen(false) }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash) }, [])
  useEffect(() => { const timer = window.setInterval(() => setUtc(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f7f8' : '#09121d') }, [theme])
  useEffect(() => { const preference = window.matchMedia?.('(prefers-color-scheme: light)'); if (!preference) return; const syncTheme = () => { if (!savedTheme()) setTheme(preference.matches ? 'light' : 'dark') }; preference.addEventListener('change', syncTheme); return () => preference.removeEventListener('change', syncTheme) }, [])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key.toLowerCase() === 'f') void toggleFullscreen(); if (event.key.toLowerCase() === 'm') window.location.hash = '/navigation'; if (event.key.toLowerCase() === 'a') window.location.hash = '/alerts'; if (event.key.toLowerCase() === 'l') window.location.hash = '/telemetry' }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])
  const liveValues = useMemo(() => history.slice(-120), [history])

  async function toggleFullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen() } catch { /* unsupported browser */ } }
  function toggleTheme() { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); try { window.localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* Theme remains available for this session. */ } }
  function exportBuffer() { const blob = new Blob([JSON.stringify({ source, exportedAt: new Date().toISOString(), limitation: 'Current in-memory telemetry buffer only; not a flight recording.', samples: history }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'fd-x1-telemetry-buffer.json'; link.click(); URL.revokeObjectURL(url) }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Icon name="plane" size={26}/></div><div><strong>FLIGHT<span>COMMAND</span></strong><small>CENTER / FD-X</small></div><button className="sidebar-close icon-button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><Icon name="close"/></button></div>
      <div className="sidebar-context"><div className="side-rule"/><span className="eyebrow">AIRCRAFT SELECTED</span><div className="aircraft-name"><span className="aircraft-monogram">01</span><div><strong>FD-X1</strong><small>{snapshot?.aircraftId ?? 'Fixed-wing platform'}</small></div><Icon name="chevron" size={14}/></div></div>
      <nav aria-label="Primary navigation">{NAV.map((item, i) => <div key={item.key}>{(i === 0 || NAV[i - 1].section !== item.section) && <div className="nav-section">{item.section}</div>}<a href={`#/${item.key}`} className={`nav-link ${view === item.key ? 'active' : ''}`} aria-current={view === item.key ? 'page' : undefined}><Icon name={item.icon} size={18}/><span>{item.label}</span>{item.key === 'alerts' && latestAlerts > 0 && <b>{latestAlerts}</b>}</a></div>)}</nav>
      <div className="sidebar-bottom"><div className="source-readout"><span className="eyebrow">TELEMETRY SOURCE</span><div><i className={`status-lamp ${stateLabel === 'SIMULATION' || stateLabel === 'LIVE' ? 'good' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : 'unknown'}`}/><strong>{sourceLabel}</strong><span>{stateLabel}</span></div></div><div className="sidebar-version"><span>FD-X COMMAND SYSTEM</span><b>v0.3.0 / PROTOTYPE</b></div></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)}/>}

    <div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Icon name="menu"/></button><div className="breadcrumb">OPERATIONS <span>/</span> <strong>{selectedView.label.toUpperCase()}</strong></div></div><div className="topbar-status"><div className={`global-state ${stateLabel.toLowerCase()}`}><i className="dot"/>{stateLabel === 'LOST' ? 'TELEMETRY LOST' : stateLabel}</div><div className="top-data"><span>MODE</span><b>{mode}</b></div><div className="top-data"><span>GPS</span><b>{snapshot ? stateLabel === 'STALE' || stateLabel === 'LOST' ? 'LAST KNOWN' : snapshot.navigation.gpsFix ? `${snapshot.navigation.satellites} SAT` : 'NO FIX' : '—'}</b></div><div className="top-data"><span>BATTERY</span><b>{num(snapshot?.power.batteryVoltage, 2)} V</b></div></div><div className="topbar-right"><div className="utc-clock"><span>UTC</span><strong>{utc.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false })}</strong></div><button className="icon-button theme-button" type="button" aria-label="Light theme" aria-pressed={theme === 'light'} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17}/></button><button className="icon-button fullscreen-button" aria-label="Toggle fullscreen" title="Fullscreen (F)" onClick={() => void toggleFullscreen()}><Icon name="expand" size={17}/></button><div className="operator" title="Local operator view">ET</div></div></header>

      <div className="content"><div className="page-title-row"><div><div className="overline"><span className="overline-line"/> FLIGHT NAVIGATION & MISSION INTELLIGENCE</div><h1>{view === 'command' ? 'Command Center' : selectedView.label}</h1><p>{view === 'command' ? 'A single view of aircraft attitude, navigation and systems.' : view === 'navigation' ? 'Position, ground track and GPS quality.' : view === 'instruments' ? 'Flight attitude and independent measurement sources.' : view === 'telemetry' ? 'Inspect packet freshness and recent local telemetry.' : view === 'sensors' ? 'Assess sensor availability and data integrity.' : view === 'alerts' ? 'Review active conditions and recent events.' : 'Inspect controller state and simulation behavior.'}</p></div><div className="session-clock"><span>SESSION ELAPSED</span><strong>{duration(durationSec)}</strong><small>{sourceLabel} / LOCAL SESSION</small></div></div>

      <div className={`source-banner ${source === 'simulation' ? 'sim' : ''}`}><div className="source-banner-left"><span className="banner-icon"><Icon name={source === 'simulation' ? 'horizon' : 'radio'} size={18}/></span><div><strong>{source === 'simulation' ? 'SIMULATION MODE' : source === 'cloud' ? 'CLOUD TELEMETRY UNAVAILABLE' : source === 'direct' ? 'DIRECT TELEMETRY UNAVAILABLE' : 'NO ACTIVE TELEMETRY SOURCE'}</strong><p>{source === 'simulation' ? `Generated aircraft data · ${SCENARIOS.find(s => s.key === scenario)?.label ?? 'Scenario'} · ${running ? 'Running' : 'Paused'}. No aircraft is connected.` : source === 'direct' ? 'Local ESP32 connection requires a configured secure transport and compatible network. No direct adapter is connected.' : source === 'cloud' ? 'Cloud endpoint and operator authentication are not configured. No aircraft data is being received.' : 'Select Simulation to explore the command deck without hardware.'}</p></div></div><span className="banner-code">{source === 'simulation' ? 'TRAINING / DEVELOPMENT' : 'CONNECTION REQUIRED'}</span></div>

      {(stateLabel === 'STALE' || stateLabel === 'LOST') && snapshot && <div className="stale-banner"><Icon name="alert" size={17}/><strong>{stateLabel === 'STALE' ? 'TELEMETRY STALE' : 'TELEMETRY LOST'}</strong><span>Holding last received values · Last packet {ageText(ageMs)}. Measurements may no longer describe the aircraft.</span></div>}

      {view === 'command' && <><div className="hero-grid"><PrimaryFlightDisplay snapshot={snapshot} status={stateLabel}/><MapPanel snapshot={snapshot} history={liveValues} source={source} status={stateLabel} theme={theme}/></div><DataStrip snapshot={snapshot} status={stateLabel}/><div className="lower-grid"><PowerPanel snapshot={snapshot} history={liveValues}/><HealthPanel snapshot={snapshot} status={stateLabel} ageMs={ageMs}/><ControlPanel snapshot={snapshot}/></div><div className="bottom-grid"><Panel eyebrow="04 / ACTIVE CONDITIONS" title="Alerts" right={<a href="#/alerts" className="text-link">VIEW ALL <Icon name="arrow" size={13}/></a>}><AlertList alerts={alerts} status={stateLabel} compact/></Panel><EventPanel alerts={alerts} snapshot={snapshot} durationSec={durationSec}/></div></>}

      {view === 'navigation' && <><div className="navigation-grid"><MapPanel snapshot={snapshot} history={liveValues} source={source} status={stateLabel} theme={theme} large/><Panel eyebrow="GPS / POSITION SOLUTION" title="Navigation detail"><div className="detail-list"><Metric label="LATITUDE" value={snapshot?.navigation.gpsFix ? num(snapshot.navigation.latitude, 6) : '—'} unit="°"/><Metric label="LONGITUDE" value={snapshot?.navigation.gpsFix ? num(snapshot.navigation.longitude, 6) : '—'} unit="°"/><Metric label="GPS ALTITUDE" value={num(snapshot?.navigation.gpsAltitude)} unit="m"/><Metric label="GROUND SPEED" value={num(snapshot?.navigation.groundSpeed)} unit="km/h"/><Metric label="HDOP" value={num(snapshot?.navigation.hdop)} hint="Reported when available"/><Metric label="SATELLITES" value={snapshot ? String(snapshot.navigation.satellites) : '—'}/></div><p className="technical-note">Home distance and bearing are shown only when a valid home position is available in telemetry. No waypoint control is exposed.</p></Panel></div><TracePanel history={liveValues}/></>}

      {view === 'instruments' && <><div className="instruments-grid"><PrimaryFlightDisplay snapshot={snapshot} status={stateLabel}/><div className="instrument-stack"><Panel eyebrow="ATTITUDE / MPU9250" title="Aircraft attitude" className="aircraft-attitude-panel"><AircraftAttitude roll={snapshot?.attitude.roll} pitch={snapshot?.attitude.pitch} heading={snapshot?.attitude.heading} imu={snapshot?.sensors.imu} magnetometer={snapshot?.sensors.magnetometer} status={stateLabel} source={source}/></Panel><Panel eyebrow="ALTIMETRY / INDEPENDENT SOURCES" title="Altitude & vertical motion"><div className="instrument-triplet"><Metric label="BARO ALT / BMP180" value={num(snapshot?.navigation.barometricAltitude)} unit="m"/><Metric label="GPS ALT / NEO-7" value={num(snapshot?.navigation.gpsAltitude)} unit="m"/><Metric label="VERTICAL SPEED" value={signed(snapshot?.environment.verticalSpeed)} unit="m/s"/></div></Panel><PowerPanel snapshot={snapshot} history={liveValues}/></div></div></>}

      {view === 'telemetry' && <><div className="systems-grid"><Panel eyebrow="SOURCE MANAGEMENT" title="Telemetry connections"><div className="source-options">{(['simulation', 'cloud', 'direct', 'offline'] as TelemetrySource[]).map(option => <button key={option} className={source === option ? 'selected' : ''} onClick={() => selectSource(option)}><i className={`status-lamp ${option === source && snapshot && (stateLabel === 'LIVE' || stateLabel === 'SIMULATION') ? 'good' : 'unknown'}`}/><span><strong>{option.toUpperCase()}</strong><small>{option === 'simulation' ? 'Generated local telemetry' : option === 'cloud' ? 'Awaiting secure backend setup' : option === 'direct' ? 'Awaiting secure LAN adapter' : 'Disconnect view'}</small></span>{source === option && <b>SELECTED</b>}</button>)}</div><p className="technical-note">Switching source never silently substitutes simulated readings for aircraft telemetry. Cloud and direct integrations require a configured adapter.</p></Panel><Panel eyebrow="SIGNAL INTEGRITY" title="Packet diagnostics"><div className="diagnostic-list"><HealthRow label="Last received packet" state={snapshot ? (stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : 'good') : 'unknown'} detail={ageText(ageMs)}/><HealthRow label="UART link" state={!snapshot ? 'unknown' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : snapshot.system.uartConnected ? 'good' : 'warn'} detail={!snapshot ? 'UNKNOWN' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'LAST KNOWN' : snapshot.system.uartConnected ? 'CONNECTED' : 'LOST'}/><HealthRow label="Packet sequence" state={snapshot ? (stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : 'good') : 'unknown'} detail={snapshot ? String(snapshot.system.packetSequence) : '—'}/><HealthRow label="Firmware packet age" state={snapshot ? (stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : 'good') : 'unknown'} detail={snapshot ? `${snapshot.system.packetAge} ms` : '—'}/><HealthRow label="Data source" state={snapshot ? (stateLabel === 'STALE' || stateLabel === 'LOST' ? 'warn' : 'good') : 'unknown'} detail={sourceLabel}/></div><p className="technical-note">Sequence gaps and invalid packet counters will appear when supplied by the gateway protocol.</p></Panel></div><TracePanel history={liveValues}/><Panel eyebrow="DATA OWNERSHIP" title="Current telemetry buffer" right={<button className="button ghost small" disabled={!history.length} onClick={exportBuffer}><Icon name="download" size={14}/> EXPORT JSON</button>}><p className="normal-copy">The browser holds {history.length} recent samples in memory. Export downloads only this visible session buffer. Database storage, full flight recording, and replay require the backend integration.</p></Panel></>}

      {view === 'sensors' && <><div className="systems-grid"><HealthPanel snapshot={snapshot} status={stateLabel} ageMs={ageMs}/><Panel eyebrow="SENSOR INVENTORY" title="Installed hardware"><div className="inventory-list"><div><Icon name="horizon"/><span><strong>MPU9250</strong><small>Attitude / fused roll, pitch, heading</small></span><b>{!snapshot ? 'UNKNOWN' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'STALE' : snapshot.attitude.roll != null ? 'DATA' : 'NO DATA'}</b></div><div><Icon name="pin"/><span><strong>NEO-7 GPS</strong><small>Position / ground speed / GPS altitude</small></span><b>{!snapshot ? 'UNKNOWN' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'STALE' : snapshot.navigation.gpsFix ? 'FIX' : 'NO FIX'}</b></div><div><Icon name="wave"/><span><strong>BMP180</strong><small>Pressure / barometric altitude / temperature</small></span><b>{!snapshot ? 'UNKNOWN' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'STALE' : snapshot.environment.pressure != null ? 'DATA' : 'NO DATA'}</b></div><div><Icon name="bolt"/><span><strong>Voltage sensor</strong><small>Aircraft battery / estimate</small></span><b>{!snapshot ? 'UNKNOWN' : stateLabel === 'STALE' || stateLabel === 'LOST' ? 'STALE' : snapshot.power.batteryVoltage != null ? 'DATA' : 'NO DATA'}</b></div></div></Panel></div><Panel eyebrow="RAW SENSOR MEASUREMENTS" title="Environment & motion"><div className="data-strip four"><Metric label="PRESSURE" value={num(snapshot?.environment.pressure)} unit="hPa"/><Metric label="TEMPERATURE" value={num(snapshot?.environment.temperature)} unit="°C"/><Metric label="GYRO X" value={signed(snapshot?.attitude.gyroX)} unit="°/s"/><Metric label="GYRO Y" value={signed(snapshot?.attitude.gyroY)} unit="°/s"/></div></Panel></>}

      {view === 'alerts' && <div className="systems-grid alerts-view"><Panel eyebrow="ACTIVE / OPERATOR ATTENTION" title="System alerts" right={<span className="mini-badge">{alerts.length} EVENTS</span>}><AlertList alerts={alerts} status={stateLabel}/><p className="technical-note">Alerts in this prototype are local to the current data source. Persistent acknowledgement and audit logs require the backend.</p></Panel><EventPanel alerts={alerts} snapshot={snapshot} durationSec={durationSec}/></div>}

      {view === 'engineering' && <div className="systems-grid engineering-grid"><SimulationPanel scenario={scenario} running={running} setScenario={(next) => { if (source !== 'simulation') selectSource('simulation'); setScenario(next) }} start={() => { if (source !== 'simulation') selectSource('simulation'); start() }} pause={pause} reset={reset}/><div className="engineering-side"><ControlPanel snapshot={snapshot}/><Panel eyebrow="ARCHITECTURE / FLIGHT SAFETY" title="Control boundary"><div className="architecture-flow"><div><strong>RC receiver</strong><span>Operator input</span></div><i/><div><strong>Arduino Nano</strong><span>Time critical control</span></div><i/><div><strong>ESP32</strong><span>Sensor + UART gateway</span></div><i/><div><strong>Command Center</strong><span>Monitoring interface</span></div></div><p className="technical-note">The browser has no active flight control path. Nano control and failsafe logic must operate independently of Wi-Fi, cloud services and this dashboard.</p></Panel></div></div>}

      {source === 'simulation' && view !== 'engineering' && <div className="simulation-dock"><div><span className="sim-dot"/><strong>SIMULATION</strong><span>{SCENARIOS.find(s => s.key === scenario)?.label ?? 'Normal flight'}</span></div><div><button onClick={running ? pause : start} aria-label={running ? 'Pause simulation' : 'Start simulation'}><Icon name={running ? 'pause' : 'play'} size={15}/>{running ? 'PAUSE' : 'START'}</button><a href="#/engineering">SCENARIOS <Icon name="arrow" size={13}/></a></div></div>}
      {source !== 'simulation' && <div className="simulation-dock inactive"><div><span className="sim-dot"/><strong>NO LIVE SOURCE</strong><span>Cloud and direct adapters are not configured</span></div><button onClick={() => { selectSource('simulation'); start() }}><Icon name="play" size={15}/>START SIMULATION</button></div>}
      <footer className="app-footer"><span>FLIGHT COMMAND CENTER / FD-X COMMAND SYSTEM</span><span>PROTOTYPE MONITORING INTERFACE · NOT A FLIGHT CONTROL SYSTEM</span><span>UTC {utc.getUTCFullYear()}</span></footer>
      </div>
    </div>
  </div>
}
