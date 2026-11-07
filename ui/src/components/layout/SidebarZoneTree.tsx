import { useState, useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ChevronRight, ChevronDown, Home, Layers, DoorOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ZoneWithChildren } from "../../types";
import { useZones } from "../../store/useZones";

export function SidebarZoneTree({
  collapsed,
  activeZoneId,
}: {
  collapsed: boolean;
  /** Highlights a room off its own route: the room of the equipment page shown (spec 196). */
  activeZoneId?: string;
}) {
  const { t } = useTranslation();
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  if (collapsed) return null;

  if (tree.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="text-caption text-text-tertiary leading-tight">
          {t("zones.noZonesSidebar")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((zone) => (
        <SidebarZoneNode key={zone.id} zone={zone} depth={0} activeZoneId={activeZoneId} />
      ))}
    </div>
  );
}

function SidebarZoneNode({
  zone,
  depth,
  activeZoneId,
}: {
  zone: ZoneWithChildren;
  depth: number;
  activeZoneId?: string;
}) {
  const { zoneId: routeZoneId } = useParams();
  const zoneId = routeZoneId ?? activeZoneId;
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = zone.children.length > 0;
  const isActive = zoneId === zone.id;

  // Auto-expand when a child is active
  useEffect(() => {
    if (zoneId && hasZoneInTree(zone, zoneId)) {
      setExpanded(true);
    }
  }, [zoneId, zone]);

  const icon = depth === 0
    ? <Home size={depth === 0 ? 14 : 15} strokeWidth={1.5} />
    : hasChildren
      ? <Layers size={15} strokeWidth={1.5} />
      : <DoorOpen size={15} strokeWidth={1.5} />;

  // Root zones: section header style, always expanded, not collapsable
  if (depth === 0) {
    return (
      <div>
        <NavLink
          to={`/home/${zone.id}`}
          className={({ isActive: linkActive }) => `flex items-center gap-2 px-3 py-1.5 min-w-0 rounded-sm mx-1 group transition-colors duration-150 ${linkActive || isActive ? "bg-primary-light" : ""}`}
        >
          {({ isActive: routeActive }) => {
            const linkActive = routeActive || isActive;
            return (
            <>
              <Home size={14} strokeWidth={1.5} className={`flex-shrink-0 transition-colors ${linkActive ? "text-primary" : "text-text group-hover:text-primary"}`} />
              <span className={`text-body font-medium transition-colors truncate ${linkActive ? "text-primary" : "text-text group-hover:text-primary"}`}>
                {zone.name}
              </span>
            </>
            );
          }}
        </NavLink>

        {hasChildren && (
          <div>
            {zone.children.map((child) => (
              <SidebarZoneNode key={child.id} zone={child} depth={depth + 1} activeZoneId={activeZoneId} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {/* Expand/collapse */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
          className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-sm ${
            hasChildren
              ? "text-text-tertiary hover:text-text-secondary"
              : "text-transparent"
          }`}
        >
          {hasChildren &&
            (expanded ? (
              <ChevronDown size={11} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={11} strokeWidth={1.5} />
            ))}
        </button>

        {/* Zone link */}
        <NavLink
          to={`/home/${zone.id}`}
          className={`
            flex-1 flex items-center gap-2 px-2 py-1.5 rounded-sm min-w-0
            text-small transition-colors duration-150 ease-out
            ${isActive
              ? "bg-primary-light text-primary font-medium"
              : "text-text-secondary hover:bg-border-light hover:text-text"
            }
          `}
        >
          <span className="flex-shrink-0">{icon}</span>
          <span className="truncate">{zone.name}</span>
        </NavLink>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {zone.children.map((child) => (
            <SidebarZoneNode key={child.id} zone={child} depth={depth + 1} activeZoneId={activeZoneId} />
          ))}
        </div>
      )}
    </div>
  );
}

function hasZoneInTree(zone: ZoneWithChildren, targetId: string): boolean {
  if (zone.id === targetId) return true;
  return zone.children.some((child) => hasZoneInTree(child, targetId));
}
