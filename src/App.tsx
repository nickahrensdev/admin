import { Route, Routes } from 'react-router-dom';
import Footer from './components/Footer';
import NavBar from './components/NavBar';
import { PublicOnly, RequireAuth, RequirePrivileges } from './components/RouteGuards';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import { APP_ROUTES } from './routes';

export default function App() {
  return (
    <>
      <NavBar />
      <main className="container">
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
          </Route>
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
