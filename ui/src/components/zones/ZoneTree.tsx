import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Map, Layers, FolderOpen } from "lucide-react";
import type { ZoneWithChildren } from "../../types";

interface ZoneTreeProps {
  zones: ZoneWithChildren[];
}

export function ZoneTree({ zones }: ZoneTreeProps) {
  if (zones.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="bg-surface rounded-[10px] border border-border overflow-hidden">
      <div className="divide-y divide-border-light">
        {zones.map((zone) => (
          <ZoneTreeNode key={zone.id} zone={zone} depth={0} />
        ))}
      </div>
    </div>
  );
}

function ZoneTreeNode({ zone, depth }: { zone: ZoneWithChildren; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const navigate = useNavigate();
  const hasChildren = zone.children.length > 0;
  const childCount = zone.children.length;
  const groupCount = zone.groups.length;

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-3 hover:bg-primary-light/40 cursor-pointer transition-colors duration-150"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded ${
            hasChildren
              ? "text-text-secondary hover:text-text hover:bg-border-light"
              : "text-transparent"
          }`}
        >
          {hasChildren &&
            (expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} />
            ))}
        </button>

        {/* Zone info — clickable to navigate */}
        <div
          className="flex-1 flex items-center gap-3 min-w-0"
          onClick={() => navigate(`/zones/${zone.id}`)}
        >
          <span className="flex-shrink-0 text-text-secondary">
            {depth === 0 ? (
              <Map size={18} strokeWidth={1.5} />
            ) : hasChildren ? (
              <Layers size={18} strokeWidth={1.5} />
            ) : (
              <FolderOpen size={18} strokeWidth={1.5} />
            )}
          </span>

          <div className="flex-1 min-w-0">
            <span className="text-[14px] font-medium text-text truncate block">
              {zone.name}
            </span>
            {zone.description && (
              <span className="text-[12px] text-text-tertiary truncate block">
                {zone.description}
              </span>
            )}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {childCount > 0 && (
              <span className="text-[11px] text-text-tertiary bg-border-light px-2 py-0.5 rounded-full">
                {childCount} zone{childCount > 1 ? "s" : ""}
              </span>
            )}
            {groupCount > 0 && (
              <span className="text-[11px] text-text-tertiary bg-border-light px-2 py-0.5 rounded-full">
                {groupCount} group{groupCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {zone.children.map((child) => (
            <ZoneTreeNode key={child.id} zone={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
        <Map size={28} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">No zones yet</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px]">
        Create your first zone to start building your home topology.
      </p>
    </div>
  );
}
