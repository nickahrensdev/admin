import { FunctionsHttpError, type AuthError, type PostgrestError } from '@supabase/supabase-js';
import { APP_URL, supabase } from '../lib/supabase';
import type { ManagedUser, ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';
import { isPrivilege, isRole, type Role } from './rbac';

export interface SignUpResult {
  user: User | null;
  /** True when Supabase sent a confirmation email and there is no session yet. */
  needsEmailConfirmation: boolean;
}

export interface ProfileUpdateResult {
  user: User;
  /** True when a new email was requested; it changes after the link is clicked. */
  emailChangePending: boolean;
}

/**
 * Auth service contract. Pages and components only talk to this interface
 * (through useAuth), so the backend can change without touching them.
 */
export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  /** Calls back whenever the user signs in or out (in any tab). Returns an unsubscribe. */
  onAuthChange(callback: () => void): () => void;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(input: SignInInput): Promise<User>;
  signOut(): Promise<void>;
  updateProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult>;
  /** Requires users_view. */
  listUsers(): Promise<ManagedUser[]>;
  /** Requires users_manage_roles. Returns the user's new roles. */
  setUserRoles(userId: string, roles: Role[]): Promise<Role[]>;
  /** Emails a password reset link. Always succeeds for unknown emails too, so accounts can't be probed. */
  requestPasswordReset(email: string): Promise<void>;
  /** Sets a new password for the signed-in user (after following a reset link). */
  setNewPassword(password: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Validation shared with the database's own checks                    */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function validateFields(username: string, email: string, displayName: string) {
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username must be 3–20 characters: letters, numbers or underscores.');
  }
  if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
  if (!displayName.trim()) throw new Error('Display name is required.');
  if (displayName.trim().length > 80) throw new Error('Display name must be 80 characters or fewer.');
}

function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
}

/** Turns Supabase errors into messages a customer can act on. */
function friendly(error: AuthError | PostgrestError | Error): Error {
  const msg = error.message ?? 'Something went wrong.';
  const code = 'code' in error ? String(error.code ?? '') : '';
  if (code === '23505' || /duplicate key/i.test(msg)) return new Error('That username is already taken.');
  if (/invalid login credentials/i.test(msg)) return new Error('Invalid email or password.');
  if (/email not confirmed/i.test(msg)) {
    return new Error('Please confirm your email first. Check your inbox for the link we sent.');
  }
  if (/user already registered/i.test(msg)) return new Error('An account with that email already exists.');
  if (/rate limit/i.test(msg)) return new Error('Too many attempts. Please wait a minute and try again.');
  return new Error(msg);
}

async function usernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  if (error) throw friendly(error);
  return Boolean(data);
}

/* ------------------------------------------------------------------ */
/* Supabase implementation                                             */
/* ------------------------------------------------------------------ */

interface AccessRow {
  roles: string[];
  privileges: string[];
}

async function loadUser(): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const authUser = session.user;

  const [profileRes, accessRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, email').eq('id', authUser.id).single(),
    supabase.rpc('my_access'),
  ]);
  if (profileRes.error) throw friendly(profileRes.error);
  if (accessRes.error) throw friendly(accessRes.error);

  const access = (accessRes.data ?? { roles: [], privileges: [] }) as AccessRow;
  return {
    id: profileRes.data.id,
    username: profileRes.data.username,
    displayName: profileRes.data.display_name,
    email: authUser.email ?? profileRes.data.email,
    roles: access.roles.filter(isRole),
    privileges: access.privileges.filter(isPrivilege),
  };
}

export const supabaseAuthService: AuthService = {
  getCurrentUser: loadUser,

  onAuthChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Run outside Supabase's callback to avoid re-entrancy deadlocks.
        setTimeout(callback, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  },

  async signUp({ username, email, password, displayName }) {
    username = username.trim();
    email = email.trim();
    validateFields(username, email, displayName);
    validatePassword(password);
    if (!(await usernameAvailable(username))) throw new Error('That username is already taken.');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: APP_URL,
        data: { username, display_name: displayName.trim() },
      },
    });
    if (error) throw friendly(error);

    // Supabase returns a user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('An account with that email already exists.');
    }
    if (!data.session) return { user: null, needsEmailConfirmation: true };
    return { user: await loadUser(), needsEmailConfirmation: false };
  },

  async signIn({ identifier, password }) {
    identifier = identifier.trim();
    if (!identifier || !password) throw new Error('Enter your username or email and your password.');

    if (identifier.includes('@')) {
      const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) throw new Error('Invalid username/email or password.');
        throw friendly(error);
      }
    } else {
      // Usernames are resolved on the server so members' emails stay private.
      const { data, error } = await supabase.functions.invoke<{ access_token: string; refresh_token: string }>(
        'sign-in',
        { body: { identifier, password } },
      );
      if (error) {
        let message = 'Could not sign in. Please try again.';
        if (error instanceof FunctionsHttpError) {
          try {
            message = (await error.context.json()).error ?? message;
          } catch {
            /* keep the default message */
          }
        }
        throw new Error(message);
      }
      if (!data?.access_token || !data.refresh_token) throw new Error('Could not sign in. Please try again.');
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) throw friendly(sessionError);
    }

    const user = await loadUser();
    if (!user) throw new Error('Could not sign in. Please try again.');
    return user;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw friendly(error);
  },

  async updateProfile(input) {
    const current = await loadUser();
    if (!current) throw new Error('Not signed in.');

    const username = input.username.trim();
    const email = input.email.trim();
    validateFields(username, email, input.displayName);

    if (username.toLowerCase() !== current.username.toLowerCase() && !(await usernameAvailable(username))) {
      throw new Error('That username is already taken.');
    }

    if (input.newPassword) {
      validatePassword(input.newPassword);
      if (!input.currentPassword) throw new Error('Enter your current password to set a new one.');
      // Confirm the current password before changing it.
      const check = await supabase.auth.signInWithPassword({ email: current.email, password: input.currentPassword });
      if (check.error) throw new Error('Current password is incorrect.');
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ username, display_name: input.displayName.trim() })
      .eq('id', current.id);
    if (profileError) throw friendly(profileError);

    const emailChanged = email.toLowerCase() !== current.email.toLowerCase();
    if (emailChanged || input.newPassword) {
      const { error } = await supabase.auth.updateUser(
        { ...(emailChanged ? { email } : {}), ...(input.newPassword ? { password: input.newPassword } : {}) },
        { emailRedirectTo: APP_URL },
      );
      if (error) throw friendly(error);
    }

    const user = await loadUser();
    if (!user) throw new Error('Not signed in.');
    return { user, emailChangePending: emailChanged };
  },

  async listUsers() {
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) throw friendly(error);
    return (data ?? []).map(
      (u: { id: string; username: string; display_name: string; email: string; roles: string[] }) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        email: u.email,
        roles: u.roles.filter(isRole),
      }),
    );
  },

  async requestPasswordReset(email) {
    email = email.trim();
    if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${APP_URL}?reset=1` });
    if (error && /rate limit/i.test(error.message)) throw friendly(error);
    // Any other error (e.g. unknown email) is deliberately not shown.
  },

  async setNewPassword(password) {
    validatePassword(password);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (/different from the old password/i.test(error.message)) {
        throw new Error('Choose a password that is different from your current one.');
      }
      throw friendly(error);
    }
  },

  async setUserRoles(userId, roles) {
    const { data, error } = await supabase.rpc('set_user_roles', { p_user: userId, p_roles: roles });
    if (error) throw friendly(error);
    return ((data ?? []) as string[]).filter(isRole);
  },
};
