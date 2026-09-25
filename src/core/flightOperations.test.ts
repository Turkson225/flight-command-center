import { describe, expect, it } from 'vitest';
import { createSimulationSnapshot } from './simulation';
import {
  analyzeControlResponse,
  buildPreflightChecks,
  computeFlightSummary,
  createAutomaticEvents,
  DEFAULT_ALERT_SETTINGS,
  evaluateConfiguredAlerts,
  flightToCsv,
  type RecordedFlight,
} from './flightOperations';

function samples(count = 80) {
  const start = 1_800_000_000_000;
  return Array.from({ length: count }, (_, index) => createSimulationSnapshot(index / 5, start + index * 200));
}

describe('flight operations analysis', () => {
  it('computes a complete post-flight summary from recorded samples', () => {
    const summary = computeFlightSummary(samples());
    expect(summary.durationSec).toBeCloseTo(15.8, 4);
    expect(summary.distanceM).toBeGreaterThan(250);
    expect(summary.maxSpeedKmh).toBeGreaterThan(70);
    expect(summary.maxAltitudeM).not.toBeNull();
    expect(summary.minVoltage).not.toBeNull();
    expect(summary.gpsFixPercent).toBe(100);
    expect(summary.minSatellites).toBeGreaterThanOrEqual(10);
  });

  it('compares control commands with measured aircraft response', () => {
    const axes = analyzeControlResponse(samples(120));
    const elevator = axes.find(axis => axis.key === 'elevator-pitch');
    const aileron = axes.find(axis => axis.key === 'aileron-roll');
    expect(elevator?.correlation).toBeGreaterThan(.99);
    expect(elevator?.lagMs).toBe(0);
    expect(elevator?.rating).toBe('COUPLED');
    expect(aileron?.correlation).not.toBeNull();
  });

  it('flags sustained high-frequency reversals for oscillation review', () => {
    const rapid = samples(80);
    rapid.forEach((sample, index) => {
      sample.control.elevator = index % 2 ? 12 : -12;
      sample.attitude.pitch = index % 2 ? 8 : -8;
    });
    const elevator = analyzeControlResponse(rapid).find(axis => axis.key === 'elevator-pitch');
    expect(elevator?.oscillationHz).toBeGreaterThan(1);
    expect(elevator?.rating).toBe('OSCILLATORY');
  });
});

describe('configurable monitoring rules', () => {
  it('raises attitude, battery, GPS, geofence and failsafe alerts from settings', () => {
    const sample = createSimulationSnapshot(10, 1_800_000_010_000);
    sample.attitude.pitch = 31;
    sample.attitude.roll = -51;
    sample.power.batteryVoltage = 10.2;
    sample.power.batteryPercent = 12;
    sample.navigation.gpsFix = false;
    sample.navigation.distanceHome = 900;
    sample.system.failsafe = true;
    const types = evaluateConfiguredAlerts(sample, 'LIVE', DEFAULT_ALERT_SETTINGS).map(alert => alert.type);
    expect(types).toEqual(expect.arrayContaining(['PITCH_LIMIT', 'BANK_LIMIT', 'LOW_BATTERY', 'GPS_LOST', 'GEOFENCE', 'FAILSAFE']));
  });

  it('marks stale and lost telemetry without requiring a current sample', () => {
    expect(evaluateConfiguredAlerts(null, 'LOST', DEFAULT_ALERT_SETTINGS).map(alert => alert.type)).toContain('TELEMETRY_LOST');
    expect(evaluateConfiguredAlerts(null, 'STALE', DEFAULT_ALERT_SETTINGS).map(alert => alert.type)).toContain('TELEMETRY_STALE');
  });

  it('builds automatic launch and alert markers', () => {
    const previous = createSimulationSnapshot(0, 1_800_000_000_000);
    const current = createSimulationSnapshot(1, 1_800_000_001_000);
    previous.navigation.groundSpeed = 3;
    current.navigation.groundSpeed = 15;
    const alert = evaluateConfiguredAlerts(null, 'LOST', DEFAULT_ALERT_SETTINGS);
    const events = createAutomaticEvents(previous, current, alert);
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['launch', 'telemetry']));
  });

  it('builds sensor and operator-ready preflight rows', () => {
    const sample = createSimulationSnapshot(3, 1_800_000_003_000);
    const checks = buildPreflightChecks(sample, 'SIMULATION', DEFAULT_ALERT_SETTINGS);
    expect(checks.find(check => check.id === 'imu')?.state).toBe('pass');
    expect(checks.find(check => check.id === 'gps')?.state).toBe('pass');
    expect(checks.find(check => check.id === 'neutral')?.state).toBe('warn');
  });
});

describe('flight export', () => {
  it('exports one CSV row per sample with analysis-friendly headings', () => {
    const recordedSamples = samples(3);
    const flight: RecordedFlight = {
      version: 1,
      id: 'test-flight',
      name: 'Test flight',
      aircraftId: 'FD-X1',
      source: 'simulation',
      startedAt: recordedSamples[0].timestamp,
      endedAt: recordedSamples.at(-1)!.timestamp,
      samples: recordedSamples,
      events: [],
    };
    const csv = flightToCsv(flight);
    const rows = csv.split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('timestamp_iso');
    expect(rows[0]).toContain('elevator_cmd');
    expect(rows[1]).toContain('FD-X1');
  });
});
