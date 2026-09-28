import type { SharedAccessApi } from "../shared/types.js";
import type { SharedAccessManager } from "./shared-access-manager.js";

export type { SharedAccessApi };

// ============================================================
// Spec 181 R9 — `deps.sharedAccess`, created per plugin so the plugin id is
// bound, not passed: another plugin's accesses and profiles do not exist for
// this one. A plugin decides who and when; the owner's profiles decide what
// opens. It never names an equipment.
// ============================================================

export function createSharedAccessApi(
  manager: SharedAccessManager,
  pluginId: string,
): SharedAccessApi {
  return Object.freeze({
    profiles: () => manager.pluginProfiles(pluginId),
    upsert: (externalId: string, input: Parameters<SharedAccessApi["upsert"]>[1]) =>
      manager.pluginUpsert(pluginId, externalId, input),
    revoke: (externalId: string) => manager.pluginRevoke(pluginId, externalId),
    list: () => manager.pluginList(pluginId),
  });
}
