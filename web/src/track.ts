// Ride recording, pins, and GPX export. Stored on the phone (localStorage).
import { distanceM } from '../../src/core/geo.ts';

export interface Pt { lat: number; lon: number; t: number; alt?: number }
export interface Pin { id: string; kind: 'regroup' | 'hazard' | 'note' | 'photo' | 'report' | 'camp'; lat: number; lon: number; t: number; note?: string; photos?: string[]; report?: string;
  /** Set when shared: the id in the shared database, and who sees it (all riders for hazard reports, or the ride group). */
  sid?: string; share?: 'all' | 'group'; groupId?: string;
  /** Seen in the shared database at least once (so a missing copy means it was removed, not that it never uploaded). */
  up?: boolean;
  /** When another rider (or I) marked this hazard cleared; it then lives in the Cleared list, not my pins. */
  cleared?: string;
  /** Saved by the SOS button: strobes on my map while my help alert is active. */
  sos?: boolean }
export interface Track { id: string; name: string; points: Pt[]; startedAt: number; endedAt?: number }

const load = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

export const store = {
  tracks: () => load<Track[]>('traillink.tracks', []),
  saveTracks: (t: Track[]) => { save('traillink.tracks', t); store.onSave('tracks'); },
  pins: () => load<Pin[]>('traillink.pins', []),
  savePins: (p: Pin[]) => { save('traillink.pins', p); store.onSave('pins'); },
  get: <T>(k: string, d: T) => load<T>(`traillink.${k}`, d),
  set: (k: string, v: unknown) => { save(`traillink.${k}`, v); store.onSave(k); },
  /** Called after every save (the account backup listens here). */
  onSave: (_key: string) => {},
};

export function stats(points: Pt[]) {
  let dist = 0, gain = 0, moving = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const d = distanceM(a, b);
    dist += d;
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && d / dt > 0.7 && dt < 120) moving += dt;
    if (a.alt != null && b.alt != null && b.alt > a.alt) gain += b.alt - a.alt;
  }
  return { miles: dist / 1609.344, movingMin: Math.round(moving / 60), gainFt: Math.round(gain * 3.28084) };
}

/** Keep a point only if we moved at least 8 m or 30 s passed: keeps long rides small. */
export function shouldKeep(last: Pt | undefined, p: Pt) {
  return !last || distanceM(last, p) >= 8 || p.t - last.t >= 30_000;
}

export function toGpx(t: Track, pins: Pin[]): string {
  const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
  const wpts = pins.map(p => `  <wpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time><name>${esc(p.note || p.kind)}</name></wpt>`).join('\n');
  const pts = t.points.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailLink" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <trk><name>${esc(t.name)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}
