// One "phone" for the live messaging test (scripts/test-messages.mjs). Runs messages.ts in Node with a stand-in
// for the browser's storage. Each run is a fresh process, like reopening the app; localStorage persists in a file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [stateFile, cmdJson] = process.argv.slice(2);
const mem: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const g = globalThis as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => (k in mem ? mem[k] : null), setItem: (k: string, v: string) => { mem[k] = String(v); }, removeItem: (k: string) => { delete mem[k]; } };
g.window = globalThis;
const cmd = JSON.parse(cmdJson) as { group?: { id: string; name: string; code: string }; offline?: boolean; send?: { kind: 'text' | 'quick' | 'location'; body: string; at?: { lat: number; lon: number } }[]; listen?: number; log?: boolean };
let online = !cmd.offline;
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });

const { GroupChat } = await import('../src/messages.ts');
const client = createClient(process.env.TL_URL!, process.env.TL_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${process.env.TL_TOKEN}` } },
});
client.realtime.setAuth(process.env.TL_TOKEN!);
const community = { uid: process.env.TL_UID!, client, group: cmd.group ?? null, members: [] };
const chat = new GroupChat(community as never);
const live: string[] = [];
chat.onIncoming = m => live.push(m.body || m.kind);

for (const s of cmd.send ?? []) chat.send(s.kind, s.body, s.at);
await new Promise(r => setTimeout(r, 300));
if (online) {
  await chat.flush();
  if (cmd.group) await chat.refresh(cmd.group.id);
  if (cmd.listen) await new Promise(r => setTimeout(r, cmd.listen));
  if (cmd.log) await chat.refreshLog();
}
const thread = cmd.group ? chat.thread(cmd.group.id) : [];
console.log(`RESULT ${JSON.stringify({
  thread: thread.map(m => ({ body: m.body, kind: m.kind, by: m.by, pending: !!m.pending, hasLoc: m.lat != null })),
  live, log: chat.log.map(l => l.name),
})}`);
chat.stop();
writeFileSync(stateFile, JSON.stringify(mem));
process.exit(0);
