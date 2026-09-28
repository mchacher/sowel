import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import { getSettings, updateSettings } from "../../api";
import { SHARED_ACCESS_SETTING, useSharedAccess } from "../../store/useSharedAccess";
import { Refusal, Switch, btnPrimary, inputCls, labelCls } from "../shared-access/ui";
import { SharedAccessAppSettings } from "./SharedAccessAppSettings";

const BASE_URL = "sharedAccess.publicBaseUrl";
const PATH = "sharedAccess.publicPath";
const DEFAULT_PATH = "/access/";

/**
 * Spec 181 R1 and R5.18 — the opt-in switch (off by default: no page, no card,
 * every route 404), and the public address the invitation links are built on
 * (a base URL and a path, so an alias host rewriting to `/access/` works),
 * and, once on, the name and icon the page takes on a home screen (R5.24).
 */
export function SharedAccessSettings() {
  const { t } = useTranslation();
  const refresh = useSharedAccess((s) => s.refresh);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [path, setPath] = useState(DEFAULT_PATH);
  const [initial, setInitial] = useState({ baseUrl: "", path: DEFAULT_PATH });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((all) => {
        const b = all[BASE_URL] ?? "";
        const p = all[PATH] || DEFAULT_PATH;
        setEnabled(all[SHARED_ACCESS_SETTING] === "true");
        setBaseUrl(b);
        setPath(p);
        setInitial({ baseUrl: b, path: p });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ [SHARED_ACCESS_SETTING]: next ? "true" : "false" });
      setEnabled(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const trimmedUrl = baseUrl.trim();
  const urlInvalid = trimmedUrl !== "" && !/^https?:\/\/[^\s/]+/i.test(trimmedUrl);
  const dirty = baseUrl !== initial.baseUrl || path !== initial.path;

  const saveAddress = async () => {
    if (urlInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const p = path.trim() || DEFAULT_PATH;
      await updateSettings({ [BASE_URL]: trimmedUrl, [PATH]: p });
      setBaseUrl(trimmedUrl);
      setPath(p);
      setInitial({ baseUrl: trimmedUrl, path: p });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h2 className="text-[14px] font-semibold text-text">{t("sharedAccess.title")}</h2>
        {loading ? (
          <Loader2 size={14} className="ml-auto animate-spin text-text-tertiary" />
        ) : (
          <span className="ml-auto">
            <Switch
              checked={enabled}
              disabled={busy}
              label={t("sharedAccess.settings.enable")}
              onChange={(next) => void toggle(next)}
            />
          </span>
        )}
      </div>
      <p className="text-[12px] text-text-tertiary mb-4">{t("sharedAccess.settings.description")}</p>

      {!loading && (
        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="sa-base-url">
              {t("sharedAccess.settings.baseUrl")}
            </label>
            <input
              id="sa-base-url"
              type="url"
              className={`${inputCls} w-full`}
              value={baseUrl}
              placeholder="https://acces.example.org"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-[11px] text-text-tertiary mt-1">{t("sharedAccess.settings.baseUrlHelp")}</p>
            {urlInvalid && <Refusal>{t("sharedAccess.settings.baseUrlInvalid")}</Refusal>}
          </div>
          <div>
            <label className={labelCls} htmlFor="sa-path">
              {t("sharedAccess.settings.path")}
            </label>
            <input
              id="sa-path"
              className={`${inputCls} w-full font-mono`}
              value={path}
              placeholder={DEFAULT_PATH}
              onChange={(e) => setPath(e.target.value)}
            />
            <p className="text-[11px] text-text-tertiary mt-1">{t("sharedAccess.settings.pathHelp")}</p>
          </div>
          {dirty && (
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || urlInvalid}
              onClick={() => void saveAddress()}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          )}
        </div>
      )}
      {!loading && enabled && <SharedAccessAppSettings />}
      {error && <Refusal>{error}</Refusal>}
    </section>
  );
}
