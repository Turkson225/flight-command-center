# Firebase Realtime Database integration

These are deployable backend templates. The GitHub Pages build does **not** deploy Firebase. No Firebase project, Auth user, database, device key, or ESP32 publisher has been configured in this repository.

```text
ESP32 -- HTTPS + device HMAC --> Cloud Function ingestTelemetry
                                   | validate + atomic order/rate check
                                   v
                               Realtime Database
                                   | owner Auth + Security Rules
                                   v
                         GitHub Pages dashboard (read only)
```

The Arduino Nano must remain responsible for control and failsafe. The browser reads observations; this backend exposes no aircraft command write path.

## Create and provision a Firebase project

1. Create a Firebase project. Enable its **default Realtime Database** in locked mode, then enable **Authentication → Email/Password**. Create the owner's Auth account. This template places the Function in `us-central1`; choose a suitable database location and adjust the Function region before deployment if needed. Review [Firebase billing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans): deploying Cloud Functions requires the Blaze pay-as-you-go plan. Set appropriate billing alerts and quotas.
2. Record the web app configuration for the frontend, including the precise `databaseURL`. Firebase web API keys identify the project but do not grant data access; keep the device secret strictly on the ESP32 and in Cloud Secret Manager.
3. Choose an aircraft ID such as `FD-X1` and a device ID such as `esp32-01` (letters, digits, `_` and `-`, at most 40 characters). Generate a random 32-byte key with `openssl rand -hex 32`. Outside the repo, create a private JSON file shaped like this, replacing the placeholder with the generated 64 hexadecimal characters:

   ```json
   {
     "esp32-01": {
       "aircraftId": "FD-X1",
       "keyHex": "REPLACE_WITH_64_RANDOM_HEX_CHARACTERS"
     }
   }
   ```

   One aircraft ID may have one provisioned device in this initial design. Never commit or paste the actual key into a browser environment variable, issue, README, or GitHub Actions secret used for the static site. Provision the ESP32 securely; rotate by updating the secret and deploying the Function again. Revocation removes that device from the JSON secret and redeploys.
4. Find the owner's **Firebase Authentication UID** in the console. Using the Firebase console with administrator access, add the RTDB Boolean value `true` at `/memberships/<OWNER_UID>/aircraft/FD-X1`. An email address alone is not a database permission. There is no public self-registration or membership write rule.
5. From this `firebase/` directory, with the [Firebase CLI](https://firebase.google.com/docs/cli/) installed and logged in:

   ```bash
   npm --prefix functions install
   npm --prefix functions run check
   firebase functions:secrets:set INGEST_DEVICES --data-file /private/path/ingest-devices.json --project YOUR_PROJECT_ID
   firebase deploy --only database,functions --project YOUR_PROJECT_ID
   ```

   Deploy only after reviewing the rules and Function. The CLI prints the deployed HTTPS Function URL. Keep GitHub Pages deployment separate. Confirm that authenticated member reads succeed and that unauthenticated reads, another user's reads, and all browser writes fail. Do not use Firebase Realtime Database test mode or public rules.

## ESP32 HTTPS POST contract

Send a POST to the exact `ingestTelemetry` HTTPS Function URL. The URL is not a credential. Use TLS certificate verification and synchronize UTC (for example NTP with a checked result) before sending; an unsynchronized clock is rejected. Do not use `setInsecure()`. Use these headers:

```http
Content-Type: application/json
X-FCC-Device-Id: esp32-01
X-FCC-Timestamp: 1800000000000
X-FCC-Signature: <64 lowercase hexadecimal characters>
```

The timestamp is Unix milliseconds as a decimal string, generated immediately before sending. The body is UTF-8 JSON with **all fields** from [`AircraftTelemetry`](../src/core/telemetry.ts); unavailable measurements are explicit `null`:

```json
{
  "schemaVersion": 1,
  "sample": {
    "timestamp": 1800000000000,
    "aircraftId": "FD-X1",
    "attitude": { "roll": 2.4, "pitch": -1.2, "heading": 281.5, "gyroX": 0.1, "gyroY": 0.0, "gyroZ": -0.1 }
  }
}
```

The short example above illustrates the envelope; it is **not** a valid complete request. The full sample also needs `navigation`, `environment`, `power`, `control`, `system`, and all ten `sensors` health entries. See [`protocol.js`](functions/protocol.js) for the exact accepted fields and ranges. Units follow the `AircraftTelemetry` comments: degrees, WGS84 coordinates, metres, GPS ground speed in km/h, hPa, °C, and battery volts. Roll/pitch should come from calibrated accelerometer/gyro fusion; heading should use calibrated, tilt-compensated magnetometer/gyro fusion with a valid health state. Report actual sensor failures as null/invalid rather than fabricated values.

Compute HMAC-SHA256 using the **32-byte binary key** decoded from `keyHex`, signing this exact byte sequence:

```text
UTF8(deviceId) + 0x0A + UTF8(timestampHeaderText) + 0x0A + rawUncompressedBodyBytes
```

Hex-encode the 32-byte digest into `X-FCC-Signature`. Sign the exact body sent on the wire; whitespace, JSON property order, or timestamp differences alter the signature. Keep the ESP32 key out of serial logs and firmware source control. Limit each request to 16 KiB.

The server verifies the signature before parsing telemetry. The signed time must be within 15 seconds of server time; the sample capture time must be between 5 seconds before and 1 second after it. Every sensor marked `online` needs a `lastUpdate` less than 1.5 seconds older than the sample timestamp; mark an older or missing reading `stale` or `offline`, and do not label it as current. The Function checks all fields, provisioned aircraft identity, increasing signed and capture timestamps, and at least 150 ms between accepted packets. Publish around **5 Hz**; a failed request should be retried with a newly signed timestamp and current sample, never with stale flight values. A duplicate or out-of-order packet returns `409`; excess rate returns `429`. A bad signature returns `401`; malformed telemetry returns `400`. The onboard Nano must never depend on a successful cloud request.

## Database and access contract

The Function stores only the **latest** sample at `/aircraft/<AIRCRAFT_ID>/telemetry/latest`:

```json
{
  "schemaVersion": 1,
  "receivedAt": 1800000000000,
  "sample": { "aircraftId": "FD-X1", "timestamp": 1800000000000 }
}
```

`receivedAt` comes from the trusted Function's clock, `sample.timestamp` from the aircraft's capture clock. Realtime Database removes keys with `null` values, so web readers must restore missing nullable measurements as null. The `_ingest` sibling is internal ordering/rate state and cannot be read by browser rules. There is no recording, replay, or flight-history storage in this first integration; old `latest` data remains until overwritten, so the dashboard must mark it stale/offline by age. A successful browser subscription does not prove that the aircraft is currently transmitting.

Rules grant each signed-in Firebase Auth UID a read of its own `/memberships/<uid>/aircraft` and of telemetry for aircraft with a `true` membership. All client writes and other reads are denied. Admin SDK code bypasses these rules, so Function validation is the write boundary. Test both member and non-member access in the [Realtime Database emulator](https://firebase.google.com/docs/emulator-suite/connect_rtdb) before using actual aircraft data. Browser config and sign-in do not create membership.

## Deployment limits

- Cloud Functions and Secret Manager can incur charges. The Function caps its instances but signed and unsigned requests still count as invocations. Monitor usage and add infrastructure rate controls if exposed broadly.
- This endpoint has no offline queue. Buffered samples older than the accepted time window are dropped. The Nano's RC/failsafe loop remains independent of Internet and Firebase.
- The Function stores one validated position/attitude snapshot, with no command route. Flight use requires calibrated sensors, GPS and clock checks, independent hardware validation, and stale-data testing.
