// Saving map areas for use with no signal. Tiles go into the browser's Cache Storage; the service worker
// (public/sw.js) serves them from there whenever the network is gone.
import { BASE_MAPS, tilesFor, type BaseMapId } from './maps.ts';

export const TILE_CACHE = 'traillink-tiles-v1';
export const MAX_TILES_PER_AREA = 4000;

/** Same rule as sw.js: MVUM image URLs differ only in floating-point digits of the bbox, so round them for the cache key. */
export function cacheKey(url: string): string {
  if (!url.includes('EDW_MVUM')) return url;
  return url.replace(/bbox=([^&]+)/, (_m, b: string) => 'bbox=' + decodeURIComponent(b).split(',').map(v => Math.round(Number(v))).join(','));
}

export interface SavedArea { id: string; name: string; base: BaseMapId; bounds: { w: number; s: number; e: number; n: number }; minZ: number; maxZ: number; tiles: number; savedAt: number }

const AREAS_KEY = 'traillink.areas';
export function savedAreas(): SavedArea[] {
  try { return JSON.parse(localStorage.getItem(AREAS_KEY) ?? '[]'); } catch { return []; }
}
function storeAreas(a: SavedArea[]) { try { localStorage.setItem(AREAS_KEY, JSON.stringify(a)); } catch { /* storage full or blocked */ } }

/** Pick the deepest zoom that keeps the download under the tile limit. */
export function planDownload(base: BaseMapId, bounds: SavedArea['bounds'], fromZ: number, withMvum: boolean) {
  const minZ = Math.max(8, Math.min(fromZ, 14));
  let maxZ = Math.min(BASE_MAPS[base].maxzoom, 16);
  let urls = tilesFor(base, bounds, minZ, maxZ, withMvum);
  while (urls.length > MAX_TILES_PER_AREA && maxZ > minZ) urls = tilesFor(base, bounds, minZ, --maxZ, withMvum);
  return { minZ, maxZ, urls };
}

export async function downloadArea(
  name: string, base: BaseMapId, bounds: SavedArea['bounds'], fromZ: number, withMvum: boolean,
  onProgress: (done: number, total: number, failed: number) => void, signal: AbortSignal,
): Promise<SavedArea> {
  const { minZ, maxZ, urls } = planDownload(base, bounds, fromZ, withMvum);
  const cache = await caches.open(TILE_CACHE);
  let done = 0, failed = 0;
  const queue = [...urls];
  // A few downloads at a time: polite to the map servers and gentle on phone data.
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const url = queue.shift()!;
      const key = cacheKey(url);
      try {
        if (!(await cache.match(key))) {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) await cache.put(key, res); else failed++;
        }
      } catch { failed++; }
      onProgress(++done, urls.length, failed);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const area: SavedArea = { id: String(Date.now()), name, base, bounds, minZ, maxZ, tiles: urls.length - failed, savedAt: Date.now() };
  storeAreas([area, ...savedAreas()]);
  return area;
}

export function forgetArea(id: string) { storeAreas(savedAreas().filter(a => a.id !== id)); }

export async function clearAllTiles() { await caches.delete(TILE_CACHE); storeAreas([]); }

export async function storageSummary(): Promise<string> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.usage) return '';
    const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
    return est.quota ? `${mb(est.usage)} used of about ${mb(est.quota)} available` : `${mb(est.usage)} used`;
  } catch { return ''; }
}

/** Ask the browser not to clear saved maps when space runs low. Not every browser honours it. */
export async function askToKeepStorage() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
