// "Get me out": a route back to safety (where the ride started, a regroup point, camp, a rider) that works with no
// signal. Two ways to get there, and the shorter wins:
//  1. Along the trail network on the phone (the saved trail map tiles), joined into a graph and searched (Dijkstra).
//  2. Back along your own recorded track (you know you can drive it).
// If neither reaches, it falls back to a straight line with distance and direction.
import { distanceM } from '../../src/core/geo.ts';

export interface LL { lat: number; lon: number }
export interface Route { coords: LL[]; length: number; via: 'trails' | 'track' | 'straight' }

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
  return { nodes, adj };
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
    for (const e of g.adj[v]) { const nd = d + e.w; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = v; push(nd, e.to); } }
  }
  if (!Number.isFinite(dist[t.id])) return null;
  const path: LL[] = [];
  for (let v = t.id; v >= 0; v = prev[v]) path.push(g.nodes[v]);
  path.reverse();
  return { coords: [a, ...path, b], length: s.d + dist[t.id] + t.d, via: 'trails' };
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
