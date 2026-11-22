import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flame,
  Clock,
  CheckCircle2,
  RefreshCw,
  History,
  LogIn,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Sparkles,
  ArrowUpRight,
  Wallet,
  BarChart3,
  ListChecks,
  Pickaxe,
  Copy,
  Check,
  Coins,
  TrendingUp,
  Award,
  Zap,
  Calendar,
  Info,
  ArrowDownLeft,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

type CoinSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type ActiveTab = 'mine' | 'wallet' | 'stats' | 'tasks';

const COIN_SIZE_CLASSES: Record<CoinSize, string> = {
  xs: 'w-5 h-5 ring-1',
  sm: 'w-6 h-6 ring-[1.5px]',
  md: 'w-9 h-9 ring-2',
  lg: 'w-12 h-12 sm:w-14 sm:h-14 ring-2',
  xl: 'w-24 h-24 sm:w-28 sm:h-28 ring-4',
};

const YtCoinLogo: React.FC<{ size?: CoinSize; className?: string }> = ({
  size = 'md',
  className = '',
}) => (
  <span
    className={`inline-flex items-center justify-center rounded-full aspect-square shrink-0 overflow-hidden bg-slate-950 ring-amber-400/80 shadow-sm ${COIN_SIZE_CLASSES[size]} ${className}`}
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
  dailyCapYt: number | null;
  dailyMinedYt: number | null;
  dailyRemainingYt: number | null;
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
    const atomicBalance = pickNumber(sources, ['balanceUnits', 'balance_units', 'balance_atomic', 'atomic_balance']);
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
    const atomicMined = pickNumber(sources, [
      'lifetimeEarnedUnits',
      'lifetime_earned_units',
      'total_mined_units',
      'total_mined_atomic',
      'lifetime_mined_atomic',
    ]);
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
    const atomicReward = pickNumber(sources, [
      'nextRewardUnits',
      'next_reward_units',
      'rewardUnits',
      'reward_units',
      'today_reward_atomic',
      'daily_reward_atomic',
      'reward_atomic',
    ]);
    if (atomicReward !== null) todayRewardYt = atomicReward / 1_000_000;
  }

  const lastClaimDate = pickString(sources, ['lastClaimDate', 'last_claim_date', 'claim_date']);
  const adenToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aden',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const claimedTodayFlag =
    pickBoolean(sources, ['claimed_today', 'already_claimed_today', 'has_claimed_today', 'claimedToday']) ??
    (lastClaimDate === adenToday);

  const capReachedFlag = pickBoolean(sources, [
    'cap_reached',
    'mining_cap_reached',
    'pool_exhausted',
    'is_capped',
    'user_cap_reached',
    'capReached',
  ]);
  const miningEnabledFlag = pickBoolean(sources, ['mining_enabled', 'is_enabled', 'enabled', 'active', 'is_active']);
  const canClaimExplicit = pickBoolean(sources, [
    'can_claim_today',
    'can_claim',
    'is_claimable',
    'claimable',
    'eligible_today',
    'canClaim',
    'canClaimToday',
  ]);

  let poolRemainingYt = pickNumber(sources, [
    'pool_remaining_yt',
    'rewards_treasury_balance_yt',
    'rewards_pool_remaining_yt',
    'mining_pool_remaining_yt',
    'mining_cap_remaining_yt',
    'remaining_pool_yt',
    'remaining_yt',
    'poolRemainingYt',
  ]);
  if (poolRemainingYt === null) {
    const atomicPoolRem = pickNumber(sources, ['poolRemainingUnits', 'pool_remaining_units']);
    if (atomicPoolRem !== null) poolRemainingYt = atomicPoolRem / 1_000_000;
  }

  let poolCapYt = pickNumber(sources, [
    'mining_cap_yt',
    'pool_cap_yt',
    'pool_total_yt',
    'total_mining_cap_yt',
    'allocated_yt',
    'rewards_pool_cap_yt',
    'max_mining_supply_yt',
    'poolCapYt',
  ]);
  if (poolCapYt === null) {
    const atomicPoolCap = pickNumber(sources, ['maxSupplyUnits', 'max_supply_units', 'poolCapUnits']);
    if (atomicPoolCap !== null) poolCapYt = atomicPoolCap / 1_000_000;
  }

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

  let dailyCapYt = pickNumber(sources, ['daily_cap_yt', 'dailyCapYt']);
  if (dailyCapYt === null) {
    const atomicDailyCap = pickNumber(sources, ['dailyCapUnits', 'daily_cap_units']);
    if (atomicDailyCap !== null) dailyCapYt = atomicDailyCap / 1_000_000;
  }

  let dailyMinedYt = pickNumber(sources, ['daily_mined_yt', 'mined_today_yt', 'dailyMinedYt']);
  if (dailyMinedYt === null) {
    const atomicDailyMined = pickNumber(sources, ['minedTodayUnits', 'mined_today_units', 'dailyMinedUnits']);
    if (atomicDailyMined !== null) dailyMinedYt = atomicDailyMined / 1_000_000;
  }

  let dailyRemainingYt = pickNumber(sources, ['daily_remaining_yt', 'dailyRemainingYt']);
  const dailyRemainingUnits = pickNumber(sources, [
    'dailyCapRemainingUnits',
    'daily_cap_remaining_units',
    'daily_remaining_units',
  ]);
  if (dailyRemainingYt === null && dailyRemainingUnits !== null) {
    dailyRemainingYt = dailyRemainingUnits / 1_000_000;
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
    (userRemainingCapYt !== null && userRemainingCapYt <= 0) ||
    (dailyRemainingUnits !== null && dailyRemainingUnits <= 0);

  const miningEnabled = miningEnabledFlag !== false;
  const claimedToday = claimedTodayFlag === true;
  const eligibleFlag = pickBoolean(sources, ['eligible', 'is_eligible']);
  const canClaim =
    canClaimExplicit !== null
      ? canClaimExplicit && !capReached && miningEnabled
      : !claimedToday &&
        !capReached &&
        miningEnabled &&
        eligibleFlag !== false &&
        !(dailyRemainingUnits !== null && dailyRemainingUnits <= 0);

  const streakDays = pickNumber(sources, ['streak_days', 'current_streak', 'streak', 'consecutive_days', 'streakDays']);
  const totalClaims = pickNumber(sources, ['total_claims', 'claims_count', 'claim_count', 'days_claimed', 'totalClaims']);

  const lastClaimAt = pickString(sources, ['last_claim_at', 'last_claimed_at', 'lastClaimAt']);
  const nextClaimAt = pickString(sources, ['next_claim_at', 'next_available_at', 'cooldown_until', 'reset_at', 'nextClaimAt']);
  const nextClaimInSeconds = pickNumber(sources, [
    'next_claim_in_seconds',
    'seconds_until_next_claim',
    'cooldown_seconds',
    'remaining_seconds',
  ]);
  const statusMessage = pickString(sources, ['status_message', 'reason', 'blocked_reason', 'notice', 'message']);

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
      let amountYt = pickNumber([rec], ['amount_yt', 'reward_yt', 'claimed_yt', 'delta_yt', 'amount', 'reward']);
      if (amountYt === null) {
        const atomic = pickNumber([rec], ['amountUnits', 'amount_units', 'atomic_units', 'amount_atomic', 'reward_atomic']);
        if (atomic !== null) amountYt = atomic / 1_000_000;
      }
      const rawLabel = pickString([rec], [
        'label',
        'title',
        'description',
        'note',
        'event_label',
        'event_type',
        'eventType',
        'type',
      ]);
      const createdAt = pickString([rec], ['created_at', 'createdAt', 'claimed_at', 'timestamp', 'date']);
      const claimDate = pickString([rec], ['claim_date', 'mining_day', 'day']);
      const streakDay = pickNumber([rec], ['streak_day', 'streakDay', 'streak', 'day_number']);
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
    dailyCapYt,
    dailyMinedYt,
    dailyRemainingYt,
    userCapYt,
    userRemainingCapYt,
    statusMessage,
    history,
  };
}

function formatYt(value: number | null, maxDecimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? '-<0.01' : '<0.01';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(2, Math.max(0, maxDecimals)),
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

export const YtCoinMiningCard: React.FC<{ compact?: boolean; onOpen?: () => void }> = ({
  compact = false,
  onOpen,
}) => {
  const { user, openAuthModal, showToast } = useAuth();
  const [rawSummary, setRawSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('mine');
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);
  const [coinPulse, setCoinPulse] = useState<boolean>(false);
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

  const summary = useMemo(() => (rawSummary ? normalizeSummary(rawSummary) : null), [rawSummary]);

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

  const walletAddress = useMemo(() => {
    const rawId = String((user as any)?.id || (user as any)?.user_id || 'YT-GUEST-0000');
    const clean = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `YT-${clean.slice(0, 6)}-${clean.slice(-6) || 'YEMEN'}`;
  }, [user]);

  const handleCopyAddress = () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      showToast('تم نسخ عنوان محفظة YT Coin بنجاح.', 'success');
      window.setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleClaim = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (claiming) return;
    setCoinPulse(true);
    window.setTimeout(() => setCoinPulse(false), 450);
    setClaiming(true);
    setError(null);
    try {
      const res = await api.claimDailyYtCoin();
      const result = asRecord(res?.result);
      let claimedAmount = pickNumber([result], ['reward_yt', 'claimed_yt', 'amount_yt', 'credited_yt', 'reward']);
      if (claimedAmount === null) {
        const claimedUnits = pickNumber([result], ['amount_units', 'amountUnits', 'reward_units', 'rewardUnits']);
        if (claimedUnits !== null) claimedAmount = claimedUnits / 1_000_000;
      }
      const resultMessage = pickString([result], ['message', 'status_message']);
      const rejected =
        result?.ok === false ||
        result?.success === false ||
        result?.claimed === false ||
        result?.already_claimed === true;

      if (rejected) {
        showToast(resultMessage || 'تم استلام مكافأة اليوم مسبقاً.', 'info');
      } else if (claimedAmount !== null) {
        showToast(resultMessage || `تم استلام +${formatYt(claimedAmount)} YT Coin بنجاح.`, 'success');
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

  const dailyProgressPct = useMemo(() => {
    if (!summary || summary.dailyCapYt === null || summary.dailyCapYt <= 0) return 0;
    const mined =
      summary.dailyMinedYt !== null
        ? summary.dailyMinedYt
        : summary.dailyRemainingYt !== null
          ? Math.max(0, summary.dailyCapYt - summary.dailyRemainingYt)
          : 0;
    return Math.min(100, Math.max(0, (mined / summary.dailyCapYt) * 100));
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
                  <span className="text-sm sm:text-base font-black tracking-tight text-white">عملة YT Coin</span>
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
    <div
      dir="rtl"
      className="min-h-[100dvh] w-full bg-[#0b0f19] text-white flex flex-col justify-between relative overflow-x-hidden selection:bg-amber-400 selection:text-slate-950"
    >
      {/* Ambient Background Glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-28 -left-24 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-1/3 -right-24 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl"
      />

      {/* Top Sticky App Bar */}
      <header className="sticky top-0 z-30 w-full bg-[#0f1524]/90 backdrop-blur-md border-b border-amber-500/20 px-4 py-3 sm:px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <YtCoinLogo size="md" className="ring-amber-400 shadow-md shadow-amber-500/20" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black text-amber-400 tracking-tight truncate">
                  منجم عملة YT Coin الرقمية
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  <Sparkles className="w-3 h-3" />
                  سقف 1 مليار
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                منصة تعدين مستقلة ذات سقف تصاعدي يومي بدون كسور عشرية
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <div className="hidden xs:flex items-center gap-1.5 rounded-xl bg-slate-900 border border-amber-500/30 px-3 py-1.5">
                <span className="text-xs sm:text-sm font-black font-mono tabular-nums text-amber-400">
                  {summary ? formatYt(summary.balanceYt) : '0'}
                </span>
                <span className="text-[10px] font-extrabold text-slate-400">YT</span>
              </div>
            )}
            {user && (
              <button
                type="button"
                onClick={() => void loadSummary(false)}
                disabled={loading}
                aria-label="تحديث البيانات"
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-slate-900/90 hover:bg-slate-800 px-3 py-2 text-xs font-bold text-amber-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">تحديث البيانات</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Full-Screen Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 pt-4 pb-28 sm:px-6 space-y-4">
        {/* Guest View */}
        {!user ? (
          <div className="my-auto flex flex-col items-center justify-center text-center rounded-3xl border border-amber-500/25 bg-gradient-to-b from-[#131b2e] to-[#0d1322] p-6 sm:p-10 shadow-2xl space-y-5">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-amber-400/25 blur-xl animate-pulse" />
              <YtCoinLogo size="xl" className="relative ring-amber-400 shadow-2xl shadow-amber-500/30" />
            </div>
            <div className="space-y-2 max-w-md">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-400/35 px-3 py-1 text-xs font-bold text-amber-300">
                <Sparkles className="w-3.5 h-3.5" />
                سقف معروض 1 مليار (أعداد صحيحة)
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                ابدأ تعدين عملة YT Coin مجاناً
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                سجّل الدخول بحسابك لاستلام مكافأتك اليومية، متابعة رصيد محفظتك الرقمية، وبناء سلسلة التعدين المستمرة.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-l from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 px-8 py-3.5 text-sm font-black shadow-lg shadow-amber-500/25 transition-all cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>تسجيل الدخول لبدء التعدين</span>
            </button>
          </div>
        ) : loading && !summary ? (
          <div className="space-y-4 animate-pulse pt-2">
            <div className="h-72 rounded-3xl bg-slate-900/90 border border-slate-800" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 rounded-2xl bg-slate-900/90 border border-slate-800" />
              <div className="h-24 rounded-2xl bg-slate-900/90 border border-slate-800" />
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
                <span className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => void loadSummary(false)}
                  className="rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}

            {summary && (
              <>
                {/* ==================== TAB 1: MINING (الرئيسية) ==================== */}
                {activeTab === 'mine' && (
                  <div className="space-y-4">
                    {/* Hero Mining Arena Card */}
                    <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#151e34] via-[#101728] to-[#0c111e] p-5 sm:p-7 shadow-2xl">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
                      />

                      {/* Top Info Pill & Balance */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-400/35 px-3 py-1 text-[11px] font-extrabold text-amber-300">
                          <Sparkles className="w-3.5 h-3.5 shrink-0" />
                          سقف معروض 1 مليار (أعداد صحيحة)
                        </span>
                        <div className="flex items-center gap-1.5 rounded-full bg-slate-950/80 border border-slate-800 px-3 py-1 text-[11px] text-slate-300">
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          <span>السلسلة:</span>
                          <strong className="font-mono text-white">
                            {summary.streakDays !== null ? formatYt(summary.streakDays, 0) : '0'} يوم
                          </strong>
                        </div>
                      </div>

                      {/* Interactive Center Coin Stage */}
                      <div className="flex flex-col items-center justify-center text-center py-2 space-y-4">
                        <button
                          type="button"
                          onClick={handleClaim}
                          disabled={claiming || !summary.canClaim}
                          aria-label="تعدين عملة YT Coin"
                          className={`group relative rounded-full p-2 transition-transform duration-300 ${
                            summary.canClaim
                              ? 'cursor-pointer hover:scale-105 active:scale-95'
                              : 'cursor-default opacity-95'
                          } ${coinPulse ? 'scale-95' : ''}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-0 rounded-full blur-2xl transition-opacity ${
                              summary.canClaim
                                ? 'bg-amber-400/35 group-hover:bg-amber-400/50 animate-pulse'
                                : 'bg-amber-500/15'
                            }`}
                          />
                          <YtCoinLogo
                            size="xl"
                            className="relative ring-amber-400 shadow-[0_0_40px_rgba(251,191,36,0.3)]"
                          />
                        </button>

                        {/* Today's Claim Reward Highlight */}
                        <div className="space-y-1">
                          <span className="block text-xs sm:text-sm font-bold text-amber-300/90">
                            مكافأة المطالبة الحالية
                          </span>
                          <div className="flex items-baseline justify-center gap-2" dir="ltr">
                            <span className="text-sm sm:text-base font-extrabold text-amber-400">YT Coin</span>
                            <strong className="text-3xl sm:text-5xl font-black font-mono tabular-nums tracking-tight text-white">
                              {summary.todayRewardYt !== null ? `${formatYt(summary.todayRewardYt)}+` : '—'}
                            </strong>
                          </div>
                        </div>

                        {/* Primary Claim Action Button */}
                        <div className="w-full max-w-md pt-1">
                          <button
                            type="button"
                            onClick={handleClaim}
                            disabled={claiming || !summary.canClaim}
                            className={`w-full min-h-[52px] rounded-2xl px-5 py-3.5 flex items-center justify-center gap-2.5 text-sm sm:text-base font-black transition-all ${
                              summary.canClaim
                                ? 'bg-gradient-to-l from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 shadow-lg shadow-amber-500/25 cursor-pointer active:scale-[0.99]'
                                : 'bg-slate-800/90 border border-slate-700 text-slate-300 cursor-not-allowed'
                            }`}
                          >
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                                <span>جاري استلام المكافأة...</span>
                              </>
                            ) : summary.canClaim ? (
                              <>
                                <Pickaxe className="w-5 h-5 shrink-0" />
                                <span>
                                  {summary.todayRewardYt !== null
                                    ? `استلام مكافأة اليوم (+${formatYt(summary.todayRewardYt)} YT)`
                                    : 'استلام مكافأة التعدين اليومي'}
                                </span>
                              </>
                            ) : summary.capReached ? (
                              <>
                                <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
                                <span>تم بلوغ سقف التعدين</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                <span>
                                  {remainingCooldownSec > 0
                                    ? `المطالبة القادمة بعد ${formatCountdown(remainingCooldownSec)}`
                                    : 'تم استلام مكافأة اليوم بنجاح'}
                                </span>
                              </>
                            )}
                          </button>

                          {summary.statusMessage && (
                            <p className="text-xs text-amber-300/80 text-center mt-2">{summary.statusMessage}</p>
                          )}
                          {!summary.statusMessage && !summary.canClaim && summary.nextClaimAt && (
                            <p className="text-[11px] text-slate-400 text-center mt-2 flex items-center justify-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>موعد التعدين القادم: {formatDateTime(summary.nextClaimAt)}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Daily Cap Consumption Footer Inside Card */}
                      <div className="mt-6 pt-4 border-t border-slate-800/90 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-slate-300">استهلاك السقف اليومي</span>
                          <span className="font-mono tabular-nums text-amber-300" dir="ltr">
                            {summary.dailyCapYt !== null
                              ? `${formatYt(summary.dailyMinedYt ?? 0)} / ${formatYt(summary.dailyCapYt)}`
                              : summary.poolRemainingYt !== null && summary.poolCapYt !== null
                                ? `${formatYt(summary.poolDistributedYt ?? 0)} / ${formatYt(summary.poolCapYt)}`
                                : 'نشط'}
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-l from-amber-400 to-emerald-400 transition-all duration-500"
                            style={{
                              width: `${
                                summary.dailyCapYt !== null ? dailyProgressPct : (poolProgressPct ?? 100)
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Quick KPI Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-slate-800 bg-[#121829] p-3.5">
                        <span className="block text-[11px] text-slate-400">رصيدك الحالي</span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <strong className="text-lg sm:text-xl font-black font-mono tabular-nums text-white">
                            {formatYt(summary.balanceYt)}
                          </strong>
                          <span className="text-xs font-bold text-amber-400">YT</span>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-[#121829] p-3.5">
                        <span className="block text-[11px] text-slate-400">إجمالي ما عدّنته</span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <strong className="text-lg sm:text-xl font-black font-mono tabular-nums text-emerald-400">
                            {formatYt(summary.totalMinedYt)}
                          </strong>
                          <span className="text-xs font-bold text-amber-400">YT</span>
                        </div>
                      </div>

                      <div className="col-span-2 sm:col-span-1 rounded-2xl border border-slate-800 bg-[#121829] p-3.5 flex items-center justify-between">
                        <div>
                          <span className="block text-[11px] text-slate-400">إجمالي المطالبات</span>
                          <strong className="mt-1 block text-lg sm:text-xl font-black font-mono tabular-nums text-white">
                            {summary.totalClaims !== null ? formatYt(summary.totalClaims, 0) : '0'}
                          </strong>
                        </div>
                        <span className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
                          <Award className="w-5 h-5" />
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ==================== TAB 2: DIGITAL WALLET (المحفظة) ==================== */}
                {activeTab === 'wallet' && (
                  <div className="space-y-4">
                    {/* Digital Wallet Card */}
                    <div className="relative overflow-hidden rounded-3xl border border-amber-500/35 bg-gradient-to-br from-[#19223a] via-[#111827] to-[#0a0f1c] p-5 sm:p-6 shadow-xl space-y-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <YtCoinLogo size="lg" className="ring-amber-400" />
                          <div>
                            <span className="block text-xs text-amber-300 font-bold">محفظة YT Coin الرقمية</span>
                            <h2 className="text-base sm:text-lg font-black text-white">الرصيد المتاح</h2>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          محفظة مستقلة
                        </span>
                      </div>

                      <div className="py-2">
                        <div className="flex items-baseline gap-2.5">
                          <strong className="text-3xl sm:text-5xl font-black font-mono tabular-nums text-white">
                            {formatYt(summary.balanceYt)}
                          </strong>
                          <span className="text-base sm:text-lg font-black text-amber-400">YT Coin</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5">
                          رصيد عملة YT Coin منفصل تماماً عن محفظة الريال اليمني ويُدار في السجل الرسمي للمنصة.
                        </p>
                      </div>

                      {/* Wallet Address Box */}
                      <div className="rounded-2xl bg-slate-950/90 border border-slate-800 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="block text-[10px] font-bold text-slate-400">معرّف المحفظة الرقمي</span>
                          <code className="block text-xs sm:text-sm font-mono font-bold text-amber-300 truncate mt-0.5">
                            {walletAddress}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyAddress}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 px-3 py-2 text-xs font-bold text-amber-300 transition-colors cursor-pointer"
                        >
                          {copiedAddress ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          <span>{copiedAddress ? 'تم النسخ' : 'نسخ'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Full Ledger / Transaction History */}
                    <div className="rounded-3xl border border-slate-800 bg-[#121829] overflow-hidden">
                      <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <History className="w-4 h-4 text-amber-400" />
                          <h3 className="text-sm font-extrabold text-white">سجل معاملات ومكافآت المحفظة</h3>
                        </div>
                        <span className="rounded-full bg-amber-500/15 text-amber-300 px-2.5 py-0.5 text-xs font-mono font-bold">
                          {summary.history.length}
                        </span>
                      </div>

                      <div className="divide-y divide-slate-800/80 max-h-[420px] overflow-y-auto">
                        {summary.history.length === 0 ? (
                          <div className="p-8 text-center space-y-2">
                            <Wallet className="w-8 h-8 text-slate-600 mx-auto" />
                            <p className="text-xs text-slate-400">
                              لا توجد عمليات مسجلة في محفظتك بعد. ابدأ التعدين اليومي لإضافة أول رصيد.
                            </p>
                          </div>
                        ) : (
                          summary.history.map((item) => (
                            <div
                              key={item.id}
                              className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                                  <ArrowDownLeft className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs sm:text-sm font-bold text-white truncate">{item.label}</p>
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                    {item.createdAt ? formatDateTime(item.createdAt) : item.claimDate || '—'}
                                    {item.streakDay !== null ? ` • اليوم ${item.streakDay}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="text-left shrink-0">
                                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-xs sm:text-sm font-black text-emerald-400">
                                  {item.amountYt !== null ? `+${formatYt(item.amountYt)}` : '—'}
                                  <span className="text-[10px] text-amber-400">YT</span>
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ==================== TAB 3: STATISTICS & ECONOMICS (الإحصائيات) ==================== */}
                {activeTab === 'stats' && (
                  <div className="space-y-4">
                    {/* Global Pool & Cap Card */}
                    <div className="rounded-3xl border border-amber-500/30 bg-[#121829] p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400">
                          <Coins className="w-5 h-5" />
                        </span>
                        <div>
                          <h2 className="text-sm sm:text-base font-black text-white">إحصائيات المعروض والسقف الكلي</h2>
                          <p className="text-[11px] text-slate-400">بيانات التوزيع الرسمية لعملة YT Coin</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">السقف الكلي للعملة</span>
                          <strong className="mt-1 block text-base sm:text-lg font-black font-mono text-amber-400">
                            {summary.poolCapYt !== null ? `${formatYt(summary.poolCapYt)} YT` : '1,000,000,000 YT'}
                          </strong>
                        </div>

                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">المخزون المتاح للتعدين</span>
                          <strong className="mt-1 block text-base sm:text-lg font-black font-mono text-emerald-400">
                            {summary.poolRemainingYt !== null ? `${formatYt(summary.poolRemainingYt)} YT` : 'متاح'}
                          </strong>
                        </div>

                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">إجمالي ما تم توزيعه</span>
                          <strong className="mt-1 block text-base sm:text-lg font-black font-mono text-white">
                            {summary.poolDistributedYt !== null ? `${formatYt(summary.poolDistributedYt)} YT` : '—'}
                          </strong>
                        </div>
                      </div>

                      {poolProgressPct !== null && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-300">نسبة التعدين العالمية</span>
                            <span className="font-mono text-amber-400">{poolProgressPct.toFixed(2)}%</span>
                          </div>
                          <div className="w-full h-3 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-l from-amber-400 via-amber-500 to-emerald-500 transition-all duration-500"
                              style={{ width: `${poolProgressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Personal Mining Performance */}
                    <div className="rounded-3xl border border-slate-800 bg-[#121829] p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                          <TrendingUp className="w-5 h-5" />
                        </span>
                        <div>
                          <h3 className="text-sm sm:text-base font-black text-white">إحصائيات تعدينك الشخصي</h3>
                          <p className="text-[11px] text-slate-400">ملخص نشاطك وسجل الالتزام اليومي</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">سلسلة التعدين الحالية</span>
                          <strong className="mt-1 block text-lg font-black font-mono text-amber-400">
                            {summary.streakDays !== null ? `${formatYt(summary.streakDays, 0)} يوم` : '0 يوم'}
                          </strong>
                        </div>

                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">عدد المطالبات الناجحة</span>
                          <strong className="mt-1 block text-lg font-black font-mono text-white">
                            {summary.totalClaims !== null ? formatYt(summary.totalClaims, 0) : '0'}
                          </strong>
                        </div>

                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">مكافأة اليوم</span>
                          <strong className="mt-1 block text-lg font-black font-mono text-emerald-400">
                            {summary.todayRewardYt !== null ? `+${formatYt(summary.todayRewardYt)} YT` : '—'}
                          </strong>
                        </div>

                        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3.5">
                          <span className="block text-[11px] text-slate-400">آخر عملية مطالبة</span>
                          <strong className="mt-1 block text-xs sm:text-sm font-bold text-slate-200 truncate">
                            {formatDateTime(summary.lastClaimAt)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ==================== TAB 4: TASKS & BONUSES (المهام والمكافآت) ==================== */}
                {activeTab === 'tasks' && (
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-amber-500/30 bg-[#121829] p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400">
                          <Zap className="w-5 h-5" />
                        </span>
                        <div>
                          <h2 className="text-sm sm:text-base font-black text-white">مهام ومكافآت زيادة التعدين</h2>
                          <p className="text-[11px] text-slate-400">أنجز المهام اليومية لتعزيز رصيدك من YT Coin</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {/* Task 1: Daily Mining Claim */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
                              <Calendar className="w-5 h-5" />
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-xs sm:text-sm font-extrabold text-white">
                                تسجيل الحضور والتعدين اليومي
                              </h3>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {summary.todayRewardYt !== null
                                  ? `المكافأة: +${formatYt(summary.todayRewardYt)} YT Coin`
                                  : 'استلم مكافأتك اليومية المجانية'}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (summary.canClaim) {
                                void handleClaim();
                              } else {
                                setActiveTab('mine');
                              }
                            }}
                            disabled={claiming}
                            className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-black transition-colors cursor-pointer ${
                              summary.canClaim
                                ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {summary.canClaim ? 'استلام الآن' : 'مكتمل اليوم'}
                          </button>
                        </div>

                        {/* Task 2: Streak Bonus */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0">
                              <Flame className="w-5 h-5" />
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-xs sm:text-sm font-extrabold text-white">
                                الحفاظ على سلسلة التعدين المتتالية
                              </h3>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                سلسلتك الحالية: {summary.streakDays !== null ? formatYt(summary.streakDays, 0) : '0'} يوم متواصل
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-xl bg-slate-900 border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-amber-300">
                            نشط تلقائياً
                          </span>
                        </div>

                        {/* Task 3: Back to Platform Tasks */}
                        {onOpen && (
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                                <ListChecks className="w-5 h-5" />
                              </span>
                              <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-extrabold text-white">مهام المنصة الإضافية</h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  تصفح المهام المصغرة لزيادة أرباحك ونشاط حسابك
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={onOpen}
                              className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 text-xs font-black transition-colors cursor-pointer"
                            >
                              <span>انتقال</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Rules Info Box */}
                      <div className="rounded-2xl bg-amber-500/10 border border-amber-400/25 p-3.5 flex items-start gap-2.5 text-xs text-amber-200/90 leading-relaxed">
                        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <p>
                          تعمل عملة YT Coin بنظام سقف تصاعدي يومي وأعداد صحيحة، ويُحدّث مؤقت المطالبة اليومية تلقائياً وفق توقيت عدن (Asia/Aden).
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Fixed Bottom Navigation Bar */}
      <nav
        aria-label="التنقل الرئيسي لمنجم YT Coin"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#0f1524]/95 backdrop-blur-lg border-t border-amber-500/25 px-2 py-2 shadow-[0_-8px_30px_rgba(0,0,0,0.6)]"
      >
        <div className="max-w-4xl mx-auto grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('mine')}
            className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'mine'
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Pickaxe className="w-5 h-5" />
            <span>التعدين</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'wallet'
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wallet className="w-5 h-5" />
            <span>المحفظة</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('stats')}
            className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'stats'
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span>الإحصائيات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'tasks'
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListChecks className="w-5 h-5" />
            <span>المهام</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
