// The phone's packet store: the source of truth on the trail.
// Keeps every packet for 24 hours (so it can be passed on to riders who missed it) and
// derives the views the screens need: latest position per rider, chat, pins, SOS state.
import type { Envelope, LinkName, Received, Rider, Sealed } from './types.ts';

export const KEEP_MS = 24 * 3600_000;

export interface Persistence {
  load(): Promise<{ received: Received[]; sealed: Sealed[] }>;
  save(r: Received, s: Sealed): Promise<void>;
  prune(before: number): Promise<void>;
}

export class PacketStore {
  private byId = new Map<string, Received>();
  private sealedById = new Map<string, Sealed>();
  private listeners = new Set<(r: Received) => void>();

  private persistence?: Persistence;
  constructor(persistence?: Persistence) { this.persistence = persistence; }

  async init() {
    if (!this.persistence) return;
    const { received, sealed } = await this.persistence.load();
    received.forEach(r => this.byId.set(r.id, r));
    sealed.forEach(s => this.sealedById.set(s.i, s));
  }

  has(id: string) { return this.byId.has(id); }
  get(id: string) { return this.byId.get(id); }
  get size() { return this.byId.size; }

  /** Adds a packet. Returns false if we already had it (the duplicate is dropped). */
  add(env: Envelope, sealed: Sealed, via: Received['via'], now = Date.now()): boolean {
    if (this.byId.has(env.id)) return false;
    if (now - env.ts > KEEP_MS) return false;
    const r: Received = { ...env, via, receivedAt: now };
    this.byId.set(env.id, r);
    this.sealedById.set(env.id, sealed);
    this.persistence?.save(r, sealed).catch(() => {});
    this.listeners.forEach(l => l(r));
    return true;
  }

  onAdd(fn: (r: Received) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  sealedFor(id: string) { return this.sealedById.get(id); }
  allSealed(): Sealed[] { return [...this.sealedById.values()]; }
  ids(): string[] { return [...this.byId.keys()]; }

  prune(now = Date.now()) {
    const cutoff = now - KEEP_MS;
    for (const [id, r] of this.byId) if (r.ts < cutoff) { this.byId.delete(id); this.sealedById.delete(id); }
    this.persistence?.prune(cutoff).catch(() => {});
  }

  private list(groupId: string, kind: string) {
    return [...this.byId.values()].filter(r => r.groupId === groupId && r.body.kind === kind).sort((a, b) => a.ts - b.ts);
  }

  /** Latest position of each rider, by the time the rider sent it (not when it arrived). */
  latestPositions(groupId: string): Map<string, Received> {
    const out = new Map<string, Received>();
    for (const r of this.list(groupId, 'position')) {
      const cur = out.get(r.sender);
      if (!cur || r.ts > cur.ts) out.set(r.sender, r);
    }
    return out;
  }

  messages(groupId: string) { return this.list(groupId, 'message'); }
  pins(groupId: string) { return this.list(groupId, 'pin'); }

  /** Riders whose latest SOS packet is still active. */
  activeSos(groupId: string): Received[] {
    const latest = new Map<string, Received>();
    for (const r of this.list(groupId, 'sos')) latest.set(r.sender, r);
    return [...latest.values()].filter(r => r.body.kind === 'sos' && r.body.data.active);
  }

  profiles(groupId: string): Map<string, Rider> {
    const out = new Map<string, Rider>();
    for (const r of this.list(groupId, 'profile')) if (r.body.kind === 'profile') out.set(r.sender, r.body.data.rider);
    return out;
  }

  leftRiders(groupId: string): Set<string> {
    return new Set(this.list(groupId, 'leave').map(r => r.sender));
  }

  /** Which links delivered packets in the last few minutes (for the header chips). */
  recentLinks(groupId: string, now = Date.now(), windowMs = 120_000): Set<LinkName> {
    const s = new Set<LinkName>();
    for (const r of this.byId.values()) {
      if (r.groupId === groupId && now - r.receivedAt < windowMs && !String(r.via).startsWith('carried')) s.add(r.via as LinkName);
    }
    return s;
  }
}
