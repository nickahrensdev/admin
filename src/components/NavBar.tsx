import { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../utils/initials';
import Logo from './Logo';
import { APP_ROUTES } from '../routes';
import { useCanOpen } from '../auth/useCanOpen';

export default function NavBar() {
  const { user, signOut } = useAuth();
  const canOpen = useCanOpen();
  const navItems = APP_ROUTES.filter((r) => r.nav && canOpen(r));
  const mainItems = navItems.filter((r) => r.nav!.group !== 'admin');
  const adminItems = navItems.filter((r) => r.nav!.group === 'admin');
  const adminMenu = useRef<HTMLDetailsElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const adminActive = adminItems.some((r) => location.pathname.startsWith(r.path));
  // Close the Admin menu whenever the route changes.
  useEffect(() => {
    if (adminMenu.current) adminMenu.current.open = false;
  }, [location.pathname]);

  // Close the desktop Admin menu when clicking elsewhere.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (adminMenu.current && !adminMenu.current.contains(e.target as Node)) adminMenu.current.open = false;
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && adminMenu.current) adminMenu.current.open = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
            <Link to="/more" className="nav-avatar" aria-label="Account and more">
              <span className="avatar" aria-hidden="true">{initials(user.displayName)}</span>
            </Link>
            <nav className="nav-menu" aria-label="Main">
              <Link to="/profile" className="user-chip">
                <span className="avatar" aria-hidden="true">{initials(user.displayName)}</span>
                <span className="user-text">
                  <span className="user-name">{user.displayName}</span>
                  <span className="user-handle">@{user.username}</span>
                </span>
              </Link>
              <div className="nav-links">
                {mainItems.filter((r) => !r.nav!.mobileOnly).map((r) => (
                  <NavLink key={r.path} to={r.path} className="nav-link">{r.nav!.label}</NavLink>
                ))}
                <NavLink to="/about" className="nav-link">About</NavLink>
                {adminItems.length > 0 && (
                  <>
                    <details className="nav-admin" ref={adminMenu}>
                      <summary className={`nav-link${adminActive ? ' active' : ''}`}>Admin</summary>
                      <div className="nav-dropdown">
                        {adminItems.map((r) => (
                          <NavLink key={r.path} to={r.path} className="nav-dropdown-link">{r.nav!.label}</NavLink>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </div>
              <button className="btn btn-ghost nav-signout" onClick={handleSignOut}>Sign out</button>
            </nav>
          </>
        ) : (
          <nav className="nav-actions">
            <NavLink to="/about" className="nav-link nav-about">About</NavLink>
            <Link to="/signin" className="btn btn-ghost">Sign in</Link>
            <Link to="/signup" className="btn btn-primary">Sign up</Link>
          </nav>
        )}
      </div>
    </header>
  );
}
