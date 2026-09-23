# System architecture and telemetry contract

## Control and observation

The Arduino Nano is the only controller responsible for time-sensitive aircraft behavior: RC link processing, servo and ESC signals, mode rules, and failsafe. The ESP32 reads Nano state via UART, receives navigation/sensor inputs, and eventually forwards validated telemetry. The browser is an observer and future high-level command requester. Losing power or connectivity to the ESP32, backend, or browser must not change the Nano's ability to apply its onboard failsafe.

```mermaid
flowchart TB
  R["RC receiver"] --> N["Nano: control + failsafe"]
  N <-->|"UART v1 state / future requests"| E["ESP32: sensors + telemetry gateway"]
  S["MPU9250 · BMP180 · NEO-7 · voltage"] --> E
  E -->|"planned HTTPS"| B["Trusted ingestion + storage"]
  B -->|"planned authenticated read"| U["Cockpit on GitHub Pages"]
  M["Simulated source"] -->|"available now"| U
```

## Telemetry source state

The browser model should carry an explicit source (`simulation`, `cloud`, `direct`, `offline`), receipt timestamp, and validity/health per measurement. Selecting a planned source that has no adapter must present it as unavailable; it must never quietly switch to simulation and label synthetic values live.

| Field | Producer | Units / interpretation | Invalid state |
| --- | --- | --- | --- |
| Roll and pitch | Calibrated MPU9250 gyro + accelerometer fusion on ESP32 | Degrees; aircraft attitude, with mounting alignment and filter validation | `null` with stale/error health |
| Yaw / magnetic heading | Calibrated MPU9250 gyro + tilt-compensated magnetometer fusion on ESP32 | Degrees; heading normalized to [0, 360), referenced to magnetic north unless declination correction is applied | `null` with stale/error health |
| GPS latitude, longitude, fix, satellites, HDOP | NEO-7 | WGS84 degrees; boolean fix; count; dimensionless HDOP | Coordinates `null` when no valid fix |
| GPS ground speed and course | NEO-7 | km/h and degrees in the browser model; convert raw GPS or stored m/s at the adapter boundary; **not airspeed** | `null` without valid position/velocity |
| Pressure, temperature, barometric altitude | BMP180 | hPa, °C, metres; altitude relative to configured reference | `null` if unavailable |
| Battery voltage | Calibrated ADC divider on ESP32 | Volts at aircraft battery; percent is estimate requiring battery profile | `null` on ADC fault |
| Throttle, control axes, mode, RC and failsafe state | Nano UART v1 | Normalized demand and actual reported mode | Stale when UART stops; never infer servo feedback |

The data model should distinguish raw measurements, derived navigation outputs, and source/quality metadata. A stale reading can remain visible as last known, but must show its age and stale state. A missing value is not zero. Sensor-specific failure does not imply all other sensors failed.

The aircraft attitude view should consume roll and pitch from the fused IMU solution and a separately labeled magnetic heading. Hard-iron and soft-iron magnetometer calibration, tilt compensation, sensor mounting alignment, and magnetic interference checks are required before heading can be trusted. The gyroscope's integrated yaw drifts without an external reference; a magnetometer can constrain it only when its quality is acceptable. Keep GPS course over ground separate from heading: course describes movement and may be unavailable or noisy when nearly stationary. Attach a source timestamp and per-output validity/quality so the view can hold a last-known pose with an explicit age and stale indication. The current browser renders simulated values; live ESP32 fusion and transport remain future integration work.

## Frequency, freshness and storage

- Target Nano state packet rate: 10 Hz during later bench validation; this is a design target rather than a verified rate.
- Target visual updates: around 5–10 Hz when actual telemetry supports them; animation between packets does not create new measurements.
- Historical samples: plan a configurable lower rate such as 1–2 Hz; retain a bounded live chart buffer and apply explicit server retention rather than storing every sensor read forever.
- Use monotonic clock time for local packet age; source `uptime_ms` is not synchronized with browser, ESP32, or UTC clocks.
- Device and backend should attach a trusted receipt timestamp. Capture GPS UTC where available, but do not use an unverified device clock as proof of freshness.
- An alert needs state (`active`, `acknowledged`, `resolved`), severity, source, timestamps, and a testable threshold with hysteresis. Acknowledging a UI alert is not resolving an aircraft fault.

## Navigation semantics

Set home only after a valid GPS fix and a deliberate rule or operator action. Home coordinates, distance and bearing become unavailable when home or fix is absent. GPS speed is ground speed. Vertical speed from filtered barometric altitude is an estimate, not a direct BMP180 measurement. The dashboard must not imply true airspeed, wind, geofence enforcement, autonomous waypoint flight, or actual servo positions until those are instrumented and implemented onboard.

## Proposed trust boundaries

The Nano's control loop trusts only its verified RC and onboard inputs. It should validate any high-level UART request and reject it during failsafe or unsafe transitions. The ESP32 should reject malformed UART and sensor samples before onward transport. A trusted HTTPS endpoint should authenticate the aircraft and validate timestamps, ranges, sequence, and rate limits; the browser should only read aircraft allowed by its authenticated role. See [cloud integration](cloud-integration.md) and [safety](safety.md).

## Milestone status

Current delivery is the browser simulation and visual shell. This document describes the target architecture. It does not assert that wiring, calibration, UART exchange, sensor fusion, cloud ingestion, or flight behavior has been implemented or field tested.
