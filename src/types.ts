import type { Privilege, Role } from './auth/rbac';

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  /** Roles assigned to the user (one or more). */
  roles: Role[];
  /** Privileges granted by the user's roles, as reported by the database. */
  privileges: Privilege[];
}

export interface SignUpInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export interface SignInInput {
  /** Username or email */
  identifier: string;
  password: string;
}

export interface ProfileUpdateInput {
  username: string;
  email: string;
  displayName: string;
  /** Required only when changing the password */
  currentPassword?: string;
  newPassword?: string;
}

/** A user as seen on the admin Users page. */
export interface ManagedUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: Role[];
}
