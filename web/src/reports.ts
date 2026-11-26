// Quick trail reports, like a car navigation app's "report" buttons, but for trail problems.
export const REPORTS = {
  tree:     { icon: '🌲', label: 'Downed tree' },
  rocks:    { icon: '🪨', label: 'Rockslide' },
  washout:  { icon: '🕳️', label: 'Washout' },
  water:    { icon: '🌊', label: 'Deep water' },
  mud:      { icon: '🟫', label: 'Deep mud' },
  snow:     { icon: '❄️', label: 'Snow / ice' },
  closed:   { icon: '🚧', label: 'Trail closed' },
  gate:     { icon: '🔒', label: 'Gate locked' },
  animals:  { icon: '🐄', label: 'Livestock / wildlife' },
  vehicle:  { icon: '🚙', label: 'Disabled vehicle' },
  ranger:   { icon: '🚓', label: 'Ranger / patrol' },
  fire:     { icon: '🔥', label: 'Fire / smoke' },
  hazard:   { icon: '⚠️', label: 'Other hazard' },
} as const;
export type ReportType = keyof typeof REPORTS;
export const REPORT_TYPES = Object.keys(REPORTS) as ReportType[];
