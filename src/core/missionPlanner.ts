import type { AircraftTelemetry } from './telemetry';

export type MissionAction = 'waypoint' | 'loiter' | 'return-home';

export interface MissionPosition {
  latitude: number;
  longitude: number;
}

export interface MissionHome extends MissionPosition {
  confirmedByOperator: boolean;
}

export interface MissionWaypoint extends MissionPosition {
  id: string;
  altitudeM: number;
  targetSpeedKmh: number;
  acceptanceRadiusM: number;
  action: MissionAction;
  loiterSeconds: number;
}

export interface MissionDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  aircraftId: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  home: MissionHome;
  geofenceRadiusM: number;
  waypoints: MissionWaypoint[];
  checksum: string;
}

export interface MissionValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  waypointId?: string;
}

export interface MissionMetrics {
  routeDistanceM: number;
  estimatedDurationSec: number;
  maximumAltitudeM: number | null;
  waypointCount: number;
}

export interface MissionProgress {
  activeWaypointIndex: number | null;
  activeWaypointId: string | null;
  distanceToWaypointM: number | null;
  distanceRemainingM: number;
  crossTrackErrorM: number | null;
  completed: boolean;
}

export interface MissionSimulationFrame {
  position: MissionPosition;
  activeWaypointIndex: number;
  elapsedSec: number;
  completed: boolean;
  phase: 'travel' | 'loiter' | 'complete';
}

export const MISSION_LIMITS = {
  maxWaypoints: 25,
  minAltitudeM: 10,
  maxAltitudeM: 500,
  minTargetSpeedKmh: 15,
  maxTargetSpeedKmh: 160,
  minAcceptanceRadiusM: 10,
  maxAcceptanceRadiusM: 300,
  minGeofenceRadiusM: 100,
  maxGeofenceRadiusM: 5_000,
  maxLegDistanceM: 20_000,
  maxRouteDistanceM: 100_000,
} as const;

const EARTH_RADIUS_M = 6_371_000;
const MISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WAYPOINT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const AIRCRAFT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const CHECKSUM = /^[A-F0-9]{8}$/;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPosition(position: MissionPosition | null | undefined) {
  return finite(position?.latitude) && Math.abs(position.latitude) <= 90 &&
    finite(position?.longitude) && Math.abs(position.longitude) <= 180;
}

function normalizedLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180;
}

export function distanceMetres(from: MissionPosition, to: MissionPosition) {
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = normalizedLongitude(to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDegrees(from: MissionPosition, to: MissionPosition) {
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const deltaLon = normalizedLongitude(to.longitude - from.longitude) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function crc32(text: string) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < text.length; index += 1) {
    crc ^= text.charCodeAt(index);
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/** Canonical transfer text is deliberately simple enough to reproduce on the Nano. */
export function canonicalMissionPayload(mission: Omit<MissionDocument, 'checksum'> | MissionDocument) {
  const waypointText = mission.waypoints.map((waypoint, index) => [
    index,
    waypoint.id,
    waypoint.latitude.toFixed(6),
    waypoint.longitude.toFixed(6),
    waypoint.altitudeM.toFixed(1),
    waypoint.targetSpeedKmh.toFixed(1),
    waypoint.acceptanceRadiusM.toFixed(1),
    waypoint.action,
    waypoint.loiterSeconds.toFixed(0),
  ].join(',')).join(';');
  return [
    'FCCM1', mission.id, mission.aircraftId, mission.revision,
    mission.home.latitude.toFixed(6), mission.home.longitude.toFixed(6),
    mission.home.confirmedByOperator ? 1 : 0,
    mission.geofenceRadiusM.toFixed(1), mission.waypoints.length, waypointText,
  ].join('|');
}

export function missionChecksum(mission: Omit<MissionDocument, 'checksum'> | MissionDocument) {
  try { return crc32(canonicalMissionPayload(mission)); } catch { return '00000000'; }
}

export function sealMission(mission: Omit<MissionDocument, 'checksum'> | MissionDocument, updatedAt = Date.now()): MissionDocument {
  const next = { ...mission, updatedAt } as MissionDocument;
  return { ...next, checksum: missionChecksum(next) };
}

function missionId(now = Date.now()) {
  return `mission-${now.toString(36)}`;
}

export function telemetryHome(snapshot: AircraftTelemetry | null): MissionPosition | null {
  if (snapshot && finite(snapshot.navigation.homeLatitude) && finite(snapshot.navigation.homeLongitude)) {
    return { latitude: snapshot.navigation.homeLatitude, longitude: snapshot.navigation.homeLongitude };
  }
  if (snapshot?.navigation.gpsFix && finite(snapshot.navigation.latitude) && finite(snapshot.navigation.longitude)) {
    return { latitude: snapshot.navigation.latitude, longitude: snapshot.navigation.longitude };
  }
  return null;
}

export function createMission(aircraftId: string, home?: MissionPosition | null, now = Date.now()): MissionDocument {
  const position = home && validPosition(home) ? home : { latitude: 5.60372, longitude: -0.18696 };
  return sealMission({
    schemaVersion: 1,
    id: missionId(now),
    name: 'New mission',
    aircraftId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    home: { ...position, confirmedByOperator: false },
    geofenceRadiusM: 500,
    waypoints: [],
  }, now);
}

export function updateMission(mission: MissionDocument, changes: Partial<Omit<MissionDocument, 'schemaVersion' | 'id' | 'aircraftId' | 'createdAt' | 'checksum'>>, now = Date.now()) {
  return sealMission({ ...mission, ...changes, revision: mission.revision + 1 }, now);
}

export function createWaypoint(position: MissionPosition, index: number): MissionWaypoint {
  return {
    id: `WP-${String(index + 1).padStart(2, '0')}-${Date.now().toString(36).slice(-4)}`,
    latitude: Number(position.latitude.toFixed(6)),
    longitude: Number(position.longitude.toFixed(6)),
    altitudeM: 80,
    targetSpeedKmh: 55,
    acceptanceRadiusM: 35,
    action: 'waypoint',
    loiterSeconds: 30,
  };
}

export function missionMetrics(mission: MissionDocument): MissionMetrics {
  let previous: MissionPosition = mission.home;
  let routeDistanceM = 0;
  let estimatedDurationSec = 0;
  for (const waypoint of mission.waypoints) {
    if (!validPosition(previous) || !validPosition(waypoint)) continue;
    const leg = distanceMetres(previous, waypoint);
    routeDistanceM += leg;
    if (finite(waypoint.targetSpeedKmh) && waypoint.targetSpeedKmh > 0) estimatedDurationSec += leg / (waypoint.targetSpeedKmh / 3.6);
    if (waypoint.action === 'loiter' && finite(waypoint.loiterSeconds)) estimatedDurationSec += Math.max(0, waypoint.loiterSeconds);
    previous = waypoint;
  }
  const altitudes = mission.waypoints.map(waypoint => waypoint.altitudeM).filter(finite);
  return {
    routeDistanceM,
    estimatedDurationSec,
    maximumAltitudeM: altitudes.length ? Math.max(...altitudes) : null,
    waypointCount: mission.waypoints.length,
  };
}

export function validateMission(mission: MissionDocument): MissionValidationIssue[] {
  const issues: MissionValidationIssue[] = [];
  const error = (code: string, message: string, waypointId?: string) => issues.push({ code, message, waypointId, severity: 'error' });
  const warning = (code: string, message: string, waypointId?: string) => issues.push({ code, message, waypointId, severity: 'warning' });
  if (mission.schemaVersion !== 1) error('schema', 'Only mission schema version 1 is supported.');
  if (!MISSION_ID.test(mission.id)) error('mission-id', 'Mission ID is invalid.');
  if (!AIRCRAFT_ID.test(mission.aircraftId)) error('aircraft-id', 'Aircraft ID is invalid.');
  if (typeof mission.name !== 'string' || !mission.name.trim() || mission.name.length > 60) error('name', 'Mission name must contain 1–60 characters.');
  if (!Number.isSafeInteger(mission.revision) || mission.revision < 1) error('revision', 'Mission revision must be a positive integer.');
  if (!validPosition(mission.home)) error('home-position', 'Home latitude and longitude are invalid.');
  if (!mission.home?.confirmedByOperator) error('home-confirmation', 'The operator must verify and confirm HOME.');
  if (!finite(mission.geofenceRadiusM) || mission.geofenceRadiusM < MISSION_LIMITS.minGeofenceRadiusM || mission.geofenceRadiusM > MISSION_LIMITS.maxGeofenceRadiusM) error('geofence', `Geofence radius must be ${MISSION_LIMITS.minGeofenceRadiusM}–${MISSION_LIMITS.maxGeofenceRadiusM} m.`);
  if (!Array.isArray(mission.waypoints) || mission.waypoints.length < 1 || mission.waypoints.length > MISSION_LIMITS.maxWaypoints) error('waypoint-count', `Add 1–${MISSION_LIMITS.maxWaypoints} waypoints.`);

  const ids = new Set<string>();
  let previous: MissionPosition = mission.home;
  mission.waypoints.forEach((waypoint, index) => {
    if (!WAYPOINT_ID.test(waypoint.id) || ids.has(waypoint.id)) error('waypoint-id', `Waypoint ${index + 1} needs a unique valid ID.`, waypoint.id);
    ids.add(waypoint.id);
    if (!validPosition(waypoint)) error('waypoint-position', `Waypoint ${index + 1} has invalid coordinates.`, waypoint.id);
    if (!finite(waypoint.altitudeM) || waypoint.altitudeM < MISSION_LIMITS.minAltitudeM || waypoint.altitudeM > MISSION_LIMITS.maxAltitudeM) error('altitude', `Waypoint ${index + 1} altitude must be ${MISSION_LIMITS.minAltitudeM}–${MISSION_LIMITS.maxAltitudeM} m AGL.`, waypoint.id);
    if (!finite(waypoint.targetSpeedKmh) || waypoint.targetSpeedKmh < MISSION_LIMITS.minTargetSpeedKmh || waypoint.targetSpeedKmh > MISSION_LIMITS.maxTargetSpeedKmh) error('speed', `Waypoint ${index + 1} target speed must be ${MISSION_LIMITS.minTargetSpeedKmh}–${MISSION_LIMITS.maxTargetSpeedKmh} km/h.`, waypoint.id);
    if (!finite(waypoint.acceptanceRadiusM) || waypoint.acceptanceRadiusM < MISSION_LIMITS.minAcceptanceRadiusM || waypoint.acceptanceRadiusM > MISSION_LIMITS.maxAcceptanceRadiusM) error('acceptance', `Waypoint ${index + 1} acceptance radius must be ${MISSION_LIMITS.minAcceptanceRadiusM}–${MISSION_LIMITS.maxAcceptanceRadiusM} m.`, waypoint.id);
    if (!['waypoint', 'loiter', 'return-home'].includes(waypoint.action)) error('action', `Waypoint ${index + 1} has an unsupported action.`, waypoint.id);
    if (waypoint.action === 'loiter' && (!Number.isSafeInteger(waypoint.loiterSeconds) || waypoint.loiterSeconds < 5 || waypoint.loiterSeconds > 1_800)) error('loiter', `Waypoint ${index + 1} loiter time must be 5–1800 seconds.`, waypoint.id);
    if (validPosition(mission.home) && validPosition(waypoint) && finite(mission.geofenceRadiusM) && distanceMetres(mission.home, waypoint) > mission.geofenceRadiusM) error('outside-geofence', `Waypoint ${index + 1} is outside the advisory geofence.`, waypoint.id);
    if (validPosition(previous) && validPosition(waypoint) && distanceMetres(previous, waypoint) > MISSION_LIMITS.maxLegDistanceM) error('leg-distance', `Leg ${index + 1} exceeds ${MISSION_LIMITS.maxLegDistanceM / 1000} km.`, waypoint.id);
    if (waypoint.action === 'return-home') {
      if (index !== mission.waypoints.length - 1) error('return-order', 'Return-home must be the final mission action.', waypoint.id);
      if (validPosition(mission.home) && validPosition(waypoint) && distanceMetres(mission.home, waypoint) > 2) error('return-position', 'Return-home coordinates must match the confirmed HOME.', waypoint.id);
    }
    previous = waypoint;
  });
  const metrics = missionMetrics(mission);
  if (metrics.routeDistanceM > MISSION_LIMITS.maxRouteDistanceM) error('route-distance', `Route exceeds ${MISSION_LIMITS.maxRouteDistanceM / 1000} km.`);
  if (mission.waypoints.length && !mission.waypoints.some(waypoint => waypoint.action === 'return-home')) warning('no-return-home', 'Mission has no return-home action.');
  warning('ground-speed', 'Target speed is a navigation target; no airspeed sensor is installed.');
  if (!CHECKSUM.test(mission.checksum) || mission.checksum !== missionChecksum(mission)) error('checksum', 'Mission checksum does not match its route data.');
  return issues;
}

export function parseMissionJson(text: string): { ok: true; mission: MissionDocument; issues: MissionValidationIssue[] } | { ok: false; message: string } {
  try {
    const value = JSON.parse(text) as MissionDocument;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.waypoints) || !value.home) throw new Error('Mission object is incomplete.');
    const issues = validateMission(value);
    if (issues.some(issue => issue.code === 'schema' || issue.code === 'mission-id' || issue.code === 'aircraft-id' || issue.code === 'checksum')) return { ok: false, message: issues.find(issue => issue.severity === 'error')?.message ?? 'Mission JSON is invalid.' };
    return { ok: true, mission: value, issues };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Mission JSON is invalid.' };
  }
}

function interpolate(from: MissionPosition, to: MissionPosition, ratio: number): MissionPosition {
  const deltaLongitude = normalizedLongitude(to.longitude - from.longitude);
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * ratio,
    longitude: normalizedLongitude(from.longitude + deltaLongitude * ratio),
  };
}

export function simulateMissionAt(mission: MissionDocument, elapsedSec: number): MissionSimulationFrame {
  let remaining = Math.max(0, elapsedSec);
  let previous: MissionPosition = mission.home;
  if (!mission.waypoints.length) return { position: previous, activeWaypointIndex: 0, elapsedSec, completed: true, phase: 'complete' };
  for (let index = 0; index < mission.waypoints.length; index += 1) {
    const waypoint = mission.waypoints[index];
    const legDistance = distanceMetres(previous, waypoint);
    const travelSeconds = legDistance / Math.max(.1, waypoint.targetSpeedKmh / 3.6);
    if (remaining < travelSeconds) return { position: interpolate(previous, waypoint, travelSeconds ? remaining / travelSeconds : 1), activeWaypointIndex: index, elapsedSec, completed: false, phase: 'travel' };
    remaining -= travelSeconds;
    if (waypoint.action === 'loiter' && remaining < waypoint.loiterSeconds) return { position: { latitude: waypoint.latitude, longitude: waypoint.longitude }, activeWaypointIndex: index, elapsedSec, completed: false, phase: 'loiter' };
    if (waypoint.action === 'loiter') remaining -= waypoint.loiterSeconds;
    previous = waypoint;
  }
  return { position: previous, activeWaypointIndex: mission.waypoints.length - 1, elapsedSec, completed: true, phase: 'complete' };
}

function localPoint(origin: MissionPosition, point: MissionPosition) {
  const latitudeRadians = origin.latitude * Math.PI / 180;
  return {
    x: normalizedLongitude(point.longitude - origin.longitude) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latitudeRadians),
    y: (point.latitude - origin.latitude) * Math.PI / 180 * EARTH_RADIUS_M,
  };
}

export function missionProgress(mission: MissionDocument, position: MissionPosition | null, activeWaypointIndexHint: number | null = null): MissionProgress {
  if (!position || !validPosition(position) || !mission.waypoints.length) return { activeWaypointIndex: null, activeWaypointId: null, distanceToWaypointM: null, distanceRemainingM: missionMetrics(mission).routeDistanceM, crossTrackErrorM: null, completed: false };
  const points: MissionPosition[] = [mission.home, ...mission.waypoints];
  let best = { segment: 0, distance: Infinity, t: 0, cross: 0 };
  const hintedIndex = Number.isSafeInteger(activeWaypointIndexHint) && activeWaypointIndexHint! >= 0 && activeWaypointIndexHint! < mission.waypoints.length ? activeWaypointIndexHint : null;
  const segments = hintedIndex == null ? mission.waypoints.map((_, index) => index) : [hintedIndex];
  for (const index of segments) {
    const end = localPoint(points[index], points[index + 1]);
    const aircraft = localPoint(points[index], position);
    const lengthSquared = end.x * end.x + end.y * end.y;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (aircraft.x * end.x + aircraft.y * end.y) / lengthSquared)) : 0;
    const nearest = { x: end.x * t, y: end.y * t };
    const dx = aircraft.x - nearest.x;
    const dy = aircraft.y - nearest.y;
    const distance = Math.hypot(dx, dy);
    const cross = lengthSquared > 0 ? (end.x * aircraft.y - end.y * aircraft.x) / Math.sqrt(lengthSquared) : 0;
    if (distance < best.distance) best = { segment: index, distance, t, cross };
  }
  const last = mission.waypoints.at(-1)!;
  const completed = best.segment === mission.waypoints.length - 1 && best.t >= .9 && distanceMetres(position, last) <= last.acceptanceRadiusM;
  if (completed) return { activeWaypointIndex: null, activeWaypointId: null, distanceToWaypointM: 0, distanceRemainingM: 0, crossTrackErrorM: best.cross, completed: true };
  let remaining = distanceMetres(points[best.segment], points[best.segment + 1]) * (1 - best.t);
  for (let index = best.segment + 1; index < points.length - 1; index += 1) remaining += distanceMetres(points[index], points[index + 1]);
  const waypoint = mission.waypoints[best.segment];
  return {
    activeWaypointIndex: best.segment,
    activeWaypointId: waypoint.id,
    distanceToWaypointM: distanceMetres(position, waypoint),
    distanceRemainingM: remaining,
    crossTrackErrorM: best.cross,
    completed: false,
  };
}
