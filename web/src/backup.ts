// Personal backup: the rider's own pins, recorded rides, app settings and photos, copied to their account
// whenever there's signal. Everything is still saved on the phone first, so the app works with no signal.
// It also keeps Safari and the Home Screen app (separate storage on iPhone) and a new phone in step.
//
// How it syncs: each item has a fingerprint of what was last agreed with the account. An item whose fingerprint
// changed was edited on this phone and is uploaded; an item changed in the account (and not here) is downloaded.
// If both changed, this phone's version wins. Deletions upload as markers so other phones remove the item too.
import type { OnlineCommunity } from './online.ts';
import { localPhoto, setRemotePhotos } from './photos.ts';

export type Kind = 'pin' | 'track' | 'setting';
export interface Change { kind: Kind; id: string; data: unknown | null }
export interface BackupSource {
  /** Everything on this phone that should be backed up, keyed `kind:id`. */
  items(): Map<string, unknown>;
  /** Ids of photos on pins (and photos kept after a pin was deleted). */
  photoIds(): string[];
  /** Apply changes that came from the account (data null = deleted). */
  apply(changes: Change[]): void;
}

const BUCKET = 'rider-photos';
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

/** JSON with keys sorted, so the same content always gives the same fingerprint (the database reorders keys). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stable(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
function fingerprint(v: unknown): string {
  const s = stable(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}
const split = (key: string) => { const i = key.indexOf(':'); return { kind: key.slice(0, i) as Kind, id: key.slice(i + 1) }; };

export class Backup {
  private synced: Record<string, string> = read('traillink.backup.synced', {});
  private since: string | null = read('traillink.backup.since', null);
  private owner: string | null = read('traillink.backup.owner', null);
  private photosUp = new Set<string>(read<string[]>('traillink.backup.photosUp', []));
  private running = false;
  private again = false;
  private timer = 0;
  state: 'idle' | 'syncing' | 'error' = 'idle';
  lastAt: string | null = read('traillink.backup.lastAt', null);
  /** Photos on this phone not yet in the account. */
  photosWaiting = 0;
  onStatus: () => void = () => {};

  constructor(private c: OnlineCommunity, private src: BackupSource) {
    setRemotePhotos(async id => {
      const uid = c.uid;
      if (!uid || !navigator.onLine) return null;
      const { data, error } = await c.client.storage.from(BUCKET).download(`${uid}/${id}.jpg`);
      if (error || !data) return null;
      this.photosUp.add(id); this.save();
      return data;
    });
  }

  get photoBackup(): boolean { return read('traillink.photoBackup', true); }

  /** Back up soon (changes come in bursts while riding, so wait a few seconds and send them together). */
  schedule(ms = 5000) {
    if (this.timer) return;
    this.timer = window.setTimeout(() => { this.timer = 0; void this.run(); }, ms);
  }

  async run() {
    if (this.running) { this.again = true; return; }
    const uid = this.c.uid;
    if (!uid || !navigator.onLine) return;
    if (this.owner !== uid) {
      // First backup on this phone, or a different rider signed in: compare everything afresh.
      this.synced = {}; this.since = null; this.photosUp.clear(); this.owner = uid;
    }
    this.running = true; this.state = 'syncing'; this.onStatus();
    try {
      await this.pull();
      await this.push(uid);
      await this.pushPhotos(uid);
      this.state = 'idle'; this.lastAt = new Date().toISOString();
    } catch (e) {
      console.warn('Backup failed', e);
      this.state = 'error';
    } finally {
      this.running = false; this.save(); this.onStatus();
      if (this.again) { this.again = false; this.schedule(1000); }
    }
  }

  private save() {
    write('traillink.backup.synced', this.synced);
    write('traillink.backup.since', this.since);
    write('traillink.backup.owner', this.owner);
    write('traillink.backup.photosUp', [...this.photosUp]);
    write('traillink.backup.lastAt', this.lastAt);
  }
  private mark(key: string, fp: string) { if (fp) this.synced[key] = fp; else delete this.synced[key]; }

  private async pull() {
    const local = this.src.items();
    const changes: Change[] = [];
    // Re-read the last minute too, in case two changes were saved at nearly the same moment.
    const from = this.since ? new Date(Date.parse(this.since) - 60_000).toISOString() : null;
    let newest = this.since;
    for (let off = 0; ; off += 500) {
      let q = this.c.client.from('rider_items').select('kind,id,data,deleted,updated_at').order('updated_at').range(off, off + 499);
      if (from) q = q.gt('updated_at', from);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of data as { kind: Kind; id: string; data: unknown; deleted: boolean; updated_at: string }[]) {
        if (!newest || Date.parse(r.updated_at) > Date.parse(newest)) newest = r.updated_at;
        const key = `${r.kind}:${r.id}`;
        const remoteFp = r.deleted ? '' : fingerprint(r.data);
        const l = local.get(key);
        const localFp = l === undefined ? '' : fingerprint(l);
        if (remoteFp === localFp) { this.mark(key, remoteFp); continue; }
        if (localFp !== (this.synced[key] ?? '')) continue; // changed on this phone too: this phone's version uploads next
        changes.push({ kind: r.kind, id: r.id, data: r.deleted ? null : r.data });
        this.mark(key, remoteFp);
      }
      if (data.length < 500) break;
    }
    if (changes.length) this.src.apply(changes);
    this.since = newest;
  }

  private async push(uid: string) {
    const local = this.src.items();
    const rows: { rider_id: string; kind: Kind; id: string; data: unknown; deleted: boolean }[] = [];
    const fps = new Map<string, string>();
    for (const [key, v] of local) {
      const fp = fingerprint(v);
      if (fp === (this.synced[key] ?? '')) continue;
      rows.push({ rider_id: uid, ...split(key), data: v, deleted: false }); fps.set(key, fp);
    }
    for (const key of Object.keys(this.synced)) {
      if (local.has(key)) continue;
      rows.push({ rider_id: uid, ...split(key), data: null, deleted: true }); fps.set(key, '');
    }
    // Send in batches of about 1 MB (a long ride can be a few hundred KB on its own).
    let batch: typeof rows = [], size = 0;
    const send = async () => {
      if (!batch.length) return;
      const { error } = await this.c.client.from('rider_items').upsert(batch, { onConflict: 'rider_id,kind,id' });
      if (error) throw error;
      for (const r of batch) this.mark(`${r.kind}:${r.id}`, fps.get(`${r.kind}:${r.id}`)!);
      this.save();
      batch = []; size = 0;
    };
    for (const r of rows) {
      const n = r.data == null ? 100 : JSON.stringify(r.data).length;
      if (size + n > 1_000_000) await send();
      batch.push(r); size += n;
    }
    await send();
  }

  private async pushPhotos(uid: string) {
    const ids = [...new Set(this.src.photoIds())].filter(id => !this.photosUp.has(id));
    this.photosWaiting = 0;
    for (const id of ids) {
      const blob = await localPhoto(id);
      if (!blob) continue; // taken on another phone and not downloaded here: nothing to upload
      if (!this.photoBackup) { this.photosWaiting++; continue; }
      const { error } = await this.c.client.storage.from(BUCKET)
        .upload(`${uid}/${id}.jpg`, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (error && !/exists|duplicate/i.test(error.message)) { this.photosWaiting++; throw error; }
      this.photosUp.add(id); this.save(); this.onStatus();
    }
  }
}
