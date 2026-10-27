import { NextResponse } from 'next/server';

/* In-memory fixed-window rate limiter (single server process). */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset <= now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return false;
  }
  h.n++;
  return h.n > limit;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Parse ?lat=&lon=, rounded to 2 decimals (the cache key), limited to the US. */
export function parseLatLon(url: URL): { lat: number; lon: number } | null {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}
