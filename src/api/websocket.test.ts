import { describe, it, expect } from "vitest";
import {
  extractWsToken,
  isWsOriginAllowed,
  isAdminOnlyEvent,
  resolveSubscribedTopics,
  canReceiveEvent,
  redactForRole,
  REDACTED_FOR_ROLE,
} from "./websocket.js";
import type { EngineEvent } from "../shared/types.js";

// The role/topic helpers only read `event.type`, so a minimal cast is enough.
const ev = (type: string): EngineEvent => ({ type }) as unknown as EngineEvent;

describe("websocket auth helpers", () => {
  describe("extractWsToken", () => {
    it("returns the bearer token from the Authorization header", () => {
      expect(extractWsToken("Bearer abc.def.ghi", undefined)).toBe("abc.def.ghi");
    });

    it("returns null on missing or malformed Authorization header", () => {
      expect(extractWsToken(undefined, undefined)).toBeNull();
      expect(extractWsToken("", undefined)).toBeNull();
      expect(extractWsToken("Basic dXNlcjpwYXNz", undefined)).toBeNull();
    });

    it("returns the token from a single `bearer.<token>` subprotocol", () => {
      expect(extractWsToken(undefined, "bearer.swl_123abc")).toBe("swl_123abc");
    });

    it("preserves dots inside JWT tokens (splits only on first `bearer.` prefix)", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
      expect(extractWsToken(undefined, `bearer.${jwt}`)).toBe(jwt);
    });

    it("finds the bearer protocol among other comma-separated subprotocols", () => {
      expect(extractWsToken(undefined, "echo, bearer.swl_x, chat")).toBe("swl_x");
    });

    it("handles array-form subprotocol header", () => {
      expect(extractWsToken(undefined, ["echo", "bearer.swl_y"])).toBe("swl_y");
    });

    it("prefers the Authorization header over the subprotocol", () => {
      expect(extractWsToken("Bearer from-header", "bearer.from-subprotocol")).toBe("from-header");
    });

    it("returns null when no bearer protocol is present", () => {
      expect(extractWsToken(undefined, "echo, chat")).toBeNull();
      expect(extractWsToken(undefined, "")).toBeNull();
    });

    it("returns null on `bearer.` with empty token", () => {
      expect(extractWsToken(undefined, "bearer.")).toBeNull();
    });
  });

  describe("isWsOriginAllowed", () => {
    const corsOrigins = ["http://localhost:3000", "https://sowel.exemple.com"];

    it("allows requests with no Origin header (non-browser clients)", () => {
      expect(isWsOriginAllowed(undefined, corsOrigins)).toBe(true);
    });

    it("allows whitelisted origins", () => {
      expect(isWsOriginAllowed("http://localhost:3000", corsOrigins)).toBe(true);
      expect(isWsOriginAllowed("https://sowel.exemple.com", corsOrigins)).toBe(true);
    });

    it("refuses unknown origins", () => {
      expect(isWsOriginAllowed("https://evil.tld", corsOrigins)).toBe(false);
      expect(isWsOriginAllowed("http://localhost:9999", corsOrigins)).toBe(false);
    });

    it("allows everything when wildcard is in the list (user explicit opt-in)", () => {
      expect(isWsOriginAllowed("https://anything.tld", ["*"])).toBe(true);
      expect(isWsOriginAllowed("http://localhost:3000", ["*", "http://localhost:3000"])).toBe(true);
    });

    it("handles array-form origin header by checking the first value", () => {
      expect(isWsOriginAllowed(["http://localhost:3000", "spoofed"], corsOrigins)).toBe(true);
      expect(isWsOriginAllowed(["https://evil.tld"], corsOrigins)).toBe(false);
    });

    it("allows same-origin requests (Origin host matches Host header)", () => {
      // LAN deployment: user opens http://domopi.local:3001, browser sends
      // Origin: http://domopi.local:3001 and Host: domopi.local:3001.
      // Even though domopi.local:3001 is not in CORS_ORIGINS, same-origin is allowed.
      expect(isWsOriginAllowed("http://domopi.local:3001", corsOrigins, "domopi.local:3001")).toBe(
        true,
      );
      expect(isWsOriginAllowed("https://sowel.exemple.com", corsOrigins, "sowel.exemple.com")).toBe(
        true,
      );
    });

    it("refuses cross-origin requests (Origin host does NOT match Host header)", () => {
      // Cross-site request: page on evil.tld tries to open a WS to sowel.exemple.com.
      // Origin host (evil.tld) does not match Host header (sowel.exemple.com).
      expect(isWsOriginAllowed("https://evil.tld", corsOrigins, "sowel.exemple.com")).toBe(false);
    });

    it("tolerates a malformed Origin URL by falling through to deny", () => {
      expect(isWsOriginAllowed("not-a-url", corsOrigins, "domopi.local:3001")).toBe(false);
    });
  });
});

describe("websocket role authorization (S01)", () => {
  describe("isAdminOnlyEvent", () => {
    it("flags events routed to an admin-only topic (mqtt-publishers carries broker passwords)", () => {
      expect(isAdminOnlyEvent(ev("mqtt-broker.updated"))).toBe(true);
      expect(isAdminOnlyEvent(ev("mqtt-broker.created"))).toBe(true);
      expect(isAdminOnlyEvent(ev("mqtt-publisher.created"))).toBe(true);
    });

    it("flags notification-publisher events even though they route to the shared `system` topic", () => {
      expect(isAdminOnlyEvent(ev("notification-publisher.updated"))).toBe(true);
      expect(isAdminOnlyEvent(ev("notification-publisher.created"))).toBe(true);
    });

    it("does not flag ordinary data events", () => {
      expect(isAdminOnlyEvent(ev("device.data.updated"))).toBe(false);
      expect(isAdminOnlyEvent(ev("equipment.data.changed"))).toBe(false);
      expect(isAdminOnlyEvent(ev("zone.data.changed"))).toBe(false);
      expect(isAdminOnlyEvent(ev("energy.arbiter.status"))).toBe(false);
    });
  });

  describe("resolveSubscribedTopics", () => {
    it("always includes `system`", () => {
      expect(resolveSubscribedTopics([], "standard").has("system")).toBe(true);
      expect(resolveSubscribedTopics([], "admin").has("system")).toBe(true);
    });

    it("grants admin-only topics to admins", () => {
      const topics = resolveSubscribedTopics(["logs", "mqtt-publishers", "devices"], "admin");
      expect([...topics].sort()).toEqual(["devices", "logs", "mqtt-publishers", "system"]);
    });

    it("drops admin-only topics for non-admins but keeps the rest", () => {
      const topics = resolveSubscribedTopics(["logs", "mqtt-publishers", "devices"], "standard");
      expect([...topics].sort()).toEqual(["devices", "system"]);
    });

    it("ignores unknown topics", () => {
      const topics = resolveSubscribedTopics(["devices", "bogus"], "admin");
      expect([...topics].sort()).toEqual(["devices", "system"]);
    });
  });

  describe("canReceiveEvent", () => {
    it("delivers ordinary events to a subscribed non-admin", () => {
      expect(
        canReceiveEvent(ev("device.data.updated"), {
          role: "standard",
          topics: new Set(["system", "devices"]),
        }),
      ).toBe(true);
    });

    it("does not deliver events for topics a client is not subscribed to", () => {
      expect(
        canReceiveEvent(ev("zone.data.changed"), {
          role: "standard",
          topics: new Set(["system", "devices"]),
        }),
      ).toBe(false);
    });

    it("hides notification-publisher secrets from a non-admin on the `system` topic", () => {
      expect(
        canReceiveEvent(ev("notification-publisher.updated"), {
          role: "standard",
          topics: new Set(["system"]),
        }),
      ).toBe(false);
    });

    it("delivers notification-publisher events to admins", () => {
      expect(
        canReceiveEvent(ev("notification-publisher.updated"), {
          role: "admin",
          topics: new Set(["system"]),
        }),
      ).toBe(true);
    });

    it("hides mqtt-broker passwords from a non-admin even if they force the topic into their set", () => {
      expect(
        canReceiveEvent(ev("mqtt-broker.updated"), {
          role: "standard",
          topics: new Set(["system", "mqtt-publishers"]),
        }),
      ).toBe(false);
    });

    it("delivers mqtt-broker events to a subscribed admin", () => {
      expect(
        canReceiveEvent(ev("mqtt-broker.updated"), {
          role: "admin",
          topics: new Set(["system", "mqtt-publishers"]),
        }),
      ).toBe(true);
    });
  });
});

// Issue #651 — free-form strings on the shared `system` topic.
describe("redactForRole", () => {
  const withError = (type: string, error: string): EngineEvent =>
    ({ type, error }) as unknown as EngineEvent;

  it("leaves every event untouched for an admin", () => {
    const event = withError("system.update.error", "pull failed: s3cr3t");
    expect(redactForRole(event, "admin")).toBe(event); // same reference, no copy
  });

  it("strips the free-form field for a non-admin", () => {
    const event = withError("system.error", "connect ECONNREFUSED user:p4ss@host");
    for (const role of ["standard"] as const) {
      const out = redactForRole(event, role) as { error: string };
      expect(out.error).toBe(REDACTED_FOR_ROLE);
    }
  });

  it("keeps the structured fields beside it", () => {
    const event = {
      type: "system.update.progress",
      step: "pull",
      message: "pulling from registry.example/private",
    } as unknown as EngineEvent;
    const out = redactForRole(event, "standard") as { step: string; message: string; type: string };
    // `step` is a fixed vocabulary the UI switches on; only `message` is prose.
    expect(out.step).toBe("pull");
    expect(out.type).toBe("system.update.progress");
    expect(out.message).toBe(REDACTED_FOR_ROLE);
  });

  it("does not mutate the event other clients are still holding", () => {
    // One emit fans out to every client, so redacting in place would strip the
    // string from the admin's copy too, depending on iteration order.
    const event = withError("system.update.error", "boom: s3cr3t");
    redactForRole(event, "standard");
    expect((event as unknown as { error: string }).error).toBe("boom: s3cr3t");
  });

  it("passes through an event with no free-form field, by reference", () => {
    const event = ev("device.status_changed");
    expect(redactForRole(event, "standard")).toBe(event);
  });

  it("leaves system.update.available alone: versions and a URL, no prose", () => {
    const event = {
      type: "system.update.available",
      current: "1.62.0",
      latest: "1.63.0",
      releaseUrl: "https://github.com/mchacher/sowel/releases/tag/v1.63.0",
    } as unknown as EngineEvent;
    expect(redactForRole(event, "standard")).toBe(event);
  });
});
