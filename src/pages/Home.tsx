import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Home() {
  const { user } = useAuth();
  return (
    <section>
      <h1>Welcome back, {user?.displayName}</h1>
      <p className="lead">You're signed in as <strong>@{user?.username}</strong>.</p>
      <div className="grid">
        <div className="card">
          <h2>Your profile</h2>
          <p className="muted">Update your username, email, display name or password.</p>
          <Link to="/profile" className="btn btn-primary">Edit profile</Link>
        </div>
        <div className="card">
          <h2>Getting started</h2>
          <p className="muted">This is your home page. Add your app's main features here.</p>
        </div>
      </div>
    </section>
  );
}
