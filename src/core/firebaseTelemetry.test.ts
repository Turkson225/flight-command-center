import { describe, expect, it } from 'vitest';
import { createSimulationSnapshot } from './simulation';
import { parseFirebaseTelemetryEnvelope, telemetryPath } from './firebaseTelemetry';

const at = 1_800_000_000_000;

function envelope() {
  return {
    schemaVersion: 1,
    receivedAt: at + 200,
    sample: createSimulationSnapshot(12, at),
  };
}

describe('Firebase telemetry boundary', () => {
  it('accepts a full aircraft packet and preserves the separate capture and server receipt times', () => {
    const result = parseFirebaseTelemetryEnvelope(envelope(), 'FD-X1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample.timestamp).toBe(at);
    expect(result.receivedAt).toBe(at + 200);
    expect(result.sample.attitude.heading).not.toBeNull();
  });

  it('treats RTDB-omitted nullable measurements as unknown rather than zero', () => {
    const value = envelope();
    const sample = value.sample;
    delete (sample.attitude as { gyroX?: number | null }).gyroX;
    delete (sample.sensors.magnetometer as { calibrated?: boolean | null }).calibrated;
    const result = parseFirebaseTelemetryEnvelope(value, 'FD-X1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sample.attitude.gyroX).toBeNull();
      expect(result.sample.sensors.magnetometer.calibrated).toBeNull();
    }
  });

  it('rejects a packet for another aircraft and invalid attitude without showing it as live', () => {
    const other = envelope();
    other.sample.aircraftId = 'OTHER';
    expect(parseFirebaseTelemetryEnvelope(other, 'FD-X1')).toMatchObject({ ok: false });
    const invalid = envelope();
    invalid.sample.attitude.roll = Number.NaN;
    expect(parseFirebaseTelemetryEnvelope(invalid, 'FD-X1')).toMatchObject({ ok: false });
  });

  it('rejects gross device clock skew and a partial GPS coordinate', () => {
    const skewed = envelope();
    skewed.sample.timestamp -= 2 * 86_400_000;
    expect(parseFirebaseTelemetryEnvelope(skewed, 'FD-X1')).toMatchObject({ ok: false });
    const halfPosition = envelope();
    halfPosition.sample.navigation.longitude = null;
    expect(parseFirebaseTelemetryEnvelope(halfPosition, 'FD-X1')).toMatchObject({ ok: false });
    const falseFix = envelope();
    falseFix.sample.navigation.latitude = null;
    falseFix.sample.navigation.longitude = null;
    expect(parseFirebaseTelemetryEnvelope(falseFix, 'FD-X1')).toMatchObject({ ok: false });
  });

  it('refuses path injection from untrusted aircraft identifiers', () => {
    expect(telemetryPath('FD-X1')).toBe('aircraft/FD-X1/telemetry/latest');
    expect(() => telemetryPath('../another-device')).toThrow();
    expect(() => telemetryPath('A'.repeat(41))).toThrow();
  });
});
