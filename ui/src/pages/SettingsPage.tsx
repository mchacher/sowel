import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Settings,
  ArrowUpCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useAuth } from "../store/useAuth";
import { useWebSocket } from "../store/useWebSocket";
import { useTimezone } from "../store/useTimezone";
import { RestartToast } from "../components/system/RestartToast";
import {
  updateMe,
  changeMyPassword,
  getMyTokens,
  createMyToken,
  deleteMyToken,
  getMyMfaStatus,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  regenerateMfaBackupCodes,
  getMyMfaTrustedDevices,
  revokeMyMfaTrustedDevice,
  adminResetUserMfa,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
  getSystemVersion,
  checkSystemVersion,
  triggerSystemUpdate,
} from "../api";
import type { SystemVersionInfo } from "../api";
import { setTheme } from "../theme";
import type { ThemeSetting } from "../theme";
import { copyToClipboard } from "../lib/clipboard";
import type { ApiToken, User, UserRole, MfaStatus, MfaTrustedDevice } from "../types";
import { TariffSettings } from "../components/settings/TariffSettings";
import { ArbiterSettings } from "../components/settings/ArbiterSettings";

type SettingsTab = "general" | "account" | "energy" | "admin";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const user = useAuth((s) => s.user);
  const updatePreferences = useAuth((s) => s.updatePreferences);
  const fetchMe = useAuth((s) => s.fetchMe);
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTab>(isAdmin ? "general" : "account");

  const tabs: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { id: "general", label: t("settings.tabs.general"), adminOnly: true },
    { id: "account", label: t("settings.tabs.account") },
    { id: "energy", label: t("settings.tabs.energy"), adminOnly: true },
    { id: "admin", label: t("settings.tabs.admin"), adminOnly: true },
  ];

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="p-4 sm:p-6">
      {/* Page header + version inline */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <Settings size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1>
            {t("settings.title")}
          </h1>
        </div>
        {isAdmin && <VersionBadge />}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-3 py-2 text-[13px] font-medium transition-colors duration-150
              border-b-2 -mb-px cursor-pointer
              ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-w-[720px]">
        {activeTab === "general" && isAdmin && (
          <div className="space-y-6">
            <HomeSettingsSection />
          </div>
        )}

        {activeTab === "account" && (
          <div className="space-y-6">
            <ProfileSection
              user={user}
              onSave={async (displayName) => {
                await updateMe({ displayName });
                await fetchMe();
              }}
            />
            <PreferencesSection
              language={
                user?.preferences?.language ?? (i18n.language.startsWith("fr") ? "fr" : "en")
              }
              onLanguageChange={async (lang) => {
                i18n.changeLanguage(lang);
                localStorage.setItem("sowel_language", lang);
                if (user) {
                  await updatePreferences({ ...user.preferences, language: lang });
                }
              }}
              theme={
                user?.preferences?.theme ??
                (localStorage.getItem("sowel_theme") as ThemeSetting | null) ??
                "system"
              }
              onThemeChange={async (theme) => {
                setTheme(theme);
                if (user) {
                  await updatePreferences({ ...user.preferences, theme });
                }
              }}
            />
            <ChangePasswordSection />
            <TwoFactorSection />
            <ApiTokensSection />
          </div>
        )}

        {activeTab === "energy" && isAdmin && (
          <div className="space-y-6">
            <TariffSettings />
            <ArbiterSettings />
          </div>
        )}

        {activeTab === "admin" && isAdmin && (
          <div className="space-y-6">
            <UserManagementSection currentUserId={user?.id ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Home Settings (location + sunlight offsets)
// ============================================================

function HomeSettingsSection() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [homeName, setHomeName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [sunriseOffset, setSunriseOffset] = useState("30");
  const [sunsetOffset, setSunsetOffset] = useState("45");
  const [showRestartToast, setShowRestartToast] = useState(false);
  const [initial, setInitial] = useState({
    homeName: "",
    latitude: "",
    longitude: "",
    sunriseOffset: "30",
    sunsetOffset: "45",
  });
  const tz = useTimezone((s) => s.tz);
  const tzSource = useTimezone((s) => s.source);
  const tzLoaded = useTimezone((s) => s.loaded);

  useEffect(() => {
    getSettings()
      .then((all) => {
        const name = all["home.name"] ?? "";
        // Normalize decimal separator: storage uses `.`, but legacy rows
        // may have `,` from older saves. UI inputs are dot-only.
        const lat = (all["home.latitude"] ?? "").replace(",", ".");
        const lon = (all["home.longitude"] ?? "").replace(",", ".");
        const sr = all["home.sunriseOffset"] ?? "30";
        const ss = all["home.sunsetOffset"] ?? "45";
        setHomeName(name);
        setLatitude(lat);
        setLongitude(lon);
        setSunriseOffset(sr);
        setSunsetOffset(ss);
        setInitial({
          homeName: name,
          latitude: lat,
          longitude: lon,
          sunriseOffset: sr,
          sunsetOffset: ss,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const dirty =
    homeName !== initial.homeName ||
    latitude !== initial.latitude ||
    longitude !== initial.longitude ||
    sunriseOffset !== initial.sunriseOffset ||
    sunsetOffset !== initial.sunsetOffset;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        "home.name": homeName,
        "home.latitude": latitude,
        "home.longitude": longitude,
        "home.sunriseOffset": sunriseOffset,
        "home.sunsetOffset": sunsetOffset,
      });
      const locationChanged =
        latitude !== initial.latitude || longitude !== initial.longitude;
      setInitial({ homeName, latitude, longitude, sunriseOffset, sunsetOffset });
      if (locationChanged) {
        setShowRestartToast(true);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="bg-surface rounded-[10px] border border-border p-5">
        <h2 className="text-[14px] font-semibold text-text mb-4">{t("settings.home")}</h2>
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      </section>
    );
  }

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <h2 className="text-[14px] font-semibold text-text mb-1">{t("settings.home")}</h2>
      <p className="text-[12px] text-text-tertiary mb-4">{t("settings.homeDescription")}</p>
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
            {t("settings.homeName")}
          </label>
          <input
            type="text"
            value={homeName}
            onChange={(e) => setHomeName(e.target.value)}
            placeholder={t("settings.homeNamePlaceholder")}
            className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.latitude")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value.replace(",", "."))}
              placeholder="48.8566"
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.longitude")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value.replace(",", "."))}
              placeholder="2.3522"
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.sunriseOffset")}
            </label>
            <input
              type="number"
              value={sunriseOffset}
              onChange={(e) => setSunriseOffset(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
            <p className="text-[11px] text-text-tertiary mt-1">{t("settings.sunriseOffsetHelp")}</p>
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.sunsetOffset")}
            </label>
            <input
              type="number"
              value={sunsetOffset}
              onChange={(e) => setSunsetOffset(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
            <p className="text-[11px] text-text-tertiary mt-1">{t("settings.sunsetOffsetHelp")}</p>
          </div>
        </div>
        {tzLoaded && (
          <div className="pt-3 border-t border-border-light">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.timezone")}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-mono text-text px-2 py-1 bg-background rounded-[6px] border border-border">
                {tz}
              </span>
              <span
                className={`text-[11px] ${
                  tzSource === "fallback" ? "text-warning" : "text-text-tertiary"
                }`}
              >
                {tzSource === "auto" && t("settings.timezoneSourceAuto")}
                {tzSource === "env" && t("settings.timezoneSourceEnv")}
                {tzSource === "fallback" && t("settings.timezoneSourceFallback")}
              </span>
            </div>
          </div>
        )}
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>
      {showRestartToast && <RestartToast onClose={() => setShowRestartToast(false)} />}
    </section>
  );
}

// ============================================================
// Profile
// ============================================================

function ProfileSection({
  user,
  onSave,
}: {
  user: User | null;
  onSave: (displayName: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setDisplayName(user.displayName);
  }, [user]);

  const dirty = displayName !== (user?.displayName ?? "");

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <h2 className="text-[14px] font-semibold text-text mb-4">{t("settings.profile")}</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("auth.username")}
            </label>
            <p className="text-[14px] text-text-secondary">{user?.username}</p>
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.role")}
            </label>
            <p className="text-[14px] text-text-secondary capitalize">{user?.role}</p>
          </div>
        </div>
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
            {t("auth.displayName")}
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
          />
        </div>
        {dirty && (
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(displayName);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>
    </section>
  );
}

// ============================================================
// Preferences
// ============================================================

function PreferencesSection({
  language,
  onLanguageChange,
  theme,
  onThemeChange,
}: {
  language: string;
  onLanguageChange: (lang: "fr" | "en") => Promise<void>;
  theme: ThemeSetting;
  onThemeChange: (theme: ThemeSetting) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <h2 className="text-[14px] font-semibold text-text mb-4">{t("settings.preferences")}</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1.5">
            {t("settings.language")}
          </label>
          <div className="flex gap-2">
            {(["en", "fr"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => onLanguageChange(lang)}
                className={`px-4 py-2 text-[13px] font-medium rounded-[6px] border transition-colors cursor-pointer ${
                  language === lang
                    ? "bg-primary text-white border-primary"
                    : "bg-background text-text-secondary border-border hover:border-primary hover:text-text"
                }`}
              >
                {lang === "en" ? t("settings.languageEn") : t("settings.languageFr")}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1.5">
            {t("settings.theme")}
          </label>
          <div className="flex gap-2">
            {(["light", "system", "dark"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => onThemeChange(opt)}
                className={`px-4 py-2 text-[13px] font-medium rounded-[6px] border transition-colors cursor-pointer ${
                  theme === opt
                    ? "bg-primary text-white border-primary"
                    : "bg-background text-text-secondary border-border hover:border-primary hover:text-text"
                }`}
              >
                {t(`settings.theme${opt.charAt(0).toUpperCase() + opt.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Change Password
// ============================================================

function ChangePasswordSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess(false);
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleSubmit = async () => {
    setError("");
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setSaving(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setSuccess(true);
      reset();
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-text">{t("settings.changePassword")}</h2>
        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              reset();
            }}
            className="text-[13px] text-primary hover:text-primary-hover font-medium cursor-pointer"
          >
            {t("common.edit")}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="relative">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.currentPassword")}
            </label>
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 pr-9 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-2 top-[26px] text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="relative">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.newPassword")}
            </label>
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 pr-9 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2 top-[26px] text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.confirmNewPassword")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
          </div>
          {error && <p className="text-[13px] text-error">{error}</p>}
          {success && <p className="text-[13px] text-success">{t("settings.passwordChanged")}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={saving || !currentPassword || !newPassword || !confirmPassword}
              className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                reset();
              }}
              className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text rounded-[6px] border border-border hover:bg-border-light transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// Version Badge (compact, in header)
// ============================================================

function VersionBadge() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SystemVersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const setUpdateInProgress = useWebSocket((s) => s.setUpdateInProgress);

  useEffect(() => {
    let cancelled = false;
    getSystemVersion()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const handleCheckNow = async () => {
    setError("");
    setChecking(true);
    try {
      const updated = await checkSystemVersion();
      setInfo(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setChecking(false);
    }
  };

  const handleConfirmUpdate = async () => {
    if (!info.updateAvailable) return;
    setError("");
    setUpdating(true);
    try {
      await triggerSystemUpdate();
      // Trigger the global overlay — UpdateOverlay component takes over from here
      setUpdateInProgress(true);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setUpdating(false);
    }
  };

  const canSelfUpdate = info.dockerAvailable && info.composeManaged;
  const updateDisabledReason = !info.dockerAvailable
    ? t("update.dockerUnavailable")
    : !info.composeManaged
      ? t("update.notComposeManaged")
      : "";

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-mono font-semibold text-primary px-2.5 py-1 bg-primary-light rounded-[6px]">
          v{info.current}
        </span>

        {/* Check now button (admin only — VersionBadge is already admin gated) */}
        <button
          onClick={handleCheckNow}
          disabled={checking}
          className="p-1 text-text-tertiary hover:text-text-secondary rounded-[5px] hover:bg-border-light transition-colors cursor-pointer disabled:opacity-50"
          title={t("update.checkNow")}
        >
          {checking ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>

        {info.updateAvailable && info.latest && (
          <>
            {canSelfUpdate ? (
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={updating}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-error hover:bg-error/10 rounded-[5px] transition-colors cursor-pointer disabled:opacity-50"
              >
                {updating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ArrowUpCircle size={12} />
                )}
                v{info.latest}
              </button>
            ) : (
              <a
                href={info.releaseUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-error hover:bg-error/10 rounded-[5px] transition-colors"
                title={updateDisabledReason}
              >
                <ArrowUpCircle size={12} />
                v{info.latest}
                <ExternalLink size={10} />
              </a>
            )}
          </>
        )}
      </div>

      {/* Confirm update modal */}
      {confirmOpen && info.latest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !updating && setConfirmOpen(false)}
        >
          <div
            className="bg-surface rounded-[14px] border border-border p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-semibold text-text mb-2">
              {t("update.confirmTitle", { version: info.latest })}
            </h3>
            <p className="text-[13px] text-text-secondary mb-2">
              {t("update.confirmMessage", {
                current: info.current,
                latest: info.latest,
              })}
            </p>
            <p className="text-[12px] text-text-tertiary mb-4">
              {t("update.confirmAutoBackup")}
            </p>
            {error && (
              <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-[6px]">
                <p className="text-[13px] text-error">{error}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={updating}
                className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirmUpdate}
                disabled={updating}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-error text-white rounded-[6px] hover:bg-error/80 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {updating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUpCircle size={14} />
                )}
                {t("update.confirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// Two-Factor Authentication (spec 151)
// ============================================================

function BackupCodesDisplay({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopyAll = async () => {
    setCopyFailed(false);
    const succeeded = await copyToClipboard(codes.join("\n"));
    if (succeeded) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  };

  return (
    <div className="p-3 bg-success/10 border border-success/30 rounded-[6px]">
      <p className="text-[12px] text-success mb-2">{t("settings.mfa.backupCodesShownOnce")}</p>
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {codes.map((code) => (
          <code
            key={code}
            className="text-[12px] font-mono bg-background px-2 py-1 rounded border border-border text-center"
          >
            {code}
          </code>
        ))}
      </div>
      <button
        onClick={handleCopyAll}
        className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text cursor-pointer"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {t("settings.mfa.copyAllCodes")}
      </button>
      {copyFailed && (
        <p className="text-[11px] text-error mt-1">{t("settings.mfa.copyFailed")}</p>
      )}
    </div>
  );
}

/** Re-auth challenge (password + a live TOTP/backup code) shared by disable and regenerate. */
function MfaReauthModal({
  title,
  submitLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  onConfirm: (password: string, code: string, isBackupCode: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isBackupCode, setIsBackupCode] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setSubmitting(true);
    try {
      await onConfirm(password, code, isBackupCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-surface rounded-[14px] border border-border p-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold text-text mb-4">{title}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.currentPassword")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {isBackupCode ? t("settings.mfa.backupCode") : t("settings.mfa.totpCode")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setIsBackupCode(!isBackupCode)}
              className="mt-1 text-[12px] text-primary hover:text-primary-hover cursor-pointer"
            >
              {isBackupCode
                ? t("settings.mfa.useTotpInstead")
                : t("settings.mfa.useBackupCodeInstead")}
            </button>
          </div>
        </div>

        {error && <p className="text-[13px] text-error mt-3">{error}</p>}

        <div className="flex gap-2 justify-end mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !password || !code}
            className={`px-4 py-2 text-[13px] font-medium text-white rounded-[6px] transition-colors disabled:opacity-50 cursor-pointer ${
              danger ? "bg-error hover:bg-error/80" : "bg-primary hover:bg-primary-hover"
            }`}
          >
            {submitting ? t("common.saving") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MfaEnrollModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"loading" | "scan" | "codes">("loading");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    beginMfaEnrollment()
      .then((setup) => {
        setQrCodeDataUrl(setup.qrCodeDataUrl);
        setSecret(setup.secret);
        setStep("scan");
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("common.error")));
  }, [t]);

  const handleConfirm = async () => {
    setError("");
    setSubmitting(true);
    try {
      const result = await confirmMfaEnrollment(code);
      setBackupCodes(result.backupCodes);
      setStep("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface rounded-[14px] border border-border p-6 max-w-sm w-full">
        <h3 className="text-[16px] font-semibold text-text mb-4">{t("settings.mfa.enableTitle")}</h3>

        {step === "loading" && <Loader2 size={20} className="animate-spin text-text-tertiary" />}

        {step === "scan" && (
          <div className="space-y-3">
            <p className="text-[13px] text-text-secondary">{t("settings.mfa.scanInstructions")}</p>
            {qrCodeDataUrl && (
              <img
                src={qrCodeDataUrl}
                alt={t("settings.mfa.qrAlt")}
                className="mx-auto rounded-[6px] border border-border"
                width={200}
                height={200}
              />
            )}
            <details className="text-[12px] text-text-tertiary">
              <summary className="cursor-pointer">{t("settings.mfa.cantScan")}</summary>
              <code className="block mt-1 font-mono break-all bg-background px-2 py-1 rounded border border-border">
                {secret}
              </code>
            </details>
            <div>
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
                {t("settings.mfa.totpCode")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              />
            </div>
            {error && <p className="text-[13px] text-error">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting || !code}
                className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? t("common.saving") : t("common.next")}
              </button>
            </div>
          </div>
        )}

        {step === "codes" && (
          <div className="space-y-3">
            <BackupCodesDisplay codes={backupCodes} />
            <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              {t("settings.mfa.savedCodesAck")}
            </label>
            <div className="flex justify-end pt-1">
              <button
                onClick={onDone}
                disabled={!acknowledged}
                className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TwoFactorSection() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const updatePreferences = useAuth((s) => s.updatePreferences);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [devices, setDevices] = useState<MfaTrustedDevice[]>([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null);
  const [trustDays, setTrustDays] = useState(user?.preferences?.mfaTrustedDeviceDays ?? 30);

  const load = async () => {
    try {
      const [s, d] = await Promise.all([getMyMfaStatus(), getMyMfaTrustedDevices()]);
      setStatus(s);
      setDevices(d);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyMfaStatus(), getMyMfaTrustedDevices()])
      .then(([s, d]) => {
        if (cancelled) return;
        setStatus(s);
        setDevices(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTrustDaysBlur = async () => {
    if (!user) return;
    const clamped = Math.min(90, Math.max(1, Math.round(trustDays) || 30));
    setTrustDays(clamped);
    if (clamped === (user.preferences?.mfaTrustedDeviceDays ?? 30)) return;
    await updatePreferences({ ...user.preferences, mfaTrustedDeviceDays: clamped });
  };

  const handleRevokeDevice = async (id: string) => {
    await revokeMyMfaTrustedDevice(id);
    await load();
  };

  if (!status) {
    return (
      <section className="bg-surface rounded-[10px] border border-border p-5">
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      </section>
    );
  }

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[14px] font-semibold text-text flex items-center gap-2">
          <ShieldCheck size={16} className="text-text-tertiary" />
          {t("settings.mfa.title")}
        </h2>
        {status.enabled ? (
          <button
            onClick={() => setShowDisable(true)}
            className="text-[13px] text-error hover:text-error/80 font-medium cursor-pointer"
          >
            {t("common.disable")}
          </button>
        ) : (
          <button
            onClick={() => setShowEnroll(true)}
            className="text-[13px] text-primary hover:text-primary-hover font-medium cursor-pointer"
          >
            {t("common.enable")}
          </button>
        )}
      </div>

      {!status.enabled && <p className="text-[13px] text-text-tertiary">{t("settings.mfa.disabledHint")}</p>}

      {status.enabled && (
        <div className="mt-3 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-text-secondary">
              {t("settings.mfa.backupCodesRemaining", { count: status.backupCodesRemaining })}
            </p>
            <button
              onClick={() => setShowRegenerate(true)}
              className="text-[12px] text-primary hover:text-primary-hover font-medium cursor-pointer"
            >
              {t("settings.mfa.regenerateCodes")}
            </button>
          </div>
          {status.backupCodesRemaining <= 2 && (
            <p className="text-[12px] text-error">{t("settings.mfa.lowBackupCodesWarning")}</p>
          )}

          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("settings.mfa.trustedDeviceDuration")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={90}
                value={trustDays}
                onChange={(e) => setTrustDays(Number(e.target.value))}
                onBlur={handleTrustDaysBlur}
                className="w-20 px-3 py-1.5 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              />
              <span className="text-[13px] text-text-tertiary">{t("settings.mfa.days")}</span>
            </div>
          </div>

          <div>
            <p className="text-[12px] text-text-tertiary uppercase tracking-widest mb-1.5">
              {t("settings.mfa.trustedDevices")}
            </p>
            {devices.length === 0 ? (
              <p className="text-[13px] text-text-tertiary">{t("settings.mfa.noTrustedDevices")}</p>
            ) : (
              <div className="space-y-2">
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between py-2 px-3 bg-background rounded-[6px] border border-border"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Smartphone size={14} className="text-text-tertiary shrink-0" />
                      <span className="text-[13px] text-text truncate">
                        {device.userAgent ?? t("settings.mfa.unknownDevice")}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRevokeDevice(device.id)}
                      className="text-[12px] text-error hover:text-error/80 font-medium cursor-pointer shrink-0 ml-2"
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showEnroll && (
        <MfaEnrollModal
          onDone={() => {
            setShowEnroll(false);
            load();
          }}
          onClose={() => setShowEnroll(false)}
        />
      )}

      {showDisable && (
        <MfaReauthModal
          title={t("settings.mfa.disableTitle")}
          submitLabel={t("common.disable")}
          danger
          onClose={() => setShowDisable(false)}
          onConfirm={async (password, code, isBackupCode) => {
            await disableMfa(password, code, isBackupCode);
            setShowDisable(false);
            await load();
          }}
        />
      )}

      {showRegenerate && !regeneratedCodes && (
        <MfaReauthModal
          title={t("settings.mfa.regenerateTitle")}
          submitLabel={t("settings.mfa.regenerateCodes")}
          onClose={() => setShowRegenerate(false)}
          onConfirm={async (password, code, isBackupCode) => {
            const result = await regenerateMfaBackupCodes(password, code, isBackupCode);
            setRegeneratedCodes(result.backupCodes);
          }}
        />
      )}

      {showRegenerate && regeneratedCodes && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setShowRegenerate(false);
            setRegeneratedCodes(null);
            load();
          }}
        >
          <div
            className="bg-surface rounded-[14px] border border-border p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-semibold text-text mb-4">
              {t("settings.mfa.regenerateTitle")}
            </h3>
            <BackupCodesDisplay codes={regeneratedCodes} />
            <div className="flex justify-end pt-4">
              <button
                onClick={() => {
                  setShowRegenerate(false);
                  setRegeneratedCodes(null);
                  load();
                }}
                className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors cursor-pointer"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// API Tokens
// ============================================================

function ApiTokensSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const data = await getMyTokens();
      setTokens(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!tokenName.trim()) return;
    setCreating(true);
    try {
      const result = await createMyToken(tokenName.trim());
      setNewTokenValue(result.token);
      setTokenName("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    await deleteMyToken(id);
    await load();
  };

  const handleCopy = async (text: string) => {
    const succeeded = await copyToClipboard(text);
    if (succeeded) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <h2 className="text-[14px] font-semibold text-text mb-4">{t("settings.apiTokens")}</h2>

      {newTokenValue && (
        <div className="mb-4 p-3 bg-success/10 border border-success/30 rounded-[6px]">
          <p className="text-[12px] text-success mb-2">{t("settings.tokenCreated")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono bg-background px-2 py-1 rounded border border-border break-all">
              {newTokenValue}
            </code>
            <button
              onClick={() => handleCopy(newTokenValue)}
              className="p-1.5 text-text-secondary hover:text-text rounded cursor-pointer"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder={t("settings.tokenName")}
          className="flex-1 px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={creating || !tokenName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          <Plus size={14} />
          {t("settings.createToken")}
        </button>
      </div>

      {loading ? (
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      ) : tokens.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">{t("settings.noTokens")}</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between py-2 px-3 bg-background rounded-[6px] border border-border"
            >
              <div>
                <span className="text-[13px] font-medium text-text">{token.name}</span>
                <span className="text-[11px] text-text-tertiary ml-2">
                  {t("settings.lastUsed")}:{" "}
                  {token.lastUsedAt
                    ? new Date(token.lastUsedAt).toLocaleDateString()
                    : t("settings.never")}
                </span>
              </div>
              <button
                onClick={() => handleRevoke(token.id)}
                className="text-[12px] text-error hover:text-error/80 font-medium cursor-pointer"
              >
                {t("settings.revokeToken")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// User Management (admin only)
// ============================================================

function UserManagementSection({ currentUserId }: { currentUserId: string }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("standard");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const data = await getUsers();
      setUsers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setError("");
    if (!newUsername || !newDisplayName || !newPassword) return;
    setCreating(true);
    try {
      await createUser({
        username: newUsername,
        displayName: newDisplayName,
        password: newPassword,
        role: newRole,
      });
      setShowAdd(false);
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole("standard");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleEnabled = async (u: User) => {
    await updateUser(u.id, { enabled: !u.enabled });
    await load();
  };

  const handleChangeRole = async (u: User, role: UserRole) => {
    await updateUser(u.id, { role });
    await load();
  };

  const handleDelete = async (u: User) => {
    if (u.id === currentUserId) return;
    if (!confirm(t("settings.deleteUserConfirm", { name: u.displayName }))) return;
    await deleteUser(u.id);
    await load();
  };

  // Spec 151 FR6 — admin-assisted MFA reset for a locked-out user.
  const handleResetMfa = async (u: User) => {
    if (!confirm(t("settings.mfa.adminResetConfirm", { name: u.displayName }))) return;
    await adminResetUserMfa(u.id);
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-semibold text-text">{t("settings.userManagement")}</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 text-[13px] text-primary hover:text-primary-hover font-medium cursor-pointer"
        >
          <Plus size={14} />
          {t("settings.addUser")}
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 bg-background rounded-[8px] border border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
                {t("auth.username")}
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
                {t("auth.displayName")}
              </label>
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
                {t("auth.password")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1">
                {t("settings.role")}
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
              >
                <option value="standard">standard</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>
          {error && <p className="text-[13px] text-error">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newUsername || !newDisplayName || !newPassword}
              className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {creating ? t("common.creating") : t("common.create")}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text rounded-[6px] border border-border hover:bg-border-light transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between py-2 px-3 bg-background rounded-[6px] border border-border"
            >
              <div className="flex items-center gap-3">
                <div>
                  <span className="text-[13px] font-medium text-text">{u.displayName}</span>
                  <span className="text-[11px] text-text-tertiary ml-1.5">@{u.username}</span>
                </div>
                <select
                  value={u.role}
                  onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                  className="text-[11px] px-2 py-0.5 bg-surface border border-border rounded text-text-secondary"
                  disabled={u.id === currentUserId}
                >
                  <option value="standard">standard</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  onClick={() => handleToggleEnabled(u)}
                  disabled={u.id === currentUserId}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium cursor-pointer ${
                    u.enabled ? "bg-success/10 text-success" : "bg-error/10 text-error"
                  } ${u.id === currentUserId ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {u.enabled ? t("settings.enabled") : t("common.disabled")}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleResetMfa(u)}
                  className="p-1.5 text-text-tertiary hover:text-text rounded cursor-pointer"
                  title={t("settings.mfa.adminResetTitle")}
                >
                  <ShieldCheck size={14} />
                </button>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => handleDelete(u)}
                    className="p-1.5 text-text-tertiary hover:text-error rounded cursor-pointer"
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
