// TrailLink: manage the Supabase project through the Management API (run by GitHub Actions only).
// Needs SUPABASE_ACCESS_TOKEN (a GitHub secret). The repo is public, so this script prints only
// counts, yes/no settings and error codes: never riders' emails, names or any secret.
//   node scripts/supabase-admin.mjs status
//   node scripts/supabase-admin.mjs sql supabase/004-admin.sql
//   node scripts/supabase-admin.mjs auth        (invite check hook, sign-in email, optional Gmail SMTP)
import { readFileSync } from 'node:fs';

const REF = 'yxcyqbxzggpejldkmdqe';
const API = `https://api.supabase.com/v1/projects/${REF}`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('::error::SUPABASE_ACCESS_TOKEN secret is missing'); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    // Error bodies describe the problem (e.g. missing_permissions), not rider data.
    const why = json?.missing_permissions ? `missing permissions: ${json.missing_permissions.join(', ')}` : (json?.message ?? text).slice(0, 300);
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${why}`);
  }
  return json;
}
const sql = q => call('POST', '/database/query', { query: q });

const AUTH_KEYS = ['disable_signup', 'external_email_enabled', 'hook_before_user_created_enabled', 'mailer_otp_length', 'rate_limit_email_sent'];
async function showAuth() {
  const a = await call('GET', '/config/auth');
  for (const k of AUTH_KEYS) console.log(`  ${k}: ${a[k]}`);
  console.log(`  custom email (SMTP) set up: ${!!a.smtp_host}`);
  console.log(`  sign-in email includes 6-digit code: ${/\.Token\b/.test(a.mailer_templates_magic_link_content ?? '')}`);
  return a;
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'status') {
    const [row] = await sql(`select
      (select count(*) from auth.users)::int as accounts,
      (select count(*) from public.profiles)::int as profiles,
      (select count(*) from public.ratings)::int as ratings,
      has_table_privilege('anon', 'public.ratings', 'select') as signed_out_can_read,
      to_regclass('public.invites') is not null as invite_list_exists,
      (select count(*) from pg_proc where proname = 'before_user_created')::int as invite_check_functions`);
    console.log('Database:'); for (const [k, v] of Object.entries(row)) console.log(`  ${k}: ${v}`);
    if (row.invite_list_exists) {
      const [r] = await sql(`select count(*)::int as invited, count(*) filter (where exists (select 1 from auth.users u where lower(u.email) = i.email))::int as joined,
        (select count(*) from public.profiles where is_admin)::int as admins from public.invites i`);
      for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);
    }
    console.log('Sign-in settings:'); await showAuth();
  } else if (cmd === 'sql') {
    await sql(readFileSync(arg, 'utf8'));
    console.log(`Applied ${arg}`);
  } else if (cmd === 'auth') {
    const cur = await call('GET', '/config/auth');
    const patch = {
      // Riders create their account the first time they sign in, but the database refuses any email
      // that isn't on the admin's invite list (public.before_user_created).
      hook_before_user_created_enabled: true,
      hook_before_user_created_uri: 'pg-functions://postgres/public/before_user_created',
      disable_signup: false,
      mailer_otp_length: 6,
    };
    const SMTP_USER = process.env.SMTP_USER?.trim(), SMTP_PASS = process.env.SMTP_PASS?.replace(/\s/g, '');
    if (SMTP_USER && SMTP_PASS) {
      Object.assign(patch, {
        smtp_host: 'smtp.gmail.com', smtp_port: '465', smtp_user: SMTP_USER, smtp_pass: SMTP_PASS,
        smtp_admin_email: SMTP_USER, smtp_sender_name: 'TrailLink', smtp_max_frequency: 30, rate_limit_email_sent: 100,
      });
    } else console.log('No SMTP_USER/SMTP_PASS secrets: keeping Supabase\'s built-in email (a few emails per hour).');
    if (SMTP_USER && SMTP_PASS || cur.smtp_host) {
      // Email templates can only be changed with custom email set up.
      Object.assign(patch, {
        // Code only, no link: a link opens the phone's default browser (not the TrailLink the rider is using).
        mailer_subjects_magic_link: 'Your TrailLink sign-in code: {{ .Token }}',
        mailer_templates_magic_link_content: `<h2>Sign in to TrailLink</h2>
<p>Type this code into TrailLink:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>It works once and expires in an hour. If you didn't ask for it, you can ignore this email.</p>`,
        mailer_subjects_confirmation: 'Your TrailLink sign-in code: {{ .Token }}',
        mailer_templates_confirmation_content: `<h2>Welcome to TrailLink</h2>
<p>Type this code into TrailLink to finish signing in:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>It works once and expires in an hour.</p>`,
      });
    }
    // Safety: only open sign-ups once the invite check exists in the database.
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc where proname = 'before_user_created' and pronamespace = 'public'::regnamespace`);
    if (!n) throw new Error('invite check function is missing; apply supabase/004-admin.sql first');
    await call('PATCH', '/config/auth', patch);
    console.log('Sign-in settings updated:'); await showAuth();
  } else if (cmd === 'test-email') {
    // Sends the admin a real sign-in email to prove the email setup works. The address is never printed.
    const [admin] = await sql(`select u.email from auth.users u join public.profiles p on p.id = u.id where p.is_admin order by u.created_at limit 1`);
    if (!admin?.email) throw new Error('no admin account found');
    const cfg = readFileSync('web/src/config.ts', 'utf8');
    const url = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0], key = cfg.match(/sb_publishable_[A-Za-z0-9_-]+/)[0];
    const res = await fetch(`${url}/auth/v1/otp`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: admin.email, create_user: false }) });
    const body = (await res.text()).replaceAll(admin.email, '<admin>').slice(0, 300);
    if (!res.ok) throw new Error(`sign-in email failed: HTTP ${res.status} ${body}`);
    console.log('Test sign-in email sent to the admin.');
  } else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  console.error(`::error::${e.message}`);
  process.exit(1);
}
