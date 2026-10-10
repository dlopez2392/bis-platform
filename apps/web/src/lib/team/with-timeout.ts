/** Thrown by withTimeout, so a caller can tell "no answer in time" from a refusal. */
export class TimeoutError extends Error {}

/**
 * Rejects with TimeoutError when `p` has not settled within `ms`.
 * `@clerk/backend` sets no request timeout of its own. The losing request is
 * NOT cancelled: it may still land later, which callers must allow for.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
