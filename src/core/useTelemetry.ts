import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'firebase/database';
import { createSimulationSnapshot } from './simulation';
import {
  getTelemetryStatus,
  getTelemetryAgeMs,
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
  cloudConnection: CloudConnectionState;
  cloudMessage: string;
  cloudReceivedAt: number | null;
  /** Source clock used for sample and per-sensor freshness checks. */
  freshnessNow: number;
}

export interface CloudTelemetryOptions {
  configured: boolean;
  authLoading: boolean;
  database: Database | null;
  userId: string | null;
  aircraftId: string;
}

export type CloudConnectionState = 'unconfigured' | 'auth-required' | 'idle' | 'connecting' | 'empty' | 'streaming' | 'invalid' | 'denied' | 'unavailable';

const SAMPLE_PERIOD_MS = 1_000 / SIMULATION_RATE_HZ;

/** Simulation and authorized Firebase streams remain separate sources. */
export function useTelemetry(cloud: CloudTelemetryOptions): UseTelemetryResult {
  const [source, setSource] = useState<TelemetrySource>('simulation');
  const [scenario, updateScenario] = useState<SimulationScenario>('normal');
  const [running, setRunning] = useState(true);
  const [snapshot, setSnapshot] = useState<AircraftTelemetry | null>(
    () => createSimulationSnapshot(0, Date.now()),
  );
  const [history, setHistory] = useState<AircraftTelemetry[]>(() => snapshot ? [snapshot] : []);
  const [durationSec, setDurationSec] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [cloudReceivedAt, setCloudReceivedAt] = useState<number | null>(null);
  const [cloudConnection, setCloudConnection] = useState<CloudConnectionState>('unconfigured');
  const [cloudMessage, setCloudMessage] = useState('Firebase project not configured.');
  const [cloudConnected, setCloudConnected] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState<number | null>(null);
  const [cloudIdentity, setCloudIdentity] = useState<{ userId: string; aircraftId: string } | null>(null);
  const [scenarioStartedAt, setScenarioStartedAt] = useState(Date.now);
  const elapsedRef = useRef(0);
  const previousRef = useRef(snapshot);
  const lastTickRef = useRef(Date.now());
  const lastCloudReceiptRef = useRef<number | null>(null);

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
    if (source !== 'cloud') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [source]);

  useEffect(() => {
    if (source === 'cloud') return;
    setCloudConnected(false);
    setCloudConnection(!cloud.configured ? 'unconfigured' : cloud.authLoading ? 'connecting' : !cloud.userId ? 'auth-required' : 'idle');
    setCloudMessage(!cloud.configured ? 'Firebase project not configured.' : !cloud.userId ? 'Sign in to access this aircraft.' : 'Select Cloud to receive aircraft telemetry.');
  }, [source, cloud.configured, cloud.authLoading, cloud.userId]);

  useEffect(() => {
    if (source !== 'cloud') return;
    // A source or owner change must never retain another stream's last position.
    setSnapshot(null);
    setHistory([]);
    setCloudReceivedAt(null);
    setCloudConnected(false);
    setServerOffsetMs(null);
    setCloudIdentity(null);
    lastCloudReceiptRef.current = null;
    if (!cloud.configured) {
      setCloudConnection('unconfigured');
      setCloudMessage('Set up Firebase project configuration to receive aircraft telemetry.');
      return;
    }
    if (cloud.authLoading || !cloud.database) {
      setCloudConnection('connecting');
      setCloudMessage('Checking Firebase sign-in.');
      return;
    }
    if (!cloud.userId) {
      setCloudConnection('auth-required');
      setCloudMessage('Sign in to access this aircraft.');
      return;
    }

    let active = true;
    let stopTelemetry = () => {};
    let stopConnection = () => {};
    let stopClock = () => {};
    const database = cloud.database;
    setCloudIdentity({ userId: cloud.userId, aircraftId: cloud.aircraftId });
    setCloudConnection('connecting');
    setCloudMessage('Connecting to Firebase telemetry.');

    void Promise.all([import('./firebaseTelemetry'), import('firebase/database')]).then(([reader, firebaseDatabase]) => {
      if (!active) return;
      const { onValue, ref } = firebaseDatabase;
      stopConnection = onValue(ref(database, '.info/connected'), value => {
        if (!active) return;
        setCloudConnected(value.val() === true);
      });
      stopClock = onValue(ref(database, '.info/serverTimeOffset'), value => {
        if (!active) return;
        const offset = value.val();
        setServerOffsetMs(typeof offset === 'number' && Number.isFinite(offset) ? offset : null);
      });
      stopTelemetry = reader.subscribeToFirebaseTelemetry(database, cloud.aircraftId, event => {
        if (!active) return;
        if (event.kind === 'status') {
          setCloudConnection(event.status);
          setCloudMessage(event.message);
          if (event.status === 'denied') {
            // Revocation must discard data that this account can no longer read.
            setSnapshot(null);
            setHistory([]);
            setCloudReceivedAt(null);
            lastCloudReceiptRef.current = null;
          }
          return;
        }
        if (lastCloudReceiptRef.current !== null && event.receivedAt <= lastCloudReceiptRef.current) return;
        lastCloudReceiptRef.current = event.receivedAt;
        setSnapshot(event.sample);
        setCloudReceivedAt(event.receivedAt);
        setCloudConnection('streaming');
        setCloudMessage('Receiving validated aircraft telemetry.');
        setHistory(current => {
          const cutoff = event.sample.timestamp - HISTORY_WINDOW_MS;
          return [...current.filter(item => item.timestamp >= cutoff && item.aircraftId === event.sample.aircraftId), event.sample].slice(-MAX_HISTORY_SAMPLES);
        });
        setNow(Date.now());
      });
    }).catch(() => {
      if (!active) return;
      setCloudConnection('unavailable');
      setCloudMessage('Firebase telemetry could not start.');
    });

    return () => {
      active = false;
      stopTelemetry();
      stopConnection();
      stopClock();
    };
  }, [source, cloud.configured, cloud.authLoading, cloud.database, cloud.userId, cloud.aircraftId]);

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

  const identityMatches = cloud.configured && cloud.userId !== null &&
    cloudIdentity?.userId === cloud.userId && cloudIdentity.aircraftId === cloud.aircraftId;
  const visibleSnapshot = source === 'cloud' && !identityMatches ? null : snapshot;
  const visibleHistory = source === 'cloud' && !identityMatches ? [] : history;
  const visibleCloudReceivedAt = source === 'cloud' && !identityMatches ? null : cloudReceivedAt;
  const cloudNow = source === 'cloud' && serverOffsetMs !== null ? now + serverOffsetMs : now;
  const ageMs = getTelemetryAgeMs(source, visibleSnapshot, cloudNow, visibleCloudReceivedAt);
  const measuredStatus = getTelemetryStatus(source, visibleSnapshot, cloudNow, running, visibleCloudReceivedAt);
  const status = source === 'cloud' && visibleSnapshot && measuredStatus !== 'lost' &&
    (cloudConnection !== 'streaming' || !cloudConnected || serverOffsetMs === null || measuredStatus === 'reconnecting')
    ? 'stale' : measuredStatus;

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
    snapshot: visibleSnapshot,
    source,
    status,
    ageMs,
    history: visibleHistory,
    alerts,
    scenario,
    running,
    durationSec,
    cloudConnection: source === 'cloud' && !identityMatches
      ? !cloud.configured ? 'unconfigured' : cloud.authLoading ? 'connecting' : !cloud.userId ? 'auth-required' : 'connecting'
      : cloudConnection,
    cloudMessage,
    cloudReceivedAt: visibleCloudReceivedAt,
    freshnessNow: cloudNow,
    selectSource,
    setScenario,
    start,
    pause,
    reset,
  };
}
