import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the web-push library before importing the channel.
const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
  },
}));

import { WebPushChannel } from "./web-push.js";
import type { PushSubscriptionManager } from "../push-subscription-manager.js";
import type { VapidKeys } from "../vapid.js";
import type { PushSubscription } from "../../shared/types.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("silent").logger;
const vapid: VapidKeys = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" };

function sub(endpoint: string): PushSubscription {
  return {
    id: endpoint,
    userId: "u1",
    endpoint,
    p256dh: "p",
    auth: "a",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function createMockManager(subs: PushSubscription[]) {
  return {
    listAll: vi.fn(() => subs),
    deleteByEndpoint: vi.fn(),
  } as unknown as PushSubscriptionManager;
}

describe("WebPushChannel", () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it("sends a JSON payload to every stored subscription", async () => {
    const subs = [sub("https://push/1"), sub("https://push/2")];
    const mgr = createMockManager(subs);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.send({}, { title: "Garage door open", body: "29/06/2026 18:30" });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [pushSub, payload, options] = sendNotification.mock.calls[0];
    expect(pushSub).toEqual({
      endpoint: "https://push/1",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(payload as string)).toEqual({
      title: "Garage door open",
      body: "29/06/2026 18:30",
    });
    expect((options as { vapidDetails: VapidKeys }).vapidDetails).toEqual({
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    });
  });

  it("does nothing when there are no subscriptions", async () => {
    const mgr = createMockManager([]);
    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.send({}, { title: "Hi" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("prunes a subscription on 410 Gone", async () => {
    const mgr = createMockManager([sub("https://push/dead")]);
    sendNotification.mockRejectedValue({ statusCode: 410 });

    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.send({}, { title: "Hi" });

    expect(mgr.deleteByEndpoint).toHaveBeenCalledWith("https://push/dead");
  });

  it("prunes a subscription on 404 Not Found", async () => {
    const mgr = createMockManager([sub("https://push/gone")]);
    sendNotification.mockRejectedValue({ statusCode: 404 });

    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.send({}, { title: "Hi" });

    expect(mgr.deleteByEndpoint).toHaveBeenCalledWith("https://push/gone");
  });

  it("does not prune on a transient error and keeps delivering to others", async () => {
    const mgr = createMockManager([sub("https://push/1"), sub("https://push/2")]);
    sendNotification
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce({ statusCode: 201 });

    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.send({}, { title: "Hi" });

    expect(mgr.deleteByEndpoint).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("testConnection delivers a real test push to every subscription", async () => {
    const mgr = createMockManager([sub("https://push/1"), sub("https://push/2")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const channel = new WebPushChannel(mgr, vapid, logger);
    await channel.testConnection({});

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string).title).toMatch(/test/i);
  });

  it("testConnection rejects when no device is subscribed", async () => {
    const channel = new WebPushChannel(createMockManager([]), vapid, logger);
    await expect(channel.testConnection({})).rejects.toThrow(/subscription/i);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("testConnection rejects when VAPID keys are missing", async () => {
    const channel = new WebPushChannel(
      createMockManager([sub("https://push/1")]),
      { publicKey: "", privateKey: "", subject: "" },
      logger,
    );
    await expect(channel.testConnection({})).rejects.toThrow(/VAPID/);
  });
});
