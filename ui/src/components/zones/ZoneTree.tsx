import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Building2, Layers, DoorOpen, Home, ArrowUp, ArrowDown, Plus } from "lucide-react";
import type { ZoneWithChildren } from "../../types";
import { reorderZones } from "../../api";

interface ZoneTreeProps {
  zones: ZoneWithChildren[];
  onReordered?: () => void;
  onAddChild?: (parentId: string) => void;
}

export function ZoneTree({ zones, onReordered, onAddChild }: ZoneTreeProps) {
  if (zones.length === 0) {
    return <EmptyState />;
  }

  const handleMove = async (index: number, direction: "up" | "down") => {
    const ids = zones.map((z) => z.id);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= ids.length) return;
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    await reorderZones(null, ids);
    onReordered?.();
  };

  return (
    <div className="bg-surface rounded-[10px] border border-border overflow-hidden">
      <div className="divide-y divide-border-light">
        {zones.map((zone, index) => (
          <ZoneTreeNode
            key={zone.id}
            zone={zone}
            depth={0}
            index={index}
            siblingCount={zones.length}
            onMove={handleMove}
            onReordered={onReordered}
            onAddChild={onAddChild}
          />
        ))}
      </div>
    </div>
  );
}

interface ZoneTreeNodeProps {
  zone: ZoneWithChildren;
  depth: number;
  index: number;
  siblingCount: number;
  onMove: (index: number, direction: "up" | "down") => void;
  onReordered?: () => void;
  onAddChild?: (parentId: string) => void;
}

function ZoneTreeNode({ zone, depth, index, siblingCount, onMove, onReordered, onAddChild }: ZoneTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const navigate = useNavigate();
  const hasChildren = zone.children.length > 0;
  const childCount = zone.children.length;
  const isFirst = index === 0;
  const isLast = index === siblingCount - 1;

  const handleChildMove = async (childIndex: number, direction: "up" | "down") => {
    const ids = zone.children.map((z) => z.id);
    const newIndex = direction === "up" ? childIndex - 1 : childIndex + 1;
    if (newIndex < 0 || newIndex >= ids.length) return;
    [ids[childIndex], ids[newIndex]] = [ids[newIndex], ids[childIndex]];
    await reorderZones(zone.id, ids);
    onReordered?.();
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-3 hover:bg-primary-light/40 cursor-pointer transition-colors duration-150 group/row"
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
              <Building2 size={18} strokeWidth={1.5} />
            ) : hasChildren ? (
              <Layers size={18} strokeWidth={1.5} />
            ) : (
              <DoorOpen size={18} strokeWidth={1.5} />
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
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          {onAddChild && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddChild(zone.id); }}
              className="p-1 rounded text-text-tertiary hover:text-primary hover:bg-primary-light transition-colors cursor-pointer"
              title="Add sub-zone"
            >
              <Plus size={13} strokeWidth={1.5} />
            </button>
          )}
          {siblingCount > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onMove(index, "up"); }}
                disabled={isFirst}
                className="p-1 rounded text-text-tertiary hover:text-text hover:bg-border-light disabled:opacity-0 transition-colors cursor-pointer"
                title="Move up"
              >
                <ArrowUp size={13} strokeWidth={1.5} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMove(index, "down"); }}
                disabled={isLast}
                className="p-1 rounded text-text-tertiary hover:text-text hover:bg-border-light disabled:opacity-0 transition-colors cursor-pointer"
                title="Move down"
              >
                <ArrowDown size={13} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {zone.children.map((child, childIndex) => (
            <ZoneTreeNode
              key={child.id}
              zone={child}
              depth={depth + 1}
              index={childIndex}
              siblingCount={zone.children.length}
              onMove={handleChildMove}
              onReordered={onReordered}
              onAddChild={onAddChild}
            />
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
        <Home size={28} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">No zones yet</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px]">
        Create your first zone to start building your home topology.
      </p>
    </div>
  );
}
