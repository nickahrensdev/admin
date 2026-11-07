import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import FormField from '../components/FormField';

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="card auth-card">
        <h1>Check your email</h1>
        <p>
          If an account uses <strong>{email.trim()}</strong>, we've sent it a link to reset the password. Open it on
          this device.
        </p>
        <p className="muted">Didn't get it? Check your spam folder, or wait a minute and try again.</p>
        <Link to="/signin" className="btn btn-ghost btn-block">Back to sign in</Link>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h1>Reset password</h1>
      <p className="muted">Enter the email on your account and we'll send you a link to choose a new password.</p>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="muted"><Link to="/signin">Back to sign in</Link></p>
    </div>
  );
}
