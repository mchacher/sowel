import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { fetchJSON, API_BASE } from "../../api/client";
import { usePluginPages } from "../layout/usePluginPages";
import { PluginPageIcon } from "../layout/PluginPageIcon";
import { pluginPagePath } from "../layout/plugin-page-nav";
import type { EquipmentWithDetails, PluginPageInfo } from "../../types";

interface LinkLine {
  text?: string;
  action?: string;
}

/**
 * Spec 180 R1.6.ter — a card per plugin page that asked to be linked from this
 * equipment's type. The sentence and the link's words are the plugin's, asked
 * of its own page tree; the core only draws them. A plugin that does not answer
 * still gets its card, with its page's label and a plain link.
 * Admin-only, like the pages themselves — the caller gates the mount.
 */
export function PluginEquipmentLinks({ equipment }: { equipment: EquipmentWithDetails }) {
  const pages = usePluginPages(true).filter((page) => page.equipmentTypes?.includes(equipment.type));
  if (!pages.length) return null;
  return (
    <>
      {pages.map((page) => (
        <PluginEquipmentLinkCard key={page.pluginId} page={page} equipmentId={equipment.id} />
      ))}
    </>
  );
}

function PluginEquipmentLinkCard({ page, equipmentId }: { page: PluginPageInfo; equipmentId: string }) {
  const { t, i18n } = useTranslation();
  const [line, setLine] = useState<LinkLine>({});

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ equipmentId, lang: i18n.language });
    fetchJSON<LinkLine>(`${API_BASE}/plugins/${page.pluginId}/page/equipment-link?${query}`)
      .then((answer) => {
        if (!cancelled) setLine(answer ?? {});
      })
      .catch(() => {
        // Silence is a plain link, not an error on somebody's equipment page.
        if (!cancelled) setLine({});
      });
    return () => {
      cancelled = true;
    };
  }, [page.pluginId, equipmentId, i18n.language]);

  return (
    <div className="bg-surface rounded-[10px] border border-border mb-6 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-text-tertiary">
          <PluginPageIcon name={page.icon} size={16} />
        </span>
        <h3 className="text-[14px] font-semibold text-text">{page.label}</h3>
        <Link
          to={`${pluginPagePath(page.pluginId)}?${new URLSearchParams({ equipment: equipmentId })}`}
          className="ml-auto flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          {line.action || t("equipments.pluginLink.open")}
          <ArrowRight size={14} strokeWidth={1.5} />
        </Link>
      </div>
      {line.text && <p className="text-[12px] text-text-tertiary">{line.text}</p>}
    </div>
  );
}
