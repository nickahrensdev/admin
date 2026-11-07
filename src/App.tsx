import { Route, Routes } from 'react-router-dom';
import Footer from './components/Footer';
import NavBar from './components/NavBar';
import RecoveryRedirect from './components/RecoveryRedirect';
import { PublicOnly, RequireAuth, RequirePrivileges } from './components/RouteGuards';
import ForgotPassword from './pages/ForgotPassword';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import ResetPassword from './pages/ResetPassword';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import { APP_ROUTES } from './routes';

export default function App() {
  return (
    <>
      <RecoveryRedirect />
      <NavBar />
      <main className="container">
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<RequireAuth />}>
            {APP_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<RequirePrivileges privileges={r.privileges}>{r.element}</RequirePrivileges>}
              />
            ))}
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
