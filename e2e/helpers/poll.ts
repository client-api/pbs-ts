export interface WaitUntilOptions {
  timeoutMs: number;
  intervalMs?: number;
  label?: string;
}

/**
 * Poll `predicate` until it returns truthy or `timeoutMs` elapses.
 * Throws with `label` (or a generic message) on timeout. The last predicate
 * error, if any, is preserved on the thrown error's `cause` field.
 */
export async function waitUntil<T>(
  predicate: () => Promise<T | false | undefined | null>,
  opts: WaitUntilOptions,
): Promise<T> {
  const { timeoutMs, intervalMs = 1_000, label = 'predicate' } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await predicate();
      if (v) return v as T;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const err = new Error(`waitUntil timed out after ${timeoutMs}ms: ${label}`);
  if (lastError) (err as { cause?: unknown }).cause = lastError;
  throw err;
}
