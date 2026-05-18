import axios from 'axios';

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  label?: string;
  /**
   * If false, only retry on network errors (no response received).
   * For non-idempotent operations (POSTs that create resources) where a
   * 5xx might mean "request processed, response lost" — retrying would
   * create duplicates. Default: true.
   */
  idempotent?: boolean;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1500;

function shouldRetry(err: unknown, idempotent: boolean): boolean {
  if (axios.isAxiosError(err)) {
    if (!err.response) return true;
    const s = err.response.status;
    // 429 means the request was rejected by a rate limiter — the resource
    // creation never ran, so retrying is safe even for non-idempotent POSTs.
    if (s === 429) return true;
    if (!idempotent) return false;
    return s >= 500 || s === 408;
  }
  return idempotent;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelay = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const idempotent = opts.idempotent ?? true;
  const label = opts.label ? `:${opts.label}` : '';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err, idempotent)) break;
      const delay = baseDelay * Math.pow(2, i);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[retry${label}] attempt ${i + 1}/${attempts} failed (${msg}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export { sleep };
