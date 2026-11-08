import { useCallback, useEffect, useState } from 'react';
import { adminAnnouncements, deleteAnnouncement, emailDaysCustomers, saveAnnouncement, type AdminAnnouncement } from '../../data/announcements';
import { todayIn } from '../../utils/dates';
import { listLocations, type Location } from '../../data/locations';

/** ISO → value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Draft {
  id: string | null;
  title: string;
  body: string;
  location_id: string;
  starts_at: string;
  dismissible: boolean;
  expires: boolean;
  expires_at: string;
}

const blank = (): Draft => ({
  id: null,
  title: '',
  body: '',
  location_id: '',
  starts_at: toLocalInput(new Date().toISOString()),
  dismissible: true,
  expires: false,
  expires_at: toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()),
});

function status(a: AdminAnnouncement): 'live' | 'scheduled' | 'ended' {
  const now = Date.now();
  if (a.archived || (a.expires_at && Date.parse(a.expires_at) <= now)) return 'ended';
  if (Date.parse(a.starts_at) > now) return 'scheduled';
  return 'live';
}

export default function Announcements() {
  const [list, setList] = useState<AdminAnnouncement[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await adminAnnouncements());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    listLocations().then((l) => setLocations(l.filter((x) => x.is_active))).catch(() => undefined);
  }, [load]);

  const edit = (a: AdminAnnouncement) =>
    setDraft({
      id: a.id,
      title: a.title,
      body: a.body,
      location_id: a.location_id ?? '',
      starts_at: toLocalInput(a.starts_at),
      dismissible: a.dismissible,
      expires: Boolean(a.expires_at),
      expires_at: a.expires_at ? toLocalInput(a.expires_at) : blank().expires_at,
    });

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) return setError('Add a title.');
    setSaving(true);
    setError(null);
    try {
      await saveAnnouncement(draft.id, {
        title: draft.title,
        body: draft.body,
        location_id: draft.location_id || null,
        starts_at: new Date(draft.starts_at).toISOString(),
        expires_at: draft.expires ? new Date(draft.expires_at).toISOString() : null,
        dismissible: draft.dismissible,
      });
      setNotice(draft.id ? 'Message updated.' : 'Message posted.');
      setDraft(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setArchived = async (a: AdminAnnouncement, archived: boolean) => {
    try {
      await saveAnnouncement(a.id, {
        title: a.title,
        body: a.body,
        location_id: a.location_id,
        starts_at: a.starts_at,
        expires_at: a.expires_at,
        dismissible: a.dismissible,
        archived,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (a: AdminAnnouncement) => {
    if (!window.confirm(`Delete “${a.title}”? This can’t be undone.`)) return;
    try {
      await deleteAnnouncement(a.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const groups: [string, AdminAnnouncement[]][] = [
    ['Showing now', (list ?? []).filter((a) => status(a) === 'live')],
    ['Scheduled', (list ?? []).filter((a) => status(a) === 'scheduled')],
    ['Ended', (list ?? []).filter((a) => status(a) === 'ended')],
  ];

  return (
    <section className="announcements-admin">
      <div className="page-header">
        <div>
          <h1>Messages</h1>
          <p className="muted">Posts on customers’ Home screens, for everyone or one location.</p>
        </div>
        {!draft && (
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => setEmailing((v) => !v)}>Email a day’s customers</button>
            <button className="btn btn-primary" onClick={() => setDraft(blank())}>New message</button>
          </div>
        )}
      </div>

      {emailing && locations.length > 0 && (
        <DayEmail locations={locations} onClose={() => setEmailing(false)} onSent={(n) => { setEmailing(false); setNotice(`Email queued for ${n} ${n === 1 ? 'customer' : 'customers'}.`); }} />
      )}

      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {draft && (
        <div className="card announcement-form">
          <h2>{draft.id ? 'Edit message' : 'New message'}</h2>
          <label className="field">
            <span>Title</span>
            <input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea rows={4} value={draft.body} maxLength={2000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Who sees it</span>
              <select value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
                <option value="">Everyone (all locations)</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Show from</span>
              <input type="datetime-local" value={draft.starts_at} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} />
            </label>
          </div>
          <fieldset className="dismiss-options">
            <legend>How it goes away</legend>
            <label className="check-line">
              <input type="checkbox" checked={draft.dismissible} onChange={(e) => setDraft({ ...draft, dismissible: e.target.checked })} />
              Users can dismiss it
            </label>
            <label className="check-line">
              <input type="checkbox" checked={draft.expires} onChange={(e) => setDraft({ ...draft, expires: e.target.checked })} />
              Hide it automatically after
            </label>
            {draft.expires && (
              <input type="datetime-local" className="expires-input" value={draft.expires_at} onChange={(e) => setDraft({ ...draft, expires_at: e.target.value })} />
            )}
            {!draft.dismissible && !draft.expires && (
              <p className="muted small">With neither, it stays until you archive or delete it.</p>
            )}
          </fieldset>
          {draft.location_id && (
            <p className="muted small">
              Location messages show to people who’ve booked there in the last year or have upcoming bookings, members whose plan
              covers it, and its staff. While you have one location, everyone sees them.
            </p>
          )}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save' : 'Post'}</button>
          </div>
        </div>
      )}

      {!list && !error && <div className="page-loading">Loading…</div>}
      {list && list.length === 0 && !draft && <p className="card muted">No messages yet.</p>}

      {groups.map(([label, items]) =>
        items.length === 0 ? null : (
          <div key={label}>
            <h2 className="section-title">{label}</h2>
            <ul className="message-list">
              {items.map((a) => (
                <li key={a.id} className={`card message admin-message is-${status(a)}`}>
                  <div className="message-head">
                    <strong>{a.title}</strong>
                    <span className="chip chip-muted">{a.location_name ?? 'Everyone'}</span>
                  </div>
                  {a.body && <p className="message-body">{a.body}</p>}
                  <span className="muted small">
                    From {fmt(a.starts_at)}
                    {a.expires_at ? ` · hides ${fmt(a.expires_at)}` : ''}
                    {a.dismissible ? ` · dismissible · ${a.dismissals} dismissed` : ' · not dismissible'}
                    {a.archived ? ' · archived' : ''}
                    {a.created_by ? ` · by ${a.created_by}` : ''}
                  </span>
                  <div className="form-actions">
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => remove(a)}>Delete</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setArchived(a, !a.archived)}>{a.archived ? 'Restore' : 'Archive'}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => edit(a)}>Edit</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </section>
  );
}

/** Email everyone booked at a location on one day (weather, early closing). */
function DayEmail({ locations, onClose, onSent }: { locations: Location[]; onClose(): void; onSent(n: number): void }) {
  const [locationId, setLocationId] = useState(locations[0].id);
  const loc = locations.find((l) => l.id === locationId)!;
  const [date, setDate] = useState(todayIn(loc.timezone));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCount(null);
    emailDaysCustomers(locationId, date, '', '', true).then(setCount).catch((e: Error) => setError(e.message));
  }, [locationId, date]);

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      setError('Add a subject and a message.');
      return;
    }
    if (!window.confirm(`Email ${count} ${count === 1 ? 'customer' : 'customers'} now?`)) return;
    setSending(true);
    setError(null);
    try {
      onSent(await emailDaysCustomers(locationId, date, subject, body));
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <div className="card announcement-form day-email">
      <h2>Email a day’s customers</h2>
      <p className="muted small">Goes to everyone with a booking that day, for things like weather or closing early. Walk-in guests without an account don’t get it.</p>
      <div className="form-grid">
        <label className="field">
          <span>Location</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Day</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Subject</span>
        <input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} placeholder="Closing at 6 PM today" />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea rows={5} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Storm coming. Sessions after 6 PM are cancelled and refunded in full." />
      </label>
      <p className="small">{count === null ? 'Counting…' : count === 0 ? 'Nobody with an account is booked that day.' : <><strong>{count}</strong> {count === 1 ? 'customer' : 'customers'} will get this.</>}</p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
        <button className="btn btn-primary" onClick={send} disabled={sending || !count}>{sending ? 'Sending…' : 'Send email'}</button>
      </div>
    </div>
  );
}
