import { Navigate } from "react-router-dom";
import { useAuth } from "../../store/useAuth";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const setupRequired = useAuth((s) => s.setupRequired);
  const loading = useAuth((s) => s.loading);

  if (loading || setupRequired === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
