import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db/connection.js';
import { get, run } from './db/connection.js';
import { config } from './config.js';
import { nowIso } from './util/text.js';

/**
 * Local secret storage for the optional Anthropic key entered in the UI.
 * The value is AES-256-GCM encrypted with a random key kept in a separate file next to the database.
 * Honest scope: this protects against casually sharing or copying the database file. It does not protect against someone
 * with access to the whole data directory or the running process. The key is never logged and never returned by the API.
 */
const keyFile = () => process.env.BRAHMO_SECRET_KEY_FILE ?? path.join(path.dirname(config.paths.db), '.brahmo-secret.key');

function masterKey(): Buffer {
  const f = keyFile();
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('base64'), { mode: 0o600 });
  return k;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}

export function setSetting(db: Db, key: string, value: string, encrypted = false) {
  run(db, `INSERT INTO app_settings (key, value, encrypted, updated_at) VALUES (?,?,?,?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted, updated_at=excluded.updated_at`, key, encrypted ? encrypt(value) : value, encrypted ? 1 : 0, nowIso());
}
export function getSetting(db: Db, key: string): { value: string; updated_at: string } | null {
  const r = get<{ value: string; encrypted: number; updated_at: string }>(db, 'SELECT * FROM app_settings WHERE key = ?', key);
  if (!r) return null;
  return { value: r.encrypted ? decrypt(r.value) : r.value, updated_at: r.updated_at };
}
export function deleteSetting(db: Db, key: string) { run(db, 'DELETE FROM app_settings WHERE key = ?', key); }

export const DEFAULT_MODEL = config.llm.model;

export interface LlmSettings { apiKey: string | null; model: string; source: 'saved' | 'env' | 'none'; updated_at: string | null }

/** A key saved in the UI wins over the optional environment variable. */
export function getLlmSettings(db: Db): LlmSettings {
  const key = getSetting(db, 'llm.api_key');
  const model = getSetting(db, 'llm.model')?.value ?? DEFAULT_MODEL;
  if (key) return { apiKey: key.value, model, source: 'saved', updated_at: key.updated_at };
  if (config.llm.apiKey) return { apiKey: config.llm.apiKey, model, source: 'env', updated_at: null };
  return { apiKey: null, model, source: 'none', updated_at: null };
}

export const maskKey = (k: string) => `${k.slice(0, 7)}...${k.slice(-4)}`;
