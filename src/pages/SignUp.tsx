import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import FormField from '../components/FormField';

export default function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', displayName: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { needsEmailConfirmation } = await signUp({
        username: form.username,
        email: form.email,
        displayName: form.displayName,
        password: form.password,
      });
      if (needsEmailConfirmation) setSentTo(form.email.trim());
      else navigate('/home', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <div className="card auth-card">
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it on this device to finish creating your
          account.
        </p>
        <p className="muted">Didn't get it? Check your spam folder, or wait a minute and try signing up again.</p>
        <Link to="/signin" className="btn btn-ghost btn-block">Go to sign in</Link>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="Username" name="username" autoComplete="username" value={form.username} onChange={update('username')} hint="3–20 letters, numbers or underscores" required />
        <FormField label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} required />
        <FormField label="Display name" name="displayName" autoComplete="name" value={form.displayName} onChange={update('displayName')} required />
        <FormField label="Password" name="password" type="password" autoComplete="new-password" value={form.password} onChange={update('password')} hint="At least 8 characters" required />
        <FormField label="Confirm password" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={update('confirm')} required />
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p className="muted">Already have an account? <Link to="/signin">Sign in</Link></p>
    </div>
  );
}
