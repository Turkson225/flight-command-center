import { isCurrentSensor, shortestHeadingDelta, type AircraftTelemetry, type FlightAlert, type TelemetrySource } from './telemetry';

export type FlightEventKind = 'recording' | 'launch' | 'landing' | 'failsafe' | 'gps-loss' | 'battery' | 'telemetry' | 'geofence' | 'note';
export type FlightEventSeverity = 'info' | 'caution' | 'warning';

export interface FlightEvent {
  id: string;
  timestamp: number;
  kind: FlightEventKind;
  severity: FlightEventSeverity;
  label: string;
  detail: string;
  automatic: boolean;
}

export interface RecordedFlight {
  version: 1;
  id: string;
  name: string;
  aircraftId: string;
  source: TelemetrySource;
  startedAt: number;
  endedAt: number;
  samples: AircraftTelemetry[];
  events: FlightEvent[];
}

export interface AlertSettings {
  maxPitchDeg: number;
  maxRollDeg: number;
  minBatteryVoltage: number;
  minBatteryPercent: number;
  geofenceRadiusM: number;
  warnGpsLoss: boolean;
  warnTelemetryLoss: boolean;
  warnFailsafe: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  maxPitchDeg: 25,
  maxRollDeg: 45,
  minBatteryVoltage: 10.8,
  minBatteryPercent: 20,
  geofenceRadiusM: 500,
  warnGpsLoss: true,
  warnTelemetryLoss: true,
  warnFailsafe: true,
};

export interface FlightSummary {
  durationSec: number;
  maxAltitudeM: number | null;
  distanceM: number;
  maxSpeedKmh: number | null;
  maxAbsPitchDeg: number | null;
  maxAbsRollDeg: number | null;
  minVoltage: number | null;
  gpsFixPercent: number | null;
  minSatellites: number | null;
  maxHdop: number | null;
}

export interface ResponseAxis {
  key: 'elevator-pitch' | 'aileron-roll' | 'rudder-heading';
  command: string;
  response: string;
  correlation: number | null;
  lagMs: number | null;
  oscillationHz: number | null;
  rating: 'INSUFFICIENT' | 'WEAK' | 'SLOW' | 'OSCILLATORY' | 'COUPLED';
}

export interface PreflightCheck {
  id: string;
  label: string;
  detail: string;
  state: 'pass' | 'warn' | 'block';
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPosition(sample: AircraftTelemetry) {
  return sample.navigation.gpsFix && finite(sample.navigation.latitude) && finite(sample.navigation.longitude) &&
    Math.abs(sample.navigation.latitude) <= 90 && Math.abs(sample.navigation.longitude) <= 180;
}

function distanceBetween(a: AircraftTelemetry, b: AircraftTelemetry) {
  if (!validPosition(a) || !validPosition(b)) return 0;
  const lat1 = (a.navigation.latitude as number) * Math.PI / 180;
  const lat2 = (b.navigation.latitude as number) * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((b.navigation.longitude as number) - (a.navigation.longitude as number)) * Math.PI / 180;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function extrema(values: (number | null | undefined)[], mode: 'min' | 'max') {
  const valid = values.filter(finite);
  return valid.length ? (mode === 'min' ? Math.min(...valid) : Math.max(...valid)) : null;
}

export function computeFlightSummary(samples: AircraftTelemetry[]): FlightSummary {
  if (!samples.length) return {
    durationSec: 0, maxAltitudeM: null, distanceM: 0, maxSpeedKmh: null,
    maxAbsPitchDeg: null, maxAbsRollDeg: null, minVoltage: null, gpsFixPercent: null,
    minSatellites: null, maxHdop: null,
  };
  let distanceM = 0;
  for (let index = 1; index < samples.length; index += 1) distanceM += distanceBetween(samples[index - 1], samples[index]);
  const gpsSamples = samples.filter(sample => sample.navigation.gpsFix);
  const pitch = samples.map(sample => finite(sample.attitude.pitch) ? Math.abs(sample.attitude.pitch) : null);
  const roll = samples.map(sample => finite(sample.attitude.roll) ? Math.abs(sample.attitude.roll) : null);
  return {
    durationSec: Math.max(0, (samples.at(-1)!.timestamp - samples[0].timestamp) / 1000),
    maxAltitudeM: extrema(samples.map(sample => sample.navigation.barometricAltitude), 'max'),
    distanceM,
    maxSpeedKmh: extrema(samples.map(sample => sample.navigation.groundSpeed), 'max'),
    maxAbsPitchDeg: extrema(pitch, 'max'),
    maxAbsRollDeg: extrema(roll, 'max'),
    minVoltage: extrema(samples.map(sample => sample.power.batteryVoltage), 'min'),
    gpsFixPercent: samples.length ? gpsSamples.length / samples.length * 100 : null,
    minSatellites: gpsSamples.length ? extrema(gpsSamples.map(sample => sample.navigation.satellites), 'min') : null,
    maxHdop: extrema(gpsSamples.map(sample => sample.navigation.hdop), 'max'),
  };
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 8) return null;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA < 1e-9 || varianceB < 1e-9) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

function alignedCorrelation(command: (number | null)[], response: (number | null)[], shift: number) {
  const a: number[] = [];
  const b: number[] = [];
  for (let index = 0; index + shift < command.length; index += 1) {
    const commandValue = command[index];
    const responseValue = response[index + shift];
    if (finite(commandValue) && finite(responseValue)) {
      a.push(commandValue);
      b.push(responseValue);
    }
  }
  return correlation(a, b);
}

function responseAxis(
  key: ResponseAxis['key'],
  commandLabel: string,
  responseLabel: string,
  command: (number | null)[],
  response: (number | null)[],
  medianPeriodMs: number,
): ResponseAxis {
  let best: number | null = null;
  let bestShift = 0;
  const maxShift = Math.min(12, Math.floor(command.length / 4));
  for (let shift = 0; shift <= maxShift; shift += 1) {
    const value = alignedCorrelation(command, response, shift);
    if (value !== null && (best === null || Math.abs(value) > Math.abs(best))) {
      best = value;
      bestShift = shift;
    }
  }
  const lagMs = best === null ? null : Math.round(bestShift * medianPeriodMs);
  const validResponse = response.filter(finite);
  const mean = validResponse.length ? validResponse.reduce((sum, value) => sum + value, 0) / validResponse.length : 0;
  const amplitude = validResponse.length ? Math.max(...validResponse) - Math.min(...validResponse) : 0;
  const deadband = Math.max(amplitude * .04, .05);
  let priorSign = 0;
  let crossings = 0;
  validResponse.forEach(value => {
    const centered = value - mean;
    const sign = centered > deadband ? 1 : centered < -deadband ? -1 : 0;
    if (sign && priorSign && sign !== priorSign) crossings += 1;
    if (sign) priorSign = sign;
  });
  const durationSec = Math.max(0, (response.length - 1) * medianPeriodMs / 1000);
  const oscillationHz = validResponse.length < 12 || durationSec <= 0 ? null : crossings / 2 / durationSec;
  const rating = best === null ? 'INSUFFICIENT' : finite(oscillationHz) && oscillationHz > 1 ? 'OSCILLATORY' : Math.abs(best) < .3 ? 'WEAK' : (lagMs ?? 0) > 800 ? 'SLOW' : 'COUPLED';
  return { key, command: commandLabel, response: responseLabel, correlation: best, lagMs, oscillationHz, rating };
}

export function analyzeControlResponse(samples: AircraftTelemetry[]): ResponseAxis[] {
  const periods = samples.slice(1).map((sample, index) => sample.timestamp - samples[index].timestamp).filter(value => value > 0 && value < 5_000).sort((a, b) => a - b);
  const medianPeriodMs = periods.length ? periods[Math.floor(periods.length / 2)] : 200;
  const headingRate = samples.map((sample, index) => {
    if (index === 0 || !finite(sample.attitude.heading) || !finite(samples[index - 1].attitude.heading)) return null;
    const seconds = (sample.timestamp - samples[index - 1].timestamp) / 1000;
    return seconds > 0 ? shortestHeadingDelta(samples[index - 1].attitude.heading as number, sample.attitude.heading as number) / seconds : null;
  });
  return [
    responseAxis('elevator-pitch', 'Elevator command', 'Pitch angle', samples.map(sample => sample.control.elevator), samples.map(sample => sample.attitude.pitch), medianPeriodMs),
    responseAxis('aileron-roll', 'Aileron command', 'Roll angle', samples.map(sample => sample.control.aileron), samples.map(sample => sample.attitude.roll), medianPeriodMs),
    responseAxis('rudder-heading', 'Rudder command', 'Heading rate', samples.map(sample => sample.control.rudder), headingRate, medianPeriodMs),
  ];
}

function makeAlert(type: string, message: string, severity: FlightAlert['severity'], timestamp: number): FlightAlert {
  return { id: `RULE-${type}`, type, message, severity, timestamp, source: 'LOCAL RULE', acknowledged: false, resolved: false, duration: null };
}

export function evaluateConfiguredAlerts(snapshot: AircraftTelemetry | null, status: string, settings: AlertSettings): FlightAlert[] {
  const timestamp = snapshot?.timestamp ?? Date.now();
  const alerts: FlightAlert[] = [];
  if (settings.warnTelemetryLoss && /lost|offline/i.test(status)) alerts.push(makeAlert('TELEMETRY_LOST', 'Telemetry is unavailable; displayed values may not describe the aircraft.', 'warning', timestamp));
  else if (settings.warnTelemetryLoss && /stale|reconnect/i.test(status)) alerts.push(makeAlert('TELEMETRY_STALE', 'No current telemetry packet has arrived.', 'caution', timestamp));
  if (!snapshot) return alerts;
  if (finite(snapshot.attitude.pitch) && Math.abs(snapshot.attitude.pitch) > settings.maxPitchDeg) alerts.push(makeAlert('PITCH_LIMIT', `Pitch exceeded the configured ${settings.maxPitchDeg.toFixed(0)}° envelope.`, 'warning', timestamp));
  if (finite(snapshot.attitude.roll) && Math.abs(snapshot.attitude.roll) > settings.maxRollDeg) alerts.push(makeAlert('BANK_LIMIT', `Bank exceeded the configured ${settings.maxRollDeg.toFixed(0)}° envelope.`, 'warning', timestamp));
  if ((finite(snapshot.power.batteryVoltage) && snapshot.power.batteryVoltage < settings.minBatteryVoltage) || (finite(snapshot.power.batteryPercent) && snapshot.power.batteryPercent < settings.minBatteryPercent)) alerts.push(makeAlert('LOW_BATTERY', `Battery is below the configured ${settings.minBatteryVoltage.toFixed(1)} V / ${settings.minBatteryPercent}% warning.`, 'caution', timestamp));
  if (settings.warnGpsLoss && !snapshot.navigation.gpsFix) alerts.push(makeAlert('GPS_LOST', 'Current GPS fix is unavailable.', 'warning', timestamp));
  if (settings.warnFailsafe && snapshot.system.failsafe) alerts.push(makeAlert('FAILSAFE', 'Aircraft reports failsafe engaged.', 'warning', timestamp));
  if (finite(snapshot.navigation.distanceHome) && snapshot.navigation.distanceHome > settings.geofenceRadiusM) alerts.push(makeAlert('GEOFENCE', `Aircraft is outside the ${settings.geofenceRadiusM.toFixed(0)} m advisory geofence.`, 'warning', timestamp));
  return alerts;
}

export function createAutomaticEvents(
  previous: AircraftTelemetry | null,
  current: AircraftTelemetry,
  newAlerts: FlightAlert[],
): FlightEvent[] {
  const events: FlightEvent[] = createAlertEvents(newAlerts, current.timestamp);
  const priorSpeed = previous?.navigation.groundSpeed;
  const speed = current.navigation.groundSpeed;
  if (finite(speed) && speed >= 12 && (!finite(priorSpeed) || priorSpeed < 8)) events.push({ id: `launch-${current.timestamp}`, timestamp: current.timestamp, kind: 'launch', severity: 'info', label: 'LAUNCH DETECTED', detail: 'Ground speed crossed 12 km/h.', automatic: true });
  if (finite(speed) && speed < 5 && finite(priorSpeed) && priorSpeed >= 8) events.push({ id: `landing-${current.timestamp}`, timestamp: current.timestamp, kind: 'landing', severity: 'info', label: 'LANDING DETECTED', detail: 'Ground speed fell below 5 km/h.', automatic: true });
  return events;
}

export function createAlertEvents(alerts: FlightAlert[], timestamp: number): FlightEvent[] {
  return alerts.map(alert => ({
    id: `${alert.type}-${timestamp}`,
    timestamp,
    kind: alert.type === 'FAILSAFE' ? 'failsafe' : alert.type === 'GPS_LOST' ? 'gps-loss' : alert.type === 'LOW_BATTERY' ? 'battery' : alert.type === 'GEOFENCE' ? 'geofence' : 'telemetry',
    severity: alert.severity === 'advisory' ? 'info' : alert.severity,
    label: alert.type.replaceAll('_', ' '),
    detail: alert.message,
    automatic: true,
  }));
}

export function buildPreflightChecks(snapshot: AircraftTelemetry | null, status: string, settings: AlertSettings): PreflightCheck[] {
  if (!snapshot) return [
    { id: 'telemetry', label: 'Telemetry link', detail: 'No aircraft sample received', state: 'block' },
    { id: 'aircraft', label: 'Aircraft checks', detail: 'Unavailable until telemetry arrives', state: 'block' },
  ];
  const live = status === 'LIVE' || status === 'SIMULATION';
  const imu = isCurrentSensor(snapshot.sensors.imu, snapshot.timestamp, true);
  const mag = isCurrentSensor(snapshot.sensors.magnetometer, snapshot.timestamp, true);
  const gps = snapshot.navigation.gpsFix && snapshot.navigation.satellites >= 6 && (!finite(snapshot.navigation.hdop) || snapshot.navigation.hdop <= 2.5);
  const battery = (!finite(snapshot.power.batteryVoltage) || snapshot.power.batteryVoltage >= settings.minBatteryVoltage) && (!finite(snapshot.power.batteryPercent) || snapshot.power.batteryPercent >= settings.minBatteryPercent);
  const controls = [snapshot.control.aileron, snapshot.control.elevator, snapshot.control.rudder].every(value => !finite(value) || Math.abs(value) <= 10) && (!finite(snapshot.control.throttle) || snapshot.control.throttle <= 10);
  return [
    { id: 'telemetry', label: 'Telemetry freshness', detail: live ? 'Current packets received' : `State: ${status}`, state: live ? 'pass' : 'block' },
    { id: 'imu', label: 'IMU calibration', detail: imu ? 'MPU9250 attitude current' : 'Current calibrated IMU required', state: imu ? 'pass' : 'block' },
    { id: 'mag', label: 'Magnetometer', detail: mag ? 'Heading sensor current' : 'Calibration or current data required', state: mag ? 'pass' : 'warn' },
    { id: 'gps', label: 'GPS solution', detail: gps ? `${snapshot.navigation.satellites} satellites · HDOP ${finite(snapshot.navigation.hdop) ? snapshot.navigation.hdop.toFixed(1) : '—'}` : 'Fix with at least 6 satellites recommended', state: gps ? 'pass' : 'block' },
    { id: 'uart', label: 'Nano ↔ gateway UART', detail: snapshot.system.uartConnected ? `${snapshot.system.uartPacketRate ?? '—'} packets/s` : 'UART link unavailable', state: snapshot.system.uartConnected ? 'pass' : 'block' },
    { id: 'rc', label: 'Manual RC link', detail: snapshot.system.rcConnected ? 'Receiver link reported' : 'RC link unavailable', state: snapshot.system.rcConnected ? 'pass' : 'block' },
    { id: 'battery', label: 'Battery reserve', detail: `${finite(snapshot.power.batteryVoltage) ? snapshot.power.batteryVoltage.toFixed(2) : '—'} V · ${finite(snapshot.power.batteryPercent) ? snapshot.power.batteryPercent.toFixed(0) : '—'}% estimated`, state: battery ? 'pass' : 'block' },
    { id: 'neutral', label: 'Control neutral', detail: controls ? 'Throttle low and surfaces centered' : 'Move throttle low and center all surfaces', state: controls ? 'pass' : 'warn' },
  ];
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function flightToCsv(flight: RecordedFlight): string {
  const headers = ['timestamp_iso', 'elapsed_s', 'aircraft_id', 'latitude', 'longitude', 'gps_altitude_m', 'baro_altitude_m', 'ground_speed_kmh', 'course_deg', 'satellites', 'hdop', 'gps_fix', 'roll_deg', 'pitch_deg', 'heading_deg', 'pitch_rate_dps', 'roll_rate_dps', 'yaw_rate_dps', 'battery_v', 'battery_percent_est', 'throttle_cmd', 'aileron_cmd', 'elevator_cmd', 'rudder_cmd', 'flight_mode', 'failsafe', 'rc_connected', 'uart_connected'];
  const rows = flight.samples.map(sample => [
    new Date(sample.timestamp).toISOString(), (sample.timestamp - flight.startedAt) / 1000, sample.aircraftId,
    sample.navigation.latitude, sample.navigation.longitude, sample.navigation.gpsAltitude, sample.navigation.barometricAltitude,
    sample.navigation.groundSpeed, sample.navigation.course, sample.navigation.satellites, sample.navigation.hdop, sample.navigation.gpsFix,
    sample.attitude.roll, sample.attitude.pitch, sample.attitude.heading, sample.attitude.gyroY, sample.attitude.gyroX, sample.attitude.gyroZ,
    sample.power.batteryVoltage, sample.power.batteryPercent, sample.control.throttle, sample.control.aileron,
    sample.control.elevator, sample.control.rudder, sample.system.flightMode, sample.system.failsafe,
    sample.system.rcConnected, sample.system.uartConnected,
  ].map(csvCell).join(','));
  return [headers.join(','), ...rows].join('\n');
}
