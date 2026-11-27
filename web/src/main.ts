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
import { REPORTS, REPORT_TYPES, pinIcon, reportIcon, type ReportType } from './reports.ts';
// Small line icons for compact buttons.
const ico = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  target: ico('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  move: ico('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  camera: ico('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
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
};
// Resume a ride that was recording when the page closed.
const unfinished = state.tracks.find(t => !t.endedAt);
if (unfinished) state.recording = unfinished;

const community = new OnlineCommunity();
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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

function styleFor(id: BaseMapId) { return id === 'street' ? STREET_STYLE_URL : rasterStyle(id); }

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
  if (!map.getSource('track')) map.addSource('track', { type: 'geojson', data: trackGeo() });
  if (!map.getLayer('track')) map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#E8501A', 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  // Group riders who are sharing their location.
  if (!map.getSource('riders')) map.addSource('riders', { type: 'geojson', data: ridersGeo() });
  if (!map.getLayer('riders-dot')) map.addLayer({ id: 'riders-dot', type: 'circle', source: 'riders', paint: {
    'circle-radius': 14, 'circle-color': '#2563EB', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-opacity': ['case', ['get', 'stale'], 0.45, 1], 'circle-stroke-opacity': ['case', ['get', 'stale'], 0.6, 1] } });
  if (!map.getLayer('riders-label')) map.addLayer({ id: 'riders-label', type: 'symbol', source: 'riders',
    layout: { 'text-field': ['get', 'initials'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#fff' } });
  if (!map.getLayer('riders-name')) map.addLayer({ id: 'riders-name', type: 'symbol', source: 'riders',
    layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.9], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': '#1E3A8A', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
}
map.on('style.load', addOverlays);

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
  const r = 14;
  const layers = [...(state.trails ? TRAIL_LAYERS.map(l => l.id) : []), 'rider-trails'].filter(id => map.getLayer(id) && id !== 'trails-labels' && id !== 'trails-casing');
  const hits = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers });
  if (!hits.length) return;
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
      <p class="quiet">Tap any trail for details and to rate it. Sources: Forest Service Motor Vehicle Use Maps and BLM travel plans (legal designations), plus OpenStreetMap (community data, not a legal designation). Covers ${state.trailMeta ? `${state.trailMeta.counts ? Object.values(state.trailMeta.counts).reduce((a, b) => a + b, 0).toLocaleString() : ''} routes in Colorado and Utah, updated ${new Date(state.trailMeta.built).toLocaleDateString()}` : 'Colorado and Utah'}. Always follow posted signs.</p>
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
        ${sw(`<span style="width:34px;display:inline-flex;justify-content:center">${pinIcon('report', 'tree', 24)}</span>`, 'Pin or trail report (tap it for details)')}
        ${sw(`<span style="width:34px;display:inline-flex;justify-content:center"><span class="mpin shared" style="display:inline-block">${pinIcon('report', 'water', 24)}</span></span>`, 'Dashed ring: shared by another rider')}
        ${sw('<span class="mk harder">▲</span>', 'Harder for your rig')}
        ${sw('<span class="mk easier">▼</span>', 'Easier for your rig')}
        ${sw('<span class="lgdot">12</span>', 'Zoomed out: number of trails nearby (tap to zoom in)')}
        ${sw(line('#E8501A'), 'Your recorded ride')}
        ${sw('<span class="lgdot rider">JC</span>', 'Group rider sharing location (faded: not seen for 10+ min)')}
      </div>
      <div class="btns"><button data-panel="layers">Change trail colors</button><button class="primary" data-close>Done</button></div>`;
}
function basemapPanelHtml(): string {
  const areas = savedAreas();
  const d = state.download;
  return `<h3>Base map</h3>
      <div class="seg" role="group" aria-label="Base map">${(Object.keys(BASE_MAPS) as BaseMapId[]).map(id => `<button data-base="${id}" aria-pressed="${state.base === id}">${BASE_MAPS[id].label}</button>`).join('')}</div>
      <h2>Offline maps</h2>
      <p class="quiet">Zoom the map to where you'll ride, then save it while you have signal. Saved areas work with no signal.</p>
      ${d ? `<div class="card"><b>Saving… ${d.done} of ${d.total}</b><div class="bar"><i style="width:${Math.round((d.done / Math.max(1, d.total)) * 100)}%"></i></div><div class="btns"><button data-act="cancel-dl">Cancel</button></div></div>`
          : `<div class="btns"><button class="primary" data-act="save-area">Save the area on screen</button></div>`}
      ${areas.map(a => `<div class="row"><div class="grow"><b>${esc(a.name)}</b><div class="quiet">Zoom ${a.minZ}–${a.maxZ} · ${a.tiles.toLocaleString()} pieces · ${new Date(a.savedAt).toLocaleDateString()}</div></div>
        <button data-showarea="${a.id}">Show</button><button data-forget="${a.id}" aria-label="Remove from list" class="ibtn">${ICONS.x}</button></div>`).join('')}
      <p class="quiet" id="storage"></p>
      ${areas.length ? '<div class="btns"><button data-act="clear-tiles">Delete all saved maps</button></div>' : ''}
      <div class="btns"><button data-close>Done</button></div>`;
}
function panelHtml() { return state.panel === 'layers' ? layersPanelHtml() : state.panel === 'legend' ? legendPanelHtml() : state.panel === 'riders' ? `${groupHtml(true)}<div class="btns"><button class="primary" data-close>Done</button></div>` : basemapPanelHtml(); }
function openPanel(p: 'layers' | 'basemap' | 'legend' | 'riders') { sheet('', 'panel'); state.panel = p; refreshPanel(); }
/** Keep an open panel current (download progress, toggles). */
function refreshPanel() {
  if (!state.panel || $('#sheet').hidden || typingIn('#sheet')) return;
  const body = $('#sheet-body'), top = body.scrollTop;
  body.innerHTML = panelHtml(); body.scrollTop = top; fillStorage();
}
function fillStorage() { if (state.panel === 'basemap') void storageSummary().then(s => { const el = document.getElementById('storage'); if (el) el.textContent = s; }); }

// ---------------------------------------------------------------- garage: your vehicles and their setup
function garageHtml(): string {
  const vs = community.garage(), active = community.activeVehicle();
  return `<h2>Your garage</h2>
    <p class="quiet">Your setup changes how hard a trail feels. Ratings record the rig you rode, and trails show a forecast for yours.</p>
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
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

function ridersGeo(): FeatureCollection {
  const me = community.session?.user.id;
  return { type: 'FeatureCollection', features: community.members.filter(m => m.pos && m.sharing && m.riderId !== me).map(m => {
    const stale = Date.now() - Date.parse(m.pos!.at) > STALE_MIN * 60000;
    return { type: 'Feature', properties: { id: m.riderId, initials: initials(m.name), label: stale ? `${m.name} · ${ago(m.pos!.at)}` : m.name, stale },
      geometry: { type: 'Point', coordinates: [m.pos!.lon, m.pos!.lat] } };
  }) };
}
function drawRiders() { (map.getSource('riders') as GeoJSONSource | undefined)?.setData(ridersGeo()); refreshPanel(); }

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
    ${!me && m.sharing && m.pos ? `<button data-rider="${m.riderId}">Show</button>` : ''}</div>`;
}

function groupHtml(compact: boolean): string {
  if (!community.signedIn) return `<h2>Ride group</h2><p class="quiet">Sign in (Trails tab) to ride with a group.</p>`;
  const g = community.group, err = state.groupError ? `<p class="quiet" style="color:var(--red)">${esc(state.groupError)}</p>` : '';
  if (!g) return `<h2>Ride group</h2>
    <p class="quiet">Start a group for a ride and share its code, or join one. You choose when the group can see your location.</p>
    <form id="groupstart" class="form"><label>Start a group<input name="name" required maxlength="40" placeholder="e.g. Saturday at Taylor Park"></label>
      <div class="btns"><button class="primary" ${state.groupBusy ? 'disabled' : ''}>Start group</button></div></form>
    <form id="groupjoin" class="form"><label>Or join with a code<input name="code" required maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="6-letter code" style="text-transform:uppercase;letter-spacing:3px"></label>
      <div class="btns"><button ${state.groupBusy ? 'disabled' : ''}>Join group</button></div></form>${err}`;
  const me = community.session?.user.id;
  const members = [...community.members].sort((a, b) => (a.riderId === me ? -1 : b.riderId === me ? 1 : a.name.localeCompare(b.name)));
  const sharingCount = members.filter(m => m.sharing).length;
  return `<h2>${esc(g.name)}</h2>
    <div class="row"><div class="grow"><div class="quiet">Join code</div><b class="code">${esc(g.code)}</b></div><button data-act="groupshare">Share code</button></div>
    <label class="tg"><span><b>Share my location</b><br><span class="quiet">${community.sharing ? 'The group can see where you are.' : 'Off: the group can\'t see you.'}</span></span>
      <input type="checkbox" data-set="sharing" ${community.sharing ? 'checked' : ''} ${state.groupBusy ? 'disabled' : ''}></label>
    ${err}
    <p class="quiet" style="margin:12px 0 4px"><b>Riders (${members.length})</b> · ${sharingCount} sharing${community.groupUpdated ? ` · updated ${ago(community.groupUpdated)}` : ''}${navigator.onLine ? '' : ' · no signal'}</p>
    ${members.map(memberRow).join('') || '<p class="quiet">Loading…</p>'}
    <div class="btns">${compact ? '' : '<button data-act="grouprefresh">Refresh</button>'}<button class="danger" data-act="groupleave">Leave group</button></div>
    <p class="quiet">Group messages are coming next.</p>`;
}

async function shareGroupCode() {
  const g = community.group!;
  const text = `Join my TrailLink ride group "${g.name}": open ${APP_URL}, tap the Group tab and enter code ${g.code}.`;
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
    <p class="quiet"><b>${earned} of ${total}</b> badges earned. Ride a badge trail with recording on: cover most of it and the badge is yours. Works with no signal.</p>
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

// ---------------------------------------------------------------- my position
const meEl = document.createElement('div');
meEl.className = 'me';
meEl.innerHTML = '<div class="cone" hidden></div>';
meEl.setAttribute('aria-label', 'Your position');
const meMarker = new maplibregl.Marker({ element: meEl });

function onPosition(p: GeolocationPosition) {
  const c = p.coords;
  state.pos = { lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy), alt: c.altitude ?? undefined, speed: c.speed ?? undefined, heading: c.heading ?? undefined, t: p.timestamp };
  meMarker.setLngLat([c.longitude, c.latitude]);
  if (!meMarker.getElement().isConnected) meMarker.addTo(map);
  const cone = meEl.querySelector<HTMLElement>('.cone')!;
  if (c.heading != null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 1) { cone.hidden = false; cone.style.rotate = `${c.heading}deg`; } else cone.hidden = true;
  if (state.follow) map.easeTo({ center: [c.longitude, c.latitude], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  if (state.recording) {
    const pt: Pt = { lat: c.latitude, lon: c.longitude, t: p.timestamp, alt: c.altitude ?? undefined };
    const last = state.recording.points[state.recording.points.length - 1];
    if (c.accuracy <= 50 && shouldKeep(last, pt)) { state.recording.points.push(pt); persistTracks(); refreshTrack(); }
  }
  renderChips();
  if (state.tab === 'ride') renderPane();
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
    const strobe = (p.kind === 'report' || p.kind === 'hazard') && (p.report ?? 'hazard') === 'hazard';
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
  sheet(`<h3 class="withicon">${REPORT_KINDS.has(p.kind) ? reportIcon(p.report, 36) : ''}${esc(sharedTitle(p))}</h3>
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
    const strobe = REPORT_KINDS.has(p.kind) && (p.report ?? 'hazard') === 'hazard';
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
    <p class="quiet">Tap one to pin it ${state.pos ? 'where you are' : '(waiting for GPS: you can place it on the map)'}.</p>
    ${reportGridHtml('report')}
    <div class="btns"><button data-act2="reportplace">Place on map instead</button><button data-close>Cancel</button></div>`, 'report');
}
/** After a report: quick follow-ups (photo, move) without getting in the way. */
function reported(pin: Pin | null) {
  if (!pin) return;
  if (checkBadges()) return;
  sheet(`<h3 class="withicon">${pin.report ? reportIcon(pin.report, 36) : ''}${esc(pinTitle(pin))} pinned</h3>
    <p class="quiet">Add a photo or a note, or move the pin if it's not quite right.</p>
    <div class="btns">${photoInput(`data-addphoto="${pin.id}"`, `${inl(ICONS.camera)} Add photo`)}<button data-act2="pinnote" data-id="${pin.id}">Add note</button></div>
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
  sheet(`<div data-pinsheet="${pin.id}"><h3 class="withicon">${pin.report ? reportIcon(pin.report, 36) : ''}${esc(pinTitle(pin))}</h3>
    <p class="quiet">${when} · ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}</p>
    ${sharing}
    ${(pin.photos ?? []).map(ph => `<figure class="pinphoto"><img data-photo="${ph}" alt="Pin photo">
      <div class="btns"><button class="small" data-act2="savephoto" data-id="${ph}" data-t="${pin.t}">Save to Photos</button><button class="small" data-act2="unpinphoto" data-pin="${pin.id}" data-id="${ph}">Take off pin</button></div></figure>`).join('') || '<p class="quiet">No photos yet.</p>'}
    <div class="btns">${photoInput(`data-addphoto="${pin.id}"`, `${inl(ICONS.camera)} Add photo`)}<button data-act2="movepin" data-id="${pin.id}">Move pin</button><button class="primary" data-close>Done</button></div></div>`);
  hydratePhotos($('#sheet-body'));
}

// ---------------------------------------------------------------- recording
function persistTracks() { store.saveTracks(state.tracks); }
function startRecording() {
  const t: Track = { id: String(Date.now()), name: `Ride ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, points: [], startedAt: Date.now() };
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
function sheet(html: string, cls = '') {
  const s = $('#sheet'), body = $('#sheet-body');
  state.panel = null;
  body.className = `dialog ${cls}`; body.innerHTML = html; s.hidden = false;
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
      <label class="tg">Keep screen on during the ride <input type="checkbox" data-set="keepAwake" ${state.keepAwake ? 'checked' : ''}></label>
      ${p ? `<p class="quiet">You: ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · ±${p.acc} m</p>` : '<p class="quiet">Waiting for GPS. Step into open sky.</p>'}
      ${pastRides.length ? `<h2>Past rides</h2>${pastRides.slice(0, 20).map(t => { const st = stats(t.points); return `
        <div class="row"><div class="grow"><b>${esc(t.name)}</b><div class="quiet">${st.miles.toFixed(1)} mi · ${st.movingMin} min moving · ${st.gainFt.toLocaleString()} ft climbed</div></div>
        <button data-gpx="${t.id}" aria-label="Export ${esc(t.name)} as GPX">GPX</button></div>`; }).join('')}` : ''}`;
  },
  trails() {
    const mine = community.trails();
    const rides = state.tracks.filter(t => t.endedAt && t.points.length > 1);
    const rated = community.myRatings().size;
    return `
      <h2>Add a trail</h2>
      <p class="quiet">Missing a trail? Draw it on the map, or turn one of your recorded rides into a trail.</p>
      <div class="btns"><button class="primary" data-act="draw">Draw on the map</button>
        ${rides.length ? `<select id="fromride" aria-label="Pick a recorded ride" style="flex:1 1 140px;min-height:48px;border-radius:14px;border:1px solid var(--line);padding:0 10px;background:var(--paper)"><option value="">From a recorded ride…</option>${rides.slice(0, 30).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>` : ''}</div>
      <h2>Your trails</h2>
      ${mine.length ? mine.map(t => { const l = levelOf(t.difficulty); return `<div class="row"><span class="dchip" style="--c:${l.color}">${t.difficulty}</span><div class="grow"><b>${esc(t.name)}</b><div class="quiet">${lengthMiles(t.coords).toFixed(1)} mi · by ${esc(t.createdBy)} · ${new Date(t.createdAt).toLocaleDateString()}</div></div>
        <button data-showtrail="${t.id}">Show</button><button data-deltrail="${t.id}" aria-label="Delete ${esc(t.name)}" class="ibtn">${ICONS.x}</button></div>`; }).join('') : '<p class="quiet">None yet.</p>'}
      <h2>Your ratings</h2>
      <p class="quiet">${rated ? `You've rated ${rated} trail${rated === 1 ? '' : 's'}.` : 'Tap any trail on the map and choose "Rate difficulty".'}</p>
      ${accountHtml()}`;
  },
  badges() { return badgesHtml(); },
  garage() {
    return `${garageHtml()}
      <h2>How the forecast works</h2>
      <p class="quiet">Each rating saves the vehicle it was ridden in. For your rig, TrailLink starts from the riders' rating and adjusts it by how their vehicles compare to yours: a trail rated 7 in stock rigs may be a 4 in a full build, and the reverse.</p>
      <p class="quiet">Rig score: tires and lift count most, then lockers, then skid plates and rock sliders. A winch helps you recover, not climb, so it doesn't change the score.</p>
      <p class="quiet">See it on the map: tap the layers button on the map, then Color trails by › Difficulty: my rig. The ▲ harder / ▼ easier markers can be turned on there too.</p>`;
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
      <p class="quiet">Positions update when a phone has cell signal. Out of range, the map shows each rider's last known spot and how long ago it was. Agree on a Regroup point (Pins tab) before you split up.</p>`;
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
  if (b.dataset.colorby) { state.colorBy = b.dataset.colorby as ColorBy; store.set('colorBy', state.colorBy); applyColorBy(); renderPane(); }
  if (act === 'draw') startDrawing();
  if (act === 'addvehicle') vehicleForm();
  if (b.dataset.badge) badgeSheet(b.dataset.badge);
  if (act === 'checkrides') { const got = checkBadges(state.tracks.filter(t => t.endedAt && t.points.length > 1), true); if (!got) toast('Checked your rides. No new badges yet.'); }
  if (act === 'groupshare' && community.group) void shareGroupCode();
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
  if (act === 'sync') { void community.sync(); void backup.run(); }
  if (act === 'signout') void community.signOut().then(() => { state.signin = null; renderPane(); });
  if (act === 'signin-back') { state.signin = state.signin ? { ...state.signin, sent: false, error: undefined } : null; renderPane(); }
  if (act === 'rename') sheet(`<h3>Your name</h3><form id="renameform" class="form"><label>Shown as "created by" on your trails<input name="name" required maxlength="40" value="${esc(community.me()?.name ?? '')}"></label><div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
  if (b.dataset.showtrail) { const t = community.trails().find(x => x.id === b.dataset.showtrail); if (t) { state.follow = false; const xs = t.coords.map(c => c[0]), ys = t.coords.map(c => c[1]); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 15 }); } }
  if (b.dataset.deltrail) { const t = community.trails().find(x => x.id === b.dataset.deltrail); if (t) sheet(`<h3>Delete ${esc(t.name)}?</h3><p>This removes the trail from this phone.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="deltrail" data-id="${t.id}">Delete</button></div>`); }
  if (b.dataset.gpx) downloadGpx(b.dataset.gpx);
  if (b.dataset.delpin) { const pin = state.pins.find(p => p.id === b.dataset.delpin); if (pin) { removePin(pin.id); if (pin.photos?.length) toast(`Pin deleted. Its photo${pin.photos.length === 1 ? ' is' : 's are'} kept under "Photos from deleted pins".`); } }
  if (b.dataset.openpin) pinSheet(b.dataset.openpin);
  if (b.dataset.movepin) { const pin = state.pins.find(p => p.id === b.dataset.movepin); if (pin) startPlacing({ mode: 'move', pinId: pin.id }, [pin.lon, pin.lat]); }
  if (act === 'report') openReport();
  if (act === 'placepin') startPlacing({ mode: 'new' });
  if (b.dataset.loose) looseSheet(b.dataset.loose);
  if (b.dataset.shared) remotePinSheet(b.dataset.shared);
  if (b.dataset.goto) { const p = state.pins.find(x => x.id === b.dataset.goto); if (p) { state.follow = false; map.flyTo({ center: [p.lon, p.lat], zoom: 15 }); } }
  if (b.dataset.forget) { forgetArea(b.dataset.forget); renderPane(); }
  if (b.dataset.showarea) { const a = savedAreas().find(x => x.id === b.dataset.showarea); if (a) { state.follow = false; closeSheet(); map.fitBounds([[a.bounds.w, a.bounds.s], [a.bounds.e, a.bounds.n]]); } }
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
  if (t.dataset.set === 'keepAwake') { state.keepAwake = t.checked; store.set('keepAwake', t.checked); void applyWakeLock(); }
}
$('#pane').addEventListener('change', paneChange);
$('#sheet').addEventListener('change', e => { if (state.panel) paneChange(e); });
$('#pane').addEventListener('submit', e => {
  e.preventDefault();
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
    closeSheet();
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
  if (b.dataset.act2 === 'deltrail' && b.dataset.id) { void community.deleteTrail(b.dataset.id).then(() => { closeSheet(); popup.remove(); refreshRiderTrails(); renderPane(); }); return; }
  if (b.dataset.act2 === 'seebadges') { closeSheet(); state.tab = 'badges'; setPanel(true); render(); $('#pane').scrollTop = 0; return; }
  if (b.dataset.act2 === 'badgemap' && b.dataset.id) { const t = community.badgeTrails.find(x => x.id === b.dataset.id); if (t) { const bb = badgeBbox(t.geom); closeSheet(); state.follow = false; map.fitBounds([[bb.w, bb.s], [bb.e, bb.n]], { padding: 50 }); } return; }
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
  if (b.dataset.act2 === 'pinnote' && b.dataset.id) { const pin = state.pins.find(p => p.id === b.dataset.id); if (pin) sheet(`<h3>Add a note</h3><form id="pinnoteform" data-id="${pin.id}" class="form"><label>Note<input name="note" maxlength="60" value="${esc(pin.note ?? '')}" placeholder="e.g. Big pine across the trail, go around left"></label><div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`); return; }
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
    <p>This spot is saved as an "Emergency" pin.</p>
    <div class="btns"><button data-close>Close</button></div>`, 'sos');
  if (p) { state.pins.unshift({ id: String(Date.now()), kind: 'hazard', lat: p.lat, lon: p.lon, t: Date.now(), note: 'Emergency' }); store.savePins(state.pins); drawPins(); }
}

window.addEventListener('online', () => { state.online = true; renderChips(); });
window.addEventListener('offline', () => { state.online = false; renderChips(); });

// ---------------------------------------------------------------- start
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
$('#btn-center').classList.add('active');
// Test hook: open the app with #debug to reach the map from automated browser tests.
if (location.hash === '#debug') Object.assign(window, { tl: { map, community, state } });
// ---------------------------------------------------------------- account backup (pins, rides, settings, photos)
// Settings that follow the rider between phones (map position, panel and install prompts stay per phone).
const SYNCED_SETTINGS = ['base', 'trails', 'colorBy', 'rigMarks', 'mvumImage', 'keepAwake', 'shareNewPins', 'loosePhotos', 'groupRides', 'photoBackup', 'activeVehicle'];
function applySettings(keys: string[]) {
  for (const k of keys) {
    if (k === 'base') { const b = store.get<BaseMapId>('base', 'topo'); if (b !== state.base && b in BASE_MAPS) setBase(b); }
    if (k === 'colorBy') { state.colorBy = store.get<ColorBy>('colorBy', 'access'); applyColorBy(); }
    if (k === 'trails') { state.trails = store.get('trails', true); for (const l of [...TRAIL_LAYERS, ...OVERVIEW_LAYERS]) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', state.trails ? 'visible' : 'none'); }
    if (k === 'rigMarks') { state.rigMarks = store.get('rigMarks', true); applyRigMarks(); }
    if (k === 'mvumImage') { state.mvum = store.get('mvumImage', false); if (map.getLayer('mvum')) map.setLayoutProperty('mvum', 'visibility', state.mvum ? 'visible' : 'none'); }
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
        state.tracks.sort((a, b) => b.startedAt - a.startedAt); store.saveTracks(state.tracks);
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
function backupOnSignIn() { if (community.signedIn && !wasSignedIn) backup.schedule(500); wasSignedIn = community.signedIn; }
setInterval(() => { if (document.visibilityState === 'visible') backup.schedule(0); }, 180_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') backup.schedule(500); });
window.addEventListener('online', () => backup.schedule(1000));

// Invite-only: until this phone has signed in once, show the sign-in screen instead of the app.
function updateGate() { $('#gate').hidden = community.trusted; }
// Background updates re-draw the open tab, except while the rider is typing in it.
const typingIn = (sel: string) => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a as HTMLInputElement).type !== 'checkbox' && !!a.closest(sel); };
community.onChange = () => { updateGate(); backupOnSignIn(); refreshRiderTrails(); applyRigMarks(); drawRiders(); drawRemotePins(); drawPins(); refreshPopup(); if (['trails', 'garage', 'group', 'pins'].includes(state.tab) && !state.detail && !typingIn('#pane')) renderPane(); };
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
setInterval(() => { if (document.visibilityState === 'visible' && community.group) void community.refreshGroup(); }, 20_000);
void community.init().then(() => { updateGate(); void community.refreshGroup(); }, updateGate);
setInterval(() => { if (community.group) drawRiders(); }, 60_000); // keep 'x min ago' labels current
// Riders' reports: check every minute while the app is open.
setInterval(() => { if (document.visibilityState === 'visible') void community.fetchSharedPins().then(() => community.onChange()); }, 60_000);
window.addEventListener('online', () => { void community.sync(); });
render();
map.on('load', drawPins);
startGps();
void applyWakeLock();
