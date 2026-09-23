import { onValue, ref, type Database } from 'firebase/database';
import type { AircraftTelemetry, SensorHealth, SensorState } from './telemetry';

/**
 * The browser has read access to one small RTDB node. The gateway writes through
 * a trusted ingest endpoint, which validates the device payload and adds receivedAt.
 */
export const telemetryPath = (aircraftId: string): string => {
  // Firebase IDs cannot contain path separators. Keep this more restrictive than
  // the Firebase key rules so a config typo never broadens the subscription.
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(aircraftId)) {
    throw new Error('Invalid provisioned aircraft ID.');
  }
  return `aircraft/${aircraftId}/telemetry/latest`;
};

export type FirebaseTelemetryEvent =
  | { kind: 'sample'; sample: AircraftTelemetry; receivedAt: number }
  | { kind: 'status'; status: 'connecting' | 'empty' | 'invalid' | 'denied' | 'unavailable'; message: string };

export type FirebaseTelemetryParseResult =
  | { ok: true; sample: AircraftTelemetry; receivedAt: number }
  | { ok: false; reason: string };

type ObjectValue = Record<string, unknown>;

function object(value: unknown, name: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as ObjectValue;
}

function number(value: unknown, name: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number in range.`);
  }
  return value;
}

function nullableNumber(value: unknown, name: string, min = -Infinity, max = Infinity): number | null {
  // RTDB does not retain keys whose value is null. A missing nullable field is
  // therefore an unknown measurement, never a zero or a previous measurement.
  return value == null ? null : number(value, name, min, max);
}

function integer(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, name, min, max);
  if (!Number.isSafeInteger(result)) throw new Error(`${name} must be an integer.`);
  return result;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must be a nonempty string.`);
  }
  return value;
}

const sensorStates: SensorState[] = [
  'online', 'calibrating', 'degraded', 'stale', 'offline', 'error',
];

function sensor(value: unknown, name: string): SensorHealth {
  const item = object(value, name);
  const state = text(item.state, `${name}.state`, 20);
  if (!sensorStates.includes(state as SensorState)) throw new Error(`${name}.state is unknown.`);
  const calibrated = item.calibrated == null ? null : boolean(item.calibrated, `${name}.calibrated`);
  return {
    state: state as SensorState,
    lastUpdate: nullableNumber(item.lastUpdate, `${name}.lastUpdate`, 0, Number.MAX_SAFE_INTEGER),
    frequencyHz: nullableNumber(item.frequencyHz, `${name}.frequencyHz`, 0, 10_000),
    calibrated,
    errorCount: integer(item.errorCount, `${name}.errorCount`),
  };
}

/**
 * Parse untrusted cloud JSON. Full telemetry groups are required; optional sensor
 * measurements remain null if absent. No field is copied into the UI unvalidated.
 * Capture time stays separate from the trusted server receipt time.
 */
export function parseFirebaseTelemetryEnvelope(
  value: unknown,
  aircraftId: string,
): FirebaseTelemetryParseResult {
  try {
    telemetryPath(aircraftId);
    const envelope = object(value, 'telemetry');
    if (envelope.schemaVersion !== 1) throw new Error('Unsupported telemetry schema version.');
    const receivedAt = integer(envelope.receivedAt, 'receivedAt');
    const raw = object(envelope.sample, 'sample');
    const timestamp = integer(raw.timestamp, 'sample.timestamp');
    // Reject unsynchronized device clocks; browser freshness uses receivedAt,
    // while timestamp remains the actual capture time for export and history.
    if (timestamp > receivedAt + 60_000 || timestamp < receivedAt - 86_400_000) {
      throw new Error('Device capture time differs substantially from server receipt time.');
    }
    const actualId = text(raw.aircraftId, 'sample.aircraftId', 40);
    if (actualId !== aircraftId) throw new Error('Telemetry aircraft ID does not match this device.');

    const attitude = object(raw.attitude, 'sample.attitude');
    const navigation = object(raw.navigation, 'sample.navigation');
    const environment = object(raw.environment, 'sample.environment');
    const power = object(raw.power, 'sample.power');
    const control = object(raw.control, 'sample.control');
    const system = object(raw.system, 'sample.system');
    const sensors = object(raw.sensors, 'sample.sensors');

    const sample: AircraftTelemetry = {
      timestamp,
      aircraftId: actualId,
      attitude: {
        roll: nullableNumber(attitude.roll, 'attitude.roll', -180, 180),
        pitch: nullableNumber(attitude.pitch, 'attitude.pitch', -180, 180),
        heading: nullableNumber(attitude.heading, 'attitude.heading', 0, 360),
        gyroX: nullableNumber(attitude.gyroX, 'attitude.gyroX'),
        gyroY: nullableNumber(attitude.gyroY, 'attitude.gyroY'),
        gyroZ: nullableNumber(attitude.gyroZ, 'attitude.gyroZ'),
      },
      navigation: {
        latitude: nullableNumber(navigation.latitude, 'navigation.latitude', -90, 90),
        longitude: nullableNumber(navigation.longitude, 'navigation.longitude', -180, 180),
        gpsAltitude: nullableNumber(navigation.gpsAltitude, 'navigation.gpsAltitude'),
        barometricAltitude: nullableNumber(navigation.barometricAltitude, 'navigation.barometricAltitude'),
        groundSpeed: nullableNumber(navigation.groundSpeed, 'navigation.groundSpeed', 0),
        course: nullableNumber(navigation.course, 'navigation.course', 0, 360),
        satellites: integer(navigation.satellites, 'navigation.satellites', 0, 100),
        hdop: nullableNumber(navigation.hdop, 'navigation.hdop', 0),
        gpsFix: boolean(navigation.gpsFix, 'navigation.gpsFix'),
        distanceHome: nullableNumber(navigation.distanceHome, 'navigation.distanceHome', 0),
        bearingHome: nullableNumber(navigation.bearingHome, 'navigation.bearingHome', 0, 360),
        homeLatitude: nullableNumber(navigation.homeLatitude, 'navigation.homeLatitude', -90, 90),
        homeLongitude: nullableNumber(navigation.homeLongitude, 'navigation.homeLongitude', -180, 180),
        gpsUpdatedAt: nullableNumber(navigation.gpsUpdatedAt, 'navigation.gpsUpdatedAt', 0),
      },
      environment: {
        pressure: nullableNumber(environment.pressure, 'environment.pressure', 0),
        temperature: nullableNumber(environment.temperature, 'environment.temperature'),
        verticalSpeed: nullableNumber(environment.verticalSpeed, 'environment.verticalSpeed'),
      },
      power: {
        batteryVoltage: nullableNumber(power.batteryVoltage, 'power.batteryVoltage', 0),
        batteryPercent: nullableNumber(power.batteryPercent, 'power.batteryPercent', 0, 100),
        startVoltage: nullableNumber(power.startVoltage, 'power.startVoltage', 0),
        minimumVoltage: nullableNumber(power.minimumVoltage, 'power.minimumVoltage', 0),
      },
      control: {
        throttle: nullableNumber(control.throttle, 'control.throttle', 0, 100),
        aileron: nullableNumber(control.aileron, 'control.aileron'),
        elevator: nullableNumber(control.elevator, 'control.elevator'),
        rudder: nullableNumber(control.rudder, 'control.rudder'),
      },
      system: {
        uartConnected: boolean(system.uartConnected, 'system.uartConnected'),
        telemetryConnected: boolean(system.telemetryConnected, 'system.telemetryConnected'),
        gpsConnected: boolean(system.gpsConnected, 'system.gpsConnected'),
        rcConnected: boolean(system.rcConnected, 'system.rcConnected'),
        failsafe: boolean(system.failsafe, 'system.failsafe'),
        flightMode: text(system.flightMode, 'system.flightMode', 40),
        packetSequence: integer(system.packetSequence, 'system.packetSequence'),
        packetAge: number(system.packetAge, 'system.packetAge', 0),
        uptime: number(system.uptime, 'system.uptime', 0),
        uartPacketRate: nullableNumber(system.uartPacketRate, 'system.uartPacketRate', 0),
        sequenceGaps: integer(system.sequenceGaps, 'system.sequenceGaps'),
        invalidPackets: integer(system.invalidPackets, 'system.invalidPackets'),
        wifiRssi: nullableNumber(system.wifiRssi, 'system.wifiRssi', -150, 0),
        cloudConnected: boolean(system.cloudConnected, 'system.cloudConnected'),
      },
      sensors: {
        imu: sensor(sensors.imu, 'sensors.imu'),
        accelerometer: sensor(sensors.accelerometer, 'sensors.accelerometer'),
        gyroscope: sensor(sensors.gyroscope, 'sensors.gyroscope'),
        magnetometer: sensor(sensors.magnetometer, 'sensors.magnetometer'),
        barometer: sensor(sensors.barometer, 'sensors.barometer'),
        gps: sensor(sensors.gps, 'sensors.gps'),
        voltage: sensor(sensors.voltage, 'sensors.voltage'),
        uart: sensor(sensors.uart, 'sensors.uart'),
        nano: sensor(sensors.nano, 'sensors.nano'),
        esp32: sensor(sensors.esp32, 'sensors.esp32'),
      },
    };
    // Never position the aircraft using only half a GPS coordinate.
    if ((sample.navigation.latitude === null) !== (sample.navigation.longitude === null)) {
      throw new Error('GPS latitude and longitude must both be present or both absent.');
    }
    if (sample.navigation.gpsFix && sample.navigation.latitude === null) {
      throw new Error('A GPS fix must include a valid position.');
    }
    return { ok: true, sample, receivedAt };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Malformed telemetry.' };
  }
}

/** Subscribe only after Firebase Authentication has identified the owner. */
export function subscribeToFirebaseTelemetry(
  database: Database,
  aircraftId: string,
  onEvent: (event: FirebaseTelemetryEvent) => void,
): () => void {
  let active = true;
  const path = telemetryPath(aircraftId);
  onEvent({ kind: 'status', status: 'connecting', message: 'Connecting to Firebase telemetry.' });
  const unsubscribe = onValue(
    ref(database, path),
    snapshot => {
      if (!active) return;
      if (!snapshot.exists()) {
        onEvent({ kind: 'status', status: 'empty', message: 'No aircraft telemetry has been published.' });
        return;
      }
      const parsed = parseFirebaseTelemetryEnvelope(snapshot.val(), aircraftId);
      if (!parsed.ok) {
        onEvent({ kind: 'status', status: 'invalid', message: parsed.reason });
        return;
      }
      onEvent({ kind: 'sample', sample: parsed.sample, receivedAt: parsed.receivedAt });
    },
    error => {
      if (!active) return;
      const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
      const denied = code === 'PERMISSION_DENIED' || code === 'permission-denied';
      onEvent({
        kind: 'status',
        status: denied ? 'denied' : 'unavailable',
        message: denied ? 'Firebase denied access to this aircraft.' : 'Firebase telemetry is unavailable.',
      });
    },
  );
  return () => {
    active = false;
    unsubscribe();
  };
}
