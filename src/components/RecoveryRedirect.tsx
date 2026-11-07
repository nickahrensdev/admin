import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

const FLAG = 'the-yard.password-reset';

// Password reset links come back as …/the-yard/?reset=1&code=…; remember that
// before Supabase swaps the code for a session and tidies the URL.
if (new URLSearchParams(window.location.search).get('reset') === '1') {
  sessionStorage.setItem(FLAG, '1');
}

/** Sends people who followed a password reset link to the "new password" page. */
export default function RecoveryRedirect() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') sessionStorage.setItem(FLAG, '1');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && sessionStorage.getItem(FLAG) === '1') {
      sessionStorage.removeItem(FLAG);
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState(window.history.state, '', url.toString());
      navigate('/reset-password', { replace: true });
    }
  }, [user, navigate]);

  return null;
}
