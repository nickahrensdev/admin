import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ManagedUser, ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';
import { localAuthService, type AuthService } from './authService';
import type { Privilege, Role } from './rbac';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signUp(input: SignUpInput): Promise<void>;
  signIn(input: SignInInput): Promise<void>;
  signOut(): Promise<void>;
  updateProfile(input: ProfileUpdateInput): Promise<void>;
  listUsers(): Promise<ManagedUser[]>;
  setUserRoles(userId: string, roles: Role[]): Promise<ManagedUser>;
  hasRole(role: Role): boolean;
  hasPrivilege(privilege: Privilege): boolean;
  /** True if the user has at least one of the privileges (true for an empty list). */
  hasAnyPrivilege(privileges: readonly Privilege[]): boolean;
  /** True if the user has every one of the privileges (true for an empty list). */
  hasAllPrivileges(privileges: readonly Privilege[]): boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({
  children,
  service = localAuthService,
}: {
  children: ReactNode;
  service?: AuthService;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    service.getCurrentUser().then(setUser).finally(() => setLoading(false));
  }, [service]);

  const signUp = useCallback(async (input: SignUpInput) => setUser(await service.signUp(input)), [service]);
  const signIn = useCallback(async (input: SignInInput) => setUser(await service.signIn(input)), [service]);
  const signOut = useCallback(async () => {
    await service.signOut();
    setUser(null);
  }, [service]);
  const updateProfile = useCallback(
    async (input: ProfileUpdateInput) => {
      if (!user) throw new Error('Not signed in.');
      setUser(await service.updateProfile(user.id, input));
    },
    [service, user],
  );

  const listUsers = useCallback(() => service.listUsers(), [service]);
  const setUserRoles = useCallback(
    async (userId: string, roles: Role[]) => {
      const updated = await service.setUserRoles(userId, roles);
      // Changing your own roles changes what you can see right away.
      if (userId === user?.id) setUser(await service.getCurrentUser());
      return updated;
    },
    [service, user?.id],
  );

  const access = useMemo(() => {
    const roles = new Set<string>(user?.roles ?? []);
    const privileges = new Set<string>(user?.privileges ?? []);
    return {
      hasRole: (role: Role) => roles.has(role),
      hasPrivilege: (p: Privilege) => privileges.has(p),
      hasAnyPrivilege: (ps: readonly Privilege[]) => ps.length === 0 || ps.some((p) => privileges.has(p)),
      hasAllPrivileges: (ps: readonly Privilege[]) => ps.every((p) => privileges.has(p)),
    };
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, signUp, signIn, signOut, updateProfile, listUsers, setUserRoles, ...access }),
    [user, loading, signUp, signIn, signOut, updateProfile, listUsers, setUserRoles, access],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
