import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, hasAccess } from '../auth/AuthContext';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) {
    return <div className="wrap" style={{ paddingTop: 80, color: 'var(--mut)' }}>Loading…</div>;
  }
  if (!firebaseUser) return <Navigate to="/login" replace />;
  if (!hasAccess(profile)) return <Navigate to="/no-access" replace />;
  return <>{children}</>;
}
