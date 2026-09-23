/** All measurements use canonical metric units. Presentation converts units at the edge. */
export type TelemetrySource = 'cloud' | 'direct' | 'simulation' | 'offline';
export type TelemetryStatus = 'live' | 'simulation' | 'stale' | 'lost' | 'offline' | 'reconnecting';
export type SimulationScenario = 'normal' | 'gpsFailure' | 'lowBattery' | 'telemetryLoss' | 'failsafe';
export type SensorState = 'online' | 'calibrating' | 'degraded' | 'stale' | 'offline' | 'error';

export interface SensorHealth {
  state: SensorState;
  lastUpdate: number | null;
  frequencyHz: number | null;
  calibrated: boolean | null;
  errorCount: number;
}

export interface AircraftTelemetry {
  /** Unix time in milliseconds, from the source sample, not the render time. */
  timestamp: number;
  aircraftId: string;
  attitude: {
    roll: number | null;
    pitch: number | null;
    heading: number | null;
    gyroX: number | null;
    gyroY: number | null;
    gyroZ: number | null;
  };
  navigation: {
    latitude: number | null;
    longitude: number | null;
    gpsAltitude: number | null;
    barometricAltitude: number | null;
    /** GPS-derived ground speed in km/h. No airspeed sensor is installed. */
    groundSpeed: number | null;
    course: number | null;
    satellites: number;
    hdop: number | null;
    gpsFix: boolean;
    distanceHome: number | null;
    bearingHome: number | null;
    homeLatitude: number | null;
    homeLongitude: number | null;
    gpsUpdatedAt: number | null;
  };
  environment: {
    pressure: number | null;
    temperature: number | null;
    verticalSpeed: number | null;
  };
  power: {
    batteryVoltage: number | null;
    /** Approximate voltage-based percentage; always label "Estimated" in the UI. */
    batteryPercent: number | null;
    startVoltage: number | null;
    minimumVoltage: number | null;
  };
  control: {
    /** Commands only; these are not physical servo position measurements. */
    throttle: number | null;
    aileron: number | null;
    elevator: number | null;
    rudder: number | null;
  };
  system: {
    uartConnected: boolean;
    telemetryConnected: boolean;
    gpsConnected: boolean;
    rcConnected: boolean;
    failsafe: boolean;
    flightMode: string;
    packetSequence: number;
    packetAge: number;
    uptime: number;
    uartPacketRate: number | null;
    sequenceGaps: number;
    invalidPackets: number;
    wifiRssi: number | null;
    cloudConnected: boolean;
  };
  sensors: {
    imu: SensorHealth;
    accelerometer: SensorHealth;
    gyroscope: SensorHealth;
    magnetometer: SensorHealth;
    barometer: SensorHealth;
    gps: SensorHealth;
    voltage: SensorHealth;
    uart: SensorHealth;
    nano: SensorHealth;
    esp32: SensorHealth;
  };
}

export interface FlightAlert {
  id: string;
  severity: 'advisory' | 'caution' | 'warning';
  type: string;
  message: string;
  timestamp: number;
  source: string;
  acknowledged: boolean;
  resolved: boolean;
  duration: number | null;
}

/** Preserve each sample's origin, especially when the operator changes sources. */
export interface TelemetryState {
  snapshot: AircraftTelemetry | null;
  source: TelemetrySource;
  status: TelemetryStatus;
  ageMs: number | null;
  history: AircraftTelemetry[];
  alerts: FlightAlert[];
  scenario: SimulationScenario;
  running: boolean;
  durationSec: number;
}

export const SIMULATION_RATE_HZ = 5;
export const HISTORY_WINDOW_MS = 5 * 60 * 1000;
export const MAX_HISTORY_SAMPLES = SIMULATION_RATE_HZ * 5 * 60;
export const STALE_AFTER_MS = 1_500;
export const LOST_AFTER_MS = 5_000;

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Signed shortest turn, so 359° → 1° interpolates +2° rather than -358°. */
export function shortestHeadingDelta(from: number, to: number): number {
  return ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180;
}

export function getTelemetryStatus(
  source: TelemetrySource,
  sample: AircraftTelemetry | null,
  now: number,
  running = true,
): TelemetryStatus {
  if (source === 'offline' || !sample) return 'offline';
  const age = Math.max(0, now - sample.timestamp);
  if (age >= LOST_AFTER_MS) return 'lost';
  if (!running || age >= STALE_AFTER_MS) return 'stale';
  return source === 'simulation' ? 'simulation' : 'live';
}
