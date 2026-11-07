import type { TFunction } from "i18next";
import { ApiError } from "../api/client";
import i18n from "../i18n";

/** What to tell the user about a failed request. */
export interface ApiErrorText {
  title: string;
  message: string;
  /** Trying again later can succeed: a busy server, a dropped connection, a server fault. */
  retryable: boolean;
}

/** The HTTP status of a failed request, `0` when it never got an answer, `null` when unknown. */
export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

/**
 * Spec 196 (FR-2) — one wording per kind of failure instead of the server's raw English
 * ("Too Many Requests", "Failed to fetch"). A 429 used to read as « introuvable » on the
 * equipment page; the status now says which failure it was.
 *
 * - 429 → « Serveur occupé », retryable
 * - no answer (status 0) → « Connexion impossible », retryable
 * - 5xx → « Erreur du serveur », retryable
 * - 404 → « Introuvable »
 * - anything else → generic title, the server's own message (a validation error says
 *   what was wrong, and that text is meant for the user)
 */
export function apiErrorMessage(err: unknown, t: TFunction): ApiErrorText {
  const status = apiErrorStatus(err);
  if (status === 429) {
    return { title: t("errors.rateLimited.title"), message: t("errors.rateLimited.message"), retryable: true };
  }
  if (status === 0) {
    return { title: t("errors.network.title"), message: t("errors.network.message"), retryable: true };
  }
  if (status !== null && status >= 500) {
    return { title: t("errors.server.title"), message: t("errors.server.message"), retryable: true };
  }
  if (status === 404) {
    return { title: t("errors.notFound.title"), message: t("errors.notFound.message"), retryable: false };
  }
  const raw = err instanceof Error ? err.message : "";
  return { title: t("common.error"), message: raw, retryable: false };
}

/**
 * Issue #1124 — the one line a Zustand store keeps in its `error` field. Stores are not
 * components, so `t` defaults to the app's i18next instance; the text is in the language
 * of the moment of the failure. Same distinctions as `apiErrorMessage` (429, no answer,
 * 5xx, 404 each have their words; a 4xx keeps the server's own message), and the generic
 * « Une erreur est survenue » when nothing meaningful is left — never an English
 * « Failed to … ».
 */
export function apiErrorText(err: unknown, t: TFunction = i18n.t.bind(i18n)): string {
  const { title, message } = apiErrorMessage(err, t);
  return message || title;
}
