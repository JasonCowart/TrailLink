// How trails are drawn and described. Colour = can a UTV use it; pattern = who says so.
import type { LayerSpecification } from 'maplibre-gl';

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

const color = ['match', ['get', 'utv'], 'open', UTV_COLORS.open, 'limited', UTV_COLORS.limited, 'narrow', UTV_COLORS.narrow, 'street', UTV_COLORS.street, 'closed', UTV_COLORS.closed, UTV_COLORS.unknown];
const width = ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'kind'], 'road', 1.6, 1.2], 13, ['match', ['get', 'kind'], 'road', 4, 3], 16, ['match', ['get', 'kind'], 'road', 7, 5]];

type L = LayerSpecification & { source: string; 'source-layer': string };
export const TRAIL_LAYERS: L[] = [
  // White casing under agency routes so they stand out on satellite imagery.
  { id: 'trails-casing', type: 'line', source: 'trails', 'source-layer': 'trails', filter: ['!=', ['get', 'src'], 'OSM'],
    paint: { 'line-color': '#fff', 'line-opacity': 0.8, 'line-width': ['+', width, 2.5] as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as L,
  // OpenStreetMap: dotted, drawn first so agency lines sit on top.
  { id: 'trails-osm', type: 'line', source: 'trails', 'source-layer': 'trails', minzoom: 10, filter: ['==', ['get', 'src'], 'OSM'],
    paint: { 'line-color': color as never, 'line-width': width as never, 'line-dasharray': [0.6, 2], 'line-opacity': 0.85 }, layout: { 'line-cap': 'round' } } as L,
  // Agency routes: solid when open to UTVs, dashed when restricted, thin grey when closed.
  { id: 'trails-agency', type: 'line', source: 'trails', 'source-layer': 'trails', filter: ['all', ['!=', ['get', 'src'], 'OSM'], ['!', ['in', ['get', 'utv'], ['literal', ['narrow', 'street', 'closed']]]]],
    paint: { 'line-color': color as never, 'line-width': width as never }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as L,
  { id: 'trails-agency-restricted', type: 'line', source: 'trails', 'source-layer': 'trails', filter: ['all', ['!=', ['get', 'src'], 'OSM'], ['in', ['get', 'utv'], ['literal', ['narrow', 'street', 'closed']]]],
    paint: { 'line-color': color as never, 'line-width': width as never, 'line-dasharray': [2, 1.5] } } as L,
  { id: 'trails-labels', type: 'symbol', source: 'trails', 'source-layer': 'trails', minzoom: 12, filter: ['!=', ['get', 'src'], 'OSM'],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name'], ['get', 'num'], ''], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-max-angle': 30 },
    paint: { 'text-color': '#1D221D', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } } as L,
];

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

export function trailPopupHtml(p: Record<string, string>): string {
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
    <div class="tp-src">Source: ${esc(SRC_TEXT[p.src] ?? p.src)}. ${p.src === 'OSM' ? 'Not an official designation.' : 'Follow posted signs; they take priority.'}</div>`;
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
