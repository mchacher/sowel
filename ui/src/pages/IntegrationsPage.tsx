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
  const [oauthMessage, setOauthMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
      setOauthMessage({ type: "error", text: `${t("integrations.oauthError")}: ${msg}` });
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setOauthMessage(null), 7000);
    }
  }, [t, load]);

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

      {oauthMessage && (
        <div
          className={`mb-4 max-w-[720px] px-4 py-3 rounded-[8px] text-[13px] font-medium ${
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
