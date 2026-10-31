#!/usr/bin/env node
// Dev: the API server (tsx watch, port 3101) and Vite (port 3100, proxies /fairweather/api to 3101) side by side,
// each line prefixed [api] or [web]. Ctrl-C stops both; if either exits, the other is stopped too.
// Each child runs in its own process group and gets signals only from here, via npm (which forwards them): a
// terminal Ctrl-C hitting tsx directly as well would be its second signal, and tsx force-kills on a second one.
// Run: npm run dev
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const color = process.stdout.isTTY ? (code, s) => `\x1b[${code}m${s}\x1b[0m` : (_code, s) => s;

const children = [
  { tag: color(36, '[api]'), script: 'dev:server', env: { FAIRWEATHER_PORT: '3101' } },
  { tag: color(35, '[web]'), script: 'dev:web', env: {} },
].map(({ tag, script, env }) => {
  const child = spawn(npm, ['run', '--silent', script], {
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? (process.stdout.isTTY ? '1' : '0'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    createInterface({ input: stream }).on('line', (line) => out.write(`${tag} ${line}\n`));
  }
  return { tag, child };
});

let exiting = false;

const alive = (child) => child.exitCode === null && child.signalCode === null;

function stopAll(signal) {
  for (const { child } of children) if (alive(child)) child.kill(signal);
}

for (const { tag, child } of children) {
  child.on('exit', (code, signal) => {
    if (!exiting) {
      exiting = true;
      process.exitCode = code ?? (signal ? 1 : 0);
      console.log(`${tag} exited (${signal ?? code}), stopping the other`);
      stopAll('SIGTERM');
    }
  });
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    exiting = true;
    stopAll(sig === 'SIGHUP' ? 'SIGTERM' : sig);
  });
}
// Last resort if this script dies first: take down whatever is left in each child's group
process.on('exit', () => {
  for (const { child } of children) {
    if (!alive(child)) continue;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
});
