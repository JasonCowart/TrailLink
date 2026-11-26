// Quick trail reports, like a car navigation app's "report" buttons, but for trail problems.
// Each has its own line icon (24×24, drawn in code so it works offline) and color.
export const REPORTS = {
  tree:    { label: 'Downed tree', color: '#15803D', path: '<path d="M3 20h18"/><path d="M4 13h9"/><path d="M13 8.5 21 13l-8 4.5z"/><path d="M7 13v3"/>' },
  rocks:   { label: 'Rockslide', color: '#78716C', path: '<path d="M3 20 6 13l5-2 3 3-1 6z"/><path d="M13 20l2-5 4-1 2 6z"/><path d="M15 4l1.5 1.5M19 7l1 1M12 6l1 1"/>' },
  washout: { label: 'Washout', color: '#B45309', path: '<path d="M3 8h6M15 8h6M3 16h6M15 16h6"/><path d="M11 5l2 3-2 3 2 3-2 3 2 3"/>' },
  water:   { label: 'Deep water', color: '#2563EB', path: '<path d="M3 10c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/><path d="M3 15c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/><path d="M3 20c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/>' },
  mud:     { label: 'Deep mud', color: '#92400E', path: '<path d="M4 17c0-2 3-3 6-3h4c3 0 6 1 6 3s-3 3-8 3-8-1-8-3z"/><path d="M8 9l1 2M12 6.5V10M16 9l-1 2"/>' },
  snow:    { label: 'Snow / ice', color: '#0284C7', path: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>' },
  closed:  { label: 'Trail closed', color: '#DC2626', path: '<rect x="3" y="8" width="18" height="6" rx="1"/><path d="M8 8l-4 6M14 8l-4 6M20 8l-4 6"/><path d="M6 14v6M18 14v6"/>' },
  gate:    { label: 'Gate locked', color: '#475569', path: '<path d="M3 20V7M3 9h10M3 17h10M6.5 9v8M10 9v8"/><rect x="14" y="12" width="7" height="6" rx="1"/><path d="M15.5 12v-1.5a2 2 0 0 1 4 0V12"/>' },
  animals: { label: 'Livestock / wildlife', color: '#A16207', path: '<path d="M8 20c-2 0-3-2-3-5s1.5-6 3-6 3 3 3 6-1 5-3 5z"/><path d="M16 20c2 0 3-2 3-5s-1.5-6-3-6-3 3-3 6 1 5 3 5z"/><path d="M7 5l1 2M17 5l-1 2"/>' },
  vehicle: { label: 'Disabled vehicle', color: '#7C3AED', path: '<path d="M2 15h15l-2-5H7l-3 5"/><circle cx="6" cy="17" r="2"/><circle cx="14" cy="17" r="2"/><path d="M20.5 5v6M20.5 14v.01"/>' },
  ranger:  { label: 'Ranger / patrol', color: '#1E3A8A', path: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 8.2l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>' },
  fire:    { label: 'Fire / smoke', color: '#EA580C', path: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3 0-5 1-8z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.5 1-2.5 2.5-4 1.5 1.5 2.5 2.5 2.5 4A2.5 2.5 0 0 1 12 21z"/>' },
  hazard:  { label: 'Other hazard', color: '#D97706', path: '<path d="M12 3 22 20H2z"/><path d="M12 9v5M12 17v.01"/>' },
} as const;
export type ReportType = keyof typeof REPORTS;
export const REPORT_TYPES = Object.keys(REPORTS) as ReportType[];

/** The report's line icon. With bg, it sits white on a round tile of its color (map pins, lists); without, it uses the current text color. */
export function reportIcon(type: string | undefined, size = 24, bg = true): string {
  const r = REPORTS[(type ?? 'hazard') as ReportType] ?? REPORTS.hazard;
  const svg = `<svg viewBox="0 0 24 24" width="${bg ? Math.round(size * 0.62) : size}" height="${bg ? Math.round(size * 0.62) : size}" fill="none" stroke="${bg ? '#fff' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${r.path}</svg>`;
  return bg ? `<span class="ricon" style="--c:${r.color};width:${size}px;height:${size}px">${svg}</span>` : svg;
}
