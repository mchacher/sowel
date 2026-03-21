import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plug } from "lucide-react";
import { getIntegrations } from "../api";
import type { IntegrationInfo } from "../types";
import { IntegrationRow } from "../components/integrations/IntegrationRow";
import { IntegrationDrawer } from "../components/integrations/IntegrationDrawer";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getIntegrations();
      setIntegrations(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedIntegration = integrations.find((i) => i.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <Plug size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[20px] sm:text-[24px] font-semibold text-text leading-[32px]">
            {t("integrations.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">{t("integrations.subtitle")}</p>
      </div>

      <div className="space-y-2 max-w-[720px]">
        {integrations.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            onOpen={() => setSelectedId(integration.id)}
            onRefresh={load}
          />
        ))}
      </div>

      <IntegrationDrawer
        integration={selectedIntegration}
        onClose={() => setSelectedId(null)}
        onRefresh={load}
      />
    </div>
  );
}
