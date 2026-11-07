import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { APP_ROUTES } from '../routes';

export default function Home() {
  const { user, hasAllPrivileges } = useAuth();
  const apps = APP_ROUTES.filter((r) => r.launcher && hasAllPrivileges(r.privileges));

  return (
    <section>
      <h1>Welcome back, {user?.displayName}</h1>
      <p className="lead">You're signed in as <strong>@{user?.username}</strong>.</p>
      <div className="grid">
        {apps.map((app) => (
          <div className="card" key={app.path}>
            <h2>{app.launcher!.title}</h2>
            <p className="muted">{app.launcher!.description}</p>
            <Link to={app.path} className="btn btn-primary">{app.launcher!.cta}</Link>
          </div>
        ))}
        {apps.length === 0 && (
          <div className="card">
            <h2>Nothing here yet</h2>
            <p className="muted">You don't have access to any apps yet. Ask an administrator for access.</p>
          </div>
        )}
      </div>
    </section>
  );
}
