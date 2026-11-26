// Community data shared through the TrailLink database (PostgreSQL on Supabase).
// Works offline first: every change is saved on the phone (LocalCommunity) and queued; the queue uploads
// whenever the rider is signed in and has signal. Shared ratings and rider trails are cached for offline use.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { LocalCommunity, type Community, type CommunityScore, type RiderTrail } from './community.ts';
import { SUPABASE_KEY, SUPABASE_URL } from './config.ts';
import { effectiveSlope, rigScore, type Vehicle } from './garage.ts';

type Op =
  | { k: 'rate'; tid: string; n: number; v?: string | null; s?: number | null }
  | { k: 'vehicle'; v: Vehicle }
  | { k: 'delvehicle'; id: string }
  | { k: 'unrate'; tid: string }
  | { k: 'trail'; t: RiderTrail }
  | { k: 'deltrail'; id: string }
  | { k: 'confirm'; id: string }
  | { k: 'pin'; p: PinUpload }
  | { k: 'unpin'; id: string }
  | { k: 'vote'; id: string; v: 'there' | 'cleared' };

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

export interface Group { id: string; name: string; code: string }
/** A pin as uploaded: hazard reports go to all riders; other pins only to the rider's group, if they choose. */
export interface PinUpload { id: string; audience: 'all' | 'group'; groupId: string | null; kind: string; report?: string; note?: string; lat: number; lon: number; createdAt: string }
export interface SharedPin extends PinUpload {
  riderId: string; by: string; status: 'active' | 'cleared'; clearedBy: string | null; clearedAt: string | null; lastConfirmed: string; confirmations: number;
}
export interface GroupMember {
  riderId: string; name: string; sharing: boolean; joinedAt: string;
  pos?: { lat: number; lon: number; acc: number | null; speed: number | null; heading: number | null; at: string };
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
  private vehicles: Vehicle[] = read('traillink.garage', []);
  private activeId: string | null = read('traillink.activeVehicle', null);
  private rigModel: { pairs: number; slope: number | null } | null = read('traillink.rigModel', null);
  isAdmin: boolean = read('traillink.isAdmin', false);
  isReviewer: boolean = read('traillink.isReviewer', false);
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
  async signOut() { await this.sb.auth.signOut(); this.session = null; this.group = null; this.members = []; this.saveGroup(); this.isAdmin = false; write('traillink.isAdmin', false); write('traillink.everSignedIn', false); this.onChange(); }
  /** True once this phone has signed in, so the app keeps opening on the trail even if the session can't refresh offline. */
  get trusted() { return this.signedIn || read('traillink.everSignedIn', false); }

  private async afterSignIn() {
    if (!this.session) return;
    const name = this.profileName || this.local.me()?.name;
    const { data } = await this.sb.from('profiles').select('display_name,is_admin,is_reviewer').eq('id', this.session.user.id).maybeSingle();
    if (data?.display_name && !name) this.setName(data.display_name);
    this.isAdmin = !!data?.is_admin; write('traillink.isAdmin', this.isAdmin);
    this.isReviewer = !!data?.is_reviewer || this.isAdmin; write('traillink.isReviewer', this.isReviewer); this.onChange();
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
  async rate(tid: string, n: number) {
    await this.local.rate(tid, n);
    // Record the rig the rider rode it in, so ratings can be adjusted for other setups.
    const v = this.activeVehicle();
    this.queue({ k: 'rate', tid, n, v: v?.id ?? null, s: v ? rigScore(v) : null });
  }

  // ---------------------------------------------------------------- garage (saved on the phone, shared when signed in)
  garage() { return [...this.vehicles]; }
  activeVehicle(): Vehicle | null { return this.vehicles.find(v => v.id === this.activeId) ?? this.vehicles[0] ?? null; }
  setActive(id: string) { this.activeId = id; write('traillink.activeVehicle', id); this.onChange(); }
  /** Difficulty levels per rig-score point: measured from riders' ratings once there are enough, otherwise a starting estimate. */
  rigSlope() { return effectiveSlope(this.rigModel); }
  saveVehicle(v: Omit<Vehicle, 'id' | 'updatedAt'> & { id?: string }) {
    const full: Vehicle = { ...v, id: v.id ?? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`), updatedAt: new Date().toISOString() };
    const i = this.vehicles.findIndex(x => x.id === full.id);
    if (i >= 0) this.vehicles[i] = full; else this.vehicles.push(full);
    write('traillink.garage', this.vehicles);
    if (i < 0 || !this.activeId) this.setActive(full.id);
    this.queue({ k: 'vehicle', v: full });
    return full;
  }
  deleteVehicle(id: string) {
    this.vehicles = this.vehicles.filter(v => v.id !== id); write('traillink.garage', this.vehicles);
    if (this.activeId === id) { this.activeId = this.vehicles[0]?.id ?? null; write('traillink.activeVehicle', this.activeId); }
    this.queue({ k: 'delvehicle', id });
  }
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

  // ---------------------------------------------------------------- ride groups (need signal to start, join or update; the last
  // known list and positions stay on the phone for when there's no signal)
  group: Group | null = read('traillink.group', null);
  members: GroupMember[] = read('traillink.groupMembers', []);
  groupUpdated: string | null = read('traillink.groupUpdated', null);
  get sharing() { const me = this.session?.user.id; return !!this.group && this.members.some(m => m.riderId === me && m.sharing); }
  private saveGroup() { write('traillink.group', this.group); write('traillink.groupMembers', this.members); write('traillink.groupUpdated', this.groupUpdated); }
  private needSignal() { if (!navigator.onLine) throw new Error('No signal. Try again when you have service.'); if (!this.session) throw new Error('Sign in first (Trails tab).'); }

  async createGroup(name: string) {
    this.needSignal();
    const { data, error } = await this.sb.rpc('create_group', { p_name: name });
    if (error) throw new Error(error.message);
    this.group = { id: data.id, name: data.name, code: data.code }; this.members = []; await this.refreshGroup();
  }
  async joinGroup(code: string) {
    this.needSignal();
    const { data, error } = await this.sb.rpc('join_group', { p_code: code });
    if (error) throw new Error(error.message);
    if (this.group && this.group.id !== data.id) await this.sb.rpc('leave_group', { p_group: this.group.id });
    this.group = { id: data.id, name: data.name, code: data.code }; this.members = []; await this.refreshGroup();
  }
  async leaveGroup() {
    this.needSignal();
    if (this.group) { const { error } = await this.sb.rpc('leave_group', { p_group: this.group.id }); if (error) throw new Error(error.message); }
    this.group = null; this.members = []; this.saveGroup(); this.onChange();
  }
  async setSharing(on: boolean) {
    this.needSignal();
    if (!this.group) return;
    const { error } = await this.sb.from('group_members').update({ sharing: on }).eq('group_id', this.group.id).eq('rider_id', this.session!.user.id);
    if (error) throw new Error(error.message);
    await this.refreshGroup();
  }
  /** Latest members and positions. Quietly does nothing without signal. */
  async refreshGroup() {
    if (!navigator.onLine || !this.session) return;
    if (!this.group) {
      // Pick up a group joined on another phone.
      const { data } = await this.sb.from('groups').select('id,name,code').limit(1);
      if (data?.length) this.group = data[0] as Group; else return;
    }
    const gid = this.group.id;
    const [mem, pos] = await Promise.all([
      this.sb.from('group_members').select('rider_id,sharing,joined_at,profiles(display_name)').eq('group_id', gid),
      this.sb.from('group_positions').select('rider_id,lat,lon,acc,speed,heading,at').eq('group_id', gid),
    ]);
    if (mem.error || pos.error) return;
    if (!mem.data.some(m => m.rider_id === this.session!.user.id)) { this.group = null; this.members = []; this.saveGroup(); this.onChange(); return; } // removed or group deleted
    const at = new Map((pos.data as { rider_id: string }[]).map(p => [p.rider_id, p]));
    this.members = (mem.data as unknown as { rider_id: string; sharing: boolean; joined_at: string; profiles: { display_name: string } | null }[]).map(m => {
      const p = at.get(m.rider_id) as GroupMember['pos'] & { rider_id: string } | undefined;
      return { riderId: m.rider_id, name: m.profiles?.display_name ?? 'Rider', sharing: m.sharing, joinedAt: m.joined_at,
        pos: p ? { lat: p.lat, lon: p.lon, acc: p.acc, speed: p.speed, heading: p.heading, at: p.at } : undefined };
    });
    this.groupUpdated = new Date().toISOString();
    this.saveGroup(); this.onChange();
  }
  /** Send this phone's position to the group (only while sharing). */
  async postPosition(p: { lat: number; lon: number; acc?: number; speed?: number; heading?: number }) {
    if (!navigator.onLine || !this.session || !this.group || !this.sharing) return false;
    const { error } = await this.sb.from('group_positions').upsert({
      group_id: this.group.id, rider_id: this.session.user.id, lat: p.lat, lon: p.lon, acc: p.acc ?? null,
      speed: p.speed ?? null, heading: Number.isFinite(p.heading) ? p.heading : null, at: new Date().toISOString(),
    }, { onConflict: 'group_id,rider_id' });
    return !error;
  }

  // ---------------------------------------------------------------- shared pins and hazard reports
  sharedPins: SharedPin[] = read('traillink.sharedPins', []);
  myVotes: Record<string, 'there' | 'cleared'> = read('traillink.pinVotes', {});
  /** Share (or update) a pin. Works offline: it uploads when there's signal. */
  sharePin(p: PinUpload) { this.queue({ k: 'pin', p }); }
  unsharePin(id: string) { this.sharedPins = this.sharedPins.filter(x => x.id !== id); write('traillink.sharedPins', this.sharedPins); this.queue({ k: 'unpin', id }); }
  /** "Still there" or "Cleared". Shown right away; uploads when there's signal. */
  votePin(id: string, v: 'there' | 'cleared') {
    this.myVotes[id] = v; write('traillink.pinVotes', this.myVotes);
    const p = this.sharedPins.find(x => x.id === id);
    if (p) {
      const now = new Date().toISOString();
      if (v === 'cleared') Object.assign(p, { status: 'cleared', clearedBy: this.session?.user.id ?? null, clearedAt: now });
      else Object.assign(p, { status: 'active', clearedBy: null, clearedAt: null, lastConfirmed: now, confirmations: p.confirmations + 1 });
      write('traillink.sharedPins', this.sharedPins);
    }
    this.queue({ k: 'vote', id, v });
  }
  nameOf(riderId: string | null) {
    if (!riderId) return 'a rider';
    if (riderId === this.session?.user.id) return 'you';
    return this.members.find(m => m.riderId === riderId)?.name ?? this.sharedPins.find(p => p.riderId === riderId)?.by ?? 'a rider';
  }
  async fetchSharedPins() {
    if (!navigator.onLine || !this.session) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [pins, votes] = await Promise.all([
      this.sb.from('shared_pins').select('*,profiles!shared_pins_rider_id_fkey(display_name)').or(`status.eq.active,cleared_at.gt.${since}`).limit(3000),
      this.sb.from('hazard_votes').select('pin_id,vote').eq('rider_id', this.session.user.id),
    ]);
    if (pins.error) { console.warn('TrailLink: shared pins', pins.error); return; }
    const pending = new Set(this.outbox.flatMap(o => (o.k === 'vote' ? [o.id] : [])));
    const old = new Map(this.sharedPins.map(p => [p.id, p]));
    this.sharedPins = (pins.data as Record<string, unknown>[]).map(r => {
      const sp: SharedPin = {
        id: String(r.id), audience: r.audience as SharedPin['audience'], groupId: (r.group_id as string) ?? null, kind: String(r.kind),
        report: (r.report as string) ?? undefined, note: (r.note as string) ?? undefined, lat: Number(r.lat), lon: Number(r.lon), createdAt: String(r.created_at),
        riderId: String(r.rider_id), by: (r.profiles as { display_name?: string } | null)?.display_name ?? 'Rider',
        status: r.status as SharedPin['status'], clearedBy: (r.cleared_by as string) ?? null, clearedAt: (r.cleared_at as string) ?? null,
        lastConfirmed: String(r.last_confirmed_at), confirmations: Number(r.confirmations),
      };
      // A vote still waiting to upload keeps showing its effect.
      const o = old.get(sp.id);
      return pending.has(sp.id) && o ? { ...sp, status: o.status, clearedBy: o.clearedBy, clearedAt: o.clearedAt, lastConfirmed: o.lastConfirmed, confirmations: o.confirmations } : sp;
    });
    write('traillink.sharedPins', this.sharedPins);
    if (!votes.error) { this.myVotes = Object.fromEntries((votes.data as { pin_id: string; vote: 'there' | 'cleared' }[]).map(v => [v.pin_id, v.vote])); write('traillink.pinVotes', this.myVotes); }
  }

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
    const key = (o: Op) => (o.k === 'rate' || o.k === 'unrate' ? `r:${o.tid}` : o.k === 'trail' ? `t:${o.t.id}` : o.k === 'deltrail' ? `t:${o.id}`
      : o.k === 'vehicle' ? `v:${o.v.id}` : o.k === 'delvehicle' ? `v:${o.id}`
      : o.k === 'pin' ? `p:${o.p.id}` : o.k === 'unpin' ? `p:${o.id}` : o.k === 'vote' ? `pv:${o.id}` : `c:${o.id}`);
    this.outbox = [...this.outbox.filter(o => key(o) !== key(op)), op];
    write('traillink.outbox', this.outbox);
    void this.sync();
  }

  private async run(op: Op): Promise<'done' | 'retry' | 'drop'> {
    const uid = this.session!.user.id;
    const rating = (vehicle: string | null) => this.sb.from('ratings').upsert({ tid: (op as { tid: string }).tid, rider_id: uid, difficulty: (op as { n: number }).n,
      vehicle_id: vehicle, rig_score: (op as { s?: number | null }).s ?? null, rated_at: new Date().toISOString() }, { onConflict: 'tid,rider_id' });
    let res =
      op.k === 'rate' ? await rating(op.v ?? null)
      : op.k === 'vehicle' ? await this.sb.from('vehicles').upsert({
          id: op.v.id, nickname: op.v.nickname, make: op.v.make || null, model: op.v.model || null, year: op.v.year ?? null, width_in: op.v.widthIn,
          tire_in: op.v.tireIn, lift_in: op.v.liftIn, lockers: op.v.lockers, winch: op.v.winch, skids: op.v.skids, sliders: op.v.sliders, updated_at: op.v.updatedAt,
        }, { onConflict: 'id' })
      : op.k === 'delvehicle' ? await this.sb.from('vehicles').delete().eq('id', op.id)
      : op.k === 'unrate' ? await this.sb.from('ratings').delete().eq('tid', op.tid).eq('rider_id', uid)
      : op.k === 'trail' ? await this.sb.from('rider_trails').upsert({
          id: op.t.id, name: op.t.name, difficulty: op.t.difficulty, vehicles: op.t.vehicles, notes: op.t.notes ?? null, created_at: op.t.createdAt,
          geom: `SRID=4326;LINESTRING(${op.t.coords.map(([x, y]) => `${x} ${y}`).join(',')})`,
        }, { onConflict: 'id', ignoreDuplicates: true })
      : op.k === 'deltrail' ? await this.sb.from('rider_trails').delete().eq('id', op.id)
      : op.k === 'pin' ? await this.sb.from('shared_pins').upsert({
          id: op.p.id, audience: op.p.audience, group_id: op.p.groupId, kind: op.p.kind, report: op.p.report ?? null, note: op.p.note ?? null,
          lat: op.p.lat, lon: op.p.lon, created_at: op.p.createdAt, updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      : op.k === 'unpin' ? await this.sb.from('shared_pins').delete().eq('id', op.id)
      : op.k === 'vote' ? await this.sb.from('hazard_votes').upsert({ pin_id: op.id, rider_id: uid, vote: op.v, voted_at: new Date().toISOString() }, { onConflict: 'pin_id,rider_id' })
      : await this.sb.from('trail_confirmations').insert({ trail_id: op.id });
    // The vehicle was deleted (or never uploaded): keep the rating and its rig score without the link.
    if (op.k === 'rate' && op.v && res.error?.code === '23503') res = await rating(null);
    if (!res.error) return 'done';
    // Network trouble: keep it for later. Anything the database refuses (bad data, not allowed, duplicate): drop it.
    const msg = `${res.error.message} ${res.error.code ?? ''}`;
    if (/fetch|network|timeout|Failed to/i.test(msg) || !res.error.code) return 'retry';
    console.warn('TrailLink: change refused by the database', op, res.error);
    return 'drop';
  }

  /** Vehicles saved on another phone appear here too. Changes waiting to upload win. */
  private mergeVehicles(rows: Record<string, unknown>[]) {
    const pending = new Set(this.outbox.flatMap(o => (o.k === 'vehicle' ? [o.v.id] : o.k === 'delvehicle' ? [o.id] : [])));
    const remote: Vehicle[] = rows.map(r => ({
      id: String(r.id), nickname: String(r.nickname), make: String(r.make ?? ''), model: String(r.model ?? ''), year: r.year == null ? undefined : Number(r.year),
      widthIn: Number(r.width_in) as Vehicle['widthIn'], tireIn: Number(r.tire_in), liftIn: Number(r.lift_in), lockers: r.lockers as Vehicle['lockers'],
      winch: !!r.winch, skids: !!r.skids, sliders: !!r.sliders, updatedAt: String(r.updated_at),
    }));
    const local = new Map(this.vehicles.map(v => [v.id, v]));
    // The database's list, except vehicles with changes still waiting to upload (the phone's copy wins for those).
    const merged = remote.filter(v => !pending.has(v.id)).map(v => { const l = local.get(v.id); return l && Date.parse(l.updatedAt) > Date.parse(v.updatedAt) ? l : v; });
    for (const v of this.vehicles) if (pending.has(v.id)) merged.push(v);
    this.vehicles = merged;
    write('traillink.garage', this.vehicles);
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
        // Vehicles first, so ratings can point at them.
        this.outbox = [...this.outbox.filter(o => o.k === 'vehicle' || o.k === 'delvehicle'), ...this.outbox.filter(o => o.k !== 'vehicle' && o.k !== 'delvehicle')];
        while (this.outbox.length) {
          const r = await this.run(this.outbox[0]);
          if (r === 'retry') break;
          this.outbox.shift(); write('traillink.outbox', this.outbox);
        }
      }
      const [scores, trails, model, mine] = await Promise.all([
        this.sb.from('trail_scores').select('tid,avg,count,rig_avg').limit(50000),
        this.sb.from('rider_trails_public').select('*').limit(5000),
        this.sb.from('rig_model').select('pairs,slope').maybeSingle(),
        this.sb.from('vehicles').select('*').eq('owner_id', this.session.user.id),
      ]);
      if (scores.error || trails.error) throw new Error((scores.error ?? trails.error)!.message);
      this.cachedScores = new Map((scores.data as { tid: string; avg: number; count: number; rig_avg: number | null }[])
        .map(s => [s.tid, { avg: Number(s.avg), count: s.count, rig: s.rig_avg == null ? null : Number(s.rig_avg) }]));
      if (!model.error && model.data) { this.rigModel = { pairs: model.data.pairs, slope: model.data.slope == null ? null : Number(model.data.slope) }; write('traillink.rigModel', this.rigModel); }
      if (!mine.error) this.mergeVehicles(mine.data as Record<string, unknown>[]);
      await this.fetchSharedPins();
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
