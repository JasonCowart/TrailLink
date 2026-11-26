// GPS: foreground updates for the map, background updates so sharing continues with the screen off.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { PositionBody } from '../core/types.ts';
import { POSITION_EVERY_MS } from '../config.ts';

export const BG_TASK = 'traillink-background-location';

type Listener = (p: PositionBody) => void;
let backgroundListener: Listener | null = null;

// Must be defined at module scope (imported from index.ts) so the OS can wake the app for it.
TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const last = locations[locations.length - 1];
  if (last && backgroundListener) backgroundListener(toBody(last));
});

export function toBody(l: Location.LocationObject): PositionBody {
  return {
    lat: l.coords.latitude,
    lon: l.coords.longitude,
    accuracy: Math.round(l.coords.accuracy ?? 0),
    speed: l.coords.speed ?? undefined,
    heading: l.coords.heading ?? undefined,
  };
}

export async function requestPermissions(): Promise<'always' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
  return bg.status === 'granted' ? 'always' : 'foreground';
}

/** Watch position on screen, and share it at a battery-friendly rate. Returns a stop function. */
export async function startTracking(onMap: Listener, onShare: Listener, background: boolean): Promise<() => void> {
  let lastShared = 0;
  const share = (p: PositionBody) => {
    const moving = (p.speed ?? 0) > 1; // > ~2 mph
    const every = moving ? POSITION_EVERY_MS.moving : POSITION_EVERY_MS.stopped;
    if (Date.now() - lastShared >= every) { lastShared = Date.now(); onShare(p); }
  };
  backgroundListener = share;
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
    l => { const p = toBody(l); onMap(p); share(p); },
  );
  if (background) {
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: POSITION_EVERY_MS.moving,
      distanceInterval: 20,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: { notificationTitle: 'TrailLink is sharing your position', notificationBody: 'With your ride group. Open the app to stop.' },
    }).catch(() => {});
  }
  return () => {
    sub.remove();
    backgroundListener = null;
    Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
  };
}
