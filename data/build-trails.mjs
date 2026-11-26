// Builds TrailLink's trail layer for the launch states from public sources.
// Runs in GitHub Actions (needs internet). Output: data/out/trails.geojsonseq (one feature per line) + meta.json.
//
//   Forest Service MVUM roads + trails  (legal motor-vehicle routes, vehicle classes, season dates)
//   BLM GTLF routes managed for public motorized use  (OHV designation, allowed vehicles)
//   OpenStreetMap tracks and OHV ways  (community data, fills gaps; NOT a legal designation)
//
// Usage: node data/build-trails.mjs [--states CO,UT] [--osm path/to/osm.geojsonseq]
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const STATES = arg('states', 'CO,UT').split(',');
const OSM_FILE = arg('osm', '');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// State bounding boxes (west, south, east, north). Agency data is clipped by bbox; BLM is also filtered by state code.
const BBOX = {
  CO: [-109.06, 36.99, -102.04, 41.01],
  UT: [-114.06, 36.99, -109.04, 42.01],
  AZ: [-114.82, 31.33, -109.04, 37.01],
  NV: [-120.01, 35.0, -114.04, 42.01],
  NM: [-109.06, 31.33, -103.0, 37.01],
  WY: [-111.06, 40.99, -104.05, 45.01],
  ID: [-117.25, 41.99, -111.04, 49.01],
};

const MVUM = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer';
const BLM = 'https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer';

// ------------------------------------------------------------------ ArcGIS download helpers
async function getJson(url, body, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, body ? { method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

/** Every feature of a layer inside a bbox, fetched by object-id chunks (works whether or not the server pages). */
async function* arcgisFeatures(layerUrl, bbox, where = '1=1', outFields = '*') {
  const geom = { geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  const ids = await getJson(`${layerUrl}/query`, { ...geom, where, returnIdsOnly: 'true', f: 'json' });
  const all = (ids.objectIds ?? []).sort((a, b) => a - b);
  console.log(`  ${layerUrl.split('/').slice(-1)[0]}: ${all.length} features`);
  for (let i = 0; i < all.length; i += 400) {
    const fc = await getJson(`${layerUrl}/query`, {
      objectIds: all.slice(i, i + 400).join(','), outFields, outSR: '4326', returnGeometry: 'true', f: 'geojson',
      geometryPrecision: '6', maxAllowableOffset: '0.00002',
    });
    for (const f of fc.features ?? []) if (f.geometry) yield f;
  }
}

// ------------------------------------------------------------------ normalising
const yes = v => v != null && String(v).trim() !== '' && !/^(closed|no|n|null|none|0)$/i.test(String(v).trim());
const clean = v => (v == null ? undefined : String(v).trim() || undefined);
// Title-case ALL-CAPS names, but leave route codes (anything with a digit) as they are: "BLM T6102E", "FS 412".
const title = s => s && (/\d/.test(s) ? s.toUpperCase() : s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()));
const YEAR_ROUND = /^0?1\/0?1\s*-\s*12\/31$/;
const BLM_VEHICLES = {
  ALL_MOTO_VEH: 'All motorized vehicles', MTC_ATV_SHARED: 'Motorcycles and ATVs', MTC_ONLY: 'Motorcycles only', ATV_ONLY: 'ATVs only',
  UTV_ATV_MTC: 'UTVs, ATVs and motorcycles', HIGHWAY_LEGAL: 'Highway-legal vehicles', FOUR_WD: '4WD vehicles', '4WD': '4WD vehicles',
};
const blmVehicles = v => { if (!v || /^unk/i.test(v)) return undefined; const k = v.toUpperCase(); return BLM_VEHICLES[k] ?? title(v.replace(/_/g, ' ')); };

/** utv: 'open' (any width), 'narrow' (only vehicles 50" or less), 'limited' (open with restrictions), 'closed', 'unknown'. */
function fromMvum(p, kind) {
  const wide = yes(p.other_ohv_gt50inches) || yes(p.fourwd_gt50inches);
  const narrow = yes(p.other_ohv_lt50inches) || yes(p.atv);
  const rawDates = clean(p.other_ohv_gt50_datesopen) ?? clean(p.fourwd_gt50_datesopen) ?? clean(p.other_ohv_lt50_datesopen) ?? clean(p.atv_datesopen)
    ?? clean(p.highclearancevehicle_datesopen) ?? clean(p.passengervehicle_datesopen);
  const yearRound = !rawDates || YEAR_ROUND.test(rawDates);
  const dates = rawDates ? (yearRound ? 'Open all year' : `Open ${rawDates}`) : undefined;
  const streetOnly = !wide && !narrow && (yes(p.passengervehicle) || yes(p.highclearancevehicle));
  const vehicles = [
    yes(p.passengervehicle) && 'Passenger cars',
    yes(p.highclearancevehicle) && 'High-clearance vehicles',
    wide && 'UTVs/OHVs over 50"',
    yes(p.other_ohv_lt50inches) && 'OHVs 50" or less',
    yes(p.atv) && 'ATVs',
    yes(p.motorcycle) && 'Motorcycles',
  ].filter(Boolean);
  const route = clean(p.id) ?? clean(p.rte_cn) ?? String(p.objectid);
  return {
    tid: `USFS:${clean(p.securityid) ?? clean(p.adminorg) ?? ''}:${route}`,
    src: 'USFS', kind,
    name: clean(p.name) ? title(p.name) : undefined,
    num: clean(p.id),
    unit: [clean(p.forestname), clean(p.districtname)].filter(Boolean).join(' · ') || undefined,
    // MVUM roads open only to passenger and high-clearance vehicles are for highway-legal vehicles (a street-legal UTV may qualify).
    utv: wide ? 'open' : narrow ? 'narrow' : streetOnly ? 'street' : vehicles.length ? 'closed' : 'unknown',
    seasonal: !yearRound,
    dates,
    vehicles: vehicles.join(', ') || undefined,
  };
}

function fromBlm(p, kind) {
  const dsg = String(p.PLAN_OHV_ROUTE_DSGNTN ?? '').toUpperCase();
  const allowedRaw = clean(p.PLAN_ALLOW_MODE_TRNSPRT);
  const allowed = allowedRaw && !/^unk/i.test(allowedRaw) ? allowedRaw : undefined;
  const lim = clean(p.OHV_ROUTE_DSGNTN_LIM);
  const explain = clean(p.OHV_DSGNTN_LIM_EXPLAIN);
  const utvNamed = allowed ? /UTV|SIDE|OHV|4WD|4X4|ALL/i.test(allowed) : false;
  const atvOnly = allowed ? /ATV|MOTORCYCLE|SINGLE/i.test(allowed) && !utvNamed : false;
  const nm = clean(p.ROUTE_PRMRY_NM);
  return {
    tid: nm ? `BLM:${clean(p.ADMIN_ST) ?? ''}:${nm.toUpperCase()}` : `BLM:${clean(p.GlobalID) ?? clean(p.Original_GlobalID) ?? p.OBJECTID}`,
    src: 'BLM', kind,
    name: clean(p.ROUTE_PRMRY_NM) ? title(p.ROUTE_PRMRY_NM) : undefined,
    num: clean(p.ROUTE_PLAN_ID),
    unit: `BLM ${clean(p.ADMIN_ST) ?? ''}`.trim(),
    utv: dsg === 'CLOSED' ? 'closed' : dsg === 'OPEN' ? (atvOnly ? 'narrow' : 'open') : dsg === 'LIMITED' ? (atvOnly ? 'narrow' : 'limited') : 'unknown',
    seasonal: /SEASON/i.test(lim ?? '') || /season/i.test(explain ?? ''),
    dates: /^(no|none|n|unk.*)$/i.test(clean(p.PLAN_SEASON_RSTRCT_CODE) ?? 'no') ? undefined : clean(p.PLAN_SEASON_RSTRCT_CODE),
    vehicles: blmVehicles(allowed),
    note: [lim && title(lim), explain].filter(Boolean).join(': ') || undefined,
  };
}

function fromOsm(p) {
  const access = (p.atv ?? p.ohv ?? p.motor_vehicle ?? p.access ?? '').toLowerCase();
  return {
    tid: `OSM:${p['@id'] ?? ''}`,
    src: 'OSM', kind: p.highway === 'track' ? 'road' : 'trail',
    name: clean(p.name), num: clean(p.ref),
    utv: /^(no|private)$/.test(access) ? 'closed' : 'unknown',
    note: [p.tracktype && `Track grade ${p.tracktype.replace('grade', '')}`, p.surface && `Surface: ${p.surface}`, clean(p.width) && `Width: ${p.width}`].filter(Boolean).join(' · ') || undefined,
  };
}

// ------------------------------------------------------------------ main
const out = createWriteStream(`${OUT}trails.geojsonseq`);
const counts = {};
// Overview for zoomed-out maps: trails binned into ~5 km cells, one dot per cell with how many routes it holds.
const CELL = 0.05;
const cells = new Map();
function midpoint(geometry) {
  const line = geometry.type === 'MultiLineString' ? geometry.coordinates.reduce((a, b) => (b.length > a.length ? b : a), []) : geometry.coordinates;
  return line?.length ? line[Math.floor(line.length / 2)] : null;
}
const emit = (geometry, props) => {
  for (const k of Object.keys(props)) if (props[k] === undefined || props[k] === false) delete props[k];
  out.write(JSON.stringify({ type: 'Feature', geometry, properties: props }) + '\n');
  counts[props.src] = (counts[props.src] ?? 0) + 1;
  const m = midpoint(geometry);
  if (m) {
    const key = `${Math.floor(m[0] / CELL)}:${Math.floor(m[1] / CELL)}`;
    const c = cells.get(key) ?? { x: 0, y: 0, n: 0, legal: 0 };
    c.x += m[0]; c.y += m[1]; c.n++;
    if (props.src !== 'OSM' && (props.utv === 'open' || props.utv === 'limited')) c.legal++;
    cells.set(key, c);
  }
};

for (const st of STATES) {
  const bbox = BBOX[st];
  if (!bbox) throw new Error(`No bbox for ${st}`);
  console.log(`== ${st}`);
  // Forest Service: layer 1 = roads, 2 = trails. Neighbouring states' routes inside the bbox are kept too (harmless).
  for (const [layer, kind] of [[1, 'road'], [2, 'trail']]) {
    for await (const f of arcgisFeatures(`${MVUM}/${layer}`, bbox)) emit(f.geometry, fromMvum(f.properties, kind));
  }
  // BLM: 0/1 = roads (public / limited public motorized), 2/3 = trails (public / limited public motorized).
  for (const [layer, kind] of [[0, 'road'], [1, 'road'], [2, 'trail'], [3, 'trail']]) {
    try {
      for await (const f of arcgisFeatures(`${BLM}/${layer}`, bbox, `ADMIN_ST = '${st}'`)) emit(f.geometry, fromBlm(f.properties, kind));
    } catch (e) { console.warn(`  BLM layer ${layer} skipped: ${e.message}`); }
  }
}

if (OSM_FILE && existsSync(OSM_FILE)) {
  console.log('== OpenStreetMap');
  const rl = createInterface({ input: createReadStream(OSM_FILE) });
  for await (const line of rl) {
    const s = line.replace(/^\x1e/, '').trim();
    if (!s) continue;
    const f = JSON.parse(s);
    if (f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString') emit(f.geometry, fromOsm(f.properties ?? {}));
  }
}

await new Promise(r => out.end(r));
writeFileSync(`${OUT}overview.geojson`, JSON.stringify({
  type: 'FeatureCollection',
  features: [...cells.values()].map(c => ({
    type: 'Feature',
    properties: { n: c.n, legal: c.legal },
    geometry: { type: 'Point', coordinates: [+(c.x / c.n).toFixed(4), +(c.y / c.n).toFixed(4)] },
  })),
}));
console.log(`overview: ${cells.size} dots`);
const meta = { built: new Date().toISOString(), states: STATES, counts, sources: {
  USFS: 'USDA Forest Service Motor Vehicle Use Map (EDW_MVUM_01)',
  BLM: 'BLM National GTLF Public Display (routes managed for public motorized use)',
  OSM: 'OpenStreetMap contributors (ODbL), via Geofabrik',
} };
writeFileSync(`${OUT}meta.json`, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
if (!counts.USFS && !counts.BLM) { console.error('No agency data downloaded'); process.exit(1); }
