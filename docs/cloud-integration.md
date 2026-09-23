# Cloud, direct connectivity and deployment

## Current state

The frontend deploys as static files. It runs a simulation and has no connected Supabase client, authentication, ESP32 endpoint, persistent storage, or secure command delivery. The optional SQL in `supabase/migrations` is a **proposed backend foundation** and is not applied by `npm run build` or the Pages workflow.

## Planned cloud read path

```mermaid
flowchart LR
  E["ESP32"] -->|"HTTPS + device authentication"| I["Trusted ingestion endpoint"]
  I -->|"validated writes"| D["Supabase PostgreSQL"]
  D -->|"RLS-scoped reads / Realtime"| B["Pages browser"]
```

The ESP32 must not contain a Supabase `service_role` key. A public anon key does not authenticate a device and must not grant direct untrusted telemetry inserts. Build an ingestion service or Edge Function that provisions each aircraft, verifies a per-device credential, applies replay protection and rate limiting, validates payloads, then writes using server-side credentials. Keep these credentials in trusted service secrets. Transport must use TLS with certificate verification; do not use `setInsecure()` for deployment. Because TLS validation depends on time, acquire a valid clock (for example NTP) before HTTPS or use a deliberately maintained certificate trust strategy, and reject requests when verification fails. Buffer only a bounded amount of telemetry during outages and include distinct capture and receipt times.

One possible ingestion contract is a versioned `POST /ingest/v1/telemetry` with aircraft/device ID, UTC timestamp, unique nonce, bounded JSON body and HMAC-SHA256 over the exact request bytes and metadata. The server looks up the per-device secret, compares signatures in constant time, rejects timestamps outside a short window and reused nonces, validates sensor ranges and per-aircraft rate, and records a server receipt time. Provisioning, rotation, revocation, key storage and an offline buffering policy must be designed and tested before deployment; this is a specification, not a working endpoint. Loss of Internet must not affect onboard RC/failsafe.

For later browser reads, use Supabase Auth and RLS for aircraft membership. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may be public but do not grant an aircraft role by themselves. The optional migration enables restricted read policies and leaves telemetry/command writes to a trusted backend. Never expose `service_role`, database passwords or device secrets in Vite environment variables, GitHub Pages artifacts, browser local storage, or checked-in firmware.

The proposed SQL stores GPS ground speed as `ground_speed_mps`; the browser telemetry model and labels use km/h. A future cloud adapter must convert m/s to km/h exactly once, and keep unit metadata in ingestion tests.

## Planned direct LAN mode

An HTTPS GitHub Pages document generally cannot open an insecure `http://` or `ws://192.168.x.x` device endpoint due to mixed content and browser private-network restrictions. CORS and network routing add further constraints. A workable field architecture needs deliberate testing of one of these approaches:

1. Serve the cockpit locally from the ESP32's own HTTP origin for bench-only direct access, with explicit source and security limitations.
2. Run a trusted local HTTPS/WSS bridge with a valid certificate and explicit authorization, then connect from the Pages app where browser policy permits.

Do not advise users to disable browser security or infer direct telemetry works just because the ESP32 prints an IP address. Even a local direct path must expose current sample age and clear disconnected state.

## Applying the optional schema

Read [supabase/README.md](../supabase/README.md) first. Use an isolated Supabase project, review the migration, apply through the Supabase CLI or SQL editor, verify every RLS policy with at least two users and two aircraft, and only then build a backend. No production project ID, passwords, device credentials or deployment authorization are in this repository.

## GitHub Pages setup

1. Push this repository to `Turkson225/flight-command-center` with `main` as the default production branch.
2. In **Settings → Pages**, set **Source: GitHub Actions**.
3. Confirm the workflow can install, typecheck/build, upload `dist`, and deploy. Read the actual Actions log for any failed gate.
4. Visit `https://turkson225.github.io/flight-command-center/` after the Pages environment reports success. Test assets, navigation, a nested refresh, mobile layout and the permanent simulation indicator.

The configured Vite base path is `/flight-command-center/`. GitHub Pages is static hosting, so application navigation must use a Pages-compatible strategy such as hash routes; a pathname-only SPA route would require explicit fallback handling. The Pages release proves only that static assets were deployed. It does not prove an ESP32, Supabase, GPS, or aircraft command is online.
