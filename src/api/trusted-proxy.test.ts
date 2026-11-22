import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it } from "vitest";
import { trustProxySetting } from "./trusted-proxy.js";

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function build(trusted: string[]): Promise<FastifyInstance> {
  const a = Fastify({ logger: false, trustProxy: trustProxySetting(trusted) });
  a.get("/ip", async (request) => ({ ip: request.ip }));
  await a.ready();
  return a;
}

async function ipSeen(a: FastifyInstance, remoteAddress: string, xff?: string): Promise<string> {
  const res = await a.inject({
    method: "GET",
    url: "/ip",
    remoteAddress,
    headers: xff ? { "x-forwarded-for": xff } : {},
  });
  return (res.json() as { ip: string }).ip;
}

describe("trustProxySetting", () => {
  it("trusts nobody when the list is empty or blank", () => {
    expect(trustProxySetting([])).toBe(false);
    expect(trustProxySetting(["", "  "])).toBe(false);
  });

  it("returns the trimmed list otherwise", () => {
    expect(trustProxySetting([" 172.18.0.1 ", "10.0.0.0/8"])).toEqual(["172.18.0.1", "10.0.0.0/8"]);
  });
});

describe("client address resolution", () => {
  it("default: X-Forwarded-For is ignored, the socket peer wins", async () => {
    app = await build([]);
    expect(await ipSeen(app, "172.18.0.1", "203.0.113.7")).toBe("172.18.0.1");
  });

  it("trusted peer: the address the proxy appended is used", async () => {
    app = await build(["172.18.0.1"]);
    expect(await ipSeen(app, "172.18.0.1", "203.0.113.7")).toBe("203.0.113.7");
  });

  it("trusted peer: a client-forged left-most entry does not win", async () => {
    app = await build(["172.18.0.1"]);
    // The client sent `1.2.3.4`, the edge appended the real address.
    expect(await ipSeen(app, "172.18.0.1", "1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("untrusted LAN peer cannot pick its own address", async () => {
    app = await build(["172.18.0.1"]);
    expect(await ipSeen(app, "192.168.0.50", "203.0.113.7")).toBe("192.168.0.50");
  });

  it("CIDR entries are honoured", async () => {
    app = await build(["172.16.0.0/12"]);
    expect(await ipSeen(app, "172.18.0.1", "203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("rate limiting behind a trusted proxy", () => {
  // The point of #1302: two different internet clients reaching Sowel through
  // the same tunnel connector must not share one rate-limit bucket.
  async function buildLimited(trusted: string[]): Promise<FastifyInstance> {
    const a = Fastify({ logger: false, trustProxy: trustProxySetting(trusted) });
    await a.register(rateLimit, { max: 300, timeWindow: "1 minute" });
    a.post("/login", { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } }, async () => ({
      ok: true,
    }));
    await a.ready();
    return a;
  }

  const hit = (a: FastifyInstance, xff: string, remoteAddress = "172.18.0.1") =>
    a
      .inject({ method: "POST", url: "/login", remoteAddress, headers: { "x-forwarded-for": xff } })
      .then((r) => r.statusCode);

  it("without trusted proxies, every tunnelled client shares one bucket", async () => {
    app = await buildLimited([]);
    expect(await hit(app, "203.0.113.1")).toBe(200);
    expect(await hit(app, "203.0.113.1")).toBe(200);
    // A different visitor is already locked out by the first one.
    expect(await hit(app, "198.51.100.9")).toBe(429);
  });

  it("with the connector trusted, each client gets its own bucket", async () => {
    app = await buildLimited(["172.18.0.1"]);
    expect(await hit(app, "203.0.113.1")).toBe(200);
    expect(await hit(app, "203.0.113.1")).toBe(200);
    expect(await hit(app, "203.0.113.1")).toBe(429);
    expect(await hit(app, "198.51.100.9")).toBe(200);
  });

  it("an untrusted LAN peer cannot reset its bucket by rotating X-Forwarded-For", async () => {
    app = await buildLimited(["172.18.0.1"]);
    expect(await hit(app, "203.0.113.1", "192.168.0.50")).toBe(200);
    expect(await hit(app, "203.0.113.2", "192.168.0.50")).toBe(200);
    expect(await hit(app, "203.0.113.3", "192.168.0.50")).toBe(429);
  });
});
