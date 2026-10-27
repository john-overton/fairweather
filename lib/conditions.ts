import type { Cond } from './types';

/* ------------------------------------------------------------------ */
/*  One lookup table: NWS icon codes and WMO codes → app icon set      */
/* ------------------------------------------------------------------ */

const NWS_CODES: Record<string, Cond> = {
  skc: 'clear', few: 'clear', hot: 'clear', cold: 'clear',
  sct: 'pcloudy',
  bkn: 'cloudy', ovc: 'cloudy',
  wind_skc: 'wind', wind_few: 'wind', wind_sct: 'wind', wind_bkn: 'wind', wind_ovc: 'wind',
  rain: 'rain', rain_showers: 'rain', rain_showers_hi: 'rain', fzra: 'rain', rain_fzra: 'rain',
  sleet: 'rain', rain_sleet: 'rain',
  snow: 'snow', rain_snow: 'snow', snow_sleet: 'snow', snow_fzra: 'snow', blizzard: 'snow',
  tsra: 'storm', tsra_sct: 'storm', tsra_hi: 'storm', tornado: 'storm', hurricane: 'storm',
  tropical_storm: 'storm',
  fog: 'fog', haze: 'fog', smoke: 'fog', dust: 'fog',
};

/** Higher wins when an NWS icon URL lists two conditions (e.g. `rain_showers,40/tsra,60`). */
const RANK: Record<Cond, number> = { clear: 0, pcloudy: 1, cloudy: 2, fog: 3, wind: 4, rain: 5, snow: 6, storm: 7 };

/** Parse an NWS icon URL like `https://api.weather.gov/icons/land/day/tsra,40?size=medium`. */
export function condFromNwsIcon(url: string | null | undefined): { cond: Cond; isDay: boolean } | null {
  if (!url) return null;
  const m = url.match(/\/icons\/land\/(day|night)\/([^?]+)/);
  if (!m) return null;
  let best: Cond | null = null;
  for (const part of m[2].split('/')) {
    const code = part.split(',')[0];
    const c = NWS_CODES[code];
    if (c && (best === null || RANK[c] > RANK[best])) best = c;
  }
  return best ? { cond: best, isDay: m[1] === 'day' } : null;
}

const WMO: Record<number, [Cond, string]> = {
  0: ['clear', 'Clear'],
  1: ['clear', 'Mostly clear'],
  2: ['pcloudy', 'Partly cloudy'],
  3: ['cloudy', 'Cloudy'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing fog'],
  51: ['rain', 'Light drizzle'],
  53: ['rain', 'Drizzle'],
  55: ['rain', 'Heavy drizzle'],
  56: ['rain', 'Freezing drizzle'],
  57: ['rain', 'Freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['rain', 'Freezing rain'],
  67: ['rain', 'Freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Showers'],
  81: ['rain', 'Showers'],
  82: ['rain', 'Heavy showers'],
  85: ['snow', 'Snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['storm', 'Thunderstorms'],
  96: ['storm', 'Thunderstorms, hail'],
  99: ['storm', 'Severe thunderstorms'],
};

export function condFromWmo(code: number | null | undefined): { cond: Cond; text: string } {
  const hit = code == null ? undefined : WMO[code];
  return hit ? { cond: hit[0], text: hit[1] } : { cond: 'cloudy', text: 'Unknown' };
}

/* ------------------------------------------------------------------ */
/*  Units and small math                                               */
/* ------------------------------------------------------------------ */

export const cToF = (c: number) => c * 9 / 5 + 32;
export const kmhToMph = (k: number) => k * 0.621371;
export const paToInHg = (p: number) => p / 3386.389;
export const hPaToInHg = (p: number) => p / 33.86389;
export const mToMi = (m: number) => m / 1609.344;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function degToCompass(deg: number | null | undefined): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
export function compassToDeg(dir: string | null | undefined): number | null {
  if (!dir) return null;
  const i = COMPASS.indexOf(dir.toUpperCase());
  return i >= 0 ? i * 22.5 : null;
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------------ */
/*  Time-zone helpers (server and client)                              */
/* ------------------------------------------------------------------ */

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { date: string; hour: number; minute: number; weekday: string }

export function localParts(d: Date | string | number, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt(tz).formatToParts(new Date(d))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

/** UTC offset in minutes for `tz` at instant `d` (e.g. -300 for CDT). */
export function tzOffsetMinutes(d: Date, tz: string): number {
  const p = localParts(d, tz);
  const [y, m, day] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
