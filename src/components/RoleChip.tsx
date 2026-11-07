import { ROLES } from '../auth/rbac';

export default function RoleChip({ role }: { role: string }) {
  return <span className={`chip${role === ROLES.SUPER_ADMIN ? ' chip-super' : ''}`}>{role}</span>;
}
