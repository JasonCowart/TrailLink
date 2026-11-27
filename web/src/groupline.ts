// Group line: where each rider is along the trail compared to everyone else, so you can see who's falling behind.
// Every rider's recent path (breadcrumbs from the shared positions, kept on this phone) is collected; the longest one
// (whoever has ridden farthest) becomes the reference trail, and each rider is placed by how far along it they are.
import { distanceM } from '../../src/core/geo.ts';

export interface LL { lat: number; lon: number }
export interface LinePlace { riderId: string; along: number }

const MAX_POINTS = 2000;

export class Breadcrumbs {
  private paths: Record<string, LL[]>;
  constructor(private key: string) {
    try { this.paths = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { this.paths = {}; }
  }
  /** Add a rider's latest position (ignored unless they moved 15 m). */
  add(riderId: string, p: LL) {
    const path = (this.paths[riderId] ??= []);
    const last = path[path.length - 1];
    if (last && distanceM(last, p) < 15) return;
    path.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) });
    if (path.length > MAX_POINTS) path.splice(0, path.length - MAX_POINTS);
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.paths)); } catch { /* full */ } }
  clear() { this.paths = {}; this.save(); }
  /** Place each rider along the longest path. Riders more than 250 m off it aren't placed. */
  places(now: Record<string, LL>): { ref: LL[]; length: number; places: LinePlace[] } | null {
    let ref: LL[] = [], refLen = 0;
    for (const path of Object.values(this.paths)) {
      let len = 0; for (let i = 1; i < path.length; i++) len += distanceM(path[i - 1], path[i]);
      if (len > refLen) { refLen = len; ref = path; }
    }
    if (ref.length < 2 || refLen < 100) return null;
    const cum = [0]; for (let i = 1; i < ref.length; i++) cum.push(cum[i - 1] + distanceM(ref[i - 1], ref[i]));
    const places: LinePlace[] = [];
    for (const [riderId, p] of Object.entries(now)) {
      let best = -1, bd = 250;
      for (let i = 0; i < ref.length; i++) { const d = distanceM(p, ref[i]); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) places.push({ riderId, along: cum[best] });
    }
    return places.length >= 2 ? { ref, length: refLen, places } : null;
  }
}
