import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import FormField from '../components/FormField';

/** Reached from the password reset email; the link signs the user in first. */
export default function ResetPassword() {
  const { user, loading, setNewPassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) {
    return (
      <div className="card auth-card">
        <h1>Link expired</h1>
        <p className="muted">This reset link is no longer valid. Request a new one and open it on this device.</p>
        <Link to="/forgot-password" className="btn btn-primary btn-block">Send a new link</Link>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await setNewPassword(password);
      navigate('/home', { replace: true, state: { passwordChanged: true } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Choose a new password</h1>
      <p className="muted">For @{user.username}.</p>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="New password" name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters" required />
        <FormField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  );
}
