import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  RESOURCE_TYPES,
  addResource,
  listResources,
  resourceTypeLabel,
  updateResource,
  type Resource,
  type ResourceType,
} from '../../data/locations';
import Toggle from '../../components/Toggle';

export default function ResourcesTab({ locationId }: { locationId: string }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setResources(await listResources(locationId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const a = resources[index];
    const b = resources[index + dir];
    if (!a || !b) return;
    // Renumber everything so ties can't make the order ambiguous.
    const order = resources.map((r) => r.id);
    order.splice(index, 1);
    order.splice(index + dir, 0, a.id);
    run(() => Promise.all(order.map((id, i) => updateResource(id, { sort_order: (i + 1) * 10 }))));
  };

  const rename = (r: Resource) => {
    const name = window.prompt('New name', r.name);
    if (name && name.trim() && name.trim() !== r.name) run(() => updateResource(r.id, { name: name.trim() }));
  };

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>Cages & turf</h2>
          <p className="muted small">Turn something off to stop new bookings (e.g. for repairs). Customers see them in this order.</p>
        </div>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <ul className="resource-list">
          {resources.map((r, i) => (
            <li key={r.id} className={`resource-row${r.is_active ? '' : ' is-closed'}`}>
              <div className="resource-order">
                <button className="icon-btn" aria-label={`Move ${r.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>▲</button>
                <button className="icon-btn" aria-label={`Move ${r.name} down`} disabled={busy || i === resources.length - 1} onClick={() => move(i, 1)}>▼</button>
              </div>
              <div className="resource-text">
                <span className="list-title">{r.name}</span>
                <span className="muted small">{resourceTypeLabel(r.type)}</span>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => rename(r)}>
                Rename
              </button>
              <Toggle
                checked={r.is_active}
                disabled={busy}
                onChange={(on) => run(() => updateResource(r.id, { is_active: on }))}
                label={`${r.name} available`}
                text={r.is_active ? 'On' : 'Off'}
              />
            </li>
          ))}
          {resources.length === 0 && <li className="muted">Nothing here yet. Add a cage or turf below.</li>}
        </ul>
      </div>
      <AddResource locationId={locationId} nextOrder={(resources.length + 1) * 10} existing={resources} onAdded={load} />
    </div>
  );
}

function AddResource({ locationId, nextOrder, existing, onAdded }: { locationId: string; nextOrder: number; existing: Resource[]; onAdded(): void }) {
  const [type, setType] = useState<ResourceType>('batting_cage');
  const suggest = (t: ResourceType) =>
    t === 'batting_cage' ? `Cage ${existing.filter((r) => r.type === 'batting_cage').length + 1}` : existing.some((r) => r.type === 'turf') ? 'Turf 2' : 'Turf';
  const [name, setName] = useState(() => suggest('batting_cage'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(suggest(type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.length, type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addResource(locationId, type, name, nextOrder);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2>Add</h2>
      <div className="closure-form">
        <label className="field">
          <span className="field-label">Type</span>
          <select className="time-select" value={type} onChange={(e) => setType(e.target.value as ResourceType)}>
            {RESOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving || !name.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
