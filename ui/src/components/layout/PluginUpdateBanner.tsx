import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpCircle, X } from "lucide-react";
import { getPlugins } from "../../api";

export function PluginUpdateBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [updateCount, setUpdateCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getPlugins()
      .then((plugins) => {
        const count = plugins.filter((p) => p.latestVersion).length;
        setUpdateCount(count);
      })
      .catch(() => {
        // ignore
      });
  }, []);

  if (updateCount === 0 || dismissed) return null;

  return (
    <div className="bg-accent/10 border-b border-accent/20 px-4 py-1.5 flex items-center justify-center gap-2">
      <button
        onClick={() => navigate("/plugins")}
        className="flex items-center gap-2 text-[12px] font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
      >
        <ArrowUpCircle size={14} />
        {t("plugins.updatesAvailable", { count: updateCount })}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-0.5 text-accent/50 hover:text-accent transition-colors cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}
