// TrailLink web app.
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import './styles.css';
import { BASE_MAPS, MVUM_TILES, STREET_STYLE_URL, TRAIL_MAXZOOM, TRAIL_TILES, rasterStyle, type BaseMapId } from './maps.ts';
import { TRAIL_LAYERS, trailPopupHtml, legendHtml } from './trails.ts';
import { askToKeepStorage, clearAllTiles, downloadArea, forgetArea, planDownload, savedAreas, storageSummary } from './offline.ts';
import { shouldKeep, stats, store, toGpx, type Pin, type Pt, type Track } from './track.ts';
import { bearingDeg, compass, distanceM } from '../../src/core/geo.ts';

// ---------------------------------------------------------------- state
type Tab = 'ride' | 'pins' | 'maps' | 'group';
const state = {
  tab: 'ride' as Tab,
  base: store.get<BaseMapId>('base', 'topo'),
  mvum: store.get('mvumImage', false),
  trails: store.get('trails', true),
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
  if (!map.getSource('trails')) map.addSource('trails', { type: 'vector', tiles: [TRAIL_TILES], minzoom: 5, maxzoom: TRAIL_MAXZOOM, attribution: 'USDA Forest Service MVUM, BLM GTLF, © OpenStreetMap contributors' });
  for (const l of TRAIL_LAYERS) if (!map.getLayer(l.id)) map.addLayer({ ...l, layout: { ...(l.layout ?? {}), visibility: state.trails ? 'visible' : 'none' } } as maplibregl.LayerSpecification);
  if (!map.getSource('mvum')) map.addSource('mvum', { type: 'raster', tiles: [MVUM_TILES], tileSize: 256, minzoom: 7, maxzoom: 17, attribution: 'USDA Forest Service MVUM' });
  if (!map.getLayer('mvum')) map.addLayer({ id: 'mvum', type: 'raster', source: 'mvum', paint: { 'raster-opacity': 0.9 }, layout: { visibility: state.mvum ? 'visible' : 'none' } });
  if (!map.getSource('track')) map.addSource('track', { type: 'geojson', data: trackGeo() });
  if (!map.getLayer('track')) map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#E8501A', 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
}
map.on('style.load', addOverlays);

// Tap a trail to see who manages it, which vehicles may use it, and when. A generous tap area for gloves.
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'trail-popup' });
map.on('click', e => {
  if (!state.trails) return;
  const r = 14;
  const hits = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: TRAIL_LAYERS.map(l => l.id).filter(id => map.getLayer(id)) });
  if (!hits.length) return;
  // Prefer agency data over OpenStreetMap when both are under the finger.
  const best = hits.sort((a, b) => Number(a.properties.src === 'OSM') - Number(b.properties.src === 'OSM'))[0];
  state.follow = false;
  popup.setLngLat(e.lngLat).setHTML(trailPopupHtml(best.properties as Record<string, string>)).addTo(map);
});
map.on('mousemove', e => {
  if (!state.trails) return;
  const hit = map.queryRenderedFeatures(e.point, { layers: TRAIL_LAYERS.map(l => l.id).filter(id => map.getLayer(id)) }).length;
  map.getCanvas().style.cursor = hit ? 'pointer' : '';
});
fetch(TRAIL_TILES.replace('{z}/{x}/{y}.pbf', 'meta.json')).then(r => (r.ok ? r.json() : null)).then(m => { state.trailMeta = m; if (state.tab === 'maps') renderPane(); }).catch(() => {});
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
      if (state.tab === 'maps') renderPane();
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
  body.className = `dialog ${cls}`; body.innerHTML = html; s.hidden = false;
  body.querySelector<HTMLElement>('button')?.focus();
}
function closeSheet() { $('#sheet').hidden = true; }
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
  maps() {
    const areas = savedAreas();
    const d = state.download;
    return `
      <h2>Base map</h2>
      <div class="seg" role="group" aria-label="Base map">${(Object.keys(BASE_MAPS) as BaseMapId[]).map(id => `<button data-base="${id}" aria-pressed="${state.base === id}">${BASE_MAPS[id].label}</button>`).join('')}</div>
      <label class="tg">OHV trails and roads <input type="checkbox" data-set="trails" ${state.trails ? 'checked' : ''}></label>
      ${legendHtml()}
      <p class="quiet">Tap any trail for details. Sources: Forest Service Motor Vehicle Use Maps and BLM travel plans (legal designations), plus OpenStreetMap (community data, not a legal designation). Covers ${state.trailMeta ? `${state.trailMeta.counts ? Object.values(state.trailMeta.counts).reduce((a, b) => a + b, 0).toLocaleString() : ''} routes in Colorado and Utah, updated ${new Date(state.trailMeta.built).toLocaleDateString()}` : 'Colorado and Utah'}. Always follow posted signs.</p>
      <label class="tg">Forest Service map image (official MVUM drawing) <input type="checkbox" data-set="mvum" ${state.mvum ? 'checked' : ''}></label>
      <h2>Offline maps</h2>
      <p class="quiet">Zoom the map to where you'll ride, then save it while you have signal. Saved areas work with no signal.</p>
      ${d ? `<div class="card"><b>Saving… ${d.done} of ${d.total}</b><div class="bar"><i style="width:${Math.round((d.done / Math.max(1, d.total)) * 100)}%"></i></div><div class="btns"><button data-act="cancel-dl">Cancel</button></div></div>`
          : `<div class="btns"><button class="primary" data-act="save-area">Save the area on screen</button></div>`}
      ${areas.map(a => `<div class="row"><div class="grow"><b>${esc(a.name)}</b><div class="quiet">Zoom ${a.minZ}–${a.maxZ} · ${a.tiles.toLocaleString()} pieces · ${new Date(a.savedAt).toLocaleDateString()}</div></div>
        <button data-showarea="${a.id}">Show</button><button data-forget="${a.id}" aria-label="Remove from list">✕</button></div>`).join('')}
      <p class="quiet" id="storage"></p>
      ${areas.length ? '<div class="btns"><button data-act="clear-tiles">Delete all saved maps</button></div>' : ''}`;
  },
  group() {
    return `
      <h2>Group riding is coming</h2>
      <p>Seeing your group on the map and messaging them is the next big step for TrailLink.</p>
      <div class="card"><b>Already working in the background</b><p class="quiet">The engine that shares positions and messages over every available link, passes them along between riders, and warns when someone drops out of range is built and tested.</p></div>
      <div class="card"><b>Still to decide</b><p class="quiet">How riders connect with no cell signal. A phone browser can't reach riders directly, so off-grid group tracking needs radios with Android, or a store app.</p></div>
      <p class="quiet">For now: drop a Regroup point and agree on it before you split up.</p>`;
  },
};

function renderPane() {
  const pane = $('#pane');
  const scroll = pane.scrollTop;
  pane.innerHTML = views[state.tab]();
  pane.scrollTop = scroll;
  if (state.tab === 'maps') void storageSummary().then(s => { const el = document.getElementById('storage'); if (el) el.textContent = s; });
}
function render() {
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  renderChips(); renderPane();
}

$('#tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]'); if (b) { state.tab = b.dataset.tab as Tab; render(); } });

$('#pane').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return;
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
  if (b.dataset.gpx) downloadGpx(b.dataset.gpx);
  if (b.dataset.delpin) { state.pins = state.pins.filter(p => p.id !== b.dataset.delpin); store.savePins(state.pins); drawPins(); renderPane(); }
  if (b.dataset.goto) { const p = state.pins.find(x => x.id === b.dataset.goto); if (p) { state.follow = false; map.flyTo({ center: [p.lon, p.lat], zoom: 15 }); } }
  if (b.dataset.forget) { forgetArea(b.dataset.forget); renderPane(); }
  if (b.dataset.showarea) { const a = savedAreas().find(x => x.id === b.dataset.showarea); if (a) { state.follow = false; map.fitBounds([[a.bounds.w, a.bounds.s], [a.bounds.e, a.bounds.n]]); } }
});
$('#pane').addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.set === 'trails') { state.trails = t.checked; store.set('trails', t.checked); for (const l of TRAIL_LAYERS) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', t.checked ? 'visible' : 'none'); if (!t.checked) popup.remove(); }
  if (t.dataset.set === 'mvum') { state.mvum = t.checked; store.set('mvumImage', t.checked); if (map.getLayer('mvum')) map.setLayoutProperty('mvum', 'visibility', t.checked ? 'visible' : 'none'); }
  if (t.dataset.set === 'keepAwake') { state.keepAwake = t.checked; store.set('keepAwake', t.checked); void applyWakeLock(); }
});
$('#sheet').addEventListener('submit', e => {
  e.preventDefault();
  if ((e.target as HTMLElement).id === 'noteform') { addPin('note', $<HTMLInputElement>('#notetext').value); closeSheet(); }
});
$('#sheet').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act2]'); if (!b) return;
  if (b.dataset.act2 === 'confirm-clear') { void clearAllTiles().then(() => { closeSheet(); renderPane(); toast('Saved maps deleted.'); }); }
  if (b.dataset.act2 === 'sos-copy' && state.pos) { void navigator.clipboard?.writeText(`${state.pos.lat.toFixed(5)}, ${state.pos.lon.toFixed(5)}`).then(() => toast('Coordinates copied.'), () => {}); }
});

$('#btn-layers').addEventListener('click', () => { state.tab = 'maps'; render(); });
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
render();
map.on('load', drawPins);
startGps();
void applyWakeLock();
