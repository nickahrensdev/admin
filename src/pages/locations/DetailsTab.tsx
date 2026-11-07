import { useState, type FormEvent } from 'react';
import { updateLocation, type Location } from '../../data/locations';
import FormField from '../../components/FormField';
import Toggle from '../../components/Toggle';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles'];

export default function DetailsTab({ location, onSaved }: { location: Location; onSaved(): void }) {
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? '');
  const [timezone, setTimezone] = useState(location.timezone);
  const [active, setActive] = useState(location.is_active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateLocation(location.id, { name: name.trim(), address: address.trim() || null, timezone, is_active: active });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2>Details</h2>
      <FormField label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
      <FormField label="Address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <label className="field">
        <span className="field-label">Time zone</span>
        <select className="time-select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => (
            <option key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</option>
          ))}
        </select>
      </label>
      <Toggle checked={active} onChange={setActive} label="Location active" text={active ? 'Active — customers can see and book it' : 'Inactive — hidden from customers'} />
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {saved && <p className="alert alert-success" role="status">Saved.</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
