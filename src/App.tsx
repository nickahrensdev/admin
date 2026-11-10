import { Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Footer from './components/Footer';
import NavBar from './components/NavBar';
import TabBar from './components/TabBar';
import { useAuth } from './auth/AuthContext';
import RecoveryRedirect from './components/RecoveryRedirect';
import { PublicOnly, RequireAuth, RequirePrivileges } from './components/RouteGuards';
import About from './pages/About';
import ForgotPassword from './pages/ForgotPassword';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import ResetPassword from './pages/ResetPassword';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import { APP_ROUTES } from './routes';

const PUBLIC_TITLES: Record<string, string> = {
  '/signin': 'Sign in',
  '/signup': 'Create your account',
  '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password',
  '/about': 'Hours, prices & how it works',
  '/more': 'Account',
  '/admin/locations': 'Locations',
};

/** Names the browser tab after the page and starts each new page at the top. */
function usePageChrome() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = [...APP_ROUTES].sort((a, b) => b.path.length - a.path.length).find((r) => pathname === r.path || pathname.startsWith(`${r.path.replace(/\/:.*$/, '')}/`));
    const name = PUBLIC_TITLES[pathname] ?? route?.title ?? route?.nav?.label ?? route?.launcher?.title;
    document.title = name ? `${name} · The Yard` : 'The Yard · Baseball & Performance';
    window.scrollTo(0, 0);
  }, [pathname]);
}

export default function App() {
  const { user } = useAuth();
  usePageChrome();
  return (
    <div className={user ? 'app signed-in' : 'app'}>
      <RecoveryRedirect />
      <NavBar />
      <main className="container">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/about" element={<About />} />
          <Route element={<RequireAuth />}>
            {APP_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<RequirePrivileges privileges={r.privileges} anyLocation={r.anyLocation}>{r.element}</RequirePrivileges>}
              />
            ))}
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
      <Footer />
      <TabBar />
    </div>
  );
}
