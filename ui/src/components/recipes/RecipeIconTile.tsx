import { useTranslation } from "react-i18next";
import { createElement } from "react";
import { recipeIcon } from "../../lib/recipe-icons";

/**
 * The 32 px icon of a recipe row (spec 198): the recipe's own icon, and a red
 * dot at the top right while an instance is in alarm (the mode-row pattern).
 */
export function RecipeIconTile({
  icon,
  enabled,
  alarm,
  className = "",
}: {
  icon: string | undefined;
  enabled: boolean;
  alarm: boolean;
  /** Grid placement from the caller. */
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`relative w-8 h-8 rounded-md flex items-center justify-center ${enabled ? "bg-primary/10" : "bg-background"} ${className}`}
    >
      {createElement(recipeIcon(icon), {
        size: 16,
        strokeWidth: 1.5,
        "aria-hidden": true,
        className: enabled ? "text-primary" : "text-text-tertiary",
      })}
      {alarm && (
        <span
          className="absolute -top-[3px] -right-[3px] w-2.5 h-2.5 rounded-full bg-error ring-2 ring-surface"
          role="img"
          aria-label={t("recipes.inAlarm")}
          title={t("recipes.inAlarm")}
        />
      )}
    </div>
  );
}
