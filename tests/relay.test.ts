import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { RelayStore, createRelay, KEEP_MS } from '../server/relay.ts';
import { CloudLink } from '../src/core/links/cloud.ts';
import { PacketStore } from '../src/core/store.ts';
import { Router } from '../src/core/router.ts';
import { createGroup } from '../src/core/group.ts';

const settle = () => new Promise(r => setTimeout(r, 20));

test('relay stores packets once, serves them by cursor, and forgets them after 24 hours', () => {
  let now = 1_000_000_000;
  const s = new RelayStore(() => now);
  const p = (i: string, t = now) => ({ v: 1 as const, g: 'group01', i: `pkt_${i}xx`, t, n: 'n', c: 'c' });
  assert.deepEqual(s.put('group01', [p('a'), p('b'), p('a')]), { stored: 2, cursor: 2 });
  assert.equal(s.get('group01', 0).packets.length, 2);
  assert.equal(s.get('group01', 1).packets.length, 1);
  assert.equal(s.put('group01', [p('old', now - KEEP_MS - 1)]).stored, 0, 'too old');
  assert.equal(s.put('group01', [{ ...p('c'), g: 'other01' }]).stored, 0, 'wrong group');
  now += KEEP_MS + 1;
  assert.equal(s.get('group01', 0).packets.length, 0, 'expired');
});

test('two phones exchange a message through the real HTTP relay', async () => {
  const server = createRelay();
  await new Promise<void>(r => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const g = createGroup('Ride', 'a');
    const mk = (id: string) => {
      const store = new PacketStore();
      const router = new Router(store, g, id);
      const link = new CloudLink(base, g.id);
      link.setOnline(true);
      router.addLink(link);
      return { store, router, link };
    };
    const A = mk('a'), B = mk('b');
    await A.router.publish({ kind: 'message', data: { text: 'Fuel stop at the store' } });
    await B.link.poll();
    await settle();
    const msgs = B.store.messages(g.id);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].via, 'cell');
    // A rogue client posting junk is rejected without crashing.
    const bad = await fetch(`${base}/v1/groups/${g.id}/packets`, { method: 'POST', body: '{"nope":1}' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
