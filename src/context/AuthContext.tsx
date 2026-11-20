import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  setAuthTokens,
  clearAuthToken,
  getAuthToken,
  getRefreshToken,
  SessionExpiredError,
} from '../api/client.ts';
import type { UserProfile, UserWallet } from '../types/index.ts';
import { AuthModal } from '../components/auth/AuthModal.tsx';
import { ConfirmModal, type ConfirmModalVariant } from '../components/common/ConfirmModal.tsx';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import {
  saveCacheItem,
  getCacheItem,
  clearUserUiCache,
  type OfflineProfileUiSummary,
} from '../services/offlineCache.ts';

export interface ConfirmActionOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  onConfirm: () => Promise<void> | void;
}

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AuthContextType {
  user: UserProfile | null;
  wallet: UserWallet | null;
  isLoading: boolean;
  isOnline: boolean;
  isUsingOfflineSession: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  openAuthModal: (mode?: 'login' | 'register' | 'owner') => void;
  closeAuthModal: () => void;
  openConfirmModal: (options: ConfirmActionOptions) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toNonFinancialProfileSummary(u: UserProfile): OfflineProfileUiSummary {
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    role: u.role,
    status: u.status,
    referralCode: u.referralCode,
    city: u.city,
    countryFlag: u.countryFlag || null,
    countryNameAr: u.countryNameAr || null,
    locationPath: u.locationPath || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function persistNonFinancialProfileUi(u: UserProfile): void {
  const summary = toNonFinancialProfileSummary(u);
  saveCacheItem('profile_ui', summary).catch(() => {});
  try {
    localStorage.setItem('kasb_profile_ui', JSON.stringify(summary));
  } catch {
    // ignore quota errors
  }
}

async function readCachedNonFinancialProfile(): Promise<UserProfile | null> {
  const idbRec = await getCacheItem<OfflineProfileUiSummary>('profile_ui');
  if (idbRec?.value?.id) {
    return idbRec.value as unknown as UserProfile;
  }
  try {
    const raw = localStorage.getItem('kasb_profile_ui');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id) return parsed as UserProfile;
    }
  } catch {
    // ignore parse error
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isUsingOfflineSession, setIsUsingOfflineSession] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmActionOptions | null>(null);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);
  const isSyncingRef = useRef(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const openConfirmModal = useCallback((options: ConfirmActionOptions) => {
    setConfirmOptions(options);
  }, []);

  const handleConfirmExecute = async () => {
    if (!confirmOptions || isConfirmLoading) return;
    setIsConfirmLoading(true);
    try {
      await confirmOptions.onConfirm();
      setConfirmOptions(null);
    } catch (err: any) {
      setConfirmOptions(null);
      showToast(err?.message || 'تعذر إتمام العملية، يرجى المحاولة مجدداً.', 'error');
    } finally {
      setIsConfirmLoading(false);
    }
  };

  const handleConfirmCancel = useCallback(() => {
    if (isConfirmLoading) return;
    setConfirmOptions(null);
  }, [isConfirmLoading]);

  const loadCurrentUser = useCallback(async () => {
    if (isSyncingRef.current) return;
    const token = getAuthToken();
    const refreshToken = getRefreshToken();

    if (!token && !refreshToken) {
      setUser(null);
      setWallet(null);
      setIsUsingOfflineSession(false);
      setIsLoading(false);
      return;
    }

    isSyncingRef.current = true;
    try {
      // Hydrate non-financial profile shell early so PWA reopens seamlessly even offline or slow
      const cachedProfile = await readCachedNonFinancialProfile();
      if (cachedProfile) {
        setUser((prev) => prev || cachedProfile);
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsUsingOfflineSession(Boolean(cachedProfile));
        setWallet(null); // Never trust stale balances offline
        return;
      }

      const res = await api.getMe();
      setUser(res.user);
      setWallet(res.wallet);
      setIsUsingOfflineSession(false);
      if (res.user) {
        persistNonFinancialProfileUi(res.user);
      }
    } catch (err: any) {
      if (err instanceof SessionExpiredError) {
        clearAuthToken();
        await clearUserUiCache();
        setUser(null);
        setWallet(null);
        setIsUsingOfflineSession(false);
      } else {
        // Network / offline / transient 5xx / 404 error:
        // DO NOT clear tokens or log the user out!
        const cachedProfile = await readCachedNonFinancialProfile();
        if (cachedProfile) {
          setUser((prev) => prev || cachedProfile);
          setIsUsingOfflineSession(true);
        }
        setWallet(null);
      }
    } finally {
      isSyncingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      loadCurrentUser();
      window.dispatchEvent(new CustomEvent('kasb:sync_online'));
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadCurrentUser]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearAuthToken();
      clearUserUiCache().catch(() => {});
      setUser((prevUser) => {
        if (prevUser) {
          showToast('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.', 'error');
          setAuthMode('login');
          setIsAuthOpen(true);
        }
        return null;
      });
      setWallet(null);
      setIsUsingOfflineSession(false);
    };

    window.addEventListener('kasb:auth_expired', handleAuthExpired);
    return () => window.removeEventListener('kasb:auth_expired', handleAuthExpired);
  }, [showToast]);

  const login = async (identifier: string, pass: string) => {
    const res = await api.login({ identifier, password: pass });
    setAuthTokens(res.token, res.refreshToken);
    setUser(res.user);
    setWallet(res.wallet);
    setIsUsingOfflineSession(false);
    if (res.user) {
      persistNonFinancialProfileUi(res.user);
    }
    if (typeof window !== 'undefined' && res.user) {
      window.dispatchEvent(new CustomEvent('kasb:auth_success', { detail: { user: res.user } }));
    }
    showToast(`مرحباً بك، ${res.user.fullName}`, 'success');
  };

  const register = async (payload: any) => {
    const res = await api.register(payload);
    if (res.token) {
      setAuthTokens(res.token, res.refreshToken);
      setUser(res.user);
      setWallet(res.wallet);
      setIsUsingOfflineSession(false);
      if (res.user) {
        persistNonFinancialProfileUi(res.user);
      }
      if (typeof window !== 'undefined' && res.user) {
        window.dispatchEvent(new CustomEvent('kasb:auth_success', { detail: { user: res.user } }));
      }
      showToast('تم إنشاء وتفعيل حسابك بنجاح!', 'success');
    } else {
      clearAuthToken();
      await clearUserUiCache();
      showToast(res.message || 'تم إنشاء الحساب بنجاح. يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.', 'info');
    }
  };

  const logout = async () => {
    clearAuthToken();
    await clearUserUiCache();
    setUser(null);
    setWallet(null);
    setIsUsingOfflineSession(false);
    showToast('تم تسجيل الخروج بنجاح.', 'info');
  };

  const refreshWallet = async () => {
    if (!user || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    try {
      const res = await api.getMyWallet();
      setWallet(res.wallet);
    } catch (err) {
      console.error('Error refreshing wallet', err);
    }
  };

  const refreshUser = async () => {
    const token = getAuthToken();
    if (!token || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    try {
      const res = await api.getMe();
      setUser(res.user);
      if (res.wallet) setWallet(res.wallet);
      setIsUsingOfflineSession(false);
      if (res.user) {
        persistNonFinancialProfileUi(res.user);
      }
    } catch (err) {
      console.error('Error refreshing user', err);
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
  const latestToast = toasts.length > 0 ? toasts[toasts.length - 1] : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        isLoading,
        isOnline,
        isUsingOfflineSession,
        isAdmin,
        login,
        register,
        logout,
        refreshWallet,
        refreshUser,
        showToast,
        toast: latestToast ? { message: latestToast.message, type: latestToast.type } : null,
        openAuthModal,
        closeAuthModal,
        openConfirmModal,
      }}
    >
      {children}
      <AuthModal
        isOpen={isAuthOpen}
        defaultMode={authMode}
        onClose={closeAuthModal}
      />
      <ConfirmModal
        isOpen={Boolean(confirmOptions)}
        title={confirmOptions?.title || ''}
        message={confirmOptions?.message || ''}
        confirmLabel={confirmOptions?.confirmLabel}
        cancelLabel={confirmOptions?.cancelLabel}
        variant={confirmOptions?.variant}
        isLoading={isConfirmLoading}
        onConfirm={handleConfirmExecute}
        onCancel={handleConfirmCancel}
      />
      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-6 z-[100] flex flex-col gap-2 max-w-sm w-full sm:w-auto pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold border transition-all animate-in fade-in slide-in-from-bottom-2 ${
                t.type === 'success'
                  ? 'bg-slate-900 text-emerald-400 border-emerald-500/40'
                  : t.type === 'error'
                  ? 'bg-slate-900 text-rose-400 border-rose-500/40'
                  : 'bg-slate-900 text-slate-100 border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {t.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : t.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="leading-relaxed">{t.message}</span>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="إغلاق الإشعار"
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
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
