import { useCallback, useEffect, useState } from 'react';
import { adminWaiverOverview, publishWaiver, type WaiverOverview } from '../../data/waiver';

const SOURCE: Record<string, string> = { signup: 'At sign up', app: 'In the app', desk: 'Paper, at the desk' };
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function AdminWaiver() {
  const [data, setData] = useState<WaiverOverview | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await adminWaiverOverview();
      setData(d);
      const active = d.versions.find((v) => v.is_active);
      setTitle(active?.title ?? '');
      setBody(active?.body ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const active = data?.versions.find((v) => v.is_active);
  const changed = active ? title.trim() !== active.title || body !== active.body : true;

  const publish = async () => {
    if (!window.confirm('Publish this as a new version? Everyone will sign it again before their next booking.')) return;
    setSaving(true);
    setError(null);
    try {
      const v = await publishWaiver(title, body);
      setNotice(`Version ${v} is live. Customers sign it before their next booking.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="waiver-admin">
      <h1>Waiver</h1>
      <p className="card legal-note small">
        This text was written as a starting template, not legal advice. Have a lawyer licensed in your state review it
        (and your insurance carrier’s requirements) before you open. Publishing changes creates a new version; earlier
        signatures are kept.
      </p>

      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {data && active && (
        <div className="desk-stats">
          <span>Version <strong>{active.version}</strong> live since {fmt(active.created_at)}</span>
          <span><strong>{active.signatures}</strong> of {data.accounts} accounts signed</span>
        </div>
      )}

      <h2 className="section-title">Edit</h2>
      <div className="card">
        <label className="field">
          <span>Title</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Text <span className="muted">(blank lines separate paragraphs)</span></span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="form-actions">
          <button className="btn btn-ghost" disabled={!changed || saving} onClick={() => { setTitle(active?.title ?? ''); setBody(active?.body ?? ''); }}>
            Discard changes
          </button>
          <button className="btn btn-primary" disabled={!changed || saving} onClick={publish}>
            {saving ? 'Publishing…' : 'Publish new version'}
          </button>
        </div>
      </div>

      {data && (
        <>
          <h2 className="section-title">Versions</h2>
          <ul className="version-list">
            {data.versions.map((v) => (
              <li key={v.id} className="card">
                <span>
                  <strong>v{v.version}</strong> · {v.title} {v.is_active && <span className="chip">Live</span>}
                </span>
                <span className="muted small">
                  {fmt(v.created_at)}{v.created_by ? ` · ${v.created_by}` : ''} · {v.signatures} signed
                </span>
              </li>
            ))}
          </ul>

          <h2 className="section-title">Latest signatures</h2>
          {data.recent.length === 0 ? (
            <p className="muted">No one has signed yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Signed</th><th>Account</th><th>Signed as</th><th>For minors</th><th>How</th><th>Ver.</th></tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{fmt(r.accepted_at)}</td>
                      <td>{r.display_name} <span className="muted">@{r.username}</span></td>
                      <td>{r.signer_name}</td>
                      <td>{r.participants ?? '—'}</td>
                      <td>{SOURCE[r.source]}</td>
                      <td>v{r.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
