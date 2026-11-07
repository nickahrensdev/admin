import { Route, Routes } from 'react-router-dom';
import Footer from './components/Footer';
import NavBar from './components/NavBar';
import { PublicOnly, RequireAuth } from './components/RouteGuards';
import Home from './pages/Home';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import Profile from './pages/Profile';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';

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
            <Route path="/home" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
