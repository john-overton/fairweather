/** Server-side defaults (GET /api/config), cached so later boots start from the last known copy. The literals are the last resort. */
import type { ClientConfig, PushPrefs, SavedLocation } from '@/lib/types';

import { api } from './base';
import { store } from './store';

export const FALLBACK_LOC: SavedLocation = { id: 'kc', name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 };
export const FALLBACK_PREFS: PushPrefs = { alertMin: 'watch', rainSoon: true, briefTime: null, quietStart: '22:00', quietEnd: '06:00' };

function validConfig(v: unknown): ClientConfig | null {
  const d = (v as Partial<ClientConfig> | null)?.defaults;
  const l = d?.location;
  if (!d || !l || typeof l.name !== 'string' || !Number.isFinite(l.lat) || !Number.isFinite(l.lon) || !d.prefs || typeof d.prefs !== 'object') return null;
  return { defaults: { location: { id: typeof l.id === 'string' ? l.id : FALLBACK_LOC.id, name: l.name, lat: l.lat, lon: l.lon }, prefs: { ...FALLBACK_PREFS, ...d.prefs } } };
}

/** Cached server defaults, or the built-in ones before the first successful fetch */
export const cachedConfig = (): ClientConfig =>
  validConfig(store.get('wx.config', null)) ?? { defaults: { location: FALLBACK_LOC, prefs: FALLBACK_PREFS } };

/** Fetches and caches the server defaults. Resolves null (never rejects) when the server is unreachable or answers oddly. */
export async function fetchConfig(): Promise<ClientConfig | null> {
  try {
    const r = await fetch(api('config'));
    const cfg = r.ok ? validConfig(await r.json()) : null;
    if (cfg) store.set('wx.config', cfg);
    return cfg;
  } catch {
    return null;
  }
}
