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
  /** Literal label, or an i18n key resolved with t(). Exactly one is set. */
  label?: string;
  labelKey?: string;
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
    labelKey: "notifPublishers.webPush",
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

/** The channel's display label (literal or translated). */
export function useChannelLabel(): (type: NotificationChannelType) => string {
  const { t } = useTranslation();
  return (type) => {
    const spec = channelSpec(type);
    return spec.label ?? (spec.labelKey ? t(spec.labelKey) : type);
  };
}
