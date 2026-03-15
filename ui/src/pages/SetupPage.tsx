import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../store/useAuth";
import { SowelLogo } from "../components/layout/SowelLogo";

export function SetupPage() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const setupRequired = useAuth((s) => s.setupRequired);
  const setup = useAuth((s) => s.setup);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  if (setupRequired === false) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }

    setLoading(true);
    try {
      await setup({ username, password, displayName });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.setupFailed"));
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <SowelLogo size={160} showText animated className="inline-block mb-2" />
          <p className="text-[13px] text-text-secondary mt-2">
            {t("auth.setupTitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface rounded-[10px] border border-border p-6">
          <div className="mb-4">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
              {t("auth.username")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
              {t("auth.displayName")}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              autoComplete="name"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
              {t("auth.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              autoComplete="new-password"
            />
          </div>

          <div className="mb-5">
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1.5">
              {t("auth.confirmPassword")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p className="text-[13px] text-error mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !displayName || !password || !confirmPassword}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-[14px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t("auth.createAccount")}
          </button>
        </form>
      </div>
    </div>
  );
}
