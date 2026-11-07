import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getLocation, type Location } from '../../data/locations';
import ClosuresTab from './ClosuresTab';
import DetailsTab from './DetailsTab';
import HoursTab from './HoursTab';
import PricingTab from './PricingTab';
import ResourcesTab from './ResourcesTab';

const TABS = [
  { id: 'hours', label: 'Hours' },
  { id: 'closures', label: 'Closures' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'resources', label: 'Cages & turf' },
  { id: 'details', label: 'Details' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function LocationDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'hours') as TabId;
  const [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLocation(await getLocation(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!location) {
    return (
      <section>
        <p className="alert alert-error">{error ?? 'Location not found.'}</p>
        <Link to="/admin/locations" className="btn btn-ghost">Back to locations</Link>
      </section>
    );
  }

  return (
    <section>
      <Link to="/admin/locations" className="back-link">‹ Locations</Link>
      <div className="page-header">
        <div>
          <h1>{location.name}</h1>
          <p className="muted">{location.address || 'No address yet'}</p>
        </div>
        {!location.is_active && <span className="chip chip-muted">Inactive</span>}
      </div>

      <nav className="tabs" role="tablist" aria-label="Location settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div role="tabpanel">
        {tab === 'hours' && <HoursTab locationId={location.id} />}
        {tab === 'closures' && <ClosuresTab locationId={location.id} />}
        {tab === 'pricing' && <PricingTab locationId={location.id} />}
        {tab === 'resources' && <ResourcesTab locationId={location.id} />}
        {tab === 'details' && <DetailsTab location={location} onSaved={load} />}
      </div>
    </section>
  );
}
