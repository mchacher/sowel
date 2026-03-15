import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, Zap, Sun } from "lucide-react";
import { useEnergy } from "../../store/useEnergy";

export function EnergyMobileNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const hasProduction = useEnergy((s) => s.hasProduction);
  const [open, setOpen] = useState(false);

  // Only show burger if there are multiple pages
  if (!hasProduction) return null;

  const items = [
    { to: "/energy/consumption", label: t("energy.consumption"), icon: <Zap size={18} strokeWidth={1.5} /> },
    { to: "/energy/production", label: t("energy.production"), icon: <Sun size={18} strokeWidth={1.5} /> },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden p-1 -ml-1 rounded-[6px] text-text-secondary hover:bg-border-light transition-colors"
      >
        <Menu size={18} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          {/* Left drawer — slides in from left */}
          <div className="absolute top-0 left-0 bottom-0 w-[260px] bg-surface animate-slide-left shadow-xl">
            {/* Safe area spacer for iOS PWA */}
            <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-top, 0px)" }} />
            <div className="px-3 pt-4 pb-4 space-y-1">
              <div className="px-2 pb-3">
                <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{t("nav.energy")}</span>
              </div>
              {items.map((item) => {
                const active = location.pathname === item.to;
                return (
                  <button
                    key={item.to}
                    onClick={() => { navigate(item.to); setOpen(false); }}
                    className={`flex items-center gap-3 w-full px-3 py-3 rounded-[10px] transition-colors duration-150 text-left ${
                      active ? "bg-primary-light text-primary" : "text-text hover:bg-border-light"
                    }`}
                  >
                    <span className={active ? "text-primary" : "text-text-secondary"}>{item.icon}</span>
                    <span className={`text-[14px] font-medium ${active ? "text-primary" : ""}`}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
