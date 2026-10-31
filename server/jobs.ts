/**
 * In-process scheduler for the lib/cron.ts jobs (croner). Schedules come from lib/config.ts (FAIRWEATHER_SCHEDULE_*,
 * server-local time); FAIRWEATHER_JOBS=off leaves them all to `npm run job` or another instance.
 *
 * A run that's still going when its next tick comes is skipped, not stacked (`protect`), and a failing job is
 * logged and tried again on its next tick: nothing here may take the HTTP server down.
 */
import { Cron } from 'croner';

import { config } from '@/lib/config';
import { runAlerts, runCleanup, runRadar, runRainAndBrief } from '@/lib/cron';

export const JOBS = {
  alerts: runAlerts,
  rain: runRainAndBrief,
  radar: runRadar,
  cleanup: runCleanup,
} satisfies Record<keyof typeof config.jobs.schedules, () => unknown>;

export type JobName = keyof typeof JOBS;

export const isJobName = (s: string): s is JobName => Object.hasOwn(JOBS, s);

const envKey = (name: JobName) => `FAIRWEATHER_SCHEDULE_${name.toUpperCase()}`;

/** Run one job, logging `[fairweather] job <name> <ms>ms <result json>`. Throws what the job throws (after logging it). */
export async function runJob(name: JobName): Promise<unknown> {
  const started = Date.now();
  try {
    const result = await JOBS[name]();
    console.log(`[fairweather] job ${name} ${Date.now() - started}ms ${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    console.error(`[fairweather] job ${name} failed after ${Date.now() - started}ms`, e);
    throw e;
  }
}

let crons: Cron[] = [];
const running = new Set<Promise<unknown>>();

/** Validate every schedule, then start them. Throws (naming the env var) on a bad cron string, before anything starts. */
export function startJobs() {
  if (!config.jobs.enabled) {
    console.log('[fairweather] jobs off (FAIRWEATHER_JOBS=off)');
    return;
  }
  const names = Object.keys(JOBS) as JobName[];
  for (const name of names) {
    const pattern = config.jobs.schedules[name];
    try {
      new Cron(pattern, { paused: true }).stop();
    } catch (e) {
      throw new Error(`${envKey(name)}="${pattern}" is not a valid cron schedule: ${(e as Error).message}`);
    }
  }
  crons = names.map((name) => new Cron(config.jobs.schedules[name], {
    name,
    protect: () => console.warn(`[fairweather] job ${name} skipped: the previous run is still going`),
  }, async () => {
    const p = runJob(name).catch(() => {}); // already logged
    running.add(p);
    await p;
    running.delete(p);
  }));
  console.log(`[fairweather] jobs: ${names.map((n) => `${n} "${config.jobs.schedules[n]}"`).join(', ')}`);
}

/** Stop scheduling, then wait (up to `graceMs`) for runs in progress to finish. */
export async function stopJobs(graceMs = 20_000) {
  for (const c of crons) c.stop();
  crons = [];
  if (!running.size) return;
  console.log(`[fairweather] waiting for ${running.size} running job(s)`);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...running]),
    new Promise((r) => { timer = setTimeout(r, graceMs); }),
  ]);
  clearTimeout(timer);
}
