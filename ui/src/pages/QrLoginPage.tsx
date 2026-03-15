import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../store/useAuth";
import { SowelLogo } from "../components/layout/SowelLogo";

export function QrLoginPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loginWithToken = useAuth((s) => s.loginWithToken);
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const token = searchParams.get("token");
  const invalidMessage = useMemo(() => (!token ? t("qrLogin.invalidToken") : null), [token, t]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function authenticate() {
      try {
        await loginWithToken(token!);
        if (!cancelled) {
          navigate("/dashboard", { replace: true });
        }
      } catch {
        if (!cancelled) {
          setError(t("qrLogin.invalidToken"));
        }
      }
    }

    authenticate();

    return () => {
      cancelled = true;
    };
  }, [token, loginWithToken, navigate, t]);

  // If already authenticated (token was valid), redirect
  useEffect(() => {
    if (isAuthenticated && !error) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, error, navigate]);

  const displayError = invalidMessage ?? error;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-6 p-8">
        <SowelLogo size={160} showText animated />

        {displayError ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-error">
              <AlertCircle size={18} strokeWidth={1.5} />
              <span className="text-[14px]">{displayError}</span>
            </div>
            <Link
              to="/login"
              className="text-[13px] text-primary hover:text-primary-hover underline"
            >
              {t("qrLogin.goToLogin")}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 size={18} strokeWidth={1.5} className="animate-spin" />
            <span className="text-[14px]">{t("qrLogin.connecting")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
