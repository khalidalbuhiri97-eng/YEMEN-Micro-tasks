import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
  Wallet,
  Sparkles,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { AppNotification } from '../../types/index.ts';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';

const SOUND_MUTE_KEY = 'yt_notif_sound_muted';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function playSubtleNotificationChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 400);
  } catch {
    // Autoplay or device silent mode cleanly ignored
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `منذ ${mins} د`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `منذ ${hours} س`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `منذ ${days} يوم`;
    return new Date(iso).toLocaleDateString('ar-YE');
  } catch {
    return '';
  }
}

function getNotificationIcon(type: string) {
  const upper = String(type || '').toUpperCase();
  if (upper.includes('REJECT')) {
    return <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />;
  }
  if (upper.includes('WITHDRAWAL') || upper.includes('TRANSFER') || upper.includes('WALLET')) {
    return <Wallet className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  if (upper.includes('CLIXWALL') || upper.includes('REFERRAL')) {
    return <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  }
  return <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
}

interface NotificationBellProps {
  onNavigate?: (tab: string) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigate }) => {
  const { user, isOnline, showToast } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Web Push real subscription state
  const pushSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const [permissionState, setPermissionState] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushConfig, setPushConfig] = useState<{
    checked: boolean;
    configured: boolean;
    publicKey: string | null;
    reason?: string;
  }>({ checked: false, configured: false, publicKey: null });

  const knownIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedRef = useRef(false);

  const toggleSound = () => {
    const next = !isSoundMuted;
    setIsSoundMuted(next);
    try {
      localStorage.setItem(SOUND_MUTE_KEY, next ? '1' : '0');
    } catch {}
    if (!next) {
      playSubtleNotificationChime();
    }
  };

  const syncPushStatus = useCallback(async () => {
    if (!user || !pushSupported) return;
    if ('Notification' in window) {
      setPermissionState(Notification.permission);
    }
    try {
      const [cfg, reg] = await Promise.all([
        api.getPushConfig().catch(() => ({ configured: false, publicKey: null, reason: 'تعذر التحقق من الخادم.' })),
        navigator.serviceWorker.ready.catch(() => null),
      ]);
      setPushConfig({
        checked: true,
        configured: Boolean(cfg?.configured),
        publicKey: cfg?.publicKey || null,
        reason: cfg?.reason,
      });
      if (reg?.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(Boolean(sub));
      }
    } catch {
      setPushConfig({ checked: true, configured: false, publicKey: null });
    }
  }, [user, pushSupported]);

  useEffect(() => {
    if (user && isOnline) {
      syncPushStatus();
    }
  }, [user, isOnline, syncPushStatus]);

  const handleEnablePush = async () => {
    if (!pushSupported) {
      showToast('متصفحك الحالي لا يدعم إشعارات الخلفية (Web Push).', 'info');
      return;
    }
    if (!pushConfig.configured || !pushConfig.publicKey) {
      showToast(
        pushConfig.reason || 'إشعارات الخلفية بانتظار ضبط مفاتيح VAPID على الخادم.',
        'info'
      );
      return;
    }
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermissionState(perm);
      if (perm !== 'granted') {
        showToast('لم يتم منح إذن الإشعارات في المتصفح.', 'info');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey) as unknown as BufferSource,
        });
      }
      await api.subscribePush(sub.toJSON());
      setPushSubscribed(true);
      showToast('تم تفعيل الإشعارات الفورية في الخلفية بنجاح!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تفعيل إشعارات الخلفية.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!pushSupported) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      await api.unsubscribePush(endpoint).catch(() => {});
      setPushSubscribed(false);
      showToast('تم إيقاف إشعارات الخلفية لهذا الجهاز.', 'info');
    } catch (err: any) {
      showToast(err?.message || 'تعذر إيقاف إشعارات الخلفية.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      knownIdsRef.current.clear();
      hasHydratedRef.current = false;
      return;
    }
    if (!isOnline) {
      const cached = await getCacheItem<AppNotification[]>('notifications_ui');
      if (cached?.value && Array.isArray(cached.value)) {
        setNotifications(cached.value);
      }
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.getNotifications();
      const list: AppNotification[] = Array.isArray(res?.notifications) ? res.notifications : [];

      if (hasHydratedRef.current) {
        const hasNewUnread = list.some((n) => !n.isRead && !knownIdsRef.current.has(n.id));
        if (hasNewUnread && !isSoundMuted) {
          playSubtleNotificationChime();
        }
      }

      knownIdsRef.current = new Set(list.map((n) => n.id));
      hasHydratedRef.current = true;

      setNotifications(list);
      saveCacheItem('notifications_ui', list.slice(0, 30)).catch(() => {});
    } catch {
      const cached = await getCacheItem<AppNotification[]>('notifications_ui');
      if (cached?.value && Array.isArray(cached.value)) {
        setNotifications(cached.value);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, isOnline, isSoundMuted]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Visibility-aware polling (every 45s while visible & online & logged in)
  useEffect(() => {
    if (!user) return;
    const poll = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        fetchNotifications();
      }
    };
    const interval = window.setInterval(poll, 45000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        fetchNotifications();
      }
    };
    const onOnlineSync = () => fetchNotifications();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('kasb:sync_online', onOnlineSync);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('kasb:sync_online', onOnlineSync);
    };
  }, [user, fetchNotifications]);

  if (!user) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkSingleRead = async (notif: AppNotification) => {
    if (!notif.isRead && isOnline) {
      setNotifications((prev) =>
        prev.map((item) => (item.id === notif.id ? { ...item, isRead: true } : item))
      );
      api.readNotification(notif.id).catch(() => {});
    }

    if (notif.link && onNavigate) {
      if (notif.link.includes('wallet') || notif.link.includes('withdraw')) onNavigate('wallet');
      else if (notif.link.includes('advertiser')) onNavigate('advertiser');
      else if (notif.link.includes('dashboard')) onNavigate('dashboard');
      setIsOpen(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || !isOnline || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      await api.readAllNotifications();
    } catch {
      // ignore non-critical
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next) {
            fetchNotifications();
            syncPushStatus();
          }
        }}
        aria-label="الإشعارات"
        title="الإشعارات"
        className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-slate-950 font-mono font-extrabold text-[10px] flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/20 sm:bg-transparent" onClick={() => setIsOpen(false)} />
          <div className="fixed sm:absolute left-3 right-3 sm:right-auto sm:left-0 top-16 sm:top-full sm:mt-2 sm:w-96 max-h-[78vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/80 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  الإشعارات ({unreadCount} غير مقروء)
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleSound}
                  title={isSoundMuted ? 'تشغيل صوت الإشعارات' : 'كتم صوت الإشعارات'}
                  aria-label={isSoundMuted ? 'تشغيل صوت الإشعارات' : 'كتم صوت الإشعارات'}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isSoundMuted
                      ? 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                      : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                  }`}
                >
                  {isSoundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                {unreadCount > 0 && isOnline && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={isMarkingAll}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>تحديد الكل كمقروء</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={fetchNotifications}
                  title="تحديث الإشعارات"
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="إغلاق الإشعارات"
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg sm:hidden"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Background Web Push Status & Controls */}
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
              {!pushSupported ? (
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  <span>المتصفح لا يدعم إشعارات الخلفية (Web Push)</span>
                </span>
              ) : permissionState === 'denied' ? (
                <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  <span>تم حظر الإشعارات — فعّلها من إعدادات المتصفح.</span>
                </span>
              ) : pushConfig.checked && !pushConfig.configured ? (
                <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  <span>إشعارات الخلفية بانتظار تهيئة مفاتيح VAPID على الخادم</span>
                </span>
              ) : pushSubscribed ? (
                <>
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                    <BellRing className="w-3.5 h-3.5 shrink-0" />
                    <span>إشعارات الخلفية مفعّلة لهذا الجهاز</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleDisablePush}
                    disabled={pushBusy}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold hover:text-rose-600 transition-colors shrink-0"
                  >
                    إيقاف
                  </button>
                </>
              ) : (
                <>
                  <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <BellRing className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>استقبل تنبيهات المكافآت والمهام حتى عند إغلاق التطبيق</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleEnablePush}
                    disabled={pushBusy || !isOnline}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition-colors shrink-0"
                  >
                    {pushBusy ? '...' : 'تفعيل'}
                  </button>
                </>
              )}
            </div>

            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
              {notifications.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  لا توجد إشعارات جديدة حالياً.
                </div>
              ) : (
                notifications.slice(0, 25).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleMarkSingleRead(n)}
                    className={`w-full text-right px-4 py-3 flex items-start gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      !n.isRead ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''
                    }`}
                  >
                    <div className="mt-0.5">{getNotificationIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs truncate ${
                            !n.isRead
                              ? 'font-extrabold text-slate-900 dark:text-white'
                              : 'font-semibold text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed text-right">
                        {n.message}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
