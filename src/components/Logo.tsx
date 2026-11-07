interface Props {
  /** Show the "Baseball & Performance" line under the wordmark. */
  tagline?: boolean;
  size?: 'sm' | 'lg';
}

/** The Yard wordmark: home-plate mark + italic "THE YARD". */
export default function Logo({ tagline = false, size = 'sm' }: Props) {
  return (
    <span className={`logo logo-${size}`}>
      <svg className="logo-mark" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M6 6h36v18L24 42 6 24z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      <span className="logo-text">
        <span className="logo-the">THE</span>
        <span className="logo-yard">YARD</span>
        {tagline && <span className="logo-tagline">Baseball &amp; Performance</span>}
      </span>
    </span>
  );
}
