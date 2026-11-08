import { ChevronDown, PinIcon } from './Icons';

/** "The Yard — Location 1" → "Location 1" (the brand is already in the header). */
export const shortLocationName = (name: string) => name.replace(/^The Yard\s*[—–-]\s*/i, '') || name;

/**
 * Location choice as a pill: pin, name, chevron. A transparent native <select>
 * sits on top, so phones still open their own picker.
 */
export default function LocationPicker({ locations, value, onChange, className = '' }: {
  locations: { id: string; name: string }[];
  value: string;
  onChange(id: string): void;
  className?: string;
}) {
  const current = locations.find((l) => l.id === value);
  return (
    <label className={`location-picker ${className}`}>
      <PinIcon size={18} />
      <span className="location-picker-name">{current ? shortLocationName(current.name) : 'Choose a location'}</span>
      <ChevronDown size={16} />
      <select aria-label="Location" value={value} onChange={(e) => onChange(e.target.value)}>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
