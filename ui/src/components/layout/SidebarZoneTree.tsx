import { useState, useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ChevronRight, ChevronDown, Building2, Layers, DoorOpen } from "lucide-react";
import type { ZoneWithChildren } from "../../types";
import { useZones } from "../../store/useZones";

export function SidebarZoneTree({ collapsed }: { collapsed: boolean }) {
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  if (collapsed) return null;

  if (tree.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="text-[11px] text-text-tertiary leading-tight">
          No zones yet. Create zones in Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((zone) => (
        <SidebarZoneNode key={zone.id} zone={zone} depth={0} />
      ))}
    </div>
  );
}

function SidebarZoneNode({ zone, depth }: { zone: ZoneWithChildren; depth: number }) {
  const { zoneId } = useParams();
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
    ? <Building2 size={15} strokeWidth={1.5} />
    : hasChildren
      ? <Layers size={15} strokeWidth={1.5} />
      : <DoorOpen size={15} strokeWidth={1.5} />;

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
          className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded ${
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
          to={`/maison/${zone.id}`}
          className={`
            flex-1 flex items-center gap-2 px-2 py-1.5 rounded-[6px] min-w-0
            text-[13px] transition-colors duration-150 ease-out
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
            <SidebarZoneNode key={child.id} zone={child} depth={depth + 1} />
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
