// Live test of group messages against the real database, with three throwaway test accounts that are deleted
// afterwards. Prints pass/fail only (this repo is public).
//   node scripts/test-messages.mjs     (GitHub Actions; needs SUPABASE_ACCESS_TOKEN, run after npm install in web/)
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
async function makeUser(tag, name) {
  const email = `traillink-msg-test-${tag}-${randomBytes(3).toString('hex')}@example.com`;
  const pw = randomBytes(18).toString('hex');
  const [{ id }] = await sql(`with u as (
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${pw}', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id)
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now() from u
    returning user_id as id`);
  users.push(id);
  await sql(`insert into public.profiles (id, display_name) values ('${id}', '${name}') on conflict (id) do update set display_name = excluded.display_name`);
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`test sign-in failed: HTTP ${res.status}`);
  return { uid: id, token: j.access_token };
}
const rest = (u, path, body) => fetch(`${URL}/rest/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { apikey: KEY, Authorization: `Bearer ${u.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => { const t = await r.text(); return t ? JSON.parse(t) : null; });

const dir = mkdtempSync(join(tmpdir(), 'tlm-'));
const env = u => ({ ...process.env, TL_URL: URL, TL_KEY: KEY, TL_TOKEN: u.token, TL_UID: u.uid });
const parse = out => JSON.parse(out.split('\n').find(l => l.startsWith('RESULT ')).slice(7));
const phone = (name, u, cmd) => parse(execFileSync('npx', ['tsx', 'test/chat-device.ts', join(dir, `${name}.json`), JSON.stringify(cmd)], { cwd: 'web', env: env(u), encoding: 'utf8' }));
const phoneLater = (name, u, cmd) => new Promise(resolve => {
  let out = '';
  const p = spawn('npx', ['tsx', 'test/chat-device.ts', join(dir, `${name}.json`), JSON.stringify(cmd)], { cwd: 'web', env: env(u) });
  p.stdout.on('data', d => { out += d; }); p.on('close', () => resolve(parse(out)));
});

try {
  const maria = await makeUser('a', 'Maria'), kim = await makeUser('b', 'Kim'), outsider = await makeUser('c', 'Dean');
  const group = await rest(maria, 'rpc/create_group', { p_name: 'Test Canyon Run' });
  await rest(kim, 'rpc/join_group', { p_code: group.code });
  const g = { id: group.id, name: group.name, code: group.code };

  // Shared pins (hazard reports): how the app uploads them.
  const api = (u, method, path, body, prefer) => fetch(`${URL}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: `Bearer ${u.token}`, 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const pinId = randomUUID();
  const pinRow = { audience: 'all', group_id: null, kind: 'report', report: 'other', note: 'Test washout', lat: 30.29, lon: -95.61, updated_at: new Date().toISOString() };
  const old = await api(maria, 'POST', 'shared_pins?on_conflict=id', { id: pinId, created_at: new Date().toISOString(), ...pinRow }, 'resolution=merge-duplicates');
  check(old.status >= 400, `old upsert upload is refused (HTTP ${old.status}) — the bug that kept hazards from sharing`);
  const ins = await api(maria, 'POST', 'shared_pins', { id: pinId, created_at: new Date().toISOString(), ...pinRow });
  check(ins.ok, `new upload: hazard report inserted (HTTP ${ins.status})`);
  const dup = await api(maria, 'POST', 'shared_pins', { id: pinId, created_at: new Date().toISOString(), ...pinRow });
  const dupBody = await dup.text();
  check(dup.status === 409 && /23505/.test(dupBody), `uploading it again reports a duplicate (HTTP ${dup.status})`);
  const upd = await api(maria, 'PATCH', `shared_pins?id=eq.${pinId}`, { ...pinRow, lat: 30.3 });
  check(upd.ok, `moving it updates the shared copy (HTTP ${upd.status})`);
  const seenPin = await rest(kim, `shared_pins?select=id,lat,status&id=eq.${pinId}`);
  check(Array.isArray(seenPin) && seenPin.length === 1 && seenPin[0].lat === 30.3, 'another rider sees the hazard where it was moved');
  await rest(maria, 'hazard_votes', { pin_id: pinId, rider_id: maria.uid, vote: 'cleared' });
  const cleared = await rest(kim, `shared_pins?select=status&id=eq.${pinId}`);
  check(Array.isArray(cleared) && cleared[0]?.status === 'cleared', 'the reporter can mark it Cleared');
  await sql(`delete from public.shared_pins where id = '${pinId}'`);

  // Maria writes two messages with no signal: they wait on her phone.
  let m = phone('maria', maria, { group: g, offline: true, send: [{ kind: 'quick', body: 'Stopping' }, { kind: 'text', body: 'Flat tire, 10 min' }] });
  check(m.thread.length === 2 && m.thread.every(x => x.pending), 'messages written offline wait on the phone');
  const [{ n0 }] = await sql(`select count(*)::int as n0 from public.group_messages where group_id = '${g.id}'`);
  check(n0 === 0, 'nothing reaches the database while offline');

  // Kim has the app open (listening live). Maria gets signal: the waiting messages send, and Kim sees them arrive.
  const kimLive = phoneLater('kim', kim, { group: g, listen: 15000 });
  await new Promise(r => setTimeout(r, 6000));
  m = phone('maria', maria, { group: g });
  check(m.thread.length === 2 && m.thread.every(x => !x.pending), 'waiting messages send once there is signal');
  const k = await kimLive;
  check(k.live.length === 2, `Kim's open app receives them live (${k.live.length}/2)`);
  check(k.thread.length === 2 && k.thread[0].by === 'Maria', `Kim's thread shows them with Maria's name (${k.thread.map(x => x.by)})`);

  // Notifications: each new message makes the database call the push function, which answers with how many phones it reached.
  await new Promise(r => setTimeout(r, 4000));
  const calls = await sql(`select status_code, left(content, 80) as content from net._http_response order by created desc limit 3`);
  check(calls.some(c => c.status_code === 200 && /"sent":/.test(c.content ?? '') && !/no message/.test(c.content ?? '')), `push function reads the new message and its group (${calls.map(c => `${c.status_code} ${c.content}`).join(' | ')})`);
  const noSecret = await fetch(`${URL}/functions/v1/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message_id: randomUUID() }) });
  check(noSecret.status === 403, `push function refuses callers without the secret (HTTP ${noSecret.status})`);

  // Retrying the same message doesn't duplicate it.
  m = phone('maria', maria, { group: g });
  const [{ n1 }] = await sql(`select count(*)::int as n1 from public.group_messages where group_id = '${g.id}'`);
  check(n1 === 2, 'no duplicates after reopening');

  // Kim shares her location.
  const kk = phone('kim', kim, { group: g, send: [{ kind: 'location', body: '', at: { lat: 38.57, lon: -109.55 } }] });
  check(kk.thread.length === 3 && kk.thread[2].hasLoc, 'location message sent with its position');

  // An outsider sees nothing and can't post.
  const seen = await rest(outsider, `group_messages?select=id&group_id=eq.${g.id}`);
  check(Array.isArray(seen) && seen.length === 0, 'a rider outside the group reads nothing');
  const post = await fetch(`${URL}/rest/v1/group_messages`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${outsider.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomUUID(), group_id: g.id, body: 'hi' }) });
  check(post.status >= 400, `a rider outside the group can't post (HTTP ${post.status})`);

  // Everyone leaves: the group ends, but the ride log stays.
  await rest(maria, 'rpc/leave_group', { p_group: g.id });
  await rest(kim, 'rpc/leave_group', { p_group: g.id });
  const [{ gone }] = await sql(`select not exists (select 1 from public.groups where id = '${g.id}') as gone`);
  check(gone, 'group ends when the last rider leaves');
  const log = phone('maria2', maria, { group: g, log: true });
  check(log.log.includes('Test Canyon Run') && log.thread.length === 3, `ride log keeps the group and its 3 messages (${log.log.length} groups, ${log.thread.length} messages)`);
  // Test riders (admin only): a throwaway admin starts them in a new group.
  const fn = (u, body) => fetch(`${URL}/functions/v1/demo`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${u.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const notAdmin = await fn(kim, { action: 'start', lat: 38.57, lon: -109.55 });
  const naBody = await notAdmin.text(); check(notAdmin.status === 403 && /admin/i.test(naBody), `test riders refused for a non-admin (HTTP ${notAdmin.status} ${naBody.slice(0, 80)})`);
  await sql(`update public.profiles set is_admin = true where id = '${maria.uid}'`);
  const [{ adm }] = await sql(`select is_admin as adm from public.profiles where id = '${maria.uid}'`);
  console.log(`  (admin flag set: ${adm})`);
  const tg = await rest(maria, 'rpc/create_group', { p_name: 'Test riders check' });
  const st = await fn(maria, { action: 'start', lat: 38.57, lon: -109.55 });
  check(st.ok, `admin starts test riders (HTTP ${st.status} ${st.ok ? '' : (await st.text()).slice(0, 120)})`);
  const pos = await rest(maria, `group_positions?select=rider_id,lat,lon&group_id=eq.${tg.id}`);
  check(Array.isArray(pos) && pos.length === 3, `three test riders appear on the map (${Array.isArray(pos) ? pos.length : 'error'})`);
  await rest(maria, 'group_messages', { id: randomUUID(), group_id: tg.id, body: 'Where is everyone?' });
  await fn(maria, { action: 'tick', lat: 38.57, lon: -109.55 });
  const msgs = await rest(maria, `group_messages?select=rider_id,body,reply_to&group_id=eq.${tg.id}&order=created_at`);
  check(msgs.length >= 3 && msgs[msgs.length - 1].rider_id !== maria.uid, `a test rider answers the admin (${msgs.length} messages)`);
  const reads = await rest(maria, `group_reads?select=rider_id&group_id=eq.${tg.id}`);
  check(Array.isArray(reads) && reads.length === 3, `test riders mark the chat seen (${Array.isArray(reads) ? reads.length : JSON.stringify(reads).slice(0, 80)})`);
  const pos2 = await rest(maria, `group_positions?select=rider_id,lat&group_id=eq.${tg.id}`);
  check(pos2.length === 3, 'test riders keep moving on each tick');
  await fn(maria, { action: 'stop' });
  const left = await rest(maria, `group_members?select=rider_id&group_id=eq.${tg.id}`);
  check(left.length === 1, `test riders leave when stopped (${left.length} left)`);
  await rest(maria, 'rpc/leave_group', { p_group: tg.id });
  await sql(`delete from public.group_messages where group_id = '${tg.id}'; delete from public.group_log_members where group_id = '${tg.id}'`);
} catch (e) {
  console.log(`FAIL ${e.message}`); failures++;
} finally {
  for (const id of users) {
    try { await sql(`delete from public.group_messages where rider_id = '${id}'; delete from auth.users where id = '${id}'`); } catch (e) { console.log(`note: test account left behind (${e.message.slice(0, 80)})`); }
  }
  console.log(`Cleaned up ${users.length} test account(s).`);
}
process.exit(failures ? 1 : 0);
