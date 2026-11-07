import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Privilege } from '../auth/rbac';

interface Props {
  /** Show children if the user has this privilege. */
  privilege?: Privilege;
  /** Show children if the user has ANY of these privileges. */
  anyOf?: readonly Privilege[];
  /** Show children if the user has ALL of these privileges. */
  allOf?: readonly Privilege[];
  /** Rendered instead when access is denied (defaults to nothing). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Feature-level gate. Wrap any button, section or component that only
 * some users should see:
 *
 *   <Can privilege={PRIVILEGES.PROFILE_EDIT}><button>Edit</button></Can>
 */
export default function Can({ privilege, anyOf, allOf, fallback = null, children }: Props) {
  const { hasPrivilege, hasAnyPrivilege, hasAllPrivileges } = useAuth();
  const allowed =
    (privilege === undefined || hasPrivilege(privilege)) &&
    (anyOf === undefined || hasAnyPrivilege(anyOf)) &&
    (allOf === undefined || hasAllPrivileges(allOf));
  return <>{allowed ? children : fallback}</>;
}
