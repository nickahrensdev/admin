import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <section className="hero">
      <h1>Welcome to Admin</h1>
      <p className="lead">A starter app with accounts, a home dashboard and profile management.</p>
      <div className="hero-actions">
        <Link to="/signup" className="btn btn-primary btn-lg">Get started</Link>
        <Link to="/signin" className="btn btn-ghost btn-lg">I already have an account</Link>
      </div>
    </section>
  );
}
