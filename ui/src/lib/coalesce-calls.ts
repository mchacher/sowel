/**
 * Collapse a burst of calls into at most one leading + one trailing call per window.
 *
 * WebSocket events arrive batched (one frame can carry 30+ `recipe.instance.state.changed`
 * events). Handlers that refetch a whole collection on each event turn a single frame into
 * dozens of parallel HTTP requests, which burns through the server's per-IP rate limit
 * (300 req/min) and can make unrelated requests fail with 429.
 *
 * The first call runs immediately (the UI stays snappy); every call during the cooldown is
 * merged into a single trailing call fired when the window closes.
 */
export function coalesceCalls(fn: () => void, waitMs: number): () => void {
  let cooling = false;
  let pending = false;

  const run = (): void => {
    cooling = true;
    fn();
    setTimeout(() => {
      cooling = false;
      if (pending) {
        pending = false;
        run();
      }
    }, waitMs);
  };

  return () => {
    if (cooling) {
      pending = true;
      return;
    }
    run();
  };
}
