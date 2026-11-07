import type { ManagedUser, ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';
import { DEFAULT_ROLES, PRIVILEGES, ROLES, isRole, resolvePrivileges, type Privilege, type Role } from './rbac';

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
  /** Requires users_view. */
  listUsers(): Promise<ManagedUser[]>;
  /** Requires users_manage_roles. Returns the updated user. */
  setUserRoles(userId: string, roles: Role[]): Promise<ManagedUser>;
}

/* ------------------------------------------------------------------ */
/* Mock implementation (browser-only, for development / demo).          */
/* GitHub Pages is static hosting, so there is no server here. Data     */
/* lives in this browser's localStorage. NOT secure — replace with a    */
/* real backend before storing real user data.                          */
/* ------------------------------------------------------------------ */

interface StoredUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: Role[];
  passwordHash: string;
  salt: string;
}

const USERS_KEY = 'the-yard.users';
const SESSION_KEY = 'the-yard.session';

// One-time move of data saved under the app's old name.
for (const [oldKey, newKey] of [['admin.users', USERS_KEY], ['admin.session', SESSION_KEY]]) {
  const value = localStorage.getItem(oldKey);
  if (value !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value);
  localStorage.removeItem(oldKey);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function readUsers(): StoredUser[] {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[];
    // Accounts created before roles existed get the default roles.
    const migrated = users.map((u) => {
      const roles = (u.roles ?? []).filter(isRole);
      return { ...u, roles: roles.length ? roles : [...DEFAULT_ROLES] };
    });
    // Bootstrap: if nobody is a super admin yet, the oldest account becomes
    // one, so there is always someone with full access who can assign roles.
    if (migrated.length && !migrated.some((u) => u.roles.includes(ROLES.SUPER_ADMIN))) {
      migrated[0] = { ...migrated[0], roles: [...migrated[0].roles, ROLES.SUPER_ADMIN] };
    }
    return migrated;
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function toPublic({ id, username, email, displayName, roles }: StoredUser): User {
  return { id, username, email, displayName, roles: [...roles], privileges: resolvePrivileges(roles) };
}

function toManaged({ id, username, email, displayName, roles }: StoredUser): ManagedUser {
  return { id, username, email, displayName, roles: [...roles] };
}

/** Simulates the server-side check a real backend would do on each request. */
function requirePrivilege(users: StoredUser[], privilege: Privilege): StoredUser {
  const id = localStorage.getItem(SESSION_KEY);
  const actor = users.find((u) => u.id === id);
  if (!actor) throw new Error('Not signed in.');
  if (!resolvePrivileges(actor.roles).includes(privilege)) {
    throw new Error("You don't have permission to do that.");
  }
  return actor;
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
      roles: [...DEFAULT_ROLES],
      salt,
      passwordHash: await hashPassword(password, salt),
    };
    writeUsers([...users, user]);
    localStorage.setItem(SESSION_KEY, user.id);
    // Re-read so the admin bootstrap applies to the very first account.
    return toPublic(readUsers().find((u) => u.id === user.id) ?? user);
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

  async listUsers() {
    const users = readUsers();
    requirePrivilege(users, PRIVILEGES.USERS_VIEW);
    return users.map(toManaged);
  },

  async setUserRoles(userId, roles) {
    const users = readUsers();
    const actor = requirePrivilege(users, PRIVILEGES.USERS_MANAGE_ROLES);
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new Error('User not found.');

    const next = [...new Set(roles)].filter(isRole);
    if (next.length === 0) throw new Error('A user must have at least one role.');

    const hadSuper = users[idx].roles.includes(ROLES.SUPER_ADMIN);
    const hasSuper = next.includes(ROLES.SUPER_ADMIN);
    if (hadSuper !== hasSuper && !actor.roles.includes(ROLES.SUPER_ADMIN)) {
      throw new Error(`Only a super admin can grant or remove ${ROLES.SUPER_ADMIN}.`);
    }
    const otherSupers = users.filter((u, i) => i !== idx && u.roles.includes(ROLES.SUPER_ADMIN));
    if (hadSuper && !hasSuper && otherSupers.length === 0) {
      throw new Error('There must always be at least one super admin.');
    }

    users[idx] = { ...users[idx], roles: next };
    writeUsers(users);
    return toManaged(users[idx]);
  },
};
