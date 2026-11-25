import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Eye,
  Film,
  Flame,
  Gift,
  Layers,
  Link2,
  Loader2,
  LockKeyhole,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X
} from 'lucide-react';
import {
  ytCoinService,
  ytFormat,
  type YtAd,
  type YtCoinService,
  type YtMetrics,
  type YtRefreshScope,
  type YtWallet
} from './ytCoinService.ts';

type Props = {
  compact?: boolean;
  onOpen?: () => void;
  onExit?: () => void;
  onOpenEarnAds?: () => void;
  initialTab?: 'market' | 'wallet' | 'mine' | 'admin';
  user?: { id: string; referralCode?: string | null } | null;
  isAdmin?: boolean;
  onLogin?: () => void;
  service?: YtCoinService;
};

type Tab = 'mine' | 'wallet' | 'market' | 'referrals' | 'settings' | 'admin';

const usd = (v: number) => '$' + Number(v || 0).toFixed(6);
const usdShort = (v: number) =>
  '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const ytc = (v: number) => ytFormat(v);

const msg = (e: any) => {
  const s = String(e?.message || e || '');
  const map: [string, string][] = [
    ['AD_ALREADY_COMPLETED_TODAY', 'أكملت هذا الإعلان اليوم. يمكنك العودة إليه غداً.'],
    ['AD_DURATION_NOT_COMPLETED', 'لم تنتهِ مدة الإعلان بعد. انتظر اكتمال العداد ثم تحقق.'],
    ['SESSION_NOT_PENDING', 'هذه الجلسة لم تعد صالحة. ابدأ جلسة جديدة.'],
    ['SESSION_EXPIRED', 'انتهت صلاحية جلسة الإعلان. ابدأ من جديد.'],
    ['PIN_NOT_SET_OR_INVALID', 'رمز الحماية PIN غير مضبوط أو غير صحيح.'],
    ['CURRENT_PIN_INVALID', 'رمز الحماية الحالي غير صحيح.'],
    ['INSUFFICIENT_LIQUIDITY', 'رصيد صندوق السيولة لا يكفي للتسييل.'],
    ['INSUFFICIENT_MINED_BALANCE', 'رصيد التعدين غير كافٍ.'],
    ['INSUFFICIENT_WITHDRAWABLE_BALANCE', 'الرصيد القابل للسحب غير كافٍ.'],
    ['MANAGER_WALLET_NOT_CONFIGURED', 'لم يتم تعيين محفظة المدير بعد.'],
    ['ADMIN_REQUIRED', 'هذه العملية متاحة للإدارة فقط.'],
    ['WALLET_FROZEN', 'المحفظة مجمدة أو غير نشطة.'],
    ['MINING_ALLOCATION_EXHAUSTED', 'انتهى رصيد مخصص التعدين.'],
    ['INVALID_AMOUNT_PRECISION', 'المبلغ يجب أن يحتوي على خمس خانات عشرية كحد أقصى.'],
    ['TRADING_PHASE_LOCKED', 'التداول والسحب الخارجي مغلقان خلال مرحلة الإطلاق.'],
    ['INVALID_WALLET_ADDRESS', 'عنوان محفظة TSK Pay غير صحيح.'],
    ['DAILY_CLICK_ALREADY_CLAIMED', 'سبق تسجيل هذه النقرة اليوم، ولم تتم إضافة مكافأة مكررة.'],
    ['yt_daily_click_claims_pkey', 'سبق تسجيل هذه النقرة اليوم، ولم تتم إضافة مكافأة مكررة.'],
    ['duplicate key value violates unique constraint', 'هذه العملية مسجلة مسبقاً، ولم تتم إضافة مكافأة مكررة.'],
    ['LIQUIDITY_POOL_NOT_FOUND', 'سجل صندوق السيولة غير موجود في قاعدة البيانات.'],
    ['INVALID_REVENUE_AMOUNT', 'أدخل مبلغ إيرادات صحيح أكبر من الصفر.'],
    ['AD_NOT_FOUND', 'الإعلان غير موجود أو تم حذفه مسبقاً من قاعدة البيانات.'],
    ['WALLET_NOT_FOUND', 'لم يتم العثور على محفظة Taska Coin لهذا الحساب.'],
    ['PRICE_NOT_AVAILABLE', 'تعذر تحديد السعر اللحظي لعملة Taska Coin حالياً.'],
    ['AD_DELETE_REQUIRES_MIGRATION', 'دالة الحذف النهائي لم تُطبّق بعد على قاعدة البيانات. يرجى تنفيذ ملف الترحيل 20261202000000 على Supabase.']
  ];
  return map.find(([k]) => s.includes(k))?.[1] || s;
};

export const YtEcosystemApp: React.FC<Props> = ({
  compact = false,
  onOpen,
  onExit,
  initialTab = 'mine',
  user = null,
  isAdmin = false,
  onLogin,
  service
}) => {
  const api = service || ytCoinService;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [metrics, setMetrics] = useState<YtMetrics | null>(null);
  const [wallet, setWallet] = useState<YtWallet | null>(null);
  const [adminWallets, setAdminWallets] = useState<any[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>(null);
  const [ads, setAds] = useState<YtAd[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [dailyClickClaims, setDailyClickClaims] = useState<number[]>([]);
  const [dailyCheckinClaimed, setDailyCheckinClaimed] = useState(false);
  const [ledger, setLedger] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [startingAdId, setStartingAdId] = useState<string | null>(null);
  const [pendingClickNo, setPendingClickNo] = useState<number | null>(null);
  const [confirmDeleteAdId, setConfirmDeleteAdId] = useState<string | null>(null);
  const [deletingAdId, setDeletingAdId] = useState<string | null>(null);
  const [togglingAdId, setTogglingAdId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [pendingAdAction, setPendingAdAction] = useState<{ ad: YtAd; purpose: 'reward' | 'liquidation' } | null>(null);
  const bannerAdRef = useRef<HTMLDivElement | null>(null);

  // تحميل Social Bar فقط عند الأحداث المحددة، ومنع إضافة السكربت أكثر من مرة.
  const triggerSocialBar = useCallback(() => {
    const src = 'https://bauval.org/14/df85fec7cf4e0f5cf87b135ab4f1bcd3';
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.dataset.cfasync = 'false';
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const notify = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setNotice({ text, type });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const copyWalletAddress = async () => {
    const address = String(wallet?.pay_id || '');
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      notify('تم نسخ عنوان محفظتك بنجاح.', 'success');
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      notify('تعذر نسخ العنوان تلقائياً.', 'error');
    }
  };

  const shortWalletAddress = (address: string) =>
    address.length > 18 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;

  const [session, setSession] = useState<{
    token: string;
    purpose: 'reward' | 'liquidation';
    adId: string;
    adTitle: string;
    startedAt: number;
    requiredSeconds: number;
    adUrl: string | null;
    adCode: string | null;
  } | null>(null);

  const [liquidationToken, setLiquidationToken] = useState('');
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [liquidateAmount, setLiquidateAmount] = useState('0.01000');
  const [payId, setPayId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [deposit, setDeposit] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('');
  const [payoutDestination, setPayoutDestination] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [withdrawalNote, setWithdrawalNote] = useState('');
  const [managerPayId, setManagerPayId] = useState('');
  const [freezePayId, setFreezePayId] = useState('');

  const [adDraft, setAdDraft] = useState({
    title: '',
    ad_type: 'video' as 'video' | 'smart_link' | 'banner_ad',
    ad_url: '',
    ad_code: '',
    reward_yt: '0.01000',
    duration_seconds: '15',
    is_active: true
  });
  const [adTypeFilter, setAdTypeFilter] = useState<'all' | 'video' | 'smart_link' | 'banner_ad'>('all');
  const [adminSubTab, setAdminSubTab] = useState<'ads' | 'revenue' | 'withdrawals' | 'wallets'>('ads');

  const [phase, setPhase] = useState<any>(null);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  const bgRefreshTimerRef = useRef<number | null>(null);
  const pendingScopeRef = useRef<YtRefreshScope | null>(null);
  const actionLocksRef = useRef<Set<string>>(new Set());
  const adminWalletsLoadedRef = useRef(false);

  const applyDashboardPatch = useCallback((d: any) => {
    if (!d) return;
    if (d.metrics !== undefined) setMetrics(d.metrics);
    if (d.wallet !== undefined) setWallet(d.wallet);
    if (d.adminWallets !== undefined) setAdminWallets(d.adminWallets || []);
    if (d.systemSettings !== undefined) setSystemSettings(d.systemSettings || null);
    if (d.ads !== undefined) setAds(d.ads);
    if (d.allocations !== undefined) setAllocations(d.allocations);
    if (d.history !== undefined) setHistory(d.history);
    if (d.claims !== undefined) setClaims(d.claims);
    if (d.dailyClickClaims !== undefined) {
      setDailyClickClaims((d.dailyClickClaims || []).map((c: any) => Number(c.click_no ?? c)));
    }
    if (d.dailyCheckinClaimed !== undefined) setDailyCheckinClaimed(Boolean(d.dailyCheckinClaimed));
    if (d.ledger !== undefined) setLedger(d.ledger);
    if (d.withdrawals !== undefined) setWithdrawals(d.withdrawals);
    if (d.phase !== undefined) setPhase(d.phase);
    if (d.referrals !== undefined) setReferralStats(d.referrals);
  }, []);

  const refresh = useCallback(
    async (scope: YtRefreshScope = 'full') => {
      if (!user?.id) return;
      setIsRefreshing(true);
      try {
        const d =
          scope === 'full' || !api.loadQuickState
            ? await api.loadDashboard(user.id, isAdmin)
            : await api.loadQuickState(user.id, scope, isAdmin);
        applyDashboardPatch(d);
      } finally {
        setIsRefreshing(false);
      }
    },
    [user?.id, isAdmin, api, applyDashboardPatch]
  );

  // تحديث خلفي غير حاجب للواجهة مع دمج الطلبات المتتالية السريعة
  const scheduleBackgroundRefresh = useCallback(
    (scope: YtRefreshScope = 'mining') => {
      if (!user?.id) return;
      if (pendingScopeRef.current && pendingScopeRef.current !== scope) {
        pendingScopeRef.current = 'full';
      } else {
        pendingScopeRef.current = scope;
      }
      if (bgRefreshTimerRef.current) {
        window.clearTimeout(bgRefreshTimerRef.current);
      }
      bgRefreshTimerRef.current = window.setTimeout(() => {
        const targetScope = pendingScopeRef.current || scope;
        pendingScopeRef.current = null;
        bgRefreshTimerRef.current = null;
        void refresh(targetScope).catch(() => undefined);
      }, 180);
    },
    [user?.id, refresh]
  );

  useEffect(() => {
    return () => {
      if (bgRefreshTimerRef.current) {
        window.clearTimeout(bgRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    adminWalletsLoadedRef.current = false;
    // عرض فوري من الكاش المحلي أثناء جلب التحديث الحي في الخلفية
    const cached = api.getCachedDashboard?.(user.id);
    if (cached) {
      applyDashboardPatch(cached);
    }
    refresh('full').catch((e) => notify(msg(e), 'error'));
  }, [user?.id, api, applyDashboardPatch, refresh, notify]);

  // تحميل قائمة محافظ الإدارة عند فتح تبويب الإدارة فقط لتقليل استعلامات التحميل الأولي
  useEffect(() => {
    if (!user?.id || !isAdmin || tab !== 'admin' || adminWalletsLoadedRef.current) return;
    adminWalletsLoadedRef.current = true;
    void refresh('admin_wallets').catch(() => {
      adminWalletsLoadedRef.current = false;
    });
  }, [user?.id, isAdmin, tab, refresh]);

  // تشغيل المؤقت كل ثانية فقط أثناء وجود جلسة إعلان نشطة لتفادي إعادة التصيير المتكررة
  useEffect(() => {
    const intervalMs = session ? 1000 : 30000;
    const id = window.setInterval(() => setClockNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [session]);

  // حساب السعر اللحظي للعملة الواحدة استناداً إلى صندوق السيولة وعدد العملات المعدّنة
  const computedLivePriceUsd = useMemo(() => {
    const apiPrice = Number(metrics?.price_usd_per_yt || 0);
    if (apiPrice > 0) return apiPrice;
    const poolUsd = Number(metrics?.ad_pool_usd || 0);
    const minedYt = Number(metrics?.total_mined_yt || 0);
    if (poolUsd > 0 && minedYt > 0) return poolUsd / minedYt;
    return 0;
  }, [metrics]);

  const computedLivePriceYer = useMemo(() => {
    const apiYer = Number(metrics?.price_yer_per_yt || 0);
    if (apiYer > 0) return apiYer;
    const rate = Number(metrics?.yer_per_usd || 530);
    return computedLivePriceUsd * rate;
  }, [metrics, computedLivePriceUsd]);

  const tradingLocked = !!phase?.is_trading_locked;
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(phase?.trading_unlock_at || 0).getTime() - clockNow) / 1000)
  );
  const countdown = `${Math.floor(remainingSeconds / 86400)}ي · ${Math.floor(
    (remainingSeconds % 86400) / 3600
  )}س · ${Math.floor((remainingSeconds % 3600) / 60)}د`;

  // عداد الجلسة النشطة للإعلان في الوقت الفعلي
  const sessionElapsedSec = session ? Math.floor((clockNow - session.startedAt) / 1000) : 0;
  const sessionRemainingSec = session ? Math.max(0, session.requiredSeconds - sessionElapsedSec) : 0;
  const sessionProgressPct = session
    ? Math.min(100, Math.round((sessionElapsedSec / Math.max(1, session.requiredSeconds)) * 100))
    : 0;

  const run = async (
    fn: () => Promise<any>,
    success: string,
    options?: {
      scope?: YtRefreshScope;
      lockKey?: string;
      onSuccess?: (result: any) => void;
    }
  ) => {
    const lockKey = options?.lockKey || 'global_run';
    if (actionLocksRef.current.has(lockKey)) return null;
    actionLocksRef.current.add(lockKey);
    setBusy(true);
    try {
      const result = await fn();
      if (result?.success === false) {
        notify(result?.message_ar || msg({ message: result?.code || 'تعذر إتمام العملية.' }), 'error');
        return result;
      }
      options?.onSuccess?.(result);
      notify(
        typeof result?.message_ar === 'string' && result.message_ar.trim() ? result.message_ar : success,
        'success'
      );
      scheduleBackgroundRefresh(options?.scope || 'mining');
      return result;
    } catch (e) {
      notify(msg(e), 'error');
      return null;
    } finally {
      actionLocksRef.current.delete(lockKey);
      setBusy(false);
    }
  };

  // تنفيذ سريع مع قفل فوري ضد النقر المزدوج وتحديث لحظي للدخول اليومي (+0.20000 TSK)
  const handleDailyCheckin = async () => {
    if (busy || dailyCheckinClaimed || actionLocksRef.current.has('daily_checkin')) return;
    const prevClaimed = dailyCheckinClaimed;
    const prevWallet = wallet;
    setDailyCheckinClaimed(true);
    if (wallet) {
      setWallet({ ...wallet, mined_units: Number(wallet.mined_units || 0) + 20000 });
    }
    const res = await run(
      () => api.claimDailyCheckin(),
      'تم استلام مكافأة الدخول اليومي (+0.20000 TSK) بنجاح!',
      { scope: 'mining', lockKey: 'daily_checkin' }
    );
    if (!res || res.success === false) {
      setDailyCheckinClaimed(prevClaimed);
      if (prevWallet) setWallet(prevWallet);
      return;
    }
    // لا يتم تفعيل الإعلان إلا بعد تأكيد نجاح استلام المكافأة.
    triggerSocialBar();
  };

  // تنفيذ فائق السرعة للنقرات اليومية مع منع التكرار المتزامن (Synchronous Lock)
  const handleDailyClick = async (clickNo: number) => {
    const lockKey = `daily_click_${clickNo}`;
    if (
      pendingClickNo !== null ||
      dailyClickClaims.includes(clickNo) ||
      actionLocksRef.current.has('daily_click_any') ||
      actionLocksRef.current.has(lockKey)
    ) {
      return;
    }
    actionLocksRef.current.add('daily_click_any');
    actionLocksRef.current.add(lockKey);
    const prevClicks = dailyClickClaims;
    const prevWallet = wallet;
    setPendingClickNo(clickNo);
    setDailyClickClaims((prev) => (prev.includes(clickNo) ? prev : [...prev, clickNo]));
    if (wallet) {
      setWallet({ ...wallet, mined_units: Number(wallet.mined_units || 0) + 1000 });
    }
    try {
      const result = await api.claimDailyClick(clickNo);
      if (result?.success === false) {
        setDailyClickClaims(prevClicks);
        if (prevWallet) setWallet(prevWallet);
        notify(result?.message_ar || msg({ message: result?.code || 'تعذر تسجيل النقرة.' }), 'error');
        return;
      }
      notify(
        typeof result?.message_ar === 'string' && result.message_ar.trim()
          ? result.message_ar
          : `تم تسجيل النقرة ${clickNo} وإضافة +0.01000 TSK!`,
        'success'
      );
      scheduleBackgroundRefresh('mining');
    } catch (e) {
      setDailyClickClaims(prevClicks);
      if (prevWallet) setWallet(prevWallet);
      notify(msg(e), 'error');
    } finally {
      actionLocksRef.current.delete('daily_click_any');
      actionLocksRef.current.delete(lockKey);
      setPendingClickNo(null);
    }
  };




  const startAd = async (ad: YtAd, purpose: 'reward' | 'liquidation' = 'reward', instructionsConfirmed = false) => {
    if (ad.ad_type === 'smart_link' && !instructionsConfirmed) {
      setPendingAdAction({ ad, purpose });
      return;
    }
    const lockKey = `start_ad_${ad.id}`;
    if (startingAdId || busy || actionLocksRef.current.has('start_ad_any') || actionLocksRef.current.has(lockKey)) {
      return;
    }
    actionLocksRef.current.add('start_ad_any');
    actionLocksRef.current.add(lockKey);
    setStartingAdId(ad.id);

    // فتح الرابط فوراً في نافذة جديدة لتجنب حظر النوافذ المنبثقة في المتصفح
    let openedWindow: Window | null = null;
    if (ad.ad_url && ad.ad_url.startsWith('http')) {
      openedWindow = window.open(ad.ad_url, '_blank', 'noopener,noreferrer');
    }

    try {
      const result = await api.startAd(ad.id, purpose);
      if (!result?.session_token) {
        if (openedWindow) openedWindow.close();
        notify('تعذر بدء جلسة الإعلان.', 'error');
        return;
      }
      if (!openedWindow && result.ad_url) {
        window.open(result.ad_url, '_blank', 'noopener,noreferrer');
      }
      const now = Date.now();
      setClockNow(now);
      setSession({
        token: result.session_token,
        purpose,
        adId: ad.id,
        adTitle: ad.title,
        startedAt: now,
        requiredSeconds: Number(result.required_seconds || ad.duration_seconds || 10),
        adUrl: result.ad_url,
        adCode: result.ad_code
      });
      if (purpose === 'liquidation') setLiquidationToken('');
      notify(`بدأت جلسة "${ad.title}" — انتظر ${result.required_seconds || ad.duration_seconds} ثانية ثم استلم المكافأة.`, 'info');
    } catch (e) {
      if (openedWindow) openedWindow.close();
      notify(msg(e), 'error');
    } finally {
      actionLocksRef.current.delete('start_ad_any');
      actionLocksRef.current.delete(lockKey);
      setStartingAdId(null);
    }
  };

  const confirmPendingAd = () => {
    if (!pendingAdAction) return;
    const next = pendingAdAction;
    setPendingAdAction(null);
    void startAd(next.ad, next.purpose, true);
  };

  const verifyAd = async () => {
    if (!session || actionLocksRef.current.has('verify_ad')) return;
    const currentSession = session;
    const matchedAd = ads.find((a) => a.id === currentSession.adId);
    const result = await run(
      () => api.verifyAd(currentSession.token),
      'تم التحقق من الإعلان وإضافة المكافأة إلى رصيدك!',
      {
        scope: 'mining',
        lockKey: 'verify_ad',
        onSuccess: (res) => {
          if (currentSession.purpose === 'liquidation') {
            setLiquidationToken(res?.session_token || currentSession.token);
          } else {
            setClaims((prev) =>
              prev.some((c) => c.ad_id === currentSession.adId)
                ? prev
                : [...prev, { ad_id: currentSession.adId, reward_units: matchedAd?.reward_units || 0 }]
            );
            if (matchedAd?.reward_units) {
              setWallet((prev) =>
                prev ? { ...prev, mined_units: Number(prev.mined_units || 0) + Number(matchedAd.reward_units || 0) } : prev
              );
            }
          }
          setSession(null);
        }
      }
    );
    if (result?.success === false) {
      // keep session open if server rejected verification
    }
  };

  // حذف نهائي فعلي من قاعدة البيانات (لا يتم إخفاء الإعلان من القائمة إلا بعد تأكيد نجاح الحذف الحقيقي)
  const handleDeleteAd = async (ad: YtAd) => {
    const lockKey = `delete_ad_${ad.id}`;
    if (deletingAdId || actionLocksRef.current.has(lockKey)) return;
    actionLocksRef.current.add(lockKey);
    setDeletingAdId(ad.id);
    try {
      const result = await (api.deleteAd ? api.deleteAd(ad.id) : api.manageAd({ action: 'delete', id: ad.id }));
      if (!result || result?.success === false) {
        notify(
          result?.message_ar || msg({ message: result?.code || 'تعذر حذف الإعلان من قاعدة البيانات.' }),
          'error'
        );
        scheduleBackgroundRefresh('ads');
        return;
      }
      setAds((prev) => prev.filter((item) => item.id !== ad.id));
      setConfirmDeleteAdId(null);
      notify(
        typeof result?.message_ar === 'string' && result.message_ar.trim()
          ? result.message_ar
          : `تم حذف الإعلان "${ad.title}" نهائياً من قاعدة البيانات.`,
        'success'
      );
      scheduleBackgroundRefresh('ads');
    } catch (e) {
      notify(msg(e), 'error');
    } finally {
      actionLocksRef.current.delete(lockKey);
      setDeletingAdId(null);
    }
  };

  // تبديل تفعيل/إيقاف الإعلان بسرعة مع قفل ضد النقر المزدوج
  const handleToggleAdActive = async (ad: YtAd) => {
    const lockKey = `toggle_ad_${ad.id}`;
    if (togglingAdId || actionLocksRef.current.has(lockKey)) return;
    actionLocksRef.current.add(lockKey);
    const prevAds = ads;
    const nextActive = !ad.is_active;
    setTogglingAdId(ad.id);
    setAds((prev) => prev.map((item) => (item.id === ad.id ? { ...item, is_active: nextActive } : item)));
    try {
      const result = await api.manageAd({
        action: 'update',
        id: ad.id,
        title: ad.title,
        ad_type: ad.ad_type,
        ad_url: ad.ad_url || '',
        reward_yt: Number(ad.reward_units) / 100000,
        required_seconds: ad.duration_seconds,
        is_active: nextActive,
        ad_code: ad.ad_code || ''
      });
      if (result?.success === false) {
        setAds(prevAds);
        notify(result?.message_ar || 'تعذر تحديث حالة الإعلان.', 'error');
        return;
      }
      notify(nextActive ? 'تم تفعيل الإعلان.' : 'تم إيقاف الإعلان.', 'success');
      scheduleBackgroundRefresh('ads');
    } catch (e) {
      setAds(prevAds);
      notify(msg(e), 'error');
    } finally {
      actionLocksRef.current.delete(lockKey);
      setTogglingAdId(null);
    }
  };

  const dailyClaimed = useMemo(() => new Set(claims.map((c) => c.ad_id)), [claims]);
  const nextDailyClick = [1, 2, 3, 4, 5].find((n) => !dailyClickClaims.includes(n)) || 6;
  const totalUserUnits = Number(wallet?.mined_units || 0) + Number(wallet?.withdrawable_units || 0);
  const totalUserValueUsd = (totalUserUnits / 100000) * computedLivePriceUsd;
  const fee = Number(payAmount || 0) * 0.03;
  const net = Number(payAmount || 0) - fee;

  const filteredAds = useMemo(() => {
    if (adTypeFilter === 'all') return ads;
    return ads.filter((a) => a.ad_type === adTypeFilter);
  }, [ads, adTypeFilter]);

  // تحميل البنر داخل قائمة الإعلانات بعد ظهور مهمتين على الأقل
  useEffect(() => {
    if (tab !== 'mine' || filteredAds.length < 2 || !bannerAdRef.current) return;
    const container = bannerAdRef.current;
    container.innerHTML = '';
    (window as any).atOptions = { key: '6e18ad3e7bb40480e41d4d20431b5bb4', format: 'iframe', height: 250, width: 300, params: {} };
    const script = document.createElement('script');
    script.src = 'https://bauval.org/22/6e18ad3e7bb40480e41d4d20431b5bb4';
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    container.appendChild(script);
    return () => { container.innerHTML = ''; };
  }, [tab, filteredAds.length >= 2]);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group relative w-full overflow-hidden rounded-3xl border border-amber-400/40 bg-gradient-to-br from-[#131B2E] via-[#090D16] to-[#161E31] p-4 text-right text-white shadow-[0_15px_35px_-10px_rgba(212,175,55,0.22)] transition-all hover:scale-[1.01]"
      >
        <div className="pointer-events-none absolute -left-8 -top-8 h-28 w-28 rounded-full bg-amber-400/15 blur-2xl" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 font-black">
            <img
              src="/images/taska-coin.png"
              alt="Taska Coin"
              className="h-9 w-9 rounded-full object-cover ring-2 ring-amber-400/60"
            />
            <div>
              <span className="block text-sm text-amber-200">منظومة Taska Coin (TSK)</span>
              <span className="block text-[10px] font-normal text-slate-400">التعدين السحابي والمحفظة الرقمية</span>
            </div>
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/15 text-amber-300 transition-transform group-hover:-translate-x-1">
            <ChevronLeft className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-2xl border border-amber-500/20 bg-[#060910]/80 p-3">
          <div>
            <p className="text-[10px] text-slate-400">سعر العملة (1 TSK)</p>
            <p className="mt-0.5 font-mono text-sm font-black text-emerald-400" dir="ltr">
              {usd(computedLivePriceUsd)}
            </p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-slate-400">صندوق السيولة</p>
            <p className="mt-0.5 font-mono text-sm font-black text-amber-300" dir="ltr">
              {usdShort(metrics?.ad_pool_usd || 0)}
            </p>
          </div>
        </div>
      </button>
    );
  }

  if (!user) {
    return (
      <div
        dir="rtl"
        className="flex min-h-[75dvh] flex-col items-center justify-center gap-5 bg-[#060910] p-6 text-center text-white"
      >
        <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-tr from-amber-500/25 to-yellow-300/10 p-1.5 ring-2 ring-amber-400/50 shadow-[0_0_30px_rgba(245,158,11,0.3)]">
          <img src="/images/taska-coin.png" alt="Taska Coin" className="h-full w-full rounded-full object-cover" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-amber-300">Taska Coin (TSK)</h2>
          <p className="mt-1.5 max-w-xs text-xs leading-6 text-slate-400">
            سجّل الدخول بحسابك في منصة Yemen Micro-tasks للوصول إلى محفظتك وبدء التعدين السحابي.
          </p>
        </div>
        <button
          onClick={() => onLogin?.()}
          className="rounded-2xl bg-gradient-to-l from-[#FDE68A] via-[#D4AF37] to-[#F59E0B] px-8 py-3.5 text-sm font-black text-[#060910] shadow-lg shadow-amber-500/25"
        >
          تسجيل الدخول الموحّد
        </button>
      </div>
    );
  }

  return (
    <main
      dir="rtl"
      className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#060910] pb-[calc(env(safe-area-inset-bottom)+5.5rem)] text-slate-100 selection:bg-amber-400 selection:text-slate-950"
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(212, 175, 55, 0.14) 0%, transparent 55%), linear-gradient(to right, rgba(245, 158, 11, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(245, 158, 11, 0.03) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 24px 24px, 24px 24px'
      }}
    >
      <style>{`
        @keyframes tskSpinSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tskSpinRev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes tskFloat { 0%, 100% { transform: translateY(0px) scale(1); } 50% { transform: translateY(-4px) scale(1.03); } }
        @keyframes tskPulse { 0%, 100% { box-shadow: 0 0 22px rgba(245, 158, 11, 0.35); } 50% { box-shadow: 0 0 46px rgba(253, 230, 138, 0.8); } }
        .tsk-card {
          background: linear-gradient(155deg, rgba(16, 23, 40, 0.96), rgba(8, 12, 22, 0.98));
          border: 1px solid rgba(212, 175, 55, 0.32);
          box-shadow: 0 14px 34px -12px rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(12px);
        }
        .tsk-vip-card {
          background:
            radial-gradient(circle at 15% 15%, rgba(253, 230, 138, 0.16) 0%, transparent 45%),
            radial-gradient(circle at 85% 85%, rgba(245, 158, 11, 0.18) 0%, transparent 50%),
            linear-gradient(135deg, #131B2E 0%, #090D16 60%, #161E31 100%);
          border: 1px solid rgba(212, 175, 55, 0.52);
          box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.85), inset 0 1px 1px rgba(253, 230, 138, 0.25);
        }
        .tsk-gold-btn {
          background: linear-gradient(135deg, #FDE68A 0%, #D4AF37 45%, #F59E0B 100%);
          color: #060910;
          font-weight: 900;
          box-shadow: 0 6px 20px -4px rgba(212, 175, 55, 0.45);
          transition: transform 0.15s ease, filter 0.15s ease;
        }
        .tsk-gold-btn:hover:not(:disabled) { filter: brightness(1.06); }
        .tsk-gold-btn:active:not(:disabled) { transform: scale(0.97); }
        .tsk-gold-btn:disabled { opacity: 0.45; cursor: not-allowed; filter: grayscale(0.4); box-shadow: none; }
      `}</style>

      {/* Floating Toast Notification */}
      {notice && (
        <div className="fixed left-1/2 top-4 z-50 w-[92%] max-w-md -translate-x-1/2">
          <div
            role="status"
            className={`flex items-center justify-between gap-2.5 rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl backdrop-blur-xl transition-all ${
              notice.type === 'error'
                ? 'border-rose-500/50 bg-[#210F14]/95 text-rose-200'
                : notice.type === 'success'
                ? 'border-emerald-500/50 bg-[#0C1D18]/95 text-emerald-200'
                : 'border-amber-500/50 bg-[#141926]/95 text-amber-200'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="shrink-0 opacity-75 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl px-3 pt-3 sm:px-5">
        {/* ==================== STICKY HEADER WITH LIVE PRICE & LIQUIDITY SIDE-BY-SIDE ==================== */}
        <header className="sticky top-2 z-30 rounded-3xl border border-amber-500/30 bg-[#060910]/92 px-3.5 py-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            {/* Logo & Title */}
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-[#FDE68A] via-[#D4AF37] to-[#B45309] p-0.5 shadow-lg">
                <img
                  src="/images/taska-coin.png"
                  alt="TSK"
                  className="h-full w-full rounded-full bg-[#0A0F1C] object-cover"
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#060910] bg-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="truncate bg-gradient-to-l from-amber-200 via-amber-400 to-yellow-500 bg-clip-text text-base font-black tracking-wide text-transparent">
                    TASKA COIN
                  </h1>
                  <span className="rounded border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-amber-300">
                    TSK
                  </span>
                </div>
                <p className="truncate text-[10px] text-slate-400">
                  رصيدك: <b className="font-mono text-amber-200">{ytc(totalUserUnits)}</b>
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex shrink-0 items-center gap-1.5">
              {isAdmin && (
                <button
                  onClick={() => setTab('admin')}
                  className={`flex items-center gap-1 rounded-xl border px-2.5 py-2 text-[10px] font-black transition ${
                    tab === 'admin'
                      ? 'border-amber-300 bg-amber-400 text-[#060910]'
                      : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                  }`}
                >
                  <ShieldCheck size={13} />
                  <span>الإدارة</span>
                </button>
              )}
              <button
                onClick={() => refresh('full').catch((e) => notify(msg(e), 'error'))}
                title="تحديث البيانات"
                className="grid h-9 w-9 place-items-center rounded-xl border border-amber-500/25 bg-[#0E1422] text-amber-300 transition hover:bg-amber-500/10"
              >
                <RefreshCw size={15} className={busy || isRefreshing ? 'animate-spin' : ''} />
              </button>
              {onExit && (
                <button
                  onClick={onExit}
                  title="إغلاق"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-[#0E1422] text-slate-300 transition hover:border-rose-400/40 hover:text-rose-300"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>

          {/* السعر اللحظي للعملة الواحدة بجانب صندوق السيولة مباشرة */}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {/* 1. السعر اللحظي للعملة الواحدة (1 TSK) */}
            <div
              role="button"
              tabIndex={0}

              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); } }}
              aria-label="عرض سعر Taska Coin اللحظي"
              className="flex cursor-pointer flex-col justify-between rounded-2xl border border-emerald-500/25 bg-[#0E1422]/95 px-3 py-2 transition active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  سعر العملة (1 TSK)
                </span>
                <span className="font-mono text-[9px] text-emerald-400/80">LIVE</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-1">
                <span className="font-mono text-sm font-black text-emerald-400" dir="ltr">
                  {usd(computedLivePriceUsd)}
                </span>
                <span className="truncate font-mono text-[9px] text-slate-400">
                  {computedLivePriceYer.toFixed(2)} ر.ي
                </span>
              </div>
            </div>

            {/* 2. صندوق السيولة الداعم للعملة */}
            <div className="flex flex-col justify-between rounded-2xl border border-amber-500/25 bg-[#0E1422]/95 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-300">💧 صندوق السيولة</span>
                <span className="rounded bg-amber-500/15 px-1.5 font-mono text-[9px] text-amber-300">POOL</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-1">
                <span className="font-mono text-sm font-black text-amber-300" dir="ltr">
                  {usdShort(metrics?.ad_pool_usd || 0)}
                </span>
                <span className="truncate font-mono text-[9px] text-slate-400">
                  معدّن: {Number(metrics?.total_mined_yt || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* شريط تقدم المعروض المعدّن */}
          <div className="mt-2 rounded-xl border border-slate-800/90 bg-[#0E1422]/80 px-3 py-1.5">
            <div className="mb-1 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">
                المعدّن المتداول:{' '}
                <strong className="font-mono text-slate-200">
                  {Number(metrics?.total_mined_yt || 0).toLocaleString('en-US', {
                    minimumFractionDigits: 5,
                    maximumFractionDigits: 5
                  })}{' '}
                  TSK
                </strong>
              </span>
              <span className="font-mono font-bold text-amber-400">
                السقف: {Number(metrics?.max_supply_yt || 100000000).toLocaleString('en-US')}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-l from-[#FDE68A] via-[#D4AF37] to-[#F59E0B] transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      1,
                      (Number(metrics?.total_mined_yt || 0) /
                        Math.max(1, Number(metrics?.max_supply_yt || 100000000))) *
                        100
                    )
                  )}%`
                }}
              />
            </div>
          </div>
        </header>

        {/* ==================== MAIN CONTENT AREA ==================== */}
        <div className="mt-4 space-y-4">
          {/* -------------------- TAB 1: التعدين السحابي والمهام الإعلانية -------------------- */}
          {tab === 'mine' && (
            <section className="space-y-4">
              {/* بطاقة مفاعل التعدين الدائري */}
              <div className="tsk-card relative overflow-hidden rounded-3xl p-5 text-center">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[10px] text-emerald-400">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
                    عقدة التعدين نشطة
                  </span>
                  <span className="font-mono text-[10px] text-amber-300">CLOUD AD MINING</span>
                </div>

                {/* الشعار الدائري الذهبي للعملة محاطاً بحلقات الطاقة الدوارة */}
                <div className="relative mx-auto my-3 flex h-36 w-36 items-center justify-center">
                  <div
                    className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/55"
                    style={{
                      animation: `tskSpinSlow ${session || busy || startingAdId ? '3s' : '18s'} linear infinite`
                    }}
                  />
                  <div
                    className="absolute inset-2.5 rounded-full border-2 border-dotted border-amber-200/45"
                    style={{
                      animation: `tskSpinRev ${session || busy || startingAdId ? '2s' : '11s'} linear infinite`
                    }}
                  />
                  <div
                    className="absolute inset-5 rounded-full bg-amber-500/20 blur-md"
                    style={{ animation: 'tskPulse 2s ease-in-out infinite' }}
                  />

                  <button
                    type="button"
                    disabled={busy || dailyCheckinClaimed}
                    onClick={() => { void handleDailyCheckin(); }}
                    className="relative h-24 w-24 overflow-hidden rounded-full bg-gradient-to-tr from-amber-600 via-yellow-200 to-amber-500 p-0.5 shadow-[0_0_28px_rgba(245,158,11,0.45)] transition-transform hover:scale-105 active:scale-95 disabled:cursor-default"
                    style={{ animation: 'tskFloat 4s ease-in-out infinite' }}
                  >
                    <img
                      src="/images/taska-coin.png"
                      alt="Taska Coin TSK"
                      className="h-full w-full rounded-full object-cover"
                    />
                  </button>
                </div>

                <h2 className="text-sm font-black text-white">التعدين السحابي والتسجيل اليومي</h2>
                <p className="mt-1 text-xs text-slate-400">
                  رصيد التعدين الحالي: <strong className="font-mono text-amber-300">{ytc(wallet?.mined_units || 0)}</strong>
                </p>

                <button
                  disabled={busy || dailyCheckinClaimed}
                  onClick={() => { void handleDailyCheckin(); }}
                  className="tsk-gold-btn mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-xs"
                >
                  {dailyCheckinClaimed ? (
                    <>
                      <CheckCircle2 size={15} /> تم استلام مكافأة اليوم (+0.20000 TSK)
                    </>
                  ) : (
                    <>
                      <span>⚡</span> المطالبة بمكافأة اليوم (+0.20000 TSK)
                    </>
                  )}
                </button>

                {/* سلسلة النقرات اليومية السريعة (5 نقرات × 0.01000 TSK) */}
                {dailyCheckinClaimed && (
                  <div className="mt-4 rounded-2xl border border-amber-500/20 bg-[#060910]/85 p-3 text-right">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-amber-200">
                        <Gift size={13} className="text-amber-400" /> سلسلة النقرات اليومية الإضافية
                      </span>
                      <span className="font-mono text-[10px] font-bold text-emerald-400">
                        {dailyClickClaims.length} / 5
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => {
                        const claimed = dailyClickClaims.includes(n);
                        const isNext = n === nextDailyClick;
                        const isPending = pendingClickNo === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            disabled={pendingClickNo !== null || claimed || !isNext}
                            onClick={() => handleDailyClick(n)}
                            className={`flex flex-col items-center gap-1 rounded-xl border py-2 transition-all active:scale-95 ${
                              claimed
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : isNext
                                ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                                : 'border-slate-800 bg-[#0A0F1C] text-slate-500 opacity-60'
                            }`}
                          >
                            {isPending ? (
                              <Loader2 size={18} className="my-0.5 animate-spin text-amber-300" />
                            ) : (
                              <img
                                src="/images/taska-coin.png"
                                alt="TSK"
                                className={`h-6 w-6 rounded-full object-cover ${!claimed && !isNext ? 'grayscale' : ''}`}
                              />
                            )}
                            <span className="text-[9px] font-bold">{claimed ? 'مكتمل ✓' : `نقرة ${n}`}</span>
                            <span className="font-mono text-[8px] font-bold" dir="ltr">
                              +0.01
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* شريط الجلسة الإعلانية النشطة (يظهر فوراً عند بدء أي إعلان) */}
              {session && (
                <div className="tsk-card rounded-3xl border-2 border-amber-400/70 p-4 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-black text-amber-300">
                      <Loader2 size={15} className="animate-spin" /> جلسة تعدين إعلانية نشطة
                    </span>
                    <span className="rounded-lg bg-amber-500/20 px-2.5 py-0.5 font-mono text-xs font-black text-amber-200">
                      {sessionRemainingSec > 0 ? `${sessionRemainingSec}s` : 'جاهز ✓'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-white">{session.adTitle}</p>

                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-l from-[#FDE68A] via-[#D4AF37] to-[#F59E0B] transition-all duration-500"
                      style={{ width: `${sessionProgressPct}%` }}
                    />
                  </div>

                  {session.adCode && (
                    <iframe
                      title="Taska Coin rewarded ad"
                      sandbox="allow-scripts allow-forms"
                      referrerPolicy="no-referrer"
                      srcDoc={session.adCode}
                      className="mt-3 h-40 w-full rounded-xl border border-amber-500/25 bg-white"
                    />
                  )}

                  <div className="mt-3 flex gap-2">
                    {session.adUrl && (
                      <a
                        href={session.adUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 rounded-xl border border-amber-400/40 bg-amber-500/10 py-2.5 text-center text-xs font-bold text-amber-200 hover:bg-amber-500/20"
                      >
                        فتح الرابط ↗
                      </a>
                    )}
                    <button
                      disabled={busy || sessionRemainingSec > 0}
                      onClick={verifyAd}
                      className="tsk-gold-btn flex-1 rounded-xl py-2.5 text-xs"
                    >
                      {sessionRemainingSec > 0
                        ? `انتظر (${sessionRemainingSec}ث)...`
                        : session.purpose === 'liquidation'
                        ? 'تأكيد إعلان التسييل ✓'
                        : 'استلام المكافأة الآن ✓'}
                    </button>
                  </div>
                </div>
              )}

              {/* قسم المهام الإعلانية السريعة والمنظمة */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-amber-300">
                    <span>🎯</span> المهام الإعلانية المتاحة للتعدين
                  </h3>
                  <span className="font-mono text-[10px] text-emerald-400">
                    مكتمل اليوم: {claims.length} / {ads.filter((a) => a.is_active).length}
                  </span>
                </div>

                {/* أزرار التصفية السريعة */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {(
                    [
                      { id: 'all', label: 'الكل' },
                      { id: 'video', label: '🎬 فيديو' },
                      { id: 'smart_link', label: '🔗 روابط ذكية' },
                      { id: 'banner_ad', label: '🖼️ سريعة وبانر' }
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        if (f.id === 'video') triggerSocialBar();
                        setAdTypeFilter(f.id);
                      }}
                      className={`shrink-0 rounded-xl px-3.5 py-1.5 text-[11px] font-bold transition ${
                        adTypeFilter === f.id
                          ? 'bg-amber-400 text-[#060910] shadow'
                          : 'border border-slate-800 bg-[#0E1422] text-slate-300 hover:border-amber-500/30'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* بطاقات الإعلانات */}
                <div className="space-y-2.5">
                  {filteredAds.length ? (
                    filteredAds.map((ad, index) => {
                      const isClaimed = dailyClaimed.has(ad.id);
                      const isStarting = startingAdId === ad.id;
                      const typeBadge =
                        ad.ad_type === 'video'
                          ? '🎬 فيديو مكافأة'
                          : ad.ad_type === 'smart_link'
                          ? '🔗 رابط ذكي'
                          : '🖼️ إعلان سريع';

                      return (
                        <React.Fragment key={ad.id}>
                        <div
                          className="tsk-card flex items-center justify-between gap-3 rounded-2xl p-3.5 transition hover:border-amber-400/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                {typeBadge}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">
                                ⏱ {ad.duration_seconds}ث
                              </span>
                            </div>
                            <h4 className="truncate text-xs font-bold text-slate-100">{ad.title}</h4>
                            <p className="mt-0.5 font-mono text-[11px] font-extrabold text-emerald-400">
                              +{ytc(ad.reward_units)}
                            </p>
                          </div>

                          <button
                            disabled={isClaimed || isStarting || busy}
                            onClick={() => startAd(ad, 'reward')}
                            className={`shrink-0 rounded-xl px-3.5 py-2.5 text-xs font-extrabold transition ${
                              isClaimed
                                ? 'cursor-not-allowed bg-slate-800/90 text-emerald-400 border border-emerald-500/25'
                                : 'tsk-gold-btn'
                            }`}
                          >
                            {isStarting ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : isClaimed ? (
                              'مكتمل ✓'
                            ) : (
                              'ابدأ التعدين'
                            )}
                          </button>
                        </div>
                        {index === 1 && (
                          <div className="my-4 flex w-full justify-center overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0A101C] p-2">
                            <div ref={bannerAdRef} className="flex min-h-[250px] w-[300px] max-w-full items-center justify-center overflow-hidden" aria-label="إعلان بانر" />
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-slate-800/80 bg-[#0E1422]/60 py-7 text-center text-xs text-slate-500">
                      لا توجد مهام إعلانية في هذا القسم حالياً.
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* -------------------- TAB 2: المحفظة والتحويلات -------------------- */}
          {tab === 'wallet' && (
            <section className="space-y-4">
              {/* بطاقة المحفظة الذهبية الفاخرة VIP Wallet Card */}
              <div className="tsk-vip-card relative overflow-hidden rounded-3xl p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#F59E0B]" />
                    <span className="text-xs font-extrabold tracking-wide text-amber-200">
                      محفظة Taska Coin الرسمية
                    </span>
                  </div>
                  <button
                    onClick={() => setShowQrModal(!showQrModal)}
                    className="flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-200 transition hover:bg-amber-500/25"
                  >
                    <QrCode size={12} /> {showQrModal ? 'إخفاء QR' : 'رمز QR'}
                  </button>
                </div>

                {/* الأرصدة */}
                <div className="my-2">
                  <span className="block text-[11px] text-slate-400">إجمالي رصيدك في المحفظة</span>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="bg-gradient-to-l from-white via-amber-100 to-amber-300 bg-clip-text font-mono text-3xl font-black tracking-tight text-transparent">
                      {(totalUserUnits / 100000).toFixed(5)}
                    </span>
                    <span className="font-mono text-sm font-extrabold text-amber-400">TSK</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl border border-amber-500/20 bg-[#060910]/80 p-2.5">
                    <span className="block text-[10px] text-slate-400">رصيد التعدين</span>
                    <span className="mt-0.5 block font-mono text-sm font-extrabold text-amber-300">
                      {ytc(wallet?.mined_units || 0)}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/20 bg-[#060910]/80 p-2.5">
                    <span className="block text-[10px] text-slate-400">القابل للسحب والتحويل</span>
                    <span className="mt-0.5 block font-mono text-sm font-extrabold text-emerald-400">
                      {ytc(wallet?.withdrawable_units || 0)}
                    </span>
                  </div>
                </div>

                {/* القيمة التقديرية بالدولار والريال اليمني */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-amber-500/20 pt-2.5">
                  <div className="rounded-2xl border border-slate-800 bg-[#060910]/70 p-2.5">
                    <span className="block text-[10px] text-slate-400">قيمة محفظتك (USD)</span>
                    <span className="font-mono text-xs font-extrabold text-emerald-400" dir="ltr">
                      {usd(totalUserValueUsd)}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#060910]/70 p-2.5">
                    <span className="block text-[10px] text-slate-400">المعادل التقريبي (YER)</span>
                    <span className="font-mono text-xs font-extrabold text-amber-300">
                      {(totalUserValueUsd * Number(metrics?.yer_per_usd || 530)).toFixed(2)} ر.ي
                    </span>
                  </div>
                </div>

                {/* عنوان المحفظة TSK Pay */}
                <div className="mt-3 rounded-2xl border border-amber-500/30 bg-[#060910]/90 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400">عنوان محفظتك (TSK Pay)</span>
                    <span className="font-mono text-[10px] text-amber-400">0xTSK ADDRESS</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono text-xs text-amber-200" dir="ltr">
                      {shortWalletAddress(String(wallet?.pay_id || '0xTSK...'))}
                    </code>
                    <button
                      onClick={copyWalletAddress}
                      className="flex shrink-0 items-center gap-1 rounded-xl border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/30 active:scale-95"
                    >
                      <Copy size={12} /> <span>{addressCopied ? 'تم النسخ' : 'نسخ'}</span>
                    </button>
                  </div>

                  {showQrModal && wallet?.pay_id && (
                    <div className="mt-3 flex flex-col items-center border-t border-slate-800 pt-3">
                      <img
                        className="h-36 w-36 rounded-2xl bg-white p-2"
                        alt="TSK Pay QR"
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                          'YTPAY:' + wallet.pay_id
                        )}`}
                      />
                      <span className="mt-1.5 break-all font-mono text-[10px] text-slate-400" dir="ltr">
                        {wallet.pay_id}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* بطاقة تسييل رصيد التعدين */}
              <div className="tsk-card rounded-3xl p-4 space-y-3">
                <h3 className="text-xs font-extrabold text-amber-300">
                  ⚡ تسييل رصيد التعدين إلى قابل للسحب
                </h3>
                <button
                  disabled={busy || startingAdId !== null}
                  onClick={() => {
                    const a = ads.find((x) => x.ad_type === 'banner_ad') || ads[0];
                    if (a) startAd(a, 'liquidation');
                    else notify('لا يوجد إعلان تسييل نشط حالياً.', 'error');
                  }}
                  className="w-full rounded-xl border border-amber-400/40 bg-amber-500/15 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25"
                >
                  1. مشاهدة إعلان التحقق لفتح التسييل
                </button>
                {liquidationToken && (
                  <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300">
                    ✓ تم التحقق من الإعلان. أدخل المبلغ ورمز PIN للتأكيد.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={liquidateAmount}
                    onChange={(e) => setLiquidateAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="المبلغ بـ TSK"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white outline-none focus:border-amber-400"
                  />
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    inputMode="numeric"
                    type="password"
                    maxLength={6}
                    placeholder="PIN المحفظة"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-center font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                  />
                </div>
                <button
                  disabled={busy || !liquidationToken || !pin}
                  onClick={() =>
                    run(
                      () =>
                        api.liquidate(Number(liquidateAmount), pin, liquidationToken).then((x) => {
                          setLiquidationToken('');
                          return x;
                        }),
                      'تم تسييل الرصيد بنجاح.',
                      { scope: 'wallet' }
                    )
                  }
                  className="tsk-gold-btn w-full rounded-xl py-2.5 text-xs"
                >
                  2. تأكيد التسييل الآن
                </button>
              </div>

              {/* بطاقة التحويل الداخلي (TSK Pay P2P) */}
              <div className="tsk-card rounded-3xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-amber-300">💸 تحويل داخلي فوري (TSK Pay)</h3>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
                    رسوم 3%
                  </span>
                </div>

                <input
                  value={payId}
                  onChange={(e) => setPayId(e.target.value)}
                  placeholder="عنوان محفظة المستلم (0xTSK...)"
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-amber-100 outline-none focus:border-amber-400"
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="المبلغ بـ TSK"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white outline-none focus:border-amber-400"
                  />
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    inputMode="numeric"
                    type="password"
                    maxLength={6}
                    placeholder="رمز PIN"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-center font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                  />
                </div>

                <input
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="ملاحظة للتحويل (اختياري)"
                  className="w-full rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-xs text-white outline-none focus:border-amber-400"
                />

                <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-amber-500/20 bg-[#060910] p-2.5 text-center text-[10px]">
                  <div>
                    <span className="text-slate-400">المبلغ</span>
                    <b className="mt-0.5 block font-mono text-white">{Number(payAmount || 0).toFixed(5)}</b>
                  </div>
                  <div>
                    <span className="text-slate-400">العمولة 3%</span>
                    <b className="mt-0.5 block font-mono text-amber-300">{fee.toFixed(5)}</b>
                  </div>
                  <div>
                    <span className="text-slate-400">الصافي 97%</span>
                    <b className="mt-0.5 block font-mono text-emerald-400">{net.toFixed(5)}</b>
                  </div>
                </div>

                <button
                  disabled={busy || !payId || !payAmount || !pin}
                  onClick={() =>
                    run(
                      () => api.sendPay(payId, Number(payAmount), pin, payNote),
                      'تم تحويل TSK Pay وتسجيل العمولة بنجاح.',
                      {
                        scope: 'wallet',
                        onSuccess: () => {
                          setPayAmount('');
                          setPayNote('');
                        }
                      }
                    )
                  }
                  className="tsk-gold-btn flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-xs"
                >
                  <Send size={14} /> إرسال التحويل الآن
                </button>
              </div>

              {/* طلب سحب خارجي */}
              <div className="tsk-card rounded-3xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-slate-100">🏦 طلب سحب خارجي</h3>
                  <span className="text-[10px] text-slate-400">
                    محجوز: {ytc(wallet?.withdrawal_pending_units || 0)}
                  </span>
                </div>
                {tradingLocked && (
                  <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                    🔒 السحب الخارجي مغلق مؤقتاً حتى انتهاء مرحلة الإطلاق ({countdown}).
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="المبلغ بـ TSK"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white"
                  />
                  <input
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    placeholder="الوسيلة (الكريمي / جوالي...)"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-xs text-white"
                  />
                </div>
                <input
                  value={payoutDestination}
                  onChange={(e) => setPayoutDestination(e.target.value)}
                  placeholder="رقم الحساب أو المحفظة المستلمة"
                  className="w-full rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-xs text-white"
                />
                <button
                  disabled={
                    busy || tradingLocked || !withdrawAmount || !payoutMethod || !payoutDestination || !pin
                  }
                  onClick={() =>
                    run(
                      () => api.requestWithdrawal(Number(withdrawAmount), payoutMethod, payoutDestination, pin),
                      'تم حجز المبلغ وإرسال طلب السحب للمراجعة.',
                      {
                        scope: 'wallet',
                        onSuccess: () => {
                          setWithdrawAmount('');
                        }
                      }
                    )
                  }
                  className="tsk-gold-btn w-full rounded-xl py-2.5 text-xs"
                >
                  <ArrowDownToLine size={13} className="ml-1 inline" /> إرسال طلب السحب
                </button>
              </div>

              {/* سجل حركات المحفظة */}
              <div className="tsk-card rounded-3xl p-4">
                <h3 className="mb-2.5 text-xs font-extrabold text-slate-100">📜 سجل حركات المحفظة</h3>
                {ledger.length ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {ledger.map((l: any) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-slate-800/90 bg-[#060910]/90 p-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-bold text-slate-100">
                            {l.description || l.transaction_type}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {new Date(l.created_at).toLocaleString('ar')}
                          </p>
                        </div>
                        <b
                          className={`shrink-0 font-mono ${
                            l.amount_units < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                          dir="ltr"
                        >
                          {l.amount_units < 0 ? '-' : '+'}
                          {ytc(Math.abs(l.amount_units))}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-slate-500">لا توجد حركات مسجلة بعد.</p>
                )}
              </div>
            </section>
          )}

          {/* -------------------- TAB 3: السوق والبيانات الاقتصادية -------------------- */}
          {tab === 'market' && (
            <section className="space-y-4">
              {/* بطاقة السعر اللحظي والسيولة التفصيلية */}
              <div className="tsk-vip-card rounded-3xl p-5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[10px] text-emerald-300">
                  <Sparkles size={11} /> التسعير الديناميكي المربوط بالسيولة
                </span>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-slate-400">سعر العملة الواحدة (1 TSK)</p>
                    <p className="mt-0.5 font-mono text-2xl font-black text-emerald-400" dir="ltr">
                      {usd(computedLivePriceUsd)}
                    </p>
                    <p className="font-mono text-[11px] text-amber-300">
                      ≈ {computedLivePriceYer.toFixed(3)} ر.ي
                    </p>
                  </div>
                  <div className="border-r border-amber-500/20 pr-3">
                    <p className="text-[11px] text-slate-400">صندوق سيولة الإعلانات</p>
                    <p className="mt-0.5 font-mono text-2xl font-black text-amber-300" dir="ltr">
                      {usdShort(metrics?.ad_pool_usd || 0)}
                    </p>
                    <p className="text-[10px] text-slate-400">موزّع على العملات المعدّنة</p>
                  </div>
                </div>

                {phase && (
                  <div className="mt-4 rounded-2xl border border-amber-500/25 bg-[#060910]/85 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-amber-200">🔒 مرحلة التأسيس (365 يوماً)</span>
                      <span className="font-mono font-black text-amber-400">{countdown}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-[#FDE68A] to-[#F59E0B]"
                        style={{
                          width: `${Math.min(100, Math.max(2, (Number(phase.days_elapsed || 0) / 365) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* منحنى تطور السعر والسيولة */}
              <div className="tsk-card rounded-3xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-extrabold text-amber-300">📈 منحنى نمو السعر والسيولة</h2>
                  <BarChart3 size={16} className="text-amber-400" />
                </div>
                <div className="flex h-32 items-end gap-1.5 rounded-2xl border border-slate-800 bg-[#060910] p-3">
                  {history.length ? (
                    history.map((p: any) => {
                      const maxP = Math.max(
                        ...history.map((h: any) => Number(h.price_usd_per_yt)),
                        0.00000001
                      );
                      const pct = Math.max(8, Math.min(100, (Number(p.price_usd_per_yt) / maxP) * 100));
                      return (
                        <div
                          key={p.id}
                          title={`${new Date(p.created_at).toLocaleString('ar')} — ${usd(p.price_usd_per_yt)}`}
                          className="flex-1 rounded-t-md bg-gradient-to-t from-amber-700 via-amber-500 to-yellow-300 transition-all hover:brightness-125"
                          style={{ height: `${pct}%` }}
                        />
                      );
                    })
                  ) : (
                    <p className="m-auto text-xs text-slate-500">لا توجد نقاط سعر مسجلة بعد</p>
                  )}
                </div>
              </div>

              {/* توزيع العملة */}
              <div className="tsk-card rounded-3xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-extrabold text-slate-100">
                    💎 التوزيع الثابت · {Number(metrics?.max_supply_yt || 100000000).toLocaleString('en-US')} TSK
                  </h2>
                  <Layers size={15} className="text-amber-300" />
                </div>
                <div className="space-y-2.5">
                  {allocations.map((a: any) => (
                    <div key={a.allocation_code} className="rounded-xl bg-[#060910]/80 p-2.5">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="font-bold text-slate-200">{a.name_ar}</span>
                        <b className="font-mono text-amber-300" dir="ltr">
                          {a.percentage}% · {(Number(a.allocated_units) / 100000).toLocaleString('en-US')} TSK
                        </b>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-amber-500 to-yellow-300"
                          style={{ width: `${a.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* -------------------- TAB 4: الإحالات -------------------- */}
          {tab === 'referrals' && (
            <section className="space-y-4">
              <div className="tsk-vip-card rounded-3xl p-5">
                <h2 className="text-base font-black text-amber-300">🤝 برنامج سفراء Taska Coin</h2>
                <p className="mt-1 text-xs leading-6 text-slate-300">
                  احصل على <strong className="text-emerald-400">0.50000 TSK</strong> مكافأة تفعيل عند إكمال المدعو 3
                  إعلانات تعدين، بالإضافة إلى <strong className="text-amber-300">5%</strong> من مكافآت نشاطه.
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-slate-800 bg-[#060910]/85 p-3">
                    <b className="block font-mono text-xl font-black text-amber-300">
                      {referralStats?.invited_count || 0}
                    </b>
                    <span className="text-[10px] text-slate-400">المدعوون</span>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#060910]/85 p-3">
                    <b className="block font-mono text-xl font-black text-emerald-400">
                      {referralStats?.activated_count || 0}
                    </b>
                    <span className="text-[10px] text-slate-400">المفعّلون</span>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#060910]/85 p-3">
                    <b className="block font-mono text-xs font-black text-amber-200">
                      {ytc(referralStats?.earnings_units || 0)}
                    </b>
                    <span className="text-[10px] text-slate-400">أرباحك</span>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-500/30 bg-[#060910]/90 p-3">
                  <span className="text-[10px] font-bold text-slate-400">رابط الدعوة الخاص بك:</span>
                  <div className="mt-1 break-all font-mono text-xs text-amber-200" dir="ltr">
                    {user.referralCode
                      ? `${window.location.origin}/?ref=${user.referralCode}`
                      : 'كود الإحالة غير متاح حالياً'}
                  </div>
                  {user.referralCode && (
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/?ref=${user.referralCode}`);
                        notify('تم نسخ رابط الدعوة الخاص بك!', 'success');
                      }}
                      className="tsk-gold-btn mt-2.5 w-full rounded-xl py-2.5 text-xs"
                    >
                      📋 نسخ رابط الدعوة
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* -------------------- TAB 5: الإعدادات والأمان -------------------- */}
          {tab === 'settings' && (
            <section className="space-y-4">
              <div className="tsk-card rounded-3xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold text-amber-300">🔐 أمان المحفظة (رمز PIN)</h2>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    حماية مشفرة
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  قم بتعيين أو تحديث رمز PIN (من 4 إلى 6 أرقام) لتأكيد جميع عمليات التحويل وتسييل الأرباح.
                </p>

                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="PIN الحالي (إن وجد)"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-center font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                  />
                  <input
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="PIN جديد (4-6 أرقام)"
                    className="min-w-0 rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-center font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                  />
                </div>

                <button
                  disabled={busy || !newPin}
                  onClick={() =>
                    run(
                      () =>
                        api.setPin(newPin, currentPin || undefined).then((x) => {
                          setNewPin('');
                          setCurrentPin('');
                          return x;
                        }),
                      'تم حفظ رمز الأمان PIN بنجاح!'
                    )
                  }
                  className="tsk-gold-btn w-full rounded-xl py-2.5 text-xs"
                >
                  حفظ وتفعيل رمز الأمان PIN
                </button>
              </div>
            </section>
          )}

          {/* -------------------- TAB 6: لوحة تحكم المدير الحصرية (isAdmin ONLY) -------------------- */}
          {tab === 'admin' && isAdmin && (
            <section className="space-y-4">
              {/* بطاقة رأس لوحة المدير */}
              <div className="tsk-vip-card rounded-3xl border border-amber-400/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/50 bg-amber-500/20 text-lg">
                      👑
                    </span>
                    <div>
                      <h2 className="text-sm font-black text-amber-300">لوحة تحكم المدير العام</h2>
                      <p className="font-mono text-[10px] text-emerald-400" dir="ltr">
                        ADMIN EXCLUSIVE • PRIVATE STUDIO
                      </p>
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => refresh().catch((e) => notify(msg(e), 'error'))}
                    className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[10px] font-bold text-amber-200"
                  >
                    🔄 تحديث
                  </button>
                </div>

                {/* مؤشرات الإدارة */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-amber-500/25 bg-[#060910]/85 p-2.5">
                    <span className="block text-[9px] text-slate-400">إيرادات الإدارة</span>
                    <span className="font-mono text-xs font-black text-amber-300" dir="ltr">
                      {usdShort(metrics?.admin_revenue_usd || 0)}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/25 bg-[#060910]/85 p-2.5">
                    <span className="block text-[9px] text-slate-400">سيولة العملة (70%)</span>
                    <span className="font-mono text-xs font-black text-emerald-400" dir="ltr">
                      {usdShort(metrics?.ad_pool_usd || 0)}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-sky-500/25 bg-[#060910]/85 p-2.5">
                    <span className="block text-[9px] text-slate-400">المحافظ / الإعلانات</span>
                    <span className="font-mono text-xs font-black text-sky-300">
                      {adminWallets.length} / {ads.length}
                    </span>
                  </div>
                </div>

                {/* تبويبات الإدارة الداخلية */}
                <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-2xl bg-[#060910]/90 p-1.5">
                  {(
                    [
                      { id: 'ads', label: '📢 الإعلانات' },
                      { id: 'revenue', label: '💰 الأرباح' },
                      { id: 'withdrawals', label: '🏦 السحب' },
                      { id: 'wallets', label: '🛡️ النظام' }
                    ] as const
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setAdminSubTab(sub.id)}
                      className={`rounded-xl py-2 text-[10px] font-extrabold transition ${
                        adminSubTab === sub.id
                          ? 'bg-amber-400 text-[#060910]'
                          : 'text-slate-400 hover:text-amber-200'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* القسم الفرعي 1: استوديو إضافة وإدارة الإعلانات الاحترافي */}
              {adminSubTab === 'ads' && (
                <div className="space-y-4">
                  <div className="tsk-card rounded-3xl p-4 space-y-3.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-xs font-extrabold text-amber-300">
                          📢 استوديو إضافة وإدارة الإعلانات
                        </h3>
                        <p className="text-[10px] text-slate-400">
                          أدخل بيانات الإعلان وعاينه مباشرة قبل النشر للمعدّنين
                        </p>
                      </div>
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                        yt_mining_ads
                      </span>
                    </div>

                    {/* 1. اختيار نوع الإعلان بأزرار بصرية منظمة */}
                    <div>
                      <label className="mb-1.5 block text-[11px] font-bold text-slate-300">
                        1. اختر نوع الإعلان (ad_type)
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { id: 'video', icon: '🎬', label: 'فيديو VAST' },
                            { id: 'smart_link', icon: '🔗', label: 'رابط ذكي' },
                            { id: 'banner_ad', icon: '🖼️', label: 'إعلان بانر' }
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setAdDraft({ ...adDraft, ad_type: t.id })}
                            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] transition ${
                              adDraft.ad_type === t.id
                                ? 'border-amber-400 bg-amber-500/20 font-extrabold text-amber-200'
                                : 'border-slate-800 bg-[#060910] font-bold text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <span className="text-base">{t.icon}</span>
                            <span>{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 2. عنوان المهمة */}
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">
                        2. عنوان المهمة الإعلانية
                      </label>
                      <input
                        value={adDraft.title}
                        onChange={(e) => setAdDraft({ ...adDraft, title: e.target.value })}
                        placeholder="مثال: مشاهدة إعلان فيديو ترويجي"
                        className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2.5 text-xs text-white outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* 3. الرابط أو كود الإعلان */}
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">
                        3. رابط الإعلان المستهدف (HTTPS URL)
                      </label>
                      <input
                        value={adDraft.ad_url}
                        onChange={(e) => setAdDraft({ ...adDraft, ad_url: e.target.value })}
                        dir="ltr"
                        placeholder="https://..."
                        className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2.5 font-mono text-xs text-amber-100 outline-none focus:border-amber-400"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">
                        أو كود HTML / Script للإعلان المدمج (اختياري)
                      </label>
                      <textarea
                        rows={2}
                        value={adDraft.ad_code}
                        onChange={(e) => setAdDraft({ ...adDraft, ad_code: e.target.value })}
                        dir="ltr"
                        placeholder="<script>...</script>"
                        className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* 4. المدة والمكافأة + قوالب سريعة */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-300">
                          4. مدة التحقق (ثانية)
                        </label>
                        <input
                          type="number"
                          value={adDraft.duration_seconds}
                          onChange={(e) => setAdDraft({ ...adDraft, duration_seconds: e.target.value })}
                          min={5}
                          max={120}
                          className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-300">
                          5. المكافأة (TSK)
                        </label>
                        <input
                          type="number"
                          step="0.00001"
                          value={adDraft.reward_yt}
                          onChange={(e) => setAdDraft({ ...adDraft, reward_yt: e.target.value })}
                          className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2 font-mono text-xs font-bold text-emerald-400 outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">قوالب سريعة:</span>
                      {[
                        { label: '0.01 TSK · 10ث', r: '0.01000', d: '10' },
                        { label: '0.01 TSK · 15ث', r: '0.01000', d: '15' },
                        { label: '0.02 TSK · 30ث', r: '0.02000', d: '30' }
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setAdDraft({ ...adDraft, reward_yt: p.r, duration_seconds: p.d })}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-500/20"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {/* معاينة حية لبطاقة الإعلان */}
                    <div className="pt-1">
                      <span className="mb-1.5 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <Eye size={12} className="text-amber-300" /> معاينة حية لبطاقة الإعلان قبل النشر:
                      </span>
                      <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-500/35 bg-[#060910] p-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                              {adDraft.ad_type === 'video'
                                ? '🎬 إعلان فيديو'
                                : adDraft.ad_type === 'smart_link'
                                ? '🔗 رابط ذكي'
                                : '🖼️ إعلان بانر'}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              ⏱ {adDraft.duration_seconds || 15}ث
                            </span>
                          </div>
                          <p className="truncate text-xs font-bold text-slate-100">
                            {adDraft.title || 'عنوان المهمة الإعلانية سيظهر هنا...'}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] font-extrabold text-emerald-400">
                            +{Number(adDraft.reward_yt || 0).toFixed(5)} TSK
                          </p>
                        </div>
                        <span className="shrink-0 rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-[11px] font-extrabold text-amber-300">
                          ابدأ التعدين
                        </span>
                      </div>
                    </div>

                    <button
                      disabled={busy || !adDraft.title || (!adDraft.ad_url && !adDraft.ad_code)}
                      onClick={() =>
                        run(
                          () =>
                            api
                              .manageAd({
                                action: 'create',
                                title: adDraft.title,
                                ad_type: adDraft.ad_type,
                                ad_url: adDraft.ad_url,
                                ad_code: adDraft.ad_code,
                                reward_yt: Number(adDraft.reward_yt),
                                required_seconds: Number(adDraft.duration_seconds),
                                is_active: true
                              })
                              .then((x) => {
                                setAdDraft({ ...adDraft, title: '', ad_url: '', ad_code: '' });
                                return x;
                              }),
                          'تم اعتماد ونشر الإعلان في شاشة التعدين بنجاح!',
                          { scope: 'ads' }
                        )
                      }
                      className="tsk-gold-btn flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-xs"
                    >
                      <Plus size={15} /> اعتماد ونشر الإعلان الآن
                    </button>
                  </div>

                  {/* قائمة الإعلانات المنشورة */}
                  <div className="tsk-card rounded-3xl p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-extrabold text-slate-100">📋 الإعلانات المنشورة ({ads.length})</h3>
                    </div>
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {ads.length ? (
                        ads.map((a) => {
                          const isConfirmingDelete = confirmDeleteAdId === a.id;
                          const isDeleting = deletingAdId === a.id;
                          const isToggling = togglingAdId === a.id;
                          return (
                            <div
                              key={a.id}
                              className={`flex items-center justify-between gap-2 rounded-2xl border bg-[#060910] p-3 transition ${
                                a.is_active ? 'border-amber-500/25' : 'border-slate-800 opacity-60'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded bg-amber-500/15 px-1.5 font-mono text-[9px] text-amber-300">
                                    {a.ad_type}
                                  </span>
                                  <span className="font-mono text-[10px] text-emerald-400">
                                    +{ytc(a.reward_units)}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-500">
                                    ({a.duration_seconds}ث)
                                  </span>
                                </div>
                                <p className="mt-1 truncate text-xs font-bold text-slate-100">{a.title}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {isConfirmingDelete ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => handleDeleteAd(a)}
                                      className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[10px] font-extrabold text-white transition hover:bg-rose-500 disabled:opacity-50"
                                    >
                                      {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      <span>تأكيد الحذف</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => setConfirmDeleteAdId(null)}
                                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700"
                                    >
                                      إلغاء
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isToggling || isDeleting}
                                      onClick={() => handleToggleAdActive(a)}
                                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${
                                        a.is_active
                                          ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                      }`}
                                    >
                                      {isToggling ? '...' : a.is_active ? 'نشط' : 'متوقف'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => setConfirmDeleteAdId(a.id)}
                                      title="حذف الإعلان"
                                      className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2.5 py-1.5 text-[10px] font-bold text-rose-300 transition hover:bg-rose-500/25"
                                    >
                                      <Trash2 size={13} />
                                      <span>حذف</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="py-6 text-center text-xs text-slate-500">لا توجد إعلانات منشورة حالياً.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* القسم الفرعي 2: توزيع أرباح المنصة (70% سيولة / 30% إدارة - استبدال مباشر غير تراكمي) */}
              {adminSubTab === 'revenue' && (
                <div className="tsk-card rounded-3xl p-4 space-y-3">
                  <h3 className="text-xs font-extrabold text-emerald-400">
                    💰 تعيين وتوزيع أرباح المنصة (70% سيولة / 30% إدارة)
                  </h3>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    عند إدخال إجمالي أرباح المنصة بالدولار، يتم <strong className="text-white">استبدال الرصيد مباشرة (غير تراكمي)</strong> بتخصيص <strong className="text-emerald-400">70% لصندوق السيولة</strong> وتحديث السعر اللحظي، و<strong className="text-amber-300">30% كحصة إدارة</strong>.
                  </p>

                  <input
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    inputMode="decimal"
                    placeholder="إجمالي أرباح المنصة بالدولار ($)"
                    className="w-full rounded-xl border border-slate-700 bg-[#060910] px-3 py-2.5 font-mono text-xs font-bold text-emerald-300 outline-none focus:border-emerald-400"
                  />

                  <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-[#060910]/90 p-3 text-[11px]">
                    <div>
                      <span className="text-slate-400">صندوق سيولة العملة (70%):</span>
                      <b className="mt-0.5 block font-mono text-xs text-emerald-400" dir="ltr">
                        ${(Number(deposit || 0) * 0.7).toFixed(6)}
                      </b>
                    </div>
                    <div className="border-r border-slate-800 pr-2.5">
                      <span className="text-slate-400">حصة الإدارة (30%):</span>
                      <b className="mt-0.5 block font-mono text-xs text-amber-300" dir="ltr">
                        ${(Number(deposit || 0) * 0.3).toFixed(6)}
                      </b>
                    </div>
                  </div>

                  <button
                    disabled={busy || Number(deposit) <= 0}
                    onClick={() =>
                      run(
                        () =>
                          api.depositRevenue(Number(deposit)).then((x) => {
                            setDeposit('');
                            return x;
                          }),
                        'تم تعيين رصيد صندوق السيولة وتحديث السعر اللحظي للعملة!',
                        {
                          scope: 'revenue',
                          onSuccess: (res) => {
                            if (res && typeof res.pool_70 === 'number') {
                              const nextPool = Number(res.pool_70);
                              const nextAdmin = Number(res.admin_30 ?? nextPool * (30 / 70));
                              const nextPriceUsd = Number(res.price_usd_per_yt ?? 0);
                              setMetrics((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      ad_pool_usd: nextPool,
                                      admin_revenue_usd: nextAdmin,
                                      price_usd_per_yt: nextPriceUsd,
                                      price_yer_per_yt: nextPriceUsd * Number(prev.yer_per_usd || 530)
                                    }
                                  : prev
                              );
                            }
                          }
                        }
                      )
                    }
                    className="tsk-gold-btn w-full rounded-2xl py-3 text-xs"
                  >
                    اعتماد وتوزيع الإيرادات الآن
                  </button>
                </div>
              )}

              {/* القسم الفرعي 3: مراجعة طلبات السحب */}
              {adminSubTab === 'withdrawals' && (
                <div className="tsk-card rounded-3xl p-4 space-y-3">
                  <h3 className="text-xs font-extrabold text-amber-300">🏦 مراجعة طلبات السحب المعلقة</h3>
                  <input
                    value={receiptUrl}
                    onChange={(e) => setReceiptUrl(e.target.value)}
                    placeholder="رابط إيصال الصرف HTTPS"
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white"
                  />
                  <input
                    value={withdrawalNote}
                    onChange={(e) => setWithdrawalNote(e.target.value)}
                    placeholder="ملاحظة الإدارة (اختياري)"
                    className="w-full rounded-xl border border-slate-700 bg-[#060910] p-2.5 text-xs text-white"
                  />
                  {withdrawals
                    .filter((w: any) => w.status === 'pending')
                    .map((w: any) => (
                      <div key={w.id} className="rounded-2xl border border-slate-800 bg-[#060910] p-3">
                        <div className="flex items-center justify-between">
                          <b className="font-mono text-xs text-amber-300">{ytc(w.amount_units)}</b>
                          <span className="font-mono text-[10px] text-slate-400">
                            {String(w.user_id).slice(0, 8)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-white">{w.payout_method}</p>
                        <p className="mt-0.5 break-all text-[10px] text-slate-400">{w.payout_destination}</p>
                        <div className="mt-2.5 grid grid-cols-2 gap-2">
                          <button
                            disabled={busy || tradingLocked || !receiptUrl.startsWith('https://')}
                            onClick={() =>
                              run(
                                () => api.reviewWithdrawal(w.id, 'paid', receiptUrl, withdrawalNote),
                                'تم تسجيل الصرف وإرفاق الإيصال.',
                                { scope: 'withdrawals' }
                              )
                            }
                            className="rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white disabled:opacity-40"
                          >
                            تم الصرف
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => api.reviewWithdrawal(w.id, 'reject', '', withdrawalNote),
                                'تم رفض الطلب وإرجاع الرصيد للمستخدم.',
                                { scope: 'withdrawals' }
                              )
                            }
                            className="rounded-xl bg-rose-900 py-2 text-xs font-bold text-rose-100"
                          >
                            رفض وإرجاع
                          </button>
                        </div>
                      </div>
                    ))}
                  {withdrawals.filter((w: any) => w.status === 'pending').length === 0 && (
                    <p className="py-4 text-center text-xs text-slate-500">لا توجد طلبات سحب معلقة حالياً.</p>
                  )}
                </div>
              )}

              {/* القسم الفرعي 4: إدارة المحافظ وقفل التداول */}
              {adminSubTab === 'wallets' && (
                <div className="space-y-4">
                  <div className="tsk-card rounded-3xl p-4 space-y-3">
                    <h3 className="text-xs font-extrabold text-amber-300">🔒 قفل التداول ومحفظة الإدارة</h3>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api.setTradingLock(!phase?.admin_lock_enabled),
                          'تم تحديث حالة قفل التداول.',
                          { scope: 'admin_wallets' }
                        )
                      }
                      className="tsk-gold-btn w-full rounded-xl py-2.5 text-xs"
                    >
                      {phase?.admin_lock_enabled ? 'فتح التداول (قرار إداري)' : 'إعادة قفل التداول'}
                    </button>

                    <div className="flex gap-2">
                      <input
                        value={managerPayId}
                        onChange={(e) => setManagerPayId(e.target.value)}
                        placeholder={`محفظة المدير: ${metrics?.admin_pay_id || 'غير محدد'}`}
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white"
                      />
                      <button
                        disabled={busy || !managerPayId}
                        onClick={() =>
                          run(() => api.setManager(managerPayId), 'تم تعيين محفظة المدير.', {
                            scope: 'admin_wallets'
                          })
                        }
                        className="tsk-gold-btn rounded-xl px-3.5 text-xs"
                      >
                        تعيين
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={freezePayId}
                        onChange={(e) => setFreezePayId(e.target.value)}
                        placeholder="عنوان TSK Pay للتجميد/الفك"
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#060910] p-2.5 font-mono text-xs text-white"
                      />
                      <button
                        disabled={busy || !freezePayId}
                        onClick={() =>
                          run(() => api.freezeWallet(freezePayId, true), 'تم تجميد المحفظة.', {
                            scope: 'admin_wallets'
                          })
                        }
                        className="rounded-xl bg-rose-900 px-3 text-xs font-bold text-white"
                      >
                        تجميد
                      </button>
                      <button
                        disabled={busy || !freezePayId}
                        onClick={() =>
                          run(() => api.freezeWallet(freezePayId, false), 'تم فك التجميد.', {
                            scope: 'admin_wallets'
                          })
                        }
                        className="rounded-xl bg-emerald-900 px-3 text-xs font-bold text-white"
                      >
                        فك
                      </button>
                    </div>
                  </div>

                  <div className="tsk-card rounded-3xl p-4">
                    <h3 className="mb-2.5 text-xs font-extrabold text-slate-100">
                      دليل محافظ المستخدمين ({adminWallets.length})
                    </h3>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {adminWallets.map((w: any) => (
                        <div key={w.user_id} className="rounded-2xl border border-slate-800 bg-[#060910] p-3">
                          <div className="flex items-center justify-between">
                            <b className="font-mono text-xs text-amber-200" dir="ltr">
                              {shortWalletAddress(String(w.pay_id || ''))}
                            </b>
                            <span
                              className={`text-[10px] font-bold ${
                                w.is_frozen ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {w.is_frozen ? 'مجمّدة' : 'نشطة'}
                            </span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-slate-400">
                            <span>تعدين: {ytc(w.mined_units)}</span>
                            <span>سحب: {ytc(w.withdrawable_units)}</span>
                            <span>إحالات: {ytc(w.referral_earned_units)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {pendingAdAction && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="smart-link-instructions-title"
        >
          <div className="w-full max-w-sm rounded-3xl border border-amber-400/30 bg-[#0B1220] p-5 shadow-2xl shadow-black/50">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                <Link2 size={20} />
              </span>
              <h2 id="smart-link-instructions-title" className="text-base font-extrabold text-white">
                تعليمات قبل فتح الإعلان
              </h2>
            </div>
            <p className="mb-3 text-sm leading-7 text-slate-200">
              عند فتح صفحة الإعلان التالية، يرجى الالتزام بالتعليمات:
            </p>
            <ol className="mb-4 list-decimal space-y-2 pr-5 text-sm leading-7 text-slate-300">
              <li>انتظر حتى تنتهي مدة البقاء المطلوبة.</li>
              <li>انقر على أي رابط داخل صفحة الإعلان.</li>
              <li>بعد ذلك ارجع إلى صفحة التعدين.</li>
            </ol>
            <p className="mb-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-xs leading-6 text-slate-400">
              هذه تعليمات إرشادية فقط، ولا تعني أن النقرة قد تم التحقق منها أو أن المكافأة صُرفت.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPendingAdAction(null)} className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-3 text-xs font-bold text-slate-200 transition hover:bg-slate-700">
                إلغاء
              </button>
              <button type="button" onClick={confirmPendingAd} className="rounded-xl bg-amber-500 px-3 py-3 text-xs font-extrabold text-slate-950 transition hover:bg-amber-400">
                متابعة إلى الإعلان
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== FIXED BOTTOM NAVIGATION BAR ==================== */}
      <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 border-t border-amber-500/25 bg-[#090E1A]/95 px-2 py-2 backdrop-blur-xl">
        <div className={`grid gap-1 ${isAdmin ? 'grid-cols-6' : 'grid-cols-5'}`}>
          {(
            [
              { id: 'mine', label: 'التعدين', icon: Play },
              { id: 'wallet', label: 'المحفظة', icon: Wallet },
              { id: 'market', label: 'السوق', icon: TrendingUp },
              { id: 'referrals', label: 'الإحالات', icon: Users },
              { id: 'settings', label: 'الأمان', icon: LockKeyhole },
              { id: 'admin', label: 'المدير', icon: ShieldCheck }
            ] as const
          )
            .filter((item) => item.id !== 'admin' || isAdmin)
            .map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition ${
                    active ? 'bg-amber-500/15 text-amber-300' : 'text-slate-400 hover:text-amber-200'
                  }`}
                >
                  <item.icon size={18} />
                  <span className="mt-1 text-[10px] font-bold">{item.label}</span>
                </button>
              );
            })}
        </div>
      </nav>
    </main>
  );
};
