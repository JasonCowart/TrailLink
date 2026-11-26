// Cell / Wi-Fi link: posts sealed packets to the relay and polls for new ones.
// Any phone that gets signal for a moment uploads everything it holds (including packets it is carrying
// for other riders) and downloads what it missed.
import type { Link } from '../router.ts';
import type { Sealed } from '../types.ts';

export class CloudLink implements Link {
  name = 'cell' as const;
  private recv: (p: Sealed) => void = () => {};
  private cursor = 0;
  private online = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private baseUrl: string;
  private groupId: string;
  private fetchFn: typeof fetch;

  constructor(baseUrl: string, groupId: string, fetchFn: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.groupId = groupId;
    this.fetchFn = fetchFn;
  }

  /** The app sets this from the OS network state (expo-network). Unknown counts as up; failures turn it off. */
  setOnline(v: boolean) { this.online = v; }
  isUp() { return this.online; }
  setReceiver(fn: (p: Sealed) => void) { this.recv = fn; }

  async send(packets: Sealed[]) {
    for (let i = 0; i < packets.length; i += 500) {
      const res = await this.fetchFn(`${this.baseUrl}/v1/groups/${this.groupId}/packets`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packets.slice(i, i + 500)),
      });
      if (!res.ok) throw new Error(`relay ${res.status}`);
    }
  }

  async poll(): Promise<number> {
    if (!this.online) return 0;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/groups/${this.groupId}/packets?since=${this.cursor}`);
      if (!res.ok) throw new Error(String(res.status));
      const { packets, cursor } = (await res.json()) as { packets: Sealed[]; cursor: number };
      packets.forEach(p => this.recv(p));
      this.cursor = cursor;
      return packets.length;
    } catch {
      return 0;
    }
  }

  start(everyMs = 5000) { this.stop(); this.timer = setInterval(() => { void this.poll(); }, everyMs); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
