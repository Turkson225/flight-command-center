import { describe, expect, it } from 'vitest';
import { createSimulationSnapshot, navigationToHome } from './simulation';
import { getTelemetryAgeMs, getTelemetryStatus, normalizeHeading, shortestHeadingDelta } from './telemetry';

describe('telemetry freshness', () => {
  it('holds the last sample and progresses from simulation to stale to lost', () => {
    const sampledAt = 1_700_000_000_000;
    const sample = createSimulationSnapshot(12, sampledAt);
    expect(getTelemetryStatus('simulation', sample, sampledAt + 1_499)).toBe('simulation');
    expect(getTelemetryStatus('simulation', sample, sampledAt + 1_500)).toBe('stale');
    expect(getTelemetryStatus('simulation', sample, sampledAt + 5_000)).toBe('lost');
    expect(getTelemetryStatus('simulation', sample, sampledAt, false)).toBe('stale');
    expect(getTelemetryStatus('cloud', null, sampledAt)).toBe('offline');
    expect(sample.attitude.roll).not.toBeNull();
  });

  it('uses both capture and server receipt time for cloud freshness', () => {
    const sampledAt = 1_700_000_000_000;
    const sample = createSimulationSnapshot(12, sampledAt);
    expect(getTelemetryStatus('cloud', sample, sampledAt + 100, false, sampledAt + 50)).toBe('live');
    expect(getTelemetryStatus('cloud', sample, sampledAt + 2_000, false, sampledAt + 1_900)).toBe('stale');
    expect(getTelemetryStatus('cloud', sample, sampledAt + 6_000, false, sampledAt + 5_900)).toBe('lost');
    expect(getTelemetryStatus('cloud', sample, sampledAt + 100)).toBe('reconnecting');
    expect(getTelemetryAgeMs('cloud', sample, sampledAt + 2_000, sampledAt + 1_900)).toBe(2_000);
  });
});

describe('navigation geometry', () => {
  it('chooses the short turn across north', () => {
    expect(normalizeHeading(361)).toBe(1);
    expect(normalizeHeading(-1)).toBe(359);
    expect(shortestHeadingDelta(359, 1)).toBe(2);
    expect(shortestHeadingDelta(1, 359)).toBe(-2);
  });

  it('calculates HOME from actual positions rather than cumulative path length', () => {
    const atHome = navigationToHome(5.60372, -0.18696, 5.60372, -0.18696);
    expect(atHome.distanceMeters).toBe(0);
    expect(atHome.bearingDegrees).toBeNull();

    const northOfHome = navigationToHome(5.61372, -0.18696, 5.60372, -0.18696);
    expect(northOfHome.distanceMeters).toBeGreaterThan(1_100);
    expect(northOfHome.distanceMeters).toBeLessThan(1_120);
    expect(northOfHome.bearingDegrees).toBeCloseTo(180, 6);
  });
});
