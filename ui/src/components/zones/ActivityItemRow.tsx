import {
  ChefHat,
  Layers,
  PersonStanding,
  Sun,
  Moon,
  AlertTriangle,
  CircleCheck,
  Circle,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { ActivityItem, ActivityCategory, OrderSource } from "../../types";
import { useRecipes } from "../../store/useRecipes";

/** A recipe's name in the UI language, from its manifest i18n; else the name the server sent. */
type RecipeLabel = (recipeId: string | undefined, fallback: string) => string;

function useRecipeLabel(): RecipeLabel {
  const { i18n } = useTranslation();
  const recipes = useRecipes((s) => s.recipes);
  const lang = (i18n.language ?? "").slice(0, 2);
  return (recipeId, fallback) => {
    const recipe = recipeId ? recipes.find((r) => r.id === recipeId) : undefined;
    return recipe?.i18n?.[lang]?.name ?? fallback;
  };
}

interface Props {
  item: ActivityItem;
}

export function ActivityItemRow({ item }: Props) {
  const { t } = useTranslation();
  const recipeLabel = useRecipeLabel();

  return (
    <div className="grid grid-cols-[24px_1fr_auto] gap-[0.55rem] items-start px-[1.1rem] py-[0.45rem]">
      <CategoryIcon category={item.category} template={item.message.template} />
      <div className="text-[0.78rem] text-text-secondary leading-[1.45] min-w-0 break-words">
        <Message item={item} recipeLabel={recipeLabel} />
        {item.source && (
          <span className="text-[0.68rem] text-text-tertiary ml-[0.15rem] whitespace-nowrap">
            {formatSource(item.source, t, recipeLabel)}
          </span>
        )}
      </div>
      <span className="font-mono text-[0.66rem] text-text-tertiary pt-[4px] leading-none tabular-nums">
        {formatTime(item.timestamp)}
      </span>
    </div>
  );
}

function Message({ item, recipeLabel }: { item: ActivityItem; recipeLabel: RecipeLabel }) {
  const { t } = useTranslation();
  const m = item.message;
  // We render with Trans so <b> formatting works on dynamic bold spans.
  const key = `activity.templates.${m.template}`;
  return (
    <Trans
      t={t}
      i18nKey={key}
      values={interpolation(item, t, recipeLabel)}
      components={{ b: <b className="text-text font-semibold" /> }}
    />
  );
}

function interpolation(
  item: ActivityItem,
  t: (key: string, opts?: Record<string, unknown>) => string,
  recipeLabel: RecipeLabel,
): Record<string, string | number> {
  const m = item.message;
  // A momentary order (wake, refresh…) shows the action, not its resolved "ON".
  const valueOf = (value: string, momentary?: string) =>
    momentary ? t(`activity.momentary.${momentary}`, { defaultValue: value }) : value;
  switch (m.template) {
    case "order.executed":
      return { ...m.params, value: valueOf(m.params.value, m.params.momentary) };
    case "order.executed.multi":
      return {
        firstName: m.params.equipmentNames[0],
        count: m.params.count,
        alias: m.params.alias,
        value: valueOf(m.params.value, m.params.momentary),
      };
    case "recipe.started":
    case "recipe.stopped":
    case "recipe.error":
      return {
        ...(m.params as unknown as Record<string, string | number>),
        recipeName: recipeLabel(m.params.recipeId, m.params.recipeName),
      };
    case "motion.detected":
    case "mode.activated":
    case "mode.deactivated":
    case "alarm.raised":
    case "alarm.resolved":
      return m.params as unknown as Record<string, string | number>;
    case "sunlight.sunrise":
    case "sunlight.sunset":
      return {};
  }
}

function CategoryIcon({
  category,
  template,
}: {
  category: ActivityCategory;
  template: ActivityItem["message"]["template"];
}) {
  // Each variant follows the polished.html .activity__item-icon--<variant> recipe:
  //   24x24, rounded-[4px], svg 12x12, distinctive bg + color
  if (category === "recipe") {
    return (
      <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-[var(--p-50)] text-primary">
        <ChefHat size={12} strokeWidth={2} />
      </div>
    );
  }
  if (category === "mode") {
    return (
      <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-[var(--green-50)] text-[var(--green-700)]">
        <Layers size={12} strokeWidth={2} />
      </div>
    );
  }
  if (category === "motion") {
    return (
      <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-[var(--info-50)] text-[var(--info-500)]">
        <PersonStanding size={12} strokeWidth={2} />
      </div>
    );
  }
  if (category === "alarm") {
    // A resolution is an alarm-category item, but the red triangle would read
    // as a second failure. Green tick, same slot.
    if (template === "alarm.resolved") {
      return (
        <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-[var(--green-50)] text-[var(--green-700)]">
          <CircleCheck size={12} strokeWidth={2} />
        </div>
      );
    }
    return (
      <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-[var(--red-50)] text-[var(--red-500)]">
        <AlertTriangle size={12} strokeWidth={2} />
      </div>
    );
  }
  if (category === "sunlight") {
    const Ico = template === "sunlight.sunrise" ? Sun : Moon;
    return (
      <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-background text-text-tertiary">
        <Ico size={12} strokeWidth={2} />
      </div>
    );
  }
  // category === "order"
  return (
    <div className="w-6 h-6 rounded-[4px] flex items-center justify-center flex-shrink-0 bg-background text-text-tertiary">
      <Circle size={12} strokeWidth={2} />
    </div>
  );
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatSource(
  source: OrderSource,
  t: (key: string, opts?: Record<string, unknown>) => string,
  recipeLabel: RecipeLabel,
): string {
  switch (source.kind) {
    case "recipe":
      return t("activity.source.recipe", {
        recipeName: recipeLabel(source.recipeId, source.recipeName),
      });
    case "mode":
      return t("activity.source.mode", { modeName: source.modeName });
    case "manual":
      return t("activity.source.manual");
    case "button":
      return t("activity.source.button", { buttonLabel: source.buttonLabel ?? source.buttonId });
    case "external":
      return t("activity.source.external", { channel: source.channel });
    case "shared_access":
      return t("activity.source.shared_access", { label: source.label });
  }
}
