import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createLocation, listLocations, type Location } from '../../data/locations';
import FormField from '../../components/FormField';

export default function LocationsList() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLocations(await listLocations());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createLocation({ name, address });
      setName('');
      setAddress('');
      setAdding(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Locations</h1>
          <p className="muted">Hours, closures, cages and pricing for each facility.</p>
        </div>
        {!adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add location
          </button>
        )}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {adding && (
        <form className="card stack" onSubmit={onAdd} noValidate>
          <h2>New location</h2>
          <FormField label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          <FormField label="Address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} hint="Optional" />
          <p className="muted small">New locations start with default hours and prices. Add its cages and turf afterwards.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create location'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <ul className="list">
          {locations.map((l) => (
            <li key={l.id}>
              <Link to={`/admin/locations/${l.id}`} className="card list-link">
                <div>
                  <span className="list-title">{l.name}</span>
                  <span className="muted small">{l.address || 'No address yet'}</span>
                </div>
                <span className="list-meta">
                  {!l.is_active && <span className="chip chip-muted">Inactive</span>}
                  <span aria-hidden="true" className="chevron">›</span>
                </span>
              </Link>
            </li>
          ))}
          {locations.length === 0 && <li className="card muted">No locations yet.</li>}
        </ul>
      )}
    </section>
  );
}
