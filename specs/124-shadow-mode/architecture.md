# Spec 124 — Architecture

## Type changes

`src/shared/types.ts` — extend `AppConfig`:

```ts
export interface AppConfig {
  // ...existing...
  /** Spec 124 — when true, all outbound subsystems are gated off at boot. */
  shadowMode: boolean;
}
```

No new SQLite migration, no new InfluxDB field, no new EventBus type, no new equipment type.

## Config resolution (`src/config.ts`)

```ts
function envBool(key: string, fallback = false): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

// In loadConfig():
return {
  // ...existing fields...
  shadowMode: envBool("SOWEL_SHADOW_MODE"),
};
```

Only known truthy values trip the flag (defensive: a misspelled `SOWEL_SHADOW_MODE=on` stays off rather than enabling silently — better to fail loud than fail open in either direction).

## Boot sequence gates (`src/index.ts`)

The skipped lifecycle calls become:

```ts
if (!config.shadowMode) {
  await pluginLoader.loadAll();
  await recipeLoader.loadAll();
} else {
  logger.warn(
    { module: "shadow-mode", subsystem: "plugins+recipes" },
    "Shadow mode: skipping plugin and recipe loaders",
  );
}

// ...later...

if (!config.shadowMode) {
  recipeManager.init();
} else {
  logger.warn(
    { module: "shadow-mode", subsystem: "recipe-manager" },
    "Shadow mode: skipping recipe manager init",
  );
}

if (!config.shadowMode) {
  mqttPublishService.init();
  notificationPublishService.init();
}

if (!config.shadowMode) {
  versionChecker.start();
}
```

A single banner is emitted once, very early, right after `loadConfig()` so it shows up before any other component logs:

```ts
if (config.shadowMode) {
  logger.warn(
    {
      module: "shadow-mode",
      hostname: os.hostname(),
      version: pkg.version,
    },
    "SHADOW MODE ACTIVE — outbound integrations, recipes, publishers, " +
      "and version checks are disabled. This instance is safe to run " +
      "against a copy of production data.",
  );
}
```

`os.hostname()` is imported from `node:os`. The hostname is included in the log line because the most likely operator error — accidentally setting the env var on production — becomes detectable in `docker logs sowel` by reading the hostname.

## Runtime gate (R3)

`PluginLoader.start(pluginId)` (the per-plugin start used by the _Enable plugin_ API route) gains a guard:

```ts
class PluginLoader {
  private readonly shadowMode: boolean;

  constructor(/*...*/ , shadowMode: boolean) {
    this.shadowMode = shadowMode;
    // ...
  }

  async start(pluginId: string): Promise<void> {
    if (this.shadowMode) {
      this.logger.warn(
        { module: "shadow-mode", pluginId },
        "Shadow mode: refusing to start plugin",
      );
      return;
    }
    // ...existing logic...
  }
}
```

Same pattern applied to:

- `RecipeManager.startInstance()` (recipe enable from the UI)
- `MqttPublisherManager.start(publisherId)` (publisher enable)
- `NotificationPublisherManager.start(publisherId)` (publisher enable)

These are the four runtime entry points that boot an outbound subsystem on demand. By gating them, we close the in-UI footgun where an admin enabling a plugin while in shadow mode would otherwise dial out.

The API routes themselves do NOT change (no 403). The user sees their click succeed, the row persists, the runtime stays inert. A small status indicator on the integration card ("inert — shadow mode") would be nice but is out of scope for this spec; the global banner is enough.

## API route (R5)

`src/api/routes/system.ts` — new endpoint:

```ts
app.get("/api/v1/system/mode", async (request, reply) => {
  if (!request.auth) {
    return reply.code(401).send({ error: "Authentication required" });
  }
  return { shadowMode: config.shadowMode };
});
```

Registered in the same `registerSystemRoutes()` call. Dependency: the config is already available in the server scope (passed via deps). If not, add it.

## UI banner (R6)

New file `ui/src/components/layout/ShadowBanner.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useShadowMode } from "../../store/useShadowMode";

export function ShadowBanner() {
  const { t } = useTranslation();
  const shadowMode = useShadowMode((s) => s.shadowMode);
  if (!shadowMode) return null;
  return (
    <div
      role="status"
      className="bg-warning text-warning-foreground text-[13px] font-medium px-4 py-2 text-center sticky top-0 z-50"
    >
      {t("shadow.banner")}
    </div>
  );
}
```

New Zustand slice `ui/src/store/useShadowMode.ts`:

```ts
import { create } from "zustand";
import { getSystemMode } from "../api";

interface ShadowState {
  shadowMode: boolean;
  fetch: () => Promise<void>;
}

export const useShadowMode = create<ShadowState>((set) => ({
  shadowMode: false,
  fetch: async () => {
    try {
      const { shadowMode } = await getSystemMode();
      set({ shadowMode });
    } catch {
      // Treat fetch errors as "not shadow" — banner stays hidden rather
      // than appearing spuriously on a network blip.
    }
  },
}));
```

`ShadowBanner` is mounted once in `AppShell.tsx` above the routing outlet so it appears on every page. `fetch()` is called from `AppShell` on mount.

i18n keys (FR + EN):

```
shadow.banner = "SHADOW MODE — outbound integrations and publishers are disabled. This instance does not affect production." (EN)
              / "MODE SHADOW — les intégrations sortantes et les publishers sont désactivés. Cette instance n'a aucun effet sur la production." (FR)
```

## File touch list

| File                                                  | Change                                                    |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `src/shared/types.ts`                                 | Add `shadowMode: boolean` to `AppConfig`                  |
| `src/config.ts`                                       | `envBool` helper + read `SOWEL_SHADOW_MODE`               |
| `src/config.test.ts`                                  | Cover the env-var resolution truth table                  |
| `src/index.ts`                                        | Banner log, six lifecycle gates                           |
| `src/plugins/plugin-loader.ts`                        | `shadowMode` ctor arg + runtime gate on `start()`         |
| `src/plugins/plugin-loader.test.ts`                   | Runtime-gate test                                         |
| `src/recipes/engine/recipe-manager.ts`                | `shadowMode` ctor arg + runtime gate                      |
| `src/mqtt-publishers/mqtt-publisher-manager.ts`       | `shadowMode` ctor arg + runtime gate                      |
| `src/notifications/notification-publisher-manager.ts` | `shadowMode` ctor arg + runtime gate                      |
| `src/api/routes/system.ts`                            | `GET /api/v1/system/mode`                                 |
| `src/api/routes/system.test.ts`                       | Cover the new endpoint                                    |
| `src/api/server.ts`                                   | Pass `config` (or `shadowMode`) into route deps           |
| `ui/src/api.ts`                                       | `getSystemMode()`                                         |
| `ui/src/store/useShadowMode.ts`                       | NEW                                                       |
| `ui/src/components/layout/ShadowBanner.tsx`           | NEW                                                       |
| `ui/src/components/layout/AppShell.tsx`               | Mount `<ShadowBanner />`, call `fetch()` on mount         |
| `ui/src/i18n/locales/{en,fr}.json`                    | `shadow.banner` key                                       |
| `scripts/howto-shadow.md`                             | Replace step 4 (manual SQL) with `-e SOWEL_SHADOW_MODE=1` |
| `docs/release-notes.md`, `docs/release-notes.fr.md`   | Version entry                                             |
| `docs/technical/api-reference.md`, `.fr.md`           | `GET /api/v1/system/mode` row                             |

## Error handling

- `envBool` never throws. Unknown values default to `false` (fail safe — better to risk forgetting to enable shadow than to accidentally enable it on production).
- The boot banner is logged unconditionally when shadow mode is on; if `logger.warn` itself throws (very unlikely), the failure propagates and Sowel crashes, which is acceptable: a Sowel that cannot log a critical safety banner should not start.
- `useShadowMode.fetch()` swallows network errors and leaves the banner hidden. Reasoning: a spurious banner on a normal instance is more confusing than a missing banner on a shadow (the operator has other cues: hostname, logs, the absence of integration data flowing).
- API route returns 401 if unauthenticated, matching the rest of `/system/*`.

## Performance

- One extra `process.env` read at boot.
- Six `if (shadowMode)` checks at boot.
- Four runtime checks per plugin/recipe/publisher start call (negligible).
- One additional `fetch` from the UI on mount.

## Compatibility

- No env var change required for existing deployments. `SOWEL_SHADOW_MODE` unset = current behaviour, byte for byte.
- No SQLite migration.
- API: only additive (new endpoint).
- UI: only additive (new banner + store).
