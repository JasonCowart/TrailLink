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
  { max: 8, color: '#86C49A', label: 'Gentle <8%' },
  { max: 15, color: '#F2B94B', label: 'Steep 8–15%' },
  { max: Infinity, color: '#E4573D', label: 'Very steep 15%+' },
];
const band = (g: number) => GRADES.find(b => Math.abs(g) < b.max)!;

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

export function profileSvg(pr: Profile, marks: ProfileMark[] = []): string {
  const miles = pr.total / MI;
  const { lowFt, highFt, yStep, yMin, yMax, x, y } = scale(pr);
  // Downsample to at most ~240 steps for drawing.
  const step = Math.max(1, Math.floor(pr.d.length / 240));
  const idx: number[] = []; for (let i = 0; i < pr.d.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== pr.d.length - 1) idx.push(pr.d.length - 1);
  // Shaded area under the line, one polygon per run of the same steepness.
  let fills = '';
  const colorOf = (k: number) => band(pr.g[idx[k]]).color; // segment k runs from idx[k-1] to idx[k]
  for (let k = 1; k < idx.length;) {
    const c = colorOf(k); let end = k;
    while (end + 1 < idx.length && colorOf(end + 1) === c) end++;
    const seg = idx.slice(k - 1, end + 1);
    const pts = seg.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ');
    fills += `<polygon points="${x(pr.d[seg[0]]).toFixed(1)},${Y1} ${pts} ${x(pr.d[seg[seg.length - 1]]).toFixed(1)},${Y1}" fill="${c}" fill-opacity=".75"/>`;
    k = end + 1;
  }
  const line = idx.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ');
  // Axes: elevation gridlines (ft) and distance ticks (mi).
  let grid = '';
  for (let v = yMin; v <= yMax + 0.1; v += yStep) {
    const yy = Y1 - ((v - yMin) / (yMax - yMin)) * (Y1 - Y0);
    grid += `<line x1="${X0}" x2="${X1}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="pgrid"/><text x="${X0 - 4}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" class="plabel">${Math.round(v).toLocaleString()}</text>`;
  }
  const xStep = nice(Math.max(0.05, miles / 4));
  for (let m = 0; m <= miles + 1e-9; m += xStep) {
    const xx = x(m * MI);
    grid += `<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${Y1}" y2="${Y1 + 4}" class="paxis"/><text x="${xx.toFixed(1)}" y="${H - 5}" text-anchor="middle" class="plabel">${+m.toFixed(2)}</text>`;
  }
  const pinMarks = marks.map(mk => `<g class="pmark"><line x1="${x(mk.d).toFixed(1)}" x2="${x(mk.d).toFixed(1)}" y1="14" y2="${Y1}" stroke="${mk.color}" stroke-dasharray="2 3" stroke-width="1.2"/><circle cx="${x(mk.d).toFixed(1)}" cy="10" r="5.5" fill="${mk.color}" stroke="#fff" stroke-width="1.5"><title>${mk.label}</title></circle></g>`).join('');
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile: ${Math.round(lowFt).toLocaleString()} to ${Math.round(highFt).toLocaleString()} feet over ${miles.toFixed(1)} miles. Drag to move along the ride.">
    <text x="${X0 - 4}" y="12" text-anchor="end" class="plabel">ft</text><text x="${X1}" y="${H - 5}" text-anchor="end" class="plabel unit">mi</text>
    ${grid}${fills}<polyline points="${line}" fill="none" stroke="#1F2A24" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${X0}" x2="${X1}" y1="${Y1}" y2="${Y1}" class="paxis"/>${pinMarks}
    <g class="scrub" hidden><line class="scrubline" y1="${Y0 - 6}" y2="${Y1}"/><circle class="scrubdot" r="6"/></g>
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
  const step = Math.max(1, Math.floor(pr.d.length / 150));
  const idx: number[] = []; for (let i = 0; i < pr.d.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== pr.d.length - 1) idx.push(pr.d.length - 1);
  let fills = '';
  for (let k = 1; k < idx.length;) {
    const c = band(pr.g[idx[k]]).color; let end = k;
    while (end + 1 < idx.length && band(pr.g[idx[end + 1]]).color === c) end++;
    const seg = idx.slice(k - 1, end + 1);
    fills += `<polygon points="${x(pr.d[seg[0]]).toFixed(1)},${MH} ${seg.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ')} ${x(pr.d[seg[seg.length - 1]]).toFixed(1)},${MH}" fill="${c}" fill-opacity=".55"/>`;
    k = end + 1;
  }
  const line = idx.map(i => `${x(pr.d[i]).toFixed(1)},${y(pr.e[i]).toFixed(1)}`).join(' ');
  const dot = at == null ? '' : `<line x1="${x(pr.d[at]).toFixed(1)}" x2="${x(pr.d[at]).toFixed(1)}" y1="0" y2="${MH}" class="el-cur"/><circle cx="${x(pr.d[at]).toFixed(1)}" cy="${y(pr.e[at]).toFixed(1)}" r="4.5" class="el-dot"/>`;
  return `<svg class="el-svg" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="none" aria-hidden="true">${fills}<polyline points="${line}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
}
