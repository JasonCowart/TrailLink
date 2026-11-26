// Live test of the personal backup (pins, rides, settings, photos) against the real database, with two
// throwaway test accounts that are deleted afterwards. Prints pass/fail only (this repo is public).
//   node scripts/test-backup.mjs     (GitHub Actions; needs SUPABASE_ACCESS_TOKEN, run after npm ci in web/)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REF = 'yxcyqbxzggpejldkmdqe';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const cfg = readFileSync('web/src/config.ts', 'utf8');
const URL = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
const KEY = cfg.match(/sb_publishable_[A-Za-z0-9_-]+/)[0];
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

const users = [];
async function makeUser(tag) {
  const email = `traillink-backup-test-${tag}-${randomBytes(3).toString('hex')}@example.com`;
  const pw = randomBytes(18).toString('hex');
  const [{ id }] = await sql(`with u as (
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${pw}', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id)
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now() from u
    returning user_id as id`);
  users.push(id);
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`test sign-in failed: HTTP ${res.status} ${j.error_code ?? j.msg ?? ''}`);
  return { uid: id, token: j.access_token };
}

const dir = mkdtempSync(join(tmpdir(), 'tlb-'));
function phone(name, user, cmd) {
  const out = execFileSync('npx', ['tsx', 'test/backup-device.ts', join(dir, `${name}.json`), JSON.stringify(cmd)], {
    cwd: 'web', env: { ...process.env, TL_URL: URL, TL_KEY: KEY, TL_TOKEN: user.token, TL_UID: user.uid }, encoding: 'utf8',
  });
  const line = out.split('\n').find(l => l.startsWith('RESULT '));
  if (!line) throw new Error(`${name}: no result`);
  return JSON.parse(line.slice(7));
}

try {
  const a = await makeUser('a'), b = await makeUser('b');
  const now = Date.now();
  // "Safari" has two pins (one with a photo), a finished ride and a map setting.
  let s = phone('safari', a, {
    pins: [{ id: 'p1', kind: 'regroup', lat: 39.1, lon: -105, t: now }, { id: 'p2', kind: 'note', lat: 39.2, lon: -105, t: now - 1000 }],
    tracks: [{ id: 't1', name: 'Ride', points: [{ lat: 39.1, lon: -105, t: now }, { lat: 39.11, lon: -105, t: now + 60000 }], startedAt: now, endedAt: now + 60000 },
      { id: 't2', name: 'Still recording', points: [], startedAt: now }],
    settings: { base: 'sat', colorBy: 'difficulty' }, photoOn: 'p1',
  });
  check(s.state === 'idle', 'Safari backs up without errors');
  check(s.photosWaiting === 0, 'Safari uploads its photo');
  const [{ n }] = await sql(`select count(*)::int as n from public.rider_items where rider_id = '${a.uid}'`);
  check(n === 5, `account holds 2 pins, 1 finished ride, 2 settings (got ${n}); ride still recording not uploaded`);

  // The "Home Screen app" starts empty except for one new pin and its own map choice.
  let h = phone('home', a, { pins: [{ id: 'p3', kind: 'note', lat: 39.3, lon: -105, t: now + 5 }], settings: { base: 'topo' }, checkPhotos: true });
  check(h.state === 'idle', 'Home Screen app backs up without errors');
  check(JSON.stringify(h.pins) === '["p1","p2","p3"]', `Home Screen app gets Safari's pins and keeps its own (${h.pins})`);
  check(JSON.stringify(h.tracks) === '["t1"]', 'Home Screen app gets the finished ride');
  check(h.settings.colorBy === 'difficulty', 'Home Screen app gets Safari\'s settings');
  check(h.photosDownloaded === 1 && h.photosExpected === 1, 'Home Screen app downloads the photo');

  // Delete and move on Safari; the Home Screen app follows. Safari picks up the new pin.
  s = phone('safari', a, { delPin: 'p2', movePin: 'p1' });
  check(JSON.stringify(s.pins) === '["p1","p3"]', `Safari gets the Home Screen app's pin, minus the one it deleted (${s.pins})`);
  h = phone('home', a, {});
  check(JSON.stringify(h.pins) === '["p1","p3"]', `deleted pin disappears from the Home Screen app (${h.pins})`);
  check(Math.abs(h.lat.p1 - 39.101) < 1e-9, 'moved pin moves on the Home Screen app');
  check(s.settings.base === h.settings.base, `both end up with the same base map (${s.settings.base} / ${h.settings.base})`);

  // Another rider can't see any of it.
  const other = phone('other', b, { checkPhotos: true });
  check(other.pins.length === 0 && other.tracks.length === 0, 'another rider gets none of it');
  const [{ objs }] = await sql(`select count(*)::int as objs from storage.objects where bucket_id = 'rider-photos' and name like '${a.uid}/%'`);
  check(objs === 1, 'photo is stored in the rider\'s private folder');
  const res = await fetch(`${URL}/storage/v1/object/rider-photos/${(await sql(`select name from storage.objects where bucket_id = 'rider-photos' and name like '${a.uid}/%' limit 1`))[0].name}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${b.token}` } });
  check(res.status >= 400, `another rider can't download the photo (HTTP ${res.status})`);
  const anon = await fetch(`${URL}/storage/v1/object/public/rider-photos/x.jpg`);
  check(anon.status >= 400, 'photos are not public');
} catch (e) {
  console.log(`FAIL ${e.message}`); failures++;
} finally {
  for (const id of users) {
    try { await sql(`set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'rider-photos' and name like '${id}/%';`); } catch (e) { console.log(`note: test photo left behind (${e.message.slice(0, 80)})`); }
    try { await sql(`delete from auth.users where id = '${id}'`); } catch (e) { console.log(`note: test account left behind (${e.message.slice(0, 80)})`); }
  }
  console.log(`Cleaned up ${users.length} test account(s).`);
}
process.exit(failures ? 1 : 0);
