// "Get me out": a route back to safety (where the ride started, a regroup point, camp, a rider) that works with no
// signal. Two ways to get there, and the shorter wins:
//  1. Along the trail network on the phone (the saved trail map tiles), joined into a graph and searched (Dijkstra).
//  2. Back along your own recorded track (you know you can drive it).
// If neither reaches, it falls back to a straight line with distance and direction.
import { distanceM } from '../../src/core/geo.ts';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export interface LL { lat: number; lon: number }
export interface Route { coords: LL[]; length: number; via: 'trails' | 'track' | 'straight' | 'mixed'; /** From this point on, no trail: straight line. */ straightFrom?: number }

// ---------------------------------------------------------------- trail graph
interface Graph { nodes: LL[]; adj: { to: number; w: number }[][] }
const keyOf = (p: LL) => `${Math.round(p.lon / 6e-5)}:${Math.round(p.lat / 4.5e-5)}`; // ~5 m cells: joins tile edges

/** Build a graph from trail lines ([lon, lat] arrays). Points within ~5 m are treated as the same junction. */
export function buildGraph(lines: number[][][]): Graph {
  const ids = new Map<string, number>(), nodes: LL[] = [], adj: Graph['adj'] = [];
  const node = (c: number[]) => {
    const p = { lon: c[0], lat: c[1] }, k = keyOf(p);
    let id = ids.get(k);
    if (id == null) { id = nodes.length; ids.set(k, id); nodes.push(p); adj.push([]); }
    return id;
  };
  for (const line of lines) {
    let prev = -1;
    for (const c of line) {
      const id = node(c);
      if (prev >= 0 && prev !== id) {
        const w = distanceM(nodes[prev], nodes[id]);
        adj[prev].push({ to: id, w }); adj[id].push({ to: prev, w });
      }
      prev = id;
    }
  }
  const g = { nodes, adj };
  joinLooseEnds(g);
  return g;
}

/** Join loose trail ends to the nearest other trail point within 25 m (agency lines often stop just short of a junction). */
function joinLooseEnds(g: Graph) {
  const cell = (p: LL) => `${Math.floor(p.lon / 3e-4)}:${Math.floor(p.lat / 2.3e-4)}`; // ~25 m cells
  const grid = new Map<string, number[]>();
  g.nodes.forEach((p, i) => { const k = cell(p); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  for (let i = 0; i < g.nodes.length; i++) {
    if (g.adj[i].length !== 1) continue;
    const p = g.nodes[i], [cx, cy] = cell(p).split(':').map(Number);
    let best = -1, bd = 25;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      if (j === i || g.adj[i].some(e => e.to === j)) continue;
      const d = distanceM(p, g.nodes[j]);
      if (d < bd && d > 0) { bd = d; best = j; }
    }
    if (best >= 0) { g.adj[i].push({ to: best, w: bd }); g.adj[best].push({ to: i, w: bd }); }
  }
}

/** Trail lines from the full-detail (zoom 12) trail tiles covering a box; saved tiles work with no signal. */
export async function loadTrailLines(tileUrl: string, a: LL, b: LL, margin = 0.02): Promise<number[][][]> {
  const z = 12, n = 2 ** z;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const west = Math.min(a.lon, b.lon) - margin, east = Math.max(a.lon, b.lon) + margin;
  const south = Math.min(a.lat, b.lat) - margin, north = Math.max(a.lat, b.lat) + margin;
  const x0 = tx(west), x1 = tx(east), y0 = ty(north), y1 = ty(south);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 144) return []; // too far for this (over ~100 km): use the recorded track or straight line
  const jobs: Promise<number[][][]>[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push(fetch(tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))).then(async r => {
      if (!r.ok) return [];
      const t = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
      const layer = t.layers.trails; if (!layer) return [];
      const out: number[][][] = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.properties.utv === 'closed') continue;
        const g = f.toGeoJSON(x, y, z).geometry;
        if (g.type === 'LineString') out.push(g.coordinates as number[][]);
        else if (g.type === 'MultiLineString') out.push(...(g.coordinates as number[][][]));
      }
      return out;
    }).catch(() => []));
  }
  return (await Promise.all(jobs)).flat();
}

function nearestNode(g: Graph, p: LL, within: number): { id: number; d: number } | null {
  let best = -1, bd = within;
  for (let i = 0; i < g.nodes.length; i++) {
    if (!g.adj[i].length) continue;
    const d = distanceM(p, g.nodes[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return best < 0 ? null : { id: best, d: bd };
}

/** Shortest path on the trail graph from a to b (each end may be up to 400 m off a trail). */
export function trailRoute(g: Graph, a: LL, b: LL): Route | null {
  const s = nearestNode(g, a, 400), t = nearestNode(g, b, 400);
  if (!s || !t) return null;
  const n = g.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap: [number, number][] = []; // [distance, node], binary min-heap
  const push = (d: number, v: number) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  dist[s.id] = 0; push(0, s.id);
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    if (v === t.id) break;
    if (d > 80000) break; // don't search beyond ~50 miles of trail
    for (const e of g.adj[v]) { const nd = d + e.w; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = v; push(nd, e.to); } }
  }
  const walk = (end: number) => { const path: LL[] = []; for (let v = end; v >= 0; v = prev[v]) path.push(g.nodes[v]); return path.reverse(); };
  if (Number.isFinite(dist[t.id])) return { coords: [a, ...walk(t.id), b], length: s.d + dist[t.id] + t.d, via: 'trails' };
  // The trails here don't connect all the way (they often meet paved roads that aren't in the trail data). Go as far
  // as the trails reach toward the destination, then straight from there, but only if that gets you meaningfully closer.
  const direct = distanceM(a, b);
  let best = -1, bestScore = Infinity, bestLeft = direct;
  for (let v = 0; v < n; v++) {
    if (!Number.isFinite(dist[v])) continue;
    const left = distanceM(g.nodes[v], b), score = dist[v] + left * 1.5;
    if (score < bestScore) { bestScore = score; best = v; bestLeft = left; }
  }
  if (best < 0 || bestLeft > direct * 0.7) return null;
  const path = walk(best);
  return { coords: [a, ...path, b], length: s.d + dist[best] + bestLeft, via: 'mixed', straightFrom: path.length };
}

/** Back along recorded tracks: from the point nearest you to the point nearest the destination (each within 300 m). */
export function trackRoute(tracks: LL[][], a: LL, b: LL): Route | null {
  let best: Route | null = null;
  for (const pts of tracks) {
    if (pts.length < 2) continue;
    let ia = -1, da = 300, ib = -1, db = 300;
    for (let i = 0; i < pts.length; i++) {
      const x = distanceM(a, pts[i]), y = distanceM(b, pts[i]);
      if (x < da) { da = x; ia = i; }
      if (y < db) { db = y; ib = i; }
    }
    if (ia < 0 || ib < 0) continue;
    const seg = ia <= ib ? pts.slice(ia, ib + 1) : pts.slice(ib, ia + 1).reverse();
    const coords = [a, ...seg, b];
    const r: Route = { coords, length: pathLength(coords), via: 'track' };
    if (!best || r.length < best.length) best = r;
  }
  return best;
}

export function pathLength(c: LL[]) { let s = 0; for (let i = 1; i < c.length; i++) s += distanceM(c[i - 1], c[i]); return s; }

/** Where you are along a route: the nearest point, how far off it you are, and what's left to drive. */
export function progress(r: Route, p: LL, from = 0): { index: number; off: number; remaining: number; ahead: LL } {
  let idx = from, off = Infinity;
  // Look a little behind and well ahead of the last spot, so a loop in the route can't jump you forward.
  for (let i = Math.max(0, from - 5); i < r.coords.length; i++) { const d = distanceM(p, r.coords[i]); if (d < off) { off = d; idx = i; } }
  let remaining = distanceM(p, r.coords[idx]);
  for (let i = idx + 1; i < r.coords.length; i++) remaining += distanceM(r.coords[i - 1], r.coords[i]);
  // A point ~80 m ahead along the route: the arrow points there.
  let ahead = r.coords[r.coords.length - 1], acc = 0;
  for (let i = idx + 1; i < r.coords.length; i++) { acc += distanceM(r.coords[i - 1], r.coords[i]); if (acc >= 80) { ahead = r.coords[i]; break; } }
  return { index: idx, off, remaining, ahead };
}
