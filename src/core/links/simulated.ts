// A simulated radio medium, used by tests and by the app's developer mode until real radios are switched on.
// Nodes within `rangeM` of each other hear each other, unless `blocked` says terrain is in the way.
import type { LinkName, Sealed } from '../types.ts';
import type { Link } from '../router.ts';
import { distanceM } from '../geo.ts';
import { missingFor, summary } from '../gossip.ts';
import type { PacketStore } from '../store.ts';

type Pos = { lat: number; lon: number };

export class SimMedium {
  nodes = new Map<string, { pos: Pos; link: SimLink }>();
  rangeM: number;
  blocked: (a: Pos, b: Pos) => boolean;
  constructor(rangeM: number, blocked: (a: Pos, b: Pos) => boolean = () => false) { this.rangeM = rangeM; this.blocked = blocked; }

  canHear(a: string, b: string): boolean {
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (!A || !B || a === b) return false;
    return distanceM(A.pos, B.pos) <= this.rangeM && !this.blocked(A.pos, B.pos);
  }

  neighbours(id: string): string[] {
    return [...this.nodes.keys()].filter(o => this.canHear(id, o));
  }

  move(id: string, pos: Pos) { const n = this.nodes.get(id); if (n) n.pos = pos; }
}

/** A mesh-radio-like link: broadcasts reach neighbours only; relaying happens in each phone's Router. */
export class SimLink implements Link {
  private recv: (p: Sealed, carriedBy?: string) => void = () => {};
  up = true;
  name: LinkName;
  nodeId: string;
  maxBytes?: number;
  private medium: SimMedium;
  constructor(name: LinkName, medium: SimMedium, nodeId: string, pos: Pos, maxBytes?: number) {
    this.name = name; this.medium = medium; this.nodeId = nodeId; this.maxBytes = maxBytes;
    medium.nodes.set(nodeId, { pos, link: this });
  }
  isUp() { return this.up; }
  setReceiver(fn: (p: Sealed, carriedBy?: string) => void) { this.recv = fn; }
  /** Like Meshtastic firmware, a mesh radio rebroadcasts packets it hasn't seen, up to `hopLimit` hops. */
  hopLimit = 3;
  private seen = new Set<string>();

  async send(packets: Sealed[]) {
    packets.forEach(p => this.seen.add(p.i));
    this.broadcast(packets.map(p => ({ p, hops: this.hopLimit })));
  }

  private broadcast(items: { p: Sealed; hops: number }[]) {
    for (const other of this.medium.neighbours(this.nodeId)) {
      const link = this.medium.nodes.get(other)!.link;
      if (link.up) items.forEach(({ p, hops }) => link.hear(p, hops));
    }
  }

  private hear(p: Sealed, hops: number) {
    if (this.seen.has(p.i)) return;
    this.seen.add(p.i);
    this.recv(p);
    if (this.name === 'mesh' && hops > 1) queueMicrotask(() => this.broadcast([{ p, hops: hops - 1 }]));
  }
  deliver(p: Sealed, carriedBy?: string) { this.recv(p, carriedBy); }
}

/**
 * Simulated Bluetooth meeting between two phones: each sends the other what it is missing.
 * Packets the peer did not create itself are marked as carried by that peer.
 */
export async function bluetoothExchange(
  a: { id: string; store: PacketStore; link: SimLink },
  b: { id: string; store: PacketStore; link: SimLink },
) {
  const toB = missingFor(a.store, summary(b.store));
  const toA = missingFor(b.store, summary(a.store));
  const senderOf = (store: PacketStore, id: string) => store.get(id)?.sender;
  for (const p of toB) b.link.deliver(p, senderOf(a.store, p.i) === a.id ? undefined : a.id);
  for (const p of toA) a.link.deliver(p, senderOf(b.store, p.i) === b.id ? undefined : b.id);
}
