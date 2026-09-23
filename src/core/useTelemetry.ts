import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSimulationSnapshot } from './simulation';
import {
  getTelemetryStatus,
  HISTORY_WINDOW_MS,
  MAX_HISTORY_SAMPLES,
  SIMULATION_RATE_HZ,
  type AircraftTelemetry,
  type FlightAlert,
  type SimulationScenario,
  type TelemetrySource,
  type TelemetryState,
} from './telemetry';

export interface UseTelemetryResult extends TelemetryState {
  selectSource: (source: TelemetrySource) => void;
  setScenario: (scenario: SimulationScenario) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
}

const SAMPLE_PERIOD_MS = 1_000 / SIMULATION_RATE_HZ;

/** Cloud and direct modes intentionally produce no data until authenticated adapters exist. */
export function useTelemetry(): UseTelemetryResult {
  const [source, setSource] = useState<TelemetrySource>('simulation');
  const [scenario, updateScenario] = useState<SimulationScenario>('normal');
  const [running, setRunning] = useState(true);
  const [snapshot, setSnapshot] = useState<AircraftTelemetry | null>(
    () => createSimulationSnapshot(0, Date.now()),
  );
  const [history, setHistory] = useState<AircraftTelemetry[]>(() => snapshot ? [snapshot] : []);
  const [durationSec, setDurationSec] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [scenarioStartedAt, setScenarioStartedAt] = useState(Date.now);
  const elapsedRef = useRef(0);
  const previousRef = useRef(snapshot);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    if (source !== 'simulation' || !running) return;
    lastTickRef.current = Date.now();
    const timer = setInterval(() => {
      const current = Date.now();
      const elapsed = Math.max(0, Math.min(0.5, (current - lastTickRef.current) / 1_000));
      lastTickRef.current = current;
      elapsedRef.current += elapsed;
      setDurationSec(Math.floor(elapsedRef.current));
      setNow(current);

      // Suppress packets entirely. The existing sample ages into STALE then LOST.
      if (scenario === 'telemetryLoss') return;

      const next = createSimulationSnapshot(elapsedRef.current, current, scenario, previousRef.current);
      previousRef.current = next;
      setSnapshot(next);
      setHistory(currentHistory => {
        const cutoff = current - HISTORY_WINDOW_MS;
        const firstRecent = currentHistory.findIndex(item => item.timestamp >= cutoff);
        const recent = firstRecent < 0 ? [] : currentHistory.slice(firstRecent);
        return [...recent, next].slice(-MAX_HISTORY_SAMPLES);
      });
    }, SAMPLE_PERIOD_MS);
    return () => clearInterval(timer);
  }, [source, running, scenario]);

  useEffect(() => {
    if (source !== 'simulation' || running) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [source, running]);

  const selectSource = useCallback((nextSource: TelemetrySource) => {
    setSource(nextSource);
    updateScenario('normal');
    setScenarioStartedAt(Date.now());
    elapsedRef.current = 0;
    setDurationSec(0);
    // Never show old simulated numbers as a new cloud/direct stream.
    const initial = nextSource === 'simulation' ? createSimulationSnapshot(0, Date.now()) : null;
    previousRef.current = initial;
    setSnapshot(initial);
    setHistory(initial ? [initial] : []);
    setNow(Date.now());
    setRunning(nextSource === 'simulation');
  }, []);

  const setScenario = useCallback((nextScenario: SimulationScenario) => {
    updateScenario(nextScenario);
    setScenarioStartedAt(Date.now());
  }, []);

  const start = useCallback(() => {
    if (source === 'simulation') {
      setNow(Date.now());
      setRunning(true);
    }
  }, [source]);

  const pause = useCallback(() => setRunning(false), []);

  const reset = useCallback(() => {
    elapsedRef.current = 0;
    setDurationSec(0);
    updateScenario('normal');
    setScenarioStartedAt(Date.now());
    const initial = source === 'simulation' ? createSimulationSnapshot(0, Date.now()) : null;
    previousRef.current = initial;
    setSnapshot(initial);
    setHistory(initial ? [initial] : []);
    setNow(Date.now());
    setRunning(source === 'simulation');
  }, [source]);

  const ageMs = snapshot ? Math.max(0, now - snapshot.timestamp) : null;
  const status = getTelemetryStatus(source, snapshot, now, running);

  const alerts = useMemo<FlightAlert[]>(() => {
    if (source !== 'simulation') return [];
    const make = (type: string, message: string, severity: FlightAlert['severity']): FlightAlert => ({
      id: `SIM-${type}-${scenarioStartedAt}`,
      type,
      message,
      severity,
      timestamp: scenarioStartedAt,
      source: 'SIMULATION',
      acknowledged: false,
      resolved: false,
      duration: null,
    });
    if (scenario === 'gpsFailure') return [make('GPS_LOST', 'GPS fix unavailable in simulation.', 'warning')];
    if (scenario === 'lowBattery') return [make('LOW_BATTERY', 'Simulated battery voltage is low.', 'caution')];
    if (scenario === 'failsafe') return [make('FAILSAFE', 'Simulated RC link failure; failsafe active.', 'warning')];
    if (scenario === 'telemetryLoss' && status === 'lost') {
      return [make('TELEMETRY_LOST', 'Simulated telemetry packets stopped arriving.', 'warning')];
    }
    if (scenario === 'telemetryLoss' && status === 'stale') {
      return [make('TELEMETRY_STALE', 'No fresh simulated telemetry packet has arrived.', 'caution')];
    }
    return [];
  }, [source, scenario, scenarioStartedAt, status]);

  return {
    snapshot,
    source,
    status,
    ageMs,
    history,
    alerts,
    scenario,
    running,
    durationSec,
    selectSource,
    setScenario,
    start,
    pause,
    reset,
  };
}
