import { config } from './config.js';

const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof order;

/** Minimal structured JSON logger (one line per event, stderr for warn/error). */
function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[config.logLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};
