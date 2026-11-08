import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useZones } from "../store/useZones";
import { useAuth } from "../store/useAuth";
import { ZoneTree } from "../components/zones/ZoneTree";
import { ZoneForm, flattenZoneTree } from "../components/zones/ZoneForm";
import { Home, Loader2, Plus } from "lucide-react";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { PageHeader, PageHeaderButton } from "../components/layout/PageHeader";

export function ZonesPage() {
  useWsSubscription(["zones"]);
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const tree = useZones((s) => s.tree);
  const loading = useZones((s) => s.loading);
  const error = useZones((s) => s.error);
  const fetchZones = useZones((s) => s.fetchZones);
  const createZone = useZones((s) => s.createZone);
  const [showForm, setShowForm] = useState(false);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const zoneCount = countZones(tree);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={t("zones.title")}
        subtitle={zoneCount === 0 ? undefined : t("zones.count", { count: zoneCount })}
        actions={
          <>
            {isAdmin && (
              <PageHeaderButton
                icon={Plus}
                label={t("zones.addZone")}
                onClick={() => {
                  setDefaultParentId(null);
                  setShowForm(true);
                }}
              />
            )}

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-sm bg-primary-light text-primary">
              <Home size={16} strokeWidth={1.5} />
              <span className="text-small font-medium">{zoneCount}</span>
            </div>
          </>
        }
      />

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <ZoneTree
          zones={tree}
          onReordered={() => fetchZones()}
          onAddChild={(parentId) => {
            setDefaultParentId(parentId);
            setShowForm(true);
          }}
        />
      )}

      {/* Create zone modal */}
      {showForm && (
        <ZoneForm
          title={t("zones.createZone")}
          parentZones={flattenZoneTree(tree)}
          defaultParentId={defaultParentId}
          onSubmit={async (data) => {
            await createZone(data);
          }}
          onClose={() => {
            setShowForm(false);
            setDefaultParentId(null);
          }}
        />
      )}
    </div>
  );
}

function countZones(zones: { children?: { children?: unknown[] }[] }[]): number {
  let count = zones.length;
  for (const zone of zones) {
    if (zone.children) {
      count += countZones(zone.children as typeof zones);
    }
  }
  return count;
}

function ErrorState({ error }: { error: string }) {
  const { t } = useTranslation();
  const fetchZones = useZones((s) => s.fetchZones);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Home size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-lead font-medium text-text mb-1">{t("zones.error.title")}</h3>
      <p className="text-small text-text-secondary max-w-[320px] mb-4">{error}</p>
      <button
        onClick={() => fetchZones()}
        className="px-4 py-2 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover transition-colors duration-150 ease-out"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
