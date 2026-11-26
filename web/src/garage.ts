// The Garage: each rider's vehicles, and how a vehicle's setup changes how hard a trail feels.
// Every rating records the rig score of the vehicle it was ridden in. The forecast shifts the riders'
// rating by the difference between their rigs and yours.

export type Width = 50 | 64 | 72;
export type Lockers = 'none' | 'rear' | 'both';

export interface Vehicle {
  id: string;
  nickname: string;
  make: string;
  model: string;
  year?: number;
  widthIn: Width;
  tireIn: number;
  liftIn: number;
  lockers: Lockers;
  winch: boolean;
  skids: boolean;
  sliders: boolean;
  /** Badge color the rider picked, e.g. #DC2626. */
  color?: string;
  updatedAt: string;
}

/** Badge colors to pick from (a color picker covers anything else). */
export const BADGE_COLORS = ['#DC2626', '#EA580C', '#F59E0B', '#16A34A', '#0D9488', '#2563EB', '#7C3AED', '#DB2777', '#1D221D', '#6B7280', '#FFFFFF', '#92400E'];

export const WIDTHS: { v: Width; label: string }[] = [
  { v: 50, label: '50" or less (trail models, ATVs)' },
  { v: 64, label: '51–64" (most sport UTVs)' },
  { v: 72, label: '65" or wider (wide / long-travel)' },
];
export const LOCKERS: { v: Lockers; label: string }[] = [
  { v: 'none', label: 'Open diffs / standard 4WD' },
  { v: 'rear', label: 'Rear locker' },
  { v: 'both', label: 'Front and rear locking' },
];
export const TIRE_SIZES = Array.from({ length: 17 }, (_, i) => 24 + i); // 24"–40"
export const LIFTS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Capability on a 0–10 scale. Ground clearance (tires and lift) matters most on rocks, then traction (lockers),
 * then protection that lets a driver commit to a line (skids, sliders). A winch helps recovery, not the climb.
 *   Stock 28" tires, open diffs: 1.0 · 32" + 2" lift + rear locker + skids: 5.5 · 35" + 3" + full lockers + skids + sliders: 9.0
 */
export function rigScore(v: Pick<Vehicle, 'tireIn' | 'liftIn' | 'lockers' | 'skids' | 'sliders'>): number {
  const tires = Math.min(5, Math.max(0, (v.tireIn - 26) / 2));
  const lift = Math.min(4, Math.max(0, v.liftIn)) * 0.5;
  const lockers = v.lockers === 'both' ? 2 : v.lockers === 'rear' ? 1 : 0;
  const armor = (v.skids ? 0.5 : 0) + (v.sliders ? 0.5 : 0);
  return Math.round(Math.min(10, tires + lift + lockers + armor) * 10) / 10;
}

export function rigClass(score: number): string {
  return score < 2 ? 'Stock' : score < 4 ? 'Mild build' : score < 7 ? 'Built' : 'Full build';
}

/** Ratings with no vehicle are assumed to come from a typical stock UTV (28–30" tires, skid plates). */
export const STOCK_SCORE = 1.5;
/** Difficulty levels per rig-score point until the database has enough ratings to measure it. */
export const DEFAULT_SLOPE = 0.35;
/** Use the measured slope once this many ratings sit on trails rated by differently built rigs. */
export const MIN_PAIRS = 30;

export function effectiveSlope(model: { pairs: number; slope: number | null } | null): number {
  if (model && model.pairs >= MIN_PAIRS && model.slope != null && model.slope >= 0.05 && model.slope <= 0.8) return model.slope;
  return DEFAULT_SLOPE;
}

/** How hard a trail should feel in your rig, from the riders' rating and the average rig they rode. */
export function forecast(avg: number, ratersRig: number | null | undefined, myRig: number, slope = DEFAULT_SLOPE): number {
  const f = avg + slope * ((ratersRig ?? STOCK_SCORE) - myRig);
  return Math.round(Math.min(10, Math.max(1, f)) * 10) / 10;
}

const bandIndex = (n: number) => (n < 3.5 ? 0 : n < 5.5 ? 1 : n < 7.5 ? 2 : 3);
/** -1: your rig drops it to an easier colour; 1: a harder colour; 0: same colour. */
export function bandShift(avg: number, fc: number): -1 | 0 | 1 {
  const d = bandIndex(fc) - bandIndex(avg);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

export function vehicleTitle(v: Vehicle): string {
  const desc = [v.year, v.make, v.model].filter(Boolean).join(' ');
  return desc && desc !== v.nickname ? `${v.nickname} · ${desc}` : v.nickname;
}

export function vehicleSummary(v: Vehicle): string {
  const parts = [`${v.widthIn === 50 ? '50"' : v.widthIn === 64 ? '64"' : '72"+'} wide`, `${v.tireIn}" tires`, v.liftIn ? `${v.liftIn}" lift` : 'no lift',
    v.lockers === 'both' ? 'front + rear lockers' : v.lockers === 'rear' ? 'rear locker' : 'open diffs'];
  const extras = [v.winch && 'winch', v.skids && 'skids', v.sliders && 'rock sliders'].filter(Boolean);
  return [...parts, ...extras].join(' · ');
}
