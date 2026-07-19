import { Navigate } from "react-router-dom";
import { useAuth } from "../../store/useAuth";

/**
 * Route guard for admin-only pages. Renders its children only for admin users;
 * standard users are redirected to the dashboard.
 *
 * Assumes it is nested inside ProtectedRoute, so authentication is already
 * resolved and `user` is populated. While `user` is momentarily null we render
 * nothing rather than redirecting, so a real admin is never bounced on a race.
 *
 * This is defence in depth: the server already rejects every config mutation
 * from a standard user (see STANDARD_WRITE_ALLOWLIST in auth-middleware). The
 * guard keeps standard users out of pages whose sole purpose is configuration
 * (devices, calendar, integrations, plugins, publishers, logs, backup).
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
