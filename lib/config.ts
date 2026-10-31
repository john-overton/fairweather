/**
 * Server settings from the environment (.env.local, loaded by server/env.ts; see env.sample).
 * Everything here has a working default, so an empty env file runs the app as it ships.
 */
import type { AlertMin, PushPrefs, SavedLocation } from './types';

const env = process.env;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALERT_MINS: AlertMin[] = ['advisory', 'watch', 'warning'];

const str = (key: string, fallback: string) => env[key]?.trim() || fallback;

function bool(key: string, fallback: boolean): boolean {
  const v = env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  return !['0', 'off', 'false', 'no'].includes(v);
}

function int(key: string, fallback: number): number {
  const n = Number(env[key]);
  return env[key]?.trim() && Number.isInteger(n) && n > 0 ? n : fallback;
}

function time(key: string, fallback: string): string;
function time(key: string, fallback: null): string | null;
function time(key: string, fallback: string | null) {
  const v = env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === 'off') return null;
  if (HHMM.test(v)) return v;
  console.warn(`[fairweather] ${key}=${v} is not HH:MM; using ${fallback ?? 'off'}`);
  return fallback;
}

/** "Name|lat|lon", e.g. "Kansas City, MO|39.0997|-94.5786" */
function location(key: string, fallback: SavedLocation): SavedLocation {
  const v = env[key]?.trim();
  if (!v) return fallback;
  const [name, lat, lon] = v.split('|').map((s) => s.trim());
  const la = Number(lat), lo = Number(lon);
  if (name && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    return { id: 'default', name, lat: la, lon: lo };
  }
  console.warn(`[fairweather] ${key} should look like "Name|lat|lon"; using ${fallback.name}`);
  return fallback;
}

const alertMin = str('FAIRWEATHER_DEFAULT_ALERT_MIN', 'watch') as AlertMin;

export const config = {
  port: int('FAIRWEATHER_PORT', 3100),
  host: str('FAIRWEATHER_HOST', '127.0.0.1'),

  /** In-process scheduler (server/jobs.ts). Cron syntax, server-local time. */
  jobs: {
    enabled: bool('FAIRWEATHER_JOBS', true),
    schedules: {
      alerts: str('FAIRWEATHER_SCHEDULE_ALERTS', '*/2 * * * *'),
      rain: str('FAIRWEATHER_SCHEDULE_RAIN', '*/15 * * * *'),
      radar: str('FAIRWEATHER_SCHEDULE_RADAR', '*/5 * * * *'),
      cleanup: str('FAIRWEATHER_SCHEDULE_CLEANUP', '17 3 * * *'),
    },
  },

  /** What a first-time visitor and a new push subscription start with (served to the browser by /api/config) */
  defaults: {
    location: location('FAIRWEATHER_DEFAULT_LOCATION', { id: 'kc', name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 }),
    prefs: {
      alertMin: ALERT_MINS.includes(alertMin) ? alertMin : 'watch',
      rainSoon: bool('FAIRWEATHER_DEFAULT_RAIN_SOON', true),
      briefTime: time('FAIRWEATHER_DEFAULT_BRIEF_TIME', null),
      quietStart: time('FAIRWEATHER_DEFAULT_QUIET_START', '22:00'),
      quietEnd: time('FAIRWEATHER_DEFAULT_QUIET_END', '06:00'),
    } satisfies PushPrefs,
  },

  /** Cleanup job retention, in days */
  retain: {
    deliveries: int('FAIRWEATHER_RETAIN_DELIVERIES_DAYS', 30),
    alerts: int('FAIRWEATHER_RETAIN_ALERTS_DAYS', 7),
    inactiveSubs: int('FAIRWEATHER_RETAIN_INACTIVE_SUB_DAYS', 120),
  },
};
