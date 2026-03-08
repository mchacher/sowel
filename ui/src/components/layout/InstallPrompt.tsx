import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { usePwaInstall } from "../../hooks/usePwaInstall";

export function InstallPrompt() {
  const { t } = useTranslation();
  const { canInstall, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-surface border-t border-border shadow-lg">
      <div className="flex items-center gap-2 text-[13px] text-text">
        <Download size={16} strokeWidth={1.5} className="text-primary shrink-0" />
        <span>{t("app.installBanner")}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setDismissed(true)}
          className="text-[12px] text-text-secondary hover:text-text px-2 py-1 rounded-[6px] hover:bg-border-light transition-colors cursor-pointer"
        >
          {t("app.notNow")}
        </button>
        <button
          onClick={install}
          className="text-[12px] font-medium text-white bg-primary hover:bg-primary-hover px-3 py-1.5 rounded-[6px] transition-colors cursor-pointer"
        >
          {t("app.install")}
        </button>
      </div>
    </div>
  );
}
