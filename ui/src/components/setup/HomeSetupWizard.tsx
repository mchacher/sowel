import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Home, Loader2 } from "lucide-react";
import { getSettings, updateSettings, triggerSystemRestart } from "../../api";
import { useAuth } from "../../store/useAuth";
import { SowelLogo } from "../layout/SowelLogo";
import { FIELD_LABEL } from "../ui/text-roles";

/**
 * First-login Home setup wizard. Blocks the app when:
 *   - the user is admin, AND
 *   - `home.name` is empty in settings.
 *
 * Forces the admin to provide home name + latitude + longitude before
 * doing anything else. Configuring these at first login derives the
 * timezone BEFORE any restart-triggering settings change, sidestepping
 * the "Restart required → Update in progress" trap the user hit on a
 * fresh install.
 *
 * Non-admin users are not blocked — they would just see an incomplete
 * home name in the topbar until an admin completes the setup.
 */
export function HomeSetupWizard() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  // null = not yet probed; true/false = settings checked.
  const [required, setRequired] = useState<boolean | null>(null);
  const [homeName, setHomeName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    getSettings()
      .then((all) => {
        if (cancelled) return;
        const name = (all["home.name"] ?? "").trim();
        setRequired(name === "");
      })
      .catch(() => {
        if (cancelled) return;
        // If we cannot read settings, do not block the UI — let the
        // user see the standard error path.
        setRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // For non-admin: skip the wizard entirely (derived, not effect-set).
  if (!isAdmin) return null;
  // Settings not yet probed → render nothing (prevents flash of wizard).
  if (required === null) return null;
  if (!required) return null;

  const lat = Number(latitude);
  const lon = Number(longitude);
  const validName = homeName.trim().length > 0;
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  const canSubmit = validName && validLat && validLon && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        "home.name": homeName.trim(),
        "home.latitude": String(lat),
        "home.longitude": String(lon),
      });
      // Re-read to confirm.
      const all = await getSettings();
      if ((all["home.name"] ?? "").trim() === "") {
        setError(t("setup.home.error.notSaved", "Could not save settings, please retry."));
        setSaving(false);
        return;
      }
      // Auto-trigger the restart so the timezone derived from the new
      // lat/long takes effect immediately. UpdateOverlay takes over from
      // here: WS disconnects when the container goes down, reconnects to
      // the new instance, and the wizard never re-shows because home.name
      // is now set. The user doesn't have to dismiss anything.
      try {
        await triggerSystemRestart();
      } catch {
        // If the restart endpoint fails (e.g. running without Docker
        // socket), just dismiss the wizard — the user will see the
        // "Restart required" toast in Settings later.
        setRequired(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface rounded-lg max-w-md w-full p-6 my-auto shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <SowelLogo size={32} />
          <div className="min-w-0">
            <h1 className="text-title font-semibold text-text leading-tight">
              {t("setup.home.title", "Bienvenue sur Sowel")}
            </h1>
            <p className="text-caption text-text-tertiary mt-0.5">
              {t("setup.home.subtitle", "Une dernière étape avant de commencer")}
            </p>
          </div>
        </div>

        <p className="text-small text-text-secondary mb-5">
          {t(
            "setup.home.body",
            "Indiquez le nom et la position de votre maison. Sowel s'en sert pour calculer le lever et le coucher du soleil et pour déterminer votre fuseau horaire.",
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={FIELD_LABEL}>
              <Home size={12} className="inline mr-1 -mt-0.5" />
              {t("setup.home.name", "Nom de la maison")}
            </label>
            <input
              type="text"
              value={homeName}
              onChange={(e) => setHomeName(e.target.value)}
              placeholder={t("setup.home.namePlaceholder", "Ma maison, Studio Paris...")}
              className="w-full px-3 py-2 text-body bg-background border border-border rounded-sm text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD_LABEL}>
                {t("setup.home.latitude", "Latitude")}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value.replace(",", "."))}
                placeholder="48.8566"
                className="w-full px-3 py-2 text-body bg-background border border-border rounded-sm text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>
                {t("setup.home.longitude", "Longitude")}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value.replace(",", "."))}
                placeholder="2.3522"
                className="w-full px-3 py-2 text-body bg-background border border-border rounded-sm text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
                required
              />
            </div>
          </div>

          <p className="text-caption text-text-tertiary">
            {t(
              "setup.home.hint",
              "Astuce: ouvrez Google Maps sur l'emplacement de votre maison, clic droit → les deux nombres affichés sont la latitude et la longitude.",
            )}
          </p>

          {error && (
            <div className="text-caption text-error bg-error/10 px-3 py-2 rounded-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full px-4 py-2.5 text-body font-semibold text-white bg-primary-fill hover:bg-primary-fill-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-sm transition-colors inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("setup.home.submit", "Continuer")}
          </button>
        </form>
      </div>
    </div>
  );
}
