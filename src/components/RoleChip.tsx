import { ROLES, roleLabel } from '../auth/rbac';

export default function RoleChip({ role }: { role: string }) {
  return <span className={`chip${role === ROLES.SUPER_ADMIN ? ' chip-super' : ''}`} title={role}>{roleLabel(role)}</span>;
}
