import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setAuthToken, clearAuthToken, getAuthToken } from '../api/client.ts';
import type { UserProfile, UserWallet } from '../types/index.ts';
import { AuthModal } from '../components/auth/AuthModal.tsx';

interface AuthContextType {
  user: UserProfile | null;
  wallet: UserWallet | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  openAuthModal: (mode?: 'login' | 'register' | 'owner') => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const loadCurrentUser = async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setWallet(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await api.getMe();
      setUser(res.user);
      setWallet(res.wallet);
    } catch {
      clearAuthToken();
      setUser(null);
      setWallet(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const login = async (identifier: string, pass: string) => {
    const res = await api.login({ identifier, password: pass });
    setAuthToken(res.token);
    setUser(res.user);
    setWallet(res.wallet);
    showToast(`مرحباً بك، ${res.user.fullName}`, 'success');
  };

  const register = async (payload: any) => {
    const res = await api.register(payload);
    setAuthToken(res.token);
    setUser(res.user);
    setWallet(res.wallet);
    showToast('تم إنشاء وتفعيل حسابك بنجاح!', 'success');
  };

  const logout = async () => {
    clearAuthToken();
    setUser(null);
    setWallet(null);
    showToast('تم تسجيل الخروج بنجاح.', 'info');
  };

  const refreshWallet = async () => {
    if (!user) return;
    try {
      const res = await api.getMyWallet();
      setWallet(res.wallet);
    } catch (err) {
      console.error('Error refreshing wallet', err);
    }
  };

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'owner'>('login');

  const openAuthModal = (mode: 'login' | 'register' | 'owner' = 'login') => {
    setAuthMode(mode);
    setIsAuthOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthOpen(false);
  };

  const isAdmin = Boolean(user && user.role === 'admin');

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        isLoading,
        isAdmin,
        login,
        register,
        logout,
        refreshWallet,
        showToast,
        toast,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
      <AuthModal
        isOpen={isAuthOpen}
        defaultMode={authMode}
        onClose={closeAuthModal}
      />
      {toast && (
        <div
          role="alert"
          className={`fixed bottom-6 left-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-xl text-xs font-semibold border transition-all ${
            toast.type === 'success'
              ? 'bg-slate-900 text-emerald-400 border-emerald-500/40'
              : toast.type === 'error'
              ? 'bg-slate-900 text-rose-400 border-rose-500/40'
              : 'bg-slate-900 text-slate-100 border-slate-700'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
