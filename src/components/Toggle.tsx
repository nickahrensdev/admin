interface Props {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  /** Visible text next to the switch; defaults to none (label is still read by screen readers). */
  text?: string;
  disabled?: boolean;
}

export default function Toggle({ checked, onChange, label, text, disabled }: Props) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      {text && <span className="toggle-text">{text}</span>}
    </label>
  );
}
