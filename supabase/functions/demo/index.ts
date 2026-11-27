// TrailLink "demo" function: test riders for the admin. Three pretend riders (Kim, Dean and Maria, marked "(test)")
// join the admin's current group, ride slow loops around the admin, chat now and then, and answer the admin's
// messages (some as replies). The app calls "tick" every 10 s while test riders are on.
//   start {lat, lon} · tick {lat, lon} · later {lat, lon, seconds} (one message after a delay, to test notifications) · stop
import { createClient } from 'npm:@supabase/supabase-js@2';

// The project's secret key (new-style keys first; the legacy service-role key as a fallback).
const SECRET_KEY = (() => { try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); return (k.default ?? Object.values(k)[0]) as string | undefined; } catch { return undefined; } })()
  ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SECRET_KEY, { auth: { persistSession: false } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const BOTS = [
  { id: 'd0000000-0000-4000-8000-000000000001', name: 'Kim', r: 350, speed: 0.9, phase: 0 },
  { id: 'd0000000-0000-4000-8000-000000000002', name: 'Dean', r: 650, speed: -0.6, phase: 2.1 },
  { id: 'd0000000-0000-4000-8000-000000000003', name: 'Maria', r: 1000, speed: 0.4, phase: 4.2 },
];
const CHATTER = ['Stopping', 'Go ahead', 'All good', 'Wait for me', 'Great view up here', 'Little muddy past the creek', 'Taking a water break', 'See you at the top'];
const ANSWERS = ['Got it 👍', 'On my way', 'Copy that', 'Sounds good', 'Be there in 5', 'OK, waiting here'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });

/** Where a test rider is now: a slow loop around the admin. */
function spot(b: typeof BOTS[number], lat: number, lon: number) {
  const a = b.phase + (Date.now() / 60000) * b.speed; // radians per minute
  const dLat = (b.r * Math.cos(a)) / 111320, dLon = (b.r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon, heading: ((a * 180) / Math.PI + (b.speed > 0 ? 90 : -90) + 360) % 360, speed: Math.abs(b.speed) * b.r / 60 };
}
async function say(group: string, bot: string, body: string, replyTo?: string) {
  await db.from('group_messages').insert({ id: crypto.randomUUID(), group_id: group, rider_id: bot, kind: CHATTER.slice(0, 4).includes(body) ? 'quick' : 'text', body, reply_to: replyTo ?? null });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method === 'GET') return json({ env: Object.keys(Deno.env.toObject()).filter(k => k.startsWith('SUPABASE')).sort() }); // names only, for setup checks
  // Only the admin, signed in.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: 'Sign in first.' }, 401);
  const { data: me, error: pe } = await db.from('profiles').select('is_admin').eq('id', u.user.id).maybeSingle();
  if (pe) return json({ error: `Couldn't check admin: ${pe.message}` }, 500);
  if (!me?.is_admin) return json({ error: 'Only the admin can use test riders.' }, 403);
  const { action, lat, lon, seconds } = await req.json().catch(() => ({}));
  const { data: gm } = await db.from('group_members').select('group_id').eq('rider_id', u.user.id).limit(1);
  const group = gm?.[0]?.group_id as string | undefined;

  if (action === 'stop') {
    const { error } = await db.from('group_members').delete().in('rider_id', BOTS.map(b => b.id));
    return json({ ok: !error, running: false });
  }
  if (!group) return json({ error: 'Start or join a group first.' }, 400);
  if (typeof lat !== 'number' || typeof lon !== 'number') return json({ error: 'No position.' }, 400);
  const moveAll = async () => {
    await db.from('group_positions').upsert(BOTS.map(b => { const p = spot(b, lat, lon); return { group_id: group, rider_id: b.id, lat: p.lat, lon: p.lon, acc: 6, speed: p.speed, heading: p.heading, at: new Date().toISOString() }; }), { onConflict: 'group_id,rider_id' });
  };

  if (action === 'start') {
    await db.from('group_members').delete().in('rider_id', BOTS.map(b => b.id)); // leave any older group
    await db.from('group_members').insert(BOTS.map(b => ({ group_id: group, rider_id: b.id, sharing: true })));
    await moveAll();
    await say(group, BOTS[0].id, 'Hi! Test riders here. Send us a message, or tap one of ours to reply.');
    return json({ ok: true, running: true });
  }
  const { data: inGroup } = await db.from('group_members').select('rider_id').eq('group_id', group).in('rider_id', BOTS.map(b => b.id));
  if (!inGroup?.length) return json({ ok: true, running: false });

  if (action === 'help') {
    // Maria asks for help from where she is; she sends "I'm OK" on her own about 90 s later (on a tick).
    const b = BOTS[2], p = spot(b, lat, lon);
    await db.from('group_messages').insert({ id: crypto.randomUUID(), group_id: group, rider_id: b.id, kind: 'help', body: 'Need help', lat: p.lat, lon: p.lon });
    return json({ ok: true, running: true });
  }
  if (action === 'later') {
    // One message after a delay, so the admin can close the app and see a notification.
    const wait = Math.min(Math.max(Number(seconds) || 20, 5), 60);
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil((async () => { await new Promise(r => setTimeout(r, wait * 1000)); await say(group, BOTS[1].id, 'Test notification: can you see this?'); })());
    return json({ ok: true, running: true, inSeconds: wait });
  }

  // tick: move, answer the admin, and chat now and then.
  await moveAll();
  const { data: recent } = await db.from('group_messages').select('id,rider_id,body,reply_to,created_at').eq('group_id', group).in('kind', ['text', 'quick', 'location']).order('created_at', { ascending: false }).limit(10);
  // A test rider's help alert clears itself after about 90 s.
  const { data: helps } = await db.from('group_messages').select('id,rider_id,created_at').eq('group_id', group).eq('kind', 'help').in('rider_id', BOTS.map(b => b.id)).order('created_at', { ascending: false }).limit(3);
  for (const h of helps ?? []) {
    const { data: cleared } = await db.from('group_messages').select('id').eq('group_id', group).eq('kind', 'helpclear').eq('reply_to', h.id).limit(1);
    if (!cleared?.length && Date.now() - Date.parse(h.created_at) > 90_000) await db.from('group_messages').insert({ id: crypto.randomUUID(), group_id: group, rider_id: h.rider_id, kind: 'helpclear', body: "I'm OK", reply_to: h.id });
  }
  // The admin asked for help: Kim answers it once.
  const { data: myHelp } = await db.from('group_messages').select('id').eq('group_id', group).eq('kind', 'help').eq('rider_id', u.user.id).order('created_at', { ascending: false }).limit(1);
  if (myHelp?.length) {
    const { data: answered } = await db.from('group_messages').select('id').eq('reply_to', myHelp[0].id).in('rider_id', BOTS.map(b => b.id)).limit(1);
    if (!answered?.length) await say(group, BOTS[0].id, 'Coming to you now. Stay put.', myHelp[0].id);
  }
  const latest = recent?.[0];
  if (latest && latest.rider_id === u.user.id) {
    // The admin spoke last: whoever was answered replies to it; otherwise a random test rider does.
    const answered = latest.reply_to ? recent!.find(m => m.id === latest.reply_to) : undefined;
    const bot = BOTS.find(b => b.id === answered?.rider_id) ?? pick(BOTS);
    await say(group, bot.id, /help/i.test(latest.body) ? 'Coming to you now. Stay put.' : pick(ANSWERS), Math.random() < 0.6 ? latest.id : undefined);
  } else if (Math.random() < 0.12) {
    await say(group, pick(BOTS).id, pick(CHATTER));
  }
  return json({ ok: true, running: true });
});
