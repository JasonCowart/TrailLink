// The transport router: sends every packet over every link that is up, and merges what comes in.
import type { Body, Envelope, Group, LinkName, Received, Sealed } from './types.ts';
import { newId } from './b64.ts';
import { open, seal } from './seal.ts';
import { PacketStore } from './store.ts';

/** A way of moving sealed packets: cloud relay, Meshtastic radio, Bluetooth, simulated radio... */
export interface Link {
  name: LinkName;
  isUp(): boolean;
  send(packets: Sealed[]): Promise<void>;
  /** Link calls this for each packet it receives. `carriedBy` is set when a peer forwards someone else's packet. */
  setReceiver(fn: (p: Sealed, carriedBy?: string) => void): void;
  /** Max bytes per packet (LoRa is small). Packets bigger than this are skipped on this link. */
  maxBytes?: number;
}

export class Router {
  private links: Link[] = [];
  /** Packet id -> links it has NOT gone out on yet. Retried whenever a link comes up. */
  private pending = new Map<string, Set<LinkName>>();

  store: PacketStore;
  group: Group;
  me: string;
  private now: () => number;
  constructor(store: PacketStore, group: Group, me: string, now: () => number = () => Date.now()) {
    this.store = store; this.group = group; this.me = me; this.now = now;
  }

  addLink(link: Link) {
    this.links.push(link);
    link.setReceiver((p, carriedBy) => { void this.receive(p, link.name, carriedBy); });
  }

  linksUp(): LinkName[] { return this.links.filter(l => l.isUp()).map(l => l.name); }

  /** Create, store and send a new packet from this rider. */
  async publish(body: Body): Promise<Received> {
    const env: Envelope = { id: newId(), groupId: this.group.id, sender: this.me, ts: this.now(), body };
    const sealed = await seal(env, this.group.key);
    this.store.add(env, sealed, 'local', this.now());
    this.pending.set(env.id, new Set(this.links.map(l => l.name)));
    await this.flush();
    return this.store.get(env.id) as Received;
  }

  /** Try to send everything still pending on links that are up now. SOS goes first. */
  async flush() {
    for (const link of this.links) {
      if (!link.isUp()) continue;
      const batch: Sealed[] = [];
      for (const [id, waiting] of this.pending) {
        if (!waiting.has(link.name)) continue;
        const s = this.store.sealedFor(id);
        if (!s) { this.pending.delete(id); continue; }
        if (link.maxBytes && JSON.stringify(s).length > link.maxBytes) { waiting.delete(link.name); continue; }
        batch.push(s);
      }
      if (!batch.length) continue;
      batch.sort((a, b) => this.priority(b) - this.priority(a));
      try {
        await link.send(batch);
        batch.forEach(s => this.pending.get(s.i)?.delete(link.name));
      } catch { /* stays pending; retried on next flush */ }
    }
    for (const [id, waiting] of this.pending) if (waiting.size === 0) this.pending.delete(id);
  }

  private priority(s: Sealed): number {
    const r = this.store.get(s.i);
    return r?.body.kind === 'sos' ? 2 : r?.body.kind === 'position' ? 0 : 1;
  }

  /** Handle an incoming sealed packet. New packets are stored and re-sent on the other links (relaying). */
  async receive(p: Sealed, via: LinkName, carriedBy?: string): Promise<boolean> {
    if (p.g !== this.group.id || this.store.has(p.i)) return false;
    const env = await open(p, this.group.key);
    if (!env || env.sender === this.me) return false;
    const added = this.store.add(env, p, carriedBy ? `carried:${carriedBy}` : via, this.now());
    if (added) {
      // Pass it on over every other link so riders out of our range still get it.
      this.pending.set(p.i, new Set(this.links.map(l => l.name).filter(n => n !== via)));
      await this.flush();
    }
    return added;
  }

  pendingCount() { return this.pending.size; }
  /** Links a packet has gone out on so far. */
  sentOn(id: string): LinkName[] {
    const waiting = this.pending.get(id);
    return this.links.map(l => l.name).filter(n => !waiting || !waiting.has(n));
  }
}
