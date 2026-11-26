// How fresh each rider's position is, how it arrived, and when to alert the leader and sweep.
import type { Received } from './types.ts';

export const LIVE_MS = 30_000;
export const STALE_MS = 2 * 60_000;

export type Freshness = 'live' | 'recent' | 'stale';

export function freshness(r: Received, now = Date.now()): Freshness {
  const age = now - r.ts;
  return age <= LIVE_MS ? 'live' : age <= STALE_MS ? 'recent' : 'stale';
}

export function ageLabel(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'live';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

export function viaLabel(via: Received['via'], names: (id: string) => string = id => id): string {
  if (typeof via === 'string' && via.startsWith('carried:')) return `carried by ${names(via.slice(8))}`;
  return ({ cell: 'cell', mesh: 'mesh', bluetooth: 'Bluetooth', satellite: 'satellite', local: 'you' } as Record<string, string>)[via] ?? String(via);
}

export interface SeparationAlert { rider: string; minutesSilent: number }

/** Riders not heard from for `thresholdMin` minutes. Each rider alerts once until heard from again. */
export class SeparationWatch {
  private alerted = new Set<string>();
  thresholdMin: number;
  constructor(thresholdMin = 10) { this.thresholdMin = thresholdMin; }

  check(latest: Map<string, Received>, me: string, now = Date.now()): SeparationAlert[] {
    const out: SeparationAlert[] = [];
    for (const [rider, r] of latest) {
      if (rider === me) continue;
      const mins = (now - r.ts) / 60_000;
      if (mins >= this.thresholdMin) {
        if (!this.alerted.has(rider)) { this.alerted.add(rider); out.push({ rider, minutesSilent: Math.floor(mins) }); }
      } else this.alerted.delete(rider);
    }
    return out;
  }
}
