// Creating groups and the QR invite that lets riders join with no signal.
import type { Group } from './types.ts';
import { fromB64u, newId, toB64u, utf8 } from './b64.ts';
import { newGroupKey } from './seal.ts';

export const DEFAULT_RIDE_HOURS = 24;
const INVITE_PREFIX = 'TL1:';

export function createGroup(name: string, createdBy: string, now = Date.now(), hours = DEFAULT_RIDE_HOURS): Group {
  return { id: newId(9), name: name.trim() || 'Group ride', key: newGroupKey(), createdBy, endsAt: now + hours * 3600_000 };
}

/** Everything needed to join, packed into the QR code. Keep it short so the code stays easy to scan. */
export function encodeInvite(g: Group): string {
  const payload = JSON.stringify([g.id, g.name, g.key, g.createdBy, g.endsAt]);
  return INVITE_PREFIX + toB64u(utf8.encode(payload));
}

export function decodeInvite(text: string): Group | null {
  try {
    if (!text.startsWith(INVITE_PREFIX)) return null;
    const [id, name, key, createdBy, endsAt] = JSON.parse(utf8.decode(fromB64u(text.slice(INVITE_PREFIX.length))));
    if (typeof id !== 'string' || typeof key !== 'string' || fromB64u(key).length !== 32) return null;
    return { id, name: String(name), key, createdBy: String(createdBy), endsAt: Number(endsAt) };
  } catch {
    return null;
  }
}

/**
 * A short, readable ride code (e.g. K7Q-4ZP) shown under the QR so riders can confirm they joined the right ride.
 * It does NOT carry the key, so it can't be used to join by itself: the server never holds group keys.
 * To invite someone who isn't at the trailhead, share the invite link by text while you have signal.
 */
export function shortCode(g: Group): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = fromB64u(g.id);
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i % bytes.length] % alphabet.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export const isRideOver = (g: Group, now = Date.now()) => now >= g.endsAt;
