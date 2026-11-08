import { Link } from 'react-router-dom';
import Logo from '../components/Logo';

const PILLARS = [
  { word: 'Train.', text: 'Book batting cages or the indoor turf in 30-minute blocks, whenever it fits your schedule.' },
  { word: 'Improve.', text: 'Get consistent reps in any weather. Members get cage time included every month.' },
  { word: 'Compete.', text: 'Show up ready for game day. Book weekly sessions and keep your work on the calendar.' },
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
        <p className="lead">Indoor baseball and softball training: batting cages and turf, booked online.</p>
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

      <p className="landing-more">
        <Link to="/about">Hours, prices and how it works →</Link>
      </p>
    </>
  );
}
