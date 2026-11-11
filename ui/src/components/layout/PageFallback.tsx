import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * What a lazy-loaded page shows while its chunk arrives (#1187). Inside the
 * layout, so the top bar and navigation stay put. Usually on screen for a few
 * hundred milliseconds, the first time a page is visited.
 */
export function PageFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center py-16" role="status" aria-label={t("common.loading")}>
      <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-text-tertiary" />
    </div>
  );
}
