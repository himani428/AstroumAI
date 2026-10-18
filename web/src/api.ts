import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

/** Fetch wrapper that surfaces the server's real error message (no mock fallbacks). */
export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: init?.method ?? 'GET', headers: init?.body ? { 'content-type': 'application/json' } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', `Cannot reach the BRAHMO API (${(e as Error).message}). Is the server running?`);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`, json?.error?.details);
  return json as T;
}

export interface Loadable<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }

export function useApi<T = any>(path: string | null): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path).then((data) => { if (my === seq.current) setState({ data, error: null, loading: false }); }, (error) => { if (my === seq.current) setState({ data: null, error, loading: false }); });
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
