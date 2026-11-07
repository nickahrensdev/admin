import type { ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';

/**
 * Auth service contract. The app only talks to this interface, so the
 * localStorage mock below can be swapped for a real API client later
 * without touching any pages or components.
 */
export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  signUp(input: SignUpInput): Promise<User>;
  signIn(input: SignInInput): Promise<User>;
  signOut(): Promise<void>;
  updateProfile(userId: string, input: ProfileUpdateInput): Promise<User>;
}

/* ------------------------------------------------------------------ */
/* Mock implementation (browser-only, for development / demo).          */
/* GitHub Pages is static hosting, so there is no server here. Data     */
/* lives in this browser's localStorage. NOT secure — replace with a    */
/* real backend before storing real user data.                          */
/* ------------------------------------------------------------------ */

interface StoredUser extends User {
  passwordHash: string;
  salt: string;
}

const USERS_KEY = 'admin.users';
const SESSION_KEY = 'admin.session';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function toPublic({ id, username, email, displayName }: StoredUser): User {
  return { id, username, email, displayName };
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function validateFields(username: string, email: string, displayName: string) {
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username must be 3–20 characters: letters, numbers or underscores.');
  }
  if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
  if (!displayName.trim()) throw new Error('Display name is required.');
}

function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
}

function assertUnique(users: StoredUser[], username: string, email: string, ignoreId?: string) {
  const others = users.filter((u) => u.id !== ignoreId);
  if (others.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('That username is already taken.');
  }
  if (others.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with that email already exists.');
  }
}

export const localAuthService: AuthService = {
  async getCurrentUser() {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    const user = readUsers().find((u) => u.id === id);
    return user ? toPublic(user) : null;
  },

  async signUp({ username, email, password, displayName }) {
    username = username.trim();
    email = email.trim();
    validateFields(username, email, displayName);
    validatePassword(password);
    const users = readUsers();
    assertUnique(users, username, email);

    const salt = crypto.randomUUID();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      username,
      email,
      displayName: displayName.trim(),
      salt,
      passwordHash: await hashPassword(password, salt),
    };
    writeUsers([...users, user]);
    localStorage.setItem(SESSION_KEY, user.id);
    return toPublic(user);
  },

  async signIn({ identifier, password }) {
    const id = identifier.trim().toLowerCase();
    const user = readUsers().find(
      (u) => u.username.toLowerCase() === id || u.email.toLowerCase() === id,
    );
    if (!user || (await hashPassword(password, user.salt)) !== user.passwordHash) {
      throw new Error('Invalid username/email or password.');
    }
    localStorage.setItem(SESSION_KEY, user.id);
    return toPublic(user);
  },

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
  },

  async updateProfile(userId, input) {
    const users = readUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new Error('User not found.');

    const username = input.username.trim();
    const email = input.email.trim();
    validateFields(username, email, input.displayName);
    assertUnique(users, username, email, userId);

    const updated: StoredUser = {
      ...users[idx],
      username,
      email,
      displayName: input.displayName.trim(),
    };

    if (input.newPassword) {
      const current = users[idx];
      if (
        !input.currentPassword ||
        (await hashPassword(input.currentPassword, current.salt)) !== current.passwordHash
      ) {
        throw new Error('Current password is incorrect.');
      }
      validatePassword(input.newPassword);
      updated.salt = crypto.randomUUID();
      updated.passwordHash = await hashPassword(input.newPassword, updated.salt);
    }

    users[idx] = updated;
    writeUsers(users);
    return toPublic(updated);
  },
};
