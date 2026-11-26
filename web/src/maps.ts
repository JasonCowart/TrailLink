// Map sources. USGS National Map tiles are public domain. MVUM = Forest Service legal motor-vehicle routes.
import type { StyleSpecification } from 'maplibre-gl';

const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services';
const MVUM = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/export';

export type BaseMapId = 'topo' | 'satellite' | 'hybrid' | 'street';

export const BASE_MAPS: Record<BaseMapId, { label: string; tiles?: string; maxzoom: number; offline: boolean; attribution: string }> = {
  topo: { label: 'Topo', tiles: `${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, offline: true, attribution: 'USGS The National Map' },
  satellite: { label: 'Satellite', tiles: `${USGS}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, offline: true, attribution: 'USGS The National Map: Orthoimagery' },
  hybrid: { label: 'Hybrid', tiles: `${USGS}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, offline: true, attribution: 'USGS The National Map' },
  street: { label: 'Street', maxzoom: 18, offline: false, attribution: 'OpenFreeMap, OpenStreetMap' },
};

export const STREET_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Forest Service legal OHV roads and trails, drawn by the agency's map server as transparent image tiles. */
export const MVUM_TILES = `${MVUM}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

export function rasterStyle(id: BaseMapId): StyleSpecification {
  const b = BASE_MAPS[id];
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [b.tiles!], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

/** Tile URLs to save for offline use: every tile of the base map + MVUM covering bounds, from zoom minZ to maxZ. */
export function tilesFor(id: BaseMapId, bounds: { w: number; s: number; e: number; n: number }, minZ: number, maxZ: number, withMvum: boolean): string[] {
  const out: string[] = [];
  const tpl = BASE_MAPS[id].tiles;
  for (let z = minZ; z <= maxZ; z++) {
    const [x0, y0] = lonLatToTile(bounds.w, bounds.n, z);
    const [x1, y1] = lonLatToTile(bounds.e, bounds.s, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (tpl) out.push(tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
        if (withMvum) out.push(MVUM_TILES.replace('{bbox-epsg-3857}', tileBbox3857(x, y, z).join(',')));
      }
    }
  }
  return out;
}

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

/** Web Mercator bounding box of a tile, formatted exactly as MapLibre fills {bbox-epsg-3857}, so cached URLs match. */
export function tileBbox3857(x: number, y: number, z: number): string[] {
  const size = (2 * Math.PI * 6378137) / 2 ** z;
  const origin = Math.PI * 6378137;
  const minX = x * size - origin;
  const maxY = origin - y * size;
  return [minX, maxY - size, minX + size, maxY].map(String);
}
