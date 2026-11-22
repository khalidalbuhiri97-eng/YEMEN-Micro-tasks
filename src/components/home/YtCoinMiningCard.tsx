import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flame,
  Clock,
  CheckCircle2,
  RefreshCw,
  History,
  ChevronDown,
  ChevronUp,
  LogIn,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Sparkles,
  ArrowUpRight,
  Coins,
  Copy,
  Check,
  Zap,
  TrendingUp,
  Lock,
  Wallet,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

type CoinSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const COIN_SIZE_CLASSES: Record<CoinSize, string> = {
  xs: 'w-5 h-5 ring-1',
  sm: 'w-6 h-6 ring-[1.5px]',
  md: 'w-9 h-9 ring-2',
  lg: 'w-12 h-12 sm:w-14 sm:h-14 ring-2',
  xl: 'w-24 h-24 sm:w-32 sm:h-32 ring-4 shadow-[0_0_35px_rgba(212,175,55,0.4)]',
};

const YtCoinLogo: React.FC<{ size?: CoinSize; className?: string }> = ({
  size = 'md',
  className = '',
}) => (
  <span
    className={`inline-flex items-center justify-center rounded-full aspect-square shrink-0 overflow-hidden bg-slate-950 ring-amber-400/80 shadow-md ${COIN_SIZE_CLASSES[size]} ${className}`}
  >
    <img
      src={YT_COIN_LOGO_SRC}
      alt="YT Coin"
      loading="eager"
      decoding="async"
      className="w-full h-full object-cover rounded-full select-none"
    />
  </span>
);

interface NormalizedHistoryItem {
  id: string;
  rewardUnits: number;
  label: string;
  createdAt: string | null;
  reference: string | null;
}

interface NormalizedYtCoinSummary {
  balanceUnits: number;
  lifetimeEarnedUnits: number;
  todayRewardUnits: number;
  canClaim: boolean;
  claimedToday: boolean;
  capReached: boolean;
  miningEnabled: boolean;
  streakDays: number;
  dailyCapUnits: number;
  dailyCapRemainingUnits: number;
  minedTodayUnits: number;
  maxSupplyUnits: number;
  totalMinedUnits: number;
  statusMessage: string | null;
  history: NormalizedHistoryItem[];
}

function asRecord(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
}

function pickNumber(sources: Array<Record<string, any> | null>, keys: string[]): number {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      const val = src[key];
      if (val !== null && val !== undefined && val !== '') {
        const n = Number(val);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return 0;
}

function pickBoolean(sources: Array<Record<string, any> | null>, keys: string[]): boolean | null {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      const val = src[key];
      if (typeof val === 'boolean') return val;
    }
  }
  return null;
}

function pickString(sources: Array<Record<string, any> | null>, keys: string[]): string | null {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      const val = src[key];
      if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    }
  }
  return null;
}

function pickArray(sources: Array<Record<string, any> | null>, keys: string[]): any[] {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      if (Array.isArray(src[key])) return src[key];
    }
  }
  return [];
}

function normalizeSummary(raw: unknown): NormalizedYtCoinSummary {
  const root = asRecord(raw) || {};
  const sources: Array<Record<string, any> | null> = [
    root,
    asRecord(root.wallet),
    asRecord(root.account),
    asRecord(root.mining),
    asRecord(root.mining_status),
    asRecord(root.daily),
    asRecord(root.today),
    asRecord(root.pool),
    asRecord(root.limits),
    asRecord(root.config),
  ];

  const balanceUnits = pickNumber(sources, ['balanceUnits', 'balance_units', 'yt_balance', 'availableUnits']);
  const lifetimeEarnedUnits = pickNumber(sources, ['lifetimeEarnedUnits', 'lifetime_earned_units', 'total_mined_units', 'totalMinedUnits']);
  const todayRewardUnits = pickNumber(sources, ['nextRewardUnits', 'todayRewardUnits', 'today_reward_units', 'rewardUnits', 'reward_units']) || 1;
  const claimedTodayFlag = pickBoolean(sources, ['claimedToday', 'claimed_today', 'already_claimed']);
  const miningEnabledFlag = pickBoolean(sources, ['miningEnabled', 'mining_enabled', 'enabled']);
  const canClaimExplicit = pickBoolean(sources, ['canClaim', 'can_claim']);

  const dailyCapUnits = pickNumber(sources, ['dailyCapUnits', 'daily_cap_units']) || 1;
  const dailyCapRemainingUnits = pickNumber(sources, ['dailyCapRemainingUnits', 'daily_cap_remaining_units']) || dailyCapUnits;
  const minedTodayUnits = pickNumber(sources, ['minedTodayUnits', 'mined_today_units', 'paid_units']) || 0;
  const maxSupplyUnits = pickNumber(sources, ['maxSupplyUnits', 'max_supply_units']) || 2000000000;
  const totalMinedUnits = pickNumber(sources, ['totalMinedUnits', 'total_mined_units']) || 0;
  const streakDays = pickNumber(sources, ['streakDay', 'streak_days', 'streak']) || 0;
  const statusMessage = pickString(sources, ['statusMessage', 'status_message', 'message']);

  const capReached = minedTodayUnits >= dailyCapUnits || totalMinedUnits >= maxSupplyUnits;
  const miningEnabled = miningEnabledFlag !== false;
  const claimedToday = claimedTodayFlag === true || claimedTodayFlag === null && minedTodayUnits > 0;
  const canClaim = canClaimExplicit !== null ? canClaimExplicit : !claimedToday && !capReached && miningEnabled;

  const rawHistory = pickArray(sources, ['history', 'recent_rewards', 'claims', 'entries']);
  const history: NormalizedHistoryItem[] = rawHistory
    .map((entry, idx) => {
      const rec = asRecord(entry);
      if (!rec) return null;
      const rewardUnits = pickNumber([rec], ['rewardUnits', 'reward_units', 'amountUnits', 'amount_units', 'amount']);
      const label = pickString([rec], ['label', 'title', 'eventType', 'event_type']) || 'مكافأة تعدين YT Coin';
      const createdAt = pickString([rec], ['createdAt', 'created_at', 'claimed_at', 'date']);
      const reference = pickString([rec], ['reference', 'ref']);
      return {
        id: String(rec.id ?? reference ?? `yt-row-${idx}`),
        rewardUnits,
        label,
        createdAt,
        reference,
      };
    })
    .filter((item): item is NormalizedHistoryItem => item !== null);

  return {
    balanceUnits,
    lifetimeEarnedUnits,
    todayRewardUnits,
    canClaim,
    claimedToday,
    capReached,
    miningEnabled,
    streakDays,
    dailyCapUnits,
    dailyCapRemainingUnits,
    minedTodayUnits,
    maxSupplyUnits,
    totalMinedUnits,
    statusMessage,
    history,
  };
}

function formatYtUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  const yt = value / 2;
  if (yt !== 0 && Math.abs(yt) < 0.01) return yt < 0 ? '-<0.01' : '<0.01';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(yt);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export const YtCoinMiningCard: React.FC<{ compact?: boolean; onOpen?: () => void }> = ({ compact = false, onOpen }) => {
  const { user, openAuthModal, showToast } = useAuth();
  const [rawSummary, setRawSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const loadSummary = useCallback(
    async (silent = false) => {
      if (!user) {
        setRawSummary(null);
        setError(null);
        return;
      }
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await api.getMyYtCoinSummary();
        setRawSummary(res?.summary ?? res ?? null);
      } catch (err: any) {
        setError(err?.message || 'تعذر تحميل بيانات تعدين YT Coin.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    void loadSummary(false);
  }, [loadSummary]);

  const summary = useMemo(
    () => (rawSummary ? normalizeSummary(rawSummary) : null),
    [rawSummary]
  );

  const handleClaim = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (claiming) return;
    setClaiming(true);
    setError(null);
    try {
      const res = await api.claimDailyYtCoin();
      const result = asRecord(res?.result) || asRecord(res);
      const claimedAmount = pickNumber([result], ['rewardUnits', 'reward_units', 'amount_units']);
      const resultMessage = pickString([result], ['message', 'status_message']);
      const rejected = result?.success === false || result?.ok === false;

      if (rejected) {
        showToast(resultMessage || 'تم استلام مكافأة اليوم مسبقاً أو بلغ السقف.', 'info');
      } else {
        showToast(resultMessage || `تم استلام +${formatYtUnits(claimedAmount || 1)} YT بنجاح! ⛏️`, 'success');
      }
      await loadSummary(true);
    } catch (err: any) {
      const msg = err?.message || 'تعذر استلام مكافأة التعدين اليومي.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setClaiming(false);
    }
  };

  const copyWalletId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    showToast('تم نسخ معرف محفظة YT Coin بنجاح', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  // Cap Progress Percentage
  const capProgressPct = useMemo(() => {
    if (!summary || summary.dailyCapUnits <= 0) return 0;
    return Math.min(100, Math.max(0, (summary.minedTodayUnits / summary.dailyCapUnits) * 100));
  }, [summary]);

  // Max Supply Progress Percentage
  const supplyProgressPct = useMemo(() => {
    if (!summary || summary.maxSupplyUnits <= 0) return 0;
    return Math.min(100, Math.max(0, (summary.totalMinedUnits / summary.maxSupplyUnits) * 100));
  }, [summary]);

  if (compact) {
    return (
      <section aria-label="YT Coin Compact" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 pb-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label="فتح منصة تعدين عملة YT Coin"
          className="group relative w-full overflow-hidden rounded-3xl border border-amber-500/40 bg-[#0D0F14] text-white p-4 sm:p-5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:border-amber-400 transition-all active:scale-[0.99] cursor-pointer text-right"
        >
          {/* Gold ambient glow */}
          <span className="pointer-events-none absolute -top-16 -left-16 w-48 h-48 rounded-full bg-amber-500/15 blur-3xl group-hover:bg-amber-400/25 transition-colors" />
          <span className="pointer-events-none absolute -bottom-16 right-1/4 w-48 h-48 rounded-full bg-yellow-600/10 blur-3xl" />

          <div className="relative flex items-center justify-between gap-3 sm:gap-5">
            <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
              <div className="relative">
                <YtCoinLogo size="lg" className="ring-amber-400 shadow-[0_0_20px_rgba(212,175,55,0.4)] group-hover:scale-105 transition-transform animate-pulse" />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0D0F14]" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm sm:text-base font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500">
                    منجم YT Coin
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-400/40 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-300">
                    <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                    وحدات نصف عملة
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 truncate">
                  اضغط هنا لفتح منصة التعدين الذهبية واستلام مكافأتك اليومية.
                </p>
              </div>
            </div>

            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 px-4 py-2.5 text-xs font-black shadow-lg shadow-amber-500/30 transition-all">
              <span className="hidden xs:inline">دخول المنجم</span>
              <span className="xs:hidden">تعدين</span>
              <ArrowUpRight className="w-4 h-4 shrink-0" />
            </span>
          </div>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="منجم عملة YT Coin الذهبي"
      className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 space-y-5"
    >
      {/* Royal Dark Gold Vault Container */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/40 bg-gradient-to-b from-[#13161F] via-[#0D0F14] to-[#0D0F14] text-white p-5 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
        {/* Luxury Gold Ambient Glows */}
        <div className="pointer-events-none absolute -top-32 -right-32 w-80 h-80 rounded-full bg-amber-500/15 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 w-80 h-80 rounded-full bg-yellow-600/10 blur-[90px]" />

        <div className="relative space-y-6">
          {/* Top Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/20 pb-4">
            <div className="flex items-center gap-3.5">
              <YtCoinLogo size="lg" className="ring-amber-400 shadow-[0_0_25px_rgba(212,175,55,0.5)]" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg sm:text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500">
                    منجم عملة YT Coin الرقمية
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-extrabold text-amber-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    وحدة العملة: 0.5 YT
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                  منصة تعدين مستقلة ذات سقف تصاعدي يومي تبدأ بـ 0.5 YT وتزيد 0.5 YT يومياً.
                </p>
              </div>
            </div>

            {user && (
              <button
                type="button"
                onClick={() => void loadSummary(false)}
                disabled={loading}
                aria-label="تحديث بيانات المنجم"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-slate-900/80 px-4 py-2 text-xs font-extrabold text-amber-300 hover:bg-slate-800 transition-colors disabled:opacity-60 cursor-pointer shadow-md"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث البيانات</span>
              </button>
            )}
          </div>

          {/* Guest View */}
          {!user ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-slate-900/90 p-6 text-center sm:text-right">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <YtCoinLogo size="xl" className="ring-amber-400/80 animate-spin-slow" />
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-black text-amber-200">
                    سجّل الدخول للوصول إلى منجم YT Coin وبدء التعدين
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300">
                    انضم إلى المنجم الرقمي واجمع مكافآتك اليومية وفق نظام الوحدات المعتمد.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 px-6 py-3.5 text-sm font-black shadow-xl shadow-amber-500/25 transition-all cursor-pointer shrink-0"
              >
                <LogIn className="w-5 h-5" />
                <span>تسجيل الدخول للمنجم</span>
              </button>
            </div>
          ) : loading && !summary ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
              <p className="text-sm font-bold text-slate-400">جاري الاتصال بخوادم منجم YT Coin...</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-xs text-rose-200">
                  <span className="flex items-center gap-2 font-bold">
                    <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
                    {error}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadSummary(false)}
                    className="rounded-xl bg-rose-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-rose-700"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              )}

              {summary && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column (Hero Mining Vault & Action Button) */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Hero 3D Gold Coin & Circular Progress Card */}
                    <div className="relative rounded-3xl border border-amber-500/40 bg-gradient-to-b from-[#181C28] to-[#0F121B] p-6 text-center flex flex-col items-center justify-center space-y-4 shadow-2xl">
                      {/* Rotating Glow Ring */}
                      <div className="relative">
                        <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 opacity-30 blur-xl animate-pulse" />
                        <YtCoinLogo size="xl" className="relative ring-amber-400 shadow-[0_0_40px_rgba(212,175,55,0.6)] animate-bounce-slow" />
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                          مكافأة المطالبة الحالية
                        </span>
                        <div className="flex items-baseline justify-center gap-1.5">
                          <strong className="text-3xl sm:text-4xl font-black font-mono tabular-nums text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-300">
                            +{formatYtUnits(summary.todayRewardUnits)}
                          </strong>
                          <span className="text-sm font-black text-amber-400">YT Coin</span>
                        </div>
                      </div>

                      {/* Circular / Linear Daily Cap Progress */}
                      <div className="w-full space-y-2 pt-2 border-t border-amber-500/20">
                        <div className="flex justify-between text-xs font-bold text-slate-300">
                          <span>استهلاك السقف اليومي:</span>
                          <span className="font-mono text-amber-300">
                            {formatYtUnits(summary.minedTodayUnits)} / {formatYtUnits(summary.dailyCapUnits)} YT
                          </span>
                        </div>
                        <div className="w-full h-3 rounded-full bg-slate-900 overflow-hidden p-0.5 border border-amber-500/30">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-300 transition-all duration-700 shadow-[0_0_15px_rgba(212,175,55,0.6)]"
                            style={{ width: `${capProgressPct}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400">
                          المتبقي من سقف اليوم: <strong className="text-amber-300 font-mono">{formatYtUnits(summary.dailyCapRemainingUnits)} YT</strong>
                        </p>
                      </div>

                      {/* Main Claim / Mining Button */}
                      <button
                        type="button"
                        onClick={handleClaim}
                        disabled={claiming || !summary.canClaim}
                        className={`w-full min-h-[54px] rounded-2xl px-6 py-4 flex items-center justify-center gap-2.5 text-sm sm:text-base font-black transition-all ${
                          summary.canClaim
                            ? 'bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 shadow-[0_10px_30px_rgba(212,175,55,0.4)] cursor-pointer active:scale-95'
                            : 'bg-slate-800/80 text-slate-400 border border-slate-700 cursor-not-allowed'
                        }`}
                      >
                        {claiming ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin shrink-0 text-slate-950" />
                            <span>جاري تعدين وإرسال المكافأة...</span>
                          </>
                        ) : summary.canClaim ? (
                          <>
                            <Coins className="w-5 h-5 shrink-0" />
                            <span>⛏️ ابدأ التعدين / استلام مكافأة اليوم</span>
                          </>
                        ) : summary.capReached ? (
                          <>
                            <ShieldCheck className="w-5 h-5 shrink-0 text-amber-400" />
                            <span>تم استنفاد السقف اليومي للمنجم</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                            <span>تم استلام مكافأة اليوم بنجاح</span>
                          </>
                        )}
                      </button>

                      {summary.statusMessage && (
                        <p className="text-xs text-amber-300 font-semibold">{summary.statusMessage}</p>
                      )}
                    </div>

                    {/* Integrated Crypto Wallet Card */}
                    <div className="rounded-3xl border border-amber-500/40 bg-gradient-to-br from-[#181C28] to-[#0F121B] p-6 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                            <Wallet className="w-5 h-5" />
                          </span>
                          <div>
                            <h3 className="text-sm font-extrabold text-amber-200">محفظة YT Coin</h3>
                            <p className="text-[11px] text-slate-400">مستقلة تماماً عن محفظة الريال اليمني</p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-[11px] font-bold text-emerald-300">
                          نشطة 🟢
                        </span>
                      </div>

                      {/* Balance Display */}
                      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-4 flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-slate-400">إجمالي الرصيد المتاح</span>
                          <div className="mt-1 flex items-baseline gap-1.5 font-mono">
                            <strong className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-300">
                              {formatYtUnits(summary.balanceUnits)}
                            </strong>
                            <span className="text-xs font-extrabold text-amber-400">YT Coin</span>
                          </div>
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            إجمالي المُعدَّن مدى الحياة: {formatYtUnits(summary.lifetimeEarnedUnits)} YT
                          </span>
                        </div>
                        <YtCoinLogo size="lg" />
                      </div>

                      {/* Wallet ID with Copy Button */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-slate-400">معرف محفظة المستخدم (Wallet ID):</span>
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-300">
                          <span className="truncate">{user.id}</span>
                          <button
                            type="button"
                            onClick={copyWalletId}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2.5 py-1 text-[11px] font-bold transition-colors shrink-0 cursor-pointer"
                          >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column (Live Metrics Grid + History & Boosts) */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* Live Mine Metrics Grid (2x2 Cards) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Metric 1: Daily Cap & Increment */}
                      <div className="rounded-2xl border border-amber-500/30 bg-[#151922] p-4 flex items-center justify-between gap-3 shadow-md">
                        <div className="space-y-1">
                          <span className="text-xs font-bold text-slate-400">السقف اليومي + الزيادة</span>
                          <div className="font-mono text-lg font-black text-amber-200">
                            {formatYtUnits(summary.dailyCapUnits)} <span className="text-xs text-amber-400">YT/يوم</span>
                          </div>
                          <p className="text-[10px] text-emerald-400 font-semibold">
                            📈 تزيد +1 عملة صحيحة كل يوم تلقائياً
                          </p>
                        </div>
                        <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                          <TrendingUp className="w-5 h-5" />
                        </span>
                      </div>

                      {/* Metric 2: Mining Streak */}
                      <div className="rounded-2xl border border-amber-500/30 bg-[#151922] p-4 flex items-center justify-between gap-3 shadow-md">
                        <div className="space-y-1">
                          <span className="text-xs font-bold text-slate-400">سلسلة التعدين المتتالية</span>
                          <div className="font-mono text-lg font-black text-amber-200">
                            {formatYtUnits(summary.streakDays)} <span className="text-xs text-amber-400">يوم</span>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            🔥 مكافأة التزام يومية متصاعدة
                          </p>
                        </div>
                        <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                          <Flame className="w-5 h-5" />
                        </span>
                      </div>

                      {/* Metric 3: Max Supply & Total Mined Progress */}
                      <div className="rounded-2xl border border-amber-500/30 bg-[#151922] p-4 space-y-2 sm:col-span-2 shadow-md">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                          <span className="flex items-center gap-1.5">
                            <Lock className="w-4 h-4 text-amber-400" />
                            <span>المعروض المستخرج من إجمالي المعروض</span>
                          </span>
                          <span className="font-mono text-amber-300">
                            {formatYtUnits(summary.totalMinedUnits)} / {formatYtUnits(summary.maxSupplyUnits)} YT
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden p-0.5 border border-amber-500/20">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-700"
                            style={{ width: `${supplyProgressPct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>نسبة الاستخراج الكلي: {supplyProgressPct.toFixed(4)}%</span>
                          <span className="text-emerald-400">حماية المعروض مفعلة 100%</span>
                        </div>
                      </div>
                    </div>

                    {/* Mining Boosts Section */}
                    <div className="rounded-3xl border border-amber-500/30 bg-[#151922] p-5 space-y-3 shadow-xl">
                      <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-amber-400" />
                        <h3 className="text-sm font-extrabold text-amber-200">تعزيزات وقوة التعدين القادمة</h3>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        قم بإكمال المهام اليومية في المنصة أو دعوة أصدقائك عبر رابط الإحالة لزيادة قوة ومضاعفة سرعة تعدين عملة YT Coin في التحديثات القادمة.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-3 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">✓</span>
                          <div>
                            <h4 className="text-xs font-bold text-white">إكمال مهمة يومية</h4>
                            <p className="text-[10px] text-slate-400">متاح الآن عبر قسم المهام</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-3 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">👥</span>
                          <div>
                            <h4 className="text-xs font-bold text-white">برنامج الإحالات</h4>
                            <p className="text-[10px] text-slate-400">ادعُ أصدقاءك واربح مكافآت مضاعفة</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Reward History Section */}
                    <div className="rounded-3xl border border-amber-500/30 bg-[#151922] overflow-hidden shadow-xl">
                      <button
                        type="button"
                        onClick={() => setShowHistory((prev) => !prev)}
                        aria-expanded={showHistory}
                        className="w-full px-5 py-4 flex items-center justify-between gap-2 text-xs font-extrabold text-amber-200 hover:bg-slate-900/60 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <History className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>سجل عمليات التعدين والمكافآت</span>
                          <span className="rounded-full bg-amber-500/20 text-amber-300 px-2.5 py-0.5 text-[11px] font-mono tabular-nums border border-amber-500/30">
                            {summary.history.length} عملية
                          </span>
                        </span>
                        {showHistory ? <ChevronUp className="w-4 h-4 text-amber-400" /> : <ChevronDown className="w-4 h-4 text-amber-400" />}
                      </button>

                      {showHistory && (
                        <div className="border-t border-amber-500/20 divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                          {summary.history.length === 0 ? (
                            <div className="px-5 py-8 text-center text-xs text-slate-400">
                              لا توجد عمليات تعدين مسجلة بعد. ابدأ بالتعدين اليومي الآن لجمع عملات YT Coin!
                            </div>
                          ) : (
                            summary.history.map((item) => (
                              <div
                                key={item.id}
                                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-900/40 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <YtCoinLogo size="sm" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-extrabold text-white truncate">{item.label}</p>
                                    <p className="text-[10px] text-slate-400 truncate">
                                      {item.createdAt ? formatDateTime(item.createdAt) : '—'}
                                      {item.reference ? ` • مرجع: ${item.reference}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-left shrink-0 font-mono">
                                  <span className="inline-flex items-center gap-1 text-sm font-black text-amber-300">
                                    +{formatYtUnits(item.rewardUnits)}
                                    <span className="text-[10px] text-amber-500">YT</span>
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
