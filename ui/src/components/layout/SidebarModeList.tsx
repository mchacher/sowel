import { useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToggleRight, ToggleLeft } from "lucide-react";
import { useModes } from "../../store/useModes";

export function SidebarModeList({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);
  const { id: activeId } = useParams();

  useEffect(() => {
    fetchModes();
  }, [fetchModes]);

  if (collapsed) return null;

  if (modes.length === 0) {
    return (
      <div className="pl-2 px-3 py-2">
        <p className="text-[11px] text-text-tertiary leading-tight">
          {t("modes.noModes")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 pl-2">
      {modes.map((mode) => {
        const isActive = activeId === mode.id;
        return (
          <NavLink
            key={mode.id}
            to={`/modes/${mode.id}`}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-[6px] min-w-0
              text-[13px] transition-colors duration-150 ease-out
              ${isActive
                ? "bg-primary-light text-primary font-medium"
                : "text-text-secondary hover:bg-border-light hover:text-text"
              }
            `}
          >
            <span className="flex-shrink-0">
              {mode.active ? (
                <ToggleRight size={15} strokeWidth={1.5} className="text-primary" />
              ) : (
                <ToggleLeft size={15} strokeWidth={1.5} className="text-text-tertiary" />
              )}
            </span>
            <span className="truncate">{mode.name}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
