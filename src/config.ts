// App configuration. Values marked TODO must be set before a public release.
import Constants from 'expo-constants';

/** Our relay server (server/relay.ts, deployed). Set in app.json -> expo.extra.relayUrl. */
export const RELAY_URL: string = (Constants.expoConfig?.extra as { relayUrl?: string } | undefined)?.relayUrl ?? '';

/**
 * Base map styles (MapLibre style JSON URLs).
 * TODO: Phase 1 ships our own topo + trail vector packs (USGS + OSM + MVUM/BLM) hosted as PMTiles.
 * Until that pipeline exists, development uses OpenFreeMap's free OSM styles, which need no API key.
 * Satellite imagery needs a licensed provider (e.g. MapTiler) with offline rights: set its style URL here.
 */
export const BASE_MAPS = {
  topo: { label: 'Topo', style: 'https://tiles.openfreemap.org/styles/liberty' },
  satellite: { label: 'Satellite', style: '' /* TODO: licensed imagery style URL */ },
  hybrid: { label: 'Hybrid', style: '' /* TODO */ },
  street: { label: 'Street', style: 'https://tiles.openfreemap.org/styles/bright' },
} as const;
export type BaseMapId = keyof typeof BASE_MAPS;

/** How often to share position: often when moving, rarely when parked (battery). */
export const POSITION_EVERY_MS = { moving: 10_000, stopped: 60_000 };
export const SEPARATION_ALERT_MIN = 10;
