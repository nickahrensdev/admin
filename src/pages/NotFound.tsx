import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function NotFound() {
  const { user } = useAuth();
  return (
    <section className="hero not-found">
      <p className="eyebrow">Error 404</p>
      <h1>Swing and a miss</h1>
      <p className="muted">That page doesn’t exist, or it has moved.</p>
      <div className="hero-actions">
        <Link to={user ? '/home' : '/'} className="btn btn-primary btn-lg">{user ? 'Back to Home' : 'Go to the start page'}</Link>
        {user && <Link to="/book" className="btn btn-ghost btn-lg">Book a cage</Link>}
      </div>
    </section>
  );
}
