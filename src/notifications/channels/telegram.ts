import type { TelegramChannelConfig } from "../../shared/types.js";
import type { NotificationChannel } from "./channel.js";

// ============================================================
// Telegram — Bot API channel provider
// ============================================================

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramChannel implements NotificationChannel {
  async send(config: unknown, text: string): Promise<void> {
    const { botToken, chatId } = config as TelegramChannelConfig;
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

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
    await this.send(config, "Sowel — connexion OK");
  }
}
