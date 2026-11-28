import { useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToggleRight, ToggleLeft } from "lucide-react";
import { useModes } from "../../store/useModes";
import { groupModes } from "../../lib/mode-groups";
import type { ModeWithDetails } from "../../types";

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
        <p className="text-caption text-text-tertiary leading-tight">{t("modes.noModes")}</p>
      </div>
    );
  }

  // Spec 219 — grouped modes under their group's name, a radio for their
  // state; then the ungrouped ones under « Others ». No group, no labels.
  const { groups, others } = groupModes(modes);
  const link = (mode: ModeWithDetails, grouped: boolean) => {
    const isActive = activeId === mode.id;
    return (
      <NavLink
        key={mode.id}
        to={`/modes/${mode.id}`}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-sm min-w-0
          text-small transition-colors duration-150 ease-out
          ${
            isActive
              ? "bg-primary-light text-primary font-medium"
              : "text-text-secondary hover:bg-border-light hover:text-text"
          }
        `}
      >
        <span className="flex-shrink-0 w-[15px] flex justify-center">
          {grouped ? (
            <span
              aria-hidden="true"
              className={`relative w-3.5 h-3.5 rounded-full border-[1.5px] ${
                mode.active ? "border-primary" : "border-text-tertiary"
              }`}
            >
              {mode.active && <span className="absolute inset-[2px] rounded-full bg-primary" />}
            </span>
          ) : mode.active ? (
            <ToggleRight size={15} strokeWidth={1.5} className="text-primary" />
          ) : (
            <ToggleLeft size={15} strokeWidth={1.5} className="text-text-tertiary" />
          )}
        </span>
        <span className="truncate">{mode.name}</span>
        {mode.active && <span className="sr-only">{t("modes.active")}</span>}
      </NavLink>
    );
  };
  const label = (text: string) => (
    <div className="px-3 pt-2 pb-0.5 text-micro font-medium text-text-tertiary truncate">
      {text}
    </div>
  );

  return (
    <div className="space-y-0.5 pl-2">
      {groups.map((group) => (
        <div key={group.name} className="space-y-0.5">
          {label(group.name)}
          {group.modes.map((mode) => link(mode, true))}
        </div>
      ))}
      {groups.length > 0 && others.length > 0 && label(t("modes.otherModesShort"))}
      {others.map((mode) => link(mode, false))}
    </div>
  );
}
