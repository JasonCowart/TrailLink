// Trail badges: badge trails (picked by the admin) and milestones. Everything here runs on the phone, offline:
// a badge trail is earned when a recorded ride covers most of it.
import type { Pt, Track } from './track.ts';

export interface BadgeTrail {
  id: string; name: string; description?: string; tids: string[];
  geom: { type: 'MultiLineString'; coordinates: [number, number][][] };
  difficulty?: number; color: string; icon: BadgeIcon; minCoverage: number; active: boolean;
}
export type BadgeIcon = 'peak' | 'tree' | 'rock' | 'water' | 'canyon' | 'snow' | 'flag' | 'wheel' | 'star';
export const BADGE_ICONS: BadgeIcon[] = ['peak', 'tree', 'rock', 'water', 'canyon', 'snow', 'flag', 'wheel', 'star'];
export const BADGE_COLORS = ['#E8501A', '#1F4D3A', '#1D4ED8', '#B5482A', '#7C3AED', '#0D9488', '#B45309', '#1D221D'];

// ---------------------------------------------------------------- did a ride cover the trail?
const R = 6371000, rad = Math.PI / 180;
function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * R;
}
/** Points every ~40 m along the badge trail. */
function samples(geom: BadgeTrail['geom'], step = 40): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (const line of geom.coordinates) {
    for (let i = 1; i < line.length; i++) {
      const a = { lon: line[i - 1][0], lat: line[i - 1][1] }, b = { lon: line[i][0], lat: line[i][1] };
      const n = Math.max(1, Math.round(distM(a, b) / step));
      for (let k = 0; k < n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
    }
    const last = line[line.length - 1]; if (last) out.push({ lon: last[0], lat: last[1] });
  }
  return out;
}
/** Share of the badge trail (0–1) that a ride passed within `tol` metres of. */
export function coverage(trail: BadgeTrail, points: Pt[], tol = 45): number {
  const pts = samples(trail.geom);
  if (!pts.length || points.length < 2) return 0;
  // Grid the ride's points (~110 m cells) so each check looks only at nearby points.
  const cell = 0.001, grid = new Map<string, Pt[]>();
  const key = (lat: number, lon: number) => `${Math.floor(lat / cell)}:${Math.floor(lon / cell)}`;
  for (const p of points) { const k = key(p.lat, p.lon); (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
  let hit = 0;
  for (const s of pts) {
    const cy = Math.floor(s.lat / cell), cx = Math.floor(s.lon / cell);
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++)
      for (const p of grid.get(`${cy + dy}:${cx + dx}`) ?? []) if (distM(s, p) <= tol) { ok = true; break; }
    if (ok) hit++;
  }
  return hit / pts.length;
}
export function bbox(geom: BadgeTrail['geom']) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const l of geom.coordinates) for (const [x, y] of l) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return { w, s, e, n };
}
const overlaps = (t: Track, b: ReturnType<typeof bbox>) => t.points.some(p => p.lon >= b.w - 0.01 && p.lon <= b.e + 0.01 && p.lat >= b.s - 0.01 && p.lat <= b.n + 0.01);
/** Badge trails a ride earned: [{trail, coverage}] for those at or over the trail's minimum. */
export function earnedOnRide(trails: BadgeTrail[], ride: Track) {
  return trails.filter(t => t.active && overlaps(ride, bbox(t.geom)))
    .map(t => ({ trail: t, coverage: coverage(t, ride.points) }))
    .filter(x => x.coverage * 100 >= x.trail.minCoverage);
}

// ---------------------------------------------------------------- milestones
export interface RiderStats {
  rides: number; miles: number; climbFt: number; maxRated: number; trailsAdded: number;
  reports: number; clears: number; groupRides: number; inColorado: boolean; inUtah: boolean; badgeTrails: number;
}
export interface Milestone { key: string; name: string; how: string; icon: BadgeIcon; color: string; goal: number; value: (s: RiderStats) => number; unit?: string }
const BRONZE = '#B4723B', SILVER = '#7B8794', GOLD = '#C99A06';
export const MILESTONES: Milestone[] = [
  { key: 'first_ride', name: 'First Tracks', how: 'Record your first ride', icon: 'flag', color: '#1F4D3A', goal: 1, value: s => s.rides },
  { key: 'miles_10', name: '10 Miles', how: 'Ride 10 miles in total', icon: 'wheel', color: BRONZE, goal: 10, value: s => s.miles, unit: 'mi' },
  { key: 'miles_100', name: '100 Miles', how: 'Ride 100 miles in total', icon: 'wheel', color: SILVER, goal: 100, value: s => s.miles, unit: 'mi' },
  { key: 'miles_500', name: '500 Miles', how: 'Ride 500 miles in total', icon: 'wheel', color: GOLD, goal: 500, value: s => s.miles, unit: 'mi' },
  { key: 'climb_10k', name: 'Climber', how: 'Climb 10,000 ft in total', icon: 'peak', color: BRONZE, goal: 10000, value: s => s.climbFt, unit: 'ft' },
  { key: 'climb_50k', name: 'High Country', how: 'Climb 50,000 ft in total', icon: 'peak', color: GOLD, goal: 50000, value: s => s.climbFt, unit: 'ft' },
  { key: 'difficult', name: 'Black Diamond', how: 'Rate a Difficult trail (6+)', icon: 'rock', color: '#111827', goal: 6, value: s => s.maxRated },
  { key: 'extreme', name: 'Red Line', how: 'Rate an Extreme trail (8+)', icon: 'rock', color: '#DC2626', goal: 8, value: s => s.maxRated },
  { key: 'trailblazer', name: 'Trailblazer', how: 'Add a trail to the map', icon: 'tree', color: '#0D9488', goal: 1, value: s => s.trailsAdded },
  { key: 'spotter', name: 'Spotter', how: 'Report 5 trail hazards', icon: 'star', color: '#F59E0B', goal: 5, value: s => s.reports },
  { key: 'trail_keeper', name: 'Trail Keeper', how: 'Mark a hazard cleared', icon: 'star', color: '#16A34A', goal: 1, value: s => s.clears },
  { key: 'pack', name: 'Pack Ride', how: 'Share your location on a group ride', icon: 'flag', color: '#1D4ED8', goal: 1, value: s => s.groupRides },
  { key: 'colorado', name: 'Colorado', how: 'Ride in Colorado', icon: 'snow', color: '#1D4ED8', goal: 1, value: s => (s.inColorado ? 1 : 0) },
  { key: 'utah', name: 'Utah', how: 'Ride in Utah', icon: 'canyon', color: '#B5482A', goal: 1, value: s => (s.inUtah ? 1 : 0) },
  { key: 'collector', name: 'Badge Hunter', how: 'Earn 3 badge trails', icon: 'star', color: '#7C3AED', goal: 3, value: s => s.badgeTrails },
];
// Rough state boxes (good enough for "rode in this state").
const CO = { w: -109.06, e: -102.04, s: 36.99, n: 41.0 }, UT = { w: -114.05, e: -109.04, s: 36.99, n: 42.0 };
export const inBox = (p: { lat: number; lon: number }, b: typeof CO) => p.lon >= b.w && p.lon <= b.e && p.lat >= b.s && p.lat <= b.n;
export const rodeIn = (tracks: Track[], st: 'CO' | 'UT') => tracks.some(t => t.points.some(p => inBox(p, st === 'CO' ? CO : UT)));

// ---------------------------------------------------------------- badge art (drawn, so it works offline and prints later)
const ICON_PATHS: Record<BadgeIcon, string> = {
  peak: '<path d="M22 68 L42 38 L50 50 L60 34 L78 68 Z" fill="#fff"/><path d="M42 38 L47 46 L43 45 L39 48 Z" fill="currentColor" opacity=".35"/>',
  tree: '<path d="M50 26 L64 48 H57 L68 64 H32 L43 48 H36 Z" fill="#fff"/><rect x="47" y="64" width="6" height="8" fill="#fff"/>',
  rock: '<path d="M26 68 L34 48 L46 40 L60 44 L72 56 L74 68 Z" fill="#fff"/><path d="M46 40 L52 56 L72 56" fill="none" stroke="currentColor" stroke-width="3" opacity=".35"/>',
  water: '<path d="M24 52 C 32 44, 40 60, 50 52 S 68 44, 76 52" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M24 66 C 32 58, 40 74, 50 66 S 68 58, 76 66" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  canyon: '<path d="M22 70 V44 H36 V56 H46 V36 H56 V52 H64 V42 H78 V70 Z" fill="#fff"/>',
  snow: '<g stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M50 28 V72"/><path d="M31 39 L69 61"/><path d="M31 61 L69 39"/></g>',
  flag: '<path d="M38 72 V28" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M40 30 H68 L62 40 L68 50 H40 Z" fill="#fff"/>',
  wheel: '<circle cx="50" cy="50" r="20" fill="none" stroke="#fff" stroke-width="7"/><circle cx="50" cy="50" r="6" fill="#fff"/><g stroke="#fff" stroke-width="4"><path d="M50 30 V44"/><path d="M50 56 V70"/><path d="M30 50 H44"/><path d="M56 50 H70"/></g>',
  star: '<path d="M50 26 L56 43 L74 43 L60 54 L65 72 L50 61 L35 72 L40 54 L26 43 L44 43 Z" fill="#fff"/>',
};
/** A hexagon badge. Locked badges are grey. */
export function badgeSvg(icon: BadgeIcon, color: string, size: number, locked = false, label = ''): string {
  const c = locked ? '#B9BEC4' : color;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" ${label ? `role="img" aria-label="${label.replace(/"/g, '')}"` : 'aria-hidden="true"'} style="display:block;color:${c}">
    <path d="M50 4 L90 27 V73 L50 96 L10 73 V27 Z" fill="${c}" stroke="#fff" stroke-width="3"/>
    <path d="M50 11 L84 31 V69 L50 89 L16 69 V31 Z" fill="none" stroke="#fff" stroke-width="2" opacity=".5" stroke-dasharray="3 3"/>
    <g opacity="${locked ? 0.7 : 1}">${ICON_PATHS[icon] ?? ICON_PATHS.peak}</g></svg>`;
}
