-- Optional foundation for a future, trusted telemetry backend.
-- Apply to a fresh Supabase project after reviewing supabase/README.md.
-- No anon/authenticated writes are granted; server code must explicitly authorize all writes.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.aircraft (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  registration text,
  aircraft_type text not null default 'FIXED_WING',
  firmware_version text,
  esp32_version text,
  nano_version text,
  battery_type text,
  status text not null default 'UNKNOWN' check (status in ('UNKNOWN', 'AVAILABLE', 'IN_FLIGHT', 'MAINTENANCE')),
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table public.aircraft_memberships (
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'PILOT', 'ENGINEER', 'VIEWER')),
  created_at timestamptz not null default now(),
  primary key (aircraft_id, user_id)
);
create index aircraft_memberships_user_idx on public.aircraft_memberships (user_id, aircraft_id);

create table public.flight_sessions (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  operator_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz check (ended_at is null or ended_at >= started_at),
  takeoff_lat double precision check (takeoff_lat between -90 and 90),
  takeoff_lon double precision check (takeoff_lon between -180 and 180),
  landing_lat double precision check (landing_lat between -90 and 90),
  landing_lon double precision check (landing_lon between -180 and 180),
  max_altitude_m double precision,
  max_ground_speed_mps double precision check (max_ground_speed_mps >= 0),
  min_voltage_v double precision check (min_voltage_v >= 0),
  distance_m double precision check (distance_m >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (id, aircraft_id),
  check ((takeoff_lat is null) = (takeoff_lon is null)),
  check ((landing_lat is null) = (landing_lon is null))
);
create index flight_sessions_aircraft_started_idx on public.flight_sessions (aircraft_id, started_at desc);

create table public.telemetry (
  id bigint generated always as identity primary key,
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  flight_id uuid,
  sampled_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_sequence integer check (source_sequence between 0 and 65535),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  gps_fix boolean,
  gps_altitude_m double precision,
  barometric_altitude_m double precision,
  ground_speed_mps double precision check (ground_speed_mps >= 0),
  course_deg double precision check (course_deg >= 0 and course_deg < 360),
  heading_deg double precision check (heading_deg >= 0 and heading_deg < 360),
  roll_deg double precision check (roll_deg between -180 and 180),
  pitch_deg double precision check (pitch_deg between -90 and 90),
  battery_voltage_v double precision check (battery_voltage_v >= 0),
  battery_percent_estimate double precision check (battery_percent_estimate between 0 and 100),
  satellites integer check (satellites >= 0),
  hdop double precision check (hdop >= 0),
  flight_mode text,
  rc_link boolean,
  failsafe boolean,
  quality jsonb not null default '{}'::jsonb,
  constraint telemetry_flight_fk foreign key (flight_id, aircraft_id)
    references public.flight_sessions(id, aircraft_id) on delete cascade,
  check ((latitude is null) = (longitude is null))
);
create index telemetry_aircraft_time_idx on public.telemetry (aircraft_id, sampled_at desc);
create index telemetry_flight_time_idx on public.telemetry (flight_id, sampled_at) where flight_id is not null;

create table public.gps_tracks (
  id bigint generated always as identity primary key,
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  flight_id uuid not null,
  sampled_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  altitude_m double precision,
  ground_speed_mps double precision check (ground_speed_mps >= 0),
  constraint gps_tracks_flight_fk foreign key (flight_id, aircraft_id)
    references public.flight_sessions(id, aircraft_id) on delete cascade
);
create index gps_tracks_flight_time_idx on public.gps_tracks (flight_id, sampled_at);

create table public.flight_events (
  id bigint generated always as identity primary key,
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  flight_id uuid,
  occurred_at timestamptz not null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  source text not null check (char_length(source) between 1 and 80),
  details jsonb not null default '{}'::jsonb,
  constraint flight_events_flight_fk foreign key (flight_id, aircraft_id)
    references public.flight_sessions(id, aircraft_id) on delete cascade
);
create index flight_events_flight_time_idx on public.flight_events (flight_id, occurred_at);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  flight_id uuid,
  severity text not null check (severity in ('ADVISORY', 'CAUTION', 'WARNING')),
  alert_type text not null check (char_length(alert_type) between 1 and 80),
  message text not null,
  source text not null,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  constraint alerts_flight_fk foreign key (flight_id, aircraft_id)
    references public.flight_sessions(id, aircraft_id) on delete cascade,
  check ((acknowledged_by is null) = (acknowledged_at is null))
);
create index alerts_aircraft_time_idx on public.alerts (aircraft_id, created_at desc);

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  operator_id uuid references auth.users(id) on delete set null,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENDING', 'SENT', 'ACKNOWLEDGED', 'REJECTED', 'TIMEOUT', 'FAILED')),
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz not null,
  wire_command_id char(16) unique check (wire_command_id ~ '^[0-9A-F]{16}$'),
  result jsonb,
  check (expires_at > requested_at)
);
create index commands_aircraft_time_idx on public.commands (aircraft_id, requested_at desc);

create table public.sensor_health (
  id bigint generated always as identity primary key,
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  sensor_type text not null,
  status text not null check (status in ('OK', 'DEGRADED', 'ERROR', 'UNAVAILABLE')),
  observed_at timestamptz not null,
  details jsonb not null default '{}'::jsonb
);
create index sensor_health_aircraft_time_idx on public.sensor_health (aircraft_id, observed_at desc);

create table public.aircraft_settings (
  aircraft_id uuid primary key references public.aircraft(id) on delete cascade,
  battery_profile jsonb not null default '{}'::jsonb,
  alert_thresholds jsonb not null default '{}'::jsonb,
  telemetry_config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null,
  description text not null,
  next_due_at timestamptz,
  created_at timestamptz not null default now()
);
create index maintenance_records_aircraft_time_idx on public.maintenance_records (aircraft_id, performed_at desc);

create table public.system_logs (
  id bigint generated always as identity primary key,
  aircraft_id uuid not null references public.aircraft(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  level text not null check (level in ('INFO', 'WARNING', 'ERROR')),
  event_type text not null,
  details jsonb not null default '{}'::jsonb
);
create index system_logs_aircraft_time_idx on public.system_logs (aircraft_id, occurred_at desc);

-- Deny browser writes by both privilege and RLS. Ingest via an authenticated
-- trusted server that performs its own device and human authorization.
revoke all on table public.profiles, public.aircraft, public.aircraft_memberships,
  public.flight_sessions, public.telemetry, public.gps_tracks, public.flight_events,
  public.alerts, public.commands, public.sensor_health, public.aircraft_settings,
  public.maintenance_records, public.system_logs from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.aircraft enable row level security;
alter table public.aircraft_memberships enable row level security;
alter table public.flight_sessions enable row level security;
alter table public.telemetry enable row level security;
alter table public.gps_tracks enable row level security;
alter table public.flight_events enable row level security;
alter table public.alerts enable row level security;
alter table public.commands enable row level security;
alter table public.sensor_health enable row level security;
alter table public.aircraft_settings enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.system_logs enable row level security;

grant select on table public.profiles, public.aircraft, public.aircraft_memberships,
  public.flight_sessions, public.telemetry, public.gps_tracks, public.flight_events,
  public.alerts, public.commands, public.sensor_health, public.aircraft_settings,
  public.maintenance_records, public.system_logs to authenticated;

create policy profiles_self_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy memberships_self_read on public.aircraft_memberships for select to authenticated
  using (user_id = (select auth.uid()));

create policy aircraft_member_read on public.aircraft for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = aircraft.id and m.user_id = (select auth.uid())));
create policy sessions_member_read on public.flight_sessions for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = flight_sessions.aircraft_id and m.user_id = (select auth.uid())));
create policy telemetry_member_read on public.telemetry for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = telemetry.aircraft_id and m.user_id = (select auth.uid())));
create policy tracks_member_read on public.gps_tracks for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = gps_tracks.aircraft_id and m.user_id = (select auth.uid())));
create policy events_member_read on public.flight_events for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = flight_events.aircraft_id and m.user_id = (select auth.uid())));
create policy alerts_member_read on public.alerts for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = alerts.aircraft_id and m.user_id = (select auth.uid())));
create policy commands_member_read on public.commands for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = commands.aircraft_id and m.user_id = (select auth.uid())));
create policy sensor_member_read on public.sensor_health for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = sensor_health.aircraft_id and m.user_id = (select auth.uid())));
create policy settings_member_read on public.aircraft_settings for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = aircraft_settings.aircraft_id and m.user_id = (select auth.uid())));
create policy maintenance_member_read on public.maintenance_records for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = maintenance_records.aircraft_id and m.user_id = (select auth.uid())));
create policy logs_member_read on public.system_logs for select to authenticated
  using (exists (select 1 from public.aircraft_memberships m
                where m.aircraft_id = system_logs.aircraft_id and m.user_id = (select auth.uid())));
