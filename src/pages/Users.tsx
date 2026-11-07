import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ALL_ROLES, PRIVILEGES, ROLES, type Role } from '../auth/rbac';
import Can from '../components/Can';
import RoleChip from '../components/RoleChip';
import type { ManagedUser } from '../types';
import { initials } from '../utils/initials';

export default function Users() {
  const { user: me, listUsers } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.displayName, u.username, u.email, ...u.roles].some((v) => v.toLowerCase().includes(q)),
    );
  }, [users, query]);

  const onSaved = (updated: ManagedUser) =>
    setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));

  return (
    <section>
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
          placeholder="Search name, username, email or role"
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <ul className="user-list">
          {filtered.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.id === me?.id} onSaved={onSaved} />
          ))}
          {filtered.length === 0 && <li className="card muted">No users match “{query}”.</li>}
        </ul>
      )}

      <h2 className="section-title">Roles</h2>
      <div className="grid">
        {ALL_ROLES.map((r) => (
          <div className="card" key={r.name}>
            <RoleChip role={r.name} />
            <p className="muted role-desc">{r.description}</p>
            <ul className="privilege-list">
              {r.privileges.map((p) => <li key={p}><code>{p}</code></li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function UserRow({ user, isMe, onSaved }: { user: ManagedUser; isMe: boolean; onSaved(u: ManagedUser): void }) {
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
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved({ ...user, roles: await setUserRoles(user.id, selected) });
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
            {user.displayName} {isMe && <span className="muted you">(you)</span>}
          </span>
          <span className="user-handle">@{user.username} · {user.email}</span>
        </div>
        {!editing && (
          <div className="user-row-roles">
            <span className="chips">
              {user.roles.map((r) => <RoleChip key={r} role={r} />)}
            </span>
            <Can privilege={PRIVILEGES.USERS_MANAGE_ROLES}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(user.roles); setEditing(true); }}>
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
                    <strong>{r.name}</strong>
                    <span className="muted"> — {r.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
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
