import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { myMembership, type MyMembership } from '../data/memberships';
import { currentWaiver, myWaiverStatus, type Waiver, type WaiverStatus } from '../data/waiver';
import { WaiverModal } from '../components/WaiverSign';
import { useAuth } from '../auth/AuthContext';
import { PRIVILEGES } from '../auth/rbac';
import Can from '../components/Can';
import RoleChip from '../components/RoleChip';
import FormField from '../components/FormField';
import type { User } from '../types';
import { initials } from '../utils/initials';

const emptyPasswords = { currentPassword: '', newPassword: '', confirmPassword: '' };

function formFromUser(user: User | null) {
  return {
    username: user?.username ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
    ...emptyPasswords,
  };
}

export default function Profile() {
  const { user, updateProfile, hasPrivilege } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formFromUser(user));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [waiverStatus, setWaiverStatus] = useState<WaiverStatus | null>(null);
  const [waiver, setWaiver] = useState<Waiver | null>(null);
  const [signing, setSigning] = useState(false);
  const loadWaiver = () => myWaiverStatus().then(setWaiverStatus).catch(() => setWaiverStatus(null));
  useEffect(() => {
    myMembership().then(setMembership).catch(() => setMembership(null));
    loadWaiver();
    currentWaiver().then(setWaiver).catch(() => setWaiver(null));
  }, []);

  if (!user) return null;

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const startEditing = () => {
    setForm(formFromUser(user));
    setError(null);
    setSuccess(null);
    setEditing(true);
  };

  const cancel = () => {
    setForm(formFromUser(user));
    setError(null);
    setEditing(false);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const { emailChangePending } = await updateProfile({
        username: form.username,
        email: form.email,
        displayName: form.displayName,
        currentPassword: form.currentPassword || undefined,
        newPassword: form.newPassword || undefined,
      });
      setEditing(false);
      setSuccess(
        emailChangePending
          ? `Profile updated. We sent a link to ${form.email.trim()} — your email changes once you open it.`
          : 'Profile updated.',
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card profile-card">
      <div className="profile-header">
        <span className="avatar avatar-lg" aria-hidden="true">{initials(user.displayName)}</span>
        <div className="profile-heading">
          <h1>{user.displayName}</h1>
          <span className="user-handle">@{user.username}</span>
        </div>
        {!editing && (
          <Can privilege={PRIVILEGES.PROFILE_EDIT}>
            <button className="btn btn-primary profile-edit-btn" onClick={startEditing}>
              Edit profile
            </button>
          </Can>
        )}
      </div>

      {success && !editing && <p className="alert alert-success" role="status">{success}</p>}
      {signing && waiver && (
        <WaiverModal
          waiver={waiver}
          defaultName={user.displayName}
          onClose={() => setSigning(false)}
          onSigned={() => {
            setSigning(false);
            setSuccess('Waiver signed. Thanks!');
            loadWaiver();
          }}
        />
      )}

      {!editing || !hasPrivilege(PRIVILEGES.PROFILE_EDIT) ? (
        <dl className="details">
          <div className="detail-row">
            <dt>Display name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div className="detail-row">
            <dt>Username</dt>
            <dd>@{user.username}</dd>
          </div>
          <div className="detail-row">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="detail-row">
            <dt>Membership</dt>
            <dd>
              {membership && membership.status !== 'canceled' ? (
                <Link to="/memberships">{membership.tier.name}{membership.status === 'past_due' ? ' (payment due)' : ''}</Link>
              ) : (
                <Link to="/memberships">None — see options</Link>
              )}
            </dd>
          </div>
          {waiverStatus?.required && (
            <div className="detail-row">
              <dt>Waiver</dt>
              <dd>
                {waiverStatus.signed && waiverStatus.current ? (
                  <>
                    Signed {new Date(waiverStatus.current.accepted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' '}by {waiverStatus.current.signer_name}
                    {waiverStatus.current.participants && <span className="muted"> · for {waiverStatus.current.participants}</span>}
                  </>
                ) : (
                  <>
                    <span className="chip chip-warn-solid">Not signed</span>{' '}
                    {waiver && <button className="link-button" onClick={() => setSigning(true)}>Sign now</button>}
                  </>
                )}
              </dd>
            </div>
          )}
          <div className="detail-row">
            <dt>Roles</dt>
            <dd className="chips">
              {user.roles.map((r) => <RoleChip key={r} role={r} />)}
            </dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <fieldset>
            <legend>Account details</legend>
            <FormField label="Display name" name="displayName" autoComplete="name" value={form.displayName} onChange={update('displayName')} required />
            <FormField label="Username" name="username" autoComplete="username" value={form.username} onChange={update('username')} hint="3–20 letters, numbers or underscores" required />
            <FormField label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} required />
          </fieldset>
          <fieldset>
            <legend>Change password <span className="muted">(optional)</span></legend>
            <FormField label="Current password" name="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={update('currentPassword')} />
            <FormField label="New password" name="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={update('newPassword')} hint="At least 8 characters" />
            <FormField label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')} />
          </fieldset>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
