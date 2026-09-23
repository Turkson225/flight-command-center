import {
  normalizeHeading,
  type AircraftTelemetry,
  type SensorHealth,
  type SimulationScenario,
} from './telemetry';

const HOME_LATITUDE = 5.60372;
const HOME_LONGITUDE = -0.18696;
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance and initial bearing from an aircraft to its stored HOME. */
export function navigationToHome(
  latitude: number,
  longitude: number,
  homeLatitude: number,
  homeLongitude: number,
): { distanceMeters: number; bearingDegrees: number | null } {
  const lat1 = latitude * Math.PI / 180;
  const lat2 = homeLatitude * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = (homeLongitude - longitude) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const distanceMeters = EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  if (distanceMeters < 0.01) return { distanceMeters: 0, bearingDegrees: null };
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return { distanceMeters, bearingDegrees: normalizeHeading(Math.atan2(y, x) * 180 / Math.PI) };
}

function round(value: number, places = 2): number {
  return Number(value.toFixed(places));
}

function health(timestamp: number, frequencyHz: number, calibrated: boolean | null = true): SensorHealth {
  return { state: 'online', lastUpdate: timestamp, frequencyHz, calibrated, errorCount: 0 };
}

/** A deterministic test flight. All data returned by this module is simulated. */
export function createSimulationSnapshot(
  elapsedSec: number,
  timestamp: number,
  scenario: SimulationScenario = 'normal',
  previous: AircraftTelemetry | null = null,
): AircraftTelemetry {
  const gpsFailure = scenario === 'gpsFailure';
  const lowBattery = scenario === 'lowBattery';
  const failsafe = scenario === 'failsafe';
  const heading = normalizeHeading(284 + 9 * Math.sin(elapsedSec / 32));
  const roll = round(8.5 * Math.sin(elapsedSec / 12) + 2 * Math.sin(elapsedSec / 4));
  const pitch = round(2.2 + 3.7 * Math.sin(elapsedSec / 18));
  const baroAltitude = 124.5 + 16 * Math.sin(elapsedSec / 48);
  const groundSpeed = 72.4 + 6 * Math.sin(elapsedSec / 27);
  const distance = Math.max(0, elapsedSec) * (groundSpeed / 3.6);
  const latitude = HOME_LATITUDE + (distance * Math.cos(heading * Math.PI / 180) / EARTH_RADIUS_M) * (180 / Math.PI);
  const longitude = HOME_LONGITUDE + (distance * Math.sin(heading * Math.PI / 180) / (EARTH_RADIUS_M * Math.cos(HOME_LATITUDE * Math.PI / 180))) * (180 / Math.PI);
  const homeVector = navigationToHome(latitude, longitude, HOME_LATITUDE, HOME_LONGITUDE);
  const batteryVoltage = lowBattery
    ? 10.56 - Math.min(0.18, elapsedSec / 2_400)
    : 12.42 - Math.min(1.3, elapsedSec / 2_400 * 1.3);
  const estimatedBattery = Math.max(0, Math.min(100, (batteryVoltage - 9.9) / 2.7 * 100));
  const minimumVoltage = Math.min(previous?.power.minimumVoltage ?? batteryVoltage, batteryVoltage);
  const gps: SensorHealth = gpsFailure
    ? { state: 'error', lastUpdate: previous?.navigation.gpsUpdatedAt ?? null, frequencyHz: 0, calibrated: null, errorCount: 1 }
    : health(timestamp, 5, null);

  return {
    timestamp,
    aircraftId: 'FD-X1',
    attitude: {
      roll,
      pitch,
      heading: round(heading, 1),
      gyroX: round(8.5 / 12 * Math.cos(elapsedSec / 12)),
      gyroY: round(3.7 / 18 * Math.cos(elapsedSec / 18)),
      gyroZ: round(9 / 32 * Math.cos(elapsedSec / 32)),
    },
    navigation: {
      latitude: gpsFailure ? null : round(latitude, 6),
      longitude: gpsFailure ? null : round(longitude, 6),
      gpsAltitude: gpsFailure ? null : round(baroAltitude + 5.2 + 0.7 * Math.sin(elapsedSec / 21)),
      barometricAltitude: round(baroAltitude),
      groundSpeed: gpsFailure ? null : round(groundSpeed, 1),
      course: gpsFailure ? null : round(heading, 1),
      satellites: gpsFailure ? 0 : 11 + Math.round(Math.sin(elapsedSec / 23)),
      hdop: gpsFailure ? null : round(0.9 + 0.1 * Math.sin(elapsedSec / 17), 1),
      gpsFix: !gpsFailure,
      distanceHome: gpsFailure ? null : round(homeVector.distanceMeters),
      bearingHome: gpsFailure || homeVector.bearingDegrees === null ? null : round(homeVector.bearingDegrees, 1),
      homeLatitude: HOME_LATITUDE,
      homeLongitude: HOME_LONGITUDE,
      gpsUpdatedAt: gpsFailure ? previous?.navigation.gpsUpdatedAt ?? null : timestamp,
    },
    environment: {
      pressure: round(1013.25 * (1 - baroAltitude / 44330) ** 5.255),
      temperature: round(27.2 - 0.0065 * baroAltitude, 1),
      verticalSpeed: round(16 / 48 * Math.cos(elapsedSec / 48)),
    },
    power: {
      batteryVoltage: round(batteryVoltage),
      batteryPercent: Math.round(estimatedBattery),
      startVoltage: previous?.power.startVoltage ?? 12.42,
      minimumVoltage: round(minimumVoltage),
    },
    control: {
      throttle: failsafe ? 0 : Math.round(63 + 3 * Math.sin(elapsedSec / 29)),
      aileron: failsafe ? 0 : round(roll * 0.7, 1),
      elevator: failsafe ? 0 : round(pitch * 0.8, 1),
      rudder: failsafe ? 0 : round(2 * Math.sin(elapsedSec / 19), 1),
    },
    system: {
      uartConnected: true,
      telemetryConnected: true,
      gpsConnected: !gpsFailure,
      rcConnected: !failsafe,
      failsafe,
      flightMode: failsafe ? 'FAILSAFE' : 'CRUISE',
      packetSequence: Math.floor(elapsedSec * 5) + 1052,
      packetAge: 0,
      uptime: Math.round(198 + elapsedSec),
      uartPacketRate: 5,
      sequenceGaps: 0,
      invalidPackets: 0,
      wifiRssi: -54 - Math.round(3 * Math.sin(elapsedSec / 41)),
      cloudConnected: false,
    },
    sensors: {
      imu: health(timestamp, 50),
      accelerometer: health(timestamp, 50),
      gyroscope: health(timestamp, 50),
      magnetometer: health(timestamp, 25),
      barometer: health(timestamp, 10),
      gps,
      voltage: health(timestamp, 5, null),
      uart: health(timestamp, 5, null),
      nano: health(timestamp, 5, null),
      esp32: health(timestamp, 5, null),
    },
  };
}
