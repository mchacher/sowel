import { useTranslation } from "react-i18next";
import type {
  NotificationChannelType,
  NotificationChannelConfig,
  TelegramChannelConfig,
  WebPushChannelConfig,
} from "../../types";

// Generic notification-channel descriptors (issue #457 step 2). A notification
// publisher rests on common concepts — a name, a channel, and mappings — and
// only the channel's *config* differs (Telegram needs a bot token + chat id,
// Web Push needs nothing). Each channel is described once here; the form renders
// its config fields from the descriptor, so adding a channel (ntfy, a webhook,
// ...) is a new entry, not new form code. The field renderer lives in
// notification-channels.tsx (ChannelConfigFields).

export interface ChannelFieldSpec {
  /** Key inside the flat config record and the channelConfig object. */
  key: string;
  labelKey: string;
  inputType: "text" | "password";
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
}

export interface NotificationChannelSpec {
  type: NotificationChannelType;
  /** Short label for the publisher card badge (literal, matches the pre-refactor
   *  hard-coded badge). */
  label: string;
  /** Optional longer i18n label for the channel picker option (e.g. "Web Push
   *  (this app)"); falls back to `label` when absent. */
  optionLabelKey?: string;
  /** Config fields, empty for channels that need no config (Web Push). */
  fields: ChannelFieldSpec[];
  /** Optional hint shown when there are no fields. */
  hintKey?: string;
  /** Build the persisted channelConfig from the flat field record. */
  toConfig: (values: Record<string, string>) => NotificationChannelConfig;
  /** Read the flat field record from an existing channelConfig. */
  fromConfig: (config: NotificationChannelConfig | undefined) => Record<string, string>;
}

export const NOTIFICATION_CHANNELS: NotificationChannelSpec[] = [
  {
    type: "web-push",
    label: "Web Push",
    optionLabelKey: "notifPublishers.webPush",
    fields: [],
    hintKey: "notifPublishers.webPushHint",
    toConfig: () => ({}) as WebPushChannelConfig,
    fromConfig: () => ({}),
  },
  {
    type: "telegram",
    label: "Telegram",
    fields: [
      {
        key: "botToken",
        labelKey: "notifPublishers.botToken",
        inputType: "password",
        placeholder: "123456:ABC-DEF...",
        mono: true,
        required: true,
      },
      {
        key: "chatId",
        labelKey: "notifPublishers.chatId",
        inputType: "text",
        placeholder: "-1001234567890",
        mono: true,
        required: true,
      },
    ],
    toConfig: (v) =>
      ({
        botToken: (v.botToken ?? "").trim(),
        chatId: (v.chatId ?? "").trim(),
      }) as TelegramChannelConfig,
    fromConfig: (config) => {
      const tg = config as TelegramChannelConfig | undefined;
      return { botToken: tg?.botToken ?? "", chatId: tg?.chatId ?? "" };
    },
  },
];

export function channelSpec(type: NotificationChannelType): NotificationChannelSpec {
  return NOTIFICATION_CHANNELS.find((c) => c.type === type) ?? NOTIFICATION_CHANNELS[0];
}

/** Are all required fields of the channel filled? */
export function channelConfigComplete(
  spec: NotificationChannelSpec,
  values: Record<string, string>,
): boolean {
  return spec.fields.every((f) => !f.required || !!(values[f.key] ?? "").trim());
}

/** The channel's short badge label (matches the pre-refactor card badge). */
export function channelLabel(type: NotificationChannelType): string {
  return channelSpec(type).label;
}

/** Hook form for components that render the badge inside JSX. */
export function useChannelLabel(): (type: NotificationChannelType) => string {
  return channelLabel;
}

/** The channel picker option label: the longer i18n form when set, else the
 *  short badge label (matches the pre-refactor `<select>` options). */
export function useChannelOptionLabel(): (spec: NotificationChannelSpec) => string {
  const { t } = useTranslation();
  return (spec) => (spec.optionLabelKey ? t(spec.optionLabelKey) : spec.label);
}
