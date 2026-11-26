// How trails are drawn and described. Colour = can a UTV use it; pattern = who says so.
import type { LayerSpecification } from 'maplibre-gl';
import { BAND_COLORS, LEVELS, UNRATED_COLOR, levelOf, stepColor, type CommunityScore } from './community.ts';
import { rigClass } from './garage.ts';

export type ColorBy = 'access' | 'community' | 'mine' | 'rig';

// Feature properties (from data/build-trails.mjs):
//   src USFS|BLM|OSM · kind road|trail · utv open|narrow|limited|closed|unknown · name · num · unit
//   seasonal · dates · vehicles · note
export const UTV_COLORS = {
  open: '#E8501A',    // UTVs of any width
  limited: '#B45309', // open with restrictions (see details)
  narrow: '#7C3AED',  // only vehicles 50" or narrower (ATVs, small OHVs)
  street: '#2563EB',  // highway-legal vehicles only (street-legal UTVs may qualify)
  closed: '#6B7280',  // closed to OHVs (still shown so riders know)
  unknown: '#3F3A2E', // community data with no legal designation
} as const;

const accessColor = ['match', ['get', 'utv'], 'open', UTV_COLORS.open, 'limited', UTV_COLORS.limited, 'narrow', UTV_COLORS.narrow, 'street', UTV_COLORS.street, 'closed', UTV_COLORS.closed, UTV_COLORS.unknown];
const width = ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'kind'], 'road', 1.6, 1.2], 13, ['match', ['get', 'kind'], 'road', 4, 3], 16, ['match', ['get', 'kind'], 'road', 7, 5]];
// A zoom curve can't be wrapped in math, so the white casing gets its own curve (line width + 2.5).
const casingWidth = ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'kind'], 'road', 4.1, 3.7], 13, ['match', ['get', 'kind'], 'road', 6.5, 5.5], 16, ['match', ['get', 'kind'], 'road', 9.5, 7.5]];

type L = LayerSpecification & { source: string; 'source-layer': string };
export const TRAIL_LAYERS: L[] = [
  // White casing under agency routes so they stand out on satellite imagery.
  { id: 'trails-casing', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 8, filter: ['!=', ['get', 'src'], 'OSM'],
    paint: { 'line-color': '#fff', 'line-opacity': 0.8, 'line-width': casingWidth as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as L,
  // OpenStreetMap: dotted, drawn first so agency lines sit on top.
  { id: 'trails-osm', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 10, filter: ['==', ['get', 'src'], 'OSM'],
    paint: { 'line-color': accessColor as never, 'line-width': width as never, 'line-dasharray': [0.6, 2], 'line-opacity': 0.85 }, layout: { 'line-cap': 'round' } } as L,
  // Agency routes: solid when open to UTVs, dashed when restricted, thin grey when closed.
  { id: 'trails-agency', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 8, filter: ['all', ['!=', ['get', 'src'], 'OSM'], ['!', ['in', ['get', 'utv'], ['literal', ['narrow', 'street', 'closed']]]]],
    paint: { 'line-color': accessColor as never, 'line-width': width as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as L,
  { id: 'trails-agency-restricted', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 8, filter: ['all', ['!=', ['get', 'src'], 'OSM'], ['in', ['get', 'utv'], ['literal', ['narrow', 'street', 'closed']]]],
    paint: { 'line-color': accessColor as never, 'line-width': width as never, 'line-dasharray': [2, 1.5] } } as L,
  { id: 'trails-labels', type: 'symbol', source: 'trails', 'source-layer': 'trails', minzoom: 12, filter: ['!=', ['get', 'src'], 'OSM'],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name'], ['get', 'num'], ''], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-max-angle': 30 },
    paint: { 'text-color': '#1D221D', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } } as L,
];

/** Line colour for the chosen mode. Difficulty modes read ratings from feature state (set by the app per trail id). */
export function trailColor(by: ColorBy): unknown {
  if (by === 'access') return accessColor;
  const comm = ['feature-state', 'comm'];
  const mine = ['feature-state', 'mine'];
  const rig = ['feature-state', 'rig'];
  const rated = by === 'mine'
    ? ['case', ['!=', mine, null], stepColor(mine), ['!=', comm, null], stepColor(comm), UNRATED_COLOR]
    : by === 'rig'
      ? ['case', ['!=', rig, null], stepColor(rig), ['!=', comm, null], stepColor(comm), UNRATED_COLOR]
      : ['case', ['!=', comm, null], stepColor(comm), UNRATED_COLOR];
  return rated;
}
/** Zoomed-out view: dots where trails are, grouped and counted. Tapping one zooms in. Hidden once trail lines show. */
export const OVERVIEW_MAXZOOM = 8.6;
const routes = ['coalesce', ['get', 'routes'], ['get', 'n']];
export const OVERVIEW_LAYERS: L[] = [
  { id: 'overview-dots', type: 'circle', source: 'overview', maxzoom: OVERVIEW_MAXZOOM,
    paint: {
      'circle-color': '#E8501A',
      'circle-radius': ['step', routes, 7, 25, 10, 100, 14, 500, 18, 2000, 23] as never,
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.92,
    } } as unknown as L,
  { id: 'overview-count', type: 'symbol', source: 'overview', maxzoom: OVERVIEW_MAXZOOM, filter: ['>=', routes, 25] as never,
    layout: {
      'text-field': ['let', 'v', routes, ['case', ['>=', ['var', 'v'], 1000], ['concat', ['to-string', ['/', ['round', ['/', ['var', 'v'], 100]], 10]], 'k'], ['to-string', ['var', 'v']]]] as never,
      'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true,
    },
    paint: { 'text-color': '#fff' } } as unknown as L,
];

export const COLORED_LAYERS = ['trails-osm', 'trails-agency', 'trails-agency-restricted'];

/** Markers along trails whose difficulty colour changes in your rig: ▲ harder, ▼ easier. Driven by feature state "shift". */
export function rigMarkerLayers(source: string, sourceLayer?: string): LayerSpecification[] {
  return (['harder', 'easier'] as const).map(kind => ({
    id: `${source}-rig-${kind}`, type: 'symbol', source, ...(sourceLayer ? { 'source-layer': sourceLayer } : {}), minzoom: 10,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 220, 'icon-image': `rig-${kind}`, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-rotation-alignment': 'viewport', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1] },
    paint: { 'icon-opacity': ['case', ['==', ['feature-state', 'shift'], kind === 'harder' ? 1 : -1], 1, 0] },
  }) as unknown as LayerSpecification);
}

/** Draws the ▲ / ▼ marker images (no font needed, so they work offline on every base map). */
export function rigMarkerImage(kind: 'harder' | 'easier'): ImageData {
  const size = 44, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = kind === 'harder' ? '#DC2626' : '#15803D'; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  g.beginPath(); g.fillStyle = '#fff';
  if (kind === 'harder') { g.moveTo(22, 11); g.lineTo(33, 29); g.lineTo(11, 29); } else { g.moveTo(22, 33); g.lineTo(33, 15); g.lineTo(11, 15); }
  g.closePath(); g.fill();
  return g.getImageData(0, 0, size, size);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const UTV_TEXT: Record<string, string> = {
  open: 'Open to UTVs',
  limited: 'Open to UTVs, with restrictions',
  narrow: 'Only vehicles 50" wide or less',
  street: 'Highway-legal vehicles only (a street-legal UTV may qualify)',
  closed: 'Closed to OHVs',
  unknown: 'No legal designation in our data',
};
const SRC_TEXT: Record<string, string> = {
  USFS: 'Forest Service Motor Vehicle Use Map',
  BLM: 'BLM travel plan',
  OSM: 'OpenStreetMap (community-mapped)',
};

export interface RatingInfo {
  mine?: number;
  score?: CommunityScore;
  online: boolean;
  /** Forecast for the rider's selected vehicle; null when the garage is empty. */
  rig?: { name: string; value: number; shift: -1 | 0 | 1; widthIn: number } | null;
}

export function ratingHtml(tid: string | undefined, r: RatingInfo): string {
  if (!tid) return '';
  const { mine, score, online, rig } = r;
  const chip = (n: number) => { const l = levelOf(n); return `<span class="dchip" style="--c:${l.color}">${Math.round(n * 10) / 10} · ${l.band}</span>`; };
  const ratersRig = score?.rig ?? null;
  const rigRow = !score ? ''
    : rig ? `<div><span class="tp-k">Your ${esc(rig.name)}</span> ${chip(rig.value)} <span class="tp-n">${
        rig.shift < 0 ? '<b class="shift easier">▼ easier for your rig</b>' : rig.shift > 0 ? '<b class="shift harder">▲ harder for your rig</b>' : 'about the same for your rig'}</span>
        <div class="tp-n">Forecast. Riders rated it in ${ratersRig == null ? `rigs we assume are stock` : `${rigClass(ratersRig).toLowerCase()} rigs on average (${ratersRig}/10)`}.</div></div>`
    : `<div class="tp-n"><button class="link" data-act="garage">Add your vehicle to the Garage</button> to see how hard it'll be in your rig.</div>`;
  return `<div class="tp-rate">
    <div><span class="tp-k">Riders say</span> ${score ? `${chip(score.avg)} <span class="tp-n">${online ? `${score.count} rating${score.count === 1 ? '' : 's'}` : 'your rating only, until riders are connected'}</span>` : '<span class="tp-n">Not rated yet</span>'}</div>
    ${rigRow}
    <div><span class="tp-k">You say</span> ${mine ? chip(mine) : '<span class="tp-n">Not rated</span>'}</div>
    <button class="primary" data-rate="${esc(tid)}">${mine ? 'Change my rating' : 'Rate difficulty'}</button>
  </div>`;
}

export function trailPopupHtml(p: Record<string, string>, r: RatingInfo = { online: false }): string {
  const title = p.name || (p.num ? `${p.kind === 'road' ? 'Road' : 'Trail'} ${p.num}` : p.kind === 'road' ? 'Unnamed road' : 'Unnamed trail');
  const rows: [string, string | undefined][] = [
    ['Route', p.name && p.num ? p.num : undefined],
    ['Managed by', p.unit],
    ['Vehicles allowed', p.vehicles],
    ['Season', p.dates || (p.seasonal ? 'Seasonal: check dates locally' : undefined)],
    ['Notes', p.note],
  ];
  return `
    <div class="tp-title">${esc(title)}</div>
    <div class="tp-status" style="--c:${UTV_COLORS[p.utv as keyof typeof UTV_COLORS] ?? UTV_COLORS.unknown}">${esc(UTV_TEXT[p.utv] ?? UTV_TEXT.unknown)}</div>
    <dl>${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${r.rig && r.rig.widthIn > 50 && p.utv === 'narrow' ? `<p class="warn">Your ${esc(r.rig.name)} is too wide for this trail (50" and under only).</p>` : ''}
    ${ratingHtml(p.tid, r)}
    <div class="tp-src">Source: ${esc(SRC_TEXT[p.src] ?? p.src)}. ${p.src === 'OSM' ? 'Not an official designation.' : 'Follow posted signs; they take priority.'}</div>`;
}

export function difficultyLegendHtml(): string {
  const sw = (c: string, label: string) => `<span class="lg"><svg viewBox="0 0 34 8" aria-hidden="true"><line x1="2" y1="4" x2="32" y2="4" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>${label}</span>`;
  return `<div class="legend">${sw(BAND_COLORS.Easy, 'Easy 1–3')}${sw(BAND_COLORS.Moderate, 'Moderate 4–5')}${sw(BAND_COLORS.Difficult, 'Difficult 6–7')}${sw(BAND_COLORS.Extreme, 'Extreme 8–10')}${sw(UNRATED_COLOR, 'Not rated')}</div>
    <p class="quiet">Dashed lines: only narrow vehicles, highway-legal vehicles, or closed to OHVs. Tap for details.</p>`;
}

/** The voting sheet: ten levels with what each means. */
export function rateSheetHtml(tid: string, title: string, mine?: number, rigLine = ''): string {
  return `<h3>How hard is ${esc(title)}?</h3>
    <p class="quiet">Rate how hard it was in the vehicle you rode, in dry conditions. Pick the number that best matches the hardest stretch.</p>
    ${rigLine}
    <div class="levels">${LEVELS.map(l => `<button class="lvl${mine === l.n ? ' on' : ''}" data-vote="${l.n}" data-tid="${esc(tid)}" style="--c:${l.color}"><b>${l.n}</b><span><em>${l.band}</em>${esc(l.text)}</span></button>`).join('')}</div>
    <div class="btns">${mine ? `<button data-unvote="${esc(tid)}">Remove my rating</button>` : ''}<button data-close>Cancel</button></div>`;
}

export function legendHtml(): string {
  const item = (c: string, label: string, dash = false, dots = false) =>
    `<span class="lg"><svg viewBox="0 0 34 8" aria-hidden="true"><line x1="2" y1="4" x2="32" y2="4" stroke="${c}" stroke-width="${dots ? 3 : 4}" stroke-linecap="round" ${dash ? 'stroke-dasharray="7 5"' : ''} ${dots ? 'stroke-dasharray="1 5"' : ''}/></svg>${label}</span>`;
  return `<div class="legend">
    ${item(UTV_COLORS.open, 'UTVs allowed')}
    ${item(UTV_COLORS.limited, 'UTVs, with limits')}
    ${item(UTV_COLORS.narrow, '50" and under only', true)}
    ${item(UTV_COLORS.street, 'Highway-legal only', true)}
    ${item(UTV_COLORS.closed, 'Closed to OHVs', true)}
    ${item(UTV_COLORS.unknown, 'Community-mapped (OSM)', false, true)}
  </div>`;
}
