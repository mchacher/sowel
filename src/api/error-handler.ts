import type { FastifyError, FastifyInstance } from "fastify";

/**
 * AJV options for the app's schema validation (issue #452). `coerceTypes: false`
 * keeps body validation strict — a stringified number ("1000") or a boolean-ish
 * string is rejected rather than silently coerced, matching the old hand-rolled
 * `Number.isFinite`/typeof checks. Pass to `Fastify({ ajv: validationAjvOptions })`.
 */
export const validationAjvOptions = { customOptions: { coerceTypes: false } };

/**
 * Normalise Fastify schema-validation failures to the app's standard 400 body
 * `{ error: string }` (issue #452), so schema-validated routes answer with the
 * exact same shape the hand-rolled `reply.code(400).send({ error })` checks did.
 * A client keeps reading `body.error` as the human-readable reason.
 *
 * Non-validation errors are delegated unchanged to Fastify's default handling,
 * so routes that throw an unexpected error still surface it as before.
 */
export function installValidationErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _request, reply) => {
    if (err.validation) {
      reply.code(400).send({ error: err.message });
      return;
    }
    // Not a validation error: let Fastify serialise it with its default logic.
    reply.send(err);
  });
}
