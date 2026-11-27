// Group messages: a chat thread per ride group, kept as a ride log after the group ends.
// Offline first: a message is saved on the phone and marked "waiting" until it reaches the database; each has its
// own id, so a retry never sends it twice. Open apps get new messages live (Supabase Realtime), with a poll as backup.
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { OnlineCommunity } from './online.ts';
import { SUPABASE_URL } from './config.ts';

export interface ChatMessage {
  id: string; groupId: string; riderId: string; by: string;
  kind: 'text' | 'quick' | 'location'; body: string; lat?: number; lon?: number;
  sentAt: string; createdAt?: string; pending?: boolean;
  /** The message this one answers (tap a message to reply to it). */
  replyTo?: string;
}
export interface LoggedGroup { id: string; name: string; joinedAt: string }

export const QUICK = ['Stopping', 'Go ahead', 'Wait for me', 'All good', 'Need help', 'Meet at the regroup point'];

const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)));
const KEEP = 300; // messages kept on the phone per group

type Row = { id: string; group_id: string; rider_id: string; kind: ChatMessage['kind']; body: string; lat: number | null; lon: number | null; sent_at: string; created_at: string; reply_to?: string | null; profiles?: { display_name: string } | null };

export class GroupChat {
  private threads: Record<string, ChatMessage[]> = read('traillink.chat', {});
  private waiting: ChatMessage[] = read('traillink.chatOutbox', []);
  private lastRead: Record<string, string> = read('traillink.chatRead', {});
  log: LoggedGroup[] = read('traillink.chatLog', []);
  private channel: RealtimeChannel | null = null;
  private channelGroup: string | null = null;
  private flushing = false;
  onChange: () => void = () => {};
  /** A message from another rider just arrived while the app is open. */
  onIncoming: (m: ChatMessage) => void = () => {};

  constructor(private c: OnlineCommunity) {}

  private save() {
    for (const g of Object.keys(this.threads)) this.threads[g] = this.threads[g].slice(-KEEP);
    write('traillink.chat', this.threads); write('traillink.chatOutbox', this.waiting); write('traillink.chatRead', this.lastRead);
  }
  private nameOf(riderId: string) { return this.c.members.find(m => m.riderId === riderId)?.name ?? 'Rider'; }

  /** Messages of a group, oldest first, with waiting ones at the end. */
  thread(groupId: string): ChatMessage[] {
    const sent = this.threads[groupId] ?? [];
    return [...sent, ...this.waiting.filter(m => m.groupId === groupId && !sent.some(s => s.id === m.id))];
  }
  unread(groupId: string | undefined): number {
    if (!groupId) return 0;
    const me = this.c.uid, since = this.lastRead[groupId] ?? '';
    return (this.threads[groupId] ?? []).filter(m => m.riderId !== me && (m.createdAt ?? m.sentAt) > since).length;
  }
  markRead(groupId: string) {
    const t = this.threads[groupId]; if (!t?.length) return;
    const latest = t[t.length - 1].createdAt ?? t[t.length - 1].sentAt;
    if (this.lastRead[groupId] === latest) return;
    this.lastRead[groupId] = latest; this.save(); this.onChange();
  }

  private merge(groupId: string, list: ChatMessage[]) {
    const byId = new Map((this.threads[groupId] ?? []).map(m => [m.id, m]));
    let added = false;
    for (const m of list) { if (!byId.has(m.id)) added = true; byId.set(m.id, { ...m, pending: false }); }
    this.threads[groupId] = [...byId.values()].sort((a, b) => (a.createdAt ?? a.sentAt).localeCompare(b.createdAt ?? b.sentAt));
    this.waiting = this.waiting.filter(w => !byId.has(w.id));
    this.save();
    return added;
  }
  private fromRow = (r: Row): ChatMessage => ({
    id: r.id, groupId: r.group_id, riderId: r.rider_id, by: r.profiles?.display_name ?? this.nameOf(r.rider_id), kind: r.kind, body: r.body,
    lat: r.lat ?? undefined, lon: r.lon ?? undefined, sentAt: r.sent_at, createdAt: r.created_at, replyTo: r.reply_to ?? undefined,
  });

  /** Write a message: saved here at once, sent when there's signal. */
  send(kind: ChatMessage['kind'], body: string, at?: { lat: number; lon: number }, replyTo?: string) {
    const g = this.c.group, me = this.c.uid;
    if (!g || !me) throw new Error('Join a ride group first.');
    const text = body.trim().slice(0, 500);
    if (!text && kind !== 'location') return;
    this.waiting.push({ id: uuid(), groupId: g.id, riderId: me, by: 'You', kind, body: text, lat: at?.lat, lon: at?.lon, sentAt: new Date().toISOString(), pending: true, replyTo });
    this.save(); this.onChange();
    void this.flush();
  }
  /** Upload waiting messages (in order). A message the database already has counts as sent. */
  async flush() {
    if (this.flushing || !navigator.onLine || !this.c.uid || !this.waiting.length) return;
    this.flushing = true;
    try {
      for (const m of [...this.waiting]) {
        const { data, error } = await this.c.client.from('group_messages').insert({
          id: m.id, group_id: m.groupId, kind: m.kind, body: m.body, lat: m.lat ?? null, lon: m.lon ?? null, sent_at: m.sentAt, ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }).select('id,group_id,rider_id,kind,body,lat,lon,sent_at,created_at,reply_to').maybeSingle();
        if (!error && data) { this.merge(m.groupId, [{ ...this.fromRow(data as Row), by: 'You' }]); continue; }
        if (error?.code === '23505') { this.waiting = this.waiting.filter(w => w.id !== m.id); continue; } // already there
        if (error && (error.code === '42501' || /row-level security/i.test(error.message))) { // no longer in that group
          this.waiting = this.waiting.filter(w => w.id !== m.id); continue;
        }
        break; // network trouble: try again later
      }
    } finally { this.flushing = false; this.save(); this.onChange(); }
  }

  /** Catch up on a group's messages, and listen live while the app is open. */
  async refresh(groupId = this.c.group?.id) {
    if (!groupId || !navigator.onLine || !this.c.uid) return;
    const t = this.threads[groupId] ?? [];
    const since = t.length ? t[t.length - 1].createdAt : undefined;
    let q = this.c.client.from('group_messages').select('id,group_id,rider_id,kind,body,lat,lon,sent_at,created_at,reply_to,profiles(display_name)')
      .eq('group_id', groupId).order('created_at', { ascending: true }).limit(KEEP);
    if (since) q = q.gt('created_at', since);
    const { data, error } = await q;
    if (!error && data?.length && this.merge(groupId, (data as unknown as Row[]).map(this.fromRow))) this.onChange();
    await this.fillNames(groupId);
    if (groupId === this.c.group?.id) this.listen(groupId);
    void this.flush();
  }
  /** Messages that arrived live carry no name: look up any riders shown as "Rider". */
  private async fillNames(groupId: string) {
    const t = this.threads[groupId] ?? [];
    const ids = [...new Set(t.filter(m => m.by === 'Rider' && m.riderId !== this.c.uid).map(m => m.riderId))];
    if (!ids.length) return;
    const { data } = await this.c.client.from('profiles').select('id,display_name').in('id', ids);
    if (!data?.length) return;
    const names = new Map((data as { id: string; display_name: string }[]).map(p => [p.id, p.display_name]));
    for (const m of t) if (m.by === 'Rider' && names.has(m.riderId)) m.by = names.get(m.riderId)!;
    this.save(); this.onChange();
  }
  private listen(groupId: string) {
    if (this.channelGroup === groupId && this.channel) return;
    if (this.channel) void this.c.client.removeChannel(this.channel);
    this.channelGroup = groupId;
    this.channel = this.c.client.channel(`chat-${groupId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, p => {
        const m = this.fromRow(p.new as Row);
        if (this.merge(groupId, [m])) { this.onChange(); if (m.riderId !== this.c.uid) this.onIncoming(m); if (m.by === 'Rider') void this.fillNames(groupId); }
      })
      .subscribe();
  }
  stop() { if (this.channel) void this.c.client.removeChannel(this.channel); this.channel = null; this.channelGroup = null; }

  /** Groups this rider has been in (for the ride log), newest first. */
  async refreshLog() {
    if (!navigator.onLine || !this.c.uid) return;
    const { data, error } = await this.c.client.from('group_log_members').select('group_id,group_name,joined_at').order('joined_at', { ascending: false }).limit(50);
    if (error || !data) return;
    this.log = (data as { group_id: string; group_name: string; joined_at: string }[]).map(r => ({ id: r.group_id, name: r.group_name, joinedAt: r.joined_at }));
    write('traillink.chatLog', this.log); this.onChange();
  }

  // ---------------------------------------------------------------- notifications when the app is closed (Web Push)
  get pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  get pushOn() { return this.pushSupported && Notification.permission === 'granted' && read('traillink.pushOn', false); }
  /** Must be called from a tap (browsers only ask for permission after a tap). */
  async enablePush(): Promise<void> {
    if (!this.pushSupported) throw new Error('This browser can\'t show notifications. On iPhone, open TrailLink from its Home Screen icon.');
    if (!this.c.uid) throw new Error('Sign in first (Trails tab).');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked. Turn them on for TrailLink in your phone\'s Settings.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/push`).catch(() => null);
    const key = res?.ok ? ((await res.json()) as { publicKey?: string }).publicKey : undefined;
    if (!key) throw new Error('Notifications aren\'t set up on the server yet. Try again later.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) as BufferSource });
    const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const { error } = await this.c.client.from('push_subscriptions').upsert({ endpoint: j.endpoint, rider_id: this.c.uid, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
    if (error) throw new Error(error.message);
    write('traillink.pushOn', true); this.onChange();
  }
  async disablePush() {
    write('traillink.pushOn', false);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await this.c.client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    } catch { /* offline: the server drops it when the phone stops accepting */ }
    this.onChange();
  }
}

function urlB64(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length)); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out;
}
