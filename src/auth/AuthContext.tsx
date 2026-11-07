import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileUpdateInput, SignInInput, SignUpInput, User } from '../types';
import { localAuthService, type AuthService } from './authService';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signUp(input: SignUpInput): Promise<void>;
  signIn(input: SignInInput): Promise<void>;
  signOut(): Promise<void>;
  updateProfile(input: ProfileUpdateInput): Promise<void>;
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

  const value = useMemo(
    () => ({ user, loading, signUp, signIn, signOut, updateProfile }),
    [user, loading, signUp, signIn, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
