/**
 * Run a load, retrying transient failures, and tell the caller whether the result is still
 * relevant.
 *
 * Panels that refetch on navigation face two problems at once: a single failed request
 * (429 from the per-IP rate limit, the burst of 401s when the access token expires, a
 * sleeping tab) leaves them stuck on an error, and a slow request issued for a previous
 * selection can land after a newer one and overwrite it. `isCurrent` guards every write
 * point, so a superseded load stays silent instead of clobbering fresher state.
 */
export type LoadOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "superseded" };

interface Options {
  /** Delay before each retry. Its length is the number of retries. */
  retryDelaysMs: number[];
  /** False once this load has been superseded by a newer one. */
  isCurrent: () => boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadWithRetry<T>(
  load: () => Promise<T>,
  { retryDelaysMs, isCurrent }: Options,
): Promise<LoadOutcome<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const value = await load();
      if (!isCurrent()) return { status: "superseded" };
      return { status: "ok", value };
    } catch (error) {
      if (!isCurrent()) return { status: "superseded" };
      if (attempt >= retryDelaysMs.length) return { status: "failed", error };
      await sleep(retryDelaysMs[attempt]);
      if (!isCurrent()) return { status: "superseded" };
    }
  }
}
