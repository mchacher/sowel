/**
 * Spec 180 — the page an installed plugin brings into the UI.
 *
 * The plugin ships an ES module; this route imports it and hands it a DOM node
 * plus a context. Deliberately NOT a React component from the plugin: a plugin
 * is built in its own repository, against its own dependencies, and a second
 * React in the page is a class of bug nobody should have to debug. Plain DOM
 * is a contract both sides can keep across versions.
 *
 * What the plugin gets is `api()`, which is the SPA's own authenticated client
 * pointed at `/api/v1/plugins/<id>/page/*` — so the plugin never sees a token
 * and never has to think about the refresh dance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getPluginPages } from "../api";
import { fetchJSON, API_BASE } from "../api/client";
import { loadPluginModule } from "./pluginModuleLoader";

interface PluginPageModule {
  mount?: (container: HTMLElement, ctx: PluginPageContext) => void | Promise<void>;
  unmount?: (container: HTMLElement) => void;
}

export interface PluginPageContext {
  pluginId: string;
  /** Call the plugin's own API. `path` starts with a slash. */
  api: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  /** UI language, e.g. "fr". */
  locale: string;
  /** "dark" while the dark theme is on. */
  theme: "light" | "dark";
  /** Navigate inside Sowel — a plugin page may link to an equipment. */
  navigate: (to: string) => void;
}

type PageState = "loading" | "ready" | "unknown" | "failed";

export function PluginPage(): React.ReactElement {
  const { pluginId = "" } = useParams<{ pluginId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PageState>("loading");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");

  const api = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      if (!path.startsWith("/")) throw new Error("Plugin API path must start with '/'");
      return fetchJSON<T>(`${API_BASE}/plugins/${pluginId}/page${path}`, {
        method: init?.method ?? "GET",
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    },
    [pluginId],
  );

  useEffect(() => {
    let cancelled = false;
    let module: PluginPageModule | null = null;
    const container = containerRef.current;

    setState("loading");
    setDetail("");

    void (async () => {
      try {
        const pages = await getPluginPages();
        const page = pages.find((p) => p.pluginId === pluginId);
        if (cancelled) return;
        if (!page) {
          setState("unknown");
          return;
        }
        setLabel(page.label);

        module = (await loadPluginModule(page.entryUrl)) as PluginPageModule;
        if (cancelled || !container) return;
        if (typeof module.mount !== "function") {
          setDetail("mount()");
          setState("failed");
          return;
        }

        await module.mount(container, {
          pluginId,
          api,
          locale: i18n.language,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          navigate: (to: string) => navigate(to),
        });
        if (!cancelled) setState("ready");
      } catch (err) {
        if (cancelled) return;
        setDetail(err instanceof Error ? err.message : String(err));
        setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (container) module?.unmount?.(container);
      } catch {
        // A plugin that throws on the way out must not break navigation:
        // the container is dropped with the route either way.
      }
      if (container) container.replaceChildren();
    };
  }, [pluginId, api, i18n.language, navigate]);

  return (
    <div className="p-4 sm:p-6">
      {state === "loading" && (
        <div className="flex items-center gap-2 text-text-secondary">
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          <span>{t("pluginPage.loading")}</span>
        </div>
      )}

      {state === "unknown" && (
        <div className="flex items-start gap-2 text-text-secondary">
          <AlertTriangle size={16} strokeWidth={1.5} className="text-warning mt-0.5" />
          <span>{t("pluginPage.unknown", { pluginId })}</span>
        </div>
      )}

      {state === "failed" && (
        <div className="flex items-start gap-2 text-text-secondary">
          <AlertTriangle size={16} strokeWidth={1.5} className="text-error mt-0.5" />
          <div>
            <p>{t("pluginPage.failed", { label: label || pluginId })}</p>
            {detail && <p className="text-xs text-text-tertiary mt-1 font-mono">{detail}</p>}
          </div>
        </div>
      )}

      <div ref={containerRef} hidden={state !== "ready"} data-testid="plugin-page-root" />
    </div>
  );
}
