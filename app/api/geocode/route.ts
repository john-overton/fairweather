import { NextResponse } from 'next/server';

import { jsonError } from '@/lib/http';
import { cached } from '@/lib/sources';

export const dynamic = 'force-dynamic';

const STATES: Record<string, string> = {
  Alabama: 'AL', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY',
};

interface GeoJson { results?: { name: string; admin1?: string; country_code: string; latitude: number; longitude: number; population?: number }[] }

/** Place search via Open-Meteo geocoding, limited to the contiguous US. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2 || q.length > 80) return NextResponse.json({ results: [] });
  try {
    const j = await cached(`geo:${q.toLowerCase()}`, 24 * 3600_000, async () => {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.split(',')[0])}&count=20&language=en&countryCode=US`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as GeoJson;
    });
    const stateHint = q.includes(',') ? q.split(',')[1].trim().toLowerCase() : '';
    const results = (j.results ?? [])
      .filter((r) => r.admin1 && STATES[r.admin1])
      .filter((r) => !stateHint || STATES[r.admin1!].toLowerCase() === stateHint || r.admin1!.toLowerCase().startsWith(stateHint))
      .slice(0, 8)
      .map((r) => ({ name: `${r.name}, ${STATES[r.admin1!]}`, lat: r.latitude, lon: r.longitude }));
    return NextResponse.json({ results });
  } catch {
    return jsonError(502, "Couldn't reach place search. Try latitude and longitude instead.");
  }
}
