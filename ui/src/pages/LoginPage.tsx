import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../store/useAuth";
import { SowelLogo } from "../components/layout/SowelLogo";

export function LoginPage() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const mfaChallenge = useAuth((s) => s.mfaChallenge);
  const login = useAuth((s) => s.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <SowelLogo size={160} showText animated className="inline-block mb-2" />
        </div>

        {mfaChallenge ? (
          <MfaStep />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface rounded-[10px] border border-border p-6"
          >
            <div className="mb-4">
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1.5">
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

            <div className="mb-5">
              <label className="block text-[12px] text-text-tertiary uppercase tracking-widest mb-1.5">
                {t("auth.password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-[13px] text-error mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-[14px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {t("auth.login")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Spec 151 — second-factor step shown when useAuth.login() sets mfaChallenge. */
function MfaStep() {
  const { t } = useTranslation();
  const verifyMfa = useAuth((s) => s.verifyMfa);
  const cancelMfaChallenge = useAuth((s) => s.cancelMfaChallenge);
  const [code, setCode] = useState("");
  const [isBackupCode, setIsBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verifyMfa(code, { isBackupCode, trustDevice });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.mfa.verifyFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-surface rounded-[10px] border border-border p-6">
      <p className="text-[13px] text-text-secondary mb-4">
        {isBackupCode ? t("auth.mfa.enterBackupCode") : t("auth.mfa.enterCode")}
      </p>

      <div className="mb-3">
        <input
          type="text"
          inputMode={isBackupCode ? "text" : "numeric"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setIsBackupCode(!isBackupCode);
            setCode("");
          }}
          className="mt-1.5 text-[12px] text-primary hover:text-primary-hover cursor-pointer"
        >
          {isBackupCode ? t("auth.mfa.useTotpInstead") : t("auth.mfa.useBackupCodeInstead")}
        </button>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-text-secondary mb-5 cursor-pointer">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
        />
        {t("auth.mfa.trustDevice")}
      </label>

      {error && <p className="text-[13px] text-error mb-4">{error}</p>}

      <button
        type="submit"
        disabled={loading || !code}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-[14px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        {t("auth.mfa.verify")}
      </button>
      <button
        type="button"
        onClick={cancelMfaChallenge}
        className="w-full mt-2 px-4 py-2 text-[13px] text-text-secondary hover:text-text cursor-pointer"
      >
        {t("common.back")}
      </button>
    </form>
  );
}
