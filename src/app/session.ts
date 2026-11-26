// A ride session: one group, its packet store, the router and every link. Screens read from here.
import type { Group, PositionBody, Received, Rider } from '../core/types.ts';
import { PacketStore } from '../core/store.ts';
import { Router } from '../core/router.ts';
import { CloudLink } from '../core/links/cloud.ts';
import { SimLink, SimMedium } from '../core/links/simulated.ts';
import { buildGraph, chainWarnings, type ChainWarning } from '../core/chain.ts';
import { SeparationWatch, type SeparationAlert } from '../core/status.ts';
import { isRideOver } from '../core/group.ts';
import { RELAY_URL, SEPARATION_ALERT_MIN } from '../config.ts';
import { sqlitePersistence } from './db.ts';

export interface RiderView {
  rider: Rider;
  position?: Received;
  isMe: boolean;
}

export class RideSession {
  store = new PacketStore(sqlitePersistence);
  router: Router;
  cloud: CloudLink;
  sim?: { medium: SimMedium; link: SimLink };
  watch = new SeparationWatch(SEPARATION_ALERT_MIN);
  sharing = true;
  me: Rider;
  group: Group;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(me: Rider, group: Group) {
    this.me = me;
    this.group = group;
    this.router = new Router(this.store, group, me.id);
    this.cloud = new CloudLink(RELAY_URL, group.id);
    this.router.addLink(this.cloud);
    this.store.onAdd(() => this.emit());
  }

  async start() {
    await this.store.init();
    await this.router.publish({ kind: 'profile', data: { rider: this.me } });
    if (RELAY_URL && !RELAY_URL.includes('.invalid')) this.cloud.start(5000);
    this.timers.push(setInterval(() => { void this.router.flush(); this.emit(); }, 5000));
    this.timers.push(setInterval(() => this.store.prune(), 15 * 60_000));
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; this.cloud.stop(); }

  /** Developer mode: a simulated mesh radio, so the radio code paths can be exercised before hardware exists. */
  enableSimulatedRadio(pos: { lat: number; lon: number }) {
    const medium = new SimMedium(3000);
    const link = new SimLink('mesh', medium, this.me.id, pos, 230);
    this.router.addLink(link);
    this.sim = { medium, link };
  }

  setOnline(v: boolean) { this.cloud.setOnline(v); if (v) void this.router.flush(); this.emit(); }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(l => l()); }

  // ---- actions ----
  async sharePosition(p: PositionBody) {
    if (!this.sharing || isRideOver(this.group)) return;
    const heard = this.sim ? this.sim.medium.neighbours(this.me.id) : undefined;
    await this.router.publish({ kind: 'position', data: { ...p, heard } });
  }
  sendMessage(text: string, preset = false) { return this.router.publish({ kind: 'message', data: { text, preset } }); }
  dropPin(pinType: 'regroup' | 'hazard', lat: number, lon: number, note?: string) { return this.router.publish({ kind: 'pin', data: { pinType, lat, lon, note } }); }
  sos(lat: number, lon: number) { return this.router.publish({ kind: 'sos', data: { lat, lon, active: true } }); }
  cancelSos(lat: number, lon: number) { return this.router.publish({ kind: 'sos', data: { lat, lon, active: false } }); }
  async leave() { await this.router.publish({ kind: 'leave', data: {} }); this.stop(); }

  // ---- views ----
  riders(): RiderView[] {
    const profiles = this.store.profiles(this.group.id);
    profiles.set(this.me.id, this.me);
    const left = this.store.leftRiders(this.group.id);
    const latest = this.store.latestPositions(this.group.id);
    return [...profiles.values()]
      .filter(r => !left.has(r.id) || r.id === this.me.id)
      .map(r => ({ rider: r, position: latest.get(r.id), isMe: r.id === this.me.id }))
      .sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.rider.name.localeCompare(b.rider.name)));
  }

  nameOf = (id: string) => (id === this.me.id ? 'You' : this.store.profiles(this.group.id).get(id)?.name ?? 'Rider');

  chainWarnings(): ChainWarning[] {
    const heard = new Map<string, string[]>();
    for (const [id, r] of this.store.latestPositions(this.group.id)) if (r.body.kind === 'position' && r.body.data.heard) heard.set(id, r.body.data.heard);
    if (this.sim) heard.set(this.me.id, this.sim.medium.neighbours(this.me.id));
    return chainWarnings(buildGraph(heard), this.me.id);
  }

  separationAlerts(): SeparationAlert[] { return this.watch.check(this.store.latestPositions(this.group.id), this.me.id); }
}
