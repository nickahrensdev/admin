import { Link } from 'react-router-dom';

export default function Forbidden() {
  return (
    <section className="hero">
      <h1>No access</h1>
      <p className="lead">You don't have permission to view this page.</p>
      <Link to="/" className="btn btn-primary">Go back</Link>
    </section>
  );
}
