import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type Tab = 'market' | 'wallet' | 'mine' | 'referrals' | 'settings' | 'admin';

const GOLD_CARD =
  'border border-amber-400/25 bg-gradient-to-b from-[#141926]/95 to-[#0c1018]/95 shadow-[0_12px_36px_-10px_rgba(245,158,11,0.12)] backdrop-blur-xl';

const usd = (v: number) => '$' + Number(v || 0).toFixed(8);
const ytc = (v: number) => ytFormat(v);

const msg = (e: any) => {
  const s = String(e?.message || e || '');
  const map: [string, string][] = [
    ['AD_ALREADY_COMPLETED_TODAY', 'أكملت هذا الإعلان اليوم. يمكنك العودة إليه غداً.'],
    ['AD_DURATION_NOT_COMPLETED', 'لم تنتهِ مدة الإعلان بعد. انتظر ثم أعد التحقق.'],
    ['SESSION_NOT_PENDING', 'هذه الجلسة لم تعد صالحة. ابدأ جلسة جديدة.'],
    ['SESSION_EXPIRED', 'انتهت صلاحية جلسة الإعلان. ابدأ من جديد.'],
    ['PIN_NOT_SET_OR_INVALID', 'رمز الحماية غير مضبوط أو غير صحيح.'],
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
    ['INVALID_WALLET_ADDRESS', 'عنوان TSK Pay غير صحيح.'],
    ['DAILY_CLICK_ALREADY_CLAIMED', 'سبق تسجيل هذه النقرة اليوم، ولم تتم إضافة مكافأة مكررة.'],
    ['yt_daily_click_claims_pkey', 'سبق تسجيل هذه النقرة اليوم، ولم تتم إضافة مكافأة مكررة.'],
    ['duplicate key value violates unique constraint', 'هذه العملية مسجلة مسبقاً، ولم تتم إضافة مكافأة مكررة.']
  ];
  return map.find(([k]) => s.includes(k))?.[1] || s;
};

export const YtEcosystemApp: React.FC<Props> = ({
  compact = false,
  onOpen,
  onExit,
  initialTab = 'market',
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
  const [notice, setNotice] = useState('');
  const [addressCopied, setAddressCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  const copyWalletAddress = async () => {
    const address = String(wallet?.pay_id || '');
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      setNotice('تعذر نسخ العنوان تلقائياً.');
    }
  };

  const shortWalletAddress = (address: string) =>
    address.length > 18 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;

  const [session, setSession] = useState<{
    token: string;
    purpose: 'reward' | 'liquidation';
    adId: string;
    startedAt: number;
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
    duration_seconds: '30',
    is_active: true
  });
  const [adTypeFilter, setAdTypeFilter] = useState<'video' | 'smart_link' | 'banner_ad'>('video');
  const [adminSubTab, setAdminSubTab] = useState<'ads' | 'revenue' | 'wallets' | 'withdrawals' | 'system'>('ads');

  const [phase, setPhase] = useState<any>(null);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const d = await api.loadDashboard(user.id, isAdmin);
    setMetrics(d.metrics);
    setWallet(d.wallet);
    setAdminWallets(d.adminWallets || []);
    setSystemSettings(d.systemSettings || null);
    setAds(d.ads);
    setAllocations(d.allocations);
    setHistory(d.history);
    setClaims(d.claims);
    setDailyClickClaims((d.dailyClickClaims || []).map((c: any) => Number(c.click_no)));
    setDailyCheckinClaimed(Boolean(d.dailyCheckinClaimed));
    setLedger(d.ledger);
    setWithdrawals(d.withdrawals);
    setPhase(d.phase);
    setReferralStats(d.referrals);
  }, [user?.id, isAdmin, api]);

  useEffect(() => {
    refresh().catch((e) => setNotice(msg(e)));
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const tradingLocked = !!phase?.is_trading_locked;
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(phase?.trading_unlock_at || 0).getTime() - clockNow) / 1000)
  );
  const countdown = `${Math.floor(remainingSeconds / 86400)} يوم · ${Math.floor(
    (remainingSeconds % 86400) / 3600
  )} ساعة · ${Math.floor((remainingSeconds % 3600) / 60)} دقيقة`;

  const run = async (fn: () => Promise<any>, success: string) => {
    setBusy(true);
    setNotice('');
    try {
      const result = await fn();
      await refresh().catch(() => undefined);
      if (result?.success === false) {
        setNotice(result?.message_ar || msg({ message: result?.code || 'تعذر إتمام العملية.' }));
        return result;
      }
      setNotice(
        typeof result?.message_ar === 'string' && result.message_ar.trim() ? result.message_ar : success
      );
      return result;
    } catch (e) {
      setNotice(msg(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startAd = async (ad: YtAd, purpose: 'reward' | 'liquidation' = 'reward') => {
    const result = await run(
      () => api.startAd(ad.id, purpose),
      'بدأت جلسة الإعلان. افتح الإعلان ثم تحقق بعد انتهاء المدة.'
    );
    if (!result) return;
    setSession({
      token: result.session_token,
      purpose,
      adId: ad.id,
      startedAt: Date.now(),
      adUrl: result.ad_url,
      adCode: result.ad_code
    });
    if (purpose === 'liquidation') setLiquidationToken('');
    if (result.ad_url) window.open(result.ad_url, '_blank', 'noopener,noreferrer');
  };

  const verifyAd = async () => {
    if (!session) return;
    const result = await run(
      () => api.verifyAd(session.token),
      'تم التحقق من الإعلان وتسجيل المكافأة.'
    );
    if (result?.success) {
      if (session.purpose === 'liquidation') setLiquidationToken(result.session_token || session.token);
      setSession(null);
    }
  };

  const dailyClaimed = useMemo(() => new Set(claims.map((c) => c.ad_id)), [claims]);
  const nextDailyClick = [1, 2, 3, 4, 5].find((n) => !dailyClickClaims.includes(n)) || 6;
  const price = metrics?.price_usd_per_yt || 0;
  const fee = Number(payAmount || 0) * 0.03;
  const net = Number(payAmount || 0) - fee;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`group relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#0e131f] via-[#151c2e] to-[#261c0b] p-4 text-right text-white transition-all hover:scale-[1.01] ${GOLD_CARD}`}
      >
        <div className="pointer-events-none absolute -left-8 -top-8 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 font-black">
            <img
              src="/images/taska-coin.png"
              alt="Taska Coin"
              className="h-8 w-8 rounded-full object-cover ring-2 ring-amber-400/50"
            />
            <div>
              <span className="block text-sm text-amber-100">منظومة Taska Coin</span>
              <span className="block text-[10px] font-normal text-amber-300/70">TSK · التعدين والمحفظة</span>
            </div>
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/15 text-amber-300 transition-transform group-hover:-translate-x-1">
            <ChevronLeft className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-black/30 p-3">
          <div>
            <p className="text-[10px] text-slate-400">السعر اللحظي</p>
            <p className="mt-0.5 text-base font-black text-amber-300" dir="ltr">
              {usd(price)}
            </p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-slate-400">مكافآت الإعلانات</p>
            <p className="mt-0.5 text-sm font-black text-emerald-300">
              {ytc(metrics?.daily_mining_reward_units || 0)}
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
        className="flex min-h-[75dvh] flex-col items-center justify-center gap-5 bg-[#060911] p-6 text-center text-white"
      >
        <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-tr from-amber-500/20 to-yellow-300/10 p-1.5 ring-2 ring-amber-400/40">
          <img src="/images/taska-coin.png" alt="Taska Coin" className="h-full w-full rounded-full object-cover" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-amber-200">منظومة Taska Coin</h2>
          <p className="mt-1.5 max-w-xs text-xs leading-6 text-slate-400">
            سجّل الدخول بحسابك في منصة Yemen Micro-tasks للوصول إلى محفظتك وبدء التعدين السحابي.
          </p>
        </div>
        <button
          onClick={() => onLogin?.()}
          className="rounded-2xl bg-gradient-to-l from-amber-400 to-yellow-500 px-8 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20"
        >
          تسجيل الدخول الموحّد
        </button>
      </div>
    );
  }

  return (
    <main
      dir="rtl"
      className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#060911] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-slate-100 selection:bg-amber-400 selection:text-slate-950"
    >
      <style>{`
        @keyframes tskOrbitSlow { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes tskOrbitRev { 0% { transform: rotate(360deg); } 100% { transform: rotate(0deg); } }
        @keyframes tskCoinFloat { 0%, 100% { transform: translateY(0px) scale(1); } 50% { transform: translateY(-4px) scale(1.03); } }
      `}</style>

      <div className="mx-auto w-full max-w-4xl px-3 pt-3 sm:px-5">
        {/* Top App Bar */}
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#0c111d]/90 px-3.5 py-2.5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300/30 to-amber-700/20 p-0.5 ring-1 ring-amber-400/50">
              <img
                src="/images/taska-coin.png"
                alt="Taska Coin"
                className="h-full w-full rounded-full object-cover"
              />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0c111d] bg-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-base font-black tracking-tight text-white">Taska Coin</h1>
                <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                  TSK
                </span>
              </div>
              <p className="truncate text-[11px] text-slate-400">
                الرصيد الكلي:{' '}
                <b className="text-amber-200">
                  {ytc(Number(wallet?.mined_units || 0) + Number(wallet?.withdrawable_units || 0))}
                </b>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => refresh().catch((e) => setNotice(msg(e)))}
              aria-label="تحديث البيانات"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-amber-400/40 hover:text-amber-300"
            >
              <RefreshCw size={16} className={busy ? 'animate-spin text-amber-300' : ''} />
            </button>
            {onExit && (
              <button
                onClick={onExit}
                aria-label="إغلاق"
                className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-rose-400/40 hover:text-rose-300"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        {/* Navigation Pill Bar */}
        <nav className="my-3.5 grid grid-cols-5 gap-1 rounded-2xl border border-white/[0.07] bg-[#0c111d] p-1.5 sm:flex">
          {(
            [
              { id: 'market', label: 'السوق', icon: TrendingUp },
              { id: 'mine', label: 'التعدين', icon: Play },
              { id: 'wallet', label: 'المحفظة', icon: Wallet },
              { id: 'referrals', label: 'الإحالات', icon: Users },
              { id: 'settings', label: 'الأمان', icon: LockKeyhole },
              { id: 'admin', label: 'الإدارة', icon: ShieldCheck }
            ] as const
          )
            .filter((x) => x.id !== 'admin' || isAdmin)
            .map((x) => {
              const active = tab === x.id;
              return (
                <button
                  key={x.id}
                  onClick={() => setTab(x.id)}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[10px] font-bold transition-all sm:flex-row sm:gap-2 sm:py-2.5 sm:text-xs ${
                    active
                      ? 'bg-gradient-to-l from-amber-400 via-amber-300 to-yellow-500 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`}
                >
                  <x.icon size={15} />
                  <span className="truncate">{x.label}</span>
                </button>
              );
            })}
        </nav>

        {/* Status & Loader Banners */}
        {notice && (
          <div
            role="status"
            className="mb-3.5 flex items-start justify-between gap-2 rounded-2xl border border-amber-400/35 bg-amber-400/10 px-3.5 py-3 text-xs leading-6 text-amber-100"
          >
            <span>{notice}</span>
            <button onClick={() => setNotice('')} className="shrink-0 text-amber-300/70 hover:text-amber-200">
              <X size={14} />
            </button>
          </div>
        )}

        {busy && (
          <div className="mb-3.5 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">
            <Loader2 size={14} className="animate-spin" />
            <span>جارٍ تنفيذ العملية ومزامنة السجل مع قاعدة البيانات…</span>
          </div>
        )}

        {/* ==================== 1. MARKET TAB ==================== */}
        {tab === 'market' && (
          <section className="space-y-4">
            {/* Hero Live Price Card */}
            <div className={`relative overflow-hidden rounded-3xl p-5 sm:p-6 ${GOLD_CARD}`}>
              <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                    <Sparkles size={12} /> السعر اللحظي المدعوم بالسيولة
                  </span>
                  <p className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl" dir="ltr">
                    {usd(price)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-amber-300/90">
                    ≈ {(metrics?.price_yer_per_yt || 0).toLocaleString('en-US', { maximumFractionDigits: 5 })}{' '}
                    ريال يمني / TSK
                  </p>
                </div>

                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 p-1.5">
                  <img
                    src="/images/taska-coin.png"
                    alt="TSK"
                    className="h-full w-full rounded-full object-cover"
                  />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-3.5">
                  <p className="text-[11px] text-slate-400">صندوق سيولة الإعلانات</p>
                  <p className="mt-1 text-lg font-black text-emerald-300" dir="ltr">
                    {usd(metrics?.ad_pool_usd || 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-3.5">
                  <p className="text-[11px] text-slate-400">مكافآت الإعلانات النشطة</p>
                  <p className="mt-1 text-base font-black text-amber-300">
                    {ytc(metrics?.daily_mining_reward_units || 0)}
                  </p>
                  <p className="text-[10px] text-slate-500" dir="ltr">
                    = {usd(metrics?.daily_mining_reward_usd || 0)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
                <span>إجمالي المعروض المعدّن حالياً</span>
                <b className="font-mono text-slate-200" dir="ltr">
                  {(metrics?.total_mined_yt || 0).toLocaleString('en-US', {
                    minimumFractionDigits: 5,
                    maximumFractionDigits: 5
                  })}{' '}
                  TSK
                </b>
              </div>
            </div>

            {/* Vesting / Launch Lock Banner */}
            {phase && (
              <div className={`rounded-2xl p-4 ${GOLD_CARD}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
                      <LockKeyhole size={15} />
                    </span>
                    <div>
                      <b className="block text-xs text-white">مرحلة التأسيس وحماية السيولة (365 يوماً)</b>
                      <span className="text-[10px] text-slate-400">
                        {tradingLocked ? 'التداول الخارجي مقفل لضمان نمو القيمة' : 'اكتملت فترة الحظر'}
                      </span>
                    </div>
                  </div>
                  <span className="rounded-xl border border-amber-400/25 bg-black/40 px-3 py-1.5 text-xs font-black text-amber-300">
                    {countdown}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/50 p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-amber-400 to-yellow-200 transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(2, (Number(phase.days_elapsed || 0) / 365) * 100))}%`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Price History Chart */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black text-white">مؤشر نمو السعر والسيولة</h2>
                  <p className="text-[11px] text-slate-400">تحديث تراكمي مع كل إيداع أرباح إعلانية</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/10 text-amber-300">
                  <BarChart3 size={18} />
                </span>
              </div>
              <div className="flex h-36 items-end gap-1.5 rounded-2xl border border-white/[0.05] bg-black/30 p-3">
                {history.length ? (
                  history.map((p: any) => {
                    const maxP = Math.max(...history.map((h: any) => Number(h.price_usd_per_yt)), 0.00000001);
                    const pct = Math.max(8, Math.min(100, (Number(p.price_usd_per_yt) / maxP) * 100));
                    return (
                      <div
                        key={p.id}
                        title={`${new Date(p.created_at).toLocaleString('ar')} — ${usd(p.price_usd_per_yt)}`}
                        className="group relative flex-1 rounded-t-lg bg-gradient-to-t from-amber-700 via-amber-500 to-yellow-300 transition-all hover:brightness-125"
                        style={{ height: `${pct}%` }}
                      />
                    );
                  })
                ) : (
                  <p className="m-auto text-xs text-slate-500">لا توجد نقاط سعر مسجلة في السجل بعد</p>
                )}
              </div>
            </div>

            {/* Tokenomics Distribution */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-black text-white">توزيع المعروض الكلي · 100,000,000 TSK</h2>
                <Layers size={16} className="text-amber-300" />
              </div>
              <div className="space-y-3">
                {allocations.map((a: any) => (
                  <div key={a.allocation_code} className="rounded-xl bg-black/25 p-2.5">
                    <div className="mb-1.5 flex justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-200">{a.name_ar}</span>
                      <b className="font-mono text-amber-300" dir="ltr">
                        {a.percentage}% · {(Number(a.allocated_units) / 100000).toLocaleString('en-US')} TSK
                      </b>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
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

        {/* ==================== 2. MINING TAB (WITH CIRCULAR HERO LOGO) ==================== */}
        {tab === 'mine' && (
          <section className="space-y-4">
            {/* Circular Coin Reactor Hero Card */}
            <div className={`relative overflow-hidden rounded-3xl p-5 text-center ${GOLD_CARD}`}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,185,55,0.16),transparent_65%)]" />

              <div className="relative flex items-center justify-between">
                <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] font-bold text-amber-200">
                  التعدين السحابي النشط
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] font-bold ${
                    dailyCheckinClaimed
                      ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                      : 'border border-amber-400/40 bg-amber-400/20 text-amber-200 animate-pulse'
                  }`}
                >
                  {dailyCheckinClaimed ? 'تم استلام مكافأة اليوم ✓' : 'مكافأة 0.20000 TSK جاهزة'}
                </span>
              </div>

              {/* Circular Coin Reactor */}
              <div className="relative mx-auto my-5 flex h-44 w-44 items-center justify-center">
                {/* Outer Rotating Dashed Ring */}
                <div
                  className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/35"
                  style={{ animation: 'tskOrbitSlow 18s linear infinite' }}
                />
                {/* Inner Counter-Rotating Glow Ring */}
                <div
                  className="absolute inset-3 rounded-full border border-amber-300/40 border-t-amber-300 border-b-transparent shadow-[0_0_30px_rgba(245,185,55,0.22)]"
                  style={{ animation: `tskOrbitRev ${session || busy ? '2.5s' : '8s'} linear infinite` }}
                />
                {/* Interactive Coin Button */}
                <button
                  type="button"
                  disabled={busy || dailyCheckinClaimed}
                  onClick={() =>
                    run(
                      () => api.claimDailyCheckin(),
                      'تم استلام مكافأتك اليومية وإضافة 0.20000 TSK إلى رصيد التعدين.'
                    )
                  }
                  aria-label="استلام المكافأة اليومية 0.20000 TSK"
                  className={`group relative grid h-32 w-32 place-items-center rounded-full border-[3px] border-amber-300/90 bg-gradient-to-br from-amber-200 via-amber-500 to-amber-800 p-1 shadow-[0_0_40px_rgba(245,185,55,0.38)] transition-transform ${
                    dailyCheckinClaimed ? 'cursor-default opacity-90' : 'hover:scale-105 active:scale-95'
                  }`}
                  style={{ animation: 'tskCoinFloat 3.6s ease-in-out infinite' }}
                >
                  <img
                    src="/images/taska-coin.png"
                    alt="Taska Coin TSK"
                    className="h-full w-full rounded-full object-cover"
                  />
                </button>
              </div>

              <div className="relative">
                <p className="text-xs text-slate-400">رصيد التعدين الحالي</p>
                <p className="mt-0.5 text-2xl font-black text-amber-300">{ytc(wallet?.mined_units || 0)}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {dailyCheckinClaimed
                    ? 'أكملت تسجيل الحضور اليومي (+0.20000 TSK). واصل التعدين عبر الإعلانات أدناه.'
                    : 'اضغط على شعار Taska Coin الدائري أعلاه لاستلام مكافأة الدخول اليومي 0.20000 TSK'}
                </p>
              </div>

              {/* 5 Sequential Daily Clicks */}
              {dailyCheckinClaimed && (
                <div className="relative mt-5 rounded-2xl border border-amber-400/20 bg-black/35 p-3.5 text-right">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-black text-amber-100">
                      <Gift size={14} className="text-amber-300" /> سلسلة النقرات اليومية الإضافية
                    </span>
                    <span className="rounded-lg bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      {dailyClickClaims.length} / 5
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const claimed = dailyClickClaims.includes(n);
                      const nextAllowed = n === nextDailyClick;
                      return (
                        <button
                          key={n}
                          type="button"
                          disabled={busy || claimed || !nextAllowed}
                          onClick={() =>
                            run(
                              () => api.claimDailyClick(n),
                              `تم تسجيل النقرة رقم ${n} وإضافة 0.01000 TSK إلى رصيد التعدين.`
                            )
                          }
                          className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-all ${
                            claimed
                              ? 'border-emerald-400/35 bg-emerald-950/50 text-emerald-300'
                              : nextAllowed
                              ? 'border-amber-300/80 bg-gradient-to-b from-amber-400/25 to-amber-900/25 text-amber-100 shadow-[0_0_15px_rgba(245,185,55,0.2)]'
                              : 'border-white/[0.06] bg-white/[0.02] text-slate-600 opacity-60'
                          }`}
                        >
                          <img
                            src="/images/taska-coin.png"
                            alt="TSK"
                            className={`h-7 w-7 rounded-full object-cover ${!claimed && !nextAllowed ? 'grayscale' : ''}`}
                          />
                          <span className="text-[9px] font-bold">{claimed ? 'مكتملة' : `نقرة ${n}`}</span>
                          <span className="font-mono text-[8px] font-black" dir="ltr">
                            +0.01
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Active Verification Session Card */}
            {session && (
              <div className="rounded-3xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-950/60 to-[#111624] p-4 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-black text-amber-200">
                    <Loader2 size={16} className="animate-spin text-amber-300" /> جلسة تحقق خادمية نشطة
                  </span>
                  <span className="rounded-lg bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    قيد الانتظار
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-300">
                  أكمل مشاهدة الإعلان للمدة المحددة ثم اضغط زر التحقق بالأسفل لاعتماد المكافأة في رصيدك.
                </p>
                {session.adUrl ? (
                  <a
                    href={session.adUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block rounded-xl border border-amber-300/40 bg-black/30 py-2.5 text-center text-xs font-bold text-amber-200 hover:bg-amber-400/10"
                  >
                    إعادة فتح رابط الإعلان ↗
                  </a>
                ) : session.adCode ? (
                  <iframe
                    title="Taska Coin rewarded ad"
                    sandbox="allow-scripts allow-forms"
                    referrerPolicy="no-referrer"
                    srcDoc={session.adCode}
                    className="mt-3 h-48 w-full rounded-xl border border-amber-300/25 bg-white"
                  />
                ) : null}
                <button
                  disabled={busy}
                  onClick={verifyAd}
                  className="mt-2.5 w-full rounded-xl bg-gradient-to-l from-amber-400 to-yellow-500 py-3 text-xs font-black text-slate-950 shadow-lg"
                >
                  تحقق من الإكمال {session.purpose === 'liquidation' ? 'لفتح التسييل' : 'واستلام المكافأة'}
                </button>
              </div>
            )}

            {/* Ad Category Filter & Cards */}
            <div className={`rounded-3xl p-4 ${GOLD_CARD}`}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black text-white">مهام التعدين الإعلانية</h2>
                  <p className="text-[11px] text-slate-400">مكافأة يومية متجددة لكل إعلان</p>
                </div>
                <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[10px] font-bold text-slate-300">
                  {ads.filter((a) => a.ad_type === adTypeFilter).length} متاح
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-black/40 p-1.5">
                {(
                  [
                    { id: 'video', label: 'فيديوهات', icon: Film },
                    { id: 'smart_link', label: 'روابط ذكية', icon: Link2 },
                    { id: 'banner_ad', label: 'سريعة', icon: Smartphone }
                  ] as const
                ).map((x) => (
                  <button
                    key={x.id}
                    onClick={() => setAdTypeFilter(x.id)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-bold transition-all ${
                      adTypeFilter === x.id
                        ? 'bg-gradient-to-l from-amber-400 to-yellow-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-amber-100'
                    }`}
                  >
                    <x.icon size={14} />
                    <span>{x.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 space-y-2.5">
                {ads
                  .filter((a) => a.ad_type === adTypeFilter)
                  .map((a) => {
                    const done = dailyClaimed.has(a.id);
                    return (
                      <article
                        key={a.id}
                        className="flex flex-col justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/30 p-3.5 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
                              {a.ad_type === 'video' ? (
                                <Film size={15} />
                              ) : a.ad_type === 'smart_link' ? (
                                <Link2 size={15} />
                              ) : (
                                <Smartphone size={15} />
                              )}
                            </span>
                            <div className="min-w-0">
                              <h3 className="truncate text-xs font-black text-white">{a.title}</h3>
                              <p className="mt-0.5 text-[10px] text-slate-400">
                                المدة المطلوبة: {a.duration_seconds} ثانية · المكافأة:{' '}
                                <b className="text-amber-300">{ytc(a.reward_units)}</b>
                              </p>
                            </div>
                          </div>
                        </div>

                        <button
                          disabled={busy || done}
                          onClick={() => startAd(a, 'reward')}
                          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-black transition-all ${
                            done
                              ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                              : 'bg-gradient-to-l from-amber-400 to-yellow-500 text-slate-950 shadow-md shadow-amber-500/15 hover:brightness-105'
                          }`}
                        >
                          {done ? (
                            <>
                              <CheckCircle2 size={14} className="ml-1.5 inline" /> مكتمل اليوم
                            </>
                          ) : (
                            <>
                              <Play size={14} className="ml-1.5 inline" /> ابدأ التعدين
                            </>
                          )}
                        </button>
                      </article>
                    );
                  })}

                {!ads.some((a) => a.ad_type === adTypeFilter) && (
                  <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-xs text-slate-500">
                    لا توجد إعلانات نشطة في هذا القسم حالياً.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ==================== 3. WALLET TAB ==================== */}
        {tab === 'wallet' && (
          <section className="space-y-4">
            {/* Platinum Wallet Card */}
            <div className={`relative overflow-hidden rounded-3xl p-5 ${GOLD_CARD}`}>
              <div className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-black text-amber-200">
                  <Wallet size={15} className="text-amber-300" /> محفظة TSK Pay الرقمية
                </span>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  {wallet?.is_frozen ? 'مجمّدة' : 'محفظة نشطة'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl border border-amber-400/20 bg-black/35 p-3.5">
                  <p className="text-[10px] text-slate-400">رصيد التعدين</p>
                  <p className="mt-1 text-lg font-black text-amber-300">{ytc(wallet?.mined_units || 0)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-black/35 p-3.5">
                  <p className="text-[10px] text-slate-400">الرصيد القابل للسحب</p>
                  <p className="mt-1 text-lg font-black text-emerald-300">
                    {ytc(wallet?.withdrawable_units || 0)}
                  </p>
                </div>
              </div>

              {/* Wallet Address + QR Toggle */}
              <div className="mt-3.5 rounded-2xl border border-white/[0.08] bg-black/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-400">عنوان الاستقبال (TSK Pay ID)</span>
                  <button
                    type="button"
                    onClick={() => setShowQrModal(!showQrModal)}
                    className="flex items-center gap-1 text-[10px] font-bold text-amber-300 hover:underline"
                  >
                    <QrCode size={12} /> {showQrModal ? 'إخفاء QR' : 'عرض رمز QR'}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <b className="min-w-0 flex-1 truncate font-mono text-xs text-slate-100" dir="ltr">
                    {shortWalletAddress(String(wallet?.pay_id || ''))}
                  </b>
                  <button
                    type="button"
                    onClick={copyWalletAddress}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/15 px-3 py-1.5 text-[10px] font-bold text-amber-200"
                  >
                    {addressCopied ? 'تم النسخ ✓' : 'نسخ العنوان'}
                    <Copy size={12} />
                  </button>
                </div>
                {showQrModal && wallet?.pay_id && (
                  <div className="mt-3 flex flex-col items-center border-t border-white/10 pt-3">
                    <img
                      className="h-36 w-36 rounded-2xl bg-white p-2"
                      alt="TSK Pay QR"
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                        'YTPAY:' + wallet.pay_id
                      )}`}
                    />
                    <span className="mt-2 font-mono text-[10px] text-slate-400" dir="ltr">
                      {wallet.pay_id}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Liquidation Box */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <h3 className="text-sm font-black text-white">تسييل رصيد التعدين إلى قابل للسحب</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                شاهد إعلان التسييل أولاً لفتح الجلسة، ثم أدخل المبلغ ورمز PIN الخاص بمحفظتك.
              </p>

              <button
                disabled={busy}
                onClick={() => {
                  const a = ads.find((x) => x.ad_type === 'banner_ad');
                  if (a) startAd(a, 'liquidation');
                  else setNotice('لا يوجد إعلان تسييل نشط حالياً.');
                }}
                className="mt-3 w-full rounded-xl border border-amber-400/40 bg-amber-400/10 py-2.5 text-xs font-bold text-amber-200 hover:bg-amber-400/20"
              >
                <Play size={13} className="ml-1.5 inline" /> 1. مشاهدة إعلان التحقق للتسييل
              </button>

              {session?.purpose === 'liquidation' && (
                <div className="mt-2.5 rounded-xl border border-amber-400/30 bg-black/35 p-3">
                  {session.adUrl && (
                    <a
                      href={session.adUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-xs font-bold text-amber-300 underline"
                    >
                      فتح نافذة الإعلان
                    </a>
                  )}
                  <button
                    disabled={busy}
                    onClick={verifyAd}
                    className="mt-2 w-full rounded-xl bg-amber-400 py-2 text-xs font-black text-slate-950"
                  >
                    تأكيد انتهاء إعلان التسييل
                  </button>
                </div>
              )}

              {liquidationToken && (
                <p className="mt-2 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-300">
                  ✓ تم التحقق من الإعلان. أدخل المبلغ ورمز PIN لإتمام التسييل.
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={liquidateAmount}
                  onChange={(e) => setLiquidateAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="المبلغ بـ TSK"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                />
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  inputMode="numeric"
                  type="password"
                  maxLength={6}
                  placeholder="PIN المحفظة"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
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
                    'تم تسييل الرصيد بنجاح.'
                  )
                }
                className="mt-2.5 w-full rounded-xl bg-gradient-to-l from-amber-400 to-yellow-500 py-3 text-xs font-black text-slate-950 disabled:opacity-40"
              >
                2. تأكيد التسييل الآن
              </button>
            </div>

            {/* Internal P2P Transfer (TSK Pay) */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white">تحويل داخلي فوري · TSK Pay</h3>
                <span className="rounded-lg bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  رسوم الشبكة: 3%
                </span>
              </div>

              <div className="mt-3 space-y-2">
                <input
                  value={payId}
                  onChange={(e) => setPayId(e.target.value)}
                  inputMode="text"
                  placeholder="عنوان محفظة المستلم (0xTSK...)"
                  className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white"
                  dir="ltr"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="المبلغ بـ TSK"
                    className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                  />
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    inputMode="numeric"
                    type="password"
                    maxLength={6}
                    placeholder="رمز PIN"
                    className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                  />
                </div>
                <input
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="ملاحظة للتحويل (اختياري)"
                  className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/35 p-2.5 text-center text-[10px]">
                <div>
                  <span className="text-slate-400">المبلغ المرسل</span>
                  <b className="mt-0.5 block font-mono text-white">{Number(payAmount || 0).toFixed(5)}</b>
                </div>
                <div>
                  <span className="text-slate-400">رسوم الشبكة 3%</span>
                  <b className="mt-0.5 block font-mono text-amber-300">{fee.toFixed(5)}</b>
                </div>
                <div>
                  <span className="text-slate-400">الصافي للمستلم</span>
                  <b className="mt-0.5 block font-mono text-emerald-300">{net.toFixed(5)}</b>
                </div>
              </div>

              <button
                disabled={busy || !payId || !payAmount || !pin}
                onClick={() =>
                  run(
                    () => api.sendPay(payId, Number(payAmount), pin, payNote),
                    'تم تحويل TSK Pay وتسجيل العمولة بنجاح.'
                  )
                }
                className="mt-3 w-full rounded-xl bg-emerald-500 py-3 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/15 disabled:opacity-40"
              >
                <Send size={14} className="ml-1.5 inline" /> إرسال التحويل الآن
              </button>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                <Flame size={12} className="shrink-0 text-amber-400" />
                تُخصم رسوم الشبكة والتحويل (3%) تلقائياً (حرق دائم + دعم الخزينة).
              </p>
            </div>

            {/* External Withdrawal Request */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white">طلب سحب خارجي</h3>
                <span className="text-[10px] text-slate-400">
                  محجوز: {ytc(wallet?.withdrawal_pending_units || 0)}
                </span>
              </div>
              {tradingLocked && (
                <p className="mt-1.5 rounded-xl bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                  السحب الخارجي مغلق مؤقتاً حتى انتهاء مرحلة الإطلاق (365 يوماً).
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="المبلغ بـ TSK"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                />
                <input
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value)}
                  placeholder="الوسيلة (الكريمي / جوالي...)"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                />
              </div>
              <input
                value={payoutDestination}
                onChange={(e) => setPayoutDestination(e.target.value)}
                placeholder="رقم الحساب أو المحفظة المستلمة"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
              />
              <button
                disabled={busy || tradingLocked || !withdrawAmount || !payoutMethod || !payoutDestination || !pin}
                onClick={() =>
                  run(
                    () => api.requestWithdrawal(Number(withdrawAmount), payoutMethod, payoutDestination, pin),
                    'تم حجز المبلغ وإرسال طلب السحب للمراجعة.'
                  )
                }
                className="mt-2.5 w-full rounded-xl bg-amber-400 py-3 text-xs font-black text-slate-950 disabled:opacity-40"
              >
                <ArrowDownToLine size={14} className="ml-1.5 inline" /> إرسال طلب السحب
              </button>

              {withdrawals.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {withdrawals.map((w: any) => (
                    <div key={w.id} className="rounded-xl bg-black/30 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <b>{ytc(w.amount_units)}</b>
                        <span
                          className={
                            w.status === 'paid'
                              ? 'text-emerald-300'
                              : w.status === 'rejected'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                          }
                        >
                          {w.status === 'paid' ? 'تم الصرف' : w.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {w.payout_method} · {new Date(w.created_at).toLocaleDateString('ar')}
                      </p>
                      {w.receipt_url && (
                        <a
                          className="mt-1 inline-block text-emerald-300 underline"
                          href={w.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          عرض إيصال الصرف
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Wallet Ledger History */}
            <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
              <h3 className="mb-2.5 text-sm font-black text-white">سجل حركات المحفظة</h3>
              {ledger.length ? (
                <div className="divide-y divide-white/[0.06]">
                  {ledger.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-200">
                          {l.description || l.transaction_type}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {new Date(l.created_at).toLocaleString('ar')}
                        </p>
                      </div>
                      <b
                        className={`shrink-0 font-mono ${
                          l.amount_units < 0 ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                        dir="ltr"
                      >
                        {l.amount_units < 0 ? '−' : '+'}
                        {ytc(Math.abs(l.amount_units))}
                      </b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-slate-500">لا توجد حركات مسجلة في محفظتك بعد.</p>
              )}
            </div>
          </section>
        )}

        {/* ==================== 4. REFERRALS TAB ==================== */}
        {tab === 'referrals' && (
          <section className="space-y-4">
            <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-400/15 text-amber-300">
                  <Users size={20} />
                </span>
                <div>
                  <h2 className="text-base font-black text-white">برنامج سفراء Taska Coin</h2>
                  <p className="text-[11px] text-slate-400">مكافأة تفعيل 0.50000 TSK + عمولة 5% مستمرة</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-3">
                  <b className="block text-xl font-black text-amber-300">
                    {referralStats?.invited_count || 0}
                  </b>
                  <span className="text-[10px] text-slate-400">المدعوون</span>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-3">
                  <b className="block text-xl font-black text-emerald-300">
                    {referralStats?.activated_count || 0}
                  </b>
                  <span className="text-[10px] text-slate-400">المفعّلون</span>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-3">
                  <b className="block text-xs font-black text-amber-200 sm:text-sm">
                    {ytc(referralStats?.earnings_units || 0)}
                  </b>
                  <span className="text-[10px] text-slate-400">أرباحك</span>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-black/40 p-3">
                <p className="text-[10px] font-bold text-slate-400">رابط الدعوة الخاص بك</p>
                <div className="mt-1.5 break-all font-mono text-xs text-amber-200" dir="ltr">
                  {user.referralCode
                    ? `${window.location.origin}/?ref=${user.referralCode}`
                    : 'كود الإحالة غير متاح حالياً'}
                </div>
                {user.referralCode && (
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(`${window.location.origin}/?ref=${user.referralCode}`);
                      setNotice('تم نسخ رابط الدعوة الخاص بك.');
                    }}
                    className="mt-2.5 w-full rounded-xl bg-amber-400/15 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/25"
                  >
                    <Copy size={13} className="ml-1.5 inline" /> نسخ رابط الدعوة ومشاركته
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ==================== 5. SETTINGS TAB ==================== */}
        {tab === 'settings' && (
          <section className="space-y-4">
            <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-400/15 text-amber-300">
                  <LockKeyhole size={18} />
                </span>
                <div>
                  <h2 className="text-base font-black text-white">حماية المحفظة برمز PIN</h2>
                  <p className="text-[11px] text-slate-400">مطلوب لتأكيد التحويلات والتسييل</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <input
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="PIN الحالي (إن وجد)"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                />
                <input
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="PIN جديد (4-6 أرقام)"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
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
                    'تم حفظ رمز الحماية PIN للمحفظة.'
                  )
                }
                className="mt-3 w-full rounded-xl bg-gradient-to-l from-amber-400 to-yellow-500 py-3 text-xs font-black text-slate-950 disabled:opacity-40"
              >
                حفظ وتحديث رمز PIN
              </button>
            </div>

            <div className={`rounded-3xl p-4 ${GOLD_CARD}`}>
              <h3 className="text-xs font-black text-white">معلومات وحالة المحفظة</h3>
              <div className="mt-2.5 space-y-1.5 text-xs text-slate-400">
                <p>
                  حالة الحساب:{' '}
                  <b className={wallet?.is_frozen ? 'text-rose-300' : 'text-emerald-300'}>
                    {wallet?.is_frozen ? 'مجمدة' : 'نشطة ومفعّلة'}
                  </b>
                </p>
                <p>
                  معرّف المستخدم: <span className="font-mono text-[11px] text-slate-300">{user.id}</span>
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ==================== 6. EXCLUSIVE ADMIN STUDIO (isAdmin ONLY) ==================== */}
        {tab === 'admin' && isAdmin && (
          <section className="space-y-4">
            {/* Admin Executive KPI Bar */}
            <div className={`rounded-3xl p-4 ${GOLD_CARD}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-amber-300" />
                  <h2 className="text-sm font-black text-white">مركز قيادة وإدارة Taska Coin</h2>
                </div>
                <button
                  disabled={busy}
                  onClick={() => refresh().catch((e) => setNotice(msg(e)))}
                  className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold text-amber-200"
                >
                  <RefreshCw size={12} className="ml-1 inline" /> مزامنة
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl bg-black/35 p-3">
                  <span className="text-[10px] text-slate-400">المحافظ المسجلة</span>
                  <b className="mt-1 block text-lg font-black text-amber-300">{adminWallets.length}</b>
                </div>
                <div className="rounded-2xl bg-black/35 p-3">
                  <span className="text-[10px] text-slate-400">إجمالي التعدين</span>
                  <b className="mt-1 block text-xs font-black text-amber-200 sm:text-sm">
                    {ytc(adminWallets.reduce((s, w) => s + Number(w.mined_units || 0), 0))}
                  </b>
                </div>
                <div className="rounded-2xl bg-black/35 p-3">
                  <span className="text-[10px] text-slate-400">قابل للسحب</span>
                  <b className="mt-1 block text-xs font-black text-emerald-300 sm:text-sm">
                    {ytc(adminWallets.reduce((s, w) => s + Number(w.withdrawable_units || 0), 0))}
                  </b>
                </div>
                <div className="rounded-2xl bg-black/35 p-3">
                  <span className="text-[10px] text-slate-400">الإعلانات النشطة</span>
                  <b className="mt-1 block text-lg font-black text-white">
                    {ads.filter((a) => a.is_active).length} / {ads.length}
                  </b>
                </div>
              </div>

              {/* Admin Sub-Navigation */}
              <div className="mt-3.5 flex gap-1.5 overflow-x-auto pb-1">
                {(
                  [
                    { id: 'ads', label: 'إدارة الإعلانات' },
                    { id: 'revenue', label: 'الأرباح 70/30' },
                    { id: 'withdrawals', label: 'طلبات السحب' },
                    { id: 'wallets', label: 'المحافظ' },
                    { id: 'system', label: 'النظام والقفل' }
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setAdminSubTab(sub.id)}
                    className={`shrink-0 rounded-xl px-3 py-2 text-[11px] font-bold transition ${
                      adminSubTab === sub.id
                        ? 'bg-amber-400 text-slate-950'
                        : 'border border-white/10 bg-black/30 text-slate-300 hover:border-amber-400/30'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SUB-TAB A: PROFESSIONAL AD STUDIO */}
            {adminSubTab === 'ads' && (
              <div className="space-y-4">
                <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
                  <div className="mb-3.5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-white">استوديو إضافة إعلان تعدين جديد</h3>
                      <p className="text-[11px] text-slate-400">
                        أدخل بيانات الإعلان وعاينه مباشرة قبل النشر للمستخدمين
                      </p>
                    </div>
                    <span className="rounded-xl bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                      yt_mining_ads
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">عنوان الإعلان</label>
                      <input
                        value={adDraft.title}
                        onChange={(e) => setAdDraft({ ...adDraft, title: e.target.value })}
                        placeholder="مثال: شاهد الفيديو الإعلاني واربح 0.01000 TSK"
                        className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-300">نوع الإعلان</label>
                        <select
                          value={adDraft.ad_type}
                          onChange={(e) => setAdDraft({ ...adDraft, ad_type: e.target.value as any })}
                          className="w-full rounded-xl border border-white/10 bg-[#0e1422] p-3 text-xs text-white"
                        >
                          <option value="video">فيديو مكافأة (Video)</option>
                          <option value="smart_link">رابط ذكي (Smart Link)</option>
                          <option value="banner_ad">إعلان سريع / تسييل (Banner)</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-300">
                          المكافأة (TSK)
                        </label>
                        <input
                          value={adDraft.reward_yt}
                          onChange={(e) => setAdDraft({ ...adDraft, reward_yt: e.target.value })}
                          inputMode="decimal"
                          placeholder="0.01000"
                          className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-amber-300"
                          dir="ltr"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-300">
                          المدة (بالثواني)
                        </label>
                        <input
                          value={adDraft.duration_seconds}
                          onChange={(e) => setAdDraft({ ...adDraft, duration_seconds: e.target.value })}
                          inputMode="numeric"
                          placeholder="30"
                          className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    {/* Quick Presets */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">قوالب سريعة:</span>
                      {[
                        { label: '0.01 TSK · 15ث', r: '0.01000', d: '15' },
                        { label: '0.01 TSK · 30ث', r: '0.01000', d: '30' },
                        { label: '0.02 TSK · 45ث', r: '0.02000', d: '45' },
                        { label: '0.05 TSK · 60ث', r: '0.05000', d: '60' }
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setAdDraft({ ...adDraft, reward_yt: p.r, duration_seconds: p.d })}
                          className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-400/20"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">
                        رابط الإعلان المباشر (HTTPS URL)
                      </label>
                      <input
                        value={adDraft.ad_url}
                        onChange={(e) => setAdDraft({ ...adDraft, ad_url: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white"
                        dir="ltr"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-300">
                        أو كود HTML / Script للإعلان المدمج (اختياري)
                      </label>
                      <textarea
                        rows={3}
                        value={adDraft.ad_code}
                        onChange={(e) => setAdDraft({ ...adDraft, ad_code: e.target.value })}
                        placeholder="<script>...</script> أو كود البانر"
                        className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-200"
                        dir="ltr"
                      />
                    </div>

                    {/* Live Preview Box */}
                    <div className="rounded-2xl border border-amber-400/25 bg-black/35 p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold text-amber-300">
                        <Eye size={13} /> معاينة بطاقة الإعلان كما ستظهر للمعدّنين
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#121826] p-3">
                        <div className="min-w-0">
                          <b className="block truncate text-xs text-white">
                            {adDraft.title || 'عنوان الإعلان سيظهر هنا'}
                          </b>
                          <span className="text-[10px] text-slate-400">
                            {adDraft.duration_seconds || 0} ثانية ·{' '}
                            {adDraft.ad_type === 'video'
                              ? 'فيديو مكافأة'
                              : adDraft.ad_type === 'smart_link'
                              ? 'رابط ذكي'
                              : 'إعلان سريع'}
                          </span>
                        </div>
                        <span className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-black text-slate-950">
                          +{Number(adDraft.reward_yt || 0).toFixed(5)} TSK
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
                        <input
                          type="checkbox"
                          checked={adDraft.is_active}
                          onChange={(e) => setAdDraft({ ...adDraft, is_active: e.target.checked })}
                          className="h-4 w-4 accent-amber-400"
                        />
                        نشر وتفعيل الإعلان فوراً
                      </label>

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
                                  is_active: adDraft.is_active
                                })
                                .then((x) => {
                                  setAdDraft({ ...adDraft, title: '', ad_url: '', ad_code: '' });
                                  return x;
                                }),
                            'تمت إضافة الإعلان ونشره بنجاح.'
                          )
                        }
                        className="rounded-xl bg-gradient-to-l from-amber-400 to-yellow-500 px-6 py-3 text-xs font-black text-slate-950 shadow-lg disabled:opacity-40"
                      >
                        <Plus className="ml-1.5 inline" size={15} /> حفظ ونشر الإعلان
                      </button>
                    </div>
                  </div>
                </div>

                {/* Existing Ads List */}
                <div className={`rounded-3xl p-4 sm:p-5 ${GOLD_CARD}`}>
                  <h3 className="mb-3 text-sm font-black text-white">الإعلانات المسجلة ({ads.length})</h3>
                  <div className="space-y-2.5">
                    {ads.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-black/35 p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                a.is_active ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                            <b className="truncate text-xs text-white">{a.title}</b>
                          </div>
                          <p className="mt-1 text-[10px] text-slate-400">
                            {a.ad_type} · {a.duration_seconds}ث ·{' '}
                            <b className="text-amber-300">{ytc(a.reward_units)}</b>
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={() =>
                              run(
                                () =>
                                  api.manageAd({
                                    action: 'update',
                                    id: a.id,
                                    title: a.title,
                                    ad_type: a.ad_type,
                                    ad_url: a.ad_url || '',
                                    reward_yt: Number(a.reward_units) / 100000,
                                    required_seconds: a.duration_seconds,
                                    is_active: !a.is_active,
                                    ad_code: a.ad_code || ''
                                  }),
                                a.is_active ? 'تم إيقاف الإعلان.' : 'تم تفعيل الإعلان.'
                              )
                            }
                            className={`rounded-xl px-3 py-1.5 text-[10px] font-bold ${
                              a.is_active
                                ? 'border border-amber-400/30 text-amber-200'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {a.is_active ? 'إيقاف' : 'تفعيل'}
                          </button>
                          <button
                            onClick={() =>
                              run(() => api.manageAd({ action: 'delete', id: a.id }), 'تم حذف الإعلان.')
                            }
                            className="rounded-xl bg-rose-500/15 p-2 text-rose-300 hover:bg-rose-500/25"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB B: REVENUE SPLIT 70% / 30% */}
            {adminSubTab === 'revenue' && (
              <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
                <h3 className="text-sm font-black text-white">توزيع أرباح المنصة (70% سيولة / 30% إدارة)</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  عند إدخال إجمالي أرباح الإعلانات بالدولار، يضخ النظام تلقائياً 70% في صندوق سيولة العملة لرفع
                  سعرها اللحظي، ويسجل 30% كأرباح إدارة.
                </p>

                <input
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  inputMode="decimal"
                  placeholder="أدخل إجمالي الإيرادات بالدولار (مثال: 100)"
                  className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 p-3.5 text-sm font-bold text-white"
                  dir="ltr"
                />

                <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3.5">
                    <span className="text-[11px] text-emerald-200">صندوق سيولة العملة (70%)</span>
                    <b className="mt-1 block text-base font-black text-emerald-300" dir="ltr">
                      {usd(Number(deposit || 0) * 0.7)}
                    </b>
                  </div>
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3.5">
                    <span className="text-[11px] text-amber-200">حصة الإدارة الخاصة بك (30%)</span>
                    <b className="mt-1 block text-base font-black text-amber-300" dir="ltr">
                      {usd(Number(deposit || 0) * 0.3)}
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
                      'تم تسجيل الإيراد وتقسيمه 70% للسيولة و30% للإدارة وتحديث سعر العملة.'
                    )
                  }
                  className="mt-4 w-full rounded-xl bg-gradient-to-l from-amber-400 to-yellow-500 py-3.5 text-xs font-black text-slate-950 disabled:opacity-40"
                >
                  اعتماد وتوزيع الإيرادات الآن
                </button>
              </div>
            )}

            {/* SUB-TAB C: WITHDRAWALS MANAGEMENT */}
            {adminSubTab === 'withdrawals' && (
              <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
                <h3 className="text-sm font-black text-white">مراجعة طلبات السحب المعلقة</h3>
                <div className="mt-3 space-y-2">
                  <input
                    value={receiptUrl}
                    onChange={(e) => setReceiptUrl(e.target.value)}
                    placeholder="رابط إيصال الصرف HTTPS"
                    className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                    dir="ltr"
                  />
                  <input
                    value={withdrawalNote}
                    onChange={(e) => setWithdrawalNote(e.target.value)}
                    placeholder="ملاحظة الإدارة (اختياري)"
                    className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                  />
                </div>

                <div className="mt-4 space-y-3">
                  {withdrawals
                    .filter((w: any) => w.status === 'pending')
                    .map((w: any) => (
                      <div key={w.id} className="rounded-2xl border border-white/10 bg-black/35 p-3.5">
                        <div className="flex items-center justify-between">
                          <b className="text-sm text-amber-300">{ytc(w.amount_units)}</b>
                          <span className="font-mono text-[10px] text-slate-400">
                            {String(w.user_id).slice(0, 8)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-white">{w.payout_method}</p>
                        <p className="mt-0.5 break-all text-[11px] text-slate-400">{w.payout_destination}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            disabled={busy || tradingLocked || !receiptUrl.startsWith('https://')}
                            onClick={() =>
                              run(
                                () => api.reviewWithdrawal(w.id, 'paid', receiptUrl, withdrawalNote),
                                'تم تسجيل الصرف وإرفاق الإيصال.'
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
                                'تم رفض الطلب وإرجاع الرصيد للمستخدم.'
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
                    <p className="py-6 text-center text-xs text-slate-500">لا توجد طلبات سحب معلقة حالياً.</p>
                  )}
                </div>
              </div>
            )}

            {/* SUB-TAB D: WALLETS DIRECTORY */}
            {adminSubTab === 'wallets' && (
              <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
                <h3 className="mb-3 text-sm font-black text-white">
                  دليل محافظ المستخدمين ({adminWallets.length})
                </h3>
                <div className="max-h-96 space-y-2.5 overflow-y-auto">
                  {adminWallets.map((w: any) => (
                    <div key={w.user_id} className="rounded-2xl border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <b className="font-mono text-xs text-amber-200" dir="ltr">
                          {shortWalletAddress(String(w.pay_id || ''))}
                        </b>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            w.is_frozen ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {w.is_frozen ? 'مجمّدة' : 'نشطة'}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-slate-300">
                        <span>تعدين: {ytc(w.mined_units)}</span>
                        <span>سحب: {ytc(w.withdrawable_units)}</span>
                        <span>إحالات: {ytc(w.referral_earned_units)}</span>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => api.freezeWallet(w.pay_id, !w.is_frozen),
                            w.is_frozen ? 'تم فك تجميد المحفظة.' : 'تم تجميد المحفظة.'
                          )
                        }
                        className="mt-2 rounded-lg border border-amber-400/25 px-3 py-1 text-[10px] text-amber-200"
                      >
                        {w.is_frozen ? 'فك التجميد' : 'تجميد المحفظة'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SUB-TAB E: SYSTEM & LOCK CONTROLS */}
            {adminSubTab === 'system' && (
              <div className="space-y-4">
                <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
                  <h3 className="text-sm font-black text-white">قفل التداول · مرحلة 365 يوماً</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    الحالة: {tradingLocked ? 'مقفل' : 'مفتوح'} · {countdown}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() => api.setTradingLock(!phase?.admin_lock_enabled), 'تم تحديث حالة قفل التداول.')
                    }
                    className="mt-3 w-full rounded-xl bg-amber-400 py-3 text-xs font-black text-slate-950"
                  >
                    {phase?.admin_lock_enabled ? 'فتح التداول (قرار إداري)' : 'إعادة قفل التداول'}
                  </button>
                </div>

                <div className={`rounded-3xl p-5 ${GOLD_CARD}`}>
                  <h3 className="text-sm font-black text-white">محفظة الإدارة والتحكم السريع</h3>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={managerPayId}
                      onChange={(e) => setManagerPayId(e.target.value)}
                      placeholder={`الحالية: ${metrics?.admin_pay_id || 'غير محدد'}`}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                    />
                    <button
                      disabled={busy || !managerPayId}
                      onClick={() => run(() => api.setManager(managerPayId), 'تم تعيين محفظة المدير.')}
                      className="rounded-xl bg-amber-400 px-4 text-xs font-black text-slate-950"
                    >
                      تعيين
                    </button>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={freezePayId}
                      onChange={(e) => setFreezePayId(e.target.value)}
                      placeholder="عنوان TSK Pay للتجميد/الفك"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white"
                    />
                    <button
                      disabled={busy || !freezePayId}
                      onClick={() => run(() => api.freezeWallet(freezePayId, true), 'تم تجميد المحفظة.')}
                      className="rounded-xl bg-rose-900 px-3 text-xs font-bold text-white"
                    >
                      تجميد
                    </button>
                    <button
                      disabled={busy || !freezePayId}
                      onClick={() => run(() => api.freezeWallet(freezePayId, false), 'تم فك التجميد.')}
                      className="rounded-xl bg-emerald-900 px-3 text-xs font-bold text-white"
                    >
                      فك
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-black/30 p-3">
                      رسوم التحويل
                      <b className="mt-1 block text-amber-300">
                        {(Number(systemSettings?.transfer_fee_bps || 0) / 100).toFixed(2)}%
                      </b>
                    </div>
                    <div className="rounded-xl bg-black/30 p-3">
                      الحد الأقصى للمعروض
                      <b className="mt-1 block text-amber-300">{ytc(systemSettings?.max_supply_units || 0)}</b>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
          <LockKeyhole size={11} className="text-amber-400/70" />
          <span>نظام Taska Coin (TSK) · كافة العمليات محمية وموثّقة خادمياً</span>
        </footer>
      </div>
    </main>
  );
};
