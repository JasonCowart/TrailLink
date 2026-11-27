// TrailLink "push" function (Supabase Edge Function): sends a phone notification to the other riders in a group
// when a message arrives. Called by the database (trigger on group_messages) with a shared secret.
// GET returns the public key phones need to sign up for notifications.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? '';
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://jasoncowart.github.io/TrailLink/', PUBLIC, PRIVATE);
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, apikey, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method === 'GET') return Response.json({ publicKey: PUBLIC }, { headers: cors });
  if (!SECRET || req.headers.get('x-push-secret') !== SECRET) return new Response('forbidden', { status: 403 });

  const { message_id } = await req.json().catch(() => ({}));
  const { data: m } = await db.from('group_messages').select('id,group_id,rider_id,kind,body').eq('id', message_id).maybeSingle();
  if (!m) return Response.json({ sent: 0, why: 'no message' });
  const [{ data: who }, { data: group }, { data: members }] = await Promise.all([
    db.from('profiles').select('display_name').eq('id', m.rider_id).maybeSingle(),
    db.from('groups').select('name').eq('id', m.group_id).maybeSingle(),
    db.from('group_members').select('rider_id').eq('group_id', m.group_id).neq('rider_id', m.rider_id),
  ]);
  const riders = (members ?? []).map(x => x.rider_id);
  if (!riders.length) return Response.json({ sent: 0 });
  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').in('rider_id', riders);
  const payload = JSON.stringify({
    title: `${who?.display_name ?? 'A rider'} · ${group?.name ?? 'Ride group'}`,
    body: m.kind === 'location' ? `Shared their location${m.body ? `: ${m.body}` : ''}` : m.body,
    tag: `group-${m.group_id}`,
    url: './#group',
  });
  let sent = 0;
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); // phone unsubscribed
    }
  }));
  return Response.json({ sent });
});
