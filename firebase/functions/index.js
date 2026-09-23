'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const {
  AIRCRAFT_ID,
  MAX_CLOCK_SKEW_MS,
  parseDevices,
  validSignature,
  validateSample,
  nextAircraftState,
} = require('./protocol');

initializeApp();

const INGEST_DEVICES = defineSecret('INGEST_DEVICES');
const MAX_BODY_BYTES = 16 * 1024;
const DUMMY_KEY_HEX = '0'.repeat(64);

/** Only a provisioned ESP32 can submit telemetry; browser database writes are denied. */
exports.ingestTelemetry = onRequest({
  region: 'us-central1',
  secrets: [INGEST_DEVICES],
  cors: false,
  maxInstances: 3,
  timeoutSeconds: 15,
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();

  const deviceId = req.get('X-FCC-Device-Id');
  const timestampText = req.get('X-FCC-Timestamp');
  const signature = req.get('X-FCC-Signature');
  const rawBody = req.rawBody;
  const now = Date.now();
  if (!AIRCRAFT_ID.test(deviceId || '') ||
      !/^\d{13}$/.test(timestampText || '') ||
      !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.get('Content-Type') || '') ||
      (req.get('Content-Encoding') && req.get('Content-Encoding').toLowerCase() !== 'identity')) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const signedAt = Number(timestampText);
  if (!Number.isSafeInteger(signedAt) || Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let devices;
  try {
    devices = parseDevices(INGEST_DEVICES.value());
  } catch {
    // Provisioning is unavailable or malformed; fail closed and expose no secret material.
    return res.status(503).json({ error: 'ingest_unavailable' });
  }
  const provision = Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
  const authenticated = validSignature(
    deviceId, timestampText, rawBody, signature,
    provision?.keyHex || DUMMY_KEY_HEX,
  );
  if (!provision || !authenticated) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_telemetry' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'schemaVersion') ||
      !Object.hasOwn(payload, 'sample') || payload.schemaVersion !== 1 ||
      !validateSample(payload.sample, provision.aircraftId, signedAt, now)) {
    return res.status(400).json({ error: 'invalid_telemetry' });
  }

  const envelope = { schemaVersion: 1, receivedAt: now, sample: payload.sample };
  let rejection = 'replay';
  try {
    // The same atomic transaction orders all writes to this aircraft. A delayed older
    // request cannot overwrite a newer latest sample, even across function instances.
    const result = await getDatabase().ref(`aircraft/${provision.aircraftId}`).transaction(current => {
      const next = nextAircraftState(current, envelope, signedAt, now);
      rejection = next.reason || 'replay';
      return next.value;
    }, undefined, false);
    if (!result.committed) {
      return res.status(rejection === 'rate' ? 429 : 409)
        .json({ error: rejection === 'rate' ? 'rate_limited' : 'duplicate_or_out_of_order' });
    }
    return res.status(202).json({ accepted: true, receivedAt: now });
  } catch {
    return res.status(503).json({ error: 'ingest_unavailable' });
  }
});
