// Store-and-forward: when two phones meet (Bluetooth), each sends the other the packets it is missing.
// This is how a rider with no radio still shows up: whoever passes him carries his position onward.
import type { Sealed } from './types.ts';
import type { PacketStore } from './store.ts';

/** Compact summary of what a phone holds: packet ids. (Bloom filters later, if groups get large.) */
export function summary(store: PacketStore): string[] {
  return store.ids();
}

/** Packets we hold that the peer lacks, SOS first, newest first, capped to keep a Bluetooth exchange short. */
export function missingFor(store: PacketStore, peerIds: Iterable<string>, limit = 500): Sealed[] {
  const theirs = new Set(peerIds);
  return store
    .allSealed()
    .filter(s => !theirs.has(s.i))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}
