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
    "alarms.orderOutcome.superseded": "{{equipment}}: alarm cleared by a later order",
    "alarms.orderOutcome.notConfirmedTimeout":
      "{{equipment}}: order {{alias}} → {{value}} not confirmed (no state change within {{seconds}} s)",
    "alarms.orderOutcome.notConfirmedOffline":
      "{{equipment}}: order {{alias}} → {{value}} not confirmed (device offline)",
    "alarms.orderOutcome.notConfirmedUnreachable":
      "{{equipment}}: order {{alias}} → {{value}} not confirmed (integration unreachable)",
    "alarms.orderOutcome.notConfirmedFault":
      "{{equipment}}: order {{alias}} → {{value}} not confirmed (device reported a fault)",
    "alarms.orderOutcome.notConfirmedFaultDetail":
      "{{equipment}}: order {{alias}} → {{value}} not confirmed (device reported a fault: {{detail}})",
  },
  fr: {
    "alarms.orderOutcome.unconfirmed": "{{equipment}}\u202f: commande non confirmée par son état",
    "alarms.orderOutcome.unconfirmedNoMovement":
      "{{equipment}}\u202f: pas de mouvement après la commande — perdue ou portail bloqué",
    "alarms.orderOutcome.unconfirmedStillOpen":
      "{{equipment}}\u202f: toujours ouvert après la commande — perdue ou arrêtée en route",
    "alarms.orderOutcome.fault": "{{equipment}}\u202f: défaut",
    "alarms.orderOutcome.faultBottom": "{{equipment}}\u202f: défaut (contact bas)",
    "alarms.orderOutcome.faultWiring": "{{equipment}}\u202f: défaut (câblage)",
    "alarms.orderOutcome.faultDetail": "{{equipment}}\u202f: défaut ({{detail}})",
    "alarms.orderOutcome.recovered": "{{equipment}}\u202f: l'état attendu est finalement arrivé",
    "alarms.orderOutcome.superseded": "{{equipment}}\u202f: alarme levée par une commande suivante",
    "alarms.orderOutcome.notConfirmedTimeout":
      "{{equipment}}\u202f: commande {{alias}} → {{value}} non confirmée (aucun changement d'état en {{seconds}}\u202fs)",
    "alarms.orderOutcome.notConfirmedOffline":
      "{{equipment}}\u202f: commande {{alias}} → {{value}} non confirmée (appareil hors ligne)",
    "alarms.orderOutcome.notConfirmedUnreachable":
      "{{equipment}}\u202f: commande {{alias}} → {{value}} non confirmée (intégration injoignable)",
    "alarms.orderOutcome.notConfirmedFault":
      "{{equipment}}\u202f: commande {{alias}} → {{value}} non confirmée (l'appareil signale un défaut)",
    "alarms.orderOutcome.notConfirmedFaultDetail":
      "{{equipment}}\u202f: commande {{alias}} → {{value}} non confirmée (l'appareil signale un défaut\u202f: {{detail}})",
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
