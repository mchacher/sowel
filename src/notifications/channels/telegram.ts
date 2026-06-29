import type { TelegramChannelConfig } from "../../shared/types.js";
import type { NotificationChannel, NotificationContent } from "./channel.js";

// ============================================================
// Telegram — Bot API channel provider
// ============================================================

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramChannel implements NotificationChannel {
  async send(config: unknown, content: NotificationContent): Promise<void> {
    const { botToken, chatId } = config as TelegramChannelConfig;
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    // Telegram is plain text: flatten title + body into one message, keeping
    // the historical "message : value" shape.
    const text = content.body ? `${content.title} : ${content.body}` : content.title;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API error (${res.status}): ${body}`);
    }
  }

  async testConnection(config: unknown): Promise<void> {
    await this.send(config, { title: "Sowel — connexion OK" });
  }
}
