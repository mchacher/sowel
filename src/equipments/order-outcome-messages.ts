// ============================================================
// Spec 188 O6 — the wording of an order-outcome alarm, server side.
//
// The UI words these alarms itself from `messageKey` / `messageParams`, in the
// viewer's language. A push has no viewer: the server words it, for each
// recipient, in that user's language preference. This is the server's copy of
// the UI's `alarms.orderOutcome.*` strings; a test keeps the two identical.
// ============================================================

export type MessageLanguage = "en" | "fr";

export const ORDER_OUTCOME_ALARM_MESSAGES: Record<MessageLanguage, Record<string, string>> = {
  en: {
    "alarms.orderOutcome.unconfirmed": "{{equipment}}: order not confirmed by its state",
    "alarms.orderOutcome.unconfirmedNoMovement":
      "{{equipment}}: no movement after the command — lost or gate blocked",
    "alarms.orderOutcome.unconfirmedStillOpen":
      "{{equipment}}: still open after the command — lost or stopped on the way",
    "alarms.orderOutcome.fault": "{{equipment}}: fault",
    "alarms.orderOutcome.faultBottom": "{{equipment}}: fault (bottom contact)",
    "alarms.orderOutcome.faultWiring": "{{equipment}}: fault (wiring)",
    "alarms.orderOutcome.faultDetail": "{{equipment}}: fault ({{detail}})",
    "alarms.orderOutcome.recovered": "{{equipment}}: the expected state arrived after all",
  },
  fr: {
    "alarms.orderOutcome.unconfirmed": "{{equipment}} : commande non confirmée par son état",
    "alarms.orderOutcome.unconfirmedNoMovement":
      "{{equipment}} : pas de mouvement après la commande — perdue ou portail bloqué",
    "alarms.orderOutcome.unconfirmedStillOpen":
      "{{equipment}} : toujours ouvert après la commande — perdue ou arrêtée en route",
    "alarms.orderOutcome.fault": "{{equipment}} : défaut",
    "alarms.orderOutcome.faultBottom": "{{equipment}} : défaut (contact bas)",
    "alarms.orderOutcome.faultWiring": "{{equipment}} : défaut (câblage)",
    "alarms.orderOutcome.faultDetail": "{{equipment}} : défaut ({{detail}})",
    "alarms.orderOutcome.recovered": "{{equipment}} : l'état attendu est finalement arrivé",
  },
};

/** The alarm source whose `messageKey` is honoured (spec 188, #13). */
export const ORDER_OUTCOME_ALARM_SOURCE = "order-confirmation";

/**
 * The text of an order-outcome alarm in one language, or null for a key this
 * catalogue does not hold (the caller then keeps the event's own `message`).
 */
export function wordOrderOutcomeAlarm(
  key: string,
  params: Record<string, string | number> | undefined,
  language: MessageLanguage,
): string | null {
  const template = ORDER_OUTCOME_ALARM_MESSAGES[language][key];
  if (template === undefined) return null;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    params && params[name] !== undefined ? String(params[name]) : whole,
  );
}
