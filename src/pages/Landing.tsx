import { Link } from 'react-router-dom';
import Logo from '../components/Logo';

const PILLARS = [
  { word: 'Train.', text: 'Book cages and tunnels, run your sessions and keep your work organized.' },
  { word: 'Improve.', text: 'Track progress over time and see what is actually getting better.' },
  { word: 'Compete.', text: 'Show up ready. Everything you need for game day in one place.' },
];

export default function Landing() {
  return (
    <>
      <section className="hero hero-yard">
        <div className="hero-glow" aria-hidden="true" />
        <Logo size="lg" tagline />
        <p className="motto">
          Train. Improve. <span>Compete.</span>
        </p>
        <p className="lead">Your home base for everything at The Yard.</p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg">Get started</Link>
          <Link to="/signin" className="btn btn-ghost btn-lg">Sign in</Link>
        </div>
      </section>

      <section className="pillars">
        {PILLARS.map((p) => (
          <div key={p.word} className="card pillar">
            <h2>{p.word}</h2>
            <p className="muted">{p.text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
