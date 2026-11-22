import Fastify, { type FastifyInstance } from "fastify";
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
