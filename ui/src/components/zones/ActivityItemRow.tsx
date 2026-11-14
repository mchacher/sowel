import {
  ChefHat,
  Layers,
  PersonStanding,
  Sunrise,
  Sunset,
  AlertTriangle,
  CircleCheck,
  Circle,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { ActivityItem, ActivityCategory, OrderSource } from "../../types";
import { useRecipes } from "../../store/useRecipes";
import i18n from "../../i18n";
import { alarmSourceLabel, ORDER_OUTCOME_ALARM_SOURCE } from "../../lib/alarm-message";
import { displayValue } from "../../lib/activity-log";
import { formatClockTime } from "../../lib/format";
import { useZoneLabels } from "../../hooks/useZoneLabels";
import type { Translate } from "../../i18n/translate";

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

/**
 * One row of the activity log (spec 196, slice 7c): the time in a right-aligned
 * column, a 20 px dot on the panel's rail, then the text (actor bold, details
 * tertiary). Rendered as a list item of the log.
 */
export function ActivityItemRow({ item }: Props) {
  const { t } = useTranslation();
  const recipeLabel = useRecipeLabel();
  const zones = useZoneLabels();
  // #1184 — an alarm names the room it belongs to; a global one has no zone.
  const alarmZone = item.category === "alarm" && item.zoneId ? zones.get(item.zoneId) : undefined;

  return (
    <li className="grid grid-cols-[44px_20px_minmax(0,1fr)] gap-x-2.5 items-start px-4 py-[5px] text-small leading-5">
      <time
        dateTime={new Date(item.timestamp).toISOString()}
        className="text-caption leading-5 text-text-tertiary tabular-nums text-right"
      >
        {formatClockTime(item.timestamp)}
      </time>
      <CategoryIcon category={item.category} template={item.message.template} />
      <div className="text-text min-w-0 break-words">
        <Message item={item} recipeLabel={recipeLabel} />
        {item.source && (
          <span className="text-text-tertiary">
            {" · "}
            {formatSource(item.source, t, recipeLabel)}
          </span>
        )}
        {alarmZone && (
          <span className="text-text-tertiary" title={alarmZone.path}>
            {" · "}
            {alarmZone.label}
          </span>
        )}
      </div>
    </li>
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
  t: Translate,
  recipeLabel: RecipeLabel,
): Record<string, string | number> {
  const m = item.message;
  // A momentary order (wake, refresh…) shows the action, not its resolved "ON".
  // Otherwise the raw value is shown the way the rest of the UI writes it
  // (spec 196): « Marche / Arrêt », numbers through lib/format, a setpoint in degrees.
  const valueOf = (value: string, alias: string, momentary?: string) =>
    momentary
      ? t(`activity.momentary.${momentary}`, { defaultValue: value })
      : displayValue(value, alias, t);
  switch (m.template) {
    case "order.executed":
      return { ...m.params, value: valueOf(m.params.value, m.params.alias, m.params.momentary) };
    case "order.executed.multi":
      return {
        firstName: m.params.equipmentNames[0],
        count: m.params.count,
        alias: m.params.alias,
        value: valueOf(m.params.value, m.params.alias, m.params.momentary),
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
      return m.params as unknown as Record<string, string | number>;
    case "alarm.raised":
    case "alarm.resolved": {
      const { source, message, messageKey, messageParams } = m.params;
      // Spec 188 — an order-outcome alarm is worded in the viewer's language;
      // a key from any other source, or one this build does not know, is not.
      const keyed =
        source === ORDER_OUTCOME_ALARM_SOURCE &&
        messageKey !== undefined &&
        i18n.exists(messageKey);
      return {
        source: alarmSourceLabel(t, source),
        message: keyed ? t(messageKey, { ...messageParams }) : message,
      };
    }
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
  // A 20 px dot on the rail, the surface colour so the rail stops behind it.
  // Neutral glyphs; only an alarm keeps its role colour (red raised, green
  // cleared), so a fault still stands out in the log.
  const dot = (Ico: typeof Circle, tone = "text-text-secondary") => (
    <span
      className={`relative z-[1] w-5 h-5 rounded-full bg-surface flex items-center justify-center ${tone}`}
    >
      <Ico size={12} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
  switch (category) {
    case "recipe":
      return dot(ChefHat);
    case "mode":
      return dot(Layers);
    case "motion":
      return dot(PersonStanding);
    case "alarm":
      return template === "alarm.resolved"
        ? dot(CircleCheck, "text-success")
        : dot(AlertTriangle, "text-error");
    case "sunlight":
      return dot(template === "sunlight.sunrise" ? Sunrise : Sunset);
    default:
      return dot(Circle);
  }
}

function formatSource(source: OrderSource, t: Translate, recipeLabel: RecipeLabel): string {
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
