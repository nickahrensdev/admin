export default function Footer() {
  const built = new Date(__BUILD_TIME__).toLocaleString();
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} The Yard · <span className="footer-motto">Train. Improve. Compete.</span></span>
      <span className="muted">Build {__BUILD_SHA__} · {built}</span>
    </footer>
  );
}
