// TrailLink relay server. Dependency-free Node (22+).
// It stores ENCRYPTED packets for 24 hours so riders who were offline can catch up.
// It never sees group keys, so it cannot read positions or messages.
//
//   POST /v1/groups/:groupId/packets      body: Sealed[]       -> { stored, cursor }
//   GET  /v1/groups/:groupId/packets?since=<cursor>            -> { packets, cursor }
//   GET  /health                                               -> ok
//
// Run: node server/relay.ts   (PORT env var, default 8787)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const KEEP_MS = 24 * 3600_000;
const MAX_BODY = 256 * 1024;
const MAX_PER_GROUP = 20_000;
const MAX_RETURN = 1000;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

interface Sealed { v: 1; g: string; i: string; t: number; n: string; c: string }
interface Stored { seq: number; p: Sealed }

export class RelayStore {
  private groups = new Map<string, { seq: number; ids: Set<string>; items: Stored[] }>();
  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  put(groupId: string, packets: Sealed[]): { stored: number; cursor: number } {
    let g = this.groups.get(groupId);
    if (!g) { g = { seq: 0, ids: new Set(), items: [] }; this.groups.set(groupId, g); }
    const now = this.now();
    let stored = 0;
    for (const p of packets) {
      if (!valid(p) || p.g !== groupId || g.ids.has(p.i)) continue;
      if (p.t < now - KEEP_MS || p.t > now + 10 * 60_000) continue; // too old, or clock far ahead
      g.items.push({ seq: ++g.seq, p });
      g.ids.add(p.i);
      stored++;
    }
    this.prune(groupId);
    return { stored, cursor: g.seq };
  }

  get(groupId: string, since: number): { packets: Sealed[]; cursor: number } {
    this.prune(groupId);
    const g = this.groups.get(groupId);
    if (!g) return { packets: [], cursor: 0 };
    const items = g.items.filter(s => s.seq > since).slice(0, MAX_RETURN);
    return { packets: items.map(s => s.p), cursor: items.length ? items[items.length - 1].seq : Math.max(since, 0) };
  }

  prune(groupId: string) {
    const g = this.groups.get(groupId);
    if (!g) return;
    const cutoff = this.now() - KEEP_MS;
    while (g.items.length && (g.items[0].p.t < cutoff || g.items.length > MAX_PER_GROUP)) {
      g.ids.delete(g.items.shift()!.p.i);
    }
    if (!g.items.length && g.seq > 0) { /* keep seq so cursors stay valid */ }
  }
}

function valid(p: unknown): p is Sealed {
  const s = p as Sealed;
  return !!s && s.v === 1 && typeof s.g === 'string' && typeof s.i === 'string' && ID_RE.test(s.i)
    && typeof s.t === 'number' && typeof s.n === 'string' && typeof s.c === 'string' && s.c.length < 8000;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRelay(store = new RelayStore()) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    const m = url.pathname.match(/^\/v1\/groups\/([A-Za-z0-9_-]{6,64})\/packets$/);
    if (!m) return send(res, 404, { error: 'not found' });
    const groupId = m[1];
    try {
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        if (!Array.isArray(body) || body.length > 500) return send(res, 400, { error: 'expected an array of up to 500 packets' });
        return send(res, 200, store.put(groupId, body));
      }
      if (req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0) || 0;
        return send(res, 200, store.get(groupId, since));
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  createRelay().listen(port, () => console.log(`TrailLink relay listening on :${port}`));
}
