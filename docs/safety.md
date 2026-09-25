# Safety boundary and validation gates

This project is a development dashboard for a fixed-wing UAV. The public installation currently uses synthetic telemetry; the Firebase reader and ingestion code need a provisioned project and verified hardware. It is not a flight controller, a certified flight instrument, or proof of aircraft readiness.

## Invariant: onboard control remains local

- The Nano must retain RC input processing, ESC/servo timing, mode logic, loss-of-link detection, and failsafe under independent testing.
- Browser, Wi-Fi, ESP32 telemetry, and cloud outages must not disable Nano failsafe. Do not place continuous throttle, aileron, elevator, or rudder commands on the web path.
- The ESP32 telemetry reader must not block the Nano control loop. The Nano must never wait for an ACK to continue local control.
- Never energize an ESC/propeller during initial integration tests. Use a propeller-free bench setup and independently measure output behavior.

## Data presentation rules

| Condition | Safe display behavior |
| --- | --- |
| Valid, current telemetry | LIVE with source and packet age |
| No recent packets | Preserve last known sample briefly; show STALE and increasing age |
| Link timeout | OFFLINE / TELEMETRY LOST; preserve last known values labeled stale |
| GPS lost | Mark coordinates, trail update, home bearing/distance unavailable; never insert (0, 0) |
| IMU/altitude sensor failed | Freeze labeled last value or show NO DATA, with specific fault |
| Battery unavailable | NO DATA, never 0 V or a reassuring percentage |
| Simulated data | Persistent SIMULATION label through displays, alerts, exports and recordings |

Browser alert thresholds, the advisory geofence, control-response ratings, and the preflight checklist are decision aids only. They do not constrain the Nano, command return-to-home, diagnose aerodynamic stability, or certify that launch is safe. CSV/JSON exports and local IndexedDB recordings must be compared with an independent reference before they are used for engineering conclusions.

Freshness thresholds must be chosen from measured link rate and tested. In the proposed UART v1 contract, flag a state sample stale after 1 second since receipt and link offline after 3 seconds. An aircraft command should never be marked successful on click or network enqueue; it needs an onboard applied ACK and corroborating telemetry. An ACK timeout means **unknown outcome**, not proof that a command was not executed.

## High-level command release gate

Mode requests may be considered later only when a versioned command channel, server authorization, operator confirmation, onboard transition checks, deduplication, timeout reporting and audit records all work. The Nano should ACK only after the requested mode has actually been applied. Firmware must define allowed transitions and precedence of failsafe. No automatic blind retry after an ambiguous timeout. Test loss, duplication, reordering, reboot, and stale commands. See [UART protocol](uart-protocol.md).

## Mission package release gate

A staged Firebase mission is data for later onboard use, not authority to fly it. The Nano must receive, validate and persist the complete package before acknowledging it, and receipt must not change mode. It must reject unsupported versions, checksum failures, range/waypoint/geofence failures, partial transfers and storage read-back failures without replacing the last valid mission. A physical switch must permit mission mode locally; nRF24 manual override and failsafe must preempt it. The navigator and stabilization loops must continue independently of the NodeMCU, Wi-Fi, Firebase and browser. See [mission planner and onboard transfer](mission-planner.md).

## Ground validation checklist before connecting an aircraft

1. Compare the physical RC and servo movement with command direction, range, neutral and endpoints; verify with propeller removed.
2. Disconnect RC, power the ESP32 separately, lose Wi-Fi, delay UART, corrupt frames, reset each controller, and measure Nano failsafe response independently.
3. Validate voltage against a calibrated meter over the expected battery range; configure divider ratio, ADC attenuation, per-cell thresholds and battery chemistry before any estimated percentage or warning.
4. Calibrate MPU9250 orientation, gyro bias and magnetometer; confirm heading alignment and angle sign conventions on a stationary bench and during controlled motion.
5. Confirm BMP180 pressure reference and filtered vertical speed, and verify NEO-7 fix loss, UTC, ground speed, course, home capture and realistic GPS jumps.
6. Stress test packet corruption, sequence gaps, timeout, clock wrap, telemetry storage interruption and long sessions. Reboot gateway/backend/browser independently while preserving Nano control.
7. Verify Firebase Security Rules with multiple accounts and aircraft, including unauthorized reads/writes and revoked memberships, before enabling cloud data. Test any later command permissions separately before enabling requests.
8. Conduct progressive ground and flight testing under a qualified operator and applicable local rules only after hardware and software gates pass.

The UI's preflight result is not evidence that an uninstrumented mechanical item, propeller installation, radio range, or safe launch area was checked. Manual checks need explicit human acknowledgement and a real checklist; a synthetic status may never produce SYSTEM READY for a physical aircraft.
