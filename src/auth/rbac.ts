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
 * NOTE: checks in the browser only control what the UI shows. Once there is a
 * backend, it must enforce the same privileges on every request.
 */

export const PRIVILEGES = {
  HOME_VIEW: 'home_view',
  PROFILE_VIEW: 'profile_view',
  PROFILE_EDIT: 'profile_edit',
} as const;

export type Privilege = (typeof PRIVILEGES)[keyof typeof PRIVILEGES];

export const ROLES = {
  APP_USER: 'APP_USER',
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
    privileges: [PRIVILEGES.HOME_VIEW, PRIVILEGES.PROFILE_VIEW, PRIVILEGES.PROFILE_EDIT],
  },
};

/** Roles every new account receives at sign up. */
export const DEFAULT_ROLES: Role[] = [ROLES.APP_USER];

export function isRole(value: string): value is Role {
  return value in ROLE_DEFINITIONS;
}

/** Union of all privileges granted by the given roles (unknown roles are ignored). */
export function resolvePrivileges(roles: readonly string[]): Privilege[] {
  const set = new Set<Privilege>();
  for (const role of roles) {
    if (isRole(role)) ROLE_DEFINITIONS[role].privileges.forEach((p) => set.add(p));
  }
  return [...set];
}
