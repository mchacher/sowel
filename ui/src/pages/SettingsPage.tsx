import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2, Copy, Check, Eye, EyeOff, Settings } from "lucide-react";
import { useAuth } from "../store/useAuth";
import {
  updateMe,
  changeMyPassword,
  getMyTokens,
  createMyToken,
  deleteMyToken,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
} from "../api";
import { setTheme } from "../theme";
import type { ThemeSetting } from "../theme";
import type { ApiToken, User, UserRole } from "../types";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const user = useAuth((s) => s.user);
  const updatePreferences = useAuth((s) => s.updatePreferences);
  const fetchMe = useAuth((s) => s.fetchMe);
  const isAdmin = user?.role === "admin";

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <Settings size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("settings.title")}
          </h1>
        </div>
      </div>

      {/* Two-column grid on desktop, single column on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Home + Profile + Preferences + Password */}
        <div className="space-y-6">
          {isAdmin && <HomeSettingsSection />}
          <ProfileSection user={user} onSave={async (displayName) => {
            await updateMe({ displayName });
            await fetchMe();
          }} />

          <PreferencesSection
            language={user?.preferences?.language ?? (i18n.language.startsWith("fr") ? "fr" : "en")}
            onLanguageChange={async (lang) => {
              i18n.changeLanguage(lang);
              localStorage.setItem("winch_language", lang);
              if (user) {
                await updatePreferences({ ...user.preferences, language: lang });
              }
            }}
            theme={user?.preferences?.theme ?? (localStorage.getItem("winch_theme") as ThemeSetting | null) ?? "system"}
            onThemeChange={async (theme) => {
              setTheme(theme);
              if (user) {
                await updatePreferences({ ...user.preferences, theme });
              }
            }}
          />

          <ChangePasswordSection />
        </div>

        {/* Right column: API Tokens + User Management + Backup */}
        <div className="space-y-6">
          <ApiTokensSection />
          {isAdmin && <UserManagementSection currentUserId={user?.id ?? ""} />}
        </div>
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
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [sunriseOffset, setSunriseOffset] = useState("30");
  const [sunsetOffset, setSunsetOffset] = useState("45");
  const [initial, setInitial] = useState({ latitude: "", longitude: "", sunriseOffset: "30", sunsetOffset: "45" });

  useEffect(() => {
    getSettings().then((all) => {
      const lat = all["home.latitude"] ?? "";
      const lon = all["home.longitude"] ?? "";
      const sr = all["home.sunriseOffset"] ?? "30";
      const ss = all["home.sunsetOffset"] ?? "45";
      setLatitude(lat);
      setLongitude(lon);
      setSunriseOffset(sr);
      setSunsetOffset(ss);
      setInitial({ latitude: lat, longitude: lon, sunriseOffset: sr, sunsetOffset: ss });
    }).finally(() => setLoading(false));
  }, []);

  const dirty = latitude !== initial.latitude || longitude !== initial.longitude
    || sunriseOffset !== initial.sunriseOffset || sunsetOffset !== initial.sunsetOffset;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        "home.latitude": latitude,
        "home.longitude": longitude,
        "home.sunriseOffset": sunriseOffset,
        "home.sunsetOffset": sunsetOffset,
      });
      setInitial({ latitude, longitude, sunriseOffset, sunsetOffset });
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("settings.latitude")}
            </label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="48.8566"
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("settings.longitude")}
            </label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="2.3522"
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
    </section>
  );
}

// ============================================================
// Profile
// ============================================================

function ProfileSection({ user, onSave }: { user: User | null; onSave: (displayName: string) => Promise<void> }) {
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
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("auth.username")}
            </label>
            <p className="text-[14px] text-text-secondary">{user?.username}</p>
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("settings.role")}
            </label>
            <p className="text-[14px] text-text-secondary capitalize">{user?.role}</p>
          </div>
        </div>
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
              try { await onSave(displayName); } finally { setSaving(false); }
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

function PreferencesSection({ language, onLanguageChange, theme, onThemeChange }: {
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
          <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
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
          <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
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
      setTimeout(() => { setOpen(false); setSuccess(false); }, 2000);
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
            onClick={() => { setOpen(true); reset(); }}
            className="text-[13px] text-primary hover:text-primary-hover font-medium cursor-pointer"
          >
            {t("common.edit")}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="relative">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
              onClick={() => { setOpen(false); reset(); }}
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
      // Ignore — tokens will remain empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            <div key={token.id} className="flex items-center justify-between py-2 px-3 bg-background rounded-[6px] border border-border">
              <div>
                <span className="text-[13px] font-medium text-text">{token.name}</span>
                <span className="text-[11px] text-text-tertiary ml-2">
                  {t("settings.lastUsed")}: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : t("settings.never")}
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
      // Ignore — users will remain empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError("");
    if (!newUsername || !newDisplayName || !newPassword) return;
    setCreating(true);
    try {
      await createUser({ username: newUsername, displayName: newDisplayName, password: newPassword, role: newRole });
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
              <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
              <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
              <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
              <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
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
            <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-background rounded-[6px] border border-border">
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
                    u.enabled
                      ? "bg-success/10 text-success"
                      : "bg-error/10 text-error"
                  } ${u.id === currentUserId ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {u.enabled ? t("settings.enabled") : t("common.disabled")}
                </button>
              </div>
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
          ))}
        </div>
      )}
    </section>
  );
}

