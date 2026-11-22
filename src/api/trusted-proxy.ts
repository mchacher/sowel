/**
 * Which socket peers may tell Sowel who the real client is.
 *
 * Behind a reverse proxy or a tunnel connector (cloudflared), every request
 * arrives from the same local address, so the per-IP rate limits (login, MFA)
 * become one bucket shared by the whole internet and the audit log records the
 * proxy instead of the client. Blindly trusting `X-Forwarded-For` would be
 * worse: Sowel's port is usually published on the LAN, and any device there
 * could then pick its own address and dodge the limits.
 *
 * The middle ground is an explicit list (`SOWEL_TRUSTED_PROXIES`, IPs or
 * CIDRs). Fastify then reads `X-Forwarded-For` only when the socket peer is on
 * that list, and takes the right-most address that is not itself trusted,
 * which is the one the proxy appended. Empty list = trust nobody.
 */
export function trustProxySetting(trusted: readonly string[]): false | string[] {
  const list = trusted.map((s) => s.trim()).filter((s) => s.length > 0);
  return list.length > 0 ? list : false;
}
