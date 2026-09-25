# Mission planner and onboard transfer contract

**Status:** The dashboard planner, JSON import/export, route simulation, Firebase mission library, staging path, validation display and dual-acknowledgement display are implemented. NodeMCU mission download, UART mission transfer, persistent Nano storage and autonomous navigation/control loops are not implemented by this release. The dashboard cannot start a mission or steer the aircraft.

## Safety boundary

Firebase distributes a complete, sealed mission package. It is not a continuous control link. Before a mission can be considered onboard-ready:

1. The dashboard validates and stages one complete revision.
2. The NodeMCU downloads the whole package and verifies its identity, ranges and CRC32.
3. The NodeMCU transfers the whole package over a bounded, acknowledged UART exchange.
4. The Nano independently verifies schema version, revision, CRC32, waypoint count, field limits, HOME and geofence containment.
5. The Nano stores the complete validated package in persistent onboard storage before acknowledging `validated`.
6. A physical/manual mode switch must independently permit mission mode. Receiving or storing a mission must never start it.

The nRF24 manual link and onboard failsafe always outrank mission navigation. Loss of the NodeMCU, Wi-Fi, Firebase or browser after loading must not stop local navigation or failsafe processing. If the Nano cannot safely continue, it must use its locally defined failsafe behavior; it must not wait for cloud instructions.

## Planner behavior

The **Mission planner** page is available at `#/mission`. It supports:

- click-to-add and marker dragging on the map;
- drag/drop, arrow reordering and deletion in the ordered waypoint editor;
- waypoint, loiter and return-home actions;
- altitude AGL, target ground speed, acceptance radius and loiter time;
- confirmed HOME and an advisory geofence overlay;
- route distance and duration estimates;
- local simulation at 1×, 2×, 4×, 10× or 20×;
- JSON import/export;
- an authenticated per-user Firebase mission library;
- one staged transfer package and matching NodeMCU/Nano acknowledgements; and
- current waypoint, remaining route distance and signed cross-track error derived from simulation, live position and an optional Nano-reported waypoint index.

The simulator is geometric. It does not model wind, terrain, turn radius, climb performance, control authority, battery reserve or airspeed. Target speed is ground speed because no airspeed sensor is installed.

## Mission JSON schema version 1

An exported mission has this shape:

```json
{
  "schemaVersion": 1,
  "id": "mission-example",
  "name": "North field circuit",
  "aircraftId": "FD-X1",
  "revision": 7,
  "createdAt": 1800000000000,
  "updatedAt": 1800000005000,
  "home": {
    "latitude": 5.60372,
    "longitude": -0.18696,
    "confirmedByOperator": true
  },
  "geofenceRadiusM": 500,
  "waypoints": [
    {
      "id": "WP-01",
      "latitude": 5.6042,
      "longitude": -0.1865,
      "altitudeM": 80,
      "targetSpeedKmh": 55,
      "acceptanceRadiusM": 35,
      "action": "waypoint",
      "loiterSeconds": 0
    }
  ],
  "checksum": "XXXXXXXX"
}
```

`XXXXXXXX` above is deliberately a placeholder, not a valid package. Use the dashboard export so the checksum matches the route.

| Field | Rule |
| --- | --- |
| Schema | Exactly version `1` |
| Waypoints | 1–25, unique safe IDs |
| Altitude | 10–500 m AGL |
| Target speed | 15–160 km/h ground speed |
| Acceptance radius | 10–300 m |
| Loiter | 5–1800 s when action is `loiter` |
| Geofence | 100–5000 m radius; every waypoint must lie within it |
| Route | Maximum 20 km per leg and 100 km total |
| Return home | Must be the final action and its coordinates must match confirmed HOME within 2 m |

Browser validation is a usability gate, not a trust boundary. Firebase rules constrain the stored structure, while the Nano must repeat all flight-relevant checks before persistence.

## Canonical checksum

The checksum is uppercase, eight-character CRC-32/ISO-HDLC (polynomial `0xEDB88320`, initial value `0xFFFFFFFF`, reflected input/output, final XOR `0xFFFFFFFF`). It covers a canonical ASCII payload, not the JSON bytes. Timestamps and the human-readable mission name are intentionally excluded.

```text
FCCM1|<mission-id>|<aircraft-id>|<revision>|<home-lat-6dp>|<home-lon-6dp>|<home-confirmed-0-or-1>|<geofence-1dp>|<count>|<waypoint-records>
```

Each waypoint record is joined with `;` and contains:

```text
<zero-based-index>,<waypoint-id>,<lat-6dp>,<lon-6dp>,<altitude-1dp>,<speed-1dp>,<radius-1dp>,<action>,<loiter-whole-seconds>
```

The implementation is in [`src/core/missionPlanner.ts`](../src/core/missionPlanner.ts). NodeMCU and Nano implementations must be checked against exported fixtures and the browser unit tests before use. Do not substitute UART CRC-16 for this end-to-end mission CRC32: each protects a different boundary.

## Firebase paths

Saved operator missions are private to the signed-in owner:

```text
/missionLibraries/<ownerUid>/<aircraftId>/<missionId>
```

Staging replaces one pending package and clears old acknowledgements atomically:

```text
/aircraft/<aircraftId>/missionTransfer/pending
/aircraft/<aircraftId>/missionTransfer/acknowledgements/nodeMcu
/aircraft/<aircraftId>/missionTransfer/acknowledgements/nano
```

The pending record contains `schemaVersion`, `requestId`, trusted server `requestedAt`, `requestedBy` and the complete mission. The rules permit an authorized aircraft member to stage it and the dedicated NodeMCU Auth UID to read it. No `execute`, actuator, surface or throttle path exists.

An acknowledgement written by the authenticated NodeMCU has this form:

```json
{
  "missionId": "mission-example",
  "revision": 7,
  "checksum": "1A2B3C4D",
  "status": "validated",
  "acknowledgedAt": { ".sv": "timestamp" },
  "detail": "Nano CRC32, limits and storage verified",
  "currentWaypointIndex": 0
}
```

NodeMCU status is `received`, `stored` or `rejected`. Nano status is `validated` or `rejected`; the NodeMCU only relays the Nano result after receiving a matching UART acknowledgement. The dashboard shows onboard-ready only when both acknowledgements match mission ID, revision and checksum, the gateway is stored/validated, and the Nano is validated. A dashboard never fabricates either acknowledgement.

Publishing the GitHub Pages site does not publish Realtime Database rules. Review and deploy [`firebase/database.rules.json`](../firebase/database.rules.json) separately with the Firebase CLI, then test member, non-member and device access in the emulator.

## Proposed reliable NodeMCU-to-Nano transfer

Use the existing `$<payload>*<CRC16><LF>` framing from [UART v1](uart-protocol.md). Mission frames are a proposed extension and must remain nonblocking. A compact sequence can carry:

```text
FD1,MI,1,<mission-id>,<aircraft-id>
FD1,MB,<revision>,<home-lat-e6>,<home-lon-e6>,<geofence-decimetres>,<count>,<mission-crc32>
FD1,MW,<index>,<waypoint-id>,<lat-e6>,<lon-e6>,<alt-decimetres>,<speed-tenths-kmh>,<radius-decimetres>,<W|L|R>,<loiter-seconds>
FD1,ME,<revision>,<mission-crc32>
FD1,MA,<revision>,<mission-crc32>,<VALIDATED|REJECTED>,<reason>
```

The exact byte limits and parser vectors must be added before firmware integration. Every frame needs the UART CRC-16; the Nano must also reconstruct the canonical mission payload and verify its CRC32 at `ME`. Use stop-and-wait sequencing or an equivalent bounded protocol, explicit per-frame acknowledgement, bounded retries and a transfer timeout. Duplicate frames must be idempotent. A reboot or timeout leaves the previously validated mission active in storage and the new staging slot invalid.

The ATmega328P Nano has limited SRAM and EEPROM. Do not buffer JSON on it. Use a bounded packed representation and an atomic staging/active record design; if two safe slots plus the configured 25-waypoint maximum do not fit after measurement, add suitable nonvolatile storage or lower the maximum consistently in the browser, rules and firmware. A Nano `validated` acknowledgement means the record was read back from storage and rechecked, not merely received in RAM.

## Nano acceptance gates

Reject the transfer without replacing the prior mission when any gate fails:

- unsupported schema or wire version;
- aircraft identity mismatch;
- non-increasing or disallowed mission revision according to the local update policy;
- mission CRC32 or any UART CRC-16 mismatch;
- duplicate/missing/out-of-order waypoint index or ID;
- waypoint count or numeric range violation;
- waypoint outside geofence, excessive leg/route length, invalid HOME or return-home ordering;
- insufficient persistent storage or read-back failure;
- failsafe active, transfer attempted in a disallowed aircraft state, or other local interlock failure.

Mission receipt never changes the flight mode. Mission execution requires a separately tested onboard navigator, stabilized attitude/altitude loops, actuator limits, mode state machine and physical manual-mode permission. nRF24 input or failsafe must be able to preempt mission mode immediately and deterministically.

## Propeller-free bench release sequence

1. Validate browser export/import and checksum fixtures.
2. Test Firebase rules with owner, unrelated owner and device accounts.
3. Transfer a mission to a Nano test harness and verify both acknowledgements.
4. Inject malformed JSON, bad CRCs, missing/duplicate frames, over-limit values, timeout, resets and storage failures.
5. Remove Wi-Fi and power-cycle the NodeMCU; confirm the Nano retains the complete mission and its local manual/failsafe behavior.
6. Exercise the physical mode switch and nRF24 override while the Nano navigator is running in a hardware-in-the-loop rig.
7. Verify control directions, bounds, watchdogs and failsafe with the propeller removed and outputs measured independently.

Only after those gates pass should supervised navigation tests be considered under a qualified operator and applicable local rules.
