# Optional Supabase foundation

`migrations/20260923000000_foundation.sql` is a **proposed** PostgreSQL schema for a later live telemetry backend. The simulation UI does not import a Supabase client, authenticate users, or read/write these tables. Applying this migration alone will not connect the ESP32 or enable browser commands.

## Tables and access

The migration creates `profiles`, `aircraft`, `aircraft_memberships`, `flight_sessions`, `telemetry`, `gps_tracks`, `flight_events`, `alerts`, `commands`, `sensor_health`, `aircraft_settings`, `maintenance_records`, and `system_logs`. Each aircraft-linked read requires an authenticated user with a row in `aircraft_memberships`. A user can see only their own membership and profile. The membership role enum is `OWNER`, `ADMIN`, `PILOT`, `ENGINEER`, or `VIEWER` for later server-side authorization.

RLS is enabled on every table and no client role has an insert/update/delete grant. All ingestion, membership setup, session lifecycle, alert transitions, audit events and command state transitions are reserved for trusted server code. Do **not** casually add client write policies: command admission must check authenticated identity, role, aircraft state, expiration, permitted command and audit requirements at a trusted endpoint. A service-role key bypasses RLS and must stay server side.

The migration does not create a user-profile trigger, default owner, test aircraft, device credential, Edge Function, public Realtime publication, storage policy, retention job or implicit command relay. Provisioning and secure ingestion are separate tasks.

## Apply and verify

1. Create a separate Supabase project for development. Review the SQL and take a backup if applying to an existing project.
2. Apply the migration with your normal Supabase migration workflow or the SQL editor. It is intended for a fresh project; do not treat it as an idempotent patch to existing tables.
3. Create test users via Supabase Auth. From a trusted admin path, insert a profile and membership for one user and aircraft; repeat for a second aircraft and unrelated user.
4. Verify authenticated SELECT sees only aircraft the user belongs to; anonymous SELECT sees nothing; cross-aircraft telemetry and commands are invisible. Verify both authenticated and anonymous INSERT/UPDATE/DELETE fail, including attempts to create one's own membership or forge `ACKNOWLEDGED`.
5. Verify backend writes with a narrowly scoped server service, and log the device identity independently from the human operator identity. Revoke a membership and confirm reads stop.
6. Design a retention policy and bounded sample rate before live uploads. UTC `sampled_at` and `received_at` must be distinguished; store unknown sensor values as SQL `NULL`, never zero by default.

Keep any `SUPABASE_SERVICE_ROLE_KEY`, database password and device credential outside Vite variables and outside this repository. See [cloud integration](../docs/cloud-integration.md) for the ESP32 HTTPS ingestion boundary.
