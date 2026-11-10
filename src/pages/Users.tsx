import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCanOpen } from '../auth/useCanOpen';
import { ALL_ROLES, PRIVILEGES, PRIVILEGE_LABELS, ROLES, roleLabel, type Role } from '../auth/rbac';
import Can from '../components/Can';
import RoleChip from '../components/RoleChip';
import type { ManagedUser } from '../types';
import { initials } from '../utils/initials';
import { listLocations, type Location } from '../data/locations';
import { adminUserFlags, listLocationRoles, setLocationRoles, type LocationRole, type UserFlags } from '../data/staff';

export default function Users() {
  const { user: me, listUsers } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [locationRoles, setLocationRolesState] = useState<LocationRole[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [flags, setFlags] = useState<Map<string, UserFlags>>(new Map());
  const [show, setShow] = useState<'all' | 'staff' | 'members' | 'nowaiver' | 'new'>('all');

  const load = useCallback(async () => {
    try {
      const [u, lr, locs] = await Promise.all([listUsers(), listLocationRoles(), listLocations()]);
      adminUserFlags().then((f) => setFlags(new Map(f.map((x) => [x.user_id, x])))).catch(() => undefined);
      setUsers(u);
      setLocationRolesState(lr);
      setLocations(locs.filter((l) => l.is_active));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [listUsers]);

  useEffect(() => {
    load();
  }, [load]);

  const isStaff = useCallback(
    (u: ManagedUser) => u.roles.some((r) => r !== ROLES.APP_USER) || locationRoles.some((r) => r.user_id === u.id),
    [locationRoles],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const weekAgo = Date.now() - 7 * 86_400_000;
    return users.filter((u) => {
      const f = flags.get(u.id);
      if (show === 'staff' && !isStaff(u)) return false;
      if (show === 'members' && !f?.member_tier) return false;
      if (show === 'nowaiver' && f?.waiver_signed !== false) return false;
      if (show === 'new' && !(f && Date.parse(f.created_at) > weekAgo)) return false;
      if (!q) return true;
      return [u.displayName, u.username, u.email, f?.phone ?? '', f?.member_tier ?? '', ...u.roles.map(roleLabel)].some((v) => v.toLowerCase().includes(q));
    });
  }, [users, query, flags, show, isStaff]);
  const counts = {
    staff: users.filter(isStaff).length,
    members: users.filter((u) => flags.get(u.id)?.member_tier).length,
    nowaiver: users.filter((u) => flags.get(u.id)?.waiver_signed === false).length,
  };

  const onSaved = (updated: ManagedUser, managerAt: string[]) => {
    setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
    setLocationRolesState((list) => [
      ...list.filter((r) => !(r.user_id === updated.id && r.role === ROLES.LOCATION_MANAGER)),
      ...managerAt.map((id) => ({
        user_id: updated.id,
        role: ROLES.LOCATION_MANAGER,
        location_id: id,
        location_name: locations.find((l) => l.id === id)?.name ?? '',
      })),
    ]);
  };

  return (
    <section className="users-page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">
            {users.length} {users.length === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search name, email, phone or role"
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="filter-chips users-filters" role="radiogroup" aria-label="Show">
        {([['all', `Everyone · ${users.length}`], ['staff', `Staff · ${counts.staff}`], ['members', `Members · ${counts.members}`],
          ['nowaiver', `No waiver · ${counts.nowaiver}`], ['new', 'New this week']] as const).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={show === k} className={`filter-chip${show === k ? ' active' : ''}`} onClick={() => setShow(k)}>{label}</button>
        ))}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <ul className="user-list">
          {filtered.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isMe={u.id === me?.id}
              onSaved={onSaved}
              locations={locations}
              locationRoles={locationRoles.filter((r) => r.user_id === u.id)}
              flags={flags.get(u.id)}
            />
          ))}
          {filtered.length === 0 && <li className="card muted">No one matches.</li>}
        </ul>
      )}

      <details className="roles-help">
        <summary>What each role can do</summary>
        <div className="grid">
          {ALL_ROLES.map((r) => (
            <div className="card" key={r.name}>
              <RoleChip role={r.name} />
              <p className="muted role-desc">{r.description}</p>
              <ul className="privilege-list plain">
                {r.privileges.map((p) => <li key={p}>{PRIVILEGE_LABELS[p] ?? p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function UserRow({
  user,
  isMe,
  onSaved,
  locations,
  locationRoles,
  flags,
}: {
  user: ManagedUser;
  isMe: boolean;
  onSaved(u: ManagedUser, managerAt: string[]): void;
  locations: Location[];
  locationRoles: LocationRole[];
  flags?: UserFlags;
}) {
  const canOpen = useCanOpen();
  const canSeeBookings = canOpen({ privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL], anyLocation: true });
  const managerAt = locationRoles.filter((r) => r.role === ROLES.LOCATION_MANAGER).map((r) => r.location_id);
  const [selectedLocs, setSelectedLocs] = useState<string[]>(managerAt);
  const { setUserRoles, hasRole } = useAuth();
  const canManageSuper = hasRole(ROLES.SUPER_ADMIN);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Role[]>(user.roles);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (role: Role) =>
    setSelected((s) => (s.includes(role) ? s.filter((r) => r !== role) : [...s, role]));

  const cancel = () => {
    setSelected(user.roles);
    setSelectedLocs(managerAt);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const roles = await setUserRoles(user.id, selected);
      // A global LOCATION_MANAGER covers every location, so per-location picks are cleared.
      const locs = roles.includes(ROLES.LOCATION_MANAGER) ? [] : selectedLocs;
      await setLocationRoles(user.id, ROLES.LOCATION_MANAGER, locs);
      onSaved({ ...user, roles }, locs);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="card user-row">
      <div className="user-row-main">
        <span className="avatar" aria-hidden="true">{initials(user.displayName)}</span>
        <div className="user-row-text">
          <span className="user-name">
            {canSeeBookings ? <Link to={`/admin/bookings?user=${user.id}`} className="user-name-link">{user.displayName}</Link> : user.displayName}{' '}
            {isMe && <span className="muted you">(you)</span>}
          </span>
          <span className="user-handle">@{user.username} · {user.email}{flags?.phone ? ` · ${flags.phone}` : ''}</span>
          {flags && (
            <span className="chips user-flags">
              {flags.member_tier && <span className="chip chip-super">{flags.member_tier}</span>}
              {!flags.waiver_signed && <span className="chip chip-warn-solid">No waiver</span>}
              <span className="chip chip-muted">{flags.bookings} {flags.bookings === 1 ? 'booking' : 'bookings'}</span>
            </span>
          )}
        </div>
        {!editing && (
          <div className="user-row-roles">
            <span className="chips">
              {user.roles.filter((r) => r !== ROLES.APP_USER || (user.roles.length === 1 && locationRoles.length === 0)).map((r) => <RoleChip key={r} role={r} />)}
              {locationRoles.map((r) => (
                <span key={r.role + r.location_id} className="chip chip-muted">{roleLabel(r.role)} · {r.location_name}</span>
              ))}
            </span>
            <Can privilege={PRIVILEGES.USERS_MANAGE_ROLES}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(user.roles); setSelectedLocs(managerAt); setEditing(true); }}>
                Edit roles
              </button>
            </Can>
          </div>
        )}
      </div>

      {editing && (
        <div className="role-editor">
          <fieldset>
            <legend>Roles for @{user.username}</legend>
            {ALL_ROLES.map((r) => {
              const locked = r.name === ROLES.SUPER_ADMIN && !canManageSuper;
              return (
                <label key={r.name} className={`role-option${locked ? ' locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.name)}
                    disabled={locked}
                    onChange={() => toggle(r.name)}
                  />
                  <span>
                    <strong>{roleLabel(r.name)}</strong>
                    <span className="muted"> — {r.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {locations.length > 0 && (
            <fieldset>
              <legend>Front desk at</legend>
              {selected.includes(ROLES.LOCATION_MANAGER) ? (
                <p className="muted small">Every location (Front desk is checked above). Uncheck it to pick specific locations.</p>
              ) : (
                locations.map((l) => (
                  <label key={l.id} className="role-option">
                    <input
                      type="checkbox"
                      checked={selectedLocs.includes(l.id)}
                      onChange={() =>
                        setSelectedLocs((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))
                      }
                    />
                    <span>{l.name}</span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={cancel} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save roles'}</button>
          </div>
        </div>
      )}
    </li>
  );
}
