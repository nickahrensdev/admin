import type { Privilege, Role } from './auth/rbac';

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  /** Optional, so the front desk can call about a booking. */
  phone?: string | null;
  /** Roles assigned to the user (one or more). */
  roles: Role[];
  /** Privileges granted by the user's roles, as reported by the database. */
  privileges: Privilege[];
  /** Extra privileges from roles given for specific locations, by location id. */
  locationPrivileges: Record<string, Privilege[]>;
}

export interface SignUpInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
  /** The waiver signed on the sign-up form (recorded when the account is created). */
  waiver?: { id: string; signerName: string; participants?: string };
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
  phone?: string;
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
