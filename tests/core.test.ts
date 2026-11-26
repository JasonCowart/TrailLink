import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, decodeInvite, encodeInvite, shortCode } from '../src/core/group.ts';
import { newGroupKey, open, seal } from '../src/core/seal.ts';
import { PacketStore } from '../src/core/store.ts';
import { Router, type Link } from '../src/core/router.ts';
import { SimLink, SimMedium, bluetoothExchange } from '../src/core/links/simulated.ts';
import { buildGraph, chainWarnings } from '../src/core/chain.ts';
import { SeparationWatch, ageLabel, viaLabel } from '../src/core/status.ts';
import type { Envelope, Group, Sealed } from '../src/core/types.ts';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

// ---------- encryption ----------
test('sealed packets open with the group key and nothing else', async () => {
  const key = newGroupKey();
  const env: Envelope = { id: 'abc', groupId: 'g1', sender: 'me', ts: 1000, body: { kind: 'message', data: { text: 'Gate is open' } } };
  const s = await seal(env, key);
  assert.ok(!JSON.stringify(s).includes('Gate'), 'text must not appear in the clear');
  assert.deepEqual(await open(s, key), env);
  assert.equal(await open(s, newGroupKey()), null, 'wrong key');
  assert.equal(await open({ ...s, i: 'other' }, key), null, 'swapped packet id is rejected');
});

// ---------- invites ----------
test('QR invite round-trips and rejects junk', () => {
  const g = createGroup('Saturday Ridge Run', 'me', 0);
  const back = decodeInvite(encodeInvite(g));
  assert.deepEqual(back, g);
  assert.equal(decodeInvite('hello'), null);
  assert.equal(decodeInvite('TL1:@@@'), null);
  assert.match(shortCode(g), /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
});

// ---------- helpers ----------
function phone(group: Group, id: string, now: () => number) {
  const store = new PacketStore();
  const router = new Router(store, group, id, now);
  return { id, store, router };
}

/** A shared fake cloud: every phone with signal sees everything. */
class FakeCloud {
  members: { link: CloudLink }[] = [];
}
class CloudLink implements Link {
  name = 'cell' as const;
  up = true;
  private recv: (p: Sealed) => void = () => {};
  private cloud: FakeCloud;
  constructor(cloud: FakeCloud) { this.cloud = cloud; cloud.members.push({ link: this }); }
  isUp() { return this.up; }
  setReceiver(fn: (p: Sealed) => void) { this.recv = fn; }
  async send(ps: Sealed[]) { for (const m of this.cloud.members) if (m.link !== this && m.link.up) ps.forEach(p => m.link.recv(p)); }
}

// ---------- router ----------
test('a message reaches the group over cell, and a second copy over another link is dropped', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'a', 0);
  const A = phone(g, 'a', now), B = phone(g, 'b', now);
  const cloud = new FakeCloud();
  A.router.addLink(new CloudLink(cloud)); B.router.addLink(new CloudLink(cloud));
  const medium = new SimMedium(1000);
  A.router.addLink(new SimLink('mesh', medium, 'a', { lat: 39, lon: -105 }));
  B.router.addLink(new SimLink('mesh', medium, 'b', { lat: 39.001, lon: -105 }));

  await A.router.publish({ kind: 'message', data: { text: 'Regroup at the gate' } });
  await settle();
  const msgs = B.store.messages(g.id);
  assert.equal(msgs.length, 1, 'exactly one copy despite two links');
  assert.equal(msgs[0].body.kind === 'message' && msgs[0].body.data.text, 'Regroup at the gate');
});

test('packets queue while every link is down and go out when one comes back', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'a', 0);
  const A = phone(g, 'a', now), B = phone(g, 'b', now);
  const cloud = new FakeCloud();
  const la = new CloudLink(cloud), lb = new CloudLink(cloud);
  A.router.addLink(la); B.router.addLink(lb);
  la.up = false;
  await A.router.publish({ kind: 'position', data: { lat: 39, lon: -105, accuracy: 5 } });
  await settle();
  assert.equal(B.store.size, 0);
  assert.equal(A.router.pendingCount(), 1);
  la.up = true;
  await A.router.flush();
  await settle();
  assert.equal(B.store.size, 1);
  assert.equal(A.router.pendingCount(), 0);
});

test('mesh relays along the chain of vehicles: leader reaches sweep through the middle rider', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'lead', 0);
  // ~1.1 km apart in a line; radio range 1.5 km, so lead cannot hear sweep directly.
  const medium = new SimMedium(1500);
  const lead = phone(g, 'lead', now), mid = phone(g, 'mid', now), sweep = phone(g, 'sweep', now);
  lead.router.addLink(new SimLink('mesh', medium, 'lead', { lat: 39.0, lon: -105 }));
  mid.router.addLink(new SimLink('mesh', medium, 'mid', { lat: 39.01, lon: -105 }));
  sweep.router.addLink(new SimLink('mesh', medium, 'sweep', { lat: 39.02, lon: -105 }));
  assert.equal(medium.canHear('lead', 'sweep'), false);

  await lead.router.publish({ kind: 'message', data: { text: 'Turning left at the fork' } });
  await settle();
  assert.equal(sweep.store.messages(g.id).length, 1);
  assert.equal(sweep.store.messages(g.id)[0].via, 'mesh');
});

test('a canyon blocks the radio; a passing rider carries the position over Bluetooth', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'lead', 0);
  const inCanyon = (p: { lat: number }) => p.lat > 39.015;
  const medium = new SimMedium(1500, (a, b) => inCanyon(a) || inCanyon(b));
  const bt = new SimMedium(50);
  const lead = phone(g, 'lead', now), mid = phone(g, 'mid', now), jake = phone(g, 'jake', now);
  lead.router.addLink(new SimLink('mesh', medium, 'lead', { lat: 39.0, lon: -105 }));
  mid.router.addLink(new SimLink('mesh', medium, 'mid', { lat: 39.01, lon: -105 }));
  jake.router.addLink(new SimLink('mesh', medium, 'jake', { lat: 39.02, lon: -105 }));
  const midBt = new SimLink('bluetooth', bt, 'mid', { lat: 39.01, lon: -105 });
  const jakeBt = new SimLink('bluetooth', bt, 'jake', { lat: 39.02, lon: -105 });
  mid.router.addLink(midBt); jake.router.addLink(jakeBt);

  await jake.router.publish({ kind: 'position', data: { lat: 39.02, lon: -105, accuracy: 6 } });
  await settle();
  assert.equal(lead.store.latestPositions(g.id).has('jake'), false, 'blocked by the canyon');

  // Mid rides past Jake: their phones swap over Bluetooth, then mid's radio passes it to the leader.
  await bluetoothExchange({ id: 'jake', store: jake.store, link: jakeBt }, { id: 'mid', store: mid.store, link: midBt });
  await settle();
  const atLead = lead.store.latestPositions(g.id).get('jake');
  assert.ok(atLead, 'leader now has Jake');
  assert.equal(mid.store.latestPositions(g.id).get('jake')?.via, 'bluetooth');
});

test('positions carried by another phone are labelled with who carried them', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'a', 0);
  const bt = new SimMedium(50);
  const dean = phone(g, 'dean', now), maria = phone(g, 'maria', now), me = phone(g, 'me', now);
  const dl = new SimLink('bluetooth', bt, 'dean', { lat: 39, lon: -105 });
  const ml = new SimLink('bluetooth', bt, 'maria', { lat: 39, lon: -105.0001 });
  const mel = new SimLink('bluetooth', bt, 'me', { lat: 39.5, lon: -105 });
  dean.router.addLink(dl); maria.router.addLink(ml); me.router.addLink(mel);
  await dean.router.publish({ kind: 'position', data: { lat: 39, lon: -105, accuracy: 5 } });
  await settle();
  await bluetoothExchange({ id: 'maria', store: maria.store, link: ml }, { id: 'me', store: me.store, link: mel });
  await settle();
  const r = me.store.latestPositions(g.id).get('dean');
  assert.ok(r);
  assert.equal(r.via, 'carried:maria');
  assert.equal(viaLabel(r.via, id => ({ maria: 'Maria' } as Record<string, string>)[id]), 'carried by Maria');
});

test('SOS goes out ahead of other queued packets', async () => {
  const now = () => 10_000;
  const g = createGroup('Ride', 'a', 0);
  const A = phone(g, 'a', now);
  const order: string[] = [];
  const link: Link = { name: 'cell', isUp: () => up, setReceiver() {}, async send(ps) { ps.forEach(p => order.push(A.store.get(p.i)!.body.kind)); } };
  let up = false;
  A.router.addLink(link);
  await A.router.publish({ kind: 'position', data: { lat: 1, lon: 1, accuracy: 5 } });
  await A.router.publish({ kind: 'message', data: { text: 'hi' } });
  await A.router.publish({ kind: 'sos', data: { lat: 1, lon: 1, active: true } });
  up = true;
  await A.router.flush();
  assert.equal(order[0], 'sos');
  assert.equal(A.store.activeSos(g.id).length, 1);
});

// ---------- chain-break warnings ----------
test('finds the rider who is the only link to someone else', () => {
  // me hears Maria and Kim; Maria hears Jake; nobody else hears Jake.
  const g = buildGraph(new Map([
    ['me', ['maria', 'kim']],
    ['maria', ['me', 'jake']],
    ['kim', ['me']],
    ['jake', ['maria']],
  ]));
  assert.deepEqual(chainWarnings(g, 'me'), [{ link: 'maria', dependents: ['jake'] }]);
  // Once Kim can also hear Jake, Maria is no longer the only link.
  const g2 = buildGraph(new Map([['me', ['maria', 'kim']], ['maria', ['jake']], ['kim', ['jake']]]));
  assert.deepEqual(chainWarnings(g2, 'me'), []);
});

// ---------- freshness and alerts ----------
test('age labels and separation alerts', async () => {
  assert.equal(ageLabel(0, 5_000), 'live');
  assert.equal(ageLabel(0, 42_000), '42s ago');
  assert.equal(ageLabel(0, 6 * 60_000), '6 min ago');

  const watch = new SeparationWatch(10);
  const store = new PacketStore();
  const g = createGroup('Ride', 'me', 0);
  const env: Envelope = { id: 'p1', groupId: g.id, sender: 'jake', ts: 0, body: { kind: 'position', data: { lat: 1, lon: 1, accuracy: 5 } } };
  store.add(env, await seal(env, g.key), 'mesh', 0);
  const latest = store.latestPositions(g.id);
  assert.deepEqual(watch.check(latest, 'me', 5 * 60_000), []);
  assert.deepEqual(watch.check(latest, 'me', 11 * 60_000), [{ rider: 'jake', minutesSilent: 11 }]);
  assert.deepEqual(watch.check(latest, 'me', 12 * 60_000), [], 'alerts once, not every check');
});
