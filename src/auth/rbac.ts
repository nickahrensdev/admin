/**
 * Role-based access control.
 *
 * - A user has one or more ROLES.
 * - A role grants one or more PRIVILEGES.
 * - Pages, nav items and individual features check PRIVILEGES (not roles),
 *   so a role's privileges can change without touching UI code.
 *
 * To add access for a new app/page/feature:
 *   1. Add a privilege to PRIVILEGES.
 *   2. Grant it to one or more roles in ROLE_DEFINITIONS (or add a new role).
 *   3. Gate the page in src/routes.tsx, or a feature with <Can privilege=...>.
 *
 * The database is the source of truth and enforces every rule
 * (supabase/migrations). This file mirrors the same roles and privileges so
 * the UI can decide what to show. When you add a privilege or role, add it
 * in a new migration AND here.
 */

export const PRIVILEGES = {
  HOME_VIEW: 'home_view',
  PROFILE_VIEW: 'profile_view',
  PROFILE_EDIT: 'profile_edit',
  USERS_VIEW: 'users_view',
  USERS_MANAGE_ROLES: 'users_manage_roles',
  LOCATIONS_MANAGE: 'locations_manage',
  BOOKINGS_CREATE: 'bookings_create',
  BOOKINGS_VIEW_ALL: 'bookings_view_all',
  BOOKINGS_MANAGE: 'bookings_manage',
  MEMBERSHIPS_MANAGE: 'memberships_manage',
  WAIVER_MANAGE: 'waiver_manage',
  REPORTS_VIEW: 'reports_view',
} as const;

export type Privilege = (typeof PRIVILEGES)[keyof typeof PRIVILEGES];

/** Every privilege in the app (new ones are picked up automatically). */
export const ALL_PRIVILEGES: Privilege[] = Object.values(PRIVILEGES);

export const ROLES = {
  APP_USER: 'APP_USER',
  /** Front desk. Can be given for all locations or per location. */
  LOCATION_MANAGER: 'LOCATION_MANAGER',
  ADMIN: 'ADMIN',
  /** Full access to every page and feature, regardless of other roles. */
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export interface RoleDefinition {
  name: Role;
  description: string;
  privileges: Privilege[];
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  [ROLES.APP_USER]: {
    name: ROLES.APP_USER,
    description: 'Default role given to every user at sign up.',
    privileges: [PRIVILEGES.HOME_VIEW, PRIVILEGES.PROFILE_VIEW, PRIVILEGES.PROFILE_EDIT, PRIVILEGES.BOOKINGS_CREATE],
  },
  [ROLES.LOCATION_MANAGER]: {
    name: ROLES.LOCATION_MANAGER,
    description: 'Runs the front desk: daily schedule, check-in, walk-ins, blocked time and cancellations. Give it for all locations or only some.',
    privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL, PRIVILEGES.BOOKINGS_MANAGE],
  },
  [ROLES.ADMIN]: {
    name: ROLES.ADMIN,
    description: 'Can view all users and assign their roles.',
    privileges: [PRIVILEGES.USERS_VIEW, PRIVILEGES.USERS_MANAGE_ROLES],
  },
  [ROLES.SUPER_ADMIN]: {
    name: ROLES.SUPER_ADMIN,
    description: 'Full access to every page and feature, including ones added later. Only a super admin can grant or remove this role.',
    privileges: ALL_PRIVILEGES,
  },
};

/** All roles, in display order. */
export const ALL_ROLES = Object.values(ROLE_DEFINITIONS);

export function isRole(value: string): value is Role {
  return value in ROLE_DEFINITIONS;
}

export function isPrivilege(value: string): value is Privilege {
  return (ALL_PRIVILEGES as string[]).includes(value);
}
