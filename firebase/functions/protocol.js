'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const AIRCRAFT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const KEY_HEX = /^[a-f\d]{64}$/i;
const SENSOR_STATES = new Set(['online', 'calibrating', 'degraded', 'stale', 'offline', 'error']);
const SENSOR_NAMES = [
  'imu', 'accelerometer', 'gyroscope', 'magnetometer', 'barometer',
  'gps', 'voltage', 'uart', 'nano', 'esp32',
];
const MAX_CLOCK_SKEW_MS = 15_000;
const MAX_SAMPLE_AGE_MS = 5_000;
const MIN_INGEST_INTERVAL_MS = 150;

function objectWithKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}

function numberIn(value, min, max, nullable = false) {
  return (nullable && value === null) ||
    (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

function integerIn(value, min, max, nullable = false) {
  return numberIn(value, min, max, nullable) && (value === null || Number.isSafeInteger(value));
}

function booleanOrNull(value) {
  return value === null || typeof value === 'boolean';
}

function validateHealth(health, now, sampleTimestamp) {
  return objectWithKeys(health, ['state', 'lastUpdate', 'frequencyHz', 'calibrated', 'errorCount']) &&
    SENSOR_STATES.has(health.state) &&
    integerIn(health.lastUpdate, 0, now + MAX_CLOCK_SKEW_MS, true) &&
    (health.state !== 'online' ||
      (health.lastUpdate !== null && health.lastUpdate <= sampleTimestamp + 1000 &&
        sampleTimestamp - health.lastUpdate < 1500)) &&
    numberIn(health.frequencyHz, 0, 1000, true) &&
    booleanOrNull(health.calibrated) &&
    integerIn(health.errorCount, 0, 1_000_000_000);
}

/** Strict v1 contract: nullable measurements must be explicit null in the HTTP JSON. */
function validateSample(sample, aircraftId, signedAt, now) {
  if (!objectWithKeys(sample, [
    'timestamp', 'aircraftId', 'attitude', 'navigation', 'environment',
    'power', 'control', 'system', 'sensors',
  ])) return false;
  if (sample.aircraftId !== aircraftId ||
      !integerIn(sample.timestamp, signedAt - MAX_SAMPLE_AGE_MS, signedAt + 1000) ||
      Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) return false;

  const a = sample.attitude;
  if (!objectWithKeys(a, ['roll', 'pitch', 'heading', 'gyroX', 'gyroY', 'gyroZ']) ||
      !numberIn(a.roll, -180, 180, true) || !numberIn(a.pitch, -90, 90, true) ||
      !numberIn(a.heading, 0, 360, true) ||
      !['gyroX', 'gyroY', 'gyroZ'].every(key => numberIn(a[key], -3000, 3000, true))) return false;

  const n = sample.navigation;
  if (!objectWithKeys(n, [
    'latitude', 'longitude', 'gpsAltitude', 'barometricAltitude', 'groundSpeed',
    'course', 'satellites', 'hdop', 'gpsFix', 'distanceHome', 'bearingHome',
    'homeLatitude', 'homeLongitude', 'gpsUpdatedAt',
  ]) ||
      !numberIn(n.latitude, -90, 90, true) || !numberIn(n.longitude, -180, 180, true) ||
      !numberIn(n.gpsAltitude, -1000, 30000, true) ||
      !numberIn(n.barometricAltitude, -1000, 30000, true) ||
      !numberIn(n.groundSpeed, 0, 1000, true) || !numberIn(n.course, 0, 360, true) ||
      !integerIn(n.satellites, 0, 64) || !numberIn(n.hdop, 0, 100, true) ||
      typeof n.gpsFix !== 'boolean' ||
      !numberIn(n.distanceHome, 0, 10_000_000, true) ||
      !numberIn(n.bearingHome, 0, 360, true) ||
      !numberIn(n.homeLatitude, -90, 90, true) ||
      !numberIn(n.homeLongitude, -180, 180, true) ||
      !integerIn(n.gpsUpdatedAt, 0, now + MAX_CLOCK_SKEW_MS, true) ||
      (n.gpsFix && (n.latitude === null || n.longitude === null)) ||
      (!n.gpsFix && (n.latitude !== null || n.longitude !== null))) return false;

  const e = sample.environment;
  if (!objectWithKeys(e, ['pressure', 'temperature', 'verticalSpeed']) ||
      !numberIn(e.pressure, 100, 1200, true) ||
      !numberIn(e.temperature, -80, 120, true) ||
      !numberIn(e.verticalSpeed, -200, 200, true)) return false;

  const p = sample.power;
  if (!objectWithKeys(p, ['batteryVoltage', 'batteryPercent', 'startVoltage', 'minimumVoltage']) ||
      !['batteryVoltage', 'startVoltage', 'minimumVoltage'].every(key => numberIn(p[key], 0, 100, true)) ||
      !numberIn(p.batteryPercent, 0, 100, true)) return false;

  const c = sample.control;
  if (!objectWithKeys(c, ['throttle', 'aileron', 'elevator', 'rudder']) ||
      !numberIn(c.throttle, 0, 100, true) ||
      !['aileron', 'elevator', 'rudder'].every(key => numberIn(c[key], -180, 180, true))) return false;

  const s = sample.system;
  if (!objectWithKeys(s, [
    'uartConnected', 'telemetryConnected', 'gpsConnected', 'rcConnected',
    'failsafe', 'flightMode', 'packetSequence', 'packetAge', 'uptime',
    'uartPacketRate', 'sequenceGaps', 'invalidPackets', 'wifiRssi', 'cloudConnected',
  ]) ||
      !['uartConnected', 'telemetryConnected', 'gpsConnected', 'rcConnected', 'failsafe', 'cloudConnected']
        .every(key => typeof s[key] === 'boolean') ||
      typeof s.flightMode !== 'string' || !/^[A-Za-z0-9_ -]{1,32}$/.test(s.flightMode) ||
      !integerIn(s.packetSequence, 0, Number.MAX_SAFE_INTEGER) ||
      !numberIn(s.packetAge, 0, 60_000) || !numberIn(s.uptime, 0, 1_000_000_000) ||
      !numberIn(s.uartPacketRate, 0, 1000, true) ||
      !integerIn(s.sequenceGaps, 0, Number.MAX_SAFE_INTEGER) ||
      !integerIn(s.invalidPackets, 0, Number.MAX_SAFE_INTEGER) ||
      !numberIn(s.wifiRssi, -120, 0, true)) return false;

  return objectWithKeys(sample.sensors, SENSOR_NAMES) &&
    SENSOR_NAMES.every(name => validateHealth(sample.sensors[name], now, sample.timestamp));
}

function parseDevices(raw) {
  const devices = JSON.parse(raw);
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) {
    throw new Error('Invalid device provisioning');
  }
  const aircraftIds = new Set();
  for (const [deviceId, config] of Object.entries(devices)) {
    if (!AIRCRAFT_ID.test(deviceId) ||
        !objectWithKeys(config, ['aircraftId', 'keyHex']) ||
        typeof config.aircraftId !== 'string' || !AIRCRAFT_ID.test(config.aircraftId) ||
        typeof config.keyHex !== 'string' || !KEY_HEX.test(config.keyHex) ||
        aircraftIds.has(config.aircraftId)) throw new Error('Invalid device provisioning');
    aircraftIds.add(config.aircraftId);
  }
  return devices;
}

function validSignature(deviceId, signedAt, rawBody, signature, keyHex) {
  if (typeof signature !== 'string' || !KEY_HEX.test(signature)) return false;
  const expected = createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(`${deviceId}\n${signedAt}\n`, 'utf8')
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Called in an RTDB transaction to couple ordering/rate state to latest telemetry. */
function nextAircraftState(current, envelope, signedAt, now) {
  const old = current && typeof current === 'object' ? current : {};
  const state = old._ingest || {};
  if (typeof state.lastSentAt === 'number' && signedAt <= state.lastSentAt) {
    return { value: undefined, reason: 'replay' };
  }
  if (typeof old.telemetry?.latest?.sample?.timestamp === 'number' &&
      envelope.sample.timestamp <= old.telemetry.latest.sample.timestamp) {
    return { value: undefined, reason: 'replay' };
  }
  if (typeof state.receivedAt === 'number' && now - state.receivedAt < MIN_INGEST_INTERVAL_MS) {
    return { value: undefined, reason: 'rate' };
  }
  return {
    value: {
      ...old,
      _ingest: { lastSentAt: signedAt, receivedAt: now },
      telemetry: { ...(old.telemetry || {}), latest: envelope },
    },
    reason: null,
  };
}

module.exports = {
  AIRCRAFT_ID,
  MAX_CLOCK_SKEW_MS,
  parseDevices,
  validSignature,
  validateSample,
  nextAircraftState,
};
