export default function Footer() {
  const built = new Date(__BUILD_TIME__).toLocaleString();
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Admin</span>
      <span className="muted">Build {__BUILD_SHA__} · {built}</span>
    </footer>
  );
}
