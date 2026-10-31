/* Formatting in the location's time zone. Copy rule: no em dashes; use a middle dot. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

const t = (d: string | number | Date) => (d instanceof Date ? d : new Date(d));

/** 6:10 AM */
export const fmtTime = (d: string | number | Date, tz: string) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(t(d));
/** 6 AM */
export const fmtHour = (d: string | number | Date, tz: string) => fmt(tz, { hour: 'numeric' }).format(t(d));
/** 6a / 12p, for chart axes */
export const fmtHourShort = (d: string | number | Date, tz: string) =>
  fmtHour(d, tz).replace(' AM', 'a').replace(' PM', 'p');
/** 7:00 PM CDT */
export const fmtTimeTz = (d: string | number | Date, tz: string) =>
  fmt(tz, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(t(d));
/** Tue 6:10 AM CDT */
export const fmtDayTimeTz = (d: string | number | Date, tz: string) =>
  fmt(tz, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(t(d)).replace(',', '');
/** Wed */
export const fmtWeekday = (d: string | number | Date, tz: string) => fmt(tz, { weekday: 'short' }).format(t(d));
/** Wednesday, Oct 28 */
export const fmtLongDate = (d: string | number | Date, tz: string) => fmt(tz, { weekday: 'long', month: 'short', day: 'numeric' }).format(t(d));
/** YYYY-MM-DD in tz */
export const localDate = (d: string | number | Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t(d));

/** Date-only strings ("2026-10-28") rendered as "Oct 28" without tz shifting. */
export function fmtDateKey(date: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}

export function fmtAge(fromIso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(fromIso)) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function uvLabel(uv: number): string {
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}

export function aqiInfo(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Good', color: 'var(--fw-good)' };
  if (aqi <= 100) return { label: 'Moderate', color: 'var(--fw-warn)' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', color: '#e0702b' };
  if (aqi <= 200) return { label: 'Unhealthy', color: 'var(--fw-bad)' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#8f3f97' };
  return { label: 'Hazardous', color: '#7e0023' };
}

export function dewComfort(dew: number): string {
  if (dew < 40) return 'Dry air.';
  if (dew < 55) return 'Comfortable.';
  if (dew < 60) return 'A little humid.';
  if (dew < 65) return 'Getting sticky.';
  if (dew < 70) return 'Muggy.';
  return 'Oppressive.';
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const degToCompass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** NWS descriptions are hard-wrapped at ~70 columns; join single newlines, keep paragraph breaks. Wording unchanged. */
export const unwrap = (s: string) => s.split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
