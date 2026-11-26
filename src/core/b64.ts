// base64url helpers that work in Node, browsers and React Native (no Buffer needed).
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHA.length; i++) LOOKUP[ALPHA[i]] = i;

export function toB64u(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63];
  }
  return out;
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean[i]], b = LOOKUP[clean[i + 1]];
    const c = LOOKUP[clean[i + 2]] ?? 0, d = LOOKUP[clean[i + 3]] ?? 0;
    if (a === undefined || b === undefined) throw new Error('bad base64url');
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export const utf8 = {
  encode: (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s)),
  decode: (b: Uint8Array) => new TextDecoder().decode(b),
};

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export const newId = (bytes = 12) => toB64u(randomBytes(bytes));
