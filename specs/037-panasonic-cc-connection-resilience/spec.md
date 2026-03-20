# Fix: Panasonic CC Connection Resilience

## Summary

Improve Panasonic Comfort Cloud integration reliability by ensuring token persistence between bridge invocations and adding retry logic for transient API failures.

## Problem

1. The Python bridge spawns a new process per API call. The `aio-panasonic-comfort-cloud` lib's `_do_save()` uses `asyncio.ensure_future()` (fire-and-forget) — the process can exit before the refreshed token is written to disk, forcing a full re-authentication on the next call and triggering Panasonic rate-limits.
2. No retry on transient failures (network blip, temporary 5xx) — a single failure marks the integration as errored until the next poll cycle.
3. Bridge timeout (30s) is tight for slow Panasonic cloud responses.

## Acceptance Criteria

- [ ] Token file is guaranteed to be flushed to disk before bridge process exits
- [ ] Transient failures (network, 5xx) are retried up to 2 times with backoff
- [ ] Bridge timeout increased to 60s
- [ ] No change to bridge architecture (still execFile per call)

## Scope

### In Scope

- `bridge.py`: flush token file on exit, add retry logic
- `panasonic-bridge.ts`: increase timeout

### Out of Scope

- Persistent daemon bridge (future improvement)
- Changes to the `aio-panasonic-comfort-cloud` library itself
