/** /api/forecast, /api/alerts, /api/alerts/detail, /api/geocode, /api/config */
import { Hono } from 'hono';

import { config } from '@/lib/config';
import { toWxAlert, buildForecast } from '@/lib/forecast';
import { jsonError, parseLatLon } from '@/lib/http';
import { HttpError, cached, nwsAlert, nwsAlertsPoint } from '@/lib/sources';
import type { ClientConfig } from '@/lib/types';

export const weather = new Hono();

const LATLON_HELP = 'Use decimal degrees, like lat=39.0997&lon=-94.5786';

weather.get('/forecast', async (c) => {
  const ll = parseLatLon(new URL(c.req.url));
  if (!ll) return jsonError(400, LATLON_HELP);
  try {
    const data = await cached(`forecast:${ll.lat},${ll.lon}`, 10 * 60_000, () => buildForecast(ll.lat, ll.lon));
    return Response.json(data, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    console.error('[fairweather] forecast failed', e);
    return jsonError(502, `Couldn't load the forecast (${(e as Error).message}). Showing saved data if available.`);
  }
});

weather.get('/alerts', async (c) => {
  const ll = parseLatLon(new URL(c.req.url));
  if (!ll) return jsonError(400, LATLON_HELP);
  try {
    const alerts = (await nwsAlertsPoint(ll.lat, ll.lon)).map(toWxAlert).filter((a) => a.messageType !== 'Cancel');
    return Response.json({ alerts }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch {
    return jsonError(502, "Couldn't reach NWS alerts. Trying again in 2 minutes.");
  }
});

/** Full text of one alert, fetched when a warning or watch is tapped on the radar map */
weather.get('/alerts/detail', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^urn:oid:[\w.-]{1,120}$/.test(id)) return jsonError(400, 'Unknown alert id');
  try {
    const p = await nwsAlert(id);
    return Response.json({ alert: { ...toWxAlert(p), areaDesc: p.areaDesc } }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return jsonError(404, 'This alert has ended.');
    return jsonError(502, "Couldn't reach NWS alerts. Try again in a minute.");
  }
});

/** Server-side defaults (lib/config.ts) a first-time visitor starts from */
weather.get('/config', () => {
  const body: ClientConfig = { defaults: config.defaults };
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } });
});

/* ------------------------------------------------------------------ */
/*  Place search                                                       */
/* ------------------------------------------------------------------ */

const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY',
};

interface GeoJson { results?: { name: string; admin1?: string; country_code: string; latitude: number; longitude: number; population?: number }[] }

/** Territories NWS forecasts for and the radar mosaic covers (San Juan office, TJUA radar) */
const TERRITORIES: Record<string, { code: string; name: string }> = {
  PR: { code: 'PR', name: 'Puerto Rico' },
  VI: { code: 'VI', name: 'U.S. Virgin Islands' },
};

type GeoResult = NonNullable<GeoJson['results']>[number];

async function search(name: string, country: string): Promise<GeoResult[]> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=20&language=en&countryCode=${country}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as GeoJson).results ?? [];
}

/** Two-letter suffix for a result: the state, or PR / VI for territories (Open-Meteo files those as their own countries). */
function regionCode(r: GeoResult): string | null {
  if (r.country_code === 'US') return r.admin1 ? STATES[r.admin1] ?? null : null;
  return TERRITORIES[r.country_code]?.code ?? null;
}

/** Place search via Open-Meteo geocoding: US states, DC, Puerto Rico, and the U.S. Virgin Islands. */
weather.get('/geocode', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2 || q.length > 80) return Response.json({ results: [] });
  try {
    const name = q.split(',')[0].trim();
    const all = await cached(`geo:${name.toLowerCase()}`, 24 * 3600_000, async () => {
      // Open-Meteo filters by one country at a time; search the US and its covered territories together
      const lists = await Promise.all(['US', ...Object.keys(TERRITORIES)].map((cc) => search(name, cc)));
      return lists.flat();
    });
    const hint = q.includes(',') ? q.split(',')[1].trim().toLowerCase() : '';
    const results = all
      .map((r) => ({ r, code: regionCode(r) }))
      .filter((x): x is { r: GeoResult; code: string } => !!x.code)
      .filter(({ r, code }) => !hint || code.toLowerCase() === hint
        || (r.admin1 ?? '').toLowerCase().startsWith(hint)
        || (TERRITORIES[r.country_code]?.name.toLowerCase().startsWith(hint) ?? false))
      // Biggest places first, so "San Juan" finds Puerto Rico's capital before San Juan, TX
      .sort((a, b) => (b.r.population ?? 0) - (a.r.population ?? 0))
      .slice(0, 8)
      .map(({ r, code }) => ({ name: `${r.name}, ${code}`, lat: r.latitude, lon: r.longitude }));
    return Response.json({ results });
  } catch {
    return jsonError(502, "Couldn't reach place search. Try latitude and longitude instead.");
  }
});
