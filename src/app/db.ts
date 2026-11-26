// On-phone storage (SQLite): packets for 24 h, plus the rider's profile and current group.
import * as SQLite from 'expo-sqlite';
import type { Persistence } from '../core/store.ts';
import type { Group, Received, Rider, Sealed } from '../core/types.ts';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('traillink.db').then(async d => {
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS packets (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, received TEXT NOT NULL, sealed TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS packets_ts ON packets (ts);
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `);
      return d;
    });
  }
  return dbPromise;
}

export const sqlitePersistence: Persistence = {
  async load() {
    const rows = await (await db()).getAllAsync<{ received: string; sealed: string }>('SELECT received, sealed FROM packets');
    return { received: rows.map(r => JSON.parse(r.received) as Received), sealed: rows.map(r => JSON.parse(r.sealed) as Sealed) };
  },
  async save(r, s) {
    await (await db()).runAsync('INSERT OR IGNORE INTO packets (id, ts, received, sealed) VALUES (?, ?, ?, ?)', r.id, r.ts, JSON.stringify(r), JSON.stringify(s));
  },
  async prune(before) {
    await (await db()).runAsync('DELETE FROM packets WHERE ts < ?', before);
  },
};

async function getKv<T>(k: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k);
  return row ? (JSON.parse(row.v) as T) : null;
}
async function setKv(k: string, v: unknown) {
  if (v === null) await (await db()).runAsync('DELETE FROM kv WHERE k = ?', k);
  else await (await db()).runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, JSON.stringify(v));
}

export const prefs = {
  getProfile: () => getKv<Rider>('profile'),
  setProfile: (r: Rider) => setKv('profile', r),
  getGroup: () => getKv<Group>('group'),
  setGroup: (g: Group | null) => setKv('group', g),
  getSharing: async () => (await getKv<boolean>('sharing')) ?? true,
  setSharing: (v: boolean) => setKv('sharing', v),
  getBaseMap: () => getKv<string>('basemap'),
  setBaseMap: (v: string) => setKv('basemap', v),
};
