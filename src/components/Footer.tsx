import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} The Yard · <span className="footer-motto">Train. Improve. Compete.</span></span>
      <span className="footer-links">
        <Link to="/about">Hours &amp; prices</Link>
      </span>
    </footer>
  );
}
