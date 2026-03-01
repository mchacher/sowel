import { useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { useCharts } from "../../store/useCharts";

export function SidebarChartList({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const charts = useCharts((s) => s.charts);
  const fetchCharts = useCharts((s) => s.fetchCharts);
  const { chartId: activeId } = useParams();

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  if (collapsed) return null;

  if (charts.length === 0) {
    return (
      <div className="pl-2 px-3 py-2">
        <p className="text-[11px] text-text-tertiary leading-tight">
          {t("analyse.noSavedCharts")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 pl-2">
      {charts.map((chart) => {
        const isActive = activeId === chart.id;
        return (
          <NavLink
            key={chart.id}
            to={`/analyse/${chart.id}`}
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
              <LineChart size={15} strokeWidth={1.5} />
            </span>
            <span className="truncate">{chart.name}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
