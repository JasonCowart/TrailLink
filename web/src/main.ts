// TrailLink web app.
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Point } from 'geojson';
import './styles.css';
import { BASE_MAPS, MVUM_TILES, STREET_STYLE_URL, TRAIL_MAXZOOM, TRAIL_TILES, rasterStyle, type BaseMapId } from './maps.ts';
import { COLORED_LAYERS, OVERVIEW_LAYERS, TRAIL_LAYERS, difficultyLegendHtml, legendHtml, rateSheetHtml, ratingHtml, rigMarkerImage, rigMarkerLayers, trailColor, trailPopupHtml, type ColorBy, type RatingInfo } from './trails.ts';
import { LIFTS, LOCKERS, TIRE_SIZES, WIDTHS, bandShift, forecast, rigClass, rigScore, vehicleSummary, vehicleTitle, type Vehicle } from './garage.ts';
import { VEHICLE_FIT, lengthMiles, levelOf, LEVELS, stepColor, type RiderTrail, type VehicleFit } from './community.ts';
import { OnlineCommunity, type AdminRider, type GroupMember } from './online.ts';
import { askToKeepStorage, clearAllTiles, downloadArea, forgetArea, planDownload, savedAreas, storageSummary } from './offline.ts';
import { shouldKeep, stats, store, toGpx, type Pin, type Pt, type Track } from './track.ts';
import { bearingDeg, compass, distanceM } from '../../src/core/geo.ts';

// ---------------------------------------------------------------- state
type Tab = 'ride' | 'trails' | 'garage' | 'pins' | 'group';
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
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

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
    if (t) return riderTrailHtml(t);
  }
  return trailPopupHtml(p, ratingInfo(p.tid));
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
    state.detail = true;
    tapMarker.setLngLat(e.lngLat).addTo(map);
    renderPane();
    $('#pane').scrollTop = 0;
  } else {
    popup.setLngLat(e.lngLat).setHTML(popupHtml(popupProps)).addTo(map);
  }
});
// Buttons inside the popup.
for (const el of ['#map', '#pane']) $(el).addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rate], button[data-closedetail], button[data-confirm], button[data-act="garage"]'); if (!b) return;
  if (b.dataset.act === 'garage') { popup.remove(); if (state.detail) { state.detail = false; tapMarker.remove(); } state.tab = 'garage'; render(); $('#pane').scrollTop = 0; return; }
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
    : `<p class="quiet">Rode it in your <b>${esc(v.nickname)}</b> (${rigClass(rigScore(v)).toLowerCase()}, ${rigScore(v)}/10).</p>`;
  sheet(rateSheetHtml(tid, title, community.myRatings().get(tid), rigLine));
}
async function vote(tid: string, n: number | null) {
  if (n == null) await community.clearRating(tid); else await community.rate(tid, n);
  const target = tid.startsWith('RIDER:') ? { source: 'rider-trails', id: tid } : { source: 'trails', sourceLayer: 'trails', id: tid };
  map.setFeatureState(target, { mine: n, comm: community.scores().get(tid)?.avg ?? null });
  closeSheet(); refreshPopup();
  const rode = community.activeVehicle();
  toast(n == null ? 'Rating removed.' : `Rated ${n} (${levelOf(n).band})${rode ? ` in your ${rode.nickname}` : ''}.${state.colorBy === 'access' ? ' Use the layers button to color trails by difficulty.' : ''}`);
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
      ${community.isAdmin ? '<div class="btns"><button data-act="admin">Manage riders (admin)</button></div>' : ''}</div>`;
  }
  const si = state.signin;
  return `<h2>Share with other riders</h2>
    <p class="quiet">Sign in to share your trails and ratings and see everyone else's. No password: we email you a sign-in link.${pending ? ` ${pending} change${pending === 1 ? '' : 's'} on this phone will upload when you sign in.` : ''}</p>
    ${si?.sent ? `<form id="codeform" class="form">
        <p><b>Check your email (${esc(si.email)})</b> and tap the sign-in link. It opens TrailLink signed in.</p>
        <label>Or, if the email shows a code, enter it here<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required placeholder="6-digit code"></label>
        ${si.error ? `<p class="quiet" style="color:var(--red)">${esc(si.error)}</p>` : ''}
        <div class="btns"><button type="button" data-act="signin-back">Back</button><button class="primary" ${si.busy ? 'disabled' : ''}>Sign in</button></div>
        <p class="quiet">On iPhone, the link signs in TrailLink in Safari. The home-screen app signs in separately.</p>
      </form>`
    : `<form id="signinform" class="form">
        <label>Your name (shown as "created by")<input name="name" required maxlength="40" value="${esc(community.me()?.name ?? '')}" placeholder="e.g. Jason"></label>
        <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(si?.email ?? '')}" placeholder="you@example.com"></label>
        ${si?.error ? `<p class="quiet" style="color:var(--red)">${esc(si.error)}</p>` : ''}
        <div class="btns"><button class="primary" ${si?.busy ? 'disabled' : ''}>Email me a sign-in link</button></div>
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
        <button data-showarea="${a.id}">Show</button><button data-forget="${a.id}" aria-label="Remove from list">✕</button></div>`).join('')}
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
      <button class="vhead" data-togglevehicle="${v.id}" aria-expanded="${open}"><b>${esc(v.nickname)}</b>${on ? ' <span class="tag">Riding</span>' : ''}<span class="chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>
      ${open ? `<div class="vbody">
        ${vehicleTitle(v) !== v.nickname ? `<div><b>${esc(vehicleTitle(v).slice(v.nickname.length + 3))}</b></div>` : ''}
        <div class="quiet">${esc(vehicleSummary(v))}</div>
        <div class="quiet"><b>${rigClass(sc)}</b> · rig score ${sc}/10</div>
        <div class="btns">${on || vs.length < 2 ? '' : `<button data-ridevehicle="${v.id}">Ride this</button>`}<button data-editvehicle="${v.id}">Edit</button><button data-delvehicle="${v.id}">Remove</button></div>
      </div>` : ''}</div>`; }).join('')}
    <div class="btns"><button class="${vs.length ? '' : 'primary'}" data-act="addvehicle">Add a vehicle</button></div>`;
}

function vehicleForm(v?: Vehicle) {
  const opt = <T,>(items: { v: T; label: string }[], cur: T) => items.map(i => `<option value="${i.v}" ${i.v === cur ? 'selected' : ''}>${i.label}</option>`).join('');
  const x: Vehicle = v ?? { id: '', nickname: '', make: '', model: '', widthIn: 64, tireIn: 28, liftIn: 0, lockers: 'none', winch: false, skids: false, sliders: false, updatedAt: '' };
  sheet(`<h3>${v ? `Edit ${esc(v.nickname)}` : 'Add a vehicle'}</h3>
    <form id="vehicleform" class="form">
      ${v ? `<input type="hidden" name="id" value="${v.id}">` : ''}
      <label>Nickname<input name="nickname" required maxlength="40" value="${esc(x.nickname)}" placeholder="e.g. The Turbo"></label>
      <div class="cols3">
        <label>Year<input name="year" inputmode="numeric" maxlength="4" pattern="(19|20)[0-9]{2}" value="${x.year ?? ''}" placeholder="2024"></label>
        <label>Make<input name="make" maxlength="40" value="${esc(x.make)}" placeholder="Polaris"></label>
        <label>Model<input name="model" maxlength="60" value="${esc(x.model)}" placeholder="RZR Pro R"></label>
      </div>
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
    id: String(f.get('id') ?? '') || undefined, nickname: String(f.get('nickname') ?? '').trim() || 'My rig',
    make: String(f.get('make') ?? '').trim(), model: String(f.get('model') ?? '').trim(), year: year >= 1980 && year <= 2100 ? year : undefined,
    widthIn: Number(f.get('widthIn')) as Vehicle['widthIn'], tireIn: Number(f.get('tireIn')), liftIn: Number(f.get('liftIn')),
    lockers: f.get('lockers') as Vehicle['lockers'], winch: f.has('winch'), skids: f.has('skids'), sliders: f.has('sliders'),
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
      ${btns}${me ? '' : `<button data-removerider="${esc(r.email)}" aria-label="Remove ${esc(r.display_name ?? r.email)}">✕</button>`}</div>`;
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
    if (pinMarkers.has(p.id)) continue;
    const el = document.createElement('div');
    el.className = `pin ${p.kind}`;
    el.textContent = p.note || ({ regroup: 'Regroup', hazard: 'Hazard', note: 'Note' } as const)[p.kind];
    pinMarkers.set(p.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}
function addPin(kind: Pin['kind'], note?: string) {
  if (!state.pos) { toast('Waiting for a GPS fix.'); return; }
  state.pins.unshift({ id: String(Date.now()), kind, lat: state.pos.lat, lon: state.pos.lon, t: Date.now(), note: note?.trim() || undefined });
  store.savePins(state.pins); drawPins(); renderPane();
  toast(`${kind === 'regroup' ? 'Regroup point' : kind === 'hazard' ? 'Hazard' : 'Note'} saved here`);
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
  state.recording = null; persistTracks(); refreshTrack(); render();
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
    `<span class="chip ${state.online ? 'on' : ''}">${state.online ? 'Online' : 'Offline'}</span>`,
    `<span class="chip">${p ? `GPS ±${p.acc} m` : 'GPS…'}</span>`,
    state.recording ? '<span class="chip rec">Recording</span>' : '',
  ].join('');
  $('#subtitle').textContent = state.recording ? state.recording.name : 'Trail map';
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
        <button data-showtrail="${t.id}">Show</button><button data-deltrail="${t.id}" aria-label="Delete ${esc(t.name)}">✕</button></div>`; }).join('') : '<p class="quiet">None yet.</p>'}
      <h2>Your ratings</h2>
      <p class="quiet">${rated ? `You've rated ${rated} trail${rated === 1 ? '' : 's'}.` : 'Tap any trail on the map and choose "Rate difficulty".'}</p>
      ${accountHtml()}`;
  },
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
      <div class="btns"><button class="primary" data-act="regroup">Regroup</button><button class="danger" data-act="hazard">Hazard</button><button data-act="note">Note…</button></div>
      ${state.pins.length ? state.pins.map(pin => {
        const d = p ? `${(distanceM(p, pin) / 1609.344).toFixed(1)} mi ${compass(bearingDeg(p, pin))}` : '';
        return `<div class="row"><div class="grow"><b>${esc(pin.note || ({ regroup: 'Regroup point', hazard: 'Hazard', note: 'Note' } as const)[pin.kind])}</b><div class="quiet">${d}${d ? ' · ' : ''}${new Date(pin.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
          <button data-goto="${pin.id}" aria-label="Show on map">Show</button><button data-delpin="${pin.id}" aria-label="Delete pin">✕</button></div>`;
      }).join('') : '<p class="quiet">No pins yet. Pins stay on this phone and work offline.</p>'}`;
  },
  group() {
    return `${community.isAdmin && community.signedIn ? adminHtml() : ''}
      ${groupHtml(false)}
      <p class="quiet">Positions update when a phone has cell signal. Out of range, the map shows each rider's last known spot and how long ago it was. Agree on a Regroup point (Pins tab) before you split up.</p>`;
  },
};

function renderPane() {
  const pane = $('#pane');
  const scroll = pane.scrollTop;
  if (state.detail && popupProps) {
    pane.innerHTML = `<div class="detail">${popupHtml(popupProps)}<div class="btns"><button data-closedetail>Close</button></div></div>`;
    return;
  }
  pane.innerHTML = views[state.tab]();
  pane.scrollTop = scroll;
  refreshPanel();
}
function render() {
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  renderChips(); renderPane();
}

$('#tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]'); if (b) { state.tab = b.dataset.tab as Tab; if (state.detail) { state.detail = false; tapMarker.remove(); } render(); } });

function paneClick(e: Event) {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return;
  if (b.dataset.panel) { openPanel(b.dataset.panel as 'layers' | 'legend'); return; }
  const act = b.dataset.act;
  if (act === 'record') startRecording();
  else if (act === 'stop') stopRecording();
  else if (act === 'regroup') addPin('regroup');
  else if (act === 'hazard') addPin('hazard');
  else if (act === 'note') sheet(`<h3>Add a note here</h3><form id="noteform"><input id="notetext" maxlength="60" placeholder="e.g. Water crossing, go slow" style="width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:16px"><div class="btns"><button class="primary">Save note</button><button type="button" data-close>Cancel</button></div></form>`);
  else if (act === 'save-area') void saveVisibleArea();
  else if (act === 'cancel-dl') state.download?.ctrl.abort();
  else if (act === 'clear-tiles') sheet(`<h3>Delete all saved maps?</h3><p>You'll need signal to see maps until you save areas again.</p><div class="btns"><button class="danger" data-act2="confirm-clear">Delete</button><button data-close>Keep them</button></div>`);
  if (b.dataset.base) setBase(b.dataset.base as BaseMapId);
  if (b.dataset.colorby) { state.colorBy = b.dataset.colorby as ColorBy; store.set('colorBy', state.colorBy); applyColorBy(); renderPane(); }
  if (act === 'draw') startDrawing();
  if (act === 'addvehicle') vehicleForm();
  if (act === 'groupshare' && community.group) void shareGroupCode();
  if (act === 'groupleave' && community.group) sheet(`<h3>Leave ${esc(community.group.name)}?</h3><p>The group won't see you anymore. You can rejoin with the code.</p><div class="btns"><button data-close>Stay</button><button class="danger" data-act2="leavegroup">Leave</button></div>`);
  if (act === 'grouprefresh') void community.refreshGroup();
  if (b.dataset.rider) { const m = community.members.find(x => x.riderId === b.dataset.rider); if (m?.pos) { state.follow = false; if (state.panel) closeSheet(); map.flyTo({ center: [m.pos.lon, m.pos.lat], zoom: Math.max(map.getZoom(), 14) }); } }
  if (b.dataset.togglevehicle) { const id = b.dataset.togglevehicle, o = state.openVehicles; if (o.has(id)) o.delete(id); else o.add(id); renderPane(); }
  if (b.dataset.editvehicle) vehicleForm(community.garage().find(v => v.id === b.dataset.editvehicle));
  if (b.dataset.ridevehicle) { community.setActive(b.dataset.ridevehicle); afterGarageChange(); toast(`Riding the ${community.activeVehicle()?.nickname}. Forecasts updated.`); }
  if (b.dataset.delvehicle) { const v = community.garage().find(x => x.id === b.dataset.delvehicle); if (v) sheet(`<h3>Remove ${esc(v.nickname)}?</h3><p>Ratings you gave in it keep its setup.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="delvehicle" data-id="${v.id}">Remove</button></div>`); }
  if (act === 'admin') { state.tab = 'group'; render(); }
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
  if (act === 'sync') void community.sync();
  if (act === 'signout') void community.signOut().then(() => { state.signin = null; renderPane(); });
  if (act === 'signin-back') { state.signin = state.signin ? { ...state.signin, sent: false, error: undefined } : null; renderPane(); }
  if (act === 'rename') sheet(`<h3>Your name</h3><form id="renameform" class="form"><label>Shown as "created by" on your trails<input name="name" required maxlength="40" value="${esc(community.me()?.name ?? '')}"></label><div class="btns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
  if (b.dataset.showtrail) { const t = community.trails().find(x => x.id === b.dataset.showtrail); if (t) { state.follow = false; const xs = t.coords.map(c => c[0]), ys = t.coords.map(c => c[1]); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 15 }); } }
  if (b.dataset.deltrail) { const t = community.trails().find(x => x.id === b.dataset.deltrail); if (t) sheet(`<h3>Delete ${esc(t.name)}?</h3><p>This removes the trail from this phone.</p><div class="btns"><button data-close>Keep it</button><button class="danger" data-act2="deltrail" data-id="${t.id}">Delete</button></div>`); }
  if (b.dataset.gpx) downloadGpx(b.dataset.gpx);
  if (b.dataset.delpin) { state.pins = state.pins.filter(p => p.id !== b.dataset.delpin); store.savePins(state.pins); drawPins(); renderPane(); }
  if (b.dataset.goto) { const p = state.pins.find(x => x.id === b.dataset.goto); if (p) { state.follow = false; map.flyTo({ center: [p.lon, p.lat], zoom: 15 }); } }
  if (b.dataset.forget) { forgetArea(b.dataset.forget); renderPane(); }
  if (b.dataset.showarea) { const a = savedAreas().find(x => x.id === b.dataset.showarea); if (a) { state.follow = false; closeSheet(); map.fitBounds([[a.bounds.w, a.bounds.s], [a.bounds.e, a.bounds.n]]); } }
}
$('#pane').addEventListener('click', paneClick);
$('#sheet').addEventListener('click', e => { if (state.panel) paneClick(e); });
function paneChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.dataset.set === 'sharing') {
    const on = t.checked; state.groupBusy = true; state.groupError = '';
    community.setSharing(on).then(() => { toast(on ? 'Sharing your location with the group.' : 'Stopped sharing. Your location was removed from the group.'); lastShare = 0; maybeSharePosition(); },
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
    community.verifyCode(si.email, String(f.get('code') ?? '')).then(() => { state.signin = null; toast('Signed in. Your trails and ratings are now shared.'); renderPane(); })
      .catch((err: Error) => { state.signin = { ...si, busy: false, error: err.message }; renderPane(); });
  }
});
$('#sheet').addEventListener('change', e => {
  const t = e.target as HTMLSelectElement;
  if (t.id === 'ratevehicle') { community.setActive(t.value); afterGarageChange(); }
  if (t.closest('#vehicleform')) updateRigPreview();
});
$('#sheet').addEventListener('input', e => { if ((e.target as HTMLElement).closest('#vehicleform')) updateRigPreview(); });
$('#sheet').addEventListener('submit', e => {
  e.preventDefault();
  if (groupSubmit(e.target as HTMLFormElement)) return;
  if ((e.target as HTMLElement).id === 'renameform') { community.setName(String(new FormData(e.target as HTMLFormElement).get('name') ?? '')); closeSheet(); void community.sync(); renderPane(); }
  if ((e.target as HTMLElement).id === 'vehicleform') {
    const f = new FormData(e.target as HTMLFormElement);
    const v = community.saveVehicle(vehicleFromForm(f));
    closeSheet(); afterGarageChange(); toast(`Saved ${v.nickname}: ${rigClass(rigScore(v)).toLowerCase()} (${rigScore(v)}/10).`);
  }
  if ((e.target as HTMLElement).id === 'noteform') { addPin('note', $<HTMLInputElement>('#notetext').value); closeSheet(); }
  if ((e.target as HTMLElement).id === 'trailform' && pendingCoords) {
    const f = new FormData(e.target as HTMLFormElement);
    community.setName(String(f.get('by') ?? ''));
    void community.addTrail({
      name: String(f.get('name')).trim(), difficulty: Number(f.get('difficulty')), vehicles: f.get('vehicles') as VehicleFit,
      notes: String(f.get('notes') ?? '').trim() || undefined, coords: pendingCoords,
    }).then(t => { pendingCoords = null; closeSheet(); refreshRiderTrails(); renderPane(); toast(`Saved "${t.name}".`); });
  }
});
$('#sheet').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act2], button[data-vote], button[data-unvote]'); if (!b) return;
  if (b.dataset.unvote) { void vote(b.dataset.unvote, null); return; }
  if (b.dataset.vote && b.dataset.tid) { void vote(b.dataset.tid, Number(b.dataset.vote)); return; }
  if (b.dataset.act2 === 'deltrail' && b.dataset.id) { void community.deleteTrail(b.dataset.id).then(() => { closeSheet(); popup.remove(); refreshRiderTrails(); renderPane(); }); return; }
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
// Invite-only: until this phone has signed in once, show the sign-in screen instead of the app.
function updateGate() { $('#gate').hidden = community.trusted; }
// Background updates re-draw the open tab, except while the rider is typing in it.
const typingIn = (sel: string) => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a as HTMLInputElement).type !== 'checkbox' && !!a.closest(sel); };
community.onChange = () => { updateGate(); refreshRiderTrails(); applyRigMarks(); drawRiders(); refreshPopup(); if (['trails', 'garage', 'group'].includes(state.tab) && !state.detail && !typingIn('#pane')) renderPane(); };
updateGate();
$('#gateform').addEventListener('submit', e => {
  e.preventDefault();
  const email = String(new FormData(e.target as HTMLFormElement).get('email') ?? '').trim();
  const msg = $('#gatemsg');
  msg.textContent = 'Sending…';
  community.sendCode(email, community.me()?.name ?? '').then(
    () => { msg.textContent = `Check ${email} and tap the sign-in link. It opens TrailLink signed in.`; },
    (err: Error) => { msg.textContent = err.message; },
  );
});
setInterval(() => { if (document.visibilityState === 'visible') void community.sync(); }, 120_000);
// Group positions: check for updates every 20 seconds while the app is open.
setInterval(() => { if (document.visibilityState === 'visible' && community.group) void community.refreshGroup(); }, 20_000);
void community.init().then(() => { updateGate(); void community.refreshGroup(); }, updateGate);
setInterval(() => { if (community.group) drawRiders(); }, 60_000); // keep 'x min ago' labels current
window.addEventListener('online', () => { void community.sync(); });
render();
map.on('load', drawPins);
startGps();
void applyWakeLock();
