import type { AircraftTelemetry } from '../core/telemetry'
import './telemetry-analysis.css'

export interface TelemetryAnalysisProps {
  history: AircraftTelemetry[]
  status: string
}

type Numeric = number | null | undefined

type SeriesStats = {
  count: number
  first: number | null
  last: number | null
  min: number | null
  max: number | null
  mean: number | null
  deviation: number | null
}

function finite(value: Numeric): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function seriesStats(values: Numeric[]): SeriesStats {
  const valid = values.filter(finite)
  if (!valid.length) return { count: 0, first: null, last: null, min: null, max: null, mean: null, deviation: null }
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
  const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length
  return { count: valid.length, first: valid[0], last: valid.at(-1)!, min: Math.min(...valid), max: Math.max(...valid), mean, deviation: Math.sqrt(variance) }
}

function fixed(value: Numeric, digits = 1, suffix = '') {
  return finite(value) ? `${value.toFixed(digits)}${suffix}` : '—'
}

function signed(value: Numeric, digits = 1, suffix = '') {
  return finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}` : '—'
}

function TrendChart({ values, color = 'var(--cyan)', zero = false, label }: { values: Numeric[]; color?: string; zero?: boolean; label: string }) {
  const valid = values.filter(finite)
  if (valid.length < 2) return <div className="analysis-chart analysis-chart--empty">Awaiting enough samples</div>
  let low = Math.min(...valid)
  let high = Math.max(...valid)
  if (zero) {
    const extent = Math.max(Math.abs(low), Math.abs(high), 1)
    low = -extent
    high = extent
  }
  const span = Math.max(high - low, .01)
  const width = 400
  const height = 104
  let path = ''
  let connected = false
  values.forEach((value, index) => {
    if (!finite(value)) { connected = false; return }
    const x = values.length <= 1 ? 0 : index / (values.length - 1) * width
    const y = height - 8 - ((value - low) / span) * (height - 16)
    path += `${connected ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`
    connected = true
  })
  const zeroY = height - 8 - ((0 - low) / span) * (height - 16)
  return <svg className="analysis-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id={`analysis-fill-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    {zero && zeroY >= 0 && zeroY <= height && <line className="analysis-chart__zero" x1="0" y1={zeroY} x2={width} y2={zeroY}/>} 
    <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
  </svg>
}

function SummaryMetric({ label, value, detail, tone = 'cyan' }: { label: string; value: string; detail: string; tone?: 'cyan' | 'green' | 'amber' }) {
  return <div className={`analysis-metric analysis-metric--${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function variationLabel(pitchDeviation: number | null, rollDeviation: number | null) {
  if (!finite(pitchDeviation) || !finite(rollDeviation)) return 'INSUFFICIENT DATA'
  const combined = Math.hypot(pitchDeviation, rollDeviation)
  if (combined < 2.5) return 'LOW VARIATION'
  if (combined < 6) return 'MODERATE VARIATION'
  return 'HIGH VARIATION'
}

export function TelemetryAnalysis({ history, status }: TelemetryAnalysisProps) {
  const samples = history.slice(-240)
  const pitch = samples.map(sample => sample.attitude.pitch)
  const roll = samples.map(sample => sample.attitude.roll)
  const altitude = samples.map(sample => sample.navigation.barometricAltitude)
  const voltage = samples.map(sample => sample.power.batteryVoltage)
  const verticalSpeed = samples.map(sample => sample.environment.verticalSpeed)
  const controls = samples.flatMap(sample => [sample.control.aileron, sample.control.elevator, sample.control.rudder]).filter(finite)
  const pitchStats = seriesStats(pitch)
  const rollStats = seriesStats(roll)
  const altitudeStats = seriesStats(altitude)
  const voltageStats = seriesStats(voltage)
  const verticalStats = seriesStats(verticalSpeed)
  const surfaceMean = controls.length ? controls.reduce((sum, value) => sum + Math.abs(value), 0) / controls.length : null
  const timeWindow = samples.length > 1 ? Math.max(0, samples.at(-1)!.timestamp - samples[0].timestamp) / 1000 : 0
  const sampleRate = timeWindow > 0 ? (samples.length - 1) / timeWindow : null
  const pitchRange = finite(pitchStats.min) && finite(pitchStats.max) ? pitchStats.max - pitchStats.min : null
  const rollRange = finite(rollStats.min) && finite(rollStats.max) ? rollStats.max - rollStats.min : null
  const altitudeDelta = finite(altitudeStats.first) && finite(altitudeStats.last) ? altitudeStats.last - altitudeStats.first : null
  const voltageDelta = finite(voltageStats.first) && finite(voltageStats.last) ? voltageStats.last - voltageStats.first : null
  const variation = variationLabel(pitchStats.deviation, rollStats.deviation)
  const stale = /stale|lost|offline|reconnect/i.test(status)

  return <div className={`telemetry-analysis ${stale ? 'telemetry-analysis--stale' : ''}`}>
    <div className="analysis-summary">
      <SummaryMetric label="ATTITUDE VARIATION" value={variation} detail={`σ pitch ${fixed(pitchStats.deviation, 2, '°')} · σ roll ${fixed(rollStats.deviation, 2, '°')}`} tone={variation === 'HIGH VARIATION' ? 'amber' : 'cyan'}/>
      <SummaryMetric label="PITCH ENVELOPE" value={fixed(pitchRange, 1, '°')} detail={`${signed(pitchStats.min, 1, '°')} to ${signed(pitchStats.max, 1, '°')}`}/>
      <SummaryMetric label="ALTITUDE CHANGE" value={signed(altitudeDelta, 1, ' m')} detail={`Mean vertical speed ${signed(verticalStats.mean, 2, ' m/s')}`} tone="green"/>
      <SummaryMetric label="BATTERY CHANGE" value={signed(voltageDelta, 2, ' V')} detail={`${fixed(voltageStats.first, 2, ' V')} → ${fixed(voltageStats.last, 2, ' V')}`} tone={finite(voltageDelta) && voltageDelta < -.25 ? 'amber' : 'green'}/>
      <SummaryMetric label="SURFACE ACTIVITY" value={fixed(surfaceMean, 1, '°')} detail="Mean absolute command · 3 axes"/>
      <SummaryMetric label="BUFFER QUALITY" value={`${samples.length} SAMPLES`} detail={`${fixed(timeWindow, 1, ' s')} window · ${fixed(sampleRate, 1, ' Hz')}`}/>
    </div>

    <div className="analysis-grid">
      <section className="analysis-card analysis-card--pitch">
        <header><div><span>ATTITUDE / PRIMARY</span><h3>Pitch history</h3></div><strong>{signed(pitchStats.last, 1, '°')}</strong></header>
        <TrendChart values={pitch} zero label="Recent pitch history"/>
        <footer><span>MIN <b>{signed(pitchStats.min, 1, '°')}</b></span><span>MEAN <b>{signed(pitchStats.mean, 1, '°')}</b></span><span>MAX <b>{signed(pitchStats.max, 1, '°')}</b></span></footer>
      </section>
      <section className="analysis-card">
        <header><div><span>ATTITUDE / LATERAL</span><h3>Roll history</h3></div><strong>{signed(rollStats.last, 1, '°')}</strong></header>
        <TrendChart values={roll} color="var(--amber)" zero label="Recent roll history"/>
        <footer><span>RANGE <b>{fixed(rollRange, 1, '°')}</b></span><span>σ <b>{fixed(rollStats.deviation, 2, '°')}</b></span></footer>
      </section>
      <section className="analysis-card">
        <header><div><span>VERTICAL PROFILE</span><h3>Barometric altitude</h3></div><strong>{fixed(altitudeStats.last, 1, ' m')}</strong></header>
        <TrendChart values={altitude} color="var(--green)" label="Recent barometric altitude history"/>
        <footer><span>CHANGE <b>{signed(altitudeDelta, 1, ' m')}</b></span><span>V/S <b>{signed(verticalStats.last, 1, ' m/s')}</b></span></footer>
      </section>
      <section className="analysis-card">
        <header><div><span>POWER PROFILE</span><h3>Battery voltage</h3></div><strong>{fixed(voltageStats.last, 2, ' V')}</strong></header>
        <TrendChart values={voltage} color="var(--green)" label="Recent battery voltage history"/>
        <footer><span>MIN <b>{fixed(voltageStats.min, 2, ' V')}</b></span><span>CHANGE <b>{signed(voltageDelta, 2, ' V')}</b></span></footer>
      </section>
    </div>
    <p className="analysis-disclaimer">Analysis covers only the current browser memory buffer. Variation is descriptive, not a flight-safety limit or aerodynamic stability assessment.{stale ? ` Values are held because telemetry is ${status.toLowerCase()}.` : ''}</p>
  </div>
}
