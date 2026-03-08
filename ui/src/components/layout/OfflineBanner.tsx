import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-accent/10 text-accent text-[13px] font-medium">
      <WifiOff size={14} strokeWidth={1.5} />
      <span>{t("app.offline")}</span>
    </div>
  );
}
