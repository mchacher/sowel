import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getIntegrations } from "../api";
import type { IntegrationInfo } from "../types";
import { IntegrationRow } from "../components/integrations/IntegrationRow";
import { IntegrationDrawer } from "../components/integrations/IntegrationDrawer";
import { TOP_LEVEL_H1 } from "../components/layout/page-title";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [oauthMessage, setOauthMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("oauth_success")) {
      setOauthMessage({ type: "success", text: t("integrations.oauthSuccess") });
      window.history.replaceState({}, "", window.location.pathname);
      load();
      setTimeout(() => setOauthMessage(null), 5000);
    } else if (params.has("oauth_error")) {
      const msg = params.get("oauth_error") ?? t("common.error");
      setOauthMessage({
        type: "error",
        text: `${t("integrations.oauthError")}${t("common.colon")}${msg}`,
      });
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setOauthMessage(null), 7000);
    }
  }, [t, load]);

  const selectedIntegration = integrations.find((i) => i.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="px-4 sm:px-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="lg:mb-5">
        <h1 className={TOP_LEVEL_H1}>{t("integrations.title")}</h1>
      </div>

      {oauthMessage && (
        <div
          className={`mb-4 max-w-[720px] px-4 py-3 rounded-md text-small font-medium ${
            oauthMessage.type === "success"
              ? "bg-success/10 border border-success/20 text-success"
              : "bg-error/10 border border-error/20 text-error"
          }`}
        >
          {oauthMessage.text}
        </div>
      )}

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
