// End-to-end encryption with the group key (AES-256-GCM via WebCrypto).
// React Native gets WebCrypto from react-native-quick-crypto (installed in index.ts).
import type { Envelope, Sealed } from './types.ts';
import { fromB64u, randomBytes, toB64u, utf8 } from './b64.ts';

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(keyB64: string): Promise<CryptoKey> {
  let k = keyCache.get(keyB64);
  if (!k) {
    k = globalThis.crypto.subtle.importKey('raw', fromB64u(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(keyB64, k);
  }
  return k;
}

export function newGroupKey(): string {
  return toB64u(randomBytes(32));
}

export async function seal(env: Envelope, keyB64: string): Promise<Sealed> {
  const key = await importKey(keyB64);
  const nonce = randomBytes(12);
  // The packet id, group id and time are bound as additional data so they can't be swapped.
  const aad = utf8.encode(`${env.groupId}|${env.id}|${env.ts}`);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    key,
    utf8.encode(JSON.stringify({ s: env.sender, b: env.body })),
  );
  return { v: 1, g: env.groupId, i: env.id, t: env.ts, n: toB64u(nonce), c: toB64u(new Uint8Array(ct)) };
}

export async function open(sealed: Sealed, keyB64: string): Promise<Envelope | null> {
  try {
    const key = await importKey(keyB64);
    const aad = utf8.encode(`${sealed.g}|${sealed.i}|${sealed.t}`);
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64u(sealed.n), additionalData: aad },
      key,
      fromB64u(sealed.c),
    );
    const inner = JSON.parse(utf8.decode(new Uint8Array(pt)));
    return { id: sealed.i, groupId: sealed.g, ts: sealed.t, sender: inner.s, body: inner.b };
  } catch {
    return null; // wrong key or tampered: ignore silently
  }
}
