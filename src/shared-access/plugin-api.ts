import type { SharedAccessStatus } from "../shared/types.js";
import type { PluginInvitation, SharedAccessManager } from "./shared-access-manager.js";

// ============================================================
// Spec 181 R9 — `deps.sharedAccess`, created per plugin so the plugin id is
// bound, not passed: another plugin's accesses and profiles do not exist for
// this one. A plugin decides who and when; the owner's profiles decide what
// opens. It never names an equipment.
// ============================================================

export interface SharedAccessApi {
  /** The profiles the owner granted to this plugin — names only, never the gates. */
  profiles(): Array<{ id: string; name: string; isDefault: boolean; complete: boolean }>;
  /**
   * One stay, one key (R9.34). Idempotent on `externalId`, which names a stay,
   * never a person. `from` / `until` are dates with their hour on the house's
   * clock (`2026-10-03T16:00`) or ISO; `until` is required. Without
   * `profileId`, the default profile is used.
   */
  upsert(
    externalId: string,
    input: { profileId?: string; label: string; from: string | null; until: string },
  ): PluginInvitation;
  revoke(externalId: string): void;
  list(): Array<{
    externalId: string;
    state: SharedAccessStatus;
    code: string | null;
    invitationUrl: string | null;
  }>;
}

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
