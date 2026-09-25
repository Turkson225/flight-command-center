import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import type { MissionDocument, MissionPosition } from '../core/missionPlanner';
import 'leaflet/dist/leaflet.css';
import './mission-planner-map.css';

type Theme = 'midnight' | 'monochrome' | 'blackwhite' | 'military';

function markerIcon(kind: 'home' | 'waypoint' | 'aircraft', label: string, active = false, heading = 0) {
  const html = kind === 'aircraft'
    ? `<span class="mission-marker__aircraft" style="transform:rotate(${heading}deg)">▲</span><b>${label}</b>`
    : `<span>${kind === 'home' ? 'H' : label}</span><b>${kind === 'home' ? 'HOME' : label}</b>`;
  return L.divIcon({
    className: `mission-marker mission-marker--${kind}${active ? ' is-active' : ''}`,
    html,
    iconSize: kind === 'aircraft' ? [42, 42] : [34, 34],
    iconAnchor: kind === 'aircraft' ? [21, 21] : [17, 17],
  });
}

export function MissionPlannerMap({ mission, displayPosition, activeWaypointIndex, heading = 0, theme, onAddWaypoint, onMoveWaypoint, onMoveHome }: {
  mission: MissionDocument;
  displayPosition: MissionPosition | null;
  activeWaypointIndex: number | null;
  heading?: number;
  theme: Theme;
  onAddWaypoint: (position: MissionPosition) => void;
  onMoveWaypoint: (id: string, position: MissionPosition) => void;
  onMoveHome: (position: MissionPosition) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlaysRef = useRef<L.LayerGroup | null>(null);
  const addRef = useRef(onAddWaypoint);
  const moveWaypointRef = useRef(onMoveWaypoint);
  const moveHomeRef = useRef(onMoveHome);
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  addRef.current = onAddWaypoint;
  moveWaypointRef.current = onMoveWaypoint;
  moveHomeRef.current = onMoveHome;

  useEffect(() => {
    const element = elementRef.current;
    if (!element || mapRef.current) return;
    const map = L.map(element, { zoomControl: false, preferCanvas: true, minZoom: 3, maxZoom: 18 }).setView([mission.home.latitude, mission.home.longitude], 15);
    mapRef.current = map;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    });
    let errors = 0;
    const timer = window.setTimeout(() => setTileState('unavailable'), 10_000);
    tiles.on('tileload', () => { errors = 0; window.clearTimeout(timer); setTileState('ready'); });
    tiles.on('tileerror', event => { (event.tile as HTMLImageElement).style.visibility = 'hidden'; errors += 1; if (errors >= 4) setTileState('unavailable'); });
    tiles.addTo(map);
    map.on('click', event => addRef.current({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) }));
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      overlaysRef.current = null;
    };
    // The initial HOME is used only for first paint. Overlay updates are separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    overlaysRef.current?.remove();
    const overlays = L.layerGroup().addTo(map);
    overlaysRef.current = overlays;
    const home: L.LatLngTuple = [mission.home.latitude, mission.home.longitude];
    L.circle(home, {
      radius: mission.geofenceRadiusM,
      color: '#e6ae61', weight: 2, opacity: .9, dashArray: '9 7', fillColor: '#e6ae61', fillOpacity: .045, interactive: false,
    }).addTo(overlays);
    const homeMarker = L.marker(home, { icon: markerIcon('home', 'H'), draggable: true, zIndexOffset: 500 }).addTo(overlays);
    homeMarker.on('dragend', () => { const point = homeMarker.getLatLng(); moveHomeRef.current({ latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) }); });
    const route: L.LatLngTuple[] = [home];
    mission.waypoints.forEach((waypoint, index) => {
      const point: L.LatLngTuple = [waypoint.latitude, waypoint.longitude];
      route.push(point);
      const marker = L.marker(point, { icon: markerIcon('waypoint', String(index + 1), activeWaypointIndex === index), draggable: true, zIndexOffset: activeWaypointIndex === index ? 450 : 300 }).addTo(overlays);
      marker.on('dragend', () => { const location = marker.getLatLng(); moveWaypointRef.current(waypoint.id, { latitude: Number(location.lat.toFixed(6)), longitude: Number(location.lng.toFixed(6)) }); });
      L.circle(point, { radius: waypoint.acceptanceRadiusM, color: activeWaypointIndex === index ? '#ffffff' : '#64d8eb', weight: 1, opacity: .72, fillOpacity: .025, interactive: false }).addTo(overlays);
    });
    if (route.length > 1) {
      L.polyline(route, { color: '#e6ae61', weight: 13, opacity: .11, interactive: false }).addTo(overlays);
      L.polyline(route, { color: '#64d8eb', weight: 3, opacity: .94, interactive: false }).addTo(overlays);
    }
    if (displayPosition) L.marker([displayPosition.latitude, displayPosition.longitude], { icon: markerIcon('aircraft', 'AIRCRAFT', false, heading), zIndexOffset: 700, interactive: false }).addTo(overlays);
  }, [mission, displayPosition?.latitude, displayPosition?.longitude, activeWaypointIndex, heading]);

  function fitMission() {
    const map = mapRef.current;
    if (!map) return;
    const points = [[mission.home.latitude, mission.home.longitude], ...mission.waypoints.map(waypoint => [waypoint.latitude, waypoint.longitude])] as L.LatLngTuple[];
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16, animate: false });
  }

  return <section className="mission-map" data-theme={theme} aria-label="Mission planning map">
    <div ref={elementRef} className="mission-map__leaflet"/>
    <div className="mission-map__instruction"><strong>CLICK MAP</strong><span>Add waypoint · drag markers to reposition</span></div>
    <div className="mission-map__status"><i className={tileState}/>{tileState === 'ready' ? 'GEOGRAPHIC MAP' : tileState === 'loading' ? 'LOADING MAP' : 'LOCAL GRID / TILES UNAVAILABLE'}</div>
    <div className="mission-map__controls"><button type="button" onClick={fitMission}>FIT MISSION</button><button type="button" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" onClick={() => mapRef.current?.zoomOut()}>−</button></div>
    <div className="mission-map__legend"><span><i className="home"/>HOME + GEOFENCE</span><span><i className="route"/>PLANNED ROUTE</span><span><i className="acceptance"/>ACCEPTANCE RADIUS</span></div>
  </section>;
}
