/**
 * Run one scheduled job now and print its result: `npm run job <name>` (built) or `npm run job:dev <name>` (tsx).
 * Uses the same .env.local, database and tile cache as the server, so it's safe alongside it (SQLite WAL).
 */
import './env';

import { closeDb } from '@/lib/db';
import { stopMrmsWorker } from '@/lib/mrms';

import { isJobName, JOBS, runJob } from './jobs';

const name = process.argv[2] ?? '';

if (!isJobName(name)) {
  console.error(`usage: npm run job <${Object.keys(JOBS).join('|')}>${name ? `\nunknown job: ${name}` : ''}`);
  process.exit(2);
}

let code = 0;
try {
  console.log(JSON.stringify(await runJob(name), null, 2));
} catch {
  code = 1; // runJob logged it
}
await stopMrmsWorker().catch(() => {});
closeDb();
process.exit(code);
