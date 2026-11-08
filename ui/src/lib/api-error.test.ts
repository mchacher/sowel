import { describe, it, expect, afterEach, vi } from "vitest";
import i18n from "../i18n";
import { ApiError, fetchJSON, setOnUnauthorized } from "../api/client";
import { apiErrorMessage, apiErrorStatus, apiErrorText } from "./api-error";

// Spec 196, slice 2b — a 429 used to reach the user as « Équipement introuvable »
// over the server's raw « Too Many Requests ». Each kind of failure now has its words.

const t = i18n.t.bind(i18n);

describe("apiErrorMessage", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("calls a 429 a busy server and offers to retry", async () => {
    await i18n.changeLanguage("fr");
    const text = apiErrorMessage(new ApiError(429, "Too Many Requests"), t);
    expect(text.title).toBe("Serveur occupé");
    expect(text.message).toBe(
      "Trop de demandes en peu de temps. Réessayez dans quelques secondes.",
    );
    expect(text.retryable).toBe(true);
  });

  it("calls a 404 not found, with nothing to retry", async () => {
    await i18n.changeLanguage("fr");
    const text = apiErrorMessage(new ApiError(404, "Equipment not found"), t);
    expect(text.title).toBe("Introuvable");
    expect(text.retryable).toBe(false);
  });

  it("calls a request that got no answer a connection failure", async () => {
    await i18n.changeLanguage("fr");
    const text = apiErrorMessage(new ApiError(0, "Failed to fetch"), t);
    expect(text.title).toBe("Connexion impossible");
    expect(text.retryable).toBe(true);
  });

  it("calls a 5xx a server error, never the server's raw text", () => {
    const text = apiErrorMessage(new ApiError(500, "SqliteError: database is locked"), t);
    expect(text.title).toBe("Server error");
    expect(text.message).not.toContain("Sqlite");
    expect(text.retryable).toBe(true);
  });

  it("keeps the server's own message for a validation error", () => {
    const text = apiErrorMessage(new ApiError(400, "Name is required"), t);
    expect(text.title).toBe("An error occurred");
    expect(text.message).toBe("Name is required");
    expect(text.retryable).toBe(false);
  });

  it("knows no status for an error that did not come from the API", () => {
    expect(apiErrorStatus(new Error("boom"))).toBeNull();
    expect(apiErrorMessage(new Error("boom"), t).message).toBe("boom");
  });
});

// Issue #1124 — the one line a store keeps, with no `t` at hand.
describe("apiErrorText", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("uses the app's i18next instance and the language of the moment", async () => {
    await i18n.changeLanguage("fr");
    expect(apiErrorText(new ApiError(429, "Too Many Requests"))).toBe(
      "Trop de demandes en peu de temps. Réessayez dans quelques secondes.",
    );
    await i18n.changeLanguage("en");
    expect(apiErrorText(new ApiError(429, "Too Many Requests"))).toBe(
      "Too many requests in a short time. Try again in a few seconds.",
    );
  });

  it("keeps the server's message for a refused request", () => {
    expect(apiErrorText(new ApiError(409, "Name already taken"))).toBe("Name already taken");
  });

  it("falls back to the generic translated line when no message is left", async () => {
    await i18n.changeLanguage("fr");
    expect(apiErrorText("boom")).toBe("Une erreur est survenue");
    expect(apiErrorText(new Error(""))).toBe("Une erreur est survenue");
  });

  it("never shows the raw text of an error that did not come from the API", async () => {
    await i18n.changeLanguage("fr");
    const parse = new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`);
    expect(apiErrorText(parse)).toBe("Une erreur est survenue");
  });
});

// Issue #1141 — the client writes some 4xx messages itself (« Session expired »,
// `HTTP 403: Forbidden` when the body names no error). They used to pass for the server's
// own words and reached a French UI in English.
describe("a 4xx written by the client", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
  });

  function respond(status: number, body: unknown, statusText = ""): Response {
    return new Response(JSON.stringify(body), { status, statusText });
  }

  it("reads a 403 with no server text in French in a French UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(403, {}, "Forbidden")),
    );
    const err = await fetchJSON("/api/v1/modes/x/apply").catch((e: unknown) => e);
    expect((err as ApiError).fromServer).toBe(false);
    await i18n.changeLanguage("fr");
    expect(apiErrorText(err)).toBe("Votre compte n'a pas le droit de faire cela.");
    expect(apiErrorMessage(err, t).title).toBe("Accès refusé");
  });

  it("reads an expired session in French in a French UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(401, {})),
    );
    setOnUnauthorized(async () => false);
    const err = await fetchJSON("/api/v1/zones").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(401);
    await i18n.changeLanguage("fr");
    expect(apiErrorText(err)).toBe("Votre session a pris fin. Reconnectez-vous.");
  });

  it("falls back to the generic line for any other 4xx with no server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(400, {}, "Bad Request")),
    );
    const err = await fetchJSON("/api/v1/zones").catch((e: unknown) => e);
    await i18n.changeLanguage("fr");
    expect(apiErrorText(err)).toBe("Une erreur est survenue");
  });

  it("still shows the server's own words for a 403 that carries them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(403, { error: "Admin only" })),
    );
    const err = await fetchJSON("/api/v1/users").catch((e: unknown) => e);
    expect((err as ApiError).fromServer).toBe(true);
    expect(apiErrorText(err)).toBe("Admin only");
  });
});
