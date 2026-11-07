import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function NavBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to={user ? '/home' : '/'} className="brand">
          Admin
        </Link>
        <nav className="nav-actions">
          {user ? (
            <>
              <NavLink to="/home" className="nav-link">Home</NavLink>
              <NavLink to="/profile" className="nav-link">Profile</NavLink>
              <span className="nav-user">Hi, {user.displayName}</span>
              <button className="btn btn-ghost" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost">Sign in</Link>
              <Link to="/signup" className="btn btn-primary">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
