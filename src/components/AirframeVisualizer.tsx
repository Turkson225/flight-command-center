import { isCurrentSensor, type AircraftTelemetry } from '../core/telemetry'
import './airframe-visualizer.css'

export interface AirframeVisualizerProps {
  snapshot: AircraftTelemetry | null
  status: string
  compact?: boolean
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function signed(value: number | null | undefined, digits = 1) {
  return finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}°` : '—'
}

function heading(value: number | null | undefined) {
  if (!finite(value)) return '—'
  return `${Math.round(((value % 360) + 360) % 360).toString().padStart(3, '0')}°`
}

function SurfaceBar({ label, value, range = 25 }: { label: string; value: number | null | undefined; range?: number }) {
  const valid = finite(value)
  const percent = valid ? clamp(value / range, -1, 1) * 50 : 0
  return <div className={`airframe__surface-bar ${valid ? '' : 'is-missing'}`}>
    <div className="airframe__surface-label"><span>{label}</span><strong>{signed(value)}</strong></div>
    <div className="airframe__surface-track"><i/><b style={{ left: `calc(50% + ${percent}%)` }}/></div>
  </div>
}

const pitchMarks = [30, 20, 10, 0, -10, -20, -30]

export function AirframeVisualizer({ snapshot, status, compact = false }: AirframeVisualizerProps) {
  const attitudeReady = snapshot ? isCurrentSensor(snapshot.sensors.imu, snapshot.timestamp, true) : false
  const headingReady = snapshot ? isCurrentSensor(snapshot.sensors.magnetometer, snapshot.timestamp, true) : false
  const roll = attitudeReady ? snapshot?.attitude.roll : null
  const pitch = attitudeReady ? snapshot?.attitude.pitch : null
  const magneticHeading = headingReady ? snapshot?.attitude.heading : null
  const aileron = snapshot?.control.aileron
  const elevator = snapshot?.control.elevator
  const rudder = snapshot?.control.rudder
  const throttle = snapshot?.control.throttle
  const hasAttitude = finite(roll) && finite(pitch)
  const stale = /stale|lost|offline|reconnect/i.test(status)
  const visualRoll = hasAttitude ? clamp(roll, -55, 55) : 0
  const visualPitch = hasAttitude ? clamp(pitch, -35, 35) : 0
  const visualHeading = finite(magneticHeading) ? ((magneticHeading % 360) + 360) % 360 : 0
  const ail = finite(aileron) ? clamp(aileron, -25, 25) : 0
  const elev = finite(elevator) ? clamp(elevator, -25, 25) : 0
  const rud = finite(rudder) ? clamp(rudder, -25, 25) : 0
  const throttleLevel = finite(throttle) ? clamp(throttle, 0, 100) : 0
  const pitchDirection = !finite(pitch) ? 'NO PITCH DATA' : Math.abs(pitch) < 0.5 ? 'LEVEL' : pitch > 0 ? 'NOSE UP' : 'NOSE DOWN'
  const aria = hasAttitude
    ? `Aircraft model. Roll ${signed(roll)}, pitch ${signed(pitch)}, magnetic heading ${heading(magneticHeading)}. Aileron command ${signed(aileron)}, elevator command ${signed(elevator)}, rudder command ${signed(rudder)}.`
    : 'Aircraft attitude unavailable.'

  return <div className={`airframe ${compact ? 'airframe--compact' : ''} ${stale ? 'airframe--stale' : ''}`} role="img" aria-label={aria}>
    <div className="airframe__stage">
      <div className="airframe__orientation">
        <div className="airframe__grid"/>
        <svg className="airframe__compass" viewBox="0 0 300 300" aria-hidden="true">
          <circle cx="150" cy="150" r="129"/>
          <g style={{ transform: `rotate(${-visualHeading}deg)`, transformOrigin: '150px 150px' }}>
            {Array.from({ length: 24 }, (_, index) => <line key={index} x1="150" y1={index % 3 === 0 ? 17 : 23} x2="150" y2="31" transform={`rotate(${index * 15} 150 150)`}/>) }
            <text x="150" y="48" textAnchor="middle">N</text><text x="252" y="155" textAnchor="middle">E</text><text x="150" y="260" textAnchor="middle">S</text><text x="48" y="155" textAnchor="middle">W</text>
          </g>
        </svg>
        <span className="airframe__heading-index"/>
        <div className="airframe__shadow" style={{ transform: `translate(-50%, -50%) rotate(${visualRoll * .12}deg) scale(${1 - Math.abs(visualPitch) / 180})` }}/>
        <div className="airframe__model" style={{ transform: `translate(-50%, -50%) perspective(560px) rotateX(${-visualPitch * .9}deg) rotateY(${visualRoll * .85}deg)` }}>
          <svg viewBox="0 0 360 280" aria-hidden="true">
            <defs><linearGradient id="airframe-body" x1="0" y1="0" x2="1" y2="1"><stop stopColor="currentColor" stopOpacity=".96"/><stop offset="1" stopColor="currentColor" stopOpacity=".5"/></linearGradient></defs>
            <path className="airframe__wing" d="M169 104 42 143 30 169 166 144 194 144 330 169 318 143 191 104Z"/>
            <path className="airframe__tailplane" d="m173 204-69 26-10 21 81-20h10l81 20-10-21-69-26Z"/>
            <path className="airframe__fuselage" d="M180 16c-8 12-15 36-17 72l3 112 9 56h10l9-56 3-112c-2-36-9-60-17-72Z"/>
            <path className="airframe__canopy" d="M180 48c-6 13-9 31-9 52h18c0-21-3-39-9-52Z"/>
            <path className="airframe__fin" d="m180 176-2 63h15l-5-57Z"/>
            <path className="airframe__hinge" d="M45 155 146 137m69 0 100 18M111 238l57-17m24 0 57 17"/>
            <path className="airframe__surface airframe__surface--aileron-left" style={{ transform: `translateY(${ail * .34}px)` }} d="m39 157 105-19 3 13-115 21Z"/>
            <path className="airframe__surface airframe__surface--aileron-right" style={{ transform: `translateY(${-ail * .34}px)` }} d="m216 138 105 19 7 15-115-21Z"/>
            <path className="airframe__surface airframe__surface--elevator" style={{ transform: `translateY(${elev * .3}px)` }} d="m103 237 66-19 2 15-77 19m97-34 66 19 9 15-77-19Z"/>
            <path className="airframe__surface airframe__surface--rudder" style={{ transform: `rotate(${rud * .55}deg)`, transformOrigin: '184px 217px' }} d="m184 183 4 53h11l-9-55Z"/>
            <circle className="airframe__hub" cx="180" cy="126" r="7"/>
          </svg>
        </div>
        <div className="airframe__thrust" style={{ opacity: finite(throttle) ? .22 + throttleLevel / 130 : 0 }}><i/><i/><i/></div>
        {!hasAttitude && <div className="airframe__unavailable"><strong>ATTITUDE UNAVAILABLE</strong><span>Waiting for valid MPU9250 roll and pitch</span></div>}
        {stale && snapshot && <div className="airframe__stale-tag">LAST RECEIVED · {status}</div>}
        <div className="airframe__axis-label airframe__axis-label--roll">ROLL {signed(roll)}</div>
        <div className="airframe__axis-label airframe__axis-label--heading">HDG {heading(magneticHeading)}</div>
      </div>

      <div className="airframe__pitch" aria-label={`Pitch ${signed(pitch)} ${pitchDirection}`}>
        <div className="airframe__pitch-title">PITCH</div>
        <div className="airframe__pitch-window">
          <div className="airframe__pitch-scale" style={{ transform: `translateY(${visualPitch * 2.2}px)` }}>
            {pitchMarks.map(mark => <div key={mark} style={{ top: `calc(50% - ${mark * 2.2}px)` }}><span>{mark > 0 ? `+${mark}` : mark}</span><i/></div>)}
          </div>
          <span className="airframe__pitch-pointer"/>
        </div>
        <strong>{signed(pitch)}</strong>
        <span>{pitchDirection}</span>
      </div>
    </div>

    <div className="airframe__readouts">
      <SurfaceBar label="AILERON" value={aileron}/>
      <SurfaceBar label="ELEVATOR" value={elevator}/>
      <SurfaceBar label="RUDDER" value={rudder}/>
      <div className={`airframe__throttle-readout ${finite(throttle) ? '' : 'is-missing'}`}><span>THROTTLE COMMAND</span><div><i style={{ width: `${throttleLevel}%` }}/></div><strong>{finite(throttle) ? `${throttle.toFixed(0)}%` : '—'}</strong></div>
    </div>
    <p className="airframe__note">Animated surfaces show Nano commands, not measured servo positions.</p>
  </div>
}
