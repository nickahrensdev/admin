import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="hero">
      <h1>Page not found</h1>
      <Link to="/" className="btn btn-primary">Go to the start page</Link>
    </section>
  );
}
