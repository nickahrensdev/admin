import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Privilege } from '../auth/rbac';
import { useCanOpen } from '../auth/useCanOpen';
import Forbidden from '../pages/Forbidden';

/** Only signed-in users; others are sent to sign in and returned afterwards. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Only signed-out users (landing, sign in, sign up); signed-in users go home. */
export function PublicOnly() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (user) return <Navigate to="/home" replace />;
  return <Outlet />;
}

/** Page-level gate: renders a 403 page unless the user has every listed privilege. */
export function RequirePrivileges({
  privileges,
  anyLocation,
  children,
}: {
  privileges: readonly Privilege[];
  anyLocation?: boolean;
  children: ReactNode;
}) {
  const canOpen = useCanOpen();
  return canOpen({ privileges, anyLocation }) ? <>{children}</> : <Forbidden />;
}
