// `npm start`: builds the UI once if needed, then starts one process that serves API + UI.
// First start also creates the database and ingests the supplied datasets automatically.
// Tools are launched with the current Node binary (no shell, no .cmd shims) so paths with spaces work on Windows.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('scripts/start.mjs v2 (direct node launch, no shell)');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`BRAHMO AI needs Node.js 22.13 or newer (found ${process.versions.node}). Install the current LTS from https://nodejs.org and retry.`);
  process.exit(1);
}
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --disable-warning=ExperimentalWarning`.trim() };
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!fs.existsSync(vite) || !fs.existsSync(tsx)) { console.error('Dependencies are missing. Run `npm install` first.'); process.exit(1); }

if (!fs.existsSync(path.join(root, 'dist', 'index.html')) || process.argv.includes('--rebuild')) {
  console.log('Building the web UI (first start only)...');
  const r = spawnSync(process.execPath, [vite, 'build', '--config', path.join('web', 'vite.config.ts')], { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) { console.error('UI build failed. See the output above.'); process.exit(r.status ?? 1); }
}
console.log('Starting BRAHMO AI (first start ingests the datasets, about 10 to 20 seconds)...');
const child = spawn(process.execPath, [tsx, path.join('server', 'src', 'cli', 'serve.ts')], { cwd: root, stdio: 'inherit', env });
child.on('exit', (c) => process.exit(c ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
