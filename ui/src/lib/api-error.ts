import type { TFunction } from "i18next";
import { ApiError } from "../api/client";

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
