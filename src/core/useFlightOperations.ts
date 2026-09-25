import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftTelemetry, TelemetrySource } from './telemetry';
import {
  createAlertEvents,
  createAutomaticEvents,
  DEFAULT_ALERT_SETTINGS,
  evaluateConfiguredAlerts,
  type AlertSettings,
  type FlightEvent,
  type RecordedFlight,
} from './flightOperations';

const DATABASE_NAME = 'flight-command-center-recordings';
const STORE_NAME = 'flights';
const SETTINGS_KEY = 'flight-command-center-alert-settings-v1';
const MAX_RECORDING_SAMPLES = 54_000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readFlights(): Promise<RecordedFlight[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { database.close(); resolve((request.result as RecordedFlight[]).sort((a, b) => b.startedAt - a.startedAt)); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function writeFlight(flight: RecordedFlight) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(flight);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function removeFlight(id: string) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function loadSettings() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AlertSettings>;
    return { ...DEFAULT_ALERT_SETTINGS, ...value };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export function useFlightOperations(snapshot: AircraftTelemetry | null, status: string, source: TelemetrySource) {
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<AircraftTelemetry[]>([]);
  const [events, setEvents] = useState<FlightEvent[]>([]);
  const [flights, setFlights] = useState<RecordedFlight[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AlertSettings>(loadSettings);
  const lastTimestamp = useRef<number | null>(null);
  const previousSample = useRef<AircraftTelemetry | null>(null);
  const activeAlertTypes = useRef(new Set<string>());
  const recordingStartedAt = useRef<number | null>(null);
  const recordingSource = useRef<TelemetrySource>(source);

  useEffect(() => {
    let active = true;
    readFlights().then(value => { if (active) setFlights(value); }).catch(() => { if (active) setStorageError('Saved recordings could not be opened in this browser.'); }).finally(() => { if (active) setStorageReady(true); });
    return () => { active = false; };
  }, []);

  const configuredAlerts = useMemo(() => evaluateConfiguredAlerts(snapshot, status, settings), [snapshot, status, settings]);

  useEffect(() => {
    if (!recording || !snapshot || snapshot.timestamp === lastTimestamp.current) return;
    const automatic = createAutomaticEvents(previousSample.current, snapshot, []);
    setSamples(current => current.length >= MAX_RECORDING_SAMPLES ? [...current.slice(1), snapshot] : [...current, snapshot]);
    if (automatic.length) setEvents(current => [...current, ...automatic]);
    previousSample.current = snapshot;
    lastTimestamp.current = snapshot.timestamp;
  }, [recording, snapshot]);

  useEffect(() => {
    if (!recording) return;
    const newAlerts = configuredAlerts.filter(alert => !activeAlertTypes.current.has(alert.type));
    if (newAlerts.length) setEvents(current => [...current, ...createAlertEvents(newAlerts, Date.now())]);
    activeAlertTypes.current = new Set(configuredAlerts.map(alert => alert.type));
  }, [recording, configuredAlerts]);

  const startRecording = useCallback(() => {
    const startedAt = snapshot?.timestamp ?? Date.now();
    recordingStartedAt.current = startedAt;
    recordingSource.current = source;
    lastTimestamp.current = snapshot?.timestamp ?? null;
    previousSample.current = snapshot;
    activeAlertTypes.current = new Set();
    setSamples(snapshot ? [snapshot] : []);
    setEvents([{ id: `recording-${startedAt}`, timestamp: startedAt, kind: 'recording', severity: 'info', label: 'RECORDING STARTED', detail: `${source.toUpperCase()} telemetry capture began.`, automatic: true }]);
    setRecording(true);
  }, [snapshot, source]);

  const stopRecording = useCallback(() => {
    if (!recording) return null;
    const startedAt = recordingStartedAt.current ?? samples[0]?.timestamp ?? Date.now();
    const endedAt = Math.max(Date.now(), samples.at(-1)?.timestamp ?? 0, ...events.map(event => event.timestamp));
    const flight: RecordedFlight = {
      version: 1,
      id: `flight-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      name: `FD-X1 · ${new Date(startedAt).toLocaleString()}`,
      aircraftId: samples[0]?.aircraftId ?? snapshot?.aircraftId ?? 'FD-X1',
      source: recordingSource.current,
      startedAt,
      endedAt,
      samples: [...samples],
      events: [...events, { id: `recording-stop-${endedAt}`, timestamp: endedAt, kind: 'recording', severity: 'info', label: 'RECORDING STOPPED', detail: `${samples.length} samples saved locally.`, automatic: true }],
    };
    setRecording(false);
    setFlights(current => [flight, ...current]);
    void writeFlight(flight).catch(() => setStorageError('The recording is available now but could not be saved permanently.'));
    return flight;
  }, [recording, samples, events, snapshot]);

  const addNote = useCallback((detail: string) => {
    const clean = detail.trim();
    if (!recording || !clean) return;
    const timestamp = snapshot?.timestamp ?? Date.now();
    setEvents(current => [...current, { id: `note-${timestamp}-${current.length}`, timestamp, kind: 'note', severity: 'info', label: 'OPERATOR NOTE', detail: clean, automatic: false }]);
  }, [recording, snapshot]);

  const deleteFlight = useCallback((id: string) => {
    setFlights(current => current.filter(flight => flight.id !== id));
    void removeFlight(id).catch(() => setStorageError('The saved recording could not be removed.'));
  }, []);

  const updateSettings = useCallback((next: AlertSettings) => {
    setSettings(next);
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* Current session still uses the settings. */ }
  }, []);

  return {
    recording,
    activeSamples: samples,
    activeEvents: events,
    flights,
    storageReady,
    storageError,
    settings,
    configuredAlerts,
    startRecording,
    stopRecording,
    addNote,
    deleteFlight,
    updateSettings,
  };
}
