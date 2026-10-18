import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { log } from '../logger.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

/** Strict runtime validation for request bodies/queries. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null } });
  if (err instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: err.issues } });
  const message = err instanceof Error ? err.message : String(err);
  log.error('unhandled error', { path: req.path, message });
  // The real error message is surfaced to the caller; there is no mock fallback.
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: null } });
}

export const jsonRow = <T extends Record<string, unknown>>(r: T, keys: string[]): T => {
  const o: Record<string, unknown> = { ...r };
  for (const k of keys) if (typeof o[k] === 'string') { try { o[k.replace(/_json$/, '')] = JSON.parse(o[k] as string); delete o[k]; } catch { /* keep raw */ } }
  return o as T;
};
