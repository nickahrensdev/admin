import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ManagedUser, ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';
import { supabaseAuthService, type AuthService } from './authService';
import { ROLES, type Privilege, type Role } from './rbac';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Resolves to true when the user must confirm their email before signing in. */
  signUp(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }>;
  signIn(input: SignInInput): Promise<void>;
  signOut(): Promise<void>;
  /** Resolves to true when an email change is waiting for confirmation. */
  updateProfile(input: ProfileUpdateInput): Promise<{ emailChangePending: boolean }>;
  listUsers(): Promise<ManagedUser[]>;
  setUserRoles(userId: string, roles: Role[]): Promise<Role[]>;
  requestPasswordReset(email: string): Promise<void>;
  setNewPassword(password: string): Promise<void>;
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
  service = supabaseAuthService,
}: {
  children: ReactNode;
  service?: AuthService;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await service.getCurrentUser());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    refresh();
    return service.onAuthChange(refresh);
  }, [service, refresh]);

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const result = await service.signUp(input);
      if (result.user) setUser(result.user);
      return { needsEmailConfirmation: result.needsEmailConfirmation };
    },
    [service],
  );
  const signIn = useCallback(async (input: SignInInput) => setUser(await service.signIn(input)), [service]);
  const signOut = useCallback(async () => {
    await service.signOut();
    setUser(null);
  }, [service]);
  const updateProfile = useCallback(
    async (input: ProfileUpdateInput) => {
      const result = await service.updateProfile(input);
      setUser(result.user);
      return { emailChangePending: result.emailChangePending };
    },
    [service],
  );

  const listUsers = useCallback(() => service.listUsers(), [service]);
  const setUserRoles = useCallback(
    async (userId: string, roles: Role[]) => {
      const updated = await service.setUserRoles(userId, roles);
      // Changing your own roles changes what you can see right away.
      if (userId === user?.id) await refresh();
      return updated;
    },
    [service, user?.id, refresh],
  );

  const requestPasswordReset = useCallback((email: string) => service.requestPasswordReset(email), [service]);
  const setNewPassword = useCallback((password: string) => service.setNewPassword(password), [service]);

  const access = useMemo(() => {
    const roles = new Set<string>(user?.roles ?? []);
    const privileges = new Set<string>(user?.privileges ?? []);
    // SUPER_ADMIN passes every privilege check, whatever other roles are assigned.
    const isSuper = roles.has(ROLES.SUPER_ADMIN);
    const has = (p: Privilege) => isSuper || privileges.has(p);
    return {
      hasRole: (role: Role) => roles.has(role),
      hasPrivilege: has,
      hasAnyPrivilege: (ps: readonly Privilege[]) => ps.length === 0 || ps.some(has),
      hasAllPrivileges: (ps: readonly Privilege[]) => ps.every(has),
    };
  }, [user]);

  const value = useMemo(
    () => ({
      user, loading, signUp, signIn, signOut, updateProfile, listUsers, setUserRoles,
      requestPasswordReset, setNewPassword, ...access,
    }),
    [user, loading, signUp, signIn, signOut, updateProfile, listUsers, setUserRoles, requestPasswordReset, setNewPassword, access],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
