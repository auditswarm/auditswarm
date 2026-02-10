'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuthFlow } from '@/hooks/useAuth';
import { getMe } from '@/lib/api';

interface User {
  id: string;
  walletAddress: string;
  defaultJurisdiction: string | null;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: false,
  authError: null,
  signIn: async () => {},
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { connected, publicKey, disconnect } = useWallet();
  const { authenticate } = useAuthFlow();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isAuthenticated = !!token && !!user;

  // Check for existing token on mount
  useEffect(() => {
    const stored = localStorage.getItem('auth_token');
    if (stored && connected) {
      setToken(stored);
      getMe()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('auth_token');
          setToken(null);
        });
    }
  }, [connected]);

  // Auto-sign-in when wallet connects (if no token)
  useEffect(() => {
    if (connected && publicKey && !token && !isLoading) {
      signIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey]);

  // Clear auth when wallet disconnects
  useEffect(() => {
    if (!connected) {
      setToken(null);
      setUser(null);
      setAuthError(null);
      localStorage.removeItem('auth_token');
    }
  }, [connected]);

  const signIn = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const jwt = await authenticate();
      if (jwt) {
        setToken(jwt);
        const userData = await getMe();
        setUser(userData);
      }
    } catch (err) {
      console.error('SIWS auth failed:', err);
      const message =
        err instanceof TypeError && err.message === 'Failed to fetch'
          ? 'Cannot reach the API server. Is the backend running?'
          : err instanceof Error
            ? err.message
            : 'Authentication failed';
      setAuthError(message);
      setToken(null);
      setUser(null);
      localStorage.removeItem('auth_token');
    } finally {
      setIsLoading(false);
    }
  }, [authenticate]);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    disconnect();
  }, [disconnect]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated,
        isLoading,
        authError,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
