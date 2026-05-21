'use client';

import React, {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import {
  ApiError, auth as authApi, getStoredToken, getStoredUser, setStoredToken, setStoredUser,
  setUnauthorizedHandler,
} from '../api/client';
import { AdminUser } from '../api/types';

interface AuthState {
  user: AdminUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setStoredToken(null);
    setStoredUser(null);
    setToken(null);
    setUser(null);
  }, []);

  // Hydrate from localStorage on mount, then verify token by hitting /me.
  useEffect(() => {
    const t = getStoredToken();
    const u = getStoredUser();
    if (!t) {
      setLoading(false);
      return;
    }
    setToken(t);
    setUser(u);
    authApi.me()
      .then((freshUser) => {
        setUser(freshUser);
        setStoredUser(freshUser);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) logout();
      })
      .finally(() => setLoading(false));
  }, [logout]);

  // Wire 401-from-anywhere to clear local session.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setStoredToken(result.token);
    setStoredUser(result.user);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
