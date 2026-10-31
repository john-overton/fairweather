/**
 * Loads .env.local from the working directory (the repo root, or WorkingDirectory under systemd) into process.env.
 * Import this first in every entry point: lib/config.ts, lib/db.ts, lib/sources.ts and lib/radar.ts read the
 * environment at module load. Variables already set in the real environment win, as with dotenv.
 */
try {
  process.loadEnvFile('.env.local');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

export {};
