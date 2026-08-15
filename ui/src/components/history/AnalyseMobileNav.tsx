import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LineChart, Plus } from "lucide-react";
import { useCharts } from "../../store/useCharts";
import { useUiState } from "../../store/useUiState";

/**
 * Analyse saved-charts drawer (mobile).
 *
 * Mirrors `EnergyMobileNav`: opens via the contextual burger in the
 * topbar (wired in `AppLayout.MobileTopbarBurger`), lists the user's
 * saved charts as nav items, plus a "New chart" entry.
 */
export function AnalyseMobileNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const charts = useCharts((s) => s.charts);
  const fetchCharts = useCharts((s) => s.fetchCharts);
  const open = useUiState((s) => s.analyseNavOpen);
  const close = useUiState((s) => s.closeAnalyseNav);

  useEffect(() => {
    if (open) fetchCharts();
  }, [open, fetchCharts]);

  if (!open) return null;

  const goto = (to: string) => {
    navigate(to);
    close();
  };

  const isNewActive = location.pathname === "/analyse";

  // `?new` reaches the empty builder without being bounced to the first saved
  // chart by AnalyseView's default-landing redirect (#498, point 1).
  const NEW_CHART_PATH = "/analyse?new";

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute top-0 left-0 bottom-0 w-[260px] bg-surface animate-slide-left shadow-xl overflow-y-auto">
        <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-top, 0px)" }} />
        <div className="px-3 pt-4 pb-4 space-y-1">
          <div className="px-2 pb-3">
            <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">
              {t("analyse.title")}
            </span>
          </div>

          {/* New chart */}
          <button
            type="button"
            onClick={() => goto(NEW_CHART_PATH)}
            className={`flex items-center gap-3 w-full px-3 py-3 rounded-[10px] transition-colors duration-150 text-left ${
              isNewActive ? "bg-primary-light text-primary" : "text-text hover:bg-border-light"
            }`}
          >
            <span className={isNewActive ? "text-primary" : "text-text-secondary"}>
              <Plus size={18} strokeWidth={1.5} />
            </span>
            <span className={`text-[14px] font-medium ${isNewActive ? "text-primary" : ""}`}>
              {t("analyse.new")}
            </span>
          </button>

          {/* Saved charts */}
          {charts.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-text-tertiary">
              {t("analyse.noSavedCharts")}
            </p>
          ) : (
            charts.map((chart) => {
              const active = location.pathname === `/analyse/${chart.id}`;
              return (
                <button
                  key={chart.id}
                  type="button"
                  onClick={() => goto(`/analyse/${chart.id}`)}
                  className={`flex items-center gap-3 w-full px-3 py-3 rounded-[10px] transition-colors duration-150 text-left ${
                    active ? "bg-primary-light text-primary" : "text-text hover:bg-border-light"
                  }`}
                >
                  <span className={active ? "text-primary" : "text-text-secondary"}>
                    <LineChart size={18} strokeWidth={1.5} />
                  </span>
                  <span className={`text-[14px] font-medium truncate ${active ? "text-primary" : ""}`}>
                    {chart.name}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
