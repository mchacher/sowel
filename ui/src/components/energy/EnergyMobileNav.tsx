import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Zap, Sun, Activity } from "lucide-react";
import { useEnergy } from "../../store/useEnergy";
import { useUiState } from "../../store/useUiState";

/**
 * Energy sub-page drawer (Live · Consumption · Production).
 * Open state lives in useUiState — the trigger button is in AppLayout's topbar.
 * This component only renders the drawer panel.
 */
export function EnergyMobileNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const hasProduction = useEnergy((s) => s.hasProduction);
  const open = useUiState((s) => s.energyNavOpen);
  const close = useUiState((s) => s.closeEnergyNav);

  if (!hasProduction || !open) return null;

  const items = [
    { to: "/energy/live", label: t("energy.live"), icon: <Activity size={18} strokeWidth={1.5} /> },
    { to: "/energy/consumption", label: t("energy.consumption"), icon: <Zap size={18} strokeWidth={1.5} /> },
    { to: "/energy/production", label: t("energy.production"), icon: <Sun size={18} strokeWidth={1.5} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute top-0 left-0 bottom-0 w-[260px] bg-surface animate-slide-left shadow-xl">
        <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-top, 0px)" }} />
        <div className="px-3 pt-4 pb-4 space-y-1">
          <div className="px-2 pb-3">
            <span className="text-caption font-semibold text-text-secondary">{t("nav.energy")}</span>
          </div>
          {items.map((item) => {
            const active = location.pathname === item.to;
            return (
              <button
                key={item.to}
                onClick={() => { navigate(item.to); close(); }}
                className={`flex items-center gap-3 w-full px-3 py-3 rounded-[10px] transition-colors duration-150 text-left ${
                  active ? "bg-primary-light text-primary" : "text-text hover:bg-border-light"
                }`}
              >
                <span className={active ? "text-primary" : "text-text-secondary"}>{item.icon}</span>
                <span className={`text-body font-medium ${active ? "text-primary" : ""}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
