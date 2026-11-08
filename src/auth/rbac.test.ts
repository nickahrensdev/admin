import { describe, expect, it } from 'vitest';
import { ALL_PRIVILEGES, PRIVILEGES, ROLE_DEFINITIONS, ROLES, isPrivilege, isRole } from './rbac';

describe('roles and privileges (mirror of the database)', () => {
  it('super admin has everything', () => {
    expect(ROLE_DEFINITIONS[ROLES.SUPER_ADMIN].privileges).toEqual(ALL_PRIVILEGES);
  });
  it('customers can book but not manage', () => {
    const p = ROLE_DEFINITIONS[ROLES.APP_USER].privileges;
    expect(p).toContain(PRIVILEGES.BOOKINGS_CREATE);
    expect(p).not.toContain(PRIVILEGES.BOOKINGS_MANAGE);
  });
  it('location managers run the front desk', () => {
    expect(ROLE_DEFINITIONS[ROLES.LOCATION_MANAGER].privileges).toEqual([PRIVILEGES.BOOKINGS_VIEW_ALL, PRIVILEGES.BOOKINGS_MANAGE]);
  });
  it('recognises known names only', () => {
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('OWNER')).toBe(false);
    expect(isPrivilege('reports_view')).toBe(true);
    expect(isPrivilege('drop_tables')).toBe(false);
  });
});
