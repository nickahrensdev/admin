import { useCallback } from 'react';
import { useAuth } from './AuthContext';
import type { Privilege } from './rbac';

export interface AccessRule {
  privileges: readonly Privilege[];
  /** Also allow privileges given for specific locations (the page then checks per location). */
  anyLocation?: boolean;
}

/** Decides whether a page (or nav item / launcher card) is available to the signed-in user. */
export function useCanOpen() {
  const { hasAllPrivileges, hasPrivilegeAnywhere } = useAuth();
  return useCallback(
    (rule: AccessRule) => (rule.anyLocation ? rule.privileges.every(hasPrivilegeAnywhere) : hasAllPrivileges(rule.privileges)),
    [hasAllPrivileges, hasPrivilegeAnywhere],
  );
}
