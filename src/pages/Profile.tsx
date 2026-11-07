import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import FormField from '../components/FormField';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        username: form.username,
        email: form.email,
        displayName: form.displayName,
        currentPassword: form.currentPassword || undefined,
        newPassword: form.newPassword || undefined,
      });
      setForm((f) => ({ ...f, currentPassword: '', newPassword: '', confirmPassword: '' }));
      setSuccess('Profile updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card profile-card">
      <h1>Your profile</h1>
      <form onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Account details</legend>
          <FormField label="Username" name="username" autoComplete="username" value={form.username} onChange={update('username')} required />
          <FormField label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} required />
          <FormField label="Display name" name="displayName" autoComplete="name" value={form.displayName} onChange={update('displayName')} required />
        </fieldset>
        <fieldset>
          <legend>Change password <span className="muted">(optional)</span></legend>
          <FormField label="Current password" name="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={update('currentPassword')} />
          <FormField label="New password" name="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={update('newPassword')} hint="At least 8 characters" />
          <FormField label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')} />
        </fieldset>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {success && <p className="alert alert-success" role="status">{success}</p>}
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  );
}
