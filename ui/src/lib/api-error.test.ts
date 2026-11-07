import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { ApiError } from "../api/client";
import { apiErrorMessage, apiErrorStatus } from "./api-error";

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
    expect(text.message).toBe("Trop de demandes en peu de temps. Réessayez dans quelques secondes.");
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
