import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { updatePlugin } from "../../api";
import { localizedName } from "../../lib/plugin-categories";
import type { PluginInfo } from "../../types";

/**
 * Bulk update affordance for the Plugins page (issue #749).
 *
 * The banner counts exactly what the navigation badge counts
 * (`usePluginUpdates`): every installed package with a newer version. The two
 * disagreeing was confusing, the badge saying "2 updates" while the page showed
 * nothing.
 *
 * What it can *act* on is narrower: spec 136 requires an explicit TOFU
 * re-confirmation of the tarball fingerprint for each personal-source package,
 * which is a per-plugin decision and cannot be batched. Those are named in the
 * banner and updated from their own row instead.
 */
export function UpdateAllBanner({
  plugins,
  lang,
  onRefresh,
}: {
  plugins: PluginInfo[];
  lang: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [failed, setFailed] = useState(0);

  // Same rule as the navigation badge.
  const pending = plugins.filter((p) => p.latestVersion);
  const batchable = pending.filter((p) => p.source !== "personal");
  const personalCount = pending.length - batchable.length;

  // A single pending update is already fully served by its own row.
  if (pending.length < 2) return null;

  const handleUpdateAll = async () => {
    setUpdating(true);
    setFailed(0);
    let failures = 0;
    try {
      // Sequential on purpose: each update restarts a plugin server-side.
      for (const plugin of batchable) {
        try {
          await updatePlugin(plugin.manifest.id);
        } catch {
          // Keep going — one failing package must not strand the others — but
          // say so afterwards: a stale registry SHA256 fails every package and
          // used to leave the banner looking like nothing had happened.
          failures += 1;
        }
      }
      setFailed(failures);
      // Give the restarted plugins a moment before re-reading their state.
      await new Promise((r) => setTimeout(r, 1500));
      onRefresh();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 px-4 py-3 bg-error/[0.06] border border-error/25 rounded-[10px]">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-error">
          {t("plugins.updatesAvailable", { count: pending.length })}
        </p>
        <p className="text-[11px] text-text-tertiary truncate">
          {failed > 0
            ? t("plugins.updateAllFailed", { count: failed })
            : pending.map((p) => localizedName(p.manifest, lang)).join(", ")}
        </p>
        {personalCount > 0 && (
          <p className="text-[11px] text-text-tertiary">
            {t("plugins.updateAllPersonalHint", { count: personalCount })}
          </p>
        )}
      </div>
      {batchable.length > 0 && (
        <button
          type="button"
          onClick={handleUpdateAll}
          disabled={updating}
          className="inline-flex items-center justify-center gap-1.5 shrink-0 self-start sm:self-auto px-3 py-2 text-[12px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors cursor-pointer disabled:opacity-50"
        >
          {updating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowUpCircle size={14} strokeWidth={1.5} />
          )}
          {updating
            ? t("plugins.updating")
            : personalCount > 0
              ? t("plugins.updateOthers")
              : t("plugins.updateAll")}
        </button>
      )}
    </div>
  );
}
