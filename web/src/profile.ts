// Elevation profile of a recorded ride: elevation over distance, shaded by how steep each stretch is,
// with the ride's pins marked. Built from the phone's GPS altitude, smoothed (GPS altitude is jumpy).
import { distanceM } from '../../src/core/geo.ts';
import type { Pt } from './track.ts';

export interface Profile {
  /** Per kept point: distance from the start (m), smoothed elevation (m), grade (%), time (ms), position. */
  d: number[]; e: number[]; g: number[]; t: number[]; lat: number[]; lon: number[];
  total: number; climb: number; descent: number; high: number; low: number;
  /** Steepest sustained climb and descent (%), averaged over about 100 m. */
  steepUp: number; steepDown: number;
}

const FT = 3.28084, MI = 1609.344;
/** Grade bands for the shading (and the legend under the chart). */
export const GRADES = [
  { max: 8, color: '#5EDC8F', label: 'Gentle <8%' },
  { max: 15, color: '#FBA83C', label: 'Steep 8–15%' },
  { max: Infinity, color: '#EF4444', label: 'Very steep 15%+' },
];

export function buildProfile(points: Pt[]): Profile | null {
  if (points.length < 2) return null;
  const withAlt = points.filter(p => p.alt != null).length;
  if (withAlt < Math.max(2, points.length * 0.5)) return null;
  const d: number[] = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + distanceM(points[i - 1], points[i]));
  // Fill gaps in altitude by straight-line interpolation along the distance.
  const raw = points.map(p => p.alt ?? NaN);
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isNaN(raw[i])) continue;
    let a = i - 1; while (a >= 0 && Number.isNaN(raw[a])) a--;
    let b = i + 1; while (b < raw.length && Number.isNaN(raw[b])) b++;
    raw[i] = a < 0 ? raw[b] : b >= raw.length ? raw[a] : raw[a] + (raw[b] - raw[a]) * ((d[i] - d[a]) / Math.max(1, d[b] - d[a]));
  }
  // Smooth over ±40 m of trail.
  const e = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i; j >= 0 && d[i] - d[j] <= 40; j--) { s += raw[j]; n++; }
    for (let j = i + 1; j < raw.length && d[j] - d[i] <= 40; j++) { s += raw[j]; n++; }
    return s / n;
  });
  // Grade over about ±50 m.
  const g = e.map((_, i) => {
    let a = i, b = i;
    while (a > 0 && d[i] - d[a] < 50) a--;
    while (b < e.length - 1 && d[b] - d[i] < 50) b++;
    const run = d[b] - d[a];
    return run > 15 ? Math.max(-60, Math.min(60, ((e[b] - e[a]) / run) * 100)) : 0;
  });
  // Climb and descent with a 3 m dead band, so GPS wobble on flat ground doesn't add up.
  let climb = 0, descent = 0, ref = e[0];
  for (const v of e) { if (v - ref >= 3) { climb += v - ref; ref = v; } else if (ref - v >= 3) { descent += ref - v; ref = v; } }
  return {
    d, e, g, t: points.map(p => p.t), lat: points.map(p => p.lat), lon: points.map(p => p.lon),
    total: d[d.length - 1], climb, descent, high: Math.max(...e), low: Math.min(...e),
    steepUp: Math.max(0, ...g), steepDown: Math.min(0, ...g),
  };
}

/** Index of the point closest to a distance along the ride. */
export function indexAt(pr: Profile, dist: number): number {
  let lo = 0, hi = pr.d.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pr.d[m] < dist) lo = m; else hi = m; }
  return dist - pr.d[lo] < pr.d[hi] - dist ? lo : hi;
}
/** Index of the point closest to a map position (for tapping the ride line). */
export function indexNear(pr: Profile, lat: number, lon: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pr.lat.length; i++) { const dd = distanceM({ lat, lon }, { lat: pr.lat[i], lon: pr.lon[i] }); if (dd < bd) { bd = dd; best = i; } }
  return best;
}

// Chart geometry (SVG units; the SVG scales to the panel width).
export const W = 360, H = 170;
const X0 = 40, X1 = W - 8, Y0 = 22, Y1 = H - 20;

function nice(step: number) { const p = 10 ** Math.floor(Math.log10(step)), f = step / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

export interface ProfileMark { d: number; color: string; label: string }

function scale(pr: Profile) {
  const lowFt = pr.low * FT, highFt = pr.high * FT;
  const pad = Math.max(20, (highFt - lowFt) * 0.12);
  const yStep = nice(Math.max(10, (highFt - lowFt + 2 * pad) / 3));
  const yMin = Math.floor((lowFt - pad) / yStep) * yStep, yMax = Math.ceil((highFt + pad) / yStep) * yStep;
  return {
    lowFt, highFt, yStep, yMin, yMax,
    x: (m: number) => X0 + (m / Math.max(1, pr.total)) * (X1 - X0),
    y: (meters: number) => Y1 - ((meters * FT - yMin) / Math.max(1, yMax - yMin)) * (Y1 - Y0),
  };
}

/** Smooth color by steepness (either way): green when flat, through yellow and orange, to red when very steep. */
const RAMP: [number, number[]][] = [[0, [52, 211, 153]], [4, [163, 230, 53]], [8, [250, 204, 21]], [12, [251, 146, 60]], [15, [239, 68, 68]], [25, [190, 24, 93]]];
export function gradeColor(g: number): string {
  const a = Math.min(25, Math.abs(g));
  let k = 1; while (k < RAMP.length - 1 && RAMP[k][0] < a) k++;
  const [g0, c0] = RAMP[k - 1], [g1, c1] = RAMP[k], t = Math.max(0, Math.min(1, (a - g0) / (g1 - g0)));
  return `rgb(${c0.map((v, i) => Math.round(v + (c1[i] - v) * t)).join(',')})`;
}
let uid = 0;
/** Gradient stops along the ride, colored by grade (averaged over each step so single wobbles don't flicker). */
function gradeStops(pr: Profile, idx: number[]): string {
  const n = Math.min(64, idx.length), out: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = idx[Math.floor((k / n) * (idx.length - 1))], b = idx[Math.floor(((k + 1) / n) * (idx.length - 1))];
    let sum = 0, c = 0; for (let i = a; i <= b; i++) { sum += pr.g[i]; c++; }
    const at = ((pr.d[a] + pr.d[b]) / 2) / Math.max(1, pr.total);
    out.push(`<stop offset="${(at * 100).toFixed(1)}%" stop-color="${gradeColor(sum / Math.max(1, c))}"/>`);
  }
  return out.join('');
}
function sample(pr: Profile, max: number): number[] {
  const step = Math.max(1, Math.floor(pr.d.length / max));
  const idx: number[] = []; for (let i = 0; i < pr.d.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== pr.d.length - 1) idx.push(pr.d.length - 1);
  return idx;
}

export function profileSvg(pr: Profile, marks: ProfileMark[] = []): string {
  const miles = pr.total / MI, id = `pf${++uid}`;
  const { lowFt, highFt, yStep, yMin, yMax, x, y } = scale(pr);
  const idx = sample(pr, 240);
  const line = idx.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ');
  const area = `${X0},${Y1} ${line} ${X1},${Y1}`;
  // Grid: dashed elevation lines with labels, dashed distance lines.
  let grid = '';
  for (let v = yMin; v <= yMax + 0.1; v += yStep) {
    const yy = Y1 - ((v - yMin) / (yMax - yMin)) * (Y1 - Y0);
    grid += `<line x1="${X0}" x2="${X1}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="pgrid"/><text x="${X0 - 5}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" class="plabel">${Math.round(v).toLocaleString()}</text>`;
  }
  const xStep = nice(Math.max(0.05, miles / 4));
  for (let m = 0; m <= miles + 1e-9; m += xStep) {
    const xx = x(m * MI);
    grid += `<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${Y0 - 4}" y2="${Y1}" class="pgrid v"/><text x="${xx.toFixed(1)}" y="${H - 5}" text-anchor="middle" class="plabel">${+m.toFixed(2)}</text>`;
  }
  // Highest and lowest points.
  const hiI = pr.e.indexOf(pr.high), loI = pr.e.indexOf(pr.low);
  const tag = (i: number, up: boolean) => {
    const xx = Math.max(X0 + 18, Math.min(X1 - 18, x(pr.d[i]))), yy = y(pr.e[i]);
    return `<g class="pext"><circle cx="${x(pr.d[i]).toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6"/><text x="${xx.toFixed(1)}" y="${(up ? yy - 7 : yy + 13).toFixed(1)}" text-anchor="middle">${up ? '▲' : '▼'} ${Math.round(pr.e[i] * FT).toLocaleString()}</text></g>`;
  };
  const ext = pr.high - pr.low > 1 ? tag(hiI, true) + (y(pr.low) + 14 < Y1 ? tag(loI, false) : '') : '';
  const pinMarks = marks.map(mk => `<g class="pmark"><line x1="${x(mk.d).toFixed(1)}" x2="${x(mk.d).toFixed(1)}" y1="14" y2="${Y1}" stroke="${mk.color}" stroke-dasharray="2 3" stroke-width="1.2"/><circle cx="${x(mk.d).toFixed(1)}" cy="10" r="5.5" fill="${mk.color}" stroke="#fff" stroke-width="1.5"><title>${mk.label}</title></circle></g>`).join('');
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile: ${Math.round(lowFt).toLocaleString()} to ${Math.round(highFt).toLocaleString()} feet over ${miles.toFixed(1)} miles. Drag to move along the ride.">
    <defs>
      <linearGradient id="${id}c" gradientUnits="userSpaceOnUse" x1="${X0}" x2="${X1}" y1="0" y2="0">${gradeStops(pr, idx)}</linearGradient>
      <linearGradient id="${id}f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".55" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient>
      <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="${X0}" y="${Y0 - 6}" width="${X1 - X0}" height="${Y1 - Y0 + 6}" fill="url(#${id}f)"/></mask>
      <filter id="${id}g" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter>
    </defs>
    <text x="${X0 - 5}" y="12" text-anchor="end" class="plabel">ft</text><text x="${X1}" y="${H - 5}" text-anchor="end" class="plabel unit">mi</text>
    ${grid}
    <polygon points="${area}" fill="url(#${id}c)" mask="url(#${id}m)"/>
    <polyline points="${line}" fill="none" stroke="url(#${id}c)" stroke-width="5" stroke-opacity=".55" filter="url(#${id}g)" stroke-linejoin="round"/>
    <polyline points="${line}" fill="none" stroke="url(#${id}c)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${X0}" x2="${X1}" y1="${Y1}" y2="${Y1}" class="paxis"/>${ext}${pinMarks}
    <g class="scrub" hidden><line class="scrubline" y1="${Y0 - 6}" y2="${Y1}"/><circle class="scrubring" r="11"/><circle class="scrubdot" r="5.5"/></g>
    <rect class="phit" x="${X0}" y="0" width="${X1 - X0}" height="${H}" fill="transparent"/></svg>`;
}

/** Where the scrubber sits for point i, in SVG units. */
export function scrubXY(pr: Profile, i: number): { x: number; y: number } {
  const { x, y } = scale(pr);
  return { x: x(pr.d[i]), y: y(pr.e[i]) };
}
/** Distance along the ride for an x position in SVG units. */
export const distAtX = (pr: Profile, sx: number) => Math.max(0, Math.min(1, (sx - X0) / (X1 - X0))) * pr.total;
export { FT, MI };

/** A slim elevation chart for the strip on the map: no axes, shaded by steepness, a dot at point `at`. */
export const MW = 300, MH = 40;
export function miniProfileSvg(pr: Profile, at: number | null): string {
  const lo = pr.low, hi = Math.max(pr.high, pr.low + 6); // at least ~20 ft of range, so flat rides look flat
  const x = (m: number) => (m / Math.max(1, pr.total)) * MW;
  const y = (e: number) => MH - 3 - ((e - lo) / (hi - lo)) * (MH - 8);
  const idx = sample(pr, 150), id = `pm${++uid}`;
  const line = idx.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ');
  // The dot is drawn in HTML over the chart (the chart stretches to any width, which would squash a circle).
  const dot = at == null ? '' : `<line x1="${x(pr.d[at]).toFixed(1)}" x2="${x(pr.d[at]).toFixed(1)}" y1="0" y2="${MH}" class="el-cur"/>`;
  return `<svg class="el-svg" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="none" aria-hidden="true"><defs>
    <linearGradient id="${id}c" gradientUnits="userSpaceOnUse" x1="0" x2="${MW}" y1="0" y2="0">${gradeStops(pr, idx)}</linearGradient>
    <linearGradient id="${id}f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="${MW}" height="${MH}"><rect width="${MW}" height="${MH}" fill="url(#${id}f)"/></mask></defs>
    <line x1="0" x2="${MW}" y1="${MH / 2}" y2="${MH / 2}" class="el-grid"/>
    <polygon points="0,${MH} ${line} ${MW},${MH}" fill="url(#${id}c)" mask="url(#${id}m)"/>
    <polyline points="${line}" fill="none" stroke="url(#${id}c)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
}

/** Where the strip's dot sits for point i, as percentages of the chart box. */
export function miniXY(pr: Profile, i: number): { x: number; y: number } {
  const lo = pr.low, hi = Math.max(pr.high, pr.low + 6);
  return { x: (pr.d[i] / Math.max(1, pr.total)) * 100, y: ((MH - 3 - ((pr.e[i] - lo) / (hi - lo)) * (MH - 8)) / MH) * 100 };
}
