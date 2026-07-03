import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { bootstrapSession, logout as apiLogout, redirectToLogin } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    bootstrapSession().then((u) => {
      if (alive) { setUser(u); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout, login: redirectToLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
