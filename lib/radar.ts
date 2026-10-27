import { iemHrrrInit, iemLatestComposite } from './sources';
import type { RadarManifest } from './types';

const MIN = 60_000;
const FORECAST_MAX_MINUTE = 18 * 60;

/**
 * Radar manifest. Observed frames come from the IEM NEXRAD composite archive
 * (5-minute N0Q mosaics); forecast frames from the newest complete HRRR run on
 * IEM (15-minute sub-hourly REFD/REFP). Frame URLs are built client-side from
 * these times, pinned to the run so mixed-run frames are never shown.
 */
export async function radarManifest(): Promise<RadarManifest> {
  const now = Date.now();
  const [latest, init] = await Promise.all([
    iemLatestComposite(),
    iemHrrrInit().catch(() => null),
  ]);
  const latestMs = Date.parse(latest);

  const forecast: RadarManifest['forecast'] = [];
  if (init) {
    const initMs = Date.parse(init);
    for (let m = 0; m <= FORECAST_MAX_MINUTE; m += 15) {
      const valid = initMs + m * MIN;
      if (valid <= latestMs) continue;
      if (valid > now + FORECAST_MAX_MINUTE * MIN) break;
      forecast.push({ valid: new Date(valid).toISOString(), minute: m });
    }
  }

  return {
    latestObs: new Date(latestMs).toISOString(),
    stale: now - latestMs > 20 * MIN,
    run: init,
    runLabel: init ? `HRRR ${init.slice(11, 13)}Z` : null,
    forecast,
    updated: new Date(now).toISOString(),
  };
}
