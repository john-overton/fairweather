#!/usr/bin/env node
// Bundles the server for production: server/index.ts → dist/server/index.mjs, server/job.ts → dist/server/job.mjs,
// and the MRMS decode worker → dist/server/workers/mrms-decode.mjs (lib/mrms.ts finds it next to the bundle).
// node_modules stay external and resolve at runtime. Leaves dist/web (the Vite build) alone.
// Run: node scripts/build-server.mjs   (part of npm run build)
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}dist/server`;

await rm(outdir, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    index: 'server/index.ts',
    job: 'server/job.ts',
    'workers/mrms-decode': 'lib/workers/mrms-decode.mjs',
  },
  outdir,
  outExtension: { '.js': '.mjs' },
  // No code splitting: lib/mrms.ts resolves the worker from import.meta.url, which must stay dist/server/*.mjs
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
