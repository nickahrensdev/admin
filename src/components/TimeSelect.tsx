import { HALF_HOURS, formatTime } from '../utils/time';

interface Props {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  label: string;
}

/** Half-hour time picker; a plain <select> is the easiest control on phones. */
export default function TimeSelect({ value, onChange, disabled, label }: Props) {
  return (
    <select className="time-select" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {HALF_HOURS.map((t) => (
        <option key={t} value={t}>
          {formatTime(t)}
        </option>
      ))}
    </select>
  );
}
