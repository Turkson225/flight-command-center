import { isCurrentSensor, type SensorHealth, type TelemetrySource } from '../core/telemetry'
import './aircraft-attitude.css'

export interface AircraftAttitudeProps {
  roll: number | null | undefined
  pitch: number | null | undefined
  /** Fused heading in degrees. The magnetometer is an input, not a yaw sensor on its own. */
  heading: number | null | undefined
  imu?: Pick<SensorHealth, 'state' | 'calibrated' | 'lastUpdate'> | null
  magnetometer?: Pick<SensorHealth, 'state' | 'calibrated' | 'lastUpdate'> | null
  sampleTimestamp: number | null
  /** Accepts both useTelemetry's lowercase status and the dashboard's display labels. */
  status: string
  source?: TelemetrySource
}

const bankMarks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]
const pitchMarks = [-30, -20, -10, 10, 20, 30]

function valid(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function signed(value: number | null | undefined): string {
  return valid(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}°` : '—'
}

function bearing(value: number | null | undefined): string {
  if (!valid(value)) return '—'
  return `${(Math.round(((value % 360) + 360) % 360) % 360).toString().padStart(3, '0')}°`
}

function magnetometerLabel(magnetometer: AircraftAttitudeProps['magnetometer']): string {
  if (!magnetometer) return 'MAG STATUS UNKNOWN'
  if (magnetometer.state === 'offline' || magnetometer.state === 'error') return 'MAG UNAVAILABLE'
  if (magnetometer.state === 'stale') return 'MAG STALE'
  if (magnetometer.state === 'calibrating') return 'MAG CALIBRATING'
  if (magnetometer.calibrated === false) return 'MAG NEEDS CALIBRATION'
  if (magnetometer.state === 'degraded') return 'MAG DEGRADED'
  return magnetometer.calibrated ? 'MAG CALIBRATED' : 'MAG CAL UNKNOWN'
}

export function AircraftAttitude({ roll, pitch, heading, imu, magnetometer, sampleTimestamp, status, source }: AircraftAttitudeProps) {
  const imuReady = isCurrentSensor(imu, sampleTimestamp, true)
  const magReady = isCurrentSensor(magnetometer, sampleTimestamp, true)
  const hasRollPitch = imuReady && valid(roll) && valid(pitch)
  const hasHeading = valid(heading) && magReady
  const displayHeading = hasHeading ? heading : null
  const state = status.toLowerCase()
  const stale = state.includes('stale') || state.includes('lost') || state.includes('offline') || state.includes('reconnect')
  const magLabel = stale && magnetometer ? 'MAG LAST RECEIVED' : magnetometer?.state === 'online' && magnetometer.calibrated === true && !magReady ? 'MAG UPDATE STALE' : magnetometerLabel(magnetometer)
  const imuLabel = !imu ? 'IMU STATUS UNKNOWN' : stale ? 'IMU LAST RECEIVED' : imu.state !== 'online' ? `IMU ${imu.state.toUpperCase()}` : imu.calibrated !== true ? 'IMU NEEDS CALIBRATION' : !imuReady ? 'IMU UPDATE STALE' : 'IMU CALIBRATED'
  const magGood = !stale && magReady
  const visualRoll = hasRollPitch ? Math.max(-85, Math.min(85, roll)) : 0
  const visualPitch = hasRollPitch ? Math.max(-45, Math.min(45, pitch)) : 0
  const normalizedHeading = hasHeading ? ((heading % 360) + 360) % 360 : 0
  const displayRoll = hasRollPitch ? roll : null
  const displayPitch = hasRollPitch ? pitch : null
  const description = `Aircraft attitude: roll ${signed(displayRoll)}, pitch ${signed(displayPitch)}, fused magnetic heading ${bearing(displayHeading)}. ${stale ? 'Last received values; telemetry is not current.' : hasRollPitch ? 'Attitude values available.' : 'Attitude unavailable.'} ${imuLabel.toLowerCase()}; ${magLabel.toLowerCase()}.`

  return <div className={`aircraft-attitude ${stale ? 'aircraft-attitude--stale' : ''}`} role="group" aria-label={description}>
    <div className="aircraft-attitude__visuals">
      <div className={`aircraft-attitude__horizon ${!hasRollPitch ? 'aircraft-attitude__horizon--missing' : ''}`} aria-hidden="true">
        {hasRollPitch && <>
          <div className="aircraft-attitude__landscape" style={{ transform: `rotate(${-visualRoll}deg) translateY(${visualPitch * 1.45}px)` }}>
            <div className="aircraft-attitude__sky" />
            <div className="aircraft-attitude__earth" />
            <div className="aircraft-attitude__horizon-line" />
            {pitchMarks.map(mark => <div className="aircraft-attitude__pitch-mark" key={mark} style={{ top: `calc(50% - ${mark * 1.45}px)` }}><span>{Math.abs(mark)}</span><i/><span>{Math.abs(mark)}</span></div>)}
          </div>
          <div className="aircraft-attitude__bank-arc">
            {bankMarks.map(mark => <i key={mark} className={mark % 30 === 0 ? 'major' : ''} style={{ transform: `rotate(${mark}deg)` }}/ >)}
          </div>
          <span className="aircraft-attitude__bank-pointer" style={{ transform: `translateX(-50%) rotate(${visualRoll}deg)` }}/>
          <svg className="aircraft-attitude__fixed-wing" viewBox="0 0 136 32" fill="none" aria-hidden="true">
            <path d="M5 14h43l13 6h14l13-6h43M48 14l6 7M88 14l-6 7M65 20v6h6v-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="68" cy="16" r="5" fill="#18303a" stroke="currentColor" strokeWidth="2"/>
          </svg>
        </>}
        {!hasRollPitch && <div className="aircraft-attitude__empty"><strong>ATTITUDE UNAVAILABLE</strong><span>Waiting for roll and pitch</span></div>}
        {stale && hasRollPitch && <span className="aircraft-attitude__stale-tag">LAST RECEIVED</span>}
        <span className="aircraft-attitude__axis aircraft-attitude__axis--left">ROLL</span>
        <span className="aircraft-attitude__axis aircraft-attitude__axis--right">PITCH</span>
      </div>
      <div className={`aircraft-attitude__compass ${!hasHeading ? 'aircraft-attitude__compass--missing' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 160 160" className="aircraft-attitude__compass-face">
          <circle cx="80" cy="80" r="73" className="aircraft-attitude__compass-outer"/>
          <circle cx="80" cy="80" r="63" className="aircraft-attitude__compass-inner"/>
          {hasHeading && <g style={{ transform: `rotate(${-normalizedHeading}deg)`, transformOrigin: '80px 80px' }} className="aircraft-attitude__compass-rose">
            {Array.from({ length: 36 }, (_, index) => <line key={index} x1="80" y1={index % 3 === 0 ? '13' : '17'} x2="80" y2="23" transform={`rotate(${index * 10} 80 80)`} className={index % 9 === 0 ? 'cardinal-tick' : ''}/>)}
            <text x="80" y="42" textAnchor="middle" className="north">N</text>
            <text x="118" y="85" textAnchor="middle">E</text>
            <text x="80" y="125" textAnchor="middle">S</text>
            <text x="42" y="85" textAnchor="middle">W</text>
          </g>}
          <path d="M80 0 74 12h12Z" className="aircraft-attitude__lubber"/>
        </svg>
        <div className="aircraft-attitude__heading-value"><strong>{bearing(displayHeading)}</strong><span>MAG HEADING</span></div>
      </div>
    </div>
    <div className="aircraft-attitude__readouts">
      <div><span>ROLL / BANK</span><strong>{signed(displayRoll)}</strong></div>
      <div><span>PITCH / NOSE</span><strong>{signed(displayPitch)}</strong></div>
      <div><span>MAG HEADING</span><strong>{bearing(displayHeading)}</strong></div>
    </div>
    <div className="aircraft-attitude__meta">
      <span className={imuReady && !stale ? 'aircraft-attitude__mag-ok' : 'aircraft-attitude__mag-warn'}><i/>{imuLabel}</span>
      <span className={magGood ? 'aircraft-attitude__mag-ok' : 'aircraft-attitude__mag-warn'}><i/>{magLabel}</span>
      <span>MPU9250 / ACCEL + GYRO + MAG{source === 'simulation' ? ' / SIMULATED' : ''}</span>
    </div>
  </div>
}
