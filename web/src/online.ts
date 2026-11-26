// Community data shared through the TrailLink database (PostgreSQL on Supabase).
// Works offline first: every change is saved on the phone (LocalCommunity) and queued; the queue uploads
// whenever the rider is signed in and has signal. Shared ratings and rider trails are cached for offline use.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { LocalCommunity, type Community, type CommunityScore, type RiderTrail } from './community.ts';
import { SUPABASE_KEY, SUPABASE_URL } from './config.ts';

type Op =
  | { k: 'rate'; tid: string; n: number }
  | { k: 'unrate'; tid: string }
  | { k: 'trail'; t: RiderTrail }
  | { k: 'deltrail'; id: string }
  | { k: 'confirm'; id: string };

interface RemoteTrailRow {
  id: string; name: string; difficulty: number; vehicles: RiderTrail['vehicles']; notes: string | null;
  created_at: string; confirmations: number; verified: boolean; created_by: string; created_by_id: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

export interface AdminRider {
  email: string; rider_id: string | null; display_name: string | null; invited_at: string | null; joined_at: string | null;
  last_seen: string | null; is_reviewer: boolean; is_admin: boolean; ratings: number; trails: number;
}

export type SyncState = 'offline' | 'syncing' | 'up-to-date' | 'error';

export class OnlineCommunity implements Community {
  mode: 'local' | 'online' = 'local';
  private local = new LocalCommunity();
  private sb: SupabaseClient;
  session: Session | null = null;
  private profileName: string | null = read('traillink.profileName', null);
  private outbox: Op[] = read('traillink.outbox', []);
  private cachedScores = new Map<string, CommunityScore>(Object.entries(read<Record<string, CommunityScore>>('traillink.scores', {})));
  private remote: RiderTrail[] = read('traillink.remoteTrails', []);
  private confirmed = new Set<string>(read<string[]>('traillink.confirmed', []));
  isAdmin: boolean = read('traillink.isAdmin', false);
  syncState: SyncState = 'offline';
  lastSynced: string | null = read('traillink.lastSynced', null);
  onChange: () => void = () => {};

  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'traillink.auth' },
    });
  }

  async init() {
    const { data } = await this.sb.auth.getSession();
    this.session = data.session;
    this.sb.auth.onAuthStateChange((event, s) => {
      this.session = s;
      if (event === 'SIGNED_IN') { write('traillink.everSignedIn', true); void this.afterSignIn(); }
      this.onChange();
    });
    if (this.session) { write('traillink.everSignedIn', true); await this.afterSignIn(); } else this.onChange();
  }

  // ---------------------------------------------------------------- sign-in (emailed 6-digit code or link; no passwords)
  get signedIn() { return !!this.session; }
  get email() { return this.session?.user.email ?? null; }
  async sendCode(email: string, name: string) {
    if (name.trim()) this.setName(name);
    const redirect = `${location.origin}${location.pathname}`;
    // Invite-only: a rider's account is created on first sign-in, but the database refuses emails that aren't on the admin's invite list.
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    if (error) {
      const m = `${error.message} ${error.code ?? ''}`;
      throw new Error(/rate limit|over_email_send_rate/i.test(m) ? 'TrailLink has sent too many sign-in emails this hour. Try again in a little while.'
        : /invited|signup|not allowed|not found|otp_disabled/i.test(m) ? "That email hasn't been invited to TrailLink. Ask your ride leader for an invite."
        : error.message);
    }
  }
  async verifyCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) throw new Error(error.message);
  }
  async signOut() { await this.sb.auth.signOut(); this.session = null; this.isAdmin = false; write('traillink.isAdmin', false); write('traillink.everSignedIn', false); this.onChange(); }
  /** True once this phone has signed in, so the app keeps opening on the trail even if the session can't refresh offline. */
  get trusted() { return this.signedIn || read('traillink.everSignedIn', false); }

  private async afterSignIn() {
    if (!this.session) return;
    const name = this.profileName || this.local.me()?.name;
    const { data } = await this.sb.from('profiles').select('display_name,is_admin').eq('id', this.session.user.id).maybeSingle();
    if (data?.display_name && !name) this.setName(data.display_name);
    this.isAdmin = !!data?.is_admin; write('traillink.isAdmin', this.isAdmin); this.onChange();
    const display = (data?.display_name as string | undefined) ?? name ?? this.session.user.email?.split('@')[0] ?? 'Rider';
    if (!data) await this.sb.from('profiles').insert({ id: this.session.user.id, display_name: display.slice(0, 40) });
    else if (name && name !== data.display_name) await this.sb.from('profiles').update({ display_name: name.slice(0, 40) }).eq('id', this.session.user.id);
    // Restore this rider's ratings from the database (e.g. on a new phone), then upload anything queued.
    const mine = await this.sb.from('ratings').select('tid,difficulty').eq('rider_id', this.session.user.id);
    if (!mine.error) {
      const pending = new Set(this.outbox.filter(o => o.k === 'rate' || o.k === 'unrate').map(o => (o as { tid: string }).tid));
      for (const r of mine.data as { tid: string; difficulty: number }[]) if (!pending.has(r.tid)) await this.local.rate(r.tid, r.difficulty);
    }
    await this.sync();
  }

  // ---------------------------------------------------------------- Community interface
  me() {
    const name = this.profileName ?? this.local.me()?.name ?? null;
    if (!name) return null;
    return { id: this.session?.user.id ?? this.local.me()?.id ?? 'local', name };
  }
  setName(name: string) { this.profileName = name.trim(); write('traillink.profileName', this.profileName); this.local.setName(name); }
  myRatings() { return this.local.myRatings(); }
  async rate(tid: string, n: number) { await this.local.rate(tid, n); this.queue({ k: 'rate', tid, n }); }
  async clearRating(tid: string) { await this.local.clearRating(tid); this.queue({ k: 'unrate', tid }); }
  scores() {
    const m = new Map(this.cachedScores);
    // Until the database has counted it, a fresh local vote stands in for the community score.
    for (const [tid, n] of this.local.myRatings()) if (!m.has(tid)) m.set(tid, { avg: n, count: 1 });
    for (const t of this.trails()) if (!m.has(`RIDER:${t.id}`)) m.set(`RIDER:${t.id}`, { avg: t.difficulty, count: 1 });
    return m;
  }
  trails() {
    const mine = this.local.trails();
    const ids = new Set(mine.map(t => t.id));
    return [...mine, ...this.remote.filter(t => !ids.has(t.id))];
  }
  isMine(t: RiderTrail) { return this.local.trails().some(x => x.id === t.id) || (!!this.session && t.createdById === this.session.user.id); }
  async addTrail(t: Omit<RiderTrail, 'id' | 'createdBy' | 'createdById' | 'createdAt'>) {
    const full = await this.local.addTrail(t);
    this.queue({ k: 'trail', t: full });
    return full;
  }
  async deleteTrail(id: string) {
    await this.local.deleteTrail(id);
    this.remote = this.remote.filter(t => t.id !== id); write('traillink.remoteTrails', this.remote);
    this.queue({ k: 'deltrail', id });
  }
  hasConfirmed(id: string) { return this.confirmed.has(id); }
  async confirmTrail(id: string) { this.confirmed.add(id); write('traillink.confirmed', [...this.confirmed]); this.queue({ k: 'confirm', id }); }
  pendingCount() { return this.outbox.length; }

  // ---------------------------------------------------------------- admin tools (need signal; the database checks the rider is an admin)
  private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    if (!navigator.onLine) throw new Error('No signal. Managing riders needs a connection.');
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  adminRiders() { return this.rpc<AdminRider[]>('admin_riders'); }
  adminInvite(email: string) { return this.rpc<void>('admin_invite', { p_email: email }); }
  adminRemove(email: string) { return this.rpc<void>('admin_remove', { p_email: email }); }
  adminSetRole(riderId: string, reviewer: boolean, admin: boolean) { return this.rpc<void>('admin_set_role', { p_rider: riderId, p_reviewer: reviewer, p_admin: admin }); }

  // ---------------------------------------------------------------- upload queue and download
  private queue(op: Op) {
    // A newer change to the same thing replaces the older one.
    const key = (o: Op) => (o.k === 'rate' || o.k === 'unrate' ? `r:${o.tid}` : o.k === 'trail' ? `t:${o.t.id}` : o.k === 'deltrail' ? `t:${o.id}` : `c:${o.id}`);
    this.outbox = [...this.outbox.filter(o => key(o) !== key(op)), op];
    write('traillink.outbox', this.outbox);
    void this.sync();
  }

  private async run(op: Op): Promise<'done' | 'retry' | 'drop'> {
    const uid = this.session!.user.id;
    const res =
      op.k === 'rate' ? await this.sb.from('ratings').upsert({ tid: op.tid, rider_id: uid, difficulty: op.n, rated_at: new Date().toISOString() }, { onConflict: 'tid,rider_id' })
      : op.k === 'unrate' ? await this.sb.from('ratings').delete().eq('tid', op.tid).eq('rider_id', uid)
      : op.k === 'trail' ? await this.sb.from('rider_trails').upsert({
          id: op.t.id, name: op.t.name, difficulty: op.t.difficulty, vehicles: op.t.vehicles, notes: op.t.notes ?? null, created_at: op.t.createdAt,
          geom: `SRID=4326;LINESTRING(${op.t.coords.map(([x, y]) => `${x} ${y}`).join(',')})`,
        }, { onConflict: 'id', ignoreDuplicates: true })
      : op.k === 'deltrail' ? await this.sb.from('rider_trails').delete().eq('id', op.id)
      : await this.sb.from('trail_confirmations').insert({ trail_id: op.id });
    if (!res.error) return 'done';
    // Network trouble: keep it for later. Anything the database refuses (bad data, not allowed, duplicate): drop it.
    const msg = `${res.error.message} ${res.error.code ?? ''}`;
    if (/fetch|network|timeout|Failed to/i.test(msg) || !res.error.code) return 'retry';
    console.warn('TrailLink: change refused by the database', op, res.error);
    return 'drop';
  }

  private syncing: Promise<void> | null = null;
  sync(): Promise<void> {
    if (!this.syncing) this.syncing = this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }
  private async doSync() {
    if (!navigator.onLine) { this.syncState = 'offline'; this.onChange(); return; }
    // Invite-only: community data is readable only by signed-in riders.
    if (!this.session) { this.syncState = 'offline'; this.onChange(); return; }
    this.syncState = 'syncing';
    try {
      if (this.session) {
        while (this.outbox.length) {
          const r = await this.run(this.outbox[0]);
          if (r === 'retry') break;
          this.outbox.shift(); write('traillink.outbox', this.outbox);
        }
      }
      const [scores, trails] = await Promise.all([
        this.sb.from('trail_scores').select('tid,avg,count').limit(50000),
        this.sb.from('rider_trails_public').select('*').limit(5000),
      ]);
      if (scores.error || trails.error) throw new Error((scores.error ?? trails.error)!.message);
      this.cachedScores = new Map((scores.data as { tid: string; avg: number; count: number }[]).map(s => [s.tid, { avg: Number(s.avg), count: s.count }]));
      this.remote = (trails.data as RemoteTrailRow[]).map(r => ({
        id: r.id, name: r.name, difficulty: r.difficulty, vehicles: r.vehicles, notes: r.notes ?? undefined,
        createdBy: r.created_by, createdById: r.created_by_id, createdAt: r.created_at, coords: r.geometry.coordinates,
        verified: r.verified, confirmations: r.confirmations,
      }));
      write('traillink.scores', Object.fromEntries(this.cachedScores));
      write('traillink.remoteTrails', this.remote);
      this.lastSynced = new Date().toISOString(); write('traillink.lastSynced', this.lastSynced);
      this.mode = 'online';
      this.syncState = this.outbox.length && this.session ? 'error' : 'up-to-date';
    } catch (e) {
      console.warn('TrailLink: sync failed', e);
      this.syncState = navigator.onLine ? 'error' : 'offline';
    }
    this.onChange();
  }
}
