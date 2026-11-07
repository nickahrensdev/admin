import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

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
