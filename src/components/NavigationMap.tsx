import { useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftTelemetry } from '../core/telemetry';
import './navigation-map.css';

type Coordinate = { latitude: number; longitude: number; timestamp: number };
type ViewMode = 'follow' | 'home' | 'reference' | 'fit';

const WIDTH = 1000;
const HEIGHT = 560;
const METRES_PER_DEGREE_LATITUDE = 111_132;
const METRES_PER_DEGREE_LONGITUDE = 111_320;

function isValidPosition(sample: AircraftTelemetry | null | undefined): sample is AircraftTelemetry {
  const navigation = sample?.navigation;
  return Boolean(
    navigation?.gpsFix &&
      typeof navigation.latitude === 'number' &&
      Number.isFinite(navigation.latitude) &&
      Math.abs(navigation.latitude) <= 90 &&
      typeof navigation.longitude === 'number' &&
      Number.isFinite(navigation.longitude) &&
      Math.abs(navigation.longitude) <= 180,
  );
}

function coordinateOf(sample: AircraftTelemetry): Coordinate {
  return {
    latitude: sample.navigation.latitude as number,
    longitude: sample.navigation.longitude as number,
    timestamp: sample.timestamp,
  };
}

function longitudeDelta(longitude: number, origin: number): number {
  return ((longitude - origin + 540) % 360) - 180;
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

function distanceAndBearing(from: Coordinate, to: Coordinate): { metres: number; bearing: number } {
  const latA = (from.latitude * Math.PI) / 180;
  const latB = (to.latitude * Math.PI) / 180;
  const deltaLat = latB - latA;
  const deltaLon = (longitudeDelta(to.longitude, from.longitude) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;
  const metres = 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(deltaLon) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLon);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { metres, bearing };
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;
}

function formatValue(value: number | null | undefined, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function fitCenter(points: Coordinate[], fallback: Coordinate): Coordinate {
  if (points.length === 0) return fallback;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => longitudeDelta(point.longitude, fallback.longitude));
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: normalizeLongitude(fallback.longitude + (Math.min(...longitudes) + Math.max(...longitudes)) / 2),
    timestamp: fallback.timestamp,
  };
}

export function NavigationMap({
  snapshot,
  history,
}: {
  snapshot: AircraftTelemetry | null;
  history: AircraftTelemetry[];
}) {
  const mapRef = useRef<HTMLElement>(null);
  const previousAircraftId = useRef<string | null>(null);
  const [lastPosition, setLastPosition] = useState<Coordinate | null>(null);
  const [localReference, setLocalReference] = useState<Coordinate | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('follow');
  const [showTrail, setShowTrail] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [copyStatus, setCopyStatus] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sampleAgeMs = snapshot ? Math.max(0, now - snapshot.timestamp) : Infinity;
  const samplePosition = isValidPosition(snapshot) ? coordinateOf(snapshot) : null;
  const hasFix = Boolean(samplePosition && sampleAgeMs < 1_500);
  const livePosition = hasFix ? samplePosition : null;
  const deviceHome = snapshot &&
    typeof snapshot.navigation.homeLatitude === 'number' &&
    Number.isFinite(snapshot.navigation.homeLatitude) &&
    Math.abs(snapshot.navigation.homeLatitude) <= 90 &&
    typeof snapshot.navigation.homeLongitude === 'number' &&
    Number.isFinite(snapshot.navigation.homeLongitude) &&
    Math.abs(snapshot.navigation.homeLongitude) <= 180
    ? { latitude: snapshot.navigation.homeLatitude, longitude: snapshot.navigation.homeLongitude, timestamp: snapshot.timestamp }
    : null;
  const gpsLabel = !snapshot
    ? 'NO TELEMETRY'
    : sampleAgeMs >= 5_000
      ? 'TELEMETRY LOST'
      : sampleAgeMs >= 1_500
        ? 'TELEMETRY STALE'
        : hasFix
          ? 'GPS FIX'
          : 'GPS UNAVAILABLE';
  const historicalPosition = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].aircraftId === snapshot?.aircraftId && isValidPosition(history[index])) return coordinateOf(history[index]);
    }
    return null;
  }, [history, snapshot?.aircraftId]);
  const hasSourceData = snapshot !== null || history.length > 0;
  const position = hasSourceData ? livePosition ?? historicalPosition ?? lastPosition ?? samplePosition : null;
  const displayReference = hasSourceData ? localReference : null;

  useEffect(() => {
    if (!hasSourceData) {
      setLastPosition(null);
      setLocalReference(null);
      setViewMode('follow');
      previousAircraftId.current = null;
    }
  }, [hasSourceData]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (snapshot?.aircraftId && previousAircraftId.current !== snapshot.aircraftId) {
      if (previousAircraftId.current !== null) {
        setLocalReference(null);
        setLastPosition(null);
        setViewMode('follow');
      }
      previousAircraftId.current = snapshot.aircraftId;
    }
  }, [snapshot?.aircraftId]);

  useEffect(() => {
    if (livePosition) setLastPosition(livePosition);
  }, [livePosition?.latitude, livePosition?.longitude, livePosition?.timestamp]);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === mapRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const trail = useMemo(() => {
    const stride = Math.max(1, Math.ceil(history.length / 220));
    const points: Coordinate[] = [];
    for (let index = 0; index < history.length; index += stride) {
      if (history[index].aircraftId === snapshot?.aircraftId && isValidPosition(history[index])) points.push(coordinateOf(history[index]));
    }
    if (historicalPosition && points[points.length - 1]?.timestamp !== historicalPosition.timestamp) {
      points.push(historicalPosition);
    }
    if (livePosition && points[points.length - 1]?.timestamp !== livePosition.timestamp) {
      points.push(livePosition);
    }
    return points;
  }, [history, historicalPosition?.timestamp, livePosition?.timestamp, snapshot?.aircraftId]);

  const reference = position ?? deviceHome ?? displayReference ?? { latitude: 0, longitude: 0, timestamp: 0 };
  const visiblePoints = showTrail ? trail : [];
  const fitPoints = [...visiblePoints, ...(position ? [position] : []), ...(deviceHome ? [deviceHome] : []), ...(displayReference ? [displayReference] : [])];
  const center = viewMode === 'home' && deviceHome ? deviceHome
    : viewMode === 'reference' && displayReference ? displayReference
      : viewMode === 'fit' ? fitCenter(fitPoints, reference) : reference;
  const cosineLatitude = Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  const offsets = fitPoints.map((point) => ({
    x: longitudeDelta(point.longitude, center.longitude) * METRES_PER_DEGREE_LONGITUDE * cosineLatitude,
    y: (center.latitude - point.latitude) * METRES_PER_DEGREE_LATITUDE,
  }));
  const fitMetresPerPixel = Math.max(
    0.45,
    ...offsets.map((point) => Math.max(Math.abs(point.x) / 410, Math.abs(point.y) / 215)),
  );
  const metresPerPixel = (viewMode === 'fit' ? fitMetresPerPixel : 0.65) * zoom;
  const project = (point: Coordinate) => ({
    x: WIDTH / 2 + (longitudeDelta(point.longitude, center.longitude) * METRES_PER_DEGREE_LONGITUDE * cosineLatitude) / metresPerPixel,
    y: HEIGHT / 2 + ((center.latitude - point.latitude) * METRES_PER_DEGREE_LATITUDE) / metresPerPixel,
  });
  const aircraftPoint = position ? project(position) : null;
  const homePoint = deviceHome ? project(deviceHome) : null;
  const referencePoint = displayReference ? project(displayReference) : null;
  const routePoints = visiblePoints.map(project).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const homeVector = position && deviceHome ? distanceAndBearing(position, deviceHome) : null;
  const heading = snapshot?.attitude?.heading ?? snapshot?.navigation?.course;
  const safeHeading = typeof heading === 'number' && Number.isFinite(heading) ? heading : 0;
  const gridX = Array.from({ length: 7 }, (_, index) => 125 + index * 125);
  const gridY = Array.from({ length: 5 }, (_, index) => 90 + index * 95);
  const scaleMetres = metresPerPixel * 170;
  const niceScale = 10 ** Math.floor(Math.log10(scaleMetres)) * [1, 2, 5, 10].find((step) => step * 10 ** Math.floor(Math.log10(scaleMetres)) >= scaleMetres * 0.65)!;
  const scalePixels = niceScale / metresPerPixel;

  async function copyCoordinates() {
    if (!position) return;
    try {
      await navigator.clipboard.writeText(`${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`);
      setCopyStatus('COPIED');
    } catch {
      setCopyStatus('COPY UNAVAILABLE');
    }
    window.setTimeout(() => setCopyStatus(''), 2500);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (mapRef.current?.requestFullscreen) await mapRef.current.requestFullscreen();
  }

  return (
    <section className="fcc-nav-map" ref={mapRef} aria-label="Aircraft navigation map">
      <header className="fcc-nav-map__header">
        <div>
          <div className="fcc-nav-map__eyebrow"><span className="fcc-nav-map__eyebrow-line" /> NAVIGATION / LOCAL GRID</div>
          <h2>Aircraft position</h2>
        </div>
        <div className={`fcc-nav-map__gps ${hasFix ? 'fcc-nav-map__gps--good' : 'fcc-nav-map__gps--lost'}`} role="status">
          <span className="fcc-nav-map__gps-dot" />{gpsLabel}
        </div>
      </header>

      <div className="fcc-nav-map__position-row">
        <div>
          <span className="fcc-nav-map__label">{hasFix ? 'CURRENT COORDINATES' : position ? 'LAST KNOWN COORDINATES' : 'POSITION'}</span>
          <div className="fcc-nav-map__coordinates">
            {position ? `${position.latitude.toFixed(6)}°, ${position.longitude.toFixed(6)}°` : 'Waiting for a valid GPS fix'}
          </div>
        </div>
        <button className="fcc-nav-map__copy" type="button" onClick={copyCoordinates} disabled={!position} aria-label="Copy aircraft coordinates">
          {copyStatus || 'COPY COORDINATES'}
        </button>
      </div>

      <div className="fcc-nav-map__canvas-wrap">
        <svg className="fcc-nav-map__canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={position ? `Local geographic grid with aircraft at ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}${hasFix ? '' : ', last known location'}` : 'Local geographic grid waiting for GPS position'}>
          <defs>
            <radialGradient id="fcc-map-glow"><stop offset="0" stopColor="#133448" stopOpacity="0.75" /><stop offset="1" stopColor="#07131f" stopOpacity="0" /></radialGradient>
            <clipPath id="fcc-map-bounds"><rect x="0" y="0" width={WIDTH} height={HEIGHT} /></clipPath>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="#081520" />
          <rect width={WIDTH} height={HEIGHT} fill="url(#fcc-map-glow)" />
          <g className="fcc-nav-map__grid">
            {gridX.map((x) => <line key={`x${x}`} x1={x} y1="0" x2={x} y2={HEIGHT} />)}
            {gridY.map((y) => <line key={`y${y}`} x1="0" y1={y} x2={WIDTH} y2={y} />)}
          </g>
          {position && <g className="fcc-nav-map__grid-labels" aria-hidden="true">
            {gridX.filter((_, index) => index % 2 === 0).map((x) => <text key={`lon${x}`} x={x + 7} y={HEIGHT - 12}>{normalizeLongitude(center.longitude + ((x - WIDTH / 2) * metresPerPixel) / (METRES_PER_DEGREE_LONGITUDE * cosineLatitude)).toFixed(4)}°</text>)}
            {gridY.filter((_, index) => index % 2 === 0).map((y) => <text key={`lat${y}`} x="14" y={y - 9}>{(center.latitude + ((HEIGHT / 2 - y) * metresPerPixel) / METRES_PER_DEGREE_LATITUDE).toFixed(4)}°</text>)}
          </g>}
          <g clipPath="url(#fcc-map-bounds)">
            {routePoints && showTrail && <polyline className="fcc-nav-map__trail" points={routePoints} />}
            {homePoint && aircraftPoint && <line className="fcc-nav-map__home-line" x1={homePoint.x} y1={homePoint.y} x2={aircraftPoint.x} y2={aircraftPoint.y} />}
            {homePoint && <g transform={`translate(${homePoint.x} ${homePoint.y})`}>
              <circle className="fcc-nav-map__home-ring" r="22" />
              <circle className="fcc-nav-map__home-core" r="13" />
              <text className="fcc-nav-map__home-letter" textAnchor="middle" y="5">H</text>
              <text className="fcc-nav-map__marker-label" x="29" y="5">AIRCRAFT HOME</text>
            </g>}
            {referencePoint && <g transform={`translate(${referencePoint.x} ${referencePoint.y})`}>
              <circle className="fcc-nav-map__reference-ring" r="13" />
              <text className="fcc-nav-map__reference-letter" textAnchor="middle" y="5">R</text>
              <text className="fcc-nav-map__marker-label" x="20" y="5">LOCAL REF</text>
            </g>}
            {aircraftPoint && <g transform={`translate(${aircraftPoint.x} ${aircraftPoint.y})`}>
              <circle className={hasFix ? 'fcc-nav-map__aircraft-ring' : 'fcc-nav-map__aircraft-ring fcc-nav-map__aircraft-ring--stale'} r="31" />
              <circle className="fcc-nav-map__aircraft-halo" r="18" />
              <path className={hasFix ? 'fcc-nav-map__aircraft' : 'fcc-nav-map__aircraft fcc-nav-map__aircraft--stale'} transform={`rotate(${safeHeading})`} d="M 0 -22 L 7 -3 L 18 6 L 18 12 L 5 9 L 3 18 L -3 18 L -5 9 L -18 12 L -18 6 L -7 -3 Z" />
              <text className="fcc-nav-map__marker-label" x="37" y="5">{hasFix ? 'AIRCRAFT' : 'LAST KNOWN'}</text>
            </g>}
          </g>
          <g className="fcc-nav-map__north" transform="translate(950 50)" aria-hidden="true"><path d="M 0 -16 L 8 9 L 0 5 L -8 9 Z" /><text textAnchor="middle" y="28">N</text></g>
          <g className="fcc-nav-map__scale" transform="translate(28 520)" aria-hidden="true"><path d={`M 0 -7 V 0 H ${scalePixels} V -7`} /><text x="0" y="-12">{formatDistance(niceScale)}</text></g>
        </svg>
        {!position && <div className="fcc-nav-map__empty"><span>NO VALID POSITION</span><small>Waiting for an aircraft GPS fix. The grid does not show map tiles or terrain.</small></div>}
        <span className="fcc-nav-map__grid-caption">LOCAL COORDINATE GRID · NORTH UP · NO BASEMAP</span>
      </div>

      <div className="fcc-nav-map__toolbar" aria-label="Map controls">
        <button type="button" className={viewMode === 'follow' ? 'is-active' : ''} onClick={() => setViewMode('follow')} disabled={!position}>FOLLOW AIRCRAFT</button>
        <button type="button" className={viewMode === 'home' ? 'is-active' : ''} onClick={() => setViewMode('home')} disabled={!deviceHome}>CENTER HOME</button>
        {displayReference && <button type="button" className={viewMode === 'reference' ? 'is-active' : ''} onClick={() => setViewMode('reference')}>CENTER LOCAL REF</button>}
        <button type="button" className={viewMode === 'fit' ? 'is-active' : ''} onClick={() => setViewMode('fit')} disabled={!position}>FIT TRAIL</button>
        <button type="button" className={showTrail ? 'is-active' : ''} onClick={() => setShowTrail((shown) => !shown)} aria-pressed={showTrail}>{showTrail ? 'TRAIL ON' : 'TRAIL OFF'}</button>
        <button type="button" onClick={() => { if (livePosition) setLocalReference(livePosition); }} disabled={!livePosition}>{displayReference ? 'MOVE LOCAL REF HERE' : 'SET LOCAL REF HERE'}</button>
        {displayReference && <button type="button" onClick={() => { setLocalReference(null); if (viewMode === 'reference') setViewMode('follow'); }}>CLEAR LOCAL REF</button>}
        <span className="fcc-nav-map__toolbar-spacer" />
        <button type="button" className="fcc-nav-map__zoom" aria-label="Zoom in" onClick={() => setZoom((value) => Math.max(0.2, value / 1.5))}>+</button>
        <button type="button" className="fcc-nav-map__zoom" aria-label="Zoom out" onClick={() => setZoom((value) => Math.min(20, value * 1.5))}>−</button>
        <button type="button" onClick={toggleFullscreen}>{isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}</button>
      </div>

      <div className="fcc-nav-map__footer">
        <div className="fcc-nav-map__datum"><span>GROUND SPEED</span><strong>{hasFix && snapshot ? formatValue(snapshot.navigation.groundSpeed, 1) : '—'} <small>km/h</small></strong></div>
        <div className="fcc-nav-map__datum"><span>GPS ALTITUDE</span><strong>{hasFix && snapshot ? formatValue(snapshot.navigation.gpsAltitude, 1) : '—'} <small>m</small></strong></div>
        <div className="fcc-nav-map__datum"><span>SATELLITES / HDOP</span><strong>{hasFix && snapshot ? `${formatValue(snapshot.navigation.satellites)} / ${formatValue(snapshot.navigation.hdop, 1)}` : '—'}</strong></div>
        <div className="fcc-nav-map__datum fcc-nav-map__datum--home">
          <span>AIRCRAFT HOME {deviceHome ? '· REPORTED' : '· NOT REPORTED'}</span>
          <strong>{hasFix && homeVector ? `${formatDistance(homeVector.metres)} · ${Math.round(homeVector.bearing)}°` : '—'}</strong>
          {displayReference && <small>Local reference is browser only</small>}
        </div>
      </div>
      {!hasFix && position && <p className="fcc-nav-map__stale" role="status">{gpsLabel}. Aircraft marker holds the last valid position from {new Date(position.timestamp).toLocaleTimeString()}.</p>}
    </section>
  );
}

export default NavigationMap;
