import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../utils/initials';
import Logo from './Logo';
import { APP_ROUTES } from '../routes';

export default function NavBar() {
  const { user, signOut, hasAllPrivileges } = useAuth();
  const navItems = APP_ROUTES.filter((r) => r.nav && hasAllPrivileges(r.privileges));
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to={user ? '/home' : '/'} className="brand" aria-label="The Yard home">
          <Logo />
        </Link>

        {user ? (
          <>
            <button
              className={`nav-toggle${open ? ' open' : ''}`}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="nav-menu"
              onClick={() => setOpen((o) => !o)}
            >
              <span className="nav-toggle-bar" />
              <span className="nav-toggle-bar" />
              <span className="nav-toggle-bar" />
            </button>

            <nav id="nav-menu" className={`nav-menu${open ? ' open' : ''}`}>
              <Link to="/profile" className="user-chip">
                <span className="avatar" aria-hidden="true">{initials(user.displayName)}</span>
                <span className="user-text">
                  <span className="user-name">{user.displayName}</span>
                  <span className="user-handle">@{user.username}</span>
                </span>
              </Link>
              <div className="nav-links">
                {navItems.map((r) => (
                  <NavLink key={r.path} to={r.path} className="nav-link">{r.nav!.label}</NavLink>
                ))}
              </div>
              <button className="btn btn-ghost nav-signout" onClick={handleSignOut}>Sign out</button>
            </nav>

            {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
          </>
        ) : (
          <nav className="nav-actions">
            <Link to="/signin" className="btn btn-ghost">Sign in</Link>
            <Link to="/signup" className="btn btn-primary">Sign up</Link>
          </nav>
        )}
      </div>
    </header>
  );
}
