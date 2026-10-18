// `npm run dev`: API on :8787 and Vite dev server on :5173 with hot reload. Same no-shell launch as start.mjs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' };
const run = (rel, args) => spawn(process.execPath, [path.join(root, 'node_modules', ...rel), ...args], { cwd: root, stdio: 'inherit', env });
const a = run(['tsx', 'dist', 'cli.mjs'], ['watch', path.join('server', 'src', 'cli', 'serve.ts')]);
const b = run(['vite', 'bin', 'vite.js'], ['--config', path.join('web', 'vite.config.ts')]);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { a.kill(s); b.kill(s); });
