// How trails are drawn and described. Colour = can a UTV use it; pattern = who says so.
import type { LayerSpecification } from 'maplibre-gl';
import { BAND_COLORS, LEVELS, UNRATED_COLOR, levelOf, stepColor, type CommunityScore } from './community.ts';

export type ColorBy = 'access' | 'community' | 'mine';

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

type L = LayerSpecification & { source: string; 'source-layer': string };
export const TRAIL_LAYERS: L[] = [
  // White casing under agency routes so they stand out on satellite imagery.
  { id: 'trails-casing', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 8, filter: ['!=', ['get', 'src'], 'OSM'],
    paint: { 'line-color': '#fff', 'line-opacity': 0.8, 'line-width': ['+', width, 2.5] as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as L,
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
  const rated = by === 'mine'
    ? ['case', ['!=', mine, null], stepColor(mine), ['!=', comm, null], stepColor(comm), UNRATED_COLOR]
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

export function ratingHtml(tid: string | undefined, mine: number | undefined, score: CommunityScore | undefined, online: boolean): string {
  if (!tid) return '';
  const chip = (n: number) => { const l = levelOf(n); return `<span class="dchip" style="--c:${l.color}">${Math.round(n * 10) / 10} · ${l.band}</span>`; };
  return `<div class="tp-rate">
    <div><span class="tp-k">Riders say</span> ${score ? `${chip(score.avg)} <span class="tp-n">${online ? `${score.count} rating${score.count === 1 ? '' : 's'}` : 'your rating only, until riders are connected'}</span>` : '<span class="tp-n">Not rated yet</span>'}</div>
    <div><span class="tp-k">You say</span> ${mine ? chip(mine) : '<span class="tp-n">Not rated</span>'}</div>
    <button class="primary" data-rate="${esc(tid)}">${mine ? 'Change my rating' : 'Rate difficulty'}</button>
  </div>`;
}

export function trailPopupHtml(p: Record<string, string>, r: { mine?: number; score?: CommunityScore; online: boolean } = { online: false }): string {
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
    ${ratingHtml(p.tid, r.mine, r.score, r.online)}
    <div class="tp-src">Source: ${esc(SRC_TEXT[p.src] ?? p.src)}. ${p.src === 'OSM' ? 'Not an official designation.' : 'Follow posted signs; they take priority.'}</div>`;
}

export function difficultyLegendHtml(): string {
  const sw = (c: string, label: string) => `<span class="lg"><svg viewBox="0 0 34 8" aria-hidden="true"><line x1="2" y1="4" x2="32" y2="4" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>${label}</span>`;
  return `<div class="legend">${sw(BAND_COLORS.Easy, 'Easy 1–3')}${sw(BAND_COLORS.Moderate, 'Moderate 4–5')}${sw(BAND_COLORS.Difficult, 'Difficult 6–7')}${sw(BAND_COLORS.Extreme, 'Extreme 8–10')}${sw(UNRATED_COLOR, 'Not rated')}</div>
    <p class="quiet">Dashed lines: only narrow vehicles, highway-legal vehicles, or closed to OHVs. Tap for details.</p>`;
}

/** The voting sheet: ten levels with what each means. */
export function rateSheetHtml(tid: string, title: string, mine?: number): string {
  return `<h3>How hard is ${esc(title)}?</h3>
    <p class="quiet">Rate it for a UTV in dry conditions. Pick the number that best matches the hardest stretch most riders will face.</p>
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
