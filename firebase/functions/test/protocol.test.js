'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const {
  parseDevices, validSignature, validateSample, nextAircraftState,
} = require('../protocol');

const now = 1_800_000_000_000;
const keyHex = 'ab'.repeat(32);
const aircraftId = 'FD-X1';

function sample() {
  const health = () => ({
    state: 'online', lastUpdate: now, frequencyHz: 5, calibrated: true, errorCount: 0,
  });
  return {
    timestamp: now,
    aircraftId,
    attitude: { roll: 5, pitch: -3, heading: 359, gyroX: 0.1, gyroY: 0.2, gyroZ: 0.3 },
    navigation: {
      latitude: 5.55, longitude: -0.2, gpsAltitude: 120, barometricAltitude: 117,
      groundSpeed: 40, course: 28, satellites: 10, hdop: 0.8, gpsFix: true,
      distanceHome: 300, bearingHome: 100, homeLatitude: 5.54, homeLongitude: -0.21,
      gpsUpdatedAt: now,
    },
    environment: { pressure: 1008, temperature: 26, verticalSpeed: 0.5 },
    power: { batteryVoltage: 12.2, batteryPercent: 80, startVoltage: 12.6, minimumVoltage: 11.7 },
    control: { throttle: 60, aileron: -2, elevator: 4, rudder: 0 },
    system: {
      uartConnected: true, telemetryConnected: true, gpsConnected: true, rcConnected: true,
      failsafe: false, flightMode: 'CRUISE', packetSequence: 20, packetAge: 0, uptime: 4,
      uartPacketRate: 10, sequenceGaps: 0, invalidPackets: 0, wifiRssi: -60,
      cloudConnected: true,
    },
    sensors: Object.fromEntries([
      'imu', 'accelerometer', 'gyroscope', 'magnetometer', 'barometer',
      'gps', 'voltage', 'uart', 'nano', 'esp32',
    ].map(name => [name, health()])),
  };
}

test('accepts a complete bounded v1 sample with the provisioned aircraft ID', () => {
  assert.equal(validateSample(sample(), aircraftId, now, now), true);
  const noFix = sample();
  noFix.navigation.gpsFix = false;
  noFix.navigation.latitude = null;
  noFix.navigation.longitude = null;
  noFix.navigation.groundSpeed = null;
  noFix.navigation.course = null;
  assert.equal(validateSample(noFix, aircraftId, now, now), true);
});

test('rejects spoofed aircraft, old sensor samples, malformed GPS and unexpected keys', () => {
  const spoofed = sample();
  spoofed.aircraftId = 'some-other-aircraft';
  assert.equal(validateSample(spoofed, aircraftId, now, now), false);
  const stale = sample();
  stale.timestamp -= 5_001;
  assert.equal(validateSample(stale, aircraftId, now, now), false);
  const noCoordinates = sample();
  noCoordinates.navigation.latitude = null;
  assert.equal(validateSample(noCoordinates, aircraftId, now, now), false);
  const extra = sample();
  extra.system.admin = true;
  assert.equal(validateSample(extra, aircraftId, now, now), false);
  const missingImuTime = sample();
  missingImuTime.sensors.imu.lastUpdate = null;
  assert.equal(validateSample(missingImuTime, aircraftId, now, now), false);
  const oldMagnetometer = sample();
  oldMagnetometer.sensors.magnetometer.lastUpdate = now - 2_000;
  assert.equal(validateSample(oldMagnetometer, aircraftId, now, now), false);
});

test('HMAC signs exact body bytes, device ID and timestamp', () => {
  const raw = Buffer.from('{"schemaVersion":1,"sample":{}}');
  const sentAt = String(now);
  const signature = createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(`esp32-01\n${sentAt}\n`).update(raw).digest('hex');
  assert.equal(validSignature('esp32-01', sentAt, raw, signature, keyHex), true);
  assert.equal(validSignature('esp32-02', sentAt, raw, signature, keyHex), false);
  assert.equal(validSignature('esp32-01', String(now + 1), raw, signature, keyHex), false);
  assert.equal(validSignature('esp32-01', sentAt, Buffer.from('{}'), signature, keyHex), false);
});

test('provisioning rejects malformed keys and duplicate aircraft mappings', () => {
  assert.equal(parseDevices(JSON.stringify({ 'esp32-01': { aircraftId, keyHex } }))['esp32-01'].aircraftId, aircraftId);
  assert.throws(() => parseDevices(JSON.stringify({ 'esp32-01': { aircraftId, keyHex: 'short' } })));
  assert.throws(() => parseDevices(JSON.stringify({
    'esp32-01': { aircraftId, keyHex }, 'esp32-02': { aircraftId, keyHex },
  })));
});

test('atomic latest update rejects duplicate/out-of-order and excessive rate', () => {
  const envelope = { schemaVersion: 1, receivedAt: now, sample: sample() };
  const first = nextAircraftState(null, envelope, now, now);
  assert.equal(first.reason, null);
  assert.equal(first.value.telemetry.latest, envelope);
  assert.equal(nextAircraftState(first.value, envelope, now, now + 200).reason, 'replay');
  const tooSoon = { ...envelope, sample: { ...envelope.sample, timestamp: now + 1 } };
  assert.equal(nextAircraftState(first.value, tooSoon, now + 1, now + 10).reason, 'rate');
  assert.equal(nextAircraftState(first.value, envelope, now + 200, now + 200).reason, 'replay');
  const nextEnvelope = { ...envelope, sample: { ...envelope.sample, timestamp: now + 200 } };
  const second = nextAircraftState(first.value, nextEnvelope, now + 200, now + 200);
  assert.equal(second.reason, null);
  assert.equal(second.value._ingest.lastSentAt, now + 200);
});
