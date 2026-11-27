// Heading: which way the rider is going (GPS course when moving) or facing (phone compass when stopped), and the
// Halo-style compass bar along the top of the map with the group's riders and regroup points on it.

export type HeadingSource = 'gps' | 'compass' | 'map';

/** Phone compass (needs a tap to allow on iPhone). Calls back with degrees clockwise from true north. */
export class PhoneCompass {
  heading: number | null = null;
  private at = 0;
  started = false;
  onChange: () => void = () => {};
  get needsPermission() {
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    return !!D?.requestPermission && !this.started;
  }
  get available() { return 'DeviceOrientationEvent' in window; }
  /** Call from a tap on iPhone; elsewhere it can start right away. */
  async start(): Promise<boolean> {
    if (this.started) return true;
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!D) return false;
    if (D.requestPermission) { try { if ((await D.requestPermission()) !== 'granted') return false; } catch { return false; } }
    const screenAngle = () => (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0);
    const ios = (e: DeviceOrientationEvent) => {
      const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (h != null && !Number.isNaN(h)) this.set(h + screenAngle());
    };
    const abs = (e: DeviceOrientationEvent) => { if (e.absolute && e.alpha != null) this.set(360 - e.alpha + screenAngle()); };
    window.addEventListener('deviceorientation', ios);
    window.addEventListener('deviceorientationabsolute' as 'deviceorientation', abs);
    this.started = true;
    return true;
  }
  private set(h: number) {
    const v = ((h % 360) + 360) % 360;
    // Smooth the needle a little, and redraw at most ~15 times a second.
    if (this.heading == null) this.heading = v;
    else { const d = ((v - this.heading + 540) % 360) - 180; this.heading = (this.heading + d * 0.35 + 360) % 360; }
    const now = performance.now();
    if (now - this.at > 66) { this.at = now; this.onChange(); }
  }
  /** True if a reading came in recently. */
  get live() { return this.heading != null && this.started; }
}

const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = (deg: number) => NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export interface CompassMark { bearing: number; label: string; kind: 'rider' | 'regroup' | 'hazard'; color?: string; title?: string }

/** The compass bar: 120° of view, ticks every 5°, letters every 45°, numbers every 15°, marks for riders and regroup points. */
export function compassHtml(heading: number, source: HeadingSource, marks: CompassMark[], width: number, headingUp: boolean): string {
  const span = 120, ppd = width / span, half = width / 2;
  let ticks = '';
  const start = Math.ceil((heading - span / 2) / 5) * 5;
  for (let a = start; a <= heading + span / 2; a += 5) {
    const x = (a - heading) * ppd + half, n = ((a % 360) + 360) % 360;
    if (n % 45 === 0) ticks += `<i class="ct major" style="left:${x.toFixed(1)}px"></i><b class="cl${n % 90 === 0 ? ' card' : ''}" style="left:${x.toFixed(1)}px">${NAMES[n / 45]}</b>`;
    else if (n % 15 === 0) ticks += `<i class="ct mid" style="left:${x.toFixed(1)}px"></i><span class="cn" style="left:${x.toFixed(1)}px">${n}</span>`;
    else ticks += `<i class="ct" style="left:${x.toFixed(1)}px"></i>`;
  }
  const pins = marks.map(m => {
    const d = ((m.bearing - heading + 540) % 360) - 180;
    const off = Math.abs(d) > span / 2;
    const x = Math.min(width - 14, Math.max(14, off ? (d < 0 ? 0 : width) : d * ppd + half));
    return `<span class="cm ${m.kind}${off ? ' edge' : ''}" style="left:${x.toFixed(1)}px${m.color ? `;--c:${m.color}` : ''}" title="${m.title ?? ''}">${off ? (d < 0 ? '◂' : '▸') : ''}${m.label}</span>`;
  }).join('');
  const deg = Math.round(((heading % 360) + 360) % 360) % 360;
  return `<div class="ctape">${ticks}${pins}</div><div class="cneedle"></div>
    <div class="creadout${source === 'map' ? ' dim' : ''}${headingUp ? ' up' : ''}">${deg}° ${cardinal(heading)}</div>`;
}
