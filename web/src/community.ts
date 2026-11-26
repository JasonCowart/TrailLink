// Difficulty ratings and rider-created trails.
// One TrailLink scale everywhere: a 1-10 number, shown on the map as four colours.
// Storage is behind the Community interface: LocalCommunity keeps everything on this phone today;
// a database-backed version (PostgreSQL via Supabase, see supabase/schema.sql) plugs in with the same methods.

export interface Level { n: number; color: string; band: 'Easy' | 'Moderate' | 'Difficult' | 'Extreme'; text: string }

export const BAND_COLORS = { Easy: '#15803D', Moderate: '#1D4ED8', Difficult: '#111827', Extreme: '#DC2626' } as const;
export const UNRATED_COLOR = '#9CA3AF';

const band = (n: number): Level['band'] => (n <= 3 ? 'Easy' : n <= 5 ? 'Moderate' : n <= 7 ? 'Difficult' : 'Extreme');

/** What each number means for a UTV, so every rider votes by the same yardstick. Dry conditions. */
export const LEVELS: Level[] = [
  'Graded dirt or gravel road. Any vehicle.',
  'Ungraded dirt road, small ruts and rocks. High clearance helps.',
  'Rough two-track, rocks under 8 in., shallow water. Stock UTV is fine.',
  'Rocky and rutted, steeper grades, ledges up to 12 in. Pick your line.',
  'Loose climbs, rocks up to 15 in., narrow shelf sections. Low gear needed.',
  'Large rocks and ledges up to 18 in., off-camber spots. Skid plates advised.',
  'Ledges up to 24 in., tight turns, body contact likely. Experienced drivers.',
  'Big ledges and boulders, rollover risk. Lifted or long-travel UTV, a spotter.',
  'Obstacles over 30 in., winch likely needed. Modified vehicles only.',
  'Highest consequence; vehicle damage expected. Experts with recovery gear.',
].map((text, i) => ({ n: i + 1, text, band: band(i + 1), color: BAND_COLORS[band(i + 1)] }));

export const levelOf = (n: number) => LEVELS[Math.min(10, Math.max(1, Math.round(n))) - 1];

/** MapLibre expression: a number (or null) to its band colour. */
export const stepColor = (v: unknown) => ['step', v, BAND_COLORS.Easy, 3.5, BAND_COLORS.Moderate, 5.5, BAND_COLORS.Difficult, 7.5, BAND_COLORS.Extreme];

export type VehicleFit = 'utv' | 'narrow' | 'moto' | 'unknown';
export const VEHICLE_FIT: Record<VehicleFit, string> = {
  utv: 'UTVs of any width', narrow: 'Vehicles 50" and under', moto: 'Motorcycles only', unknown: 'Not sure',
};

export interface RiderTrail {
  id: string;
  name: string;
  difficulty: number;
  vehicles: VehicleFit;
  notes?: string;
  createdBy: string;
  createdById: string;
  createdAt: string; // ISO date and time
  coords: [number, number][];
  verified?: boolean;
  confirmations?: number;
}

export interface CommunityScore { avg: number; count: number }

export interface Community {
  readonly mode: 'local' | 'online';
  me(): { id: string; name: string } | null;
  setName(name: string): void;
  myRatings(): Map<string, number>;
  rate(tid: string, n: number): Promise<void>;
  clearRating(tid: string): Promise<void>;
  scores(): Map<string, CommunityScore>;
  trails(): RiderTrail[];
  addTrail(t: Omit<RiderTrail, 'id' | 'createdBy' | 'createdById' | 'createdAt'>): Promise<RiderTrail>;
  deleteTrail(id: string): Promise<void>;
  sync(): Promise<void>;
}

const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Everything on this phone. Your ratings count as the community rating until the shared database is connected. */
export class LocalCommunity implements Community {
  readonly mode = 'local' as const;
  private profile = read<{ id: string; name: string } | null>('traillink.profile', null);
  private ratings = new Map(Object.entries(read<Record<string, number>>('traillink.ratings', {})));
  private riderTrails = read<RiderTrail[]>('traillink.riderTrails', []);

  me() { return this.profile?.name ? this.profile : null; }
  setName(name: string) {
    this.profile = { id: this.profile?.id ?? uid(), name: name.trim() };
    write('traillink.profile', this.profile);
  }
  myRatings() { return new Map(this.ratings); }
  async rate(tid: string, n: number) { this.ratings.set(tid, n); write('traillink.ratings', Object.fromEntries(this.ratings)); }
  async clearRating(tid: string) { this.ratings.delete(tid); write('traillink.ratings', Object.fromEntries(this.ratings)); }
  scores() {
    const m = new Map<string, CommunityScore>();
    for (const [tid, n] of this.ratings) m.set(tid, { avg: n, count: 1 });
    for (const t of this.riderTrails) if (!m.has(`RIDER:${t.id}`)) m.set(`RIDER:${t.id}`, { avg: t.difficulty, count: 1 });
    return m;
  }
  trails() { return [...this.riderTrails]; }
  async addTrail(t: Omit<RiderTrail, 'id' | 'createdBy' | 'createdById' | 'createdAt'>) {
    const me = this.me();
    if (!me) throw new Error('Add your name first');
    const full: RiderTrail = { ...t, id: uid(), createdBy: me.name, createdById: me.id, createdAt: new Date().toISOString() };
    this.riderTrails.unshift(full);
    write('traillink.riderTrails', this.riderTrails);
    return full;
  }
  async deleteTrail(id: string) { this.riderTrails = this.riderTrails.filter(t => t.id !== id); write('traillink.riderTrails', this.riderTrails); }
  async sync() { /* nothing to sync until the database is connected */ }
}

/** Trail length in miles. */
export function lengthMiles(coords: [number, number][]) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1], [lon2, lat2] = coords[i];
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    m += 2 * 6371000 * Math.asin(Math.sqrt(h));
  }
  return m / 1609.344;
}
