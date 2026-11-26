// Quick trail reports, like a car navigation app's "report" buttons, but for trail problems.
// Each has its own line icon (24×24, drawn in code so it works offline) and color.
export const REPORTS = {
  tree:    { label: 'Downed tree', color: '#15803D', path: '<path d="M2 21.5h20"/><path d="M15.1 3.9 L17.1 9.3 L15.4 8.7 L17.2 14.0 L14.8 13.2 L17.2 18.7 L4.6 14.6 L9.8 11.6 L7.3 10.8 L12.0 7.6 L10.2 7.0Z" fill="#fff"/><path d="M10.9 16.6L9.5 21.0" stroke-width="2.6"/>' },
  rocks:   { label: 'Rockslide', color: '#78716C', path: '<path d="M3 20 6 13l5-2 3 3-1 6z"/><path d="M13 20l2-5 4-1 2 6z"/><path d="M15 4l1.5 1.5M19 7l1 1M12 6l1 1"/>' },
  washout: { label: 'Washout', color: '#B45309', path: '<path d="M3 8h6M15 8h6M3 16h6M15 16h6"/><path d="M11 5l2 3-2 3 2 3-2 3 2 3"/>' },
  water:   { label: 'Deep water', color: '#2563EB', path: '<path d="M3 10c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/><path d="M3 15c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/><path d="M3 20c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/>' },
  mud:     { label: 'Deep mud', color: '#92400E', path: '<path d="M6.3 15.5a5.7 5.7 0 0 1 11.4 0" stroke-width="3.4"/><path d="M9.6 15.5a2.4 2.4 0 0 1 4.8 0" stroke-width="1.6"/><path d="M11.2 15.5a.8.8 0 0 1 1.6 0z" fill="#fff"/><path d="M2 16.5c2.5-1.5 4.5 1.5 7 0s4.5 1.5 7 0 4 1.5 6 0"/><path d="M4 20.5c2-1.2 4 1.2 6 0s4 1.2 6 0"/>' },
  snow:    { label: 'Snow / ice', color: '#0284C7', path: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>' },
  closed:  { label: 'Trail closed', color: '#9F1239', path: '<rect x="3" y="8" width="18" height="6" rx="1"/><path d="M8 8l-4 6M14 8l-4 6M20 8l-4 6"/><path d="M6 14v6M18 14v6"/>' },
  gate:    { label: 'Gate locked', color: '#475569', path: '<path d="M3 20V7M3 9h10M3 17h10M6.5 9v8M10 9v8"/><rect x="14" y="12" width="7" height="6" rx="1"/><path d="M15.5 12v-1.5a2 2 0 0 1 4 0V12"/>' },
  animals: { label: 'Livestock / wildlife', color: '#A16207', path: '<path d="M7.5 8c0 6.5 2 11 4.5 11s4.5-4.5 4.5-11"/><path d="M7.5 8C5.5 7.5 4 5.5 4 3.5M16.5 8c2-.5 3.5-2.5 3.5-4.5"/><path d="M7.5 9.5H4.5M16.5 9.5h3"/><path d="M10.5 16h.01M13.5 16h.01"/>' },
  vehicle: { label: 'Disabled vehicle', color: '#7C3AED', path: '<path d="M2.5 17.5v-4l2.5-.8L7.5 9h6l2.5 3.7h3.5a1.5 1.5 0 0 1 1.5 1.5v3.3"/><path d="M9.5 17.5h5"/><path d="M10.5 9v3.7M5 12.7h15"/><circle cx="6.5" cy="17.5" r="2.3"/><circle cx="17.5" cy="17.5" r="2.3"/><path d="M18.5 1.8 22.3 8.2h-7.6z" stroke-width="1.6"/><path d="M18.5 4.1v1.7M18.5 7v.01" stroke-width="1.6"/>' },
  ranger:  { label: 'Ranger / patrol', color: '#1E3A8A', path: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 8.2l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>' },
  fire:    { label: 'Fire / smoke', color: '#EA580C', path: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3 0-5 1-8z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.5 1-2.5 2.5-4 1.5 1.5 2.5 2.5 2.5 4A2.5 2.5 0 0 1 12 21z"/>' },
  hazard:  { label: 'Other hazard', color: '#DC2626', path: '<path d="M12 3 22 20H2z"/><path d="M12 9v5M12 17v.01"/>' },
} as const;
export type ReportType = keyof typeof REPORTS;
export const REPORT_TYPES = Object.keys(REPORTS) as ReportType[];

/** Icons for the other pin kinds, in the same style. */
export const PIN_ICONS = {
  regroup: { label: 'Regroup point', color: '#B4400F', path: '<path d="M5 21V4"/><path d="M5 4h11l-2 3.5L16 11H5"/>' },
  note:    { label: 'Note', color: '#1F4D3A', path: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/><path d="M8 9h8M8 13h5"/>' },
  photo:   { label: 'Photo', color: '#1D4ED8', path: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
} as const;
/** Icon tile for any pin: a report's own icon, or its kind's. */
export function pinIcon(kind: string, report: string | undefined, size: number): string {
  if (kind === 'report' || kind === 'hazard') return reportIcon(report ?? 'hazard', size);
  const k = PIN_ICONS[kind as keyof typeof PIN_ICONS] ?? PIN_ICONS.note;
  const inner = Math.round(size * 0.62);
  return `<span class="ricon" style="--c:${k.color};width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" width="${inner}" height="${inner}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${k.path}</svg></span>`;
}

/** The report's line icon. With bg, it sits white on a round tile of its color (map pins, lists); without, it uses the current text color. */
export function reportIcon(type: string | undefined, size = 24, bg = true): string {
  const r = REPORTS[(type ?? 'hazard') as ReportType] ?? REPORTS.hazard;
  const svg = `<svg viewBox="0 0 24 24" width="${bg ? Math.round(size * 0.62) : size}" height="${bg ? Math.round(size * 0.62) : size}" fill="none" stroke="${bg ? '#fff' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${r.path}</svg>`;
  return bg ? `<span class="ricon" style="--c:${r.color};width:${size}px;height:${size}px">${svg}</span>` : svg;
}
