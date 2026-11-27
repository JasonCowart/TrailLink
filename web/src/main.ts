// TrailLink web app.
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Point } from 'geojson';
import './styles.css';
import { BASE_MAPS, MVUM_TILES, STREET_STYLE_URL, TRAIL_MAXZOOM, TRAIL_TILES, rasterStyle, type BaseMapId } from './maps.ts';
import { COLORED_LAYERS, OVERVIEW_LAYERS, TRAIL_LAYERS, difficultyLegendHtml, legendHtml, rateSheetHtml, ratingHtml, rigMarkerImage, rigMarkerLayers, trailColor, trailPopupHtml, type ColorBy, type RatingInfo } from './trails.ts';
import { BADGE_COLORS, LIFTS, LOCKERS, TIRE_SIZES, WIDTHS, bandShift, forecast, rigClass, rigScore, vehicleSummary, vehicleTitle, type Vehicle } from './garage.ts';
import { VEHICLE_FIT, lengthMiles, levelOf, LEVELS, stepColor, type RiderTrail, type VehicleFit } from './community.ts';
import { OnlineCommunity, type AdminRider, type GroupMember, type SharedPin } from './online.ts';
import { askToKeepStorage, clearAllTiles, downloadArea, forgetArea, planDownload, savedAreas, storageSummary } from './offline.ts';
import { shouldKeep, stats, store, toGpx, type Pin, type Pt, type Track } from './track.ts';
import { deletePhoto, hydratePhotos, loadedBlob, savePhoto, saveToLibrary } from './photos.ts';
import { Backup, type Change } from './backup.ts';
import { GroupChat, QUICK, type ChatMessage } from './messages.ts';
import { PhoneCompass, compassHtml, type CompassMark, type HeadingSource } from './compass.ts';
import { buildGraph, loadTrailLines, progress, trackRoute, trailRoute, type LL, type Route } from './getout.ts';
import qrcode from 'qrcode-generator';
import { Breadcrumbs } from './groupline.ts';
import jsQR from 'jsqr';
import { PIN_ICONS, REPORTS, REPORT_TYPES, pinIcon, reportIcon, type ReportType } from './reports.ts';
import { FT, GRADES, MI, buildProfile, distAtX, indexAt, profileSvg, scrubXY, W as PROFILE_W, type Profile, type ProfileMark } from './profile.ts';
// Small line icons for compact buttons.
const ico = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  target: ico('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  move: ico('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  camera: ico('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
  reply: ico('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>'),
  qr: ico('<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2"/>'),
  exit: ico('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  flag: ico('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  speaker: ico('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  chat: ico('<path d="M4 5h16v11H9l-5 4z"/>'),
  send: ico('<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  bell: ico('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  download: ico('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  info: ico('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  arrowUp: ico('<path d="M12 3l7 10h-4.5v8h-5v-8H5z" fill="currentColor" stroke="none"/>'),
  pencil: ico('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  pin: ico('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  thumb: ico('<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.4 0 2.3 1.1 2 2.4L12.4 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>'),
  check: ico('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>'),
  medal: ico('<path d="M12 2.8l7.5 4.3v8.6L12 20l-7.5-4.3V7.1z"/><path d="M12 7.8l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z"/>'),
  chevUp: ico('<path d="M6 15l6-6 6 6"/>'),
  chevDown: ico('<path d="M6 9l6 6 6-6"/>'),
};
/** A line icon sized to sit in a line of text or a button label. */
const inl = (svg: string, size = 18) => svg.replace('width="20" height="20"', `width="${size}" height="${size}" class="inl"`);
import { BADGE_COLORS as BADGE_TRAIL_COLORS, BADGE_ICONS, MILESTONES, badgeSvg, bbox as badgeBbox, coverage, earnedOnRide, rodeIn, type BadgeIcon, type BadgeTrail, type RiderStats } from './badges.ts';
import { bearingDeg, compass, distanceM } from '../../src/core/geo.ts';

// ---------------------------------------------------------------- state
type Tab = 'ride' | 'trails' | 'garage' | 'badges' | 'pins' | 'group';
const state = {
  tab: 'ride' as Tab,
  base: store.get<BaseMapId>('base', 'topo'),
  mvum: store.get('mvumImage', false),
  trails: store.get('trails', true),
  colorBy: store.get<ColorBy>('colorBy', 'access'),
  draw: null as null | { coords: [number, number][] },
  detail: false,
  signin: null as null | { email: string; sent: boolean; busy: boolean; error?: string },
  admin: { riders: null as AdminRider[] | null, busy: false, error: '', invited: '' },
  rigMarks: store.get('rigMarks', true),
  panel: null as null | 'layers' | 'basemap' | 'legend' | 'riders',
  openVehicles: new Set<string>(),
  groupBusy: false,
  groupError: '',
  trailMeta: null as null | { built: string; counts: Record<string, number> },
  follow: true,
  pos: null as null | { lat: number; lon: number; acc: number; alt?: number; speed?: number; heading?: number; t: number },
  recording: null as Track | null,
  tracks: store.tracks(),
  pins: store.pins(),
  download: null as null | { done: number; total: number; failed: number; ctrl: AbortController },
  online: navigator.onLine,
  wakeLock: null as WakeLockSentinel | null,
  keepAwake: store.get('keepAwake', true),
  /** Ride shown in the elevation profile (null: the ride being recorded, else the latest ride). */
  compass: store.get('compass', true),
  groupLine: store.get('groupLine', true),
  myRides: store.get('myRides', true),
  theme: store.get<'auto' | 'light' | 'dark'>('theme', 'auto'),
  viewRide: null as string | null,
  scrubI: null as number | null,
  scrubbing: false,
};
// Resume a ride that was recording when the page closed.
const unfinished = state.tracks.find(t => !t.endedAt);
if (unfinished) state.recording = unfinished;

const community = new OnlineCommunity();
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

(window as unknown as { __tlStarted?: boolean }).__tlStarted = true;
// iPhone: stop the whole page from pinch-zooming (it made buttons huge and cut off); the map handles its own pinch.
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => { if (!(e.target as HTMLElement).closest?.('.maplibregl-canvas-container')) e.preventDefault(); }, { passive: false }); // the page's load check (index.html) sees the app started
// Dark mode check (defined before the map is created: the first map style depends on it).
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function isDark() { return state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches); }

// If something breaks while the app starts, say so on screen instead of showing a blank app.
function showFatal(msg: string) {
  if (document.getElementById('fatal')) return;
  const d = document.createElement('div'); d.id = 'fatal';
  d.style.cssText = 'position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:99;background:#B91C1C;color:#fff;padding:10px 12px;border-radius:12px;font:600 13px/1.3 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  d.textContent = `TrailLink hit a problem: ${msg}. Take a screenshot for Claude, then close and reopen the app.`;
  document.body.append(d);
}
window.addEventListener('error', e => showFatal(e.message || 'unknown error'));
window.addEventListener('unhandledrejection', e => { const r = e.reason as Error; if (r instanceof ReferenceError || r instanceof TypeError || r instanceof SyntaxError) showFatal(r.message); });

// ---------------------------------------------------------------- map
const start = store.get<{ c: [number, number]; z: number }>('view', { c: [-105.0, 39.1], z: 9 }); // default: Colorado Front Range
const map: MLMap = new maplibregl.Map({
  container: 'map',
  style: styleFor(state.base),
  center: start.c,
  zoom: start.z,
  attributionControl: { compact: true },
  maxPitch: 60,
});
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'top-left');
// If the dark street style can't load, fall back to the normal street map.
map.on('error', e => {
  const url = (e as { error?: { url?: string } }).error?.url ?? '';
  if (url.includes('/styles/dark') && state.base === 'street') map.setStyle(STREET_STYLE_URL);
});

// ---------------------------------------------------------------- dark mode (app and map): Auto follows the phone
type Theme = 'auto' | 'light' | 'dark';
function styleFor(id: BaseMapId) { return id === 'street' ? (isDark() ? STREET_STYLE_URL.replace('/liberty', '/dark') : STREET_STYLE_URL) : rasterStyle(id); }
/** Night look for the raster base maps (works offline: it's the same saved tiles, drawn darker). */
function applyMapTheme() {
  if (!map.getLayer('base')) return;
  const d = isDark(), topo = state.base === 'topo';
  const paint: Record<string, number> = d
    ? (topo ? { 'raster-brightness-min': 0.92, 'raster-brightness-max': 0.08, 'raster-hue-rotate': 180, 'raster-saturation': -0.35, 'raster-contrast': 0.1 }
            : { 'raster-brightness-min': 0, 'raster-brightness-max': 0.62, 'raster-hue-rotate': 0, 'raster-saturation': -0.15, 'raster-contrast': 0 })
    : { 'raster-brightness-min': 0, 'raster-brightness-max': 1, 'raster-hue-rotate': 0, 'raster-saturation': 0, 'raster-contrast': 0 };
  for (const [k, v] of Object.entries(paint)) map.setPaintProperty('base', k as 'raster-opacity', v);
}
function applyTheme(restyleMap = true) {
  const d = isDark();
  document.documentElement.dataset.theme = d ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', d ? '#121614' : '#1F4D3A');
  if (!restyleMap) return;
  if (state.base === 'street') { map.setStyle(styleFor('street')); render(); } else applyMapTheme();
}
darkQuery.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });

/** Our overlays (MVUM, ride track) are re-added after every style change. */
function addOverlays() {
  if (!map.getSource('trails')) map.addSource('trails', { type: 'vector', tiles: [TRAIL_TILES], minzoom: 5, maxzoom: TRAIL_MAXZOOM, promoteId: 'tid', attribution: 'USDA Forest Service MVUM, BLM GTLF, © OpenStreetMap contributors' });
  for (const l of TRAIL_LAYERS) if (!map.getLayer(l.id)) map.addLayer({ ...l, layout: { ...(l.layout ?? {}), visibility: state.trails ? 'visible' : 'none' } } as maplibregl.LayerSpecification);
  // Zoomed-out overview: dots where trails are.
  if (!map.getSource('overview')) map.addSource('overview', {
    type: 'geojson', data: TRAIL_TILES.replace('{z}/{x}/{y}.pbf', 'overview.geojson'),
    cluster: true, clusterRadius: 42, clusterMaxZoom: 7, clusterProperties: { routes: ['+', ['get', 'n']] },
  });
  for (const l of OVERVIEW_LAYERS) if (!map.getLayer(l.id)) map.addLayer({ ...l, layout: { ...(l.layout ?? {}), visibility: state.trails ? 'visible' : 'none' } } as maplibregl.LayerSpecification);
  // Trails riders created (shown dashed until verified), and the line being drawn right now.
  if (!map.getSource('rider-trails')) map.addSource('rider-trails', { type: 'geojson', data: riderTrailsGeo(), promoteId: 'tid' });
  if (!map.getLayer('rider-trails-casing')) map.addLayer({ id: 'rider-trails-casing', type: 'line', source: 'rider-trails', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  if (!map.getLayer('rider-trails')) map.addLayer({ id: 'rider-trails', type: 'line', source: 'rider-trails', paint: { 'line-color': riderColor() as never, 'line-width': 4.5, 'line-dasharray': [3, 1.5] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  if (!map.getSource('draw')) map.addSource('draw', { type: 'geojson', data: drawGeo() });
  if (!map.getLayer('draw-line')) map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#E8501A', 'line-width': 4 } });
  if (!map.getLayer('draw-pts')) map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#E8501A', 'circle-stroke-width': 3 } });
  // ▲ / ▼ markers where your rig changes a trail's difficulty colour.
  for (const kind of ['harder', 'easier'] as const) if (!map.hasImage(`rig-${kind}`)) map.addImage(`rig-${kind}`, rigMarkerImage(kind), { pixelRatio: 2 });
  for (const l of [...rigMarkerLayers('trails', 'trails'), ...rigMarkerLayers('rider-trails')]) if (!map.getLayer(l.id)) map.addLayer({ ...l, layout: { ...(l.layout ?? {}), visibility: rigMarksVisible() ? 'visible' : 'none' } } as maplibregl.LayerSpecification);
  applyColorBy();
  applyRatingStates();
  if (!map.getSource('mvum')) map.addSource('mvum', { type: 'raster', tiles: [MVUM_TILES], tileSize: 256, minzoom: 7, maxzoom: 17, attribution: 'USDA Forest Service MVUM' });
  if (!map.getLayer('mvum')) map.addLayer({ id: 'mvum', type: 'raster', source: 'mvum', paint: { 'raster-opacity': 0.9 }, layout: { visibility: state.mvum ? 'visible' : 'none' } });
  // Your finished rides, always on the map (thin purple lines). Tap one to open it in the Ride tab.
  if (!map.getSource('myrides')) map.addSource('myrides', { type: 'geojson', data: myRidesGeo() });
  if (!map.getLayer('myrides-casing')) map.addLayer({ id: 'myrides-casing', type: 'line', source: 'myrides', paint: { 'line-color': '#fff', 'line-width': 5, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: state.myRides ? 'visible' : 'none' } });
  if (!map.getLayer('myrides-line')) map.addLayer({ id: 'myrides-line', type: 'line', source: 'myrides', paint: { 'line-color': '#8B5CF6', 'line-width': 3, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: state.myRides ? 'visible' : 'none' } });
  // The ride picked (from the list or by tapping it on the map), drawn bold on top.
  if (!map.getSource('viewride')) map.addSource('viewride', { type: 'geojson', data: viewRideGeo() });
  if (!map.getLayer('viewride-casing')) map.addLayer({ id: 'viewride-casing', type: 'line', source: 'viewride', paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  if (!map.getLayer('viewride-line')) map.addLayer({ id: 'viewride-line', type: 'line', source: 'viewride', paint: { 'line-color': '#7C3AED', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  if (!map.getSource('track')) map.addSource('track', { type: 'geojson', data: trackGeo() });
  if (!map.getLayer('track-casing')) map.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  if (!map.getLayer('track')) map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#0EA5E9', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  // Group riders who are sharing their location.
  if (!map.getSource('riders')) map.addSource('riders', { type: 'geojson', data: ridersGeo() });
  // Direction arrows just outside each moving rider's dot (drawn under the dot).
  if (!map.hasImage('rider-arrow')) map.addImage('rider-arrow', riderArrowImage(), { pixelRatio: 2 });
  if (!map.getLayer('riders-arrow')) map.addLayer({ id: 'riders-arrow', type: 'symbol', source: 'riders', filter: ['has', 'heading'],
    layout: { 'icon-image': 'rider-arrow', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  if (!map.getLayer('riders-dot')) map.addLayer({ id: 'riders-dot', type: 'circle', source: 'riders', paint: {
    'circle-radius': 14, 'circle-color': '#2563EB', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-opacity': ['case', ['get', 'stale'], 0.45, 1], 'circle-stroke-opacity': ['case', ['get', 'stale'], 0.6, 1] } });
  if (!map.getLayer('riders-label')) map.addLayer({ id: 'riders-label', type: 'symbol', source: 'riders',
    layout: { 'text-field': ['get', 'initials'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#fff' } });
  if (!map.getLayer('riders-name')) map.addLayer({ id: 'riders-name', type: 'symbol', source: 'riders',
    layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.9], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': '#1E3A8A', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
}
map.on('style.load', () => { addOverlays(); applyMapTheme(); });
applyTheme(false);

// Tap a trail to see who manages it, which vehicles may use it, and when. A generous tap area for gloves.
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'trail-popup' });
let popupProps: Record<string, string> | null = null;
function ratingInfo(tid?: string): RatingInfo {
  const score = tid ? community.scores().get(tid) : undefined, v = community.activeVehicle();
  let rig: RatingInfo['rig'] = null;
  if (v && score) { const value = forecast(score.avg, score.rig, rigScore(v), community.rigSlope()); rig = { name: v.nickname, value, shift: bandShift(score.avg, value), widthIn: v.widthIn }; }
  return { mine: tid ? community.myRatings().get(tid) : undefined, score, online: community.mode === 'online', rig };
}
function popupHtml(p: Record<string, string>) {
  if (p.src === 'RIDER') {
    const t = community.trails().find(x => `RIDER:${x.id}` === p.tid);
    if (t) return badgeRowHtml(p.tid) + riderTrailHtml(t);
  }
  return badgeRowHtml(p.tid) + trailPopupHtml(p, ratingInfo(p.tid));
}
// Phones: details go in the bottom panel (more room); tablets and desktops: a popup on the map.
const useSheetDetails = () => window.matchMedia('(max-width: 899px), (orientation: portrait)').matches;
const tapMarkerEl = document.createElement('div');
tapMarkerEl.className = 'tapmark';
const tapMarker = new maplibregl.Marker({ element: tapMarkerEl });
function closeDetails() { state.detail = false; popupProps = null; tapMarker.remove(); popup.remove(); renderPane(); }
function refreshPopup() {
  if (!popupProps) return;
  if (state.detail) renderPane();
  else if (popup.isOpen()) popup.setHTML(popupHtml(popupProps));
}
map.on('click', e => {
  if (state.draw) { addDrawPoint([e.lngLat.lng, e.lngLat.lat]); return; }
  // Tapping an overview dot zooms in to its trails.
  const dot = state.trails && map.getLayer('overview-dots') ? map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['overview-dots'] })[0] : undefined;
  if (dot) {
    state.follow = false;
    const center = (dot.geometry as Point).coordinates as [number, number];
    const cid = dot.properties.cluster_id as number | undefined;
    const go = (z: number) => map.easeTo({ center, zoom: Math.max(z, map.getZoom() + 1.5), duration: 600 });
    if (cid != null) (map.getSource('overview') as GeoJSONSource).getClusterExpansionZoom(cid).then(z => go(Math.min(z + 0.5, 9.5)), () => go(map.getZoom() + 2));
    else go(9.5);
    return;
  }
  // Tapping a group rider shows who it is and when they were last seen.
  const rider = map.getLayer('riders-dot') ? map.queryRenderedFeatures([[e.point.x - 16, e.point.y - 16], [e.point.x + 16, e.point.y + 16]], { layers: ['riders-dot'] })[0] : undefined;
  if (rider) {
    const m = community.members.find(x => x.riderId === rider.properties.id);
    if (m?.pos) toast(`${m.name} · seen ${ago(m.pos.at)}${state.pos ? ` · ${(distanceM(state.pos, m.pos) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, m.pos))} of you` : ''}`);
    return;
  }
  // Tapping one of your rides opens it in the Ride tab (chart, stats) and keeps it highlighted.
  const ride = state.myRides && map.getLayer('myrides-line') ? map.queryRenderedFeatures([[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]], { layers: ['myrides-line'] })[0] : undefined;
  if (ride?.properties.id) { openRide(String(ride.properties.id)); return; }
  const r = 14;
  const layers = [...(state.trails ? TRAIL_LAYERS.map(l => l.id) : []), 'rider-trails'].filter(id => map.getLayer(id) && id !== 'trails-labels' && id !== 'trails-casing');
  const hits = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers });
  if (!hits.length) { if (state.viewRide && state.tab !== 'ride') { state.viewRide = null; afterRidePane(); } return; }
  // Prefer rider-made trails, then agency data, then OpenStreetMap.
  const rank = (f: maplibregl.MapGeoJSONFeature) => (f.layer.id === 'rider-trails' ? 0 : f.properties.src === 'OSM' ? 2 : 1);
  const best = hits.sort((a, b) => rank(a) - rank(b))[0];
  state.follow = false;
  popupProps = { ...(best.properties as Record<string, string>) };
  if (useSheetDetails()) {
    state.detail = true; setPanel(true);
    tapMarker.setLngLat(e.lngLat).addTo(map);
    renderPane();
    $('#pane').scrollTop = 0;
  } else {
    popup.setLngLat(e.lngLat).setHTML(popupHtml(popupProps)).addTo(map);
  }
});
// Buttons inside the popup.
for (const el of ['#map', '#pane']) $(el).addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rate], button[data-closedetail], button[data-confirm], button[data-act="garage"], button[data-makebadge], button[data-badgeinfo]'); if (!b) return;
  if (b.dataset.makebadge) { badgeTrailForm(b.dataset.makebadge); return; }
  if (b.dataset.badgeinfo) { badgeSheet(b.dataset.badgeinfo); return; }
  if (b.dataset.act === 'garage') { popup.remove(); if (state.detail) { state.detail = false; tapMarker.remove(); } state.tab = 'garage'; setPanel(true); render(); $('#pane').scrollTop = 0; return; }
  if (b.dataset.rate) openRateSheet(b.dataset.rate);
  if (b.dataset.confirm) { void community.confirmTrail(b.dataset.confirm).then(() => { refreshPopup(); toast('Thanks! Three confirmations make a trail verified.'); }); }
  if (b.dataset.closedetail != null) closeDetails();
});
map.on('mousemove', e => {
  if (!state.trails) return;
  const hit = map.queryRenderedFeatures(e.point, { layers: TRAIL_LAYERS.map(l => l.id).filter(id => map.getLayer(id)) }).length;
  map.getCanvas().style.cursor = hit ? 'pointer' : '';
});
// ---------------------------------------------------------------- difficulty colours and ratings
function applyColorBy() {
  for (const id of COLORED_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', trailColor(state.colorBy) as never);
  if (map.getLayer('rider-trails')) map.setPaintProperty('rider-trails', 'line-color', riderColor() as never);
}
function riderColor(): unknown {
  if (state.colorBy === 'access') return '#E8501A';
  const own = ['coalesce', ['feature-state', 'comm'], ['get', 'difficulty']];
  if (state.colorBy === 'rig') return stepColor(['coalesce', ['feature-state', 'rig'], own]);
  return state.colorBy === 'mine' ? ['case', ['!=', ['feature-state', 'mine'], null], stepColor(['feature-state', 'mine']), stepColor(own)] : stepColor(own);
}
/** Push every known rating into the map as feature state, keyed by trail id. */
function applyRatingStates() {
  const mine = community.myRatings(), scores = community.scores();
  const v = community.activeVehicle(), my = v ? rigScore(v) : 0, slope = community.rigSlope();
  const ids = new Set([...mine.keys(), ...scores.keys()]);
  for (const tid of ids) {
    const target = tid.startsWith('RIDER:') ? { source: 'rider-trails', id: tid } : { source: 'trails', sourceLayer: 'trails', id: tid };
    if (!map.getSource(target.source)) continue;
    const sc = scores.get(tid), rig = v && sc ? forecast(sc.avg, sc.rig, my, slope) : null;
    map.setFeatureState(target, { mine: mine.get(tid) ?? null, comm: sc?.avg ?? null, rig, shift: rig != null && sc ? bandShift(sc.avg, rig) : 0 });
  }
}
const rigMarksVisible = () => state.trails && state.rigMarks && !!community.activeVehicle();
function applyRigMarks() {
  for (const id of ['trails-rig-harder', 'trails-rig-easier', 'rider-trails-rig-harder', 'rider-trails-rig-easier']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', rigMarksVisible() ? 'visible' : 'none');
}
function openRateSheet(tid: string) {
  const title = popupProps?.name || (popupProps?.num ? `route ${popupProps.num}` : community.trails().find(t => `RIDER:${t.id}` === tid)?.name) || 'this trail';
  const vs = community.garage(), v = community.activeVehicle();
  const rigLine = !v ? '<p class="quiet">Tip: add your vehicle in the Garage tab so your rating helps riders with a similar setup.</p>'
    : vs.length > 1 ? `<label class="rigpick">Rode it in <select id="ratevehicle">${vs.map(x => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>${esc(x.nickname)} (${rigClass(rigScore(x)).toLowerCase()})</option>`).join('')}</select></label>`
    : `<p class="quiet">Rode it in your ${badge(v.color)}<b>${esc(v.nickname)}</b> (${rigClass(rigScore(v)).toLowerCase()}, ${rigScore(v)}/10).</p>`;
  sheet(rateSheetHtml(tid, title, community.myRatings().get(tid), rigLine));
}
async function vote(tid: string, n: number | null) {
  if (n == null) await community.clearRating(tid); else await community.rate(tid, n);
  const target = tid.startsWith('RIDER:') ? { source: 'rider-trails', id: tid } : { source: 'trails', sourceLayer: 'trails', id: tid };
  map.setFeatureState(target, { mine: n, comm: community.scores().get(tid)?.avg ?? null });
  closeSheet(); refreshPopup();
  const rode = community.activeVehicle();
  toast(n == null ? 'Rating removed.' : `Rated ${n} (${levelOf(n).band})${rode ? ` in your ${rode.nickname}` : ''}.${state.colorBy === 'access' ? ' Use the layers button to color trails by difficulty.' : ''}`);
  if (n != null) checkBadges();
}

// ---------------------------------------------------------------- rider account (share trails and ratings)
function accountHtml(): string {
  const pending = community.pendingCount();
  const status = { offline: 'Offline: changes will upload when you have signal.', syncing: 'Syncing…', 'up-to-date': 'Up to date.', error: "Couldn't reach the TrailLink database. Will retry." }[community.syncState];
  if (community.signedIn) {
    return `<h2>Sharing with riders</h2>
      <div class="card"><b>${esc(community.me()?.name ?? 'Rider')}</b><div class="quiet">${esc(community.email ?? '')}</div>
      <p class="quiet">${pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to upload. ` : ''}${status}${community.lastSynced ? ` Last synced ${new Date(community.lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
      <div class="btns"><button data-act="sync">Sync now</button><button data-act="rename">Change name</button><button data-act="signout">Sign out</button></div>
      ${community.isAdmin ? '<div class="btns"><button data-act="admin">Manage riders (admin)</button></div>' : ''}</div>
      ${backupHtml()}`;
  }
  const si = state.signin;
  return `<h2>Share with other riders</h2>
    <p class="quiet">Sign in to share your trails and ratings and see everyone else's. No password: we email you a 6-digit code.${pending ? ` ${pending} change${pending === 1 ? '' : 's'} on this phone will upload when you sign in.` : ''}</p>
    ${si?.sent ? `<form id="codeform" class="form">
        <p><b>We emailed a 6-digit code to ${esc(si.email)}.</b> Type it here. You don't need to tap anything in the email.</p>
        <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required placeholder="123456" class="codeinput"></label>
        ${si.error ? `<p class="quiet" style="color:var(--red)">${esc(si.error)}</p>` : ''}
        <div class="btns"><button type="button" data-act="signin-back">Back</button><button class="primary" ${si.busy ? 'disabled' : ''}>Sign in</button></div>
      </form>`
    : `<form id="signinform" class="form">
        <label>Your name (shown as "created by")<input name="name" required maxlength="40" value="${esc(community.me()?.name ?? '')}" placeholder="e.g. Jason"></label>
        <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(si?.email ?? '')}" placeholder="you@example.com"></label>
        ${si?.error ? `<p class="quiet" style="color:var(--red)">${esc(si.error)}</p>` : ''}
        <div class="btns"><button class="primary" ${si?.busy ? 'disabled' : ''}>Email me a code</button></div>
      </form>`}
    <p class="quiet">${community.mode === 'online' ? 'Connected: you can already see other riders\' ratings and trails.' : status}</p>`;
}

// ---------------------------------------------------------------- map panels (layers button and base map button)
function layersPanelHtml(): string {
  const v = community.activeVehicle();
  const modeNote = state.colorBy === 'mine' ? 'Trails you rated show your rating; the rest show the riders\' rating.'
    : state.colorBy === 'rig' ? (v ? `Forecast for your <b>${esc(v.nickname)}</b>: the riders' rating, adjusted for how their rigs compare to yours.` : 'Add your vehicle in the Garage tab to see trails colored for your rig.')
    : state.colorBy === 'community' ? 'The riders\' rating. Grey trails aren\'t rated yet.' : 'Who may legally ride each route.';
  return `<h3>Trails</h3>
      <label class="tg">OHV trails and roads <input type="checkbox" data-set="trails" ${state.trails ? 'checked' : ''}></label>
      <label class="tg">Compass bar <input type="checkbox" data-set="compass" ${state.compass ? 'checked' : ''}></label>
      <label class="tg">My recorded rides <input type="checkbox" data-set="myRides" ${state.myRides ? 'checked' : ''}></label>
      <label class="tg">Group line (who's falling behind) <input type="checkbox" data-set="groupLine" ${state.groupLine ? 'checked' : ''}></label>
      <label class="tg">Forest Service map image (official MVUM drawing) <input type="checkbox" data-set="mvum" ${state.mvum ? 'checked' : ''}></label>
      <p class="quiet" style="margin:12px 0 4px"><b>Color trails by</b></p>
      <div class="seg seg4" role="group" aria-label="Color trails by">
        <button data-colorby="access" aria-pressed="${state.colorBy === 'access'}">Who can ride</button>
        <button data-colorby="community" aria-pressed="${state.colorBy === 'community'}">Difficulty: riders</button>
        <button data-colorby="rig" aria-pressed="${state.colorBy === 'rig'}">Difficulty: my rig</button>
        <button data-colorby="mine" aria-pressed="${state.colorBy === 'mine'}">Difficulty: mine</button>
      </div>
      <p class="quiet">${modeNote}</p>
      <label class="tg"><span><span class="mk harder">▲</span><span class="mk easier">▼</span> Mark trails that are harder or easier for my rig</span> <input type="checkbox" data-set="rigMarks" ${state.rigMarks ? 'checked' : ''}></label>
      ${state.rigMarks && !v ? '<p class="quiet">Markers appear once you add a vehicle in the Garage tab.</p>' : ''}
      <details class="about"><summary>${inl(ICONS.info, 16)} About the trail data</summary><p class="quiet">Tap any trail for details and to rate it. Sources: Forest Service Motor Vehicle Use Maps and BLM travel plans (legal designations), plus OpenStreetMap (community data, not a legal designation). Covers ${state.trailMeta ? `${state.trailMeta.counts ? Object.values(state.trailMeta.counts).reduce((a, b) => a + b, 0).toLocaleString() : ''} routes in Colorado and Utah, updated ${new Date(state.trailMeta.built).toLocaleDateString()}` : 'Colorado and Utah'}. Always follow posted signs.</p></details>
      <div class="btns"><button data-panel="legend">Legend</button><button class="primary" data-close>Done</button></div>`;
}
function legendPanelHtml(): string {
  const mode = { access: 'Who can ride', community: 'Difficulty: riders', rig: 'Difficulty: my rig', mine: 'Difficulty: mine' }[state.colorBy];
  const sw = (svg: string, label: string) => `<span class="lg">${svg}${label}</span>`;
  const line = (c: string, dash = '') => `<svg viewBox="0 0 34 8" aria-hidden="true"><line x1="2" y1="4" x2="32" y2="4" stroke="${c}" stroke-width="4" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;
  return `<h3>Legend</h3>
      <p class="quiet" style="margin-bottom:4px">Trails are colored by <b>${mode}</b>${state.trails ? '' : ' (trails are turned off)'}.</p>
      ${state.colorBy === 'access' ? legendHtml() : difficultyLegendHtml()}
      <p class="quiet" style="margin:12px 0 4px"><b>Also on the map</b></p>
      <div class="legend">
        ${sw(line('#E8501A', '6 3'), 'Rider-created trail (dashed until verified)')}
        ${sw(`<span class="lgpin">${pinIcon('report', 'tree', 26)}</span>`, 'Pin or trail report (tap it for details)')}
        ${sw(`<span class="lgpin shared">${pinIcon('report', 'water', 26)}</span>`, 'Dashed ring: shared by another rider')}
        ${sw(`<span class="lgpin">${pinIcon('regroup', undefined, 26)}<i class="hasphoto">${ICONS.camera}</i></span>`, 'Camera badge: pin has photos')}
        ${sw('<span class="mk harder">▲</span>', 'Harder for your rig')}
        ${sw('<span class="mk easier">▼</span>', 'Easier for your rig')}
        ${sw('<span class="lgdot">12</span>', 'Zoomed out: number of trails nearby (tap to zoom in)')}
        ${sw(line('#0EA5E9'), 'The ride you are recording now')}
        ${sw(line('#8B5CF6'), 'Your past rides (tap one to open it; bold = the one picked)')}
        ${sw('<span class="lgdot rider">JC</span>', 'Group rider sharing location (faded: not seen for 10+ min)')}
      </div>
      <div class="btns"><button data-panel="layers">Change trail colors</button><button class="primary" data-close>Done</button></div>`;
}
function basemapPanelHtml(): string {
  const areas = savedAreas();
  const d = state.download;
  return `<h3>Base map</h3>
      <div class="seg" role="group" aria-label="Base map">${(Object.keys(BASE_MAPS) as BaseMapId[]).map(id => `<button data-base="${id}" aria-pressed="${state.base === id}">${BASE_MAPS[id].label}</button>`).join('')}</div>
      <h2>Dark mode</h2>
      <div class="seg seg3" role="group" aria-label="Dark mode">${(['auto', 'light', 'dark'] as Theme[]).map(t => `<button data-theme="${t}" aria-pressed="${state.theme === t}">${t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div>
      <p class="quiet">Auto follows your phone's setting. Dark also dims the map for night riding.</p>
      <h2>Offline maps</h2>
      <p class="quiet">Save the area on screen to use it with no signal.</p>
      ${d ? `<div class="card"><b>Saving… ${d.done} of ${d.total}</b><div class="bar"><i style="width:${Math.round((d.done / Math.max(1, d.total)) * 100)}%"></i></div><div class="btns"><button data-act="cancel-dl">Cancel</button></div></div>`
          : `<div class="btns"><button class="primary" data-act="save-area">Save the area on screen</button></div>`}
      ${areas.map(a => `<div class="row"><div class="grow"><b>${esc(a.name)}</b><div class="quiet">Zoom ${a.minZ}–${a.maxZ} · ${a.tiles.toLocaleString()} pieces · ${new Date(a.savedAt).toLocaleDateString()}</div></div>
        <button class="ibtn" data-showarea="${a.id}" aria-label="Show on map">${ICONS.target}</button><button data-forget="${a.id}" aria-label="Remove from list" class="ibtn">${ICONS.x}</button></div>`).join('')}
      <p class="quiet" id="storage"></p>
      ${areas.length ? '<div class="btns"><button data-act="clear-tiles">Delete all saved maps</button></div>' : ''}
      <div class="btns"><button data-close>Done</button></div>`;
}
function panelHtml() { return state.panel === 'layers' ? layersPanelHtml() : state.panel === 'legend' ? legendPanelHtml() : state.panel === 'riders' ? groupHtml(true) : basemapPanelHtml(); }
function openPanel(p: 'layers' | 'basemap' | 'legend' | 'riders') { sheet('', 'panel'); state.panel = p; refreshPanel(); }
/** Keep an open panel current (download progress, toggles). */
function refreshPanel() {
  if (!state.panel || $('#sheet').hidden || typingIn('#sheet')) return;
  const body = $('#sheet-body'), top = body.scrollTop;
  body.innerHTML = framed(panelHtml()); body.scrollTop = top; fillStorage(); afterChat();
}
function fillStorage() { if (state.panel === 'basemap') void storageSummary().then(s => { const el = document.getElementById('storage'); if (el) el.textContent = s; }); }

// ---------------------------------------------------------------- garage: your vehicles and their setup
function garageHtml(): string {
  const vs = community.garage(), active = community.activeVehicle();
  return `<h2>Your garage</h2>
    ${vs.map(v => { const sc = rigScore(v), on = v.id === active?.id, open = state.openVehicles.has(v.id); return `<div class="vehicle${on ? ' on' : ''}">
      <button class="vhead" data-togglevehicle="${v.id}" aria-expanded="${open}">${badge(v.color)}<b>${esc(v.nickname)}</b>${on ? ' <span class="tag">Riding</span>' : ''}<span class="chev" aria-hidden="true">${open ? ICONS.chevUp : ICONS.chevDown}</span></button>
      ${open ? `<div class="vbody">
        ${vehicleTitle(v) !== v.nickname ? `<div><b>${esc(vehicleTitle(v).slice(v.nickname.length + 3))}</b></div>` : ''}
        <div class="quiet">${esc(vehicleSummary(v))}</div>
        <div class="quiet"><b>${rigClass(sc)}</b> · rig score ${sc}/10</div>
        <div class="btns">${on || vs.length < 2 ? '' : `<button data-ridevehicle="${v.id}">Ride this</button>`}<button data-editvehicle="${v.id}">Edit</button><button data-delvehicle="${v.id}">Remove</button></div>
      </div>` : ''}</div>`; }).join('')}
    <div class="btns"><button class="${vs.length ? '' : 'primary'}" data-act="addvehicle">Add a vehicle</button></div>`;
}

/** A round color badge for a vehicle (nothing if no color was picked). */
const badge = (color?: string) => (color ? `<span class="vbadge" style="--c:${color}" aria-hidden="true"></span>` : '');
function vehicleForm(v?: Vehicle) {
  const opt = <T,>(items: { v: T; label: string }[], cur: T) => items.map(i => `<option value="${i.v}" ${i.v === cur ? 'selected' : ''}>${i.label}</option>`).join('');
  const x: Vehicle = v ?? { id: '', nickname: '', make: '', model: '', widthIn: 64, tireIn: 28, liftIn: 0, lockers: 'none', winch: false, skids: false, sliders: false, updatedAt: '' };
  sheet(`<h3>${v ? `Edit ${esc(v.nickname)}` : 'Add a vehicle'}</h3>
    <form id="vehicleform" class="form">
      ${v ? `<input type="hidden" name="vid" value="${v.id}">` : ''}
      <label>Nickname<input name="nickname" required maxlength="40" value="${esc(x.nickname)}" placeholder="e.g. The Turbo"></label>
      <div class="cols3">
        <label>Year<input name="year" inputmode="numeric" maxlength="4" pattern="(19|20)[0-9]{2}" value="${x.year ?? ''}" placeholder="2024"></label>
        <label>Make<input name="make" maxlength="40" value="${esc(x.make)}" placeholder="Polaris"></label>
        <label>Model<input name="model" maxlength="60" value="${esc(x.model)}" placeholder="RZR Pro R"></label>
      </div>
      <fieldset class="colors"><legend>Badge color</legend>
        ${BADGE_COLORS.map(c => `<label class="swatch" style="--c:${c}" title="${c}"><input type="radio" name="color" value="${c}" ${(x.color ?? '').toUpperCase() === c ? 'checked' : ''}><span></span></label>`).join('')}
        <label class="swatch custom" title="Pick any color"><input type="radio" name="color" value="custom" ${x.color && !BADGE_COLORS.includes(x.color.toUpperCase()) ? 'checked' : ''}><input type="color" name="customColor" value="${x.color && !BADGE_COLORS.includes(x.color.toUpperCase()) ? x.color : '#E8501A'}" aria-label="Any color"></label>
        <label class="swatch none" title="No badge"><input type="radio" name="color" value="" ${x.color ? '' : 'checked'}><span>${ICONS.x}</span></label>
      </fieldset>
      <label>Width<select name="widthIn">${opt(WIDTHS, x.widthIn)}</select></label>
      <div class="cols2">
        <label>Tire size<select name="tireIn">${opt(TIRE_SIZES.map(n => ({ v: n, label: `${n}"` })), x.tireIn)}</select></label>
        <label>Lift<select name="liftIn">${opt(LIFTS.map(n => ({ v: n, label: n ? `${n}"${n === 6 ? ' or more' : ''}` : 'Stock height' })), x.liftIn)}</select></label>
      </div>
      <label>Lockers<select name="lockers">${opt(LOCKERS, x.lockers)}</select></label>
      <label class="tg">Skid plates <input type="checkbox" name="skids" ${x.skids ? 'checked' : ''}></label>
      <label class="tg">Rock sliders <input type="checkbox" name="sliders" ${x.sliders ? 'checked' : ''}></label>
      <label class="tg">Winch <input type="checkbox" name="winch" ${x.winch ? 'checked' : ''}></label>
      <p class="quiet" id="rigpreview"></p>
      <div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div>
    </form>`);
  updateRigPreview();
}
function vehicleFromForm(f: FormData): Omit<Vehicle, 'id' | 'updatedAt'> & { id?: string } {
  const year = Number(f.get('year'));
  return {
    id: String(f.get('vid') ?? '') || undefined, nickname: String(f.get('nickname') ?? '').trim() || 'My rig',
    make: String(f.get('make') ?? '').trim(), model: String(f.get('model') ?? '').trim(), year: year >= 1980 && year <= 2100 ? year : undefined,
    widthIn: Number(f.get('widthIn')) as Vehicle['widthIn'], tireIn: Number(f.get('tireIn')), liftIn: Number(f.get('liftIn')),
    lockers: f.get('lockers') as Vehicle['lockers'], winch: f.has('winch'), skids: f.has('skids'), sliders: f.has('sliders'),
    color: (() => { const c = String(f.get('color') ?? ''); const v = c === 'custom' ? String(f.get('customColor') ?? '') : c; return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined; })(),
  };
}
function updateRigPreview() {
  const form = document.getElementById('vehicleform') as HTMLFormElement | null, out = document.getElementById('rigpreview');
  if (!form || !out) return;
  const sc = rigScore(vehicleFromForm(new FormData(form)));
  out.innerHTML = `Rig score <b>${sc}/10 · ${rigClass(sc)}</b>. Tires and lift count most, then lockers, then armor.`;
}
function afterGarageChange() { applyRatingStates(); applyRigMarks(); refreshPopup(); if (!state.detail) renderPane(); }

// ---------------------------------------------------------------- ride groups: riders on the map
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`;
};
const STALE_MIN = 10;
const initials = (name: string) => name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

function ridersGeo(): FeatureCollection {
  const me = community.session?.user.id;
  return { type: 'FeatureCollection', features: community.members.filter(m => m.pos && m.sharing && m.riderId !== me).map(m => {
    const stale = Date.now() - Date.parse(m.pos!.at) > STALE_MIN * 60000;
    const moving = !stale && m.pos!.heading != null && Number.isFinite(m.pos!.heading) && (m.pos!.speed ?? 0) > 0.5;
    return { type: 'Feature', properties: { id: m.riderId, initials: initials(m.name), label: stale ? `${m.name} · ${ago(m.pos!.at)}` : m.name, stale, ...(moving ? { heading: m.pos!.heading } : {}) },
      geometry: { type: 'Point', coordinates: [m.pos!.lon, m.pos!.lat] } };
  }) };
}
function drawRiders() { (map.getSource('riders') as GeoJSONSource | undefined)?.setData(ridersGeo()); refreshPanel(); drawHeading(); drawGroupLine(); }

// ---------------------------------------------------------------- group line: who's ahead, who's falling behind
// A slim line above the chat bar: the leader on the right, everyone placed by how far along the trail they are.
let crumbs: Breadcrumbs | null = null, crumbsGroup = '';
const lineEl = Object.assign(document.createElement('div'), { id: 'groupline', hidden: true });
$('#mapwrap').append(lineEl);
let behindSpokenAt = 0;
function drawGroupLine() {
  const g = community.signedIn ? community.group : null;
  if (!g || !state.groupLine) { lineEl.hidden = true; return; }
  if (crumbsGroup !== g.id) { crumbs = new Breadcrumbs(`traillink.crumbs.${g.id}`); crumbsGroup = g.id; }
  const now: Record<string, LL> = {};
  for (const m of community.members) {
    if (m.riderId === community.uid || !m.pos || !m.sharing || Date.now() - Date.parse(m.pos.at) > 10 * 60e3) continue;
    crumbs!.add(m.riderId, m.pos); now[m.riderId] = m.pos;
  }
  if (state.pos && community.uid) { crumbs!.add(community.uid, state.pos); now[community.uid] = state.pos; }
  crumbs!.save();
  const r = crumbs!.places(now);
  if (!r) { lineEl.hidden = true; return; }
  const sorted = [...r.places].sort((a, b) => a.along - b.along);
  const lo = sorted[0].along, hi = sorted[sorted.length - 1].along, span = Math.max(hi - lo, 50);
  const name = (id: string) => id === community.uid ? 'You' : (community.members.find(m => m.riderId === id)?.name ?? 'Rider').replace(/\s*\(test\)/, '');
  // The biggest gap between neighbours: if over half a mile, that rider (and everyone behind) is "falling behind".
  let gapAt = -1, gap = 0;
  for (let i = 1; i < sorted.length; i++) { const d = sorted[i].along - sorted[i - 1].along; if (d > gap) { gap = d; gapAt = i; } }
  const behind = gap > 805 ? sorted.slice(0, gapAt) : [];
  const last = sorted[0];
  const dots = sorted.map(p => {
    const x = ((p.along - lo) / span) * 100, me = p.riderId === community.uid, late = behind.includes(p);
    return `<span class="gl-dot${me ? ' me' : ''}${late ? ' late' : ''}" style="left:${x.toFixed(1)}%" title="${esc(name(p.riderId))}">${me ? '' : esc(initials(name(p.riderId)))}</span>`;
  }).join('');
  const tail = hi - last.along;
  lineEl.innerHTML = `<div class="gl-track">${dots}</div><div class="gl-text">${behind.length ? `<b class="late">${esc(behind.map(p => name(p.riderId)).join(', '))} ${(gap / 1609.344).toFixed(1)} mi behind</b>` : `Group spread ${fmtDistShort(tail)}`}${behind.length ? '' : `<span>Leader: ${esc(name(sorted[sorted.length - 1].riderId))}</span>`}</div>`;
  lineEl.hidden = false;
  if (behind.length && Date.now() - behindSpokenAt > 10 * 60e3) {
    behindSpokenAt = Date.now();
    speak(`${behind.map(p => name(p.riderId)).join(' and ')} ${behind.length > 1 ? 'are' : 'is'} ${(gap / 1609.344).toFixed(1)} miles behind the group.`);
  }
}
function fmtDistShort(m: number) { const mi = m / 1609.344; return mi < 0.1 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${mi.toFixed(1)} mi`; }
lineEl.addEventListener('click', () => { openPanel('riders'); });

let lastShare = 0, lastSharedAt: { lat: number; lon: number } | null = null;
/** While sharing: send my position every 15 s when moving, at least once a minute when parked. */
function maybeSharePosition() {
  const p = state.pos;
  if (!p || !community.sharing || !navigator.onLine) return;
  const since = Date.now() - lastShare, moved = lastSharedAt ? distanceM(lastSharedAt, p) : Infinity;
  if (since < 15000 || (moved < 20 && since < 60000)) return;
  lastShare = Date.now(); lastSharedAt = { lat: p.lat, lon: p.lon };
  void community.postPosition({ lat: p.lat, lon: p.lon, acc: p.acc, speed: p.speed, heading: p.heading });
}
setInterval(maybeSharePosition, 30000);

function memberRow(m: GroupMember): string {
  const me = m.riderId === community.session?.user.id;
  const where = me ? (m.sharing ? 'Sharing your location' : 'Not sharing')
    : !m.sharing ? 'Not sharing location'
    : !m.pos ? 'Sharing, waiting for a position'
    : `${state.pos ? `${(distanceM(state.pos, m.pos) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, m.pos))} · ` : ''}seen ${ago(m.pos.at)}`;
  const stale = m.pos && Date.now() - Date.parse(m.pos.at) > STALE_MIN * 60000;
  return `<div class="row member"><span class="avatar${m.sharing && m.pos && !stale ? ' live' : ''}">${esc(initials(m.name))}</span>
    <div class="grow"><b>${esc(m.name)}${me ? ' (you)' : ''}</b><div class="quiet">${where}</div></div>
    ${!me && m.sharing && m.pos ? `<button class="ibtn" data-rider="${m.riderId}" aria-label="Show ${esc(m.name)} on map">${ICONS.target}</button>` : ''}</div>`;
}

function groupHtml(compact: boolean): string {
  if (!community.signedIn) return `<h2>Ride group</h2><p class="quiet">Sign in (Trails tab) to ride with a group.</p>`;
  const g = community.group, err = state.groupError ? `<p class="quiet" style="color:var(--red)">${esc(state.groupError)}</p>` : '';
  if (!g) return `<h2>Ride group</h2>
    <p class="quiet">Start a group for a ride and share its code, or join one. You choose when the group can see your location.</p>
    <form id="groupstart" class="form"><label>Start a group<input name="name" required maxlength="40" placeholder="e.g. Saturday at Taylor Park"></label>
      <div class="btns"><button class="primary" ${state.groupBusy ? 'disabled' : ''}>Start group</button></div></form>
    <div class="btns"><button data-act="groupscan">${inl(ICONS.qr)} Scan a group's QR code</button></div>
    <form id="groupjoin" class="form"><label>Or type the code<input name="code" required maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="6-letter code" style="text-transform:uppercase;letter-spacing:3px"></label>
      <div class="btns"><button ${state.groupBusy ? 'disabled' : ''}>Join group</button></div></form>${err}${compact ? '' : rideLogHtml()}`;
  const me = community.session?.user.id;
  const members = [...community.members].sort((a, b) => (a.riderId === me ? -1 : b.riderId === me ? 1 : a.name.localeCompare(b.name)));
  const sharingCount = members.filter(m => m.sharing).length;
  return `<h2>${esc(g.name)}</h2>
    <div class="row"><div class="grow"><div class="quiet">Join code</div><b class="code">${esc(g.code)}</b></div><button class="ibtn" data-act="groupqr" aria-label="Show QR code to join" title="QR code">${ICONS.qr}</button><button data-act="groupshare">Share</button></div>
    <label class="tg"><span><b>Share my location</b><br><span class="quiet">${community.sharing ? 'The group can see where you are.' : 'Off: the group can\'t see you.'}</span></span>
      <input type="checkbox" data-set="sharing" ${community.sharing ? 'checked' : ''} ${state.groupBusy ? 'disabled' : ''}></label>
    ${err}
    ${compact ? '' : `<div class="btns"><button data-openchat>${inl(ICONS.chat)} Group chat</button></div>
    ${chat.pushSupported ? `<label class="tg small"><span>${inl(ICONS.bell, 16)} Notify me of new messages</span><input type="checkbox" data-set="pushOn" ${chat.pushOn ? 'checked' : ''}></label>` : ''}`}
    <p class="quiet" style="margin:12px 0 4px"><b>Riders (${members.length})</b> · ${sharingCount} sharing${community.groupUpdated ? ` · updated ${ago(community.groupUpdated)}` : ''}${navigator.onLine ? '' : ' · no signal'}</p>
    ${members.map(memberRow).join('') || '<p class="quiet">Loading…</p>'}
    <div class="btns">${compact ? '' : '<button data-act="grouprefresh">Refresh</button>'}<button class="danger" data-act="groupleave">Leave group</button></div>
    ${compact ? '' : checklistHtml()}
    ${compact ? '' : testRidersHtml()}
    ${compact ? '' : rideLogHtml()}`;
}

// ---------------------------------------------------------------- group messages (kept as a ride log)
const chat = new GroupChat(community);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const isUrgent = (m: ChatMessage) => m.kind === 'help' || (m.kind === 'quick' && m.body === 'Need help');
const snippet = (m: ChatMessage) => (m.kind === 'location' ? 'Location' : m.body.length > 50 ? `${m.body.slice(0, 47)}…` : m.body);
/** My newest sent message carries the "Seen by" line. */
let lastMineId: string | null = null;
const riderName = (id: string) => (community.members.find(x => x.riderId === id)?.name ?? 'Rider').replace(/\s*\(test\)/, '');
function msgHtml(m: ChatMessage): string {
  const mine = m.riderId === community.uid;
  const seenNames = mine && m.id === lastMineId && !m.pending ? chat.seenBy(m).map(riderName) : null;
  const seen = seenNames ? `<div class="msgseen">${seenNames.length ? `Seen by ${esc(seenNames.join(', '))}` : 'Delivered'}</div>` : '';
  const orig = m.replyTo ? chat.thread(m.groupId).find(x => x.id === m.replyTo) : undefined;
  const quote = m.replyTo ? `<button class="msgquote" data-jump="${m.replyTo}">${inl(ICONS.reply, 13)} ${orig ? `${orig.riderId === community.uid ? 'You' : esc(orig.by)}: ${esc(snippet(orig))}` : 'an earlier message'}</button>` : '';
  const when = m.pending ? 'waiting for signal' : timeOf(m.createdAt ?? m.sentAt);
  if (m.kind === 'spotclear') { const o = chat.thread(m.groupId).find(x => x.id === m.replyTo); return `<div class="msgsys gray" data-msg="${m.id}">${mine ? 'You' : esc(m.by)} took “${esc(o?.body ?? 'a spot')}” off the map · ${when}</div>`; }
  if (m.kind === 'helpclear') return `<div class="msgsys" data-msg="${m.id}">${inl(ICONS.check, 14)} ${mine ? 'You are' : `${esc(m.by)} is`} OK now · ${when}</div>`;
  const body = m.kind === 'help'
    ? `<span class="msgtext urgent">Need help${m.lat != null ? '' : ''}</span>${m.lat != null ? `<button class="msgloc" data-chatgo="${m.id}">${inl(ICONS.pin, 16)} ${state.pos ? `${(distanceM(state.pos, { lat: m.lat, lon: m.lon! }) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, { lat: m.lat, lon: m.lon! }))}` : 'Where'}</button>` : ''}`
    : m.kind === 'location'
    ? `<button class="msgloc" data-chatgo="${m.id}">${inl(ICONS.pin, 16)} ${m.body ? esc(m.body) : mine ? 'My location' : 'Location'}${state.pos && m.lat != null ? ` · ${(distanceM(state.pos, { lat: m.lat, lon: m.lon! }) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, { lat: m.lat, lon: m.lon! }))}` : ''}</button>`
    : `<span class="msgtext${m.kind === 'quick' ? ' quick' : ''}${isUrgent(m) ? ' urgent' : ''}">${esc(m.body)}</span>`;
  return `<div class="msg${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}${replyTo === m.id ? ' replying' : ''}" data-msg="${m.id}"><div class="msgmeta">${mine ? 'You' : esc(m.by)} · ${when}</div>${quote}${body}${seen}</div>`;
}
function chatHtml(groupId: string, readonly: boolean): string {
  const msgs = chat.thread(groupId);
  return `<div class="chatwrap"><div class="chat" data-chat="${groupId}">${msgs.length ? msgs.map(msgHtml).join('') : '<p class="quiet chatempty">No messages yet. Tap a quick message or type one below.</p>'}</div>
    ${readonly ? '' : `<div class="quickrow">${QUICK.map(q => `<button class="qchip${q === 'Need help' ? ' urgent' : ''}" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form id="chatform" class="chatform"><input name="msg" maxlength="500" autocomplete="off" enterkeyhint="send" placeholder="Message the group">
      <button type="button" class="ibtn" data-chatloc aria-label="Send my location" title="Send my location">${ICONS.pin}</button>
      <button class="ibtn sendbtn" aria-label="Send">${ICONS.send}</button></form>
    `}</div>`;
}
function rideLogHtml(): string {
  const past = chat.log.filter(l => l.id !== community.group?.id);
  if (!past.length) return '';
  return `<details class="about"><summary>${inl(ICONS.info, 16)} Ride log (${past.length})</summary>
    ${past.map(l => `<div class="row"><button class="pinmain" data-chatlog="${l.id}"><b>${esc(l.name)}</b><span class="quiet">${new Date(l.joinedAt).toLocaleDateString()}</span></button></div>`).join('')}</details>`;
}
/** After the chat is drawn: scroll to the newest message and count it as read. */
function afterChat() {
  for (const el of document.querySelectorAll<HTMLElement>('.chat')) {
    el.scrollTop = el.scrollHeight;
    if (el.offsetParent) chat.markRead(el.dataset.chat!);
  }
}
/** Unread messages are shown only on the chat bar on the map (owner: the Riders button and Group tab don't open the chat). */
function updateUnread() {
  for (const el of [document.querySelector('#tabs button[data-tab="group"]'), $('#btn-riders')]) el?.removeAttribute('data-unread');
}
// ---- Chat on the map: a slim pill between SOS and Report shows the latest message; tap it for a short drawer
// over the bottom of the map (the map stays visible and usable above it). New messages also pop up as a speech
// bubble over the sender's dot on the map for a few seconds.
const chatPill = Object.assign(document.createElement('button'), { id: 'chatpill', hidden: true });
chatPill.setAttribute('aria-label', 'Group chat');
const drawer = Object.assign(document.createElement('section'), { id: 'chatdrawer', hidden: true });
drawer.setAttribute('aria-label', 'Group chat');
drawer.innerHTML = `<div class="cdhead"><b id="cdtitle"></b><span class="grow"></span>
    <button class="ibtn" id="cdspeak" aria-label="Read messages aloud" title="Read messages aloud">${ICONS.speaker}</button>
    <button class="ibtn" id="cdbell" aria-label="Notifications for new messages" title="Notifications">${ICONS.bell}</button>
    <button class="ibtn" id="cdclose" aria-label="Close chat">${ICONS.chevDown}</button></div>
  <div class="chat" id="cdlist"></div>
  <div class="quickrow">${QUICK.map(q => `<button class="qchip${q === 'Need help' ? ' urgent' : ''}" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <div class="bigbtns">${['Stopping', 'Wait for me', 'Go ahead', 'All good'].map(q => `<button data-quick="${q}">${q}</button>`).join('')}<button class="urgent" data-quick="Need help">Need help</button>
    <button class="fullchat" id="cdfull">Full chat</button></div>
  <div id="cdreply" hidden></div>
  <form id="chatform" class="chatform"><input name="msg" maxlength="500" autocomplete="off" enterkeyhint="send" placeholder="Message the group">
    <button type="button" class="ibtn" data-chatloc aria-label="Send my location" title="Send my location">${ICONS.pin}</button>
    <button class="ibtn sendbtn" aria-label="Send">${ICONS.send}</button></form>`;
$('#mapwrap').append(chatPill, drawer);
/** The message being answered (tap a message in the chat to reply to it). */
let replyTo: string | null = null;
function setReply(id: string | null) {
  const g = community.group, m = id && g ? chat.thread(g.id).find(x => x.id === id) : undefined;
  replyTo = m ? m.id : null;
  const bar = $('#cdreply'), input = drawer.querySelector<HTMLInputElement>('input[name=msg]')!;
  bar.hidden = !m;
  if (m) {
    const who = m.riderId === community.uid ? 'yourself' : esc(m.by);
    bar.innerHTML = `${inl(ICONS.reply, 16)}<span>Replying to <b>${who}</b>: ${esc(snippet(m))}</span><button class="ibtn" data-cancelreply aria-label="Cancel reply">${ICONS.x}</button>`;
    input.placeholder = `Reply to ${m.riderId === community.uid ? 'your message' : m.by}`;
    input.focus();
  } else input.placeholder = 'Message the group';
  for (const el of drawer.querySelectorAll('.msg.replying')) el.classList.remove('replying');
  if (m) drawer.querySelector(`.msg[data-msg="${m.id}"]`)?.classList.add('replying');
}
drawer.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-cancelreply]')) { setReply(null); return; }
  const jump = t.closest<HTMLElement>('[data-jump]');
  if (jump) { const el = drawer.querySelector<HTMLElement>(`.msg[data-msg="${jump.dataset.jump}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } return; }
  if (t.closest('button, a, input')) return;
  const msg = t.closest<HTMLElement>('.msg[data-msg]');
  if (msg && !msg.classList.contains('pending')) setReply(replyTo === msg.dataset.msg ? null : msg.dataset.msg!);
});
let chatOpen = false;
const chatViewOpen = () => chatOpen;
function renderMapChat() {
  const g = community.signedIn ? community.group : null;
  if (!g) { chatPill.hidden = true; if (chatOpen) setChatOpen(false); return; }
  const msgs = chat.thread(g.id), n = chat.unread(g.id);
  // With unread messages, the pill shows the newest one from someone else.
  const last = (n ? [...msgs].reverse().find(m => m.riderId !== community.uid) : undefined) ?? msgs[msgs.length - 1];
  chatPill.hidden = chatOpen;
  chatPill.classList.toggle('unread', n > 0);
  chatPill.innerHTML = `${ICONS.chat}<span class="cptext">${last ? `<b>${last.riderId === community.uid ? 'You' : esc(last.by)}:</b> ${last.kind === 'location' ? 'shared a location' : last.kind === 'help' ? 'needs help' : last.kind === 'helpclear' ? 'is OK now' : last.kind === 'spotclear' ? 'removed a spot' : esc(last.body)}` : 'Group chat'}</span>${n ? `<i class="cpcount">${n > 9 ? '9+' : n}</i>` : ''}`;
  if (!chatOpen) return;
  $('#cdtitle').textContent = g.name;
  $('#cdbell').classList.toggle('on', chat.pushOn); $('#cdbell').hidden = !chat.pushSupported;
  $('#cdspeak').classList.toggle('on', readAloud);
  drawer.classList.toggle('ridemode', rideMode && !fullChat);
  lastMineId = [...msgs].reverse().find(m => m.riderId === community.uid && !m.pending && m.kind !== 'helpclear')?.id ?? null;
  const list = $('#cdlist'), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = msgs.length ? msgs.map(msgHtml).join('') : '<p class="quiet chatempty">No messages yet. Tap a quick message or type one. Tap any message to reply to it.</p>';
  if (atBottom || list.dataset.fresh !== '1') { list.scrollTop = list.scrollHeight; list.dataset.fresh = '1'; }
  if (replyTo) list.querySelector(`.msg[data-msg="${replyTo}"]`)?.classList.add('replying');
  chat.markRead(g.id);
}
function setChatOpen(open: boolean) {
  chatOpen = open && !!community.group;
  drawer.hidden = !chatOpen; $('#mapwrap').classList.toggle('chatopen', chatOpen);
  $('#cdlist').dataset.fresh = '';
  renderMapChat(); updateUnread();
  if (chatOpen) { void chat.refresh(); }
}
function freshPill() { chatPill.classList.remove('fresh'); void chatPill.offsetWidth; chatPill.classList.add('fresh'); }
chatPill.addEventListener('click', () => setChatOpen(true));
$('#cdclose').addEventListener('click', () => { setReply(null); fullChat = false; setChatOpen(false); });
$('#cdfull').addEventListener('click', () => { fullChat = true; renderMapChat(); });
$('#cdspeak').addEventListener('click', () => {
  readAloud = !readAloud; store.set('readAloud', readAloud); renderMapChat();
  if (readAloud) speak('Reading messages aloud.'); else { speechSynthesis?.cancel(); toast('Messages won\'t be read aloud.'); }
});
$('#cdbell').addEventListener('click', () => {
  (chat.pushOn ? chat.disablePush().then(() => toast('Notifications off.')) : chat.enablePush().then(() => toast('Notifications on for new group messages.')))
    .catch((err: Error) => toast(err.message)).finally(renderMapChat);
});
drawer.addEventListener('submit', e => { e.preventDefault(); chatSubmit(e.target as HTMLFormElement); });
// ---- "Need help" alert: a red banner on every rider's map and a flashing SOS marker where they are, plus a red mark
// on the compass bar, until the rider who asked sends "I'm OK".
function sendHelp() {
  if (chat.activeHelps(community.group?.id).some(h => h.riderId === community.uid)) { toast('Your help alert is already showing for the group.'); return; }
  chat.send('help', 'Need help', state.pos ?? undefined);
  toast(state.pos ? 'Help alert sent with your location.' : 'Help alert sent. Waiting for GPS to share where you are.');
}
/** Where a rider who asked for help is now: their live shared position if newer, else where they asked from. */
function helpSpot(h: ChatMessage): { lat: number; lon: number } | null {
  const live = community.members.find(m => m.riderId === h.riderId)?.pos;
  if (live && Date.parse(live.at) > Date.parse(h.createdAt ?? h.sentAt)) return live;
  if (h.riderId === community.uid && state.pos) return state.pos;
  return h.lat != null ? { lat: h.lat, lon: h.lon! } : live ?? null;
}
const helpBanner = Object.assign(document.createElement('div'), { id: 'helpbanner', hidden: true });
helpBanner.setAttribute('role', 'alert');
$('#mapwrap').append(helpBanner);
const helpMarkers = new Map<string, maplibregl.Marker>();
function drawHelp() {
  const helps = community.signedIn ? chat.activeHelps(community.group?.id) : [];
  $('#mapwrap').classList.toggle('helpon', helps.length > 0);
  helpBanner.hidden = !helps.length;
  if (helps.length) {
    const h = helps[0], mine = h.riderId === community.uid, at = helpSpot(h);
    const where = !mine && at && state.pos ? ` · ${(distanceM(state.pos, at) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, at))}` : '';
    helpBanner.innerHTML = `<span class="hbicon">SOS</span><span class="hbtext"><b>${mine ? 'You asked for help' : `${esc(h.by)} needs help`}</b>${where} · ${ago(h.createdAt ?? h.sentAt)}${helps.length > 1 ? ` · +${helps.length - 1} more` : ''}</span>
      ${mine ? `<button class="hbok" data-helpok="${h.id}">I'm OK</button>` : at ? `<button class="hbgo" data-helpgo="${h.id}">Show</button>` : ''}`;
  }
  // Flashing SOS markers.
  const live = new Set(helps.map(h => h.id));
  for (const [id, mk] of helpMarkers) if (!live.has(id)) { mk.remove(); helpMarkers.delete(id); }
  for (const h of helps) {
    const at = helpSpot(h); if (!at || h.riderId === community.uid) continue;
    let mk = helpMarkers.get(h.id);
    if (!mk) {
      const el = document.createElement('button'); el.className = 'helpmark';
      el.innerHTML = `<i class="flash" aria-hidden="true"></i><span>${esc(initials(h.by))}</span><b>SOS · ${esc(h.by.replace(/\s*\(.*?\)/g, ''))}</b>`;
      el.setAttribute('aria-label', `${h.by} needs help`);
      el.addEventListener('click', ev => { ev.stopPropagation(); setChatOpen(true); });
      mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([at.lon, at.lat]).addTo(map); helpMarkers.set(h.id, mk);
    } else mk.setLngLat([at.lon, at.lat]);
  }
}
helpBanner.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  const ok = t.closest<HTMLElement>('[data-helpok]');
  if (ok) { try { chat.send('helpclear', "I'm OK", undefined, ok.dataset.helpok); toast('Help alert cleared for everyone.'); } catch (err) { toast((err as Error).message); } return; }
  const id = t.closest<HTMLElement>('[data-helpgo]')?.dataset.helpgo ?? chat.activeHelps(community.group?.id)[0]?.id;
  const h = id ? chat.activeHelps(community.group?.id).find(x => x.id === id) : undefined, at = h && helpSpot(h);
  if (at) { state.follow = false; $('#btn-center').classList.remove('active'); map.flyTo({ center: [at.lon, at.lat], zoom: Math.max(map.getZoom(), 15) }); }
});

// ---- Read messages aloud (phone speaker or a Bluetooth helmet headset). iPhone only allows speech after a tap,
// so the first tap anywhere in the app quietly unlocks it.
let readAloud = store.get('readAloud', true);
let speechReady = false;
document.addEventListener('pointerdown', () => {
  if (speechReady || !('speechSynthesis' in window)) return;
  speechReady = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
}, { capture: true });
function speak(text: string, urgent = false) {
  if (!('speechSynthesis' in window) || !text) return;
  if (urgent) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.lang = 'en-US';
  speechSynthesis.speak(u);
}
function speakMessage(m: ChatMessage) {
  if (!readAloud || document.visibilityState !== 'visible') return;
  const who = m.by.replace(/\s*\(test\)/, '');
  const at = m.lat != null && state.pos ? `, ${(distanceM(state.pos, { lat: m.lat, lon: m.lon! }) / 1609.344).toFixed(1)} miles ${({ N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' } as Record<string, string>)[compass(bearingDeg(state.pos, { lat: m.lat, lon: m.lon! }))] ?? ''}` : '';
  if (m.kind === 'help') speak(`Alert. ${who} needs help${at}.`, true);
  else if (m.kind === 'helpclear') speak(`${who} is OK now.`);
  else if (m.kind === 'spotclear') return;
  else if (m.kind === 'location') speak(m.body ? `${who} marked a spot: ${m.body}${at}.` : `${who} shared a location${at}.`);
  else speak(`${who}: ${m.body}`);
}

// ---- Ride mode: while moving, the chat drawer becomes a few big buttons and new messages show large for a few
// seconds. The full chat comes back when you stop (or tap "Full chat").
let rideMode = false, fullChat = false, slowSince = 0;
function updateRideMode() {
  const v = state.pos?.speed ?? 0;
  if (v > 2.2) { slowSince = 0; if (!rideMode) { rideMode = true; fullChat = false; renderMapChat(); } }
  else if (rideMode) {
    if (!slowSince) slowSince = Date.now();
    else if (Date.now() - slowSince > 20000) { rideMode = false; renderMapChat(); }
  }
}
const headsUpEl = Object.assign(document.createElement('div'), { id: 'headsup', hidden: true });
$('#mapwrap').append(headsUpEl);
let headsUpTimer = 0;
function headsUp(m: ChatMessage) {
  const text = m.kind === 'location' ? (m.body ? `📍 ${m.body}` : 'Shared a location') : m.body;
  headsUpEl.innerHTML = `<b>${esc(m.by.replace(/\s*\(test\)/, ''))}</b><span>${esc(text)}</span>`;
  headsUpEl.hidden = false; headsUpEl.classList.remove('in'); void headsUpEl.offsetWidth; headsUpEl.classList.add('in');
  clearTimeout(headsUpTimer); headsUpTimer = window.setTimeout(() => { headsUpEl.hidden = true; }, 7000);
}
headsUpEl.addEventListener('click', () => { headsUpEl.hidden = true; setChatOpen(true); });

// ---- Message a spot: long-press the map (or right-click on a computer) → "Message here".
let pressTimer = 0, pressAt: { x: number; y: number } | null = null;
function spotSheet(lngLat: { lng: number; lat: number }) {
  if (!community.group) { toast('Join a ride group to message a spot.'); return; }
  pendingSpot = { lat: lngLat.lat, lon: lngLat.lng };
  const far = state.pos ? ` · ${(distanceM(state.pos, pendingSpot) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, pendingSpot))} of you` : '';
  sheet(`<h3 class="withicon">${inl(ICONS.pin, 26)} Message this spot</h3><p class="quiet">The group sees it in the chat and on the map${far}.</p>
    <div class="quickrow wrap">${['Turn here', 'Meet here', 'Go around', 'Danger here', 'Camp here', 'Gas / water'].map(q => `<button class="qchip" data-spotquick="${q}">${q}</button>`).join('')}</div>
    <form id="spotform" class="chatform"><input name="msg" maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="e.g. Turn left at this fork"><button class="ibtn sendbtn" aria-label="Send">${ICONS.send}</button></form>`);
}
let pendingSpot: { lat: number; lon: number } | null = null;
function sendSpot(text: string) {
  if (!pendingSpot || !text.trim()) return;
  try { chat.send('location', text, pendingSpot); toast('Sent to the group.'); } catch (err) { toast((err as Error).message); }
  pendingSpot = null; closeSheet();
}
map.on('touchstart', e => {
  clearTimeout(pressTimer);
  if ((e.originalEvent as TouchEvent).touches.length !== 1) return;
  pressAt = { x: e.point.x, y: e.point.y };
  const ll = e.lngLat;
  pressTimer = window.setTimeout(() => { navigator.vibrate?.(30); spotSheet(ll); }, 600);
});
map.on('touchmove', e => { if (pressAt && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 10) clearTimeout(pressTimer); });
for (const ev of ['touchend', 'touchcancel', 'dragstart', 'zoomstart', 'rotatestart'] as const) map.on(ev, () => clearTimeout(pressTimer));
map.on('contextmenu', e => spotSheet(e.lngLat));
document.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-spotquick]'); if (b) sendSpot(b.dataset.spotquick!); });
document.addEventListener('submit', e => {
  const f = e.target as HTMLFormElement; if (f.id !== 'spotform') return;
  e.preventDefault(); sendSpot(f.querySelector<HTMLInputElement>('input')!.value);
}, true);
/** Spots hidden on this phone only ("Hide on my map"). */
const hiddenSpots = new Set<string>(store.get<string[]>('hiddenSpots', []));
function spotCard(m: ChatMessage) {
  const mine = m.riderId === community.uid;
  const far = state.pos && m.lat != null ? ` · ${(distanceM(state.pos, { lat: m.lat, lon: m.lon! }) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, { lat: m.lat, lon: m.lon! }))}` : '';
  sheet(`<h3 class="withicon">${inl(ICONS.chat, 24)} ${esc(m.body)}</h3><p class="quiet">${mine ? 'You' : esc(m.by)} · ${ago(m.createdAt ?? m.sentAt)}${far}</p>
    <div class="btns">${mine ? `<button class="danger" data-spotdel="${m.id}">Remove for everyone</button>` : `<button data-spothide="${m.id}">Hide on my map</button>`}<button data-spotchat="${m.id}">Show in chat</button></div>
    <p class="quiet">Spot messages also disappear on their own after 12 hours.</p>`);
}
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  const del = t.closest<HTMLElement>('[data-spotdel]'), hide = t.closest<HTMLElement>('[data-spothide]'), show = t.closest<HTMLElement>('[data-spotchat]');
  if (del) { try { chat.send('spotclear', '', undefined, del.dataset.spotdel); toast('Removed from everyone\'s map.'); } catch (err) { toast((err as Error).message); } closeSheet(); drawSpots(); }
  if (hide) { hiddenSpots.add(hide.dataset.spothide!); store.set('hiddenSpots', [...hiddenSpots].slice(-200)); closeSheet(); drawSpots(); toast('Hidden on your map.'); }
  if (show) { closeSheet(); setChatOpen(true); }
});
/** Spots the group marked (last 12 hours) stay on the map as small labels. */
const spotMarkers = new Map<string, maplibregl.Marker>();
function drawSpots() {
  const g = community.signedIn ? community.group : null;
  const t = g ? chat.thread(g.id) : [];
  const cleared = new Set(t.filter(m => m.kind === 'spotclear').map(m => m.replyTo));
  const spots = t.filter(m => m.kind === 'location' && m.body && m.lat != null && !cleared.has(m.id) && !hiddenSpots.has(m.id) && Date.now() - Date.parse(m.createdAt ?? m.sentAt) < 12 * 3600e3);
  const keep = new Set(spots.map(m => m.id));
  for (const [id, mk] of spotMarkers) if (!keep.has(id)) { mk.remove(); spotMarkers.delete(id); }
  for (const m of spots) {
    if (spotMarkers.has(m.id)) continue;
    const el = document.createElement('button'); el.className = 'spotmark';
    el.innerHTML = `${inl(ICONS.chat, 13)}<span>${esc(m.body.length > 26 ? `${m.body.slice(0, 24)}…` : m.body)}</span><i>${esc((m.riderId === community.uid ? 'You' : m.by).replace(/\s*\(test\)/, ''))}</i>`;
    el.addEventListener('click', ev => { ev.stopPropagation(); spotCard(m); });
    // The note's pointed lower-left corner sits exactly on the spot.
    spotMarkers.set(m.id, new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat([m.lon!, m.lat!]).addTo(map));
  }
}

/** A speech bubble over the sender's dot on the map for a few seconds. */
function riderBubble(m: ChatMessage) {
  const pos = m.kind === 'location' && m.lat != null ? { lat: m.lat, lon: m.lon! } : community.members.find(x => x.riderId === m.riderId)?.pos;
  if (!pos) return;
  const el = document.createElement('div'); el.className = 'rbubble';
  el.innerHTML = `<b>${esc(m.by)}</b> ${m.kind === 'location' ? 'is here' : esc(m.body.length > 60 ? `${m.body.slice(0, 57)}…` : m.body)}`;
  el.addEventListener('click', () => setChatOpen(true));
  const mk = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -20] }).setLngLat([pos.lon, pos.lat]).addTo(map);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => mk.remove(), 600); }, 12000);
}
chat.onChange = () => {
  updateUnread(); renderMapChat(); drawHelp(); drawHeading(); drawSpots();
  if (typingIn('#pane') || typingIn('#sheet')) { afterChat(); return; }
  if (state.tab === 'group' && !state.detail) renderPane();
  if (state.panel === 'riders') refreshPanel();
  afterChat();
};
chat.onIncoming = m => {
  speakMessage(m);
  if (m.kind === 'help') { navigator.vibrate?.([300, 120, 300, 120, 600]); toast(`${m.by} needs help!`); drawHelp(); return; }
  if (m.kind === 'helpclear') { toast(`${m.by} is OK now.`); return; }
  if (m.kind === 'spotclear') { drawSpots(); return; }
  riderBubble(m); freshPill();
  if (rideMode) headsUp(m);
};
const chatMarker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'tapmark' }) });
document.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('[data-openchat]')) { if (state.panel) closeSheet(); setPanel(false); setChatOpen(true); return; }
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-quick],[data-chatloc],[data-chatgo],[data-chatlog]');
  if (!b) return;
  try {
    if (b.dataset.quick === 'Need help') { sendHelp(); setReply(null); }
    else if (b.dataset.quick) { chat.send('quick', b.dataset.quick, undefined, replyTo ?? undefined); setReply(null); }
    if (b.hasAttribute('data-chatloc')) { if (!state.pos) { toast('Waiting for GPS.'); return; } chat.send('location', '', state.pos, replyTo ?? undefined); setReply(null); }
  } catch (err) { toast((err as Error).message); return; }
  if (b.dataset.chatgo) {
    const m = Object.values(community.group ? [chat.thread(community.group.id)] : []).flat().find(x => x.id === b.dataset.chatgo)
      ?? chat.log.flatMap(l => chat.thread(l.id)).find(x => x.id === b.dataset.chatgo);
    if (m?.lat != null) { chatMarker.setLngLat([m.lon!, m.lat]).addTo(map); state.follow = false; $('#btn-center').classList.remove('active'); map.flyTo({ center: [m.lon!, m.lat], zoom: Math.max(map.getZoom(), 15), padding: { top: 0, left: 0, right: 0, bottom: chatOpen ? drawer.offsetHeight : 0 } }); if (state.panel) closeSheet(); }
  }
  if (b.dataset.chatlog) {
    const l = chat.log.find(x => x.id === b.dataset.chatlog); if (!l) return;
    const show = () => sheet(`<h3>${esc(l.name)}</h3><p class="quiet">Ride log · ${new Date(l.joinedAt).toLocaleDateString()}</p>${chatHtml(l.id, true)}`);
    show(); afterChat(); void chat.refresh(l.id).then(() => { if (!$('#sheet').hidden) { show(); afterChat(); } });
  }
});
/** The message box (Group tab or the Riders panel). */
function chatSubmit(form: HTMLFormElement): boolean {
  if (form.id !== 'chatform') return false;
  const input = form.querySelector<HTMLInputElement>('input[name=msg]')!;
  try { chat.send('text', input.value, undefined, replyTo ?? undefined); input.value = ''; setReply(null); input.focus(); } catch (err) { toast((err as Error).message); }
  return true;
}
document.addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.set !== 'pushOn') return;
  (t.checked ? chat.enablePush().then(() => toast('Notifications on for new group messages.')) : chat.disablePush().then(() => toast('Notifications off.')))
    .catch((err: Error) => { t.checked = false; toast(err.message); });
});

// ---------------------------------------------------------------- test riders (admin): try the group features alone
let testRiders = store.get('testRiders', false), testBusy = false;
function testRidersHtml(): string {
  if (!community.isAdmin) return '';
  return `<details class="about"${testRiders ? ' open' : ''}><summary>${inl(ICONS.info, 16)} Test riders (admin)</summary>
    <p class="quiet">Three pretend riders (Kim, Dean and Maria, marked "test") join this group, ride slow loops around you, chat now and then, and answer your messages. Only you can turn them on.</p>
    <div class="btns">${testRiders ? '<button data-act="teststop">Stop test riders</button><button data-act="testnotify">Test notification in 20 s</button><button data-act="testhelp">Test help alert</button>' : `<button data-act="teststart" ${testBusy ? 'disabled' : ''}>Start test riders</button>`}</div>
    ${testRiders ? '<p class="quiet">Test help alert: Maria asks for help, then sends "I\'m OK" by herself after about 90 seconds.</p>' : ''}</details>`;
}
async function demo(action: string, extra: Record<string, unknown> = {}) {
  const c = map.getCenter(), at = state.pos ?? { lat: c.lat, lon: c.lng };
  const { data, error } = await community.client.functions.invoke('demo', { body: { action, lat: at.lat, lon: at.lon, ...extra } });
  if (error) { let msg = error.message; try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep */ } throw new Error(msg); }
  return data as { running?: boolean; inSeconds?: number };
}
async function testAction(act: string) {
  testBusy = true; renderPane();
  try {
    if (act === 'teststart') { await demo('start'); testRiders = true; toast('Test riders joined. Watch the map and the chat.'); }
    if (act === 'teststop') { await demo('stop'); testRiders = false; toast('Test riders left the group.'); }
    if (act === 'testhelp') { await demo('help'); toast('Maria asked for help. Watch the banner, the map and the compass.'); }
    if (act === 'testnotify') { const r = await demo('later', { seconds: 20 }); toast(`Dean will message in ${r.inSeconds ?? 20} s. Close TrailLink now to see the notification.`); }
    store.set('testRiders', testRiders);
    await community.refreshGroup(); await chat.refresh();
  } catch (err) { toast((err as Error).message); }
  finally { testBusy = false; renderPane(); }
}
setInterval(() => {
  if (!testRiders || document.visibilityState !== 'visible' || !community.group || !navigator.onLine) return;
  void demo('tick').then(r => { if (r?.running === false) { testRiders = false; store.set('testRiders', false); } return community.refreshGroup(); }).then(() => chat.refresh()).catch(() => {});
}, 10_000);

// ---------------------------------------------------------------- join by QR code
const joinLink = (code: string) => `${APP_URL}#join=${code}`;
function qrSvg(text: string): string {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
function showGroupQr() {
  const g = community.group!;
  sheet(`<h3>Join ${esc(g.name)}</h3><p class="quiet">Riders scan this in TrailLink (Group › Scan a group's QR code), or with the phone's camera.</p>
    <div class="qrbox">${qrSvg(joinLink(g.code))}</div><p class="bigcode">${esc(g.code)}</p>
    <div class="btns"><button data-act="groupshare">Share link</button></div>`);
}
/** A join code from a scanned QR (our link) or plain text. */
function codeFrom(text: string): string | null {
  const m = text.match(/#join=([A-Za-z0-9]{4,10})/) ?? text.trim().match(/^([A-Za-z0-9]{6})$/);
  return m ? m[1].toUpperCase() : null;
}
let scanStream: MediaStream | null = null;
function stopScan() { scanStream?.getTracks().forEach(t => t.stop()); scanStream = null; }
async function scanQr() {
  if (!community.signedIn) { toast('Sign in first (Trails tab).'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('This browser can\'t use the camera. Type the code instead.'); return; }
  sheet(`<h3>Scan to join</h3><p class="quiet">Point the camera at the QR code on the other rider's phone.</p><div class="scanbox"><video playsinline muted></video><i class="scanframe"></i></div>`);
  const video = document.querySelector<HTMLVideoElement>('#sheet-body video')!;
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { closeSheet(); toast('Camera not allowed. Type the code instead.'); return; }
  video.srcObject = scanStream; await video.play().catch(() => {});
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const tick = () => {
    if (!scanStream || $('#sheet').hidden || !video.isConnected) { stopScan(); return; }
    if (video.videoWidth) {
      const w = Math.min(640, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
      canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      const code = hit && codeFrom(hit.data);
      if (code) { stopScan(); navigator.vibrate?.(60); closeSheet(); joinByCode(code); return; }
    }
    setTimeout(tick, 200);
  };
  tick();
}
function joinByCode(code: string) {
  if (!community.signedIn) { store.set('pendingJoin', code); toast('Sign in, and you\'ll join the group right after.'); return; }
  if (community.group?.code === code) { toast('You\'re already in this group.'); return; }
  state.groupBusy = true; renderPane();
  community.joinGroup(code).then(() => { toast(`You joined ${community.group?.name ?? 'the group'}.`); state.tab = 'group'; setPanel(true); render(); void chat.refresh(); },
    (err: Error) => toast(err.message)).finally(() => { state.groupBusy = false; renderPane(); });
}
// Opened from a join link (QR code scanned with the phone's camera, or a shared text).
{
  const m = location.hash.match(/#join=([A-Za-z0-9]{4,10})/);
  if (m) { store.set('pendingJoin', m[1].toUpperCase()); history.replaceState(null, '', location.pathname); }
}
function maybePendingJoin() {
  const code = store.get<string | null>('pendingJoin', null);
  if (!code || !community.signedIn) return;
  store.set('pendingJoin', null);
  sheet(`<h3>Join this ride group?</h3><p>Group code <b class="code">${esc(code)}</b></p><div class="btns"><button data-close>Not now</button><button class="primary" data-joinnow="${esc(code)}">Join group</button></div>`);
}
document.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-joinnow]'); if (b) { closeSheet(); joinByCode(b.dataset.joinnow!); } });

// ---------------------------------------------------------------- first-ride checklist
function checklistHtml(): string {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
  const me = community.members.find(m => m.riderId === community.uid);
  const items: [boolean, string, string][] = [
    [standalone, 'Opened from the Home Screen icon', standalone ? '' : '<button data-act="installhelp">How</button>'],
    [community.signedIn, 'Signed in', ''],
    [!!state.pos, 'GPS location on', state.pos ? '' : '<span class="quiet">Allow location</span>'],
    [!!community.group && !!me?.sharing, 'In a group, sharing location', ''],
    [chat.pushOn, 'Message notifications on', chat.pushOn || !chat.pushSupported ? '' : '<button data-act="pushon">Turn on</button>'],
    [savedAreas().length > 0, 'Offline map saved for the ride area', savedAreas().length ? '' : '<button data-act="offlinehelp">Save</button>'],
    [community.garage().length > 0, 'Vehicle in the Garage (optional)', ''],
  ];
  const done = items.filter(i => i[0]).length;
  return `<details class="about checklist"${done < items.length ? ' open' : ''}><summary>${inl(ICONS.check, 16)} Ready to ride? ${done}/${items.length}</summary>
    ${items.map(([ok, label, fix]) => `<div class="ckrow${ok ? ' ok' : ''}"><i>${ok ? ICONS.check : ''}</i><span>${label}</span>${ok ? '' : fix}</div>`).join('')}
    <div class="btns"><button data-act="sharesetup">Send setup steps to a rider</button></div></details>`;
}

async function shareSetup() {
  const g = community.group;
  const text = `TrailLink setup for our ride:
1. Open ${APP_URL} in Safari (iPhone) or Chrome (Android).
2. Add it to your Home Screen (Share › Add to Home Screen) and open it from there.
3. Sign in with the 6-digit code that's emailed to you (I approve your email first: tell me which one).
4. Allow location${g ? `, then join our group: ${joinLink(g.code)} (code ${g.code})` : ', then join our group with the code I send'}.
5. In the chat, tap the bell to turn on notifications.
6. Before we lose signal: Base map button › Offline maps › save the ride area.`;
  if (navigator.share) { try { await navigator.share({ title: 'TrailLink setup', text }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; } }
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- Get me out
interface Dest { name: string; at: LL; kind: 'start' | 'pin' | 'rider' }
function getOutDests(): Dest[] {
  const out: Dest[] = [];
  const rec = state.recording?.points[0];
  const last = state.tracks.find(t => t.endedAt && t.points.length > 1 && Date.now() - t.startedAt < 36 * 3600e3);
  if (rec) out.push({ name: 'Where this ride started', at: rec, kind: 'start' });
  else if (last) out.push({ name: `Start of ${last.name}`, at: last.points[0], kind: 'start' });
  for (const p of state.pins) if (p.kind === 'regroup' || p.note) out.push({ name: pinTitle(p), at: p, kind: 'pin' });
  for (const m of community.members) if (m.pos && m.sharing && m.riderId !== community.uid) out.push({ name: m.name.replace(/\s*\(test\)/, ''), at: m.pos, kind: 'rider' });
  const here = state.pos;
  return here ? out.sort((a, b) => (a.kind === 'start' ? -1 : 0) - (b.kind === 'start' ? -1 : 0) || distanceM(here, a.at) - distanceM(here, b.at)) : out;
}
function getOutSheet() {
  if (!state.pos) { toast('Waiting for GPS. Step into open sky.'); return; }
  const here = state.pos, dests = getOutDests();
  sheet(`<h3 class="withicon">${inl(ICONS.exit, 26)} Get me out</h3>
    <p class="quiet">Pick where to go. The route uses the trails saved on your phone and your recorded ride, so it works with no signal.</p>
    ${dests.length ? dests.slice(0, 12).map((d, i) => `<div class="row"><button class="pinmain" data-getout="${i}"><b>${esc(d.name)}</b><span class="quiet">${(distanceM(here, d.at) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(here, d.at))} · ${d.kind === 'start' ? 'trailhead / where you parked' : d.kind === 'rider' ? 'group rider' : 'your pin'}</span></button></div>`).join('')
      : '<p>No destinations yet. Record your ride (Ride tab) so TrailLink knows where you started, or drop a Regroup pin at camp or the trailhead.</p>'}`);
  getOutChoices = dests;
}
let getOutChoices: Dest[] = [];
document.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-getout]'); if (b) { const d = getOutChoices[Number(b.dataset.getout)]; closeSheet(); if (d) void startGetOut(d); } });

let goRoute: Route | null = null, goDest: Dest | null = null, goIdx = 0, goRerouteAt = 0, goBusy = false;
const goFlag = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'goflag', innerHTML: ICONS.flag }), anchor: 'bottom-left' });
const guideEl = Object.assign(document.createElement('div'), { id: 'guide', hidden: true });
$('#mapwrap').append(guideEl);
// The guidance bar lives on the map (outside the panel), so it handles its own Stop button.
guideEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-act="getoutstop"]')) { e.stopPropagation(); stopGetOut(); toast('Route stopped.'); renderPane(); } });
/** Trail lines currently on the phone (saved/loaded map tiles), as [lon, lat] arrays. Closed trails are left out. */
function trailLines(): number[][][] {
  const out: number[][][] = [];
  for (const f of map.querySourceFeatures('trails', { sourceLayer: 'trails' })) {
    if (f.properties?.utv === 'closed') continue;
    const g = f.geometry;
    if (g.type === 'LineString') out.push(g.coordinates as number[][]);
    else if (g.type === 'MultiLineString') out.push(...(g.coordinates as number[][][]));
  }
  return out;
}
async function computeRoute(from: LL, to: LL): Promise<Route> {
  // Make sure the trail tiles between here and there are loaded: show both ends, wait for the map to settle.
  const b = new maplibregl.LngLatBounds([from.lon, from.lat], [from.lon, from.lat]).extend([to.lon, to.lat]);
  map.fitBounds(b, { padding: viewPad(40), maxZoom: 15, duration: 0 });
  if (map.getZoom() < 10) map.setZoom(10);
  await new Promise<void>(r => { const t = setTimeout(r, 5000); map.once('idle', () => { clearTimeout(t); r(); }); });
  const tracks = [state.recording, ...state.tracks].filter(Boolean).map(t => t!.points as LL[]);
  // Full-detail trail tiles (saved ones work offline); if none load, use what's drawn on the map.
  let lines = await loadTrailLines(TRAIL_TILES, from, to);
  if (!lines.length) lines = trailLines();
  const viaTrails = trailRoute(buildGraph(lines), from, to);
  const viaTrack = trackRoute(tracks, from, to);
  const best = [viaTrails, viaTrack].filter((r): r is Route => !!r).sort((x, y) => x.length - y.length)[0];
  return best ?? { coords: [from, to], length: distanceM(from, to), via: 'straight' };
}
function routeGeo(): FeatureCollection {
  if (!goRoute) return { type: 'FeatureCollection', features: [] };
  const c = goRoute.coords.map(p => [p.lon, p.lat]);
  const cut = goRoute.via === 'straight' ? 0 : goRoute.straightFrom ?? c.length;
  const parts: [string, number[][]][] = [];
  if (cut > 1) parts.push(['trail', c.slice(0, cut + 1)]);
  if (cut < c.length - 1) parts.push(['straight', c.slice(Math.max(0, cut))]);
  return { type: 'FeatureCollection', features: parts.map(([via, coordinates]) => ({ type: 'Feature', properties: { via }, geometry: { type: 'LineString', coordinates } })) };
}
function drawRoute() {
  if (!map.getSource('goroute')) {
    map.addSource('goroute', { type: 'geojson', data: routeGeo() });
    map.addLayer({ id: 'goroute-casing', type: 'line', source: 'goroute', paint: { 'line-color': '#fff', 'line-width': 10, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'goroute-line', type: 'line', source: 'goroute', paint: { 'line-color': '#16A34A', 'line-width': 6, 'line-dasharray': ['case', ['==', ['get', 'via'], 'straight'], ['literal', [1, 1.5]], ['literal', [1, 0]]] as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  } else (map.getSource('goroute') as GeoJSONSource).setData(routeGeo());
}
map.on('style.load', () => { if (goRoute) setTimeout(drawRoute, 0); });
async function startGetOut(d: Dest, quiet = false) {
  if (!state.pos || goBusy) return;
  goBusy = true; goDest = d;
  guideEl.hidden = false; guideEl.innerHTML = '<span class="gtext"><b>Finding a route…</b></span>';
  try {
    goRoute = await computeRoute(state.pos, d.at); goIdx = 0; goRerouteAt = Date.now();
    drawRoute(); goFlag.setLngLat([d.at.lon, d.at.lat]).addTo(map);
    const mi = (goRoute.length / 1609.344).toFixed(1);
    if (!quiet) speak(`Route to ${d.name}: ${mi} miles${goRoute.via === 'straight' ? ', straight line. No trail connects, so watch the terrain' : goRoute.via === 'track' ? ', back the way you came' : goRoute.via === 'mixed' ? '. The trails don\'t connect all the way: the last part is a straight line, so look for a road' : ''}.`, true);
    state.follow = true; $('#btn-center').classList.add('active');
    map.easeTo({ center: [state.pos.lon, state.pos.lat], zoom: 15 });
    updateGuide();
  } finally { goBusy = false; }
}
function stopGetOut() {
  goRoute = null; goDest = null; guideEl.hidden = true; goFlag.remove();
  (map.getSource('goroute') as GeoJSONSource | undefined)?.setData(routeGeo());
  drawHeading();
}
function updateGuide() {
  if (!goRoute || !goDest || !state.pos) return;
  const pr = progress(goRoute, state.pos, goIdx); goIdx = pr.index;
  if (distanceM(state.pos, goDest.at) < 40) {
    speak(`You've arrived at ${goDest.name}.`, true); toast(`You've arrived at ${goDest.name}.`); stopGetOut(); return;
  }
  if (pr.off > 75 && Date.now() - goRerouteAt > 20000 && !goBusy) {
    goRerouteAt = Date.now(); speak('Off route. Finding a new route.'); void startGetOut(goDest, true); return;
  }
  const h = myHeading(), b = bearingDeg(state.pos, pr.ahead);
  const turn = h.source === 'map' ? b - map.getBearing() : b - h.deg;
  const mph = Math.max(state.pos.speed ?? 0, 0) > 2 ? (state.pos.speed! * 2.23694) : 10;
  const mins = Math.max(1, Math.round((pr.remaining / 1609.344) / mph * 60));
  guideEl.innerHTML = `<span class="garrow" style="rotate:${turn.toFixed(0)}deg">${ICONS.arrowUp}</span>
    <span class="gtext"><b>${(pr.remaining / 1609.344).toFixed(1)} mi · ~${mins} min</b><span>${esc(goDest.name)} · ${goRoute.via === 'trails' ? 'on trails' : goRoute.via === 'track' ? 'back the way you came' : goRoute.via === 'mixed' ? 'trails, then straight (dashed)' : 'straight line, no trail connects'}${pr.off > 40 ? ' · off route' : ''}</span></span>
    <button class="ibtn" data-act="getoutstop" aria-label="Stop route">${ICONS.x}</button>`;
  drawHeading();
}

async function shareGroupCode() {
  const g = community.group!;
  const text = `Join my TrailLink ride group "${g.name}": ${joinLink(g.code)} (or open TrailLink, tap Group and enter code ${g.code}).`;
  if (navigator.share) { try { await navigator.share({ title: 'TrailLink ride group', text }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; } }
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

/** Start / join forms (in the Group tab or the Riders panel). Returns true if it handled the form. */
function groupSubmit(form: HTMLFormElement): boolean {
  if (form.id !== 'groupstart' && form.id !== 'groupjoin') return false;
  const f = new FormData(form);
  state.groupBusy = true; state.groupError = ''; renderPane();
  const job = form.id === 'groupstart' ? community.createGroup(String(f.get('name') ?? '').trim()) : community.joinGroup(String(f.get('code') ?? ''));
  job.then(() => toast(form.id === 'groupstart' ? 'Group started. Share the code with your riders.' : `Joined ${community.group?.name}.`),
    (err: Error) => { state.groupError = err.message; })
    .finally(() => { state.groupBusy = false; renderPane(); });
  return true;
}

// ---------------------------------------------------------------- trail badges: the badge wall
function riderStats(): RiderStats {
  const rides = state.tracks.filter(t => t.endedAt && t.points.length > 1);
  let miles = 0, climbFt = 0;
  for (const r of rides) { const st = stats(r.points); miles += st.miles; climbFt += st.gainFt; }
  return {
    rides: rides.length, miles, climbFt,
    maxRated: Math.max(0, ...community.myRatings().values()),
    trailsAdded: community.trails().filter(t => community.isMine(t)).length,
    reports: state.pins.filter(p => p.kind === 'report' || p.kind === 'hazard').length,
    clears: Object.values(community.myVotes).filter(v => v === 'cleared').length,
    groupRides: store.get('groupRides', 0),
    inColorado: rodeIn(rides, 'CO'), inUtah: rodeIn(rides, 'UT'),
    badgeTrails: Object.keys(community.awards).filter(k => k.startsWith('trail:')).length,
  };
}
/** Award anything newly earned: badge trails covered by these rides, and milestones. Shows a celebration. */
function checkBadges(rides: Track[] = [], quietIfNone = false): number {
  const fresh: { key: string; name: string; icon: BadgeIcon; color: string }[] = [];
  for (const ride of rides) for (const { trail, coverage: c } of earnedOnRide(community.badgeTrails, ride)) {
    if (community.award(`trail:${trail.id}`, { coverage: Math.round(c * 100) / 100, ride: ride.name })) fresh.push({ key: `trail:${trail.id}`, name: trail.name, icon: trail.icon, color: trail.color });
  }
  const st = riderStats();
  for (const m of MILESTONES) if (m.value(st) >= m.goal && community.award(`m:${m.key}`)) fresh.push({ key: `m:${m.key}`, name: m.name, icon: m.icon, color: m.color });
  if (fresh.length) {
    sheet(`<div class="earned"><h3>Badge${fresh.length > 1 ? 's' : ''} earned!</h3>
      <div class="earnedrow">${fresh.slice(0, 6).map(f => `<div>${badgeSvg(f.icon, f.color, 110, false, f.name)}<b>${esc(f.name)}</b></div>`).join('')}</div>
      ${fresh.length > 6 ? `<p class="quiet">…and ${fresh.length - 6} more.</p>` : ''}
      <div class="btns"><button data-close>Nice!</button><button class="primary" data-act2="seebadges">See my badges</button></div></div>`);
    if (state.tab === 'badges') renderPane();
  } else if (quietIfNone) return 0;
  return fresh.length;
}
function badgeTile(key: string, name: string, icon: BadgeIcon, color: string, sub: string, progress?: number) {
  const got = community.hasBadge(key);
  return `<button class="badge${got ? ' got' : ''}" data-badge="${esc(key)}" aria-label="${esc(name)}${got ? ', earned' : ', not earned yet'}">
    ${badgeSvg(icon, color, 76, !got)}<b>${esc(name)}</b><span>${sub}</span>
    ${!got && progress != null ? `<i class="prog"><i style="width:${Math.min(100, Math.round(progress * 100))}%"></i></i>` : ''}</button>`;
}
function badgesHtml(): string {
  const st = riderStats(), trails = community.badgeTrails;
  const earned = Object.keys(community.awards).length, total = trails.length + MILESTONES.length;
  const fmt = (n: number) => Math.floor(n).toLocaleString();
  const trailTiles = trails.map(t => {
    const a = community.awards[`trail:${t.id}`];
    return badgeTile(`trail:${t.id}`, t.name, t.icon, t.color, a ? `Earned ${new Date(a.at).toLocaleDateString()}` : t.difficulty ? `${levelOf(t.difficulty).band} · ${t.difficulty}` : 'Badge trail');
  }).join('');
  const msTiles = MILESTONES.map(m => {
    const v = m.value(st), a = community.awards[`m:${m.key}`];
    const sub = a ? `Earned ${new Date(a.at).toLocaleDateString()}` : m.goal > 1 && m.unit ? `${fmt(v)} / ${fmt(m.goal)} ${m.unit}` : m.how;
    return badgeTile(`m:${m.key}`, m.name, m.icon, m.color, sub, m.goal > 1 && m.unit ? v / m.goal : undefined);
  }).join('');
  return `<h2>Badge wall</h2>
    <p class="quiet"><b>${earned} of ${total}</b> badges earned</p><details class="about"><summary>${inl(ICONS.info, 16)} How to earn badge trails</summary><p class="quiet">Ride a badge trail with recording on: cover most of it and the badge is yours. Works with no signal.</p></details>
    <h2>Badge trails</h2>
    ${trails.length ? `<div class="badgegrid">${trailTiles}</div>` : `<p class="quiet">${community.signedIn ? 'No badge trails yet.' : 'Sign in (Trails tab) to see the badge trails.'}</p>`}
    ${community.isAdmin ? '<p class="quiet">Admin: to add a badge trail, tap a trail on the map, then <b>Make this a badge trail</b>.</p>' : ''}
    <h2>Milestones</h2>
    <div class="badgegrid">${msTiles}</div>
    <div class="btns"><button data-act="checkrides">Check my recorded rides</button></div>
    <p class="quiet">Printable badges for your rig are coming later.</p>`;
}
function badgeSheet(key: string) {
  const a = community.awards[key];
  const earned = a ? `<p class="quiet">Earned ${new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}${a.detail?.ride ? ` on ${esc(String(a.detail.ride))}` : ''}${a.detail?.coverage ? ` · rode ${Math.round(Number(a.detail.coverage) * 100)}% of it` : ''}</p>` : '';
  if (key.startsWith('trail:')) {
    const t = community.badgeTrails.find(x => `trail:${x.id}` === key); if (!t) return;
    // Best effort on rides already recorded, so riders know how close they got.
    const best = Math.max(0, ...state.tracks.filter(r => r.points.length > 1).map(r => coverage(t, r.points)));
    sheet(`<div class="earned">${badgeSvg(t.icon, t.color, 140, !a, t.name)}<h3>${esc(t.name)}</h3>
      ${t.difficulty ? `<p><span class="dchip" style="--c:${levelOf(t.difficulty).color}">${t.difficulty} · ${levelOf(t.difficulty).band}</span></p>` : ''}
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      ${earned || `<p class="quiet">Not earned yet. Record a ride that covers at least ${t.minCoverage}% of the trail.${best > 0.02 ? ` Your best so far: ${Math.round(best * 100)}%.` : ''}</p>`}
      <div class="btns"><button data-act2="badgemap" data-id="${t.id}">Show on map</button>${community.isAdmin ? `<button data-act2="badgeedit" data-id="${t.id}">Edit</button><button class="danger" data-act2="badgeremove" data-id="${t.id}">Remove</button>` : ''}<button class="primary" data-close>Done</button></div></div>`);
    return;
  }
  const m = MILESTONES.find(x => `m:${x.key}` === key); if (!m) return;
  const v = m.value(riderStats());
  sheet(`<div class="earned">${badgeSvg(m.icon, m.color, 140, !a, m.name)}<h3>${esc(m.name)}</h3><p>${esc(m.how)}.</p>
    ${earned || (m.goal > 1 && m.unit ? `<p class="quiet">So far: ${Math.floor(v).toLocaleString()} of ${m.goal.toLocaleString()} ${m.unit}.</p>` : '<p class="quiet">Not earned yet.</p>')}
    <div class="btns"><button class="primary" data-close>Done</button></div></div>`);
}
/** In trail details: is this part of a badge trail? */
function badgeRowHtml(tid?: string): string {
  if (!tid) return '';
  const t = community.badgeTrails.find(b => b.tids.includes(tid));
  if (t) {
    const got = community.hasBadge(`trail:${t.id}`);
    return `<button class="badgerow" data-badgeinfo="trail:${t.id}">${badgeSvg(t.icon, t.color, 34, !got)}<span><b>Badge trail: ${esc(t.name)}</b><br><span class="quiet">${got ? 'You earned this badge' : 'Ride it with recording on to earn the badge'}</span></span></button>`;
  }
  return community.isAdmin ? `<button class="small" data-makebadge="${esc(tid)}">${inl(ICONS.medal)} Make this a badge trail</button>` : '';
}
/** Admin: turn the tapped trail into a badge trail (its shape comes from the map data on screen). */
let badgeDraft: { id?: string; tids: string[]; geom: BadgeTrail['geom'] } | null = null;
function trailShape(tid: string): BadgeTrail['geom'] | null {
  if (tid.startsWith('RIDER:')) { const t = community.trails().find(x => `RIDER:${x.id}` === tid); return t ? { type: 'MultiLineString', coordinates: [t.coords] } : null; }
  const lines: [number, number][][] = [];
  for (const f of map.querySourceFeatures('trails', { sourceLayer: 'trails', filter: ['==', ['get', 'tid'], tid] })) {
    const g = f.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates as [number, number][]);
    else if (g.type === 'MultiLineString') lines.push(...(g.coordinates as [number, number][][]));
  }
  return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
}
function badgeTrailForm(tid: string, existing?: BadgeTrail) {
  const geom = existing ? existing.geom : trailShape(tid);
  if (!geom) { toast('Zoom in on the trail so the whole route is on screen, then try again.'); return; }
  badgeDraft = { id: existing?.id, tids: existing?.tids ?? [tid], geom };
  const name = existing?.name ?? popupProps?.name ?? community.trails().find(x => `RIDER:${x.id}` === tid)?.name ?? '';
  const diff = existing?.difficulty ?? Math.round(community.scores().get(tid)?.avg ?? 0);
  const color = existing?.color ?? BADGE_TRAIL_COLORS[0], icon = existing?.icon ?? 'peak';
  sheet(`<h3>${existing ? 'Edit badge trail' : 'New badge trail'}</h3>
    <form id="badgeform" class="form">
      <label>Badge name<input name="name" required maxlength="60" value="${esc(name)}" placeholder="e.g. Black Bear Pass"></label>
      <label>Short description<textarea name="description" rows="2" maxlength="300" placeholder="What makes this trail worth a badge">${esc(existing?.description ?? '')}</textarea></label>
      <label>Difficulty<select name="difficulty"><option value="">Not set</option>${LEVELS.map(l => `<option value="${l.n}" ${l.n === diff ? 'selected' : ''}>${l.n} · ${l.band}</option>`).join('')}</select></label>
      <fieldset class="colors"><legend>Badge color</legend>${BADGE_TRAIL_COLORS.map(c => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span></span></label>`).join('')}</fieldset>
      <fieldset class="colors"><legend>Badge icon</legend>${BADGE_ICONS.map(i => `<label class="iconpick"><input type="radio" name="icon" value="${i}" ${i === icon ? 'checked' : ''}>${badgeSvg(i, '#4F564C', 44)}</label>`).join('')}</fieldset>
      <label>Must ride at least<select name="min">${[60, 70, 75, 80, 90].map(n => `<option value="${n}" ${n === (existing?.minCoverage ?? 75) ? 'selected' : ''}>${n}% of the trail</option>`).join('')}</select></label>
      <p class="quiet">${geom.coordinates.length} map piece${geom.coordinates.length === 1 ? '' : 's'} · about ${(geom.coordinates.reduce((m, l) => m + lengthMiles(l), 0)).toFixed(1)} mi. If the trail continues off screen, zoom out so all of it is visible and open this again.</p>
      <div class="btns"><button type="button" data-close>Cancel</button><button class="primary">${existing ? 'Save' : 'Create badge'}</button></div>
    </form>`);
}

// ---------------------------------------------------------------- admin: approve and manage riders
const APP_URL = `${location.origin}${location.pathname}`;
const inviteText = (email: string) =>
  `You're invited to TrailLink, our group's off-road trail map. Open ${APP_URL} on your phone, enter ${email} and tap "Email me a sign-in link". Then add it to your home screen.`;
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function loadRiders() {
  const a = state.admin; a.busy = true; a.error = '';
  community.adminRiders().then(r => { a.riders = r; }, (e: Error) => { a.error = e.message; })
    .finally(() => { a.busy = false; if (state.tab === 'group' && !state.detail) renderPane(); });
}

function adminHtml(): string {
  const a = state.admin;
  if (!a.riders && !a.busy && !a.error) loadRiders();
  const joined = (a.riders ?? []).filter(r => r.joined_at), pending = (a.riders ?? []).filter(r => !r.joined_at);
  const row = (r: AdminRider) => {
    const tags = [r.is_admin ? 'Admin' : r.is_reviewer ? 'Reviewer' : ''].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const info = r.joined_at
      ? `Joined ${shortDate(r.joined_at)}${r.last_seen ? ` · last signed in ${shortDate(r.last_seen)}` : ''} · ${r.ratings} rating${r.ratings === 1 ? '' : 's'} · ${r.trails} trail${r.trails === 1 ? '' : 's'}`
      : `Approved ${shortDate(r.invited_at)} · hasn't signed in yet`;
    const me = r.rider_id === community.session?.user.id;
    const btns = !r.joined_at ? `<button data-invitesend="${esc(r.email)}">Send invite</button>`
      : me || r.is_admin ? ''
      : `<button data-role="${r.rider_id}" data-reviewer="${!r.is_reviewer}">${r.is_reviewer ? 'Remove reviewer' : 'Make reviewer'}</button>`;
    return `<div class="row"><div class="grow"><b>${esc(r.display_name ?? r.email)}</b> ${tags}
      <div class="quiet">${r.display_name ? `${esc(r.email)} · ` : ''}${info}</div></div>
      ${btns}${me ? '' : `<button data-removerider="${esc(r.email)}" aria-label="Remove ${esc(r.display_name ?? r.email)}" class="ibtn">${ICONS.x}</button>`}</div>`;
  };
  return `<h2>Riders <span class="tag">Admin</span></h2>
    <p class="quiet">Only people you approve here can sign in to TrailLink.</p>
    <form id="inviteform" class="form">
      <label>Approve a rider's email<input name="email" type="email" autocomplete="off" required placeholder="rider@example.com"></label>
      <div class="btns"><button class="primary" ${a.busy ? 'disabled' : ''}>Approve</button></div>
    </form>
    ${a.invited ? `<div class="card"><b>${esc(a.invited)} is approved.</b><p class="quiet">Send them the app link so they can sign in.</p>
      <div class="btns"><button class="primary" data-invitesend="${esc(a.invited)}">Send invite</button><button data-invitecopy="${esc(a.invited)}">Copy message</button></div></div>` : ''}
    ${a.error ? `<p class="quiet" style="color:var(--red)">${esc(a.error)}</p>` : ''}
    ${a.riders ? `<p class="quiet" style="margin-bottom:4px"><b>Signed up (${joined.length})</b></p>${joined.map(row).join('') || '<p class="quiet">Nobody yet.</p>'}
      ${pending.length ? `<p class="quiet" style="margin:12px 0 4px"><b>Approved, waiting to sign in (${pending.length})</b></p>${pending.map(row).join('')}` : ''}`
      : a.busy ? '<p class="quiet">Loading riders…</p>' : ''}
    <div class="btns"><button data-act="admin-refresh">Refresh list</button></div>
    <p class="quiet">Reviewers can verify or hide rider-created trails.</p>`;
}

async function sendInvite(email: string) {
  const text = inviteText(email);
  if (navigator.share) { try { await navigator.share({ title: 'TrailLink invite', text }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; } }
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- rider-created trails
function riderTrailsGeo(): FeatureCollection {
  return { type: 'FeatureCollection', features: community.trails().map(t => ({ type: 'Feature', properties: { tid: `RIDER:${t.id}`, src: 'RIDER', name: t.name, difficulty: t.difficulty }, geometry: { type: 'LineString', coordinates: t.coords } })) };
}
function refreshRiderTrails() { (map.getSource('rider-trails') as GeoJSONSource | undefined)?.setData(riderTrailsGeo()); applyRatingStates(); }
function riderTrailHtml(t: RiderTrail) {
  const l = levelOf(t.difficulty);
  const when = new Date(t.createdAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `<div class="tp-title">${esc(t.name)}</div>
    <div class="tp-status" style="--c:${l.color}">${l.band} · ${t.difficulty} of 10 (creator's rating)</div>
    <dl><dt>Vehicles</dt><dd>${esc(VEHICLE_FIT[t.vehicles])}</dd><dt>Length</dt><dd>${lengthMiles(t.coords).toFixed(1)} mi</dd>
      <dt>Created by</dt><dd>${esc(t.createdBy)}</dd><dt>When</dt><dd>${esc(when)}</dd>${t.notes ? `<dt>Notes</dt><dd>${esc(t.notes)}</dd>` : ''}</dl>
    ${ratingHtml(`RIDER:${t.id}`, ratingInfo(`RIDER:${t.id}`))}
    ${t.verified ? '<div class="tp-status" style="--c:#15803D">Verified by riders</div>' : ''}
    ${!community.isMine(t) && !t.verified ? (community.hasConfirmed(t.id) ? '<p class="quiet">You confirmed this trail. Thanks!</p>' : community.signedIn ? `<button data-confirm="${t.id}">I rode this, it's real</button>` : '<p class="quiet">Sign in (Trails tab) to confirm this trail.</p>') : ''}
    <div class="tp-src">${t.verified ? 'Rider-created trail, confirmed by other riders.' : `Rider-created trail, not yet verified${t.confirmations ? ` (${t.confirmations} of 3 confirmations)` : ''}.`} Check that it's legal to ride before you go.</div>`;
}
function drawGeo(): FeatureCollection {
  const c = state.draw?.coords ?? [];
  return { type: 'FeatureCollection', features: [
    ...(c.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: c } }] : []),
    ...c.map(p => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })),
  ] };
}
function refreshDraw() {
  (map.getSource('draw') as GeoJSONSource | undefined)?.setData(drawGeo());
  const bar = document.getElementById('drawbar');
  if (!state.draw) { bar?.remove(); return; }
  const html = `<b>Tap the map along the trail</b><span>${state.draw.coords.length} points · ${lengthMiles(state.draw.coords).toFixed(2)} mi</span>
    <div class="btns"><button data-draw="undo" ${state.draw.coords.length ? '' : 'disabled'}>Undo</button><button data-draw="cancel">Cancel</button><button class="primary" data-draw="done" ${state.draw.coords.length > 1 ? '' : 'disabled'}>Done</button></div>`;
  if (bar) bar.innerHTML = html;
  else { const d = document.createElement('div'); d.id = 'drawbar'; d.innerHTML = html; $('#mapwrap').appendChild(d); }
}
function addDrawPoint(p: [number, number]) { state.draw?.coords.push(p); refreshDraw(); }
function startDrawing() { popup.remove(); state.follow = false; state.draw = { coords: [] }; refreshDraw(); toast('Tap along the trail to draw it. Zoom in for accuracy.'); }
$('#mapwrap').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('#drawbar button');
  const draw = state.draw;
  if (!b || !draw) return;
  if (b.dataset.draw === 'undo') { draw.coords.pop(); refreshDraw(); }
  else if (b.dataset.draw === 'cancel') { state.draw = null; refreshDraw(); }
  else if (b.dataset.draw === 'done') { state.draw = null; refreshDraw(); newTrailForm(draw.coords); }
});

/** The new-trail form: name, difficulty, vehicles, notes. Created by and date/time are filled in automatically. */
function newTrailForm(coords: [number, number][]) {
  const me = community.me();
  const now = new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  sheet(`<h3>New trail</h3>
    <form id="trailform" class="form">
      <label>Trail name<input name="name" required maxlength="60" placeholder="e.g. Cougar Ridge connector"></label>
      <label>Difficulty
        <select name="difficulty">${LEVELS.map(l => `<option value="${l.n}" ${l.n === 3 ? 'selected' : ''}>${l.n} · ${l.band}: ${esc(l.text)}</option>`).join('')}</select></label>
      <label>Vehicles that fit<select name="vehicles">${(Object.keys(VEHICLE_FIT) as VehicleFit[]).map(k => `<option value="${k}">${VEHICLE_FIT[k]}</option>`).join('')}</select></label>
      <label>Notes<textarea name="notes" rows="3" maxlength="500" placeholder="Conditions, obstacles, gates, best direction…"></textarea></label>
      <label>Created by<input name="by" required maxlength="40" value="${esc(me?.name ?? '')}" placeholder="Your name or trail name"></label>
      <p class="quiet">${lengthMiles(coords).toFixed(1)} miles · ${coords.length} points · ${esc(now)}</p>
      <div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save trail</button></div>
    </form>`);
  pendingCoords = coords;
}
let pendingCoords: [number, number][] | null = null;

fetch(TRAIL_TILES.replace('{z}/{x}/{y}.pbf', 'meta.json')).then(r => (r.ok ? r.json() : null)).then(m => { state.trailMeta = m; refreshPanel(); }).catch(() => {});
map.on('dragstart', () => { state.follow = false; $('#btn-center').classList.remove('active'); });
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { c: [c.lng, c.lat], z: map.getZoom() }); });

function setBase(id: BaseMapId) {
  state.base = id; store.set('base', id);
  map.setStyle(styleFor(id));
  render();
}

function trackGeo(): FeatureCollection {
  const t = state.recording;
  return { type: 'FeatureCollection', features: t && t.points.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.points.map(p => [p.lon, p.lat]) } }] : [] };
}
function refreshTrack() { (map.getSource('track') as GeoJSONSource | undefined)?.setData(trackGeo()); }

// ---------------------------------------------------------------- heading arrows and the compass bar
/** A blue pointer drawn just outside a rider's dot, pointing up (the map rotates it to their heading). */
function riderArrowImage(): ImageData {
  const S = 112, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, mid = S / 2;
  g.beginPath(); g.moveTo(mid, 2); g.lineTo(mid + 15, 22); g.lineTo(mid, 17); g.lineTo(mid - 15, 22); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#2563EB'; g.fill();
  return g.getImageData(0, 0, S, S);
}
const phoneCompass = new PhoneCompass();
let headingUp = store.get('headingUp', false); // remembered between launches
/** Which way I'm heading: GPS course when moving (best on a moving vehicle), else the phone's compass, else the map. */
function myHeading(): { deg: number; source: HeadingSource } {
  const p = state.pos;
  if (p && p.heading != null && Number.isFinite(p.heading) && (p.speed ?? 0) > 1.5) return { deg: p.heading, source: 'gps' };
  if (phoneCompass.live) return { deg: phoneCompass.heading!, source: 'compass' };
  return { deg: map.getBearing(), source: 'map' };
}
const compassEl = document.createElement('div');
compassEl.id = 'compass';
compassEl.setAttribute('role', 'button');
compassEl.setAttribute('aria-label', 'Compass. Tap to turn the map with your heading.');
$('#mapwrap').append(compassEl);
let compassFrame = 0;
function drawHeading() {
  if (compassFrame) return;
  compassFrame = requestAnimationFrame(() => {
    compassFrame = 0;
    const h = myHeading();
    // My arrow: shown whenever the heading is real (GPS course or phone compass).
    const arrow = meEl.querySelector<HTMLElement>('.arrow')!;
    arrow.hidden = h.source === 'map';
    arrow.style.rotate = `${h.deg - map.getBearing()}deg`;
    arrow.classList.toggle('compass', h.source === 'compass');
    if (headingUp && h.source !== 'map' && Math.abs(((h.deg - map.getBearing() + 540) % 360) - 180) > 3) map.rotateTo(h.deg, { duration: 300 });
    // The compass bar.
    compassEl.hidden = !state.compass;
    if (!state.compass) return;
    const marks: CompassMark[] = [];
    const me = state.pos;
    if (me) {
      const asking = new Set(chat.activeHelps(community.group?.id).map(h => h.riderId));
      for (const m of community.members) if (m.pos && m.sharing && m.riderId !== community.uid && !asking.has(m.riderId)) marks.push({ bearing: bearingDeg(me, m.pos), meters: distanceM(me, m.pos), label: esc(initials(m.name)), kind: 'rider', title: `${esc(m.name)} · ${(distanceM(me, m.pos) / 1609.344).toFixed(1)} mi` });
      if (goDest) marks.push({ bearing: bearingDeg(me, goDest.at), meters: distanceM(me, goDest.at), label: '', kind: 'dest', title: goDest.name });
      for (const p of state.pins) if (p.kind === 'regroup') marks.push({ bearing: bearingDeg(me, p), meters: distanceM(me, p), label: '', kind: 'regroup', title: 'Regroup point' });
      for (const h of chat.activeHelps(community.group?.id)) { const at = h.riderId === community.uid ? null : helpSpot(h); if (at) marks.push({ bearing: bearingDeg(me, at), meters: distanceM(me, at), label: `SOS ${esc(initials(h.by))}`, kind: 'hazard', title: `${esc(h.by)} needs help` }); }
    }
    compassEl.innerHTML = compassHtml(h.deg, h.source, marks, compassEl.clientWidth || 260, headingUp)
      + (h.source === 'map' && phoneCompass.needsPermission ? '<span class="chint">Tap for compass</span>' : '');
  });
}
phoneCompass.onChange = drawHeading;
map.on('rotate', drawHeading);
map.on('rotatestart', e => { if ((e as { originalEvent?: Event }).originalEvent && headingUp) { headingUp = false; store.set('headingUp', false); drawHeading(); } });
// iPhone only lets a web app read the compass after a tap, every time it opens. If you allowed it before, the first tap
// anywhere in the app turns it back on (no need to find the compass bar).
document.addEventListener('pointerdown', () => {
  if (store.get('compassAllowed', false) && !phoneCompass.started) void phoneCompass.start().then(ok => { if (ok) drawHeading(); });
}, { capture: true });
compassEl.addEventListener('click', async () => {
  if (phoneCompass.needsPermission || !phoneCompass.started) {
    const ok = await phoneCompass.start();
    if (ok) store.set('compassAllowed', true);
    if (!ok) toast('Compass not allowed. The bar follows your GPS direction while you move.');
    else if (!headingUp) { toast('Compass on. Tap the bar again to turn the map with your heading.'); drawHeading(); return; }
  }
  headingUp = !headingUp; store.set('headingUp', headingUp);
  if (!headingUp) map.rotateTo(0, { duration: 400 });
  toast(headingUp ? 'Map turns with your heading. Tap the bar again for north up.' : 'North up.');
  drawHeading();
});
// Android and desktop don't need a tap to read the compass.
if (!phoneCompass.needsPermission) void phoneCompass.start();
setInterval(drawHeading, 5000); // riders' bearings change as everyone moves

// ---------------------------------------------------------------- my position
const meEl = document.createElement('div');
meEl.className = 'me';
meEl.innerHTML = '<div class="arrow" hidden></div>';
meEl.setAttribute('aria-label', 'Your position');
const meMarker = new maplibregl.Marker({ element: meEl });

function onPosition(p: GeolocationPosition) {
  const c = p.coords;
  state.pos = { lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy), alt: c.altitude ?? undefined, speed: c.speed ?? undefined, heading: c.heading ?? undefined, t: p.timestamp };
  meMarker.setLngLat([c.longitude, c.latitude]);
  if (!meMarker.getElement().isConnected) meMarker.addTo(map);
  drawHeading(); updateRideMode(); updateGuide(); drawGroupLine();
  if (state.follow) map.easeTo({ center: [c.longitude, c.latitude], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  if (state.recording) {
    const pt: Pt = { lat: c.latitude, lon: c.longitude, t: p.timestamp, alt: c.altitude ?? undefined };
    const last = state.recording.points[state.recording.points.length - 1];
    if (c.accuracy <= 50 && shouldKeep(last, pt)) { state.recording.points.push(pt); persistTracks(); refreshTrack(); }
  }
  renderChips();
  if (state.tab === 'ride' && !state.scrubbing) renderPane();
  maybeSharePosition();
}

function startGps() {
  if (!('geolocation' in navigator)) { toast('This browser has no GPS access.'); return; }
  navigator.geolocation.watchPosition(onPosition, err => {
    if (err.code === err.PERMISSION_DENIED) sheet(`<h3>Location is off</h3><p>TrailLink needs your location to show you on the map.</p><p class="quiet">iPhone: Settings › Privacy &amp; Security › Location Services › Safari Websites (or TrailLink) › While Using. Android: tap the lock icon by the address, then Permissions › Location.</p><div class="btns"><button class="primary" data-close>OK</button></div>`);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

// Keep the screen on during a ride: on a phone browser, sharing and recording stop when the screen sleeps.
async function applyWakeLock() {
  try {
    if (state.keepAwake && document.visibilityState === 'visible' && 'wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; renderChips(); });
    } else if (!state.keepAwake && state.wakeLock) { await state.wakeLock.release(); state.wakeLock = null; }
  } catch { /* not supported or refused */ }
  renderChips();
}
document.addEventListener('visibilitychange', () => { void applyWakeLock(); });

// ---------------------------------------------------------------- pins
const pinMarkers = new Map<string, maplibregl.Marker>();
function drawPins() {
  for (const [id, m] of pinMarkers) if (!state.pins.find(p => p.id === id)) { m.remove(); pinMarkers.delete(id); }
  for (const p of state.pins) {
    if (sharedOf(p)?.status === 'cleared') { pinMarkers.get(p.id)?.remove(); pinMarkers.delete(p.id); continue; }
    // Icon only on the map (names overlap); tap for details.
    const key = `${p.kind}:${p.report ?? ''}:${p.photos?.length ? 1 : 0}`;
    const old = pinMarkers.get(p.id);
    if (old) { old.setLngLat([p.lon, p.lat]); if (old.getElement().dataset.key === key) continue; old.remove(); }
    const el = document.createElement('button');
    const strobe = false; // the strobe now marks a rider who asked for help
    el.className = `mpin ${p.kind}${strobe ? ' strobe' : ''}`;
    el.dataset.key = key;
    el.setAttribute('aria-label', pinTitle(p));
    el.innerHTML = `${strobe ? '<i class="flash" aria-hidden="true"></i>' : ''}${pinIcon(p.kind, p.report, 34)}${p.photos?.length ? `<i class="hasphoto" aria-hidden="true">${ICONS.camera}</i>` : ''}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); pinSheet(p.id); });
    pinMarkers.set(p.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}
const PIN_NAMES = { regroup: 'Regroup point', hazard: 'Hazard', note: 'Note', photo: 'Photo', report: 'Report' } as const;
/** Pin name; with icon=true, report pins start with their icon (for the map). */
function pinTitle(p: Pin) {
  const r = p.kind === 'report' && p.report ? REPORTS[p.report as ReportType] : null;
  return p.note || (r ? r.label : PIN_NAMES[p.kind]);
}
/** Drop a pin where you are, or at a spot picked on the map. */
function addPin(kind: Pin['kind'], note?: string, photos?: string[], at?: { lat: number; lon: number }, report?: ReportType) {
  const where = at ?? state.pos;
  if (!where) { toast('Waiting for a GPS fix. Or use "Place on map".'); return null; }
  const pin: Pin = { id: String(Date.now()), kind, lat: where.lat, lon: where.lon, t: Date.now(), note: note?.trim() || undefined, photos, report };
  state.pins.unshift(pin);
  // Hazard reports are shared with all riders. Other pins go to the ride group only if the rider turned that on.
  if (kind === 'report' || kind === 'hazard') shareOwnPin(pin, 'all');
  else if (store.get('shareNewPins', false) && community.group) shareOwnPin(pin, 'group');
  store.savePins(state.pins); drawPins(); renderPane();
  toast(`${pinTitle(pin)} pinned${at ? '' : ' here'}${pin.share === 'all' ? ' and shared with riders' : pin.share === 'group' ? ' and shared with your group' : ''}`);
  return pin;
}

// ---------------------------------------------------------------- sharing pins (hazards: all riders; others: the group, if chosen)
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`.padEnd(36, '0'));
function shareOwnPin(pin: Pin, to: 'all' | 'group') {
  if (to === 'group' && !community.group) { toast('Join a ride group to share pins with it.'); return; }
  pin.sid ??= newId(); pin.share = to; pin.groupId = to === 'group' ? community.group!.id : undefined;
  pushPin(pin);
}
/** Upload the pin's current spot and note (after sharing, moving or editing). Queued until there's signal. */
function pushPin(pin: Pin) {
  if (!pin.sid || !pin.share) return;
  community.sharePin({ id: pin.sid, audience: pin.share, groupId: pin.groupId ?? null, kind: pin.kind, report: pin.report, note: pin.note, lat: pin.lat, lon: pin.lon, createdAt: new Date(pin.t).toISOString() });
}
function unshareOwnPin(pin: Pin) { if (pin.sid) community.unsharePin(pin.sid); pin.sid = undefined; pin.share = undefined; pin.groupId = undefined; }
/** The shared copy of one of my pins (to show "cleared by ..." etc.). */
const sharedOf = (pin: Pin) => (pin.sid ? community.sharedPins.find(x => x.id === pin.sid) : undefined);
const myId = () => community.session?.user.id;
/** Others' pins I can see: hazard reports from all riders and pins shared with my group. */
const othersPins = () => community.sharedPins.filter(p => p.riderId !== myId());
const REPORT_KINDS = new Set(['report', 'hazard']);
function sharedTitle(p: SharedPin) {
  const r = p.report ? REPORTS[p.report as ReportType] : null;
  return p.note || (r ? r.label : PIN_NAMES[p.kind as Pin['kind']] ?? 'Pin');
}
function hazardStatus(p: SharedPin): string {
  if (p.status === 'cleared') return `Cleared by ${esc(community.nameOf(p.clearedBy))} ${p.clearedAt ? ago(p.clearedAt) : ''}`;
  const reported = `Reported by ${esc(p.riderId === myId() ? 'you' : p.by)} ${ago(p.createdAt)}`;
  return p.confirmations ? `${reported} · still there ${ago(p.lastConfirmed)} (${p.confirmations} rider${p.confirmations === 1 ? '' : 's'})` : reported;
}
function voteButtons(p: SharedPin) {
  const v = community.myVotes[p.id];
  return `<div class="btns"><button data-act2="pinvote" data-id="${p.id}" data-v="there" aria-pressed="${v === 'there'}" class="${v === 'there' ? 'on' : ''}">${inl(ICONS.thumb)} Still there</button>
    <button data-act2="pinvote" data-id="${p.id}" data-v="cleared" aria-pressed="${v === 'cleared'}" class="${v === 'cleared' ? 'on' : ''}">${inl(ICONS.check)} Cleared</button></div>`;
}
/** Someone else's pin: who shared it, when, and (for hazards) still there / cleared. */
function remotePinSheet(id: string) {
  const p = community.sharedPins.find(x => x.id === id); if (!p) return;
  const hazard = REPORT_KINDS.has(p.kind);
  sheet(`<h3 class="withicon">${pinIcon(p.kind, p.report, 36)}${esc(sharedTitle(p))}</h3>
    <p class="quiet">${hazard ? hazardStatus(p) : `Shared with your group by ${esc(p.by)} ${ago(p.createdAt)}`}${state.pos ? ` · ${(distanceM(state.pos, p) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(state.pos, p))}` : ''}</p>
    ${hazard ? `<p class="quiet">Rode past it? Let other riders know.</p>${voteButtons(p)}` : ''}
    <div class="btns"><button data-act2="gotoshared" data-id="${p.id}">Show on map</button>${community.isReviewer ? `<button class="danger" data-act2="removeshared" data-id="${p.id}">Remove for everyone</button>` : ''}<button class="primary" data-close>Done</button></div>`);
}
const remoteMarkers = new Map<string, maplibregl.Marker>();
function drawRemotePins() {
  const show = othersPins().filter(p => p.status === 'active');
  for (const [id, m] of remoteMarkers) if (!show.some(p => p.id === id)) { m.remove(); remoteMarkers.delete(id); }
  for (const p of show) {
    const key = `${p.kind}:${p.report ?? ''}`;
    const old = remoteMarkers.get(p.id);
    if (old) { old.setLngLat([p.lon, p.lat]); if (old.getElement().dataset.key === key) continue; old.remove(); }
    const el = document.createElement('button');
    const strobe = false;
    el.className = `mpin ${p.kind} shared${strobe ? ' strobe' : ''}`;
    el.dataset.key = key;
    el.setAttribute('aria-label', `${sharedTitle(p)}, from ${p.by}`);
    el.innerHTML = `${strobe ? '<i class="flash" aria-hidden="true"></i>' : ''}${pinIcon(p.kind, p.report, 34)}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); remotePinSheet(p.id); });
    remoteMarkers.set(p.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}

// ---------------------------------------------------------------- placing and moving pins: slide the map under a crosshair
type Place = { mode: 'new'; report?: ReportType } | { mode: 'move'; pinId: string };
let place: Place | null = null;
function startPlacing(p: Place, center?: [number, number]) {
  closeSheet(); popup.remove(); place = p; state.follow = false;
  if (center) map.easeTo({ center, zoom: Math.max(map.getZoom(), 15) });
  refreshPlaceBar();
}
function refreshPlaceBar() {
  $('#placebar')?.remove(); $('#crosshair')?.remove();
  if (!place) return;
  const pin = place.mode === 'move' ? state.pins.find(x => x.id === (place as { pinId: string }).pinId) : null;
  const what = pin ? pinTitle(pin) : place.mode === 'new' && place.report ? REPORTS[place.report].label : 'pin';
  $('#mapwrap').insertAdjacentHTML('beforeend', `<div id="crosshair" aria-hidden="true"></div>
    <div id="placebar"><b>${place.mode === 'move' ? `Move ${esc(what)}` : `Place ${esc(what)}`}</b><span>Slide the map until the crosshair is on the spot.</span>
    <div class="btns"><button data-place="cancel">Cancel</button><button class="primary" data-place="ok">${place.mode === 'move' ? 'Save new spot' : 'Drop pin here'}</button></div></div>`);
}
$('#mapwrap').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('#placebar button'); if (!b || !place) return;
  const p = place; place = null; refreshPlaceBar();
  if (b.dataset.place !== 'ok') return;
  const c = map.getCenter(), at = { lat: c.lat, lon: c.lng };
  if (p.mode === 'move') {
    const pin = state.pins.find(x => x.id === p.pinId); if (!pin) return;
    pin.lat = at.lat; pin.lon = at.lon; pushPin(pin); store.savePins(state.pins); drawPins(); renderPane(); toast('Pin moved.');
  } else if (p.report) reported(addPin('report', undefined, undefined, at, p.report));
  else pinChooser(at);
});

/** What kind of pin to drop at a picked spot. */
function pinChooser(at: { lat: number; lon: number }) {
  pendingAt = at;
  sheet(`<h3>What's here?</h3>
    <div class="btns"><button class="primary" data-act2="pinat" data-kind="regroup">Regroup</button><button data-act2="pinat" data-kind="note">Note…</button></div>
    ${reportGridHtml('pinat')}
    <div class="btns"><button data-close>Cancel</button></div>`);
}
let pendingAt: { lat: number; lon: number } | null = null;
let pendingNoteAt: { lat: number; lon: number } | null = null;
function noteSheet(at?: { lat: number; lon: number }) {
  pendingNoteAt = at ?? null;
  sheet(`<h3>Add a note ${at ? 'there' : 'here'}</h3><form id="noteform"><input id="notetext" maxlength="60" placeholder="e.g. Water crossing, go slow" style="width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:16px"><div class="btns"><button class="primary">Save note</button><button type="button" data-close>Cancel</button></div></form>`);
}

// ---------------------------------------------------------------- quick trail reports (the map's Report button)
function reportGridHtml(act: string) {
  return `<div class="reportgrid">${REPORT_TYPES.map(t => `<button data-act2="${act}" data-report="${t}">${reportIcon(t, 50)}${REPORTS[t].label}</button>`).join('')}</div>`;
}
function openReport() {
  sheet(`<h3>Report on the trail</h3>
    <p class="quiet">${state.pos ? 'Tap one to pin it where you are.' : 'Waiting for GPS: you can place it on the map.'}</p>
    ${reportGridHtml('report')}
    <div class="btns"><button data-act2="reportplace">Place on map instead</button><button data-close>Cancel</button></div>`, 'report');
}
/** After a report: quick follow-ups (photo, move) without getting in the way. */
function reported(pin: Pin | null) {
  if (!pin) return;
  if (checkBadges()) return;
  sheet(`<h3 class="withicon">${pinIcon(pin.kind, pin.report, 36)}${esc(pinTitle(pin))} pinned</h3>
    <p class="quiet">Add a photo or a name, or move the pin if it's not quite right.</p>
    <div class="btns">${photoInput(`data-addphoto="${pin.id}"`, `${inl(ICONS.camera)} Add photo`)}<button data-act2="pinnote" data-id="${pin.id}">${inl(ICONS.pencil)} Add name</button></div>
    <div class="btns"><button data-act2="movepin" data-id="${pin.id}">Move pin</button><button data-act2="undopin" data-id="${pin.id}">Undo</button><button class="primary" data-close>Done</button></div>`);
}

// ---------------------------------------------------------------- pin photos (kept on this phone)
function photoInputChanged(t: HTMLInputElement) {
  const files = t.files;
  if (t.hasAttribute('data-newphotopin')) void photoPin(files);
  else if (t.dataset.addphoto) void addPhotosTo(t.dataset.addphoto, files);
}
const photoInput = (attr: string, label: string, cls = '') =>
  `<label class="filebtn ${cls}">${label}<input type="file" accept="image/*" multiple ${attr}></label>`;
/** Photos taken in the last two minutes were probably just shot with the camera (not picked from the library). */
const freshlyTaken = (f: File) => Date.now() - f.lastModified < 120_000;
async function storePhotos(files: FileList | null): Promise<string[]> {
  const list = Array.from(files ?? []), ids: string[] = [];
  for (const f of list) { try { ids.push(await savePhoto(f)); } catch { toast("Couldn't save a photo. The phone may be out of space."); } }
  // New camera shots aren't in the photo library yet: offer to save them there (a browser needs one tap for this).
  const fresh = list.filter(freshlyTaken);
  if (fresh.length) {
    pendingLibrary = fresh;
    sheet(`<h3>Save to your photo library?</h3>
      <p class="quiet">${fresh.length === 1 ? 'This photo is' : `These ${fresh.length} photos are`} saved in TrailLink. Save ${fresh.length === 1 ? 'it' : 'them'} to your phone's photos too.${/iPhone|iPad/.test(navigator.userAgent) ? ' On the next screen, tap <b>Save Image</b>.' : ''}</p>
      <div class="btns"><button data-close>Not now</button><button class="primary" data-act2="savefresh">Save to Photos</button></div>`);
  }
  return ids;
}
let pendingLibrary: File[] = [];
const photoFile = (id: string, t = Date.now()) => {
  const b = loadedBlob(id);
  return b ? new File([b], `TrailLink-${new Date(t).toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${id.slice(0, 4)}.jpg`, { type: b.type || 'image/jpeg' }) : null;
};
async function libraryResult(files: File[]) {
  const r = await saveToLibrary(files);
  if (r === 'downloaded') toast('Saved to your Downloads. Open it to add it to Photos.');
  return r;
}
/** New photo pin where you are. */
async function photoPin(files: FileList | null) {
  if (!state.pos) { toast('Waiting for a GPS fix.'); return; }
  const ids = await storePhotos(files);
  if (ids.length) addPin('photo', undefined, ids);
}
async function addPhotosTo(pinId: string, files: FileList | null) {
  const wasViewing = !$('#sheet').hidden && !!$('#sheet-body').querySelector('[data-pinsheet]');
  const ids = await storePhotos(files);
  const pin = state.pins.find(p => p.id === pinId);
  if (!pin || !ids.length) return;
  pin.photos = [...(pin.photos ?? []), ...ids];
  store.savePins(state.pins); drawPins(); renderPane();
  if (wasViewing && !pendingLibrary.length) pinSheet(pinId);
  toast(`${ids.length} photo${ids.length === 1 ? '' : 's'} added.`);
}

// Photos are never deleted with a pin. Taking a photo off a pin, or deleting the pin, keeps the photo here.
interface LoosePhoto { id: string; t: number; lat: number; lon: number; from: string }
let loosePhotos: LoosePhoto[] = store.get('loosePhotos', []);
function keepLoose(pin: Pin, ids: string[]) {
  loosePhotos = [...ids.map(id => ({ id, t: pin.t, lat: pin.lat, lon: pin.lon, from: pin.note || PIN_NAMES[pin.kind] })), ...loosePhotos];
  store.set('loosePhotos', loosePhotos);
}
function unpinPhoto(pinId: string, photoId: string) {
  const pin = state.pins.find(p => p.id === pinId); if (!pin) return;
  pin.photos = (pin.photos ?? []).filter(x => x !== photoId);
  keepLoose(pin, [photoId]);
  store.savePins(state.pins); drawPins(); renderPane(); pinSheet(pinId);
  toast('Photo taken off the pin. It\'s kept under "Photos from deleted pins".');
}
function removePin(pinId: string) {
  const pin = state.pins.find(p => p.id === pinId);
  if (pin?.sid) community.unsharePin(pin.sid);
  if (pin?.photos?.length) keepLoose(pin, pin.photos);
  state.pins = state.pins.filter(p => p.id !== pinId); store.savePins(state.pins); drawPins(); renderPane();
}
function sharedPinsHtml(): string {
  if (!community.signedIn) return '';
  const pos = state.pos, dist = (p: SharedPin) => (pos ? distanceM(pos, p) : 0);
  const row = (p: SharedPin) => `<div class="row">${REPORT_KINDS.has(p.kind) ? reportIcon(p.report, 34) : ''}<div class="grow"><b>${esc(sharedTitle(p))}</b>
    <div class="quiet">${REPORT_KINDS.has(p.kind) ? hazardStatus(p) : `From ${esc(p.by)} ${ago(p.createdAt)}`}${pos ? ` · ${(dist(p) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(pos, p))}` : ''}</div></div>
    <button data-shared="${p.id}">Open</button></div>`;
  const others = othersPins();
  const active = others.filter(p => p.status === 'active').sort((a, b) => dist(a) - dist(b));
  const hazards = active.filter(p => REPORT_KINDS.has(p.kind)), group = active.filter(p => !REPORT_KINDS.has(p.kind));
  const cleared = community.sharedPins.filter(p => p.status === 'cleared');
  return `${group.length ? `<h2>Shared by your group</h2>${group.slice(0, 30).map(row).join('')}` : ''}
    <h2>Trail reports from riders</h2>
    ${hazards.length ? hazards.slice(0, 40).map(row).join('') : '<p class="quiet">No open reports from other riders.</p>'}
    ${cleared.length ? `<details class="cleared"><summary>Cleared in the last 30 days (${cleared.length})</summary>${cleared.slice(0, 40).map(row).join('')}</details>` : ''}`;
}
function loosePhotosHtml(): string {
  if (!loosePhotos.length) return '';
  return `<h2>Photos from deleted pins</h2>
    <p class="quiet">Photos are never deleted with a pin. Tap one to save it to your phone's photos.</p>
    <div class="thumbs">${loosePhotos.map(l => `<button class="thumb" data-loose="${l.id}" aria-label="Photo from ${esc(l.from)}"><img data-photo="${l.id}" alt=""></button>`).join('')}</div>`;
}
function looseSheet(id: string) {
  const l = loosePhotos.find(x => x.id === id); if (!l) return;
  sheet(`<h3>${esc(l.from)}</h3><p class="quiet">${new Date(l.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}</p>
    <figure class="pinphoto"><img data-photo="${l.id}" alt="Photo"></figure>
    <div class="btns"><button data-act2="savephoto" data-id="${l.id}" data-t="${l.t}">Save to Photos</button><button data-act2="looseask" data-id="${l.id}">Delete from TrailLink</button></div>
    <div class="btns"><button class="primary" data-close>Done</button></div>`);
  hydratePhotos($('#sheet-body'));
}
/** A pin with its photos, full width. Opened from the Pins tab or by tapping the pin on the map. */
function pinSheet(pinId: string) {
  const pin = state.pins.find(p => p.id === pinId); if (!pin) return;
  const when = new Date(pin.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const sp = sharedOf(pin), hazard = REPORT_KINDS.has(pin.kind);
  const sharing = hazard
    ? `<div class="card"><b>Shared with all riders</b><div class="quiet">${sp ? hazardStatus(sp) : community.signedIn ? 'Uploads when you have signal.' : 'Sign in (Trails tab) to share it.'}</div>${sp ? voteButtons(sp) : ''}</div>`
    : `<label class="tg"><span><b>Share with my group</b><br><span class="quiet">${pin.share === 'group' ? 'Your ride group can see this pin.' : community.group ? `Private. Turn on to show it to ${esc(community.group.name)}.` : 'Private. Join a ride group to share it.'}</span></span>
        <input type="checkbox" data-pinshare="${pin.id}" ${pin.share === 'group' ? 'checked' : ''} ${community.group || pin.share ? '' : 'disabled'}></label>`;
  sheet(`<div data-pinsheet="${pin.id}"><h3 class="withicon">${pinIcon(pin.kind, pin.report, 36)}${esc(pinTitle(pin))}</h3>
    <p class="quiet">${when} · ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}</p>
    ${sharing}
    ${(pin.photos ?? []).map(ph => `<figure class="pinphoto"><img data-photo="${ph}" alt="Pin photo">
      <div class="btns"><button class="small" data-act2="savephoto" data-id="${ph}" data-t="${pin.t}">Save to Photos</button><button class="small" data-act2="unpinphoto" data-pin="${pin.id}" data-id="${ph}">Take off pin</button></div></figure>`).join('') || '<p class="quiet">No photos yet.</p>'}
    <div class="btns">${photoInput(`data-addphoto="${pin.id}"`, `${inl(ICONS.camera)} Add photo`)}<button data-act2="pinnote" data-id="${pin.id}" data-back="1">${inl(ICONS.pencil)} ${pin.note ? 'Rename' : 'Add name'}</button><button data-act2="movepin" data-id="${pin.id}">${inl(ICONS.move)} Move pin</button></div>
    <div class="btns"><button class="primary" data-close>Done</button></div></div>`);
  hydratePhotos($('#sheet-body'));
}

// ---------------------------------------------------------------- elevation profile (Ride tab)
/** The ride in the chart: the one being recorded, else the one picked, else the latest. */
function profileRide(): Track | null {
  if (state.recording && !state.viewRide) return state.recording;
  const past = state.tracks.filter(t => t.endedAt && t.points.length > 1);
  return past.find(t => t.id === state.viewRide) ?? (state.recording ?? past[0] ?? null);
}
let shownProfile: { id: string; pr: Profile } | null = null;
function finishedRides() { return state.tracks.filter(t => t.endedAt && t.points.length > 1); }
function myRidesGeo(): FeatureCollection {
  return { type: 'FeatureCollection', features: finishedRides().map(t => ({ type: 'Feature', properties: { id: t.id }, geometry: { type: 'LineString', coordinates: t.points.map(p => [p.lon, p.lat]) } })) };
}
function applyMyRides() { if (!state.myRides) { state.viewRide = null; state.scrubI = null; scrubMarker.remove(); } afterRidePane(); for (const id of ['myrides-casing', 'myrides-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.myRides ? 'visible' : 'none'); }
function refreshMyRides() { (map.getSource('myrides') as GeoJSONSource | undefined)?.setData(myRidesGeo()); afterRidePane(); }
function openRide(id: string) {
  state.viewRide = id; state.scrubI = null; scrubMarker.remove();
  if (state.detail) { state.detail = false; tapMarker.remove(); }
  popup.remove(); state.follow = false; $('#btn-center').classList.remove('active');
  state.tab = 'ride'; setPanel(true); render(); $("#pane").scrollTop = 0;
  const t = state.tracks.find(x => x.id === id); if (t) toast(t.name);
}
function viewRideGeo(): FeatureCollection {
  // In the Ride tab: the ride in the chart. Elsewhere: the ride you picked, until you tap the map away from it.
  // With "My recorded rides" off, only a ride you pick from the Past rides list is drawn.
  const t = state.tab === 'ride' && state.myRides ? profileRide() : state.viewRide ? state.tracks.find(x => x.id === state.viewRide) ?? null : null;
  return { type: 'FeatureCollection', features: t && t !== state.recording && t.points.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.points.map(p => [p.lon, p.lat]) } }] : [] };
}
/** Pins within 60 m of the ride, placed at their distance along it. */
function profileMarks(pr: Profile): ProfileMark[] {
  const out: ProfileMark[] = [];
  for (const pin of state.pins) {
    let best = -1, bd = 60;
    for (let i = 0; i < pr.lat.length; i++) { const dd = distanceM(pin, { lat: pr.lat[i], lon: pr.lon[i] }); if (dd < bd) { bd = dd; best = i; } }
    if (best < 0) continue;
    const color = pin.kind === 'report' && pin.report ? REPORTS[pin.report as ReportType]?.color ?? '#DC2626' : pin.kind === 'hazard' ? '#DC2626' : PIN_ICONS[pin.kind as keyof typeof PIN_ICONS]?.color ?? '#1F4D3A';
    out.push({ d: pr.d[best], color, label: pinTitle(pin) });
  }
  return out;
}
const fmtFt = (m: number) => `${Math.round(m * FT).toLocaleString()} ft`;
function profileHtml(): string {
  const t = profileRide();
  if (!t) return '';
  const live = t === state.recording;
  const pr = buildProfile(t.points);
  shownProfile = pr ? { id: t.id, pr } : null;
  const head = `<h2 class="phead">Elevation <span class="quiet">${live ? 'this ride so far' : esc(t.name)}</span></h2>`;
  if (!pr) return `${head}<p class="quiet">${live ? 'The elevation chart builds as you ride.' : "This ride has no elevation: the phone's GPS didn't report altitude."}</p>`;
  return `${head}
    <div class="profilebox">${profileSvg(pr, profileMarks(pr))}</div>
    <div class="preadout" id="preadout"><span class="quiet">Drag along the chart to follow the ride on the map.</span></div>
    <div class="pkey">${GRADES.map(g => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('')}${profileMarks(pr).length ? '<span><i class="dot"></i>Your pins</span>' : ''}</div>
    <div class="stats pstats">
      <div class="stat"><b>${Math.round(pr.climb * FT).toLocaleString()}</b><span>ft climbed</span></div>
      <div class="stat"><b>${Math.round(pr.descent * FT).toLocaleString()}</b><span>ft descended</span></div>
      <div class="stat"><b>${Math.round(pr.high * FT).toLocaleString()}</b><span>ft highest</span></div>
      <div class="stat"><b>${Math.round(pr.low * FT).toLocaleString()}</b><span>ft lowest</span></div>
      <div class="stat"><b>${Math.round(pr.steepUp)}%</b><span>steepest climb</span></div>
      <div class="stat"><b>${Math.round(-pr.steepDown)}%</b><span>steepest descent</span></div>
      <div class="stat"><b>${(pr.total / MI).toFixed(1)}</b><span>miles</span></div>
      <div class="stat"><b>${fmtDur(pr.t[pr.t.length - 1] - pr.t[0])}</b><span>total time</span></div>
    </div>
    ${live ? '' : `<div class="btns"><button data-act="fitride">${inl(ICONS.target)} Show whole ride on map</button></div>`}`;
}
function fmtDur(ms: number) { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

const scrubEl = document.createElement('div');
scrubEl.className = 'scrubpin';
const scrubMarker = new maplibregl.Marker({ element: scrubEl });
function setScrub(i: number | null, pan = false) {
  state.scrubI = i;
  const pr = shownProfile?.pr, svg = document.querySelector<SVGSVGElement>('#pane svg.profile');
  if (i == null || !pr || !svg || i >= pr.d.length) { scrubMarker.remove(); svg?.querySelector('.scrub')?.setAttribute('hidden', ''); return; }
  const { x, y } = scrubXY(pr, i);
  const g = svg.querySelector('.scrub')!; g.removeAttribute('hidden');
  g.querySelector('.scrubline')!.setAttribute('x1', String(x)); g.querySelector('.scrubline')!.setAttribute('x2', String(x));
  g.querySelector('.scrubdot')!.setAttribute('cx', String(x)); g.querySelector('.scrubdot')!.setAttribute('cy', String(y));
  const a = Math.max(0, i - 2), b = Math.min(pr.d.length - 1, i + 2);
  const mph = pr.t[b] > pr.t[a] ? ((pr.d[b] - pr.d[a]) / ((pr.t[b] - pr.t[a]) / 1000)) * 2.23694 : 0;
  const grade = Math.round(pr.g[i]);
  $('#preadout').innerHTML = `<b>${(pr.d[i] / MI).toFixed(2)} mi</b><b>${fmtFt(pr.e[i])}</b>
    <span class="grade" style="--c:${GRADES.find(gr => Math.abs(pr.g[i]) < gr.max)!.color}">${grade > 0 ? '▲' : grade < 0 ? '▼' : ''} ${Math.abs(grade)}%</span>
    <span class="quiet">${fmtDur(pr.t[i] - pr.t[0])} in${mph >= 1 ? ` · ${Math.round(mph)} mph` : ''}</span>`;
  const ll: [number, number] = [pr.lon[i], pr.lat[i]];
  scrubMarker.setLngLat(ll);
  if (!scrubEl.isConnected) scrubMarker.addTo(map);
  if (pan && !map.getBounds().contains(ll)) { state.follow = false; $('#btn-center').classList.remove('active'); map.easeTo({ center: ll, duration: 300 }); }
}
function afterRidePane() {
  (map.getSource('viewride') as GeoJSONSource | undefined)?.setData(viewRideGeo());
  if (state.tab !== 'ride' || !shownProfile) { scrubMarker.remove(); return; }
  if (state.scrubI != null) setScrub(state.scrubI);
}
// Padding that keeps a fitted area inside the open part of the map: below the compass and chips,
// above the SOS / chat / Report row and any panel covering the map, and clear of the side buttons.
function viewPad(extra = 16) {
  const m = $('#map').getBoundingClientRect();
  const vis = (el: Element | null) => { if (!el) return null; const r = (el as HTMLElement).getBoundingClientRect(); return r.width && r.height && r.bottom > m.top && r.top < m.bottom ? r : null; };
  let top = 0, bottom = 0, right = 0;
  for (const el of [compassEl, $('#chips'), document.querySelector('#guide'), document.querySelector('#helpbanner')]) { const r = vis(el); if (r && r.top < m.top + m.height / 2) top = Math.max(top, r.bottom - m.top); }
  for (const sel of ['#btn-sos', '#btn-report', '#chatpill', '#groupline', '#panel']) { const r = vis(document.querySelector(sel)); if (r && r.top > m.top + m.height / 2) bottom = Math.max(bottom, m.bottom - r.top); }
  const f = vis(document.querySelector('.fabs')); if (f) right = Math.max(0, m.right - f.left);
  const pad = { top: top + extra, bottom: bottom + extra, left: extra + 8, right: right + extra };
  // Tiny screens: never let the padding swallow the map.
  const h = m.height - pad.top - pad.bottom, w = m.width - pad.left - pad.right;
  if (h < 80) { const k = Math.max(0, (m.height - 80) / (pad.top + pad.bottom)); pad.top *= k; pad.bottom *= k; }
  if (w < 80) { const k = Math.max(0, (m.width - 80) / (pad.left + pad.right)); pad.left *= k; pad.right *= k; }
  return pad;
}
function fitRide() {
  const t = profileRide(); if (!t || t.points.length < 2) return;
  const b = new maplibregl.LngLatBounds();
  for (const p of t.points) b.extend([p.lon, p.lat]);
  state.follow = false; $('#btn-center').classList.remove('active');
  map.fitBounds(b, { padding: viewPad(24), duration: 600 });
}
// Drag on the chart: the dot moves along the ride on the map. Vertical swipes still scroll the panel.
function scrubFrom(e: PointerEvent) {
  const svg = (e.target as Element).closest('svg.profile'); if (!svg || !shownProfile) return;
  const r = svg.getBoundingClientRect();
  setScrub(indexAt(shownProfile.pr, distAtX(shownProfile.pr, ((e.clientX - r.left) / r.width) * PROFILE_W)), true);
}
$('#pane').addEventListener('pointerdown', e => {
  if (!(e.target as Element).closest('svg.profile')) return;
  state.scrubbing = true; (e.target as Element).setPointerCapture?.(e.pointerId); scrubFrom(e);
});
$('#pane').addEventListener('pointermove', e => { if (state.scrubbing) scrubFrom(e); });
for (const ev of ['pointerup', 'pointercancel'] as const) $('#pane').addEventListener(ev, () => { state.scrubbing = false; });

// ---------------------------------------------------------------- recording
function persistTracks() { store.saveTracks(state.tracks); refreshMyRides(); }
function startRecording() {
  const t: Track = { id: String(Date.now()), name: `Ride ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, points: [], startedAt: Date.now() };
  state.viewRide = null; state.scrubI = null;
  state.tracks.unshift(t); state.recording = t; persistTracks(); refreshTrack(); render();
  if (!state.keepAwake) toast('Tip: turn on "Keep screen on" so recording does not pause.');
}
function stopRecording() {
  if (!state.recording) return;
  state.recording.endedAt = Date.now();
  if (state.recording.points.length < 2) state.tracks = state.tracks.filter(t => t !== state.recording);
  const ride = state.recording;
  state.recording = null; persistTracks(); refreshTrack(); render();
  if (ride.points.length > 1) checkBadges([ride]);
}
function downloadGpx(id: string) {
  const t = state.tracks.find(x => x.id === id); if (!t) return;
  const blob = new Blob([toGpx(t, state.pins.filter(p => p.t >= t.startedAt && p.t <= (t.endedAt ?? Date.now())))], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${t.name.replace(/[^\w-]+/g, '_')}.gpx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- offline areas
async function saveVisibleArea() {
  if (!BASE_MAPS[state.base].offline) { toast('Street maps need signal. Switch to Topo, Satellite or Hybrid to save an area.'); return; }
  const b = map.getBounds();
  const bounds = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
  const plan = planDownload(state.base, bounds, Math.floor(map.getZoom()), state.mvum);
  if (map.getZoom() < 8) { toast('Zoom in to the area you will ride first.'); return; }
  await askToKeepStorage();
  const ctrl = new AbortController();
  state.download = { done: 0, total: plan.urls.length, failed: 0, ctrl };
  renderPane();
  const name = `${BASE_MAPS[state.base].label} · ${bounds.n.toFixed(2)}, ${bounds.w.toFixed(2)}`;
  try {
    await downloadArea(name, state.base, bounds, Math.floor(map.getZoom()), state.mvum, (done, total, failed) => {
      if (state.download) Object.assign(state.download, { done, total, failed });
      refreshPanel();
    }, ctrl.signal);
    toast(state.download && state.download.failed ? `Saved, but ${state.download.failed} pieces failed. Try again with signal.` : 'Area saved for offline use.');
  } catch { toast('Download stopped.'); }
  state.download = null; renderPane();
}

// ---------------------------------------------------------------- UI
function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout((toast as unknown as { h?: number }).h);
  (toast as unknown as { h?: number }).h = window.setTimeout(() => { t.hidden = true; }, 4500);
}
/** Pop-ups share one minimal layout: a close X at the top right instead of Done / Cancel / OK buttons. */
const CLOSE_ONLY = /<button(?: type="button")?(?: class="primary")? data-close>(?:Done|Close|Cancel|OK|Got it|Nice!|Not now)<\/button>/g;
function framed(html: string) {
  return `<button class="ibtn sheetx" data-close aria-label="Close">${ICONS.x}</button>${html.replace(CLOSE_ONLY, '').replace(/<div class="btns">\s*<\/div>/g, '')}`;
}
function sheet(html: string, cls = '') {
  const s = $('#sheet'), body = $('#sheet-body');
  state.panel = null;
  body.className = `dialog ${cls}`; body.innerHTML = framed(html); s.hidden = false;
  body.querySelector<HTMLElement>('button')?.focus();
}
function closeSheet() { $('#sheet').hidden = true; state.panel = null; }
$('#sheet').addEventListener('click', e => { const t = e.target as HTMLElement; if (t.id === 'sheet' || t.closest('[data-close]')) closeSheet(); });

function renderChips() {
  const p = state.pos;
  $('#chips').innerHTML = [
    `<span class="chip ${state.online ? 'on' : 'off'}">${state.online ? 'Online' : 'Offline'}</span>`,
    `<span class="chip on">${p ? `GPS ±${p.acc} m` : 'GPS…'}</span>`,
    state.recording ? '<span class="chip rec"><i class="recdot"></i>Recording</span>' : '',
  ].join('');
}

const views: Record<Tab, () => string> = {
  ride() {
    const p = state.pos;
    const s = state.recording ? stats(state.recording.points) : null;
    const speed = p?.speed != null ? Math.round(p.speed * 2.23694) : null;
    const pastRides = state.tracks.filter(t => t.endedAt);
    return `
      <h2>${state.recording ? 'Recording your ride' : 'Ride'}</h2>
      <div class="stats">
        <div class="stat"><b>${speed ?? '–'}</b><span>mph</span></div>
        <div class="stat"><b>${p?.alt != null ? Math.round(p.alt * 3.28084).toLocaleString() : '–'}</b><span>ft elevation</span></div>
        <div class="stat"><b>${s ? s.miles.toFixed(1) : '–'}</b><span>miles</span></div>
        <div class="stat"><b>${s ? s.movingMin : '–'}</b><span>min moving</span></div>
      </div>
      <div class="btns">
        ${state.recording ? '<button class="danger" data-act="stop">Stop recording</button>' : '<button class="primary" data-act="record">Start recording</button>'}
        <button data-act="regroup">Regroup point here</button>
      </div>
      <div class="btns">${goRoute ? '<button data-act="getoutstop">Stop route</button>' : `<button class="getoutbtn" data-act="getout">${inl(ICONS.exit)} Get me out</button>`}</div>
      <label class="tg">Keep screen on during the ride <input type="checkbox" data-set="keepAwake" ${state.keepAwake ? 'checked' : ''}></label>
      ${p ? `<p class="quiet">You: ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · ±${p.acc} m</p>` : '<p class="quiet">Waiting for GPS. Step into open sky.</p>'}
      ${profileHtml()}
      ${pastRides.length ? `<h2>Past rides</h2>${pastRides.slice(0, 20).map(t => { const st = stats(t.points); const on = profileRide()?.id === t.id; return `
        <div class="row ride${on ? ' on' : ''}"><button class="pinmain grow" data-viewride="${t.id}" aria-pressed="${on}"><b>${esc(t.name)}</b><span class="quiet">${st.miles.toFixed(1)} mi · ${st.movingMin} min moving · ${st.gainFt.toLocaleString()} ft climbed${on ? ' · in the chart' : ''}</span></button>
        <button class="ibtn" data-gpx="${t.id}" aria-label="Export ${esc(t.name)} as GPX" title="Export GPX">${ICONS.download}</button><button class="ibtn" data-delride="${t.id}" aria-label="Delete ${esc(t.name)}">${ICONS.x}</button></div>`; }).join('')}
      <p class="quiet">Your rides stay on the map as purple lines. Tap one on the map to open it here. Turn them off with <b>My recorded rides</b> in the Layers panel.</p>` : ''}`;
  },
  trails() {
    const mine = community.trails();
    const rides = state.tracks.filter(t => t.endedAt && t.points.length > 1);
    const rated = community.myRatings().size;
    return `
      <h2>Add a trail</h2>
      <div class="btns"><button class="primary" data-act="draw">Draw on the map</button>
        ${rides.length ? `<select id="fromride" aria-label="Pick a recorded ride" style="flex:1 1 140px;min-height:44px;border-radius:12px;border:1px solid var(--line);padding:0 10px;background:var(--paper)"><option value="">From a recorded ride…</option>${rides.slice(0, 30).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>` : ''}</div>
      <h2>Your trails</h2>
      ${mine.length ? mine.map(t => { const l = levelOf(t.difficulty); return `<div class="row"><span class="dchip" style="--c:${l.color}">${t.difficulty}</span><div class="grow"><b>${esc(t.name)}</b><div class="quiet">${lengthMiles(t.coords).toFixed(1)} mi · by ${esc(t.createdBy)} · ${new Date(t.createdAt).toLocaleDateString()}</div></div>
        <button class="ibtn" data-showtrail="${t.id}" aria-label="Show ${esc(t.name)} on map">${ICONS.target}</button><button data-deltrail="${t.id}" aria-label="Delete ${esc(t.name)}" class="ibtn">${ICONS.x}</button></div>`; }).join('') : '<p class="quiet">None yet.</p>'}
      <h2>Your ratings</h2>
      <p class="quiet">${rated ? `You've rated ${rated} trail${rated === 1 ? '' : 's'}.` : 'Tap any trail on the map and choose "Rate difficulty".'}</p>
      ${accountHtml()}`;
  },
  badges() { return badgesHtml(); },
  garage() {
    return `${garageHtml()}
      <details class="about"><summary>${inl(ICONS.info, 16)} How the forecast works</summary>
      <p class="quiet">Each rating saves the vehicle it was ridden in. For your rig, TrailLink starts from the riders' rating and adjusts it by how their vehicles compare to yours: a trail rated 7 in stock rigs may be a 4 in a full build, and the reverse.</p>
      <p class="quiet">Rig score: tires and lift count most, then lockers, then skid plates and rock sliders. A winch helps you recover, not climb, so it doesn't change the score.</p>
      <p class="quiet">See it on the map: tap the layers button on the map, then Color trails by › Difficulty: my rig. The ▲ harder / ▼ easier markers can be turned on there too.</p></details>`;
  },
  pins() {
    const p = state.pos;
    return `
      <h2>Drop a pin where you are</h2>
      <div class="btns"><button class="primary" data-act="regroup">Regroup</button><button class="danger" data-act="report">Report…</button><button data-act="note">Note…</button>${photoInput('data-newphotopin', `${inl(ICONS.camera)} Photo`)}</div>
      <div class="btns"><button data-act="placepin">${inl(ICONS.pin)} Place a pin on the map</button></div>
      ${state.pins.length ? state.pins.map(pin => {
        const d = p ? `${(distanceM(p, pin) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(p, pin))}` : '';
        const ph = pin.photos ?? [];
        const sp = sharedOf(pin);
        const shareTag = sp?.status === 'cleared' ? 'Cleared' : pin.share === 'all' ? 'All riders' : pin.share === 'group' ? 'Group' : '';
        const when = ago(new Date(pin.t).toISOString());
        // One compact line: icon · name (+ distance, time, sharing) · icon buttons.
        return `<div class="pinrow"><div class="pinline">${pinIcon(pin.kind, pin.report, 32)}
          <button class="pinmain" data-openpin="${pin.id}"><b>${esc(pinTitle(pin))}</b><span class="quiet">${[d, when, ph.length ? `${inl(ICONS.camera, 14)} ${ph.length}` : '', shareTag].filter(Boolean).join(' · ')}</span></button>
          <span class="ibtns">
            <button class="ibtn" data-goto="${pin.id}" aria-label="Show ${esc(pinTitle(pin))} on the map" title="Show on map">${ICONS.target}</button>
            <button class="ibtn" data-movepin="${pin.id}" aria-label="Move ${esc(pinTitle(pin))}" title="Move">${ICONS.move}</button>
            <label class="ibtn filebtn" title="Add photo" aria-label="Add a photo to ${esc(pinTitle(pin))}">${ICONS.camera}<input type="file" accept="image/*" multiple data-addphoto="${pin.id}"></label>
            <button class="ibtn" data-delpin="${pin.id}" aria-label="Delete ${esc(pinTitle(pin))}" title="Delete">${ICONS.x}</button>
          </span></div>
          ${ph.length ? `<div class="thumbs">${ph.map(id => `<button class="thumb" data-openpin="${pin.id}" aria-label="View photo"><img data-photo="${id}" alt=""></button>`).join('')}</div>` : ''}</div>`;
      }).join('') : '<p class="quiet">No pins yet. Pins work offline and back up to your account when you have signal.</p>'}
      ${community.signedIn ? `<label class="tg"><span>Share my new pins with my group<br><span class="quiet">${community.group ? `Regroup points, notes and photo pins go to ${esc(community.group.name)}. Hazard reports always go to all riders.` : 'Join a ride group first (Group tab). Hazard reports always go to all riders.'}</span></span><input type="checkbox" data-set="shareNewPins" ${store.get('shareNewPins', false) ? 'checked' : ''}></label>` : ''}
      ${sharedPinsHtml()}
      ${loosePhotosHtml()}`;
  },
  group() {
    return `${community.isAdmin && community.signedIn ? adminHtml() : ''}
      ${groupHtml(false)}
      <details class="about"><summary>${inl(ICONS.info, 16)} No signal?</summary><p class="quiet">Positions update when a phone has cell signal. Out of range, the map shows each rider's last known spot and how long ago it was. Agree on a Regroup point (Pins tab) before you split up.</p></details>`;
  },
};

// ---------------------------------------------------------------- collapsible panel (more room for the map)
const panelCollapsed = () => $('#app').classList.contains('collapsed');
function setPanel(open: boolean) {
  if (open === !panelCollapsed()) return;
  $('#app').classList.toggle('collapsed', !open);
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
  store.set('panelOpen', open);
  requestAnimationFrame(() => map.resize());
}
$('#app').classList.toggle('collapsed', !store.get('panelOpen', false));
// iPhone Home Screen app (iOS 26): the page is laid out shorter than the screen, leaving an empty strip under the tabs.
// When the app runs full screen, size it to the screen itself.
function fitScreen() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
  const portrait = innerHeight >= innerWidth;
  const sw = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  const sh = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const full = standalone && Math.abs(innerWidth - sw) <= 2 && sh > innerHeight && sh - innerHeight < 120; // not split view
  const want = full ? `${sh}px` : '';
  if (document.documentElement.style.getPropertyValue('--app-h') === want) return;
  if (want) document.documentElement.style.setProperty('--app-h', want); else document.documentElement.style.removeProperty('--app-h');
  requestAnimationFrame(() => map.resize());
}
fitScreen();
addEventListener('resize', fitScreen);
addEventListener('orientationchange', () => setTimeout(fitScreen, 300));
// iPhone Home Screen app bug: after the keyboard closes, iOS can leave the app shorter than the screen (a dead band
// at the bottom) until the app is restarted. Hiding and re-showing the app makes iOS measure the screen again.
const tallest = new Map<number, number>(); // per screen width, so turning the phone doesn't count as shrinking
const noteHeight = () => tallest.set(innerWidth, Math.max(tallest.get(innerWidth) ?? 0, innerHeight));
noteHeight();
addEventListener('resize', noteHeight);
function remeasure() {
  if ((tallest.get(innerWidth) ?? innerHeight) - innerHeight <= 4) return;
  const app = $('#app'), pane = $('#pane'), top = pane?.scrollTop ?? 0;
  app.style.display = 'none'; void app.offsetHeight; app.style.display = '';
  if (pane) pane.scrollTop = top;
  requestAnimationFrame(() => map.resize());
}
document.addEventListener('focusout', () => setTimeout(remeasure, 150));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(remeasure, 150); });
$('#panel-toggle').addEventListener('click', () => setPanel(panelCollapsed()));

// ---------------------------------------------------------------- full screen: a browser always shows its address bar;
// opened from the home screen, TrailLink runs full screen with no address bar.
const standalone = () => window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e as typeof installEvent; showInstallBar(); });
window.addEventListener('appinstalled', () => { $('#installbar')?.remove(); toast('TrailLink is on your home screen. Open it from there for full screen.'); });
function showInstallBar() {
  if (standalone() || store.get('installDismissed', false) || $('#installbar')) return;
  $('#mapwrap').insertAdjacentHTML('beforeend', `<div id="installbar"><span><b>Hide the address bar</b>Add to Home Screen</span>
    <button class="primary" data-install="go">${installEvent ? 'Install' : 'How'}</button><button data-install="no" aria-label="Not now" class="ibtn">${ICONS.x}</button></div>`);
}
function installHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  sheet(`<h3>Add TrailLink to your home screen</h3>
    ${ios ? `<p>In Safari:</p><ol class="steps"><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>, then open TrailLink from its new icon.</li></ol>
      <p class="quiet">Your first sign-in on the home-screen app needs the 6-digit code from the email (the link opens Safari instead).</p>`
    : `<p>In Chrome:</p><ol class="steps"><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li><li>Open TrailLink from its new icon.</li></ol>`}
    <p class="quiet">From the home screen it opens full screen, with no address bar, and works offline.</p>
    <div class="btns"><button class="primary" data-close>Got it</button></div>`);
}
$('#mapwrap').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('#installbar button'); if (!b) return;
  if (b.dataset.install === 'no') { store.set('installDismissed', true); $('#installbar')?.remove(); return; }
  if (installEvent) { void installEvent.prompt(); installEvent = null; $('#installbar')?.remove(); } else installHelp();
});
setTimeout(showInstallBar, 4000);
// Map credits start folded to the small (i) button instead of a wide strip across the map.
const foldCredits = () => document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(el => { el.classList.remove('maplibregl-compact-show'); el.removeAttribute('open'); });
map.on('load', () => setTimeout(foldCredits, 300));
map.on('style.load', () => setTimeout(foldCredits, 300));

function renderPane() {
  const pane = $('#pane');
  const scroll = pane.scrollTop;
  if (state.detail && popupProps) {
    pane.innerHTML = `<div class="detail">${popupHtml(popupProps)}<div class="btns"><button data-closedetail>Close</button></div></div>`;
    return;
  }
  pane.innerHTML = views[state.tab]();
  pane.scrollTop = scroll;
  hydratePhotos(pane);
  refreshPanel();
  afterRidePane();
  afterChat();
}
function render() {
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  renderChips(); renderPane();
}

$('#tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]'); if (b) {
  // Tapping the open tab hides the panel; any other tab opens it.
  if (b.dataset.tab === state.tab && !panelCollapsed() && !state.detail) { setPanel(false); return; }
  setPanel(true); state.tab = b.dataset.tab as Tab; if (state.tab === 'pins') void community.fetchSharedPins().then(() => community.onChange()); if (state.detail) { state.detail = false; tapMarker.remove(); } render(); } });

function paneClick(e: Event) {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return;
  if (b.dataset.panel) { openPanel(b.dataset.panel as 'layers' | 'legend'); return; }
  const act = b.dataset.act;
  if (act === 'record') startRecording();
  else if (act === 'stop') stopRecording();
  else if (act === 'regroup') addPin('regroup');
  else if (act === 'hazard') addPin('hazard');
  else if (act === 'note') noteSheet();
  else if (act === 'save-area') void saveVisibleArea();
  else if (act === 'cancel-dl') state.download?.ctrl.abort();
  else if (act === 'clear-tiles') sheet(`<h3>Delete all saved maps?</h3><p>You'll need signal to see maps until you save areas again.</p><div class="btns"><button class="danger" data-act2="confirm-clear">Delete</button><button data-close>Keep them</button></div>`);
  if (b.dataset.base) setBase(b.dataset.base as BaseMapId);
  if (b.dataset.theme) { state.theme = b.dataset.theme as Theme; store.set('theme', state.theme); applyTheme(); refreshPanel(); }
  if (b.dataset.colorby) { state.colorBy = b.dataset.colorby as ColorBy; store.set('colorBy', state.colorBy); applyColorBy(); renderPane(); }
  if (act === 'draw') startDrawing();
  if (act === 'addvehicle') vehicleForm();
  if (b.dataset.badge) badgeSheet(b.dataset.badge);
  if (act === 'checkrides') { const got = checkBadges(state.tracks.filter(t => t.endedAt && t.points.length > 1), true); if (!got) toast('Checked your rides. No new badges yet.'); }
  if (act === 'groupshare' && community.group) void shareGroupCode();
  if (act === 'groupqr' && community.group) { showGroupQr(); return; }
  if (act === 'groupscan') { void scanQr(); return; }
  if (act === 'getout') { getOutSheet(); return; }
  if (act === 'installhelp') { installHelp(); return; }
  if (act === 'offlinehelp') { openPanel('basemap'); return; }
  if (act === 'pushon') { chat.enablePush().then(() => { toast('Notifications on for new group messages.'); renderPane(); }, (err: Error) => toast(err.message)); return; }
  if (act === 'getoutstop') { stopGetOut(); return; }
  if (act === 'sharesetup') { void shareSetup(); return; }
  if (act === 'groupleave' && community.group) sheet(`<h3>Leave ${esc(community.group.name)}?</h3><p>The group won't see you anymore. You can rejoin with the code.</p><div class="btns"><button data-close>Stay</button><button class="danger" data-act2="leavegroup">Leave</button></div>`);
  if (act === 'grouprefresh') void community.refreshGroup();
  if (b.dataset.rider) { const m = community.members.find(x => x.riderId === b.dataset.rider); if (m?.pos) { state.follow = false; if (state.panel) closeSheet(); map.flyTo({ center: [m.pos.lon, m.pos.lat], zoom: Math.max(map.getZoom(), 14) }); } }
  if (b.dataset.togglevehicle) { const id = b.dataset.togglevehicle, o = state.openVehicles; if (o.has(id)) o.delete(id); else o.add(id); renderPane(); }
  if (b.dataset.editvehicle) vehicleForm(community.garage().find(v => v.id === b.dataset.editvehicle));
  if (b.dataset.ridevehicle) { community.setActive(b.dataset.ridevehicle); afterGarageChange(); toast(`Riding the ${community.activeVehicle()?.nickname}. Forecasts updated.`); }
  if (b.dataset.delvehicle) { const v = community.garage().find(x => x.id === b.dataset.delvehicle); if (v) sheet(`<h3>Remove ${esc(v.nickname)}?</h3><p>Ratings you gave in it keep its setup.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="delvehicle" data-id="${v.id}">Remove</button></div>`); }
  if (act === 'admin') { state.tab = 'group'; setPanel(true); render(); }
  if (act === 'admin-refresh') { state.admin.invited = ''; loadRiders(); renderPane(); }
  if (b.dataset.invitesend) void sendInvite(b.dataset.invitesend);
  if (b.dataset.invitecopy) void navigator.clipboard?.writeText(inviteText(b.dataset.invitecopy)).then(() => toast('Invite message copied.'), () => {});
  if (b.dataset.role) {
    const reviewer = b.dataset.reviewer === 'true';
    state.admin.busy = true; renderPane();
    community.adminSetRole(b.dataset.role, reviewer, false).then(() => toast(reviewer ? 'Now a reviewer.' : 'No longer a reviewer.'), (e: Error) => { state.admin.error = e.message; }).finally(loadRiders);
  }
  if (b.dataset.removerider) {
    const r = state.admin.riders?.find(x => x.email === b.dataset.removerider);
    if (r) sheet(`<h3>Remove ${esc(r.display_name ?? r.email)}?</h3><p>${r.joined_at ? `They'll be signed out within the hour and can't sign in again. Their ${r.ratings} rating${r.ratings === 1 ? '' : 's'} and ${r.trails} trail${r.trails === 1 ? '' : 's'} are deleted too.` : 'Their approval is cancelled, so they can\'t sign in.'}</p>
      <div class="btns"><button data-close>Keep</button><button class="danger" data-act2="removerider" data-id="${esc(r.email)}">Remove</button></div>`);
  }
  if (act === 'fitride') { fitRide(); return; }
  if (act === 'teststart' || act === 'teststop' || act === 'testnotify' || act === 'testhelp') { void testAction(act); return; }
  if (act === 'sync') { void community.sync(); void backup.run(); }
  if (act === 'signout') void community.signOut().then(() => { state.signin = null; renderPane(); });
  if (act === 'signin-back') { state.signin = state.signin ? { ...state.signin, sent: false, error: undefined } : null; renderPane(); }
  if (act === 'rename') sheet(`<h3>Your name</h3><form id="renameform" class="form"><label>Shown as "created by" on your trails<input name="name" required maxlength="40" value="${esc(community.me()?.name ?? '')}"></label><div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
  if (b.dataset.showtrail) { const t = community.trails().find(x => x.id === b.dataset.showtrail); if (t) { state.follow = false; const xs = t.coords.map(c => c[0]), ys = t.coords.map(c => c[1]); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: viewPad(24), maxZoom: 15 }); } }
  if (b.dataset.deltrail) { const t = community.trails().find(x => x.id === b.dataset.deltrail); if (t) sheet(`<h3>Delete ${esc(t.name)}?</h3><p>This removes the trail from this phone.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="deltrail" data-id="${t.id}">Delete</button></div>`); }
  if (b.dataset.gpx) downloadGpx(b.dataset.gpx);
  if (b.dataset.delride) { const t = state.tracks.find(x => x.id === b.dataset.delride); if (t) sheet(`<h3>Delete ${esc(t.name)}?</h3><p>This removes the ride from the map, this phone and your backup. Export it as GPX first if you want to keep a copy.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="delride" data-id="${t.id}">Delete</button></div>`); return; }
  if (b.dataset.viewride) { state.viewRide = b.dataset.viewride; state.scrubI = null; scrubMarker.remove(); renderPane(); fitRide(); return; }
  if (b.dataset.delpin) { const pin = state.pins.find(p => p.id === b.dataset.delpin); if (pin) { removePin(pin.id); if (pin.photos?.length) toast(`Pin deleted. Its photo${pin.photos.length === 1 ? ' is' : 's are'} kept under "Photos from deleted pins".`); } }
  if (b.dataset.openpin) pinSheet(b.dataset.openpin);
  if (b.dataset.movepin) { const pin = state.pins.find(p => p.id === b.dataset.movepin); if (pin) startPlacing({ mode: 'move', pinId: pin.id }, [pin.lon, pin.lat]); }
  if (act === 'report') openReport();
  if (act === 'placepin') startPlacing({ mode: 'new' });
  if (b.dataset.loose) looseSheet(b.dataset.loose);
  if (b.dataset.shared) remotePinSheet(b.dataset.shared);
  if (b.dataset.goto) { const p = state.pins.find(x => x.id === b.dataset.goto); if (p) { state.follow = false; map.flyTo({ center: [p.lon, p.lat], zoom: 15 }); } }
  if (b.dataset.forget) { forgetArea(b.dataset.forget); renderPane(); }
  if (b.dataset.showarea) { const a = savedAreas().find(x => x.id === b.dataset.showarea); if (a) { state.follow = false; closeSheet(); map.fitBounds([[a.bounds.w, a.bounds.s], [a.bounds.e, a.bounds.n]], { padding: viewPad() }); } }
}
$('#pane').addEventListener('click', paneClick);
$('#sheet').addEventListener('click', e => { if (state.panel) paneClick(e); });
function paneChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.type === 'file') { photoInputChanged(t); return; }
  if (t.dataset.set === 'shareNewPins') { store.set('shareNewPins', t.checked); renderPane(); return; }
  if (t.dataset.set === 'photoBackup') { store.set('photoBackup', t.checked); toast(t.checked ? 'Photos will back up to your account.' : 'Photos stay on this phone only.'); backup.schedule(500); renderPane(); return; }
  if (t.dataset.pinshare) {
    const pin = state.pins.find(p => p.id === t.dataset.pinshare); if (!pin) return;
    if (t.checked) shareOwnPin(pin, 'group'); else unshareOwnPin(pin);
    store.savePins(state.pins); renderPane(); pinSheet(pin.id);
    toast(t.checked ? 'Shared with your group.' : 'Pin is private again.');
    return;
  }
  if (t.dataset.set === 'sharing') {
    const on = t.checked; state.groupBusy = true; state.groupError = '';
    community.setSharing(on).then(() => { toast(on ? 'Sharing your location with the group.' : 'Stopped sharing. Your location was removed from the group.'); lastShare = 0; maybeSharePosition(); if (on) { store.set('groupRides', store.get('groupRides', 0) + 1); checkBadges(); } },
      (err: Error) => { state.groupError = err.message; t.checked = !on; }).finally(() => { state.groupBusy = false; renderPane(); });
    return;
  }
  if (t.id === 'fromride' && t.value) { const ride = state.tracks.find(r => r.id === t.value); if (ride) newTrailForm(ride.points.map(p => [p.lon, p.lat] as [number, number])); t.value = ''; }
  if (t.dataset.set === 'trails') { state.trails = t.checked; store.set('trails', t.checked); for (const l of [...TRAIL_LAYERS, ...OVERVIEW_LAYERS]) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', t.checked ? 'visible' : 'none'); if (!t.checked) popup.remove(); applyRigMarks(); }
  if (t.dataset.set === 'rigMarks') { state.rigMarks = t.checked; store.set('rigMarks', t.checked); applyRigMarks(); renderPane(); }
  if (t.dataset.set === 'mvum') { state.mvum = t.checked; store.set('mvumImage', t.checked); if (map.getLayer('mvum')) map.setLayoutProperty('mvum', 'visibility', t.checked ? 'visible' : 'none'); }
  if (t.dataset.set === 'myRides') { state.myRides = t.checked; store.set('myRides', t.checked); applyMyRides(); }
  if (t.dataset.set === 'groupLine') { state.groupLine = t.checked; store.set('groupLine', t.checked); drawGroupLine(); }
  if (t.dataset.set === 'compass') { state.compass = t.checked; store.set('compass', t.checked); drawHeading(); }
  if (t.dataset.set === 'keepAwake') { state.keepAwake = t.checked; store.set('keepAwake', t.checked); void applyWakeLock(); }
}
$('#pane').addEventListener('change', paneChange);
$('#sheet').addEventListener('change', e => { if (state.panel) paneChange(e); });
$('#pane').addEventListener('submit', e => {
  e.preventDefault();
  if (chatSubmit(e.target as HTMLFormElement)) return;
  if (groupSubmit(e.target as HTMLFormElement)) return;
  const form = e.target as HTMLFormElement, f = new FormData(form);
  if (form.id === 'signinform') {
    const email = String(f.get('email') ?? '').trim(), name = String(f.get('name') ?? '').trim();
    state.signin = { email, sent: false, busy: true }; renderPane();
    community.sendCode(email, name).then(() => { state.signin = { email, sent: true, busy: false }; renderPane(); })
      .catch((err: Error) => { state.signin = { email, sent: false, busy: false, error: err.message }; renderPane(); });
  }
  if (form.id === 'inviteform') {
    const email = String(f.get('email') ?? '').trim().toLowerCase(), a = state.admin;
    a.busy = true; a.error = ''; renderPane();
    community.adminInvite(email).then(() => { a.invited = email; }, (err: Error) => { a.error = err.message; }).finally(loadRiders);
  }
  if (form.id === 'codeform' && state.signin) {
    const si = state.signin; si.busy = true; renderPane();
    community.verifyCode(si.email, String(f.get('code') ?? '').replace(/\D/g, '')).then(() => { state.signin = null; toast('Signed in. Your trails and ratings are now shared.'); renderPane(); })
      .catch((err: Error) => { state.signin = { ...si, busy: false, error: err.message }; renderPane(); });
  }
});
$('#sheet').addEventListener('change', e => {
  if ((e.target as HTMLInputElement).type === 'file') { photoInputChanged(e.target as HTMLInputElement); return; }
  if ((e.target as HTMLInputElement).dataset.pinshare) { paneChange(e); return; }
  const t = e.target as HTMLSelectElement;
  if (t.id === 'ratevehicle') { community.setActive(t.value); afterGarageChange(); }
  if (t.closest('#vehicleform')) updateRigPreview();
});
$('#sheet').addEventListener('input', e => { if ((e.target as HTMLElement).closest('#vehicleform')) updateRigPreview(); });
$('#sheet').addEventListener('submit', e => {
  e.preventDefault();
  if (chatSubmit(e.target as HTMLFormElement)) return;
  if (groupSubmit(e.target as HTMLFormElement)) return;
  if ((e.target as HTMLElement).id === 'renameform') { community.setName(String(new FormData(e.target as HTMLFormElement).get('name') ?? '')); closeSheet(); void community.sync(); renderPane(); }
  if ((e.target as HTMLElement).id === 'badgeform' && badgeDraft) {
    const f = new FormData(e.target as HTMLFormElement), d = badgeDraft;
    void community.saveBadgeTrail({ id: d.id, name: String(f.get('name') ?? '').trim(), description: String(f.get('description') ?? '').trim() || undefined, tids: d.tids, geom: d.geom,
      difficulty: Number(f.get('difficulty')) || undefined, color: String(f.get('color') ?? BADGE_TRAIL_COLORS[0]), icon: String(f.get('icon') ?? 'peak') as BadgeIcon, minCoverage: Number(f.get('min')) || 75 })
      .then(() => { badgeDraft = null; closeSheet(); refreshPopup(); toast('Badge trail saved. Riders earn it by riding it.'); }, (err: Error) => toast(err.message));
    return;
  }
  if ((e.target as HTMLElement).id === 'vehicleform') {
    const f = new FormData(e.target as HTMLFormElement);
    const v = community.saveVehicle(vehicleFromForm(f));
    closeSheet(); afterGarageChange(); toast(`Saved ${v.nickname}: ${rigClass(rigScore(v)).toLowerCase()} (${rigScore(v)}/10).`);
  }
  if ((e.target as HTMLElement).id === 'noteform') { const at = pendingNoteAt ?? undefined; pendingNoteAt = null; addPin('note', $<HTMLInputElement>('#notetext').value, undefined, at); closeSheet(); }
  if ((e.target as HTMLElement).id === 'pinnoteform') {
    const f = e.target as HTMLFormElement, pin = state.pins.find(p => p.id === f.dataset.id);
    if (pin) { pin.note = String(new FormData(f).get('note') ?? '').trim() || undefined; pushPin(pin); store.savePins(state.pins); drawPins(); renderPane(); }
    if (pin && f.dataset.back) pinSheet(pin.id); else closeSheet();
  }
  if ((e.target as HTMLElement).id === 'trailform' && pendingCoords) {
    const f = new FormData(e.target as HTMLFormElement);
    community.setName(String(f.get('by') ?? ''));
    void community.addTrail({
      name: String(f.get('name')).trim(), difficulty: Number(f.get('difficulty')), vehicles: f.get('vehicles') as VehicleFit,
      notes: String(f.get('notes') ?? '').trim() || undefined, coords: pendingCoords,
    }).then(t => { pendingCoords = null; closeSheet(); refreshRiderTrails(); renderPane(); toast(`Saved "${t.name}".`); checkBadges(); });
  }
});
$('#sheet').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act2], button[data-vote], button[data-unvote]'); if (!b) return;
  if (b.dataset.unvote) { void vote(b.dataset.unvote, null); return; }
  if (b.dataset.vote && b.dataset.tid) { void vote(b.dataset.tid, Number(b.dataset.vote)); return; }
  if (b.dataset.act2 === 'delride' && b.dataset.id) { const id = b.dataset.id; state.tracks = state.tracks.filter(t => t.id !== id); if (state.viewRide === id) { state.viewRide = null; state.scrubI = null; scrubMarker.remove(); } persistTracks(); closeSheet(); renderPane(); toast('Ride deleted.'); return; }
  if (b.dataset.act2 === 'deltrail' && b.dataset.id) { void community.deleteTrail(b.dataset.id).then(() => { closeSheet(); popup.remove(); refreshRiderTrails(); renderPane(); }); return; }
  if (b.dataset.act2 === 'seebadges') { closeSheet(); state.tab = 'badges'; setPanel(true); render(); $('#pane').scrollTop = 0; return; }
  if (b.dataset.act2 === 'badgemap' && b.dataset.id) { const t = community.badgeTrails.find(x => x.id === b.dataset.id); if (t) { const bb = badgeBbox(t.geom); closeSheet(); state.follow = false; map.fitBounds([[bb.w, bb.s], [bb.e, bb.n]], { padding: viewPad(24) }); } return; }
  if (b.dataset.act2 === 'badgeedit' && b.dataset.id) { const t = community.badgeTrails.find(x => x.id === b.dataset.id); if (t) badgeTrailForm(t.tids[0] ?? '', t); return; }
  if (b.dataset.act2 === 'badgeremove' && b.dataset.id) { void community.removeBadgeTrail(b.dataset.id).then(() => { closeSheet(); toast('Badge trail removed. Riders keep badges they earned.'); }, (err: Error) => toast(err.message)); return; }
  if (b.dataset.act2 === 'pinvote' && b.dataset.id) {
    const v = b.dataset.v as 'there' | 'cleared'; community.votePin(b.dataset.id, v);
    toast(v === 'cleared' ? 'Marked cleared. Thanks!' : 'Thanks! Riders will see it was still there.');
    if (v === 'cleared' && checkBadges()) return;
    drawPins(); drawRemotePins(); renderPane();
    const own = state.pins.find(p => p.sid === b.dataset.id); if (own) pinSheet(own.id); else remotePinSheet(b.dataset.id);
    return;
  }
  if (b.dataset.act2 === 'gotoshared' && b.dataset.id) { const p = community.sharedPins.find(x => x.id === b.dataset.id); if (p) { state.follow = false; closeSheet(); map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15) }); } return; }
  if (b.dataset.act2 === 'removeshared' && b.dataset.id) { community.unsharePin(b.dataset.id); closeSheet(); drawRemotePins(); renderPane(); toast('Removed for everyone.'); return; }
  if (b.dataset.act2 === 'report' && b.dataset.report) { if (!state.pos) { startPlacing({ mode: 'new', report: b.dataset.report as ReportType }); return; } closeSheet(); reported(addPin('report', undefined, undefined, undefined, b.dataset.report as ReportType)); return; }
  if (b.dataset.act2 === 'reportplace') { startPlacing({ mode: 'new' }); return; }
  if (b.dataset.act2 === 'pinat' && pendingAt) {
    const at = pendingAt; pendingAt = null; closeSheet();
    if (b.dataset.report) reported(addPin('report', undefined, undefined, at, b.dataset.report as ReportType));
    else if (b.dataset.kind === 'note') noteSheet(at);
    else addPin('regroup', undefined, undefined, at);
    return;
  }
  if (b.dataset.act2 === 'movepin' && b.dataset.id) { const pin = state.pins.find(p => p.id === b.dataset.id); if (pin) startPlacing({ mode: 'move', pinId: pin.id }, [pin.lon, pin.lat]); return; }
  if (b.dataset.act2 === 'undopin' && b.dataset.id) { removePin(b.dataset.id); closeSheet(); toast('Report removed.'); return; }
  if (b.dataset.act2 === 'pinnote' && b.dataset.id) { const pin = state.pins.find(p => p.id === b.dataset.id); if (pin) sheet(`<h3 class="withicon">${pinIcon(pin.kind, pin.report, 36)}Name this pin</h3><form id="pinnoteform" data-id="${pin.id}" data-back="${b.dataset.back ?? ''}" class="form"><label>Name<input name="note" maxlength="60" value="${esc(pin.note ?? '')}" placeholder="${pin.kind === 'report' || pin.kind === 'hazard' ? 'e.g. Big pine across the trail, go left' : 'e.g. Lunch spot at the overlook'}"></label><p class="quiet">Shown instead of &ldquo;${esc(pin.kind === 'report' && pin.report ? REPORTS[pin.report as ReportType]?.label ?? 'Pin' : PIN_NAMES[pin.kind])}&rdquo;. Leave empty to use that.</p><div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`); return; }
  if (b.dataset.act2 === 'savefresh') { const files = pendingLibrary; pendingLibrary = []; closeSheet(); void libraryResult(files); return; }
  if (b.dataset.act2 === 'savephoto' && b.dataset.id) { const f = photoFile(b.dataset.id, Number(b.dataset.t) || Date.now()); if (f) void libraryResult([f]); else toast('Photo still loading. Try again.'); return; }
  if (b.dataset.act2 === 'unpinphoto' && b.dataset.pin && b.dataset.id) { unpinPhoto(b.dataset.pin, b.dataset.id); return; }
  if (b.dataset.act2 === 'looseask' && b.dataset.id) { sheet(`<h3>Delete this photo from TrailLink?</h3><p>It will be gone from TrailLink. If you saved it to your phone's photos, that copy stays.</p><div class="btns"><button data-act2="loosekeep" data-id="${b.dataset.id}">Keep it</button><button class="danger" data-act2="loosedel" data-id="${b.dataset.id}">Delete</button></div>`); return; }
  if (b.dataset.act2 === 'loosekeep' && b.dataset.id) { looseSheet(b.dataset.id); return; }
  if (b.dataset.act2 === 'loosedel' && b.dataset.id) { const id = b.dataset.id; loosePhotos = loosePhotos.filter(x => x.id !== id); store.set('loosePhotos', loosePhotos); void deletePhoto(id); closeSheet(); renderPane(); return; }
  if (b.dataset.act2 === 'leavegroup') { closeSheet(); community.leaveGroup().then(() => toast('You left the group.'), (err: Error) => toast(err.message)); return; }
  if (b.dataset.act2 === 'delvehicle' && b.dataset.id) { community.deleteVehicle(b.dataset.id); closeSheet(); afterGarageChange(); return; }
  if (b.dataset.act2 === 'removerider' && b.dataset.id) {
    const email = b.dataset.id; closeSheet(); state.admin.busy = true; renderPane();
    community.adminRemove(email).then(() => { if (state.admin.invited === email) state.admin.invited = ''; toast('Rider removed.'); }, (e: Error) => { state.admin.error = e.message; }).finally(loadRiders);
    return;
  }
  if (b.dataset.act2 === 'confirm-clear') { void clearAllTiles().then(() => { closeSheet(); renderPane(); toast('Saved maps deleted.'); }); }
  if (b.dataset.act2 === 'sos-copy' && state.pos) { void navigator.clipboard?.writeText(`${state.pos.lat.toFixed(5)}, ${state.pos.lon.toFixed(5)}`).then(() => toast('Coordinates copied.'), () => {}); }
});

$('#btn-layers').addEventListener('click', () => openPanel('layers'));
$('#btn-base').addEventListener('click', () => openPanel('basemap'));
$('#btn-legend').addEventListener('click', () => openPanel('legend'));
$('#btn-report').addEventListener('click', openReport);
$('#btn-riders').addEventListener('click', () => { openPanel('riders'); void community.refreshGroup(); });
$('#btn-center').addEventListener('click', () => {
  state.follow = true; $('#btn-center').classList.add('active');
  if (state.pos) map.easeTo({ center: [state.pos.lon, state.pos.lat], zoom: Math.max(map.getZoom(), 14) });
  else toast('Waiting for a GPS fix.');
});

// SOS: press and hold 3 seconds (a tap does nothing, to avoid bumps).
{
  const btn = $('#btn-sos'); let t0 = 0, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); t0 = 0; btn.style.setProperty('--p', '0%'); };
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / 3000); btn.style.setProperty('--p', `${p * 100}%`);
    if (p >= 1) { stop(); showSos(); } else raf = requestAnimationFrame(step);
  };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); t0 = performance.now(); navigator.vibrate?.(30); raf = requestAnimationFrame(step); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
function showSos() {
  navigator.vibrate?.([200, 100, 200]);
  const p = state.pos;
  sheet(`
    <h3>Emergency</h3>
    ${p ? `<p>Your position:</p><div class="coords">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div><p>Accuracy ±${p.acc} m${p.alt != null ? ` · ${Math.round(p.alt * 3.28084).toLocaleString()} ft` : ''}</p>`
        : '<p>No GPS fix yet. Step into open sky.</p>'}
    <div class="card"><b>Call or text 911</b><p>With no cell signal, use your phone's Emergency SOS via satellite (iPhone 14 or later, recent Pixel and Galaxy phones): step into open sky, call or text 911, and follow the prompts. If someone has an inReach, use it too.</p>
      <p>Read the coordinates above to the dispatcher.</p>
      <div class="btns"><a class="btnlink danger" href="tel:911">Call 911</a><button data-act2="sos-copy">Copy coordinates</button></div></div>
    <div class="btns"><button class="getoutbtn" data-act="getout">${inl(ICONS.exit)} Get me out: route back</button></div>
    <p>This spot is saved as an "Emergency" pin.</p>
    <div class="btns"><button data-close>Close</button></div>`, 'sos');
  if (p) { state.pins.unshift({ id: String(Date.now()), kind: 'hazard', lat: p.lat, lon: p.lon, t: Date.now(), note: 'Emergency' }); store.savePins(state.pins); drawPins(); }
}

window.addEventListener('online', () => { state.online = true; renderChips(); });
window.addEventListener('offline', () => { state.online = false; renderChips(); });

// ---------------------------------------------------------------- start
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then(r => r.update()).catch(() => {}); });
}
$('#btn-center').classList.add('active');
// Test hook: open the app with #debug to reach the map from automated browser tests.
if (location.hash === '#debug') Object.assign(window, { tl: { map, community, state, chat, riderBubble, setChatOpen, drawHeading, drawRiders, updateRideMode, headsUp, drawSpots, renderMapChat, startGetOut, updateGuide, getGo: () => goRoute, trailLines, go: { loadTrailLines, buildGraph, trailRoute } } });
// ---------------------------------------------------------------- account backup (pins, rides, settings, photos)
// Settings that follow the rider between phones (map position, panel and install prompts stay per phone).
const SYNCED_SETTINGS = ['groupLine', 'myRides', 'theme', 'compass', 'headingUp', 'readAloud', 'base', 'trails', 'colorBy', 'rigMarks', 'mvumImage', 'keepAwake', 'shareNewPins', 'loosePhotos', 'groupRides', 'photoBackup', 'activeVehicle'];
function applySettings(keys: string[]) {
  for (const k of keys) {
    if (k === 'base') { const b = store.get<BaseMapId>('base', 'topo'); if (b !== state.base && b in BASE_MAPS) setBase(b); }
    if (k === 'colorBy') { state.colorBy = store.get<ColorBy>('colorBy', 'access'); applyColorBy(); }
    if (k === 'trails') { state.trails = store.get('trails', true); for (const l of [...TRAIL_LAYERS, ...OVERVIEW_LAYERS]) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', state.trails ? 'visible' : 'none'); }
    if (k === 'rigMarks') { state.rigMarks = store.get('rigMarks', true); applyRigMarks(); }
    if (k === 'mvumImage') { state.mvum = store.get('mvumImage', false); if (map.getLayer('mvum')) map.setLayoutProperty('mvum', 'visibility', state.mvum ? 'visible' : 'none'); }
    if (k === 'theme') { state.theme = store.get('theme', 'auto'); applyTheme(); }
    if (k === 'myRides') { state.myRides = store.get('myRides', true); applyMyRides(); }
    if (k === 'compass') { state.compass = store.get('compass', true); drawHeading(); }
    if (k === 'keepAwake') { state.keepAwake = store.get('keepAwake', true); void applyWakeLock(); }
    if (k === 'loosePhotos') loosePhotos = store.get('loosePhotos', []);
    if (k === 'activeVehicle') { const id = store.get<string | null>('activeVehicle', null); if (id && community.garage().some(v => v.id === id)) community.setActive(id); }
  }
}
let applyingBackup = false;
const backup = new Backup(community, {
  items() {
    const m = new Map<string, unknown>();
    for (const p of state.pins) m.set(`pin:${p.id}`, p);
    for (const t of state.tracks) if (t.endedAt) m.set(`track:${t.id}`, t); // a ride uploads once it's finished
    for (const k of SYNCED_SETTINGS) { const raw = localStorage.getItem(`traillink.${k}`); if (raw != null) { try { m.set(`setting:${k}`, JSON.parse(raw)); } catch { /* skip */ } } }
    return m;
  },
  photoIds: () => [...state.pins.flatMap(p => p.photos ?? []), ...loosePhotos.map(l => l.id)],
  apply(changes: Change[]) {
    applyingBackup = true;
    try {
      const pins = changes.filter(c => c.kind === 'pin'), tracks = changes.filter(c => c.kind === 'track'), settings = changes.filter(c => c.kind === 'setting');
      if (pins.length) {
        for (const c of pins) { state.pins = state.pins.filter(p => p.id !== c.id); if (c.data) state.pins.push(c.data as Pin); }
        state.pins.sort((a, b) => b.t - a.t); store.savePins(state.pins); drawPins();
      }
      if (tracks.length) {
        for (const c of tracks) { if (state.recording?.id === c.id) continue; state.tracks = state.tracks.filter(t => t.id !== c.id); if (c.data) state.tracks.push(c.data as Track); }
        state.tracks.sort((a, b) => b.startedAt - a.startedAt); store.saveTracks(state.tracks); refreshMyRides();
      }
      for (const c of settings) { if (c.data == null) localStorage.removeItem(`traillink.${c.id}`); else store.set(c.id, c.data); }
      if (settings.length) applySettings(settings.map(c => c.id));
    } finally { applyingBackup = false; }
    if (!state.detail && !typingIn('#pane')) renderPane();
  },
});
store.onSave = k => { if (!applyingBackup && (k === 'pins' || k === 'tracks' || SYNCED_SETTINGS.includes(k))) backup.schedule(); };
backup.onStatus = () => { if (state.tab === 'trails' && !state.detail && !typingIn('#pane')) renderPane(); };
function backupHtml(): string {
  const when = backup.lastAt ? new Date(backup.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const status = backup.state === 'syncing' ? 'Backing up…' : backup.state === 'error' ? "Backup couldn't finish. It will try again." : !navigator.onLine ? 'Offline: backs up when you have signal.' : when ? `Last backed up ${when}.` : 'Not backed up yet.';
  return `<div class="card"><b>Backup</b>
    <p class="quiet">Your pins, recorded rides, photos and settings are saved to your account whenever you have signal: only you can see them. They show up in the Home Screen app, in Safari and on a new phone. ${status}${backup.photosWaiting ? ` ${backup.photosWaiting} photo${backup.photosWaiting === 1 ? '' : 's'} waiting.` : ''}</p>
    <label class="tg"><span>Back up photos<br><span class="quiet">Uses mobile data. Turn off to keep photos on this phone only.</span></span><input type="checkbox" data-set="photoBackup" ${backup.photoBackup ? 'checked' : ''}></label></div>`;
}
let wasSignedIn = false;
function backupOnSignIn() { if (community.signedIn && !wasSignedIn) { backup.schedule(500); setTimeout(maybePendingJoin, 800); } wasSignedIn = community.signedIn; }
setInterval(() => { if (document.visibilityState === 'visible') backup.schedule(0); }, 180_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') backup.schedule(500); });
window.addEventListener('online', () => backup.schedule(1000));

// Invite-only: until this phone has signed in once, show the sign-in screen instead of the app.
function updateGate() { $('#gate').hidden = community.trusted; }
// Background updates re-draw the open tab, except while the rider is typing in it.
const typingIn = (sel: string) => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a as HTMLInputElement).type !== 'checkbox' && !!a.closest(sel); };
community.onChange = () => { updateGate(); backupOnSignIn(); renderMapChat(); updateUnread(); drawHelp(); refreshRiderTrails(); applyRigMarks(); drawRiders(); drawRemotePins(); drawPins(); refreshPopup(); if (['trails', 'garage', 'group', 'pins'].includes(state.tab) && !state.detail && !typingIn('#pane')) renderPane(); };
updateGate();
// Sign-in by emailed code: typed into this TrailLink, so it never jumps to another browser.
let gateEmail = '';
$('#gateform').addEventListener('submit', e => {
  e.preventDefault();
  gateEmail = String(new FormData(e.target as HTMLFormElement).get('email') ?? '').trim();
  const msg = $('#gatemsg');
  msg.textContent = 'Sending…';
  community.sendCode(gateEmail, community.me()?.name ?? '').then(
    () => {
      msg.textContent = `We emailed a 6-digit code to ${gateEmail}. Type it here (don't tap anything in the email).`;
      $('#gateform').hidden = true; $('#gateintro').hidden = true; $('#gatecode').hidden = false;
      $<HTMLInputElement>('#gatecode input').focus();
    },
    (err: Error) => { msg.textContent = err.message; },
  );
});
$('#gatecode').addEventListener('submit', e => {
  e.preventDefault();
  const code = String(new FormData(e.target as HTMLFormElement).get('code') ?? '').replace(/\D/g, '');
  const msg = $('#gatemsg'); msg.textContent = 'Signing in…';
  community.verifyCode(gateEmail, code).then(() => { msg.textContent = ''; updateGate(); toast('Signed in. Welcome to TrailLink!'); },
    () => { msg.textContent = "That code didn't work. Check it, or go back and get a new one."; });
});
$('#gateback').addEventListener('click', () => { $('#gateform').hidden = false; $('#gateintro').hidden = false; $('#gatecode').hidden = true; $('#gatemsg').textContent = ''; });
setInterval(() => { if (document.visibilityState === 'visible') void community.sync(); }, 120_000);
// Group positions: check for updates every 20 seconds while the app is open.
setInterval(() => { if (document.visibilityState === 'visible' && community.group) void community.refreshGroup().then(() => chat.refresh()); }, 20_000);
window.addEventListener('online', () => { void chat.flush(); void chat.refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void chat.refresh(); });
// Opened from a message notification: go to the group.
if (location.hash === '#group') { history.replaceState(null, '', location.pathname); setTimeout(() => setChatOpen(true), 800); }
void community.init().then(() => { updateGate(); void community.refreshGroup().then(() => { void chat.refresh(); void chat.refreshLog(); }); }, updateGate);
setInterval(() => { if (community.group) drawRiders(); }, 60_000); // keep 'x min ago' labels current
// Riders' reports: check every minute while the app is open.
setInterval(() => { if (document.visibilityState === 'visible') void community.fetchSharedPins().then(() => community.onChange()); }, 60_000);
window.addEventListener('online', () => { void community.sync(); });
render();
map.on('load', drawPins);
startGps();
void applyWakeLock();
