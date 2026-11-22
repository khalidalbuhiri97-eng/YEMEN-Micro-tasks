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
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

type CoinSize = 'xs' | 'sm' | 'md' | 'lg';

const COIN_SIZE_CLASSES: Record<CoinSize, string> = {
  xs: 'w-5 h-5 ring-1',
  sm: 'w-6 h-6 ring-[1.5px]',
  md: 'w-9 h-9 ring-2',
  lg: 'w-12 h-12 sm:w-14 sm:h-14 ring-2',
};

const YtCoinLogo: React.FC<{ size?: CoinSize; className?: string }> = ({
  size = 'md',
  className = '',
}) => (
  <span
    className={`inline-flex items-center justify-center rounded-full aspect-square shrink-0 overflow-hidden bg-slate-950 ring-amber-400/80 dark:ring-amber-400/70 shadow-sm ${COIN_SIZE_CLASSES[size]} ${className}`}
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
  amountYt: number | null;
  label: string;
  createdAt: string | null;
  claimDate: string | null;
  streakDay: number | null;
  reference: string | null;
}

interface NormalizedYtCoinSummary {
  balanceYt: number | null;
  totalMinedYt: number | null;
  todayRewardYt: number | null;
  canClaim: boolean;
  claimedToday: boolean;
  capReached: boolean;
  miningEnabled: boolean;
  streakDays: number | null;
  totalClaims: number | null;
  lastClaimAt: string | null;
  nextClaimAt: string | null;
  nextClaimInSeconds: number | null;
  poolRemainingYt: number | null;
  poolCapYt: number | null;
  poolDistributedYt: number | null;
  userCapYt: number | null;
  userRemainingCapYt: number | null;
  statusMessage: string | null;
  history: NormalizedHistoryItem[];
}

function asRecord(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
}

function pickNumber(sources: Array<Record<string, any> | null>, keys: string[]): number | null {
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
  return null;
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

function translateEventLabel(raw: string | null): string {
  if (!raw) return 'مكافأة تعدين يومي';
  const normalized = raw.toLowerCase();
  if (normalized.includes('daily') || normalized.includes('mine') || normalized.includes('mining')) {
    return 'مكافأة تعدين يومي';
  }
  if (normalized.includes('streak') || normalized.includes('bonus')) {
    return 'مكافأة سلسلة التعدين';
  }
  if (normalized.includes('referral')) {
    return 'مكافأة إحالة YT Coin';
  }
  if (normalized.includes('transfer')) {
    return 'تحويل YT Coin';
  }
  return raw;
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
    asRecord(root.rewards_pool),
    asRecord(root.rewards_treasury),
    asRecord(root.treasury),
    asRecord(root.limits),
    asRecord(root.config),
  ];

  let balanceYt = pickNumber(sources, [
    'balance_yt',
    'yt_balance',
    'wallet_balance_yt',
    'available_yt',
    'available_balance_yt',
    'balance',
    'balanceYt',
  ]);
  if (balanceYt === null) {
    const atomicBalance = pickNumber(sources, ['balance_atomic', 'atomic_balance', 'balance_units']);
    if (atomicBalance !== null) balanceYt = atomicBalance / 1_000_000;
  }

  let totalMinedYt = pickNumber(sources, [
    'total_mined_yt',
    'lifetime_mined_yt',
    'total_earned_yt',
    'lifetime_earned_yt',
    'total_claimed_yt',
    'mined_yt',
    'totalMinedYt',
  ]);
  if (totalMinedYt === null) {
    const atomicMined = pickNumber(sources, ['total_mined_atomic', 'lifetime_mined_atomic']);
    if (atomicMined !== null) totalMinedYt = atomicMined / 1_000_000;
  }

  let todayRewardYt = pickNumber(sources, [
    'today_reward_yt',
    'daily_reward_yt',
    'next_reward_yt',
    'claim_reward_yt',
    'current_reward_yt',
    'reward_yt',
    'base_reward_yt',
    'today_reward',
    'daily_reward',
    'todayRewardYt',
    'dailyRewardYt',
  ]);
  if (todayRewardYt === null) {
    const atomicReward = pickNumber(sources, ['today_reward_atomic', 'daily_reward_atomic', 'reward_atomic']);
    if (atomicReward !== null) todayRewardYt = atomicReward / 1_000_000;
  }

  const claimedTodayFlag = pickBoolean(sources, [
    'claimed_today',
    'already_claimed_today',
    'has_claimed_today',
    'claimedToday',
  ]);
  const capReachedFlag = pickBoolean(sources, [
    'cap_reached',
    'mining_cap_reached',
    'pool_exhausted',
    'is_capped',
    'user_cap_reached',
    'capReached',
  ]);
  const miningEnabledFlag = pickBoolean(sources, [
    'mining_enabled',
    'is_enabled',
    'enabled',
    'active',
    'is_active',
  ]);
  const canClaimExplicit = pickBoolean(sources, [
    'can_claim_today',
    'can_claim',
    'is_claimable',
    'claimable',
    'eligible_today',
    'canClaim',
    'canClaimToday',
  ]);

  const poolRemainingYt = pickNumber(sources, [
    'pool_remaining_yt',
    'rewards_treasury_balance_yt',
    'rewards_pool_remaining_yt',
    'mining_pool_remaining_yt',
    'mining_cap_remaining_yt',
    'remaining_pool_yt',
    'remaining_yt',
    'poolRemainingYt',
  ]);
  const poolCapYt = pickNumber(sources, [
    'mining_cap_yt',
    'pool_cap_yt',
    'pool_total_yt',
    'total_mining_cap_yt',
    'allocated_yt',
    'rewards_pool_cap_yt',
    'max_mining_supply_yt',
    'poolCapYt',
  ]);
  let poolDistributedYt = pickNumber(sources, [
    'pool_distributed_yt',
    'total_distributed_yt',
    'global_mined_yt',
    'total_mined_global_yt',
    'distributed_yt',
    'mined_so_far_yt',
    'poolDistributedYt',
  ]);
  if (poolDistributedYt === null && poolCapYt !== null && poolRemainingYt !== null) {
    poolDistributedYt = Math.max(0, poolCapYt - poolRemainingYt);
  }

  const userCapYt = pickNumber(sources, [
    'user_cap_yt',
    'user_mining_cap_yt',
    'personal_cap_yt',
    'max_user_mining_yt',
    'userCapYt',
  ]);
  const userRemainingCapYt = pickNumber(sources, [
    'user_remaining_cap_yt',
    'user_cap_remaining_yt',
    'remaining_user_cap_yt',
  ]);

  const capReached =
    capReachedFlag === true ||
    (poolRemainingYt !== null && poolRemainingYt <= 0) ||
    (userRemainingCapYt !== null && userRemainingCapYt <= 0);
  const miningEnabled = miningEnabledFlag !== false;
  const claimedToday = claimedTodayFlag === true;
  const canClaim =
    canClaimExplicit !== null
      ? canClaimExplicit && !capReached && miningEnabled
      : !claimedToday && !capReached && miningEnabled;

  const streakDays = pickNumber(sources, [
    'streak_days',
    'current_streak',
    'streak',
    'consecutive_days',
    'streakDays',
  ]);
  const totalClaims = pickNumber(sources, [
    'total_claims',
    'claims_count',
    'claim_count',
    'days_claimed',
    'totalClaims',
  ]);

  const lastClaimAt = pickString(sources, ['last_claim_at', 'last_claimed_at', 'lastClaimAt']);
  const nextClaimAt = pickString(sources, [
    'next_claim_at',
    'next_available_at',
    'cooldown_until',
    'reset_at',
    'nextClaimAt',
  ]);
  const nextClaimInSeconds = pickNumber(sources, [
    'next_claim_in_seconds',
    'seconds_until_next_claim',
    'cooldown_seconds',
    'remaining_seconds',
  ]);
  const statusMessage = pickString(sources, [
    'status_message',
    'reason',
    'blocked_reason',
    'notice',
    'message',
  ]);

  const rawHistory = pickArray(sources, [
    'recent_rewards',
    'recent_claims',
    'reward_history',
    'rewards_history',
    'mining_history',
    'history',
    'claims',
    'entries',
    'recent_entries',
    'transactions',
    'ledger',
  ]);

  const history: NormalizedHistoryItem[] = rawHistory
    .map((entry, idx) => {
      const rec = asRecord(entry);
      if (!rec) return null;
      let amountYt = pickNumber([rec], [
        'amount_yt',
        'reward_yt',
        'claimed_yt',
        'delta_yt',
        'amount',
        'reward',
      ]);
      if (amountYt === null) {
        const atomic = pickNumber([rec], ['atomic_units', 'amount_atomic', 'reward_atomic']);
        if (atomic !== null) amountYt = atomic / 1_000_000;
      }
      const rawLabel = pickString([rec], [
        'label',
        'title',
        'description',
        'note',
        'event_label',
        'event_type',
        'type',
      ]);
      const createdAt = pickString([rec], ['created_at', 'claimed_at', 'timestamp', 'date']);
      const claimDate = pickString([rec], ['claim_date', 'mining_day', 'day']);
      const streakDay = pickNumber([rec], ['streak_day', 'streak', 'day_number']);
      const reference = pickString([rec], ['reference', 'tx_ref', 'ref']);
      return {
        id: String(rec.id ?? rec.claim_id ?? rec.entry_id ?? reference ?? `yt-row-${idx}`),
        amountYt,
        label: translateEventLabel(rawLabel),
        createdAt,
        claimDate,
        streakDay,
        reference,
      };
    })
    .filter((item): item is NormalizedHistoryItem => item !== null);

  return {
    balanceYt,
    totalMinedYt,
    todayRewardYt,
    canClaim,
    claimedToday,
    capReached,
    miningEnabled,
    streakDays,
    totalClaims,
    lastClaimAt,
    nextClaimAt,
    nextClaimInSeconds,
    poolRemainingYt,
    poolCapYt,
    poolDistributedYt,
    userCapYt,
    userRemainingCapYt,
    statusMessage,
    history,
  };
}

function formatYt(value: number | null, maxDecimals = 4): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const hasFraction = Math.abs(value - Math.trunc(value)) > 1e-9;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? maxDecimals : 0,
  }).format(value);
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

function formatCountdown(secondsTotal: number): string {
  const clamped = Math.max(0, Math.floor(secondsTotal));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return [hrs, mins, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

export const YtCoinMiningCard: React.FC<{ compact?: boolean; onOpen?: () => void }> = ({ compact = false, onOpen }) => {
  const { user, openAuthModal, showToast } = useAuth();
  const [rawSummary, setRawSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [loadedAtTs, setLoadedAtTs] = useState<number>(() => Date.now());

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
        setRawSummary(res?.summary ?? null);
        setLoadedAtTs(Date.now());
      } catch (err: any) {
        setError(err?.message || 'تعذر تحميل بيانات تعدين YT Coin.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!compact) void loadSummary(false);
  }, [loadSummary, compact]);

  const summary = useMemo(
    () => (rawSummary ? normalizeSummary(rawSummary) : null),
    [rawSummary]
  );

  const remainingCooldownSec = useMemo(() => {
    if (!summary || summary.canClaim) return 0;
    if (summary.nextClaimAt) {
      const target = new Date(summary.nextClaimAt).getTime();
      if (Number.isFinite(target)) {
        return Math.max(0, Math.floor((target - nowTs) / 1000));
      }
    }
    if (summary.nextClaimInSeconds !== null && summary.nextClaimInSeconds > 0) {
      const elapsed = Math.floor((nowTs - loadedAtTs) / 1000);
      return Math.max(0, summary.nextClaimInSeconds - elapsed);
    }
    return 0;
  }, [summary, nowTs, loadedAtTs]);

  useEffect(() => {
    if (remainingCooldownSec <= 0) return;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [remainingCooldownSec > 0]);

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
      const result = asRecord(res?.result);
      const claimedAmount = pickNumber([result], [
        'reward_yt',
        'claimed_yt',
        'amount_yt',
        'credited_yt',
        'reward',
      ]);
      const resultMessage = pickString([result], ['message', 'status_message']);
      const rejected =
        result?.ok === false ||
        result?.claimed === false ||
        result?.already_claimed === true;

      if (rejected) {
        showToast(resultMessage || 'تم استلام مكافأة اليوم مسبقاً.', 'info');
      } else if (claimedAmount !== null) {
        showToast(
          resultMessage || `تم استلام +${formatYt(claimedAmount)} YT Coin بنجاح.`,
          'success'
        );
      } else {
        showToast(resultMessage || 'تم استلام مكافأة التعدين اليومي بنجاح.', 'success');
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

  const poolProgressPct = useMemo(() => {
    if (!summary || summary.poolCapYt === null || summary.poolCapYt <= 0) return null;
    const distributed =
      summary.poolDistributedYt !== null
        ? summary.poolDistributedYt
        : summary.poolRemainingYt !== null
          ? Math.max(0, summary.poolCapYt - summary.poolRemainingYt)
          : null;
    if (distributed === null) return null;
    return Math.min(100, Math.max(0, (distributed / summary.poolCapYt) * 100));
  }, [summary]);

  if (compact) {
    return (
      <section aria-label="YT Coin" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 pb-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label="فتح صفحة تعدين عملة YT Coin اليومية"
          className="group relative w-full overflow-hidden rounded-2xl border border-amber-400/45 dark:border-amber-500/35 bg-gradient-to-l from-slate-950 via-emerald-950 to-slate-900 text-white px-4 py-3.5 sm:px-6 sm:py-4 shadow-lg shadow-emerald-950/15 hover:border-amber-300/80 transition-all active:scale-[0.99] cursor-pointer text-right"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-12 -left-10 w-44 h-44 rounded-full bg-amber-400/15 blur-2xl group-hover:bg-amber-400/25 transition-colors"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-14 right-1/4 w-44 h-44 rounded-full bg-emerald-500/15 blur-2xl"
          />

          <div className="relative flex items-center justify-between gap-3 sm:gap-5">
            <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
              <YtCoinLogo
                size="lg"
                className="ring-amber-300 shadow-lg shadow-amber-500/25 group-hover:scale-105 transition-transform"
              />
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm sm:text-base font-black tracking-tight text-white">
                    عملة YT Coin
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-300/35 px-2.5 py-0.5 text-[10px] sm:text-[11px] font-extrabold text-amber-300">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    تعدين يومي مجاني
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 truncate sm:whitespace-normal">
                  اجمع مكافأتك اليومية من عملة المنصة الرسمية وتابع رصيدك وسلسلة التعدين بنقرة واحدة.
                </p>
              </div>
            </div>

            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-amber-400 to-amber-500 group-hover:from-amber-300 group-hover:to-amber-400 text-slate-950 px-3.5 py-2 sm:px-4 sm:py-2.5 text-xs font-black shadow-md shadow-amber-500/20 transition-colors">
              <span className="hidden xs:inline">افتح التعدين</span>
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
      aria-label="التعدين اليومي لعملة YT Coin"
      className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-2"
    >
      <div className="relative overflow-hidden rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-gradient-to-br from-amber-50/90 via-white to-emerald-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/25 shadow-sm">
        <div className="pointer-events-none absolute -top-20 -left-20 w-56 h-56 rounded-full bg-amber-300/20 dark:bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 w-56 h-56 rounded-full bg-emerald-300/20 dark:bg-emerald-500/10 blur-3xl" />

        <div className="relative p-4 sm:p-5 space-y-4">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <YtCoinLogo size="lg" className="shadow-md shadow-amber-500/20" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                    تعدين عملة YT Coin
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 dark:border-amber-500/40 bg-amber-100/80 dark:bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    مكافأة يومية مجانية
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                  رصيد عملة YT Coin مستقل بالكامل عن محفظة الريال اليمني ويُحتسب وفق سقف التعدين الرسمي.
                </p>
              </div>
            </div>

            {user && (
              <button
                type="button"
                onClick={() => void loadSummary(false)}
                disabled={loading}
                aria-label="تحديث بيانات YT Coin"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-amber-400 transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
            )}
          </div>

          {/* Guest View */}
          {!user ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-white/80 dark:bg-slate-950/60 p-3.5 sm:p-4">
              <div className="flex items-center gap-3 min-w-0">
                <YtCoinLogo size="md" />
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    سجّل الدخول لاستلام مكافأتك اليومية من YT Coin
                  </p>
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    تابع رصيدك من YT Coin وسجل مكافآت التعدين اليومي مباشرة من حسابك.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white px-4 py-2.5 text-xs sm:text-sm font-extrabold shadow-sm shadow-amber-500/25 transition-all shrink-0 cursor-pointer"
              >
                <YtCoinLogo size="xs" className="ring-white/60" />
                <LogIn className="w-4 h-4" />
                <span>تسجيل الدخول للتعدين</span>
              </button>
            </div>
          ) : loading && !summary ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-pulse">
              <div className="h-20 rounded-xl bg-amber-100/60 dark:bg-slate-800/70" />
              <div className="h-20 rounded-xl bg-amber-100/60 dark:bg-slate-800/70" />
              <div className="h-20 rounded-xl bg-amber-100/60 dark:bg-slate-800/70" />
            </div>
          ) : (
            <>
              {error && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                  <span className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadSummary(false)}
                    className="rounded-lg bg-rose-600 text-white px-2.5 py-1 text-[11px] font-bold hover:bg-rose-700"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              )}

              {summary && (
                <div className="space-y-3.5">
                  {/* Metrics + Action Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    {/* Current YT Coin Balance */}
                    <div className="rounded-xl border border-amber-200/80 dark:border-amber-500/25 bg-white/90 dark:bg-slate-950/70 p-3 flex items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          رصيد YT Coin
                        </span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <strong className="text-lg sm:text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white truncate">
                            {formatYt(summary.balanceYt)}
                          </strong>
                          <span className="text-[11px] font-extrabold text-amber-600 dark:text-amber-400">
                            YT
                          </span>
                        </div>
                        {summary.totalMinedYt !== null && (
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                            إجمالي المُعدَّن: {formatYt(summary.totalMinedYt)} YT
                          </span>
                        )}
                      </div>
                      <YtCoinLogo size="md" />
                    </div>

                    {/* Today's Reward */}
                    <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-500/25 bg-white/90 dark:bg-slate-950/70 p-3 flex items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          مكافأة اليوم
                        </span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <strong className="text-lg sm:text-xl font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400 truncate">
                            {summary.todayRewardYt !== null ? `+${formatYt(summary.todayRewardYt)}` : '—'}
                          </strong>
                          <span className="text-[11px] font-extrabold text-amber-600 dark:text-amber-400">
                            YT
                          </span>
                        </div>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {summary.claimedToday
                            ? 'تم استلام مكافأة اليوم'
                            : summary.capReached
                              ? 'تم بلوغ سقف التعدين'
                              : 'جاهزة للمطالبة الآن'}
                        </span>
                      </div>
                      <YtCoinLogo size="md" />
                    </div>

                    {/* Streak / Activity */}
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-950/70 p-3 flex items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          سلسلة التعدين
                        </span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <strong className="text-lg sm:text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                            {summary.streakDays !== null
                              ? formatYt(summary.streakDays, 0)
                              : summary.totalClaims !== null
                                ? formatYt(summary.totalClaims, 0)
                                : '0'}
                          </strong>
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {summary.streakDays !== null ? 'يوم متتالي' : 'مطالبة'}
                          </span>
                        </div>
                        {summary.totalClaims !== null && summary.streakDays !== null && (
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                            إجمالي المطالبات: {formatYt(summary.totalClaims, 0)}
                          </span>
                        )}
                      </div>
                      <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                        <Flame className="w-5 h-5" />
                      </span>
                    </div>

                    {/* Daily Claim Action Button */}
                    <div className="rounded-xl border border-amber-200/80 dark:border-amber-500/25 bg-white/90 dark:bg-slate-950/70 p-3 flex flex-col justify-center">
                      <button
                        type="button"
                        onClick={handleClaim}
                        disabled={claiming || !summary.canClaim}
                        className={`w-full min-h-[46px] rounded-xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-extrabold transition-all ${
                          summary.canClaim
                            ? 'bg-gradient-to-l from-emerald-600 via-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-600/25 cursor-pointer'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {claiming ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            <span>جاري استلام المكافأة...</span>
                          </>
                        ) : summary.canClaim ? (
                          <>
                            <YtCoinLogo size="sm" className="ring-amber-300 shadow-none" />
                            <span>
                              {summary.todayRewardYt !== null
                                ? `مطالبة +${formatYt(summary.todayRewardYt)} YT`
                                : 'استلام مكافأة اليوم'}
                            </span>
                          </>
                        ) : summary.capReached ? (
                          <>
                            <ShieldCheck className="w-4 h-4 shrink-0" />
                            <span>تم بلوغ سقف التعدين</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>
                              {remainingCooldownSec > 0
                                ? `المطالبة القادمة ${formatCountdown(remainingCooldownSec)}`
                                : 'تم الاستلام اليوم'}
                            </span>
                          </>
                        )}
                      </button>

                      {summary.statusMessage && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center mt-1.5 truncate">
                          {summary.statusMessage}
                        </p>
                      )}
                      {!summary.statusMessage && !summary.canClaim && summary.nextClaimAt && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center mt-1.5 flex items-center justify-center gap-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>التالي: {formatDateTime(summary.nextClaimAt)}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Mining Cap / Pool Progress Bar (only when returned by API) */}
                  {(summary.poolRemainingYt !== null || summary.poolCapYt !== null) && (
                    <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white/75 dark:bg-slate-950/50 px-3.5 py-2.5 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <YtCoinLogo size="xs" />
                          <span>مخزون التعدين المتاح</span>
                        </span>
                        <span className="font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200">
                          {summary.poolRemainingYt !== null ? `${formatYt(summary.poolRemainingYt)} YT متبقٍ` : ''}
                          {summary.poolRemainingYt !== null && summary.poolCapYt !== null ? ' / ' : ''}
                          {summary.poolCapYt !== null ? `سقف ${formatYt(summary.poolCapYt)} YT` : ''}
                        </span>
                      </div>
                      {poolProgressPct !== null && (
                        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-l from-amber-500 to-emerald-500 transition-all duration-500"
                            style={{ width: `${poolProgressPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reward History Toggle & List */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-950/60 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowHistory((prev) => !prev)}
                      aria-expanded={showHistory}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <History className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>سجل مكافآت YT Coin</span>
                        <span className="rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-[10px] font-mono tabular-nums">
                          {summary.history.length}
                        </span>
                      </span>
                      {showHistory ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    {showHistory && (
                      <div className="border-t border-slate-200/70 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 max-h-64 overflow-y-auto">
                        {summary.history.length === 0 ? (
                          <div className="px-4 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                            لا توجد مكافآت تعدين مسجلة بعد. اضغط على زر المطالبة اليومي لبدء جمع YT Coin.
                          </div>
                        ) : (
                          summary.history.map((item) => (
                            <div
                              key={item.id}
                              className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-amber-50/40 dark:hover:bg-slate-900/50 transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <YtCoinLogo size="sm" />
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                    {item.label}
                                  </p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                    {item.createdAt
                                      ? formatDateTime(item.createdAt)
                                      : item.claimDate || '—'}
                                    {item.streakDay !== null ? ` • اليوم ${item.streakDay}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="text-left shrink-0">
                                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-xs sm:text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                                  {item.amountYt !== null ? `+${formatYt(item.amountYt)}` : '—'}
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                    YT
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
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
