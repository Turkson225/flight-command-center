import { describe, expect, it } from 'vitest';
import {
  createMission,
  distanceMetres,
  missionChecksum,
  missionMetrics,
  missionProgress,
  parseMissionJson,
  sealMission,
  simulateMissionAt,
  validateMission,
  type MissionDocument,
  type MissionWaypoint,
} from './missionPlanner';

const HOME = { latitude: 5.60372, longitude: -0.18696 };

function waypoint(id: string, latitude: number, longitude: number, action: MissionWaypoint['action'] = 'waypoint'): MissionWaypoint {
  return {
    id,
    latitude,
    longitude,
    altitudeM: 80,
    targetSpeedKmh: 54,
    acceptanceRadiusM: 25,
    action,
    loiterSeconds: action === 'loiter' ? 20 : 0,
  };
}

function validMission(): MissionDocument {
  const draft = createMission('FD-X1', HOME, 1_800_000_000_000);
  return sealMission({
    ...draft,
    name: 'Bench route',
    home: { ...HOME, confirmedByOperator: true },
    geofenceRadiusM: 1_000,
    waypoints: [
      waypoint('WP-01', 5.60462, -0.18696, 'loiter'),
      waypoint('WP-02', 5.60462, -0.18606),
      waypoint('WP-03-RTH', HOME.latitude, HOME.longitude, 'return-home'),
    ],
  }, 1_800_000_001_000);
}

describe('mission package validation', () => {
  it('accepts a sealed, confirmed route and keeps the CRC deterministic', () => {
    const mission = validMission();
    expect(mission.checksum).toMatch(/^[0-9A-F]{8}$/);
    expect(missionChecksum({ ...mission, updatedAt: mission.updatedAt + 5_000 })).toBe(mission.checksum);
    expect(validateMission(mission).filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('detects route mutations, geofence breaches and misplaced return-home actions', () => {
    const mission = validMission();
    const changed = { ...mission, waypoints: mission.waypoints.map((item, index) => index === 0 ? { ...item, latitude: 5.7, action: 'return-home' as const } : item) };
    const codes = validateMission(changed).map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['checksum', 'outside-geofence', 'return-order', 'return-position']));
  });

  it('rejects imported JSON when its checksum was altered', () => {
    const mission = validMission();
    const result = parseMissionJson(JSON.stringify({ ...mission, checksum: '00000000' }));
    expect(result.ok).toBe(false);
  });
});

describe('mission navigation calculations', () => {
  it('calculates route distance, loiter duration and simulation completion', () => {
    const mission = validMission();
    const metrics = missionMetrics(mission);
    expect(metrics.routeDistanceM).toBeGreaterThan(250);
    expect(metrics.estimatedDurationSec).toBeGreaterThan(35);
    const midway = simulateMissionAt(mission, metrics.estimatedDurationSec / 2);
    expect(midway.completed).toBe(false);
    const complete = simulateMissionAt(mission, metrics.estimatedDurationSec);
    expect(complete.completed).toBe(true);
    expect(complete.position.latitude).toBe(HOME.latitude);
    expect(complete.position.longitude).toBe(HOME.longitude);
  });

  it('reports the active leg, remaining route and signed cross-track error', () => {
    const mission = validMission();
    const first = mission.waypoints[0];
    const position = { latitude: (HOME.latitude + first.latitude) / 2, longitude: HOME.longitude + .0001 };
    const progress = missionProgress(mission, position, 0);
    expect(progress.activeWaypointIndex).toBe(0);
    expect(progress.distanceRemainingM).toBeGreaterThan(distanceMetres(position, first));
    expect(Math.abs(progress.crossTrackErrorM ?? 0)).toBeGreaterThan(5);
  });

  it('does not confuse the start at HOME with completion of a return-home route', () => {
    const mission = validMission();
    expect(missionProgress(mission, HOME, 0).completed).toBe(false);
    expect(missionProgress(mission, HOME, mission.waypoints.length - 1).completed).toBe(true);
  });
});
