// Halo-style motion tracker: riders and points around you in 360°, you at the center facing up, with a pulse
// that sweeps out from the center. Ranges step through 0.1 / 0.25 / 0.5 / 1 / 2 / 5 / 10 miles to fit the farthest mark.
import type { CompassMark } from './compass.ts';

const MI = 1609.344;
const RANGES = [0.1, 0.25, 0.5, 1, 2, 5, 10];
export const PULSE_MS = 2400;

/** The radar's fixed parts (rings, ticks, pulse); built once so the pulse animation runs smoothly. */
export function radarFrame(): string {
  return `<div class="rd-face"><i class="rd-ring r1"></i><i class="rd-ring r2"></i><i class="rd-cross"></i><i class="rd-pulse"></i><i class="rd-cone"></i></div>
    <div class="rd-marks"></div><i class="rd-me"></i><span class="rd-range"></span>`;
}

/** Marks placed for this heading. pulseStart: when the pulse animation started (performance.now()). */
export function radarMarks(marks: CompassMark[], heading: number, pulseStart: number): { html: string; range: string } {
  const far = Math.max(0, ...marks.filter(m => m.meters != null).map(m => m.meters!));
  const range = RANGES.find(r => r * MI >= far * 1.08) ?? RANGES[RANGES.length - 1];
  const phase = (performance.now() - pulseStart) % PULSE_MS;
  const html = marks.map(m => {
    const frac = Math.min(1, (m.meters ?? 0) / (range * MI)), edge = (m.meters ?? 0) > range * MI;
    const a = ((m.bearing - heading) * Math.PI) / 180, r = frac * 44; // % of the radar, inside the outer ring
    const x = 50 + r * Math.sin(a), y = 50 - r * Math.cos(a);
    // Each blip brightens as the pulse passes over it.
    // (The SOS strobe keeps time with the clock instead, like on the compass.)
    const delay = m.kind === 'hazard' ? -(Date.now() % 1600) : Math.round(frac * PULSE_MS * 0.9 - phase);
    return `<span class="rd-blip ${m.kind}${edge ? ' edge' : ''}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--bd:${delay}ms" title="${m.title ?? ''}">${m.kind === 'rider' ? m.label : m.kind === 'hazard' ? 'SOS' : ''}</span>`;
  }).join('');
  return { html, range: range < 1 ? `${range} mi`.replace(/^0/, '') : `${range} mi` };
}
