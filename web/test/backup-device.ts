// One "phone" for the live backup test (scripts/test-backup.mjs). Runs backup.ts in Node with stand-ins for the
// browser's storage. Each run is a fresh process, like reopening the app; localStorage persists in a file.
import 'fake-indexeddb/auto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [stateFile, cmdJson] = process.argv.slice(2);
const mem: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const g = globalThis as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => (k in mem ? mem[k] : null), setItem: (k: string, v: string) => { mem[k] = String(v); }, removeItem: (k: string) => { delete mem[k]; } };
g.window = globalThis;
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const { Backup } = await import('../src/backup.ts');
const { savePhoto, photoBlob } = await import('../src/photos.ts');

type Pin = { id: string; kind: string; lat: number; lon: number; t: number; photos?: string[] };
type Track = { id: string; name: string; points: unknown[]; startedAt: number; endedAt?: number };
const S = {
  pins: JSON.parse(mem['dev.pins'] ?? '[]') as Pin[],
  tracks: JSON.parse(mem['dev.tracks'] ?? '[]') as Track[],
  settings: JSON.parse(mem['dev.settings'] ?? '{}') as Record<string, unknown>,
};
const persist = () => { mem['dev.pins'] = JSON.stringify(S.pins); mem['dev.tracks'] = JSON.stringify(S.tracks); mem['dev.settings'] = JSON.stringify(S.settings); writeFileSync(stateFile, JSON.stringify(mem)); };

const client = createClient(process.env.TL_URL!, process.env.TL_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${process.env.TL_TOKEN}` } },
});
const community = { uid: process.env.TL_UID!, client };
const backup = new Backup(community as never, {
  items() {
    const m = new Map<string, unknown>();
    for (const p of S.pins) m.set(`pin:${p.id}`, p);
    for (const t of S.tracks) if (t.endedAt) m.set(`track:${t.id}`, t);
    for (const [k, v] of Object.entries(S.settings)) m.set(`setting:${k}`, v);
    return m;
  },
  photoIds: () => S.pins.flatMap(p => p.photos ?? []),
  apply(changes) {
    for (const c of changes) {
      if (c.kind === 'pin') { S.pins = S.pins.filter(p => p.id !== c.id); if (c.data) S.pins.push(c.data as Pin); }
      if (c.kind === 'track') { S.tracks = S.tracks.filter(t => t.id !== c.id); if (c.data) S.tracks.push(c.data as Track); }
      if (c.kind === 'setting') { if (c.data == null) delete S.settings[c.id]; else S.settings[c.id] = c.data; }
    }
  },
});

const cmd = JSON.parse(cmdJson) as { pins?: Pin[]; tracks?: Track[]; settings?: Record<string, unknown>; photoOn?: string; delPin?: string; movePin?: string; checkPhotos?: boolean };
for (const p of cmd.pins ?? []) S.pins.push(p);
for (const t of cmd.tracks ?? []) S.tracks.push(t);
Object.assign(S.settings, cmd.settings ?? {});
if (cmd.photoOn) {
  const id = await savePhoto(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9])], { type: 'image/jpeg' }));
  S.pins.find(p => p.id === cmd.photoOn)!.photos = [id];
}
if (cmd.delPin) S.pins = S.pins.filter(p => p.id !== cmd.delPin);
if (cmd.movePin) { const p = S.pins.find(x => x.id === cmd.movePin)!; p.lat += 0.001; }
await backup.run();
const out: Record<string, unknown> = {
  state: backup.state,
  pins: S.pins.map(p => p.id).sort(),
  tracks: S.tracks.map(t => t.id).sort(),
  settings: S.settings,
  photosWaiting: backup.photosWaiting,
  lat: Object.fromEntries(S.pins.map(p => [p.id, p.lat])),
};
if (cmd.checkPhotos) {
  const ids = S.pins.flatMap(p => p.photos ?? []);
  out.photosDownloaded = (await Promise.all(ids.map(id => photoBlob(id)))).filter(b => b && b.size > 0).length;
  out.photosExpected = ids.length;
}
persist();
console.log(`RESULT ${JSON.stringify(out)}`);
