import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Copy,
  Check,
  Coins,
  TrendingUp,
  Award,
  Zap,
  Calendar,
  Send,
  QrCode,
  Hammer,
  Home,
  User,
  Sliders,
  Bell,
  Users,
  Gem,
  X,
  RotateCcw,
  AlertTriangle,
  Hand,
  Hourglass,
  ArrowUpRightFromSquare,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

type CoinSize = 'xs' | 'sm' | 'md' | 'lg';
type TabId = 'home' | 'tasks' | 'wallet' | 'dashboard' | 'admin';

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
  type: 'mine' | 'task' | 'send' | 'system';
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

interface FloatingParticle {
  id: number;
  x: number;
  y: number;
  text: string;
}

interface LocalTaskItem {
  id: number;
  title: string;
  desc: string;
  reward: number;
  status: 'ready' | 'progress' | 'claimed';
  target?: number;
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
      const isNegative = amountYt !== null && amountYt < 0;
      return {
        id: String(rec.id ?? rec.claim_id ?? rec.entry_id ?? reference ?? `TX-${1000 + idx}`),
        amountYt,
        label: translateEventLabel(rawLabel),
        createdAt,
        claimDate,
        streakDay,
        reference,
        type: isNegative ? 'send' : 'mine',
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

function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return Math.floor(value).toLocaleString('en-US');
}

function formatYt(value: number | null, maxDecimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '0';
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? '-<0.01' : '<0.01';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(2, Math.max(0, maxDecimals)),
  }).format(value);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'الآن';
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

const PAGE_TITLES: Record<TabId, string> = {
  home: 'منجم عملة YT Coin الرقمية',
  tasks: 'مركز المهام والمكافآت اليومية',
  wallet: 'المحفظة الرقمية وسجل المعاملات',
  dashboard: 'لوحة الإحصائيات ونمو المعروض',
  admin: 'لوحة الإدارة وضبط إعدادات المنجم',
};

export const YtCoinMiningCard: React.FC<{ compact?: boolean; onOpen?: () => void }> = ({
  compact = false,
  onOpen,
}) => {
  const { user, openAuthModal, showToast } = useAuth();
  const [rawSummary, setRawSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [loadedAtTs, setLoadedAtTs] = useState<number>(() => Date.now());
  const [isRefreshingSpin, setIsRefreshingSpin] = useState<boolean>(false);

  // Interactive Tap & Local Simulation Enhancements synced with API
  const [todayTaps, setTodayTaps] = useState<number>(0);
  const [bonusBalance, setBonusBalance] = useState<number>(0);
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const arenaRef = useRef<HTMLDivElement | null>(null);

  // Admin / Override Controls (Optional local preview tuning)
  const [overrideClaimReward, setOverrideClaimReward] = useState<number | null>(null);
  const [overrideDailyCap, setOverrideDailyCap] = useState<number | null>(null);
  const [tapPower, setTapPower] = useState<number>(100);
  const [networkActiveOverride, setNetworkActiveOverride] = useState<boolean | null>(null);

  // Modals State
  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);
  const [showReceiveModal, setShowReceiveModal] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  // Tasks & Local Transactions
  const [tasks, setTasks] = useState<LocalTaskItem[]>([
    {
      id: 1,
      title: 'تسجيل الدخول اليومي للمنجم',
      desc: 'احصل على مكافأة الحضور اليومي المستمر',
      reward: 150000,
      status: 'ready',
    },
    {
      id: 2,
      title: 'إكمال 15 نقرة تعدين نشطة',
      desc: 'انقر على العملة الذهبية 15 مرة لتنشيط العقدة',
      reward: 250000,
      status: 'progress',
      target: 15,
    },
    {
      id: 3,
      title: 'الانضمام لقناة Yemen Task الرسمية',
      desc: 'تابع آخر تحديثات إدراج عملة YT Coin',
      reward: 350000,
      status: 'ready',
    },
    {
      id: 4,
      title: 'دعوة صديق للتعدين السحابي',
      desc: 'شارك رابط الإحالة الخاص بك واحصل على مكافأة فورية',
      reward: 500000,
      status: 'ready',
    },
  ]);

  const [localTx, setLocalTx] = useState<NormalizedHistoryItem[]>([]);

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
    const rawId = String((user as any)?.id || (user as any)?.user_id || 'YT7x92B4D881C3E991F0A8E');
    const clean = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return clean.startsWith('YT') ? clean.slice(0, 22) : `YT${clean.slice(0, 20)}`;
  }, [user]);

  // Effective Values combining API + Interactive Session
  const effectiveBalance = Math.max(0, (summary?.balanceYt ?? 0) + bonusBalance);
  const effectiveUsd = (effectiveBalance * 0.00012).toFixed(2);
  const effectiveClaimReward = overrideClaimReward ?? summary?.todayRewardYt ?? 510000;
  const effectiveDailyCap = overrideDailyCap ?? summary?.dailyCapYt ?? summary?.poolCapYt ?? 15000000;
  const effectiveDailyUsed = Math.min(
    effectiveDailyCap,
    (summary?.dailyMinedYt ?? summary?.poolDistributedYt ?? 0) + bonusBalance
  );
  const effectiveCapPercent =
    effectiveDailyCap > 0 ? Math.min(100, Number(((effectiveDailyUsed / effectiveDailyCap) * 100).toFixed(1))) : 0;
  const effectiveCapRemaining = Math.max(0, effectiveDailyCap - effectiveDailyUsed);
  const effectiveNetworkActive =
    networkActiveOverride !== null ? networkActiveOverride : summary?.miningEnabled ?? true;

  const combinedTransactions = useMemo(() => {
    const apiList = summary?.history ?? [];
    const baseItem: NormalizedHistoryItem = {
      id: 'TX-1001',
      amountYt: 0,
      label: 'تفعيل محفظة YT Coin بنجاح',
      createdAt: null,
      claimDate: 'الآن',
      streakDay: null,
      reference: 'TX-1001',
      type: 'system',
    };
    const merged = [...localTx, ...apiList];
    return merged.length > 0 ? merged : [baseItem];
  }, [localTx, summary?.history]);

  const handleRefreshData = async () => {
    setIsRefreshingSpin(true);
    window.setTimeout(() => setIsRefreshingSpin(false), 650);
    await loadSummary(false);
    showToast('تم تحديث بيانات المنجم والكتل بنجاح', 'info');
  };

  const handleCoinTap = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!effectiveNetworkActive) {
      showToast('عذراً، عقد التعدين متوقف مؤقتاً للصيانة', 'error');
      return;
    }
    if (effectiveDailyUsed + tapPower > effectiveDailyCap) {
      showToast('تم الوصول إلى السقف التصاعدي اليومي!', 'error');
      return;
    }

    const gain = Math.floor(tapPower);
    setBonusBalance((prev) => prev + gain);
    const nextTaps = todayTaps + 1;
    setTodayTaps(nextTaps);

    // Check task #2
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === 2 && t.status === 'progress' && t.target && nextTaps >= t.target) {
          showToast('تهانينا! أكملت مهمة الـ 15 نقرة، يمكنك استلام مكافأتك الآن', 'success');
          return { ...t, status: 'ready' };
        }
        return t;
      })
    );

    // Spawn floating particle
    if (arenaRef.current) {
      const rect = arenaRef.current.getBoundingClientRect();
      const x = (e.clientX ? e.clientX - rect.left : rect.width / 2) - 20;
      const y = (e.clientY ? e.clientY - rect.top : rect.height / 2) - 20;
      const id = Date.now() + Math.random();
      setParticles((prev) => [...prev, { id, x, y, text: `+${formatInt(gain)}` }]);
      window.setTimeout(() => {
        setParticles((prev) => prev.filter((p) => p.id !== id));
      }, 950);
    }
  };

  const handleClaim = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!effectiveNetworkActive) {
      showToast('الشبكة متوقفة حالياً من لوحة الإدارة', 'error');
      return;
    }
    if (claiming) return;

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
        showToast(resultMessage || `تمت إضافة +${formatYt(claimedAmount)} YT Coin إلى محفظتك بنجاح!`, 'success');
      } else {
        showToast(resultMessage || 'تم استلام مكافأة التعدين اليومي بنجاح!', 'success');
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

  const handleClaimTask = (taskId: number) => {
    const targetTask = tasks.find((t) => t.id === taskId);
    if (!targetTask || targetTask.status !== 'ready') return;

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'claimed' } : t)));
    setBonusBalance((prev) => prev + targetTask.reward);
    setLocalTx((prev) => [
      {
        id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
        amountYt: targetTask.reward,
        label: `مكافأة مهمة: ${targetTask.title}`,
        createdAt: new Date().toISOString(),
        claimDate: 'اليوم',
        streakDay: null,
        reference: null,
        type: 'task',
      },
      ...prev,
    ]);
    showToast(`حصلت على +${formatInt(targetTask.reward)} YT Coin من إكمال المهمة!`, 'success');
  };

  const copyWalletAddress = () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(walletAddress);
    }
    setCopiedAddress(true);
    showToast('تم نسخ عنوان محفظة YT Coin بنجاح', 'success');
    window.setTimeout(() => setCopiedAddress(false), 2000);
  };

  const executeTransfer = () => {
    const addr = recipientAddress.trim();
    const amt = Math.floor(Number(transferAmount));
    if (!addr || addr.length < 6) {
      showToast('يرجى إدخال عنوان محفظة مستلم صحيح', 'error');
      return;
    }
    if (!amt || amt <= 0) {
      showToast('يرجى إدخال كمية صحيحة أكبر من صفر', 'error');
      return;
    }
    if (amt > effectiveBalance) {
      showToast('رصيدك الحالي غير كافٍ لإتمام التحويل', 'error');
      return;
    }

    setBonusBalance((prev) => prev - amt);
    setLocalTx((prev) => [
      {
        id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
        amountYt: -amt,
        label: `تحويل إلى ${addr.slice(0, 8)}...`,
        createdAt: new Date().toISOString(),
        claimDate: 'اليوم',
        streakDay: null,
        reference: null,
        type: 'send',
      },
      ...prev,
    ]);
    setShowTransferModal(false);
    setTransferAmount('');
    setRecipientAddress('');
    showToast(`تم تحويل ${formatInt(amt)} YT Coin بنجاح!`, 'success');
  };

  const handleSaveAdminSettings = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newClaim = Math.max(1, Math.floor(Number(formData.get('claimInput') || effectiveClaimReward)));
    const newCap = Math.max(1000, Math.floor(Number(formData.get('capInput') || effectiveDailyCap)));
    const newTap = Math.max(1, Math.floor(Number(formData.get('tapInput') || tapPower)));

    setOverrideClaimReward(newClaim);
    setOverrideDailyCap(newCap);
    setTapPower(newTap);
    showToast('تم تحديث إعدادات المنجم بنجاح (أعداد صحيحة)', 'success');
  };

  const handleResetLocalData = () => {
    setBonusBalance(0);
    setTodayTaps(0);
    setOverrideClaimReward(null);
    setOverrideDailyCap(null);
    setTapPower(100);
    setNetworkActiveOverride(null);
    setLocalTx([]);
    setTasks((prev) =>
      prev.map((t) => ({
        ...t,
        status: t.id === 2 ? 'progress' : 'ready',
      }))
    );
    setShowResetModal(false);
    showToast('تمت إعادة ضبط البيانات المحلية بنجاح', 'info');
  };

  const pendingTasksReward = useMemo(
    () => tasks.reduce((acc, t) => (t.status !== 'claimed' ? acc + t.reward : acc), 0),
    [tasks]
  );
  const activeTasksCount = useMemo(() => tasks.filter((t) => t.status !== 'claimed').length, [tasks]);

  // Compact Banner Mode (used on Home page)
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

  // Full-Screen Luxury Obsidian + Gold Mining App
  return (
    <div
      dir="rtl"
      className="flex flex-col md:flex-row h-[100dvh] w-screen overflow-hidden select-none text-gray-100"
      style={{
        backgroundColor: '#0B0E14',
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(245, 185, 33, 0.12) 0%, transparent 55%), radial-gradient(circle at 85% 85%, rgba(212, 148, 21, 0.08) 0%, transparent 45%)',
      }}
    >
      {/* Inline Keyframes & 3D Coin Styling matching exact design */}
      <style>{`
        .yt-coin-3d {
          background: radial-gradient(circle at 30% 30%, #FFF099 0%, #F5B921 45%, #B87A08 90%, #7A4E00 100%);
          box-shadow:
            inset 0 4px 10px rgba(255, 255, 255, 0.7),
            inset 0 -6px 12px rgba(100, 60, 0, 0.8),
            0 10px 30px rgba(245, 185, 33, 0.35);
          transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
        }
        .yt-coin-3d:active {
          transform: scale(0.92);
          box-shadow:
            inset 0 4px 10px rgba(255, 255, 255, 0.7),
            inset 0 -6px 12px rgba(100, 60, 0, 0.8),
            0 0 45px rgba(245, 185, 33, 0.7);
        }
        .coin-inner-ring {
          border: 3px dashed rgba(120, 72, 0, 0.45);
          box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.35);
        }
        .coin-letter-y {
          background: linear-gradient(180deg, #FFF8D6 0%, #F5B921 50%, #9E6804 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 2px 3px rgba(80, 45, 0, 0.75));
        }
        @keyframes pulseRing {
          0% { transform: scale(0.96); opacity: 0.6; }
          50% { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(0.96); opacity: 0.6; }
        }
        .animate-pulse-ring {
          animation: pulseRing 3s infinite ease-in-out;
        }
        @keyframes floatUpFade {
          0% { opacity: 1; transform: translateY(0) scale(0.8); }
          50% { opacity: 1; transform: translateY(-45px) scale(1.15); }
          100% { opacity: 0; transform: translateY(-90px) scale(0.95); }
        }
        .floating-reward {
          position: absolute;
          pointer-events: none;
          animation: floatUpFade 0.95s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          z-index: 50;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
        }
      `}</style>

      {/* ==================== DESKTOP SIDEBAR ==================== */}
      <aside className="hidden md:flex md:flex-col md:w-72 bg-[#0F131C]/95 border-l border-amber-500/15 h-full justify-between p-5 z-20 backdrop-blur-md shrink-0">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 pb-6 border-b border-amber-500/15">
            <div className="w-11 h-11 rounded-xl yt-coin-3d flex items-center justify-center border border-amber-300/60 shrink-0">
              <span className="font-black text-xl text-amber-950">Y</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg text-white tracking-wide">YT Coin</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Yemen Task
                </span>
              </div>
              <p className="text-xs text-gray-400">منصة التعدين الرقمي المستقلة</p>
            </div>
          </div>

          {/* Quick Balance Card */}
          <div className="mt-5 p-4 rounded-2xl bg-gradient-to-br from-[#181F2C] to-[#111620] border border-amber-500/25 shadow-lg">
            <span className="text-xs text-gray-400 block mb-1">رصيد محفظتك الحالي</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-amber-400 tracking-tight font-mono">
                {formatInt(effectiveBalance)}
              </span>
              <span className="text-xs font-bold text-amber-200/80">YT</span>
            </div>
            <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-gray-400">
              <span>القيمة التقديرية:</span>
              <span className="text-emerald-400 font-bold">${effectiveUsd}</span>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Home className="w-5 h-5 shrink-0" />
              <span>الرئيسية (المنجم)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'tasks'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <ListChecks className="w-5 h-5 shrink-0" />
                <span>المهام والمكافآت</span>
              </div>
              <span className="bg-amber-500 text-[#0B0E14] text-[11px] font-black px-2 py-0.5 rounded-full">
                {activeTasksCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'wallet'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Wallet className="w-5 h-5 shrink-0" />
              <span>المحفظة الرقمية</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <BarChart3 className="w-5 h-5 shrink-0" />
              <span>لوحتي والإحصائيات</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'admin'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>الإدارة والإعدادات</span>
            </button>
          </nav>
        </div>

        {/* Network Status Footer */}
        <div className="p-3.5 rounded-xl bg-[#131822] border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                effectiveNetworkActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-xs font-semibold text-gray-300">
              {effectiveNetworkActive ? 'الشبكة نشطة (Mainnet)' : 'الصيانة مجدولة'}
            </span>
          </div>
          <span className="text-[11px] text-amber-400/80 font-mono">v2.4</span>
        </div>
      </aside>

      {/* ==================== MAIN CONTENT CONTAINER ==================== */}
      <div className="flex-1 flex flex-col h-full w-full overflow-hidden relative">
        {/* Top Header */}
        <header className="w-full px-4 md:px-8 py-3.5 bg-[#0F131C]/90 backdrop-blur-md border-b border-amber-500/15 flex items-center justify-between shrink-0 z-20">
          {/* Mobile Brand */}
          <div className="flex items-center gap-2.5 md:hidden">
            <div className="w-9 h-9 rounded-full yt-coin-3d flex items-center justify-center border border-amber-300/70">
              <span className="font-black text-base text-amber-950">Y</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-extrabold text-sm text-white">YT Coin</h1>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-400 border border-emerald-500/30">
                  Yemen Task
                </span>
              </div>
              <span className="text-[10px] text-gray-400 block">منصة التعدين السحابي</span>
            </div>
          </div>

          {/* Desktop Current Section Title */}
          <div className="hidden md:flex items-center gap-3">
            <h2 className="text-xl font-extrabold text-white">{PAGE_TITLES[activeTab]}</h2>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Zap className="w-3.5 h-3.5" /> أعداد صحيحة 100%
            </span>
          </div>

          {/* Live Balance & Quick Actions */}
          <div className="flex items-center gap-2.5">
            {!user ? (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-[#0B0E14] px-3.5 py-1.5 rounded-full text-xs font-black transition-all cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>تسجيل الدخول</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('wallet')}
                className="flex items-center gap-2 bg-[#161C28] hover:bg-[#1E2636] border border-amber-500/30 px-3 py-1.5 rounded-full transition-all shadow-sm cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-[#0B0E14] text-[11px] font-black">
                  Y
                </div>
                <span className="font-extrabold text-sm md:text-base text-amber-400 font-mono">
                  {formatInt(effectiveBalance)}
                </span>
                <span className="text-[11px] text-gray-400 font-semibold hidden sm:inline">YT</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => showToast('جميع الأنظمة تعمل بكفاءة عالية بدون كسور عشرية', 'info')}
              aria-label="الإشعارات"
              className="w-9 h-9 rounded-full bg-[#161C28] border border-white/10 flex items-center justify-center text-gray-300 hover:text-amber-400 hover:border-amber-500/30 transition-all relative cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-amber-500 absolute top-2 right-2.5" />
            </button>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-8 pt-4 pb-24 md:pb-8">
          <div className="max-w-5xl mx-auto w-full">
            {error && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
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

            {/* ========================================== */}
            {/* 1. تبويب الرئيسية (منجم التعدين) - HOME TAB */}
            {/* ========================================== */}
            {activeTab === 'home' && (
              <section className="space-y-5">
                {/* Main Hero Mining Card */}
                <div className="rounded-3xl bg-gradient-to-b from-[#171D29] to-[#111620] border border-amber-500/25 p-5 md:p-7 shadow-2xl relative overflow-hidden">
                  <div className="absolute -top-24 -left-24 w-56 h-56 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-amber-400 tracking-tight">
                            منجم عملة YT Coin الرقمية
                          </h2>
                          <div className="mt-2.5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/35 text-amber-300 text-xs sm:text-sm font-bold">
                            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>سقف معروض 1 مليار (أعداد صحيحة)</span>
                          </div>
                        </div>

                        {/* Top Left Coin Icon as in Screenshot */}
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full p-1 border-2 border-amber-400/60 bg-amber-500/10 shrink-0 flex items-center justify-center shadow-[0_0_35px_rgba(245,185,33,0.25)]">
                          <div className="w-full h-full rounded-full yt-coin-3d flex items-center justify-center">
                            <span className="font-black text-2xl sm:text-3xl coin-letter-y">Y</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-gray-300 text-xs sm:text-sm md:text-base leading-relaxed max-w-2xl">
                        منصة تعدين مستقلة ذات سقف تصاعدي يومي تبدأ بـ{' '}
                        <span className="text-amber-400 font-bold">1 عملة</span> وتزيد تدريجياً بدون كسور عشرية. انقر
                        على العملة الذهبية أو طالب بمكافأتك الدورية لتعزيز رصيدك.
                      </p>
                    </div>

                    {/* Refresh Button */}
                    <div className="flex items-center justify-end lg:justify-center shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleRefreshData()}
                        disabled={loading}
                        className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-[#181F2E] hover:bg-[#20293D] border border-amber-500/40 text-amber-400 font-bold text-xs sm:text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60"
                      >
                        <span>تحديث البيانات</span>
                        <RefreshCw className={`w-4 h-4 ${isRefreshingSpin || loading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="my-5 border-t border-white/10" />

                  {/* Center Interactive Mining Arena */}
                  <div
                    ref={arenaRef}
                    className="rounded-2xl bg-[#0D1119]/90 border border-amber-500/20 p-5 sm:p-8 flex flex-col items-center justify-center relative overflow-hidden"
                  >
                    {/* Floating Tap Particles */}
                    {particles.map((p) => (
                      <div
                        key={p.id}
                        style={{ left: `${p.x}px`, top: `${p.y}px` }}
                        className="floating-reward font-black text-amber-300 text-lg sm:text-xl"
                      >
                        {p.text}
                      </div>
                    ))}

                    {/* Top Indicators inside Arena */}
                    <div className="w-full flex items-center justify-between text-xs text-gray-400 mb-4">
                      <span className="flex items-center gap-1.5 bg-white/5 px-3 py-1 rounded-full">
                        <Hand className="w-3.5 h-3.5 text-amber-400" />
                        قوة النقر: <strong className="text-amber-400">+{formatInt(tapPower)} YT</strong>
                      </span>
                      <span className="flex items-center gap-1.5 bg-white/5 px-3 py-1 rounded-full">
                        <Flame className="w-3.5 h-3.5 text-orange-400" />
                        نقرات اليوم: <strong className="text-white">{formatInt(todayTaps)}</strong>
                      </span>
                    </div>

                    {/* Interactive Big 3D Gold Coin */}
                    <div className="relative my-3 sm:my-5 flex items-center justify-center">
                      <div className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-amber-500/15 blur-2xl animate-pulse-ring pointer-events-none" />

                      <button
                        type="button"
                        onClick={handleCoinTap}
                        aria-label="انقر للتعدين"
                        className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-full p-2.5 border-[3px] border-amber-400/80 bg-[#141923] shadow-[0_0_35px_rgba(245,185,33,0.25)] cursor-pointer focus:outline-none group transition-transform"
                      >
                        <div className="w-full h-full rounded-full yt-coin-3d flex items-center justify-center p-3">
                          <div className="w-full h-full rounded-full coin-inner-ring flex items-center justify-center">
                            <span className="font-black text-7xl sm:text-8xl coin-letter-y select-none group-hover:scale-105 transition-transform">
                              Y
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Current Claim Reward */}
                    <div className="text-center mt-3 space-y-1">
                      <p className="text-amber-400/90 font-bold text-sm sm:text-base">مكافأة المطالبة الحالية</p>
                      <div className="flex items-baseline justify-center gap-2" dir="ltr">
                        <span className="text-3xl sm:text-4xl md:text-5xl font-black text-amber-400 tracking-tight font-mono">
                          {formatInt(effectiveClaimReward)}+
                        </span>
                        <span className="text-base sm:text-lg font-extrabold text-amber-300">YT Coin</span>
                      </div>
                    </div>

                    {/* Primary Claim Button */}
                    <div className="mt-5 w-full max-w-md">
                      {!user ? (
                        <button
                          type="button"
                          onClick={() => openAuthModal('login')}
                          className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] font-black text-base sm:text-lg shadow-[0_0_35px_rgba(245,185,33,0.25)] transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                        >
                          <LogIn className="w-5 h-5" />
                          <span>تسجيل الدخول للمطالبة بالمكافأة</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleClaim()}
                            disabled={claiming || (summary !== null && !summary.canClaim)}
                            className={`w-full py-3.5 px-6 rounded-2xl font-black text-base sm:text-lg transition-all flex items-center justify-center gap-2.5 ${
                              summary === null || summary.canClaim
                                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] shadow-[0_0_35px_rgba(245,185,33,0.25)] cursor-pointer active:scale-98'
                                : 'bg-slate-800/90 border border-slate-700 text-slate-300 opacity-80 cursor-not-allowed'
                            }`}
                          >
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>جاري استلام المكافأة...</span>
                              </>
                            ) : summary && summary.capReached ? (
                              <>
                                <ShieldCheck className="w-5 h-5 text-amber-400" />
                                <span>تم بلوغ سقف التعدين</span>
                              </>
                            ) : summary && !summary.canClaim ? (
                              <>
                                <Hourglass className="w-5 h-5 text-amber-400" />
                                <span>
                                  {remainingCooldownSec > 0
                                    ? `المطالبة القادمة خلال ${formatCountdown(remainingCooldownSec)}`
                                    : 'تم استلام مكافأة اليوم بنجاح'}
                                </span>
                              </>
                            ) : (
                              <>
                                <Gem className="w-5 h-5" />
                                <span>مطالبة بالمكافأة الآن</span>
                              </>
                            )}
                          </button>

                          {summary && !summary.canClaim ? (
                            <p className="text-center text-xs text-amber-400 font-semibold mt-2 flex items-center justify-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                {summary.statusMessage ||
                                  (summary.nextClaimAt
                                    ? `موعد الكتلة القادمة: ${formatDateTime(summary.nextClaimAt)}`
                                    : 'جاري تجهيز الكتلة التالية...')}
                              </span>
                            </p>
                          ) : (
                            <p className="text-center text-xs text-emerald-400 font-semibold mt-2 flex items-center justify-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>المكافأة جاهزة للاستلام الفوري!</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Daily Cap Consumption Progress Bar */}
                    <div className="w-full mt-7 pt-5 border-t border-white/10">
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold mb-2">
                        <span className="text-gray-300">استهلاك السقف اليومي</span>
                        <span className="text-amber-400 font-mono" dir="ltr">
                          {formatInt(effectiveDailyUsed)} / {formatInt(effectiveDailyCap)}
                        </span>
                      </div>
                      <div className="w-full h-3 bg-[#1A2130] rounded-full overflow-hidden border border-white/5 p-0.5">
                        <div
                          className="h-full bg-gradient-to-l from-amber-300 via-amber-500 to-amber-600 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(1, effectiveCapPercent)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-400 mt-1.5">
                        <span>
                          نسبة الاستهلاك: <strong className="text-amber-400">{effectiveCapPercent}%</strong>
                        </span>
                        <span>
                          المتبقي لليوم: <strong className="text-gray-200">{formatInt(effectiveCapRemaining)}</strong> YT
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4 Quick Bottom Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#131822] border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between">
                    <span className="text-xs text-gray-400">المعروض الكلي</span>
                    <span className="text-base sm:text-lg font-black text-white mt-1 font-mono">1,000,000,000</span>
                    <span className="text-[10px] text-amber-400 mt-1">سقف ثابت غير قابل للزيادة</span>
                  </div>
                  <div className="bg-[#131822] border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between">
                    <span className="text-xs text-gray-400">الرتبة الحالية</span>
                    <span className="text-base sm:text-lg font-black text-amber-400 mt-1">مُعدِّن ذهبي</span>
                    <span className="text-[10px] text-emerald-400 mt-1">
                      سلسلة: {formatInt(summary?.streakDays ?? 1)} يوم
                    </span>
                  </div>
                  <div className="bg-[#131822] border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between">
                    <span className="text-xs text-gray-400">إجمالي المطالبات</span>
                    <span className="text-base sm:text-lg font-black text-white mt-1 font-mono">
                      {formatInt(summary?.totalClaims ?? 0)}
                    </span>
                    <span className="text-[10px] text-gray-400 mt-1">عملية ناجحة</span>
                  </div>
                  <div className="bg-[#131822] border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between">
                    <span className="text-xs text-gray-400">حالة العقد الذكي</span>
                    <span className="text-base sm:text-lg font-black text-emerald-400 mt-1">مُدقّق وآمن</span>
                    <span className="text-[10px] text-gray-400 mt-1">بدون كسور عشرية</span>
                  </div>
                </div>
              </section>
            )}

            {/* ========================================== */}
            {/* 2. تبويب المهام (TASKS TAB)                */}
            {/* ========================================== */}
            {activeTab === 'tasks' && (
              <section className="space-y-5">
                <div className="rounded-3xl bg-gradient-to-l from-[#182030] to-[#121722] border border-amber-500/25 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                      <Award className="w-6 h-6 text-amber-400" />
                      <span>مركز المهام والمكافآت اليومية</span>
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-400 mt-1">
                      أكمل المهام البسيطة واحصل على عملات YT Coin إضافية تضاف فوراً إلى محفظتك.
                    </p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 text-center shrink-0">
                    <span className="text-xs text-gray-300 block">مكافآت متاحة للاستلام</span>
                    <span className="text-xl font-black text-amber-400 font-mono">
                      {formatInt(pendingTasksReward)} YT
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tasks.map((task) => {
                    const pct = task.target ? Math.min(100, Math.round((todayTaps / task.target) * 100)) : 100;
                    return (
                      <div
                        key={task.id}
                        className="rounded-2xl bg-[#131822] border border-white/10 p-4 flex items-center justify-between gap-3 hover:border-amber-500/30 transition-all"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
                            {task.id === 1 && <Calendar className="w-5 h-5" />}
                            {task.id === 2 && <Hand className="w-5 h-5" />}
                            {task.id === 3 && <Send className="w-5 h-5" />}
                            {task.id === 4 && <Users className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-white truncate">{task.title}</h4>
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.desc}</p>
                            <span className="inline-block mt-1.5 text-xs font-extrabold text-amber-400 font-mono">
                              +{formatInt(task.reward)} YT Coin
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {task.status === 'claimed' ? (
                            <span className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 text-xs font-extrabold border border-emerald-500/25">
                              <Check className="w-3.5 h-3.5" /> مكتملة
                            </span>
                          ) : task.status === 'progress' ? (
                            <div className="text-left">
                              <span className="text-xs font-bold text-amber-400 block font-mono">
                                {todayTaps} / {task.target}
                              </span>
                              <div className="w-20 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                                <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleClaimTask(task.id)}
                              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs transition-all active:scale-95 shadow-md cursor-pointer"
                            >
                              استلام +{formatInt(task.reward)}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ========================================== */}
            {/* 3. تبويب المحفظة (WALLET TAB)              */}
            {/* ========================================== */}
            {activeTab === 'wallet' && (
              <section className="space-y-5">
                <div className="rounded-3xl bg-gradient-to-br from-[#1C2333] via-[#141A26] to-[#0E121B] border border-amber-500/30 p-6 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-40 h-40 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold text-amber-400/90 uppercase tracking-wider">
                        إجمالي رصيد المحفظة
                      </span>
                      <div className="flex items-baseline gap-2.5 mt-1">
                        <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight font-mono">
                          {formatInt(effectiveBalance)}
                        </h2>
                        <span className="text-lg font-extrabold text-amber-400">YT Coin</span>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-400 mt-1">
                        القيمة السوقية التقديرية: <span className="text-emerald-400 font-bold">${effectiveUsd} USD</span>
                      </p>
                    </div>

                    {/* Wallet Address Box */}
                    <div className="bg-[#0B0E14]/80 border border-white/10 rounded-2xl p-3.5 max-w-xs w-full">
                      <span className="text-[11px] text-gray-400 block mb-1">عنوان محفظة YT الخاصة بك</span>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs text-amber-300 font-mono truncate">{walletAddress}</code>
                        <button
                          type="button"
                          onClick={copyWalletAddress}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-bold transition-colors shrink-0 cursor-pointer"
                        >
                          {copiedAddress ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedAddress ? 'تم' : 'نسخ'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Wallet Action Buttons */}
                  <div className="grid grid-cols-3 gap-3 mt-6 pt-5 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setShowTransferModal(true)}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-extrabold text-xs sm:text-sm transition-all active:scale-95 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>إرسال / تحويل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReceiveModal(true)}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#1D2536] hover:bg-[#263046] text-white border border-white/10 font-extrabold text-xs sm:text-sm transition-all active:scale-95 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4 text-amber-400" />
                      <span>استلام</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('home')}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#1D2536] hover:bg-[#263046] text-white border border-white/10 font-extrabold text-xs sm:text-sm transition-all active:scale-95 cursor-pointer"
                    >
                      <Hammer className="w-4 h-4 text-emerald-400" />
                      <span>تعدين المزيد</span>
                    </button>
                  </div>
                </div>

                {/* Transactions Ledger */}
                <div className="rounded-3xl bg-[#131822] border border-white/5 p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                      <History className="w-5 h-5 text-amber-400" />
                      <span>سجل المعاملات والعمليات</span>
                    </h3>
                    <span className="text-xs text-gray-400 bg-white/5 px-3 py-1 rounded-full">
                      {combinedTransactions.length} عملية
                    </span>
                  </div>

                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {combinedTransactions.map((tx) => {
                      const val = tx.amountYt ?? 0;
                      const isNegative = val < 0;
                      const amountColor = isNegative
                        ? 'text-rose-400'
                        : val === 0
                          ? 'text-gray-400'
                          : 'text-emerald-400';
                      const prefix = val > 0 ? '+' : '';

                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between p-3 rounded-2xl bg-[#0D1119] border border-white/5"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                tx.type === 'send'
                                  ? 'text-rose-400 bg-rose-500/10'
                                  : tx.type === 'task'
                                    ? 'text-sky-400 bg-sky-500/10'
                                    : 'text-amber-400 bg-amber-500/10'
                              }`}
                            >
                              {tx.type === 'send' ? (
                                <ArrowUpRightFromSquare className="w-4 h-4" />
                              ) : tx.type === 'task' ? (
                                <Award className="w-4 h-4" />
                              ) : (
                                <Coins className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <h5 className="text-xs sm:text-sm font-bold text-gray-200 truncate">{tx.label}</h5>
                              <span className="text-[11px] text-gray-500 block truncate">
                                {tx.createdAt ? formatDateTime(tx.createdAt) : tx.claimDate || 'الآن'} • {tx.id}
                              </span>
                            </div>
                          </div>
                          <div className={`text-left font-black text-xs sm:text-sm font-mono shrink-0 ${amountColor}`} dir="ltr">
                            {prefix}
                            {formatInt(val)} YT
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* ========================================== */}
            {/* 4. تبويب لوحتي والإحصائيات (DASHBOARD TAB)  */}
            {/* ========================================== */}
            {activeTab === 'dashboard' && (
              <section className="space-y-5">
                {/* 4 KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-2xl bg-[#131822] border border-amber-500/20 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>سقف المعروض الكلي</span>
                      <Coins className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">1,000,000,000</div>
                    <div className="text-[11px] text-amber-400 mt-1">YT Coin (أعداد صحيحة)</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>إجمالي العملات المعدّنة</span>
                      <Hammer className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-xl font-black text-emerald-400 font-mono">
                      {formatInt((summary?.poolDistributedYt ?? 342850000) + bonusBalance)}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">توزيع مستمر من السقف الكلي</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>السقف التصاعدي لليوم</span>
                      <TrendingUp className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">{formatInt(effectiveDailyCap)}</div>
                    <div className="text-[11px] text-emerald-400 mt-1">نمو تصاعدي بدون كسور عشرية</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>إجمالي ما عدّنته شخصياً</span>
                      <Users className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">
                      {formatInt((summary?.totalMinedYt ?? 0) + bonusBalance)}
                    </div>
                    <div className="text-[11px] text-sky-400 mt-1">
                      سلسلة الالتزام: {formatInt(summary?.streakDays ?? 0)} يوم
                    </div>
                  </div>
                </div>

                {/* Visual Growth Chart (Pure SVG Responsive Curve) */}
                <div className="rounded-3xl bg-[#131822] border border-amber-500/20 p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                    <div>
                      <h3 className="text-base sm:text-lg font-extrabold text-white">
                        منحنى السقف التصاعدي اليومي للتعدين
                      </h3>
                      <p className="text-xs text-gray-400">
                        تطور سقف التعدين اليومي من 1 عملة صعوداً بدون كسور عشرية
                      </p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-500/15 text-amber-400 self-start">
                      آخر 7 أيام
                    </span>
                  </div>

                  <div className="w-full h-56 sm:h-64 bg-[#0D1119] rounded-2xl border border-white/5 p-4 flex flex-col justify-between">
                    <svg viewBox="0 0 700 200" className="w-full h-full overflow-visible">
                      <defs>
                        <linearGradient id="ytGoldFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#F5B921" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#F5B921" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <line x1="0" y1="40" x2="700" y2="40" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <line x1="0" y1="100" x2="700" y2="100" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <line x1="0" y1="160" x2="700" y2="160" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <path
                        d="M 20 175 Q 130 160, 230 135 T 450 85 T 680 25 L 680 185 L 20 185 Z"
                        fill="url(#ytGoldFill)"
                      />
                      <path
                        d="M 20 175 Q 130 160, 230 135 T 450 85 T 680 25"
                        fill="none"
                        stroke="#F5B921"
                        strokeWidth="4"
                        strokeLinecap="round"
                      />
                      {[
                        { cx: 20, cy: 175 },
                        { cx: 130, cy: 158 },
                        { cx: 240, cy: 133 },
                        { cx: 350, cy: 108 },
                        { cx: 460, cy: 82 },
                        { cx: 570, cy: 52 },
                        { cx: 680, cy: 25 },
                      ].map((pt, i) => (
                        <circle
                          key={i}
                          cx={pt.cx}
                          cy={pt.cy}
                          r="6"
                          fill="#FCD34D"
                          stroke="#0B0E14"
                          strokeWidth="2.5"
                        />
                      ))}
                    </svg>
                    <div className="flex justify-between text-[11px] text-gray-400 pt-2 border-t border-white/5">
                      <span>اليوم 1</span>
                      <span>اليوم 2</span>
                      <span>اليوم 3</span>
                      <span>اليوم 4</span>
                      <span>اليوم 5</span>
                      <span>اليوم 6</span>
                      <span className="text-amber-400 font-bold">اليوم (الحالي)</span>
                    </div>
                  </div>
                </div>

                {/* Tokenomics Distribution */}
                <div className="rounded-3xl bg-[#131822] border border-white/5 p-5 sm:p-6">
                  <h3 className="text-base font-extrabold text-white mb-4">توزيع سقف الـ 1 مليار عملة (Tokenomics)</h3>
                  <div className="space-y-3 text-xs sm:text-sm">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-300">مكافآت التعدين العام (70%)</span>
                        <span className="font-bold text-amber-400 font-mono">700,000,000 YT</span>
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: '70%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-300">مكافآت المهام والمجتمع (15%)</span>
                        <span className="font-bold text-emerald-400 font-mono">150,000,000 YT</span>
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: '15%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-300">السيولة وتطوير النظام البيئي (15%)</span>
                        <span className="font-bold text-sky-400 font-mono">150,000,000 YT</span>
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-400 rounded-full" style={{ width: '15%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ========================================== */}
            {/* 5. تبويب الإدارة والإعدادات (ADMIN TAB)     */}
            {/* ========================================== */}
            {activeTab === 'admin' && (
              <section className="space-y-5">
                <form
                  onSubmit={handleSaveAdminSettings}
                  className="rounded-3xl bg-[#131822] border border-amber-500/25 p-5 sm:p-6"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-black text-white">لوحة الإدارة وضبط معاملات المنجم</h2>
                      <p className="text-xs text-gray-400">
                        تحكم مباشر في محاكاة السقف اليومي وقيمة المطالبة وحالة الشبكة
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-3">
                      <label className="text-xs font-bold text-gray-300 block">
                        مكافأة المطالبة الحالية (عدد صحيح YT)
                      </label>
                      <div className="flex gap-2">
                        <input
                          name="claimInput"
                          type="number"
                          min={1}
                          step={1}
                          defaultValue={effectiveClaimReward}
                          className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-extrabold text-xs shrink-0 cursor-pointer"
                        >
                          حفظ
                        </button>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-3">
                      <label className="text-xs font-bold text-gray-300 block">السقف التصاعدي اليومي (YT)</label>
                      <div className="flex gap-2">
                        <input
                          name="capInput"
                          type="number"
                          min={1000}
                          step={1}
                          defaultValue={effectiveDailyCap}
                          className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-extrabold text-xs shrink-0 cursor-pointer"
                        >
                          تطبيق
                        </button>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-3">
                      <label className="text-xs font-bold text-gray-300 block">
                        مكافأة النقر المباشر على العملة (YT)
                      </label>
                      <div className="flex gap-2">
                        <input
                          name="tapInput"
                          type="number"
                          min={1}
                          step={1}
                          defaultValue={tapPower}
                          className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-extrabold text-xs shrink-0 cursor-pointer"
                        >
                          تعديل
                        </button>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-gray-200 block">حالة عقد التعدين الذكي</span>
                        <span className="text-[11px] text-gray-400">تفعيل أو إيقاف التعدين مؤقتاً</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !effectiveNetworkActive;
                          setNetworkActiveOverride(next);
                          showToast(next ? 'تم تفعيل شبكة التعدين' : 'تم إيقاف شبكة التعدين مؤقتاً', 'info');
                        }}
                        className={`px-4 py-2 rounded-xl font-bold text-xs cursor-pointer ${
                          effectiveNetworkActive
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        }`}
                      >
                        {effectiveNetworkActive ? 'نشط (Active)' : 'متوقف (Paused)'}
                      </button>
                    </div>
                  </div>

                  {/* Reset Area */}
                  <div className="mt-6 pt-5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-rose-400">منطقة إعادة الضبط</h4>
                      <p className="text-xs text-gray-400">
                        إعادة تعيين كافة الأرصدة والمعاملات والمهام المحلية إلى الحالة الافتراضية.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowResetModal(true)}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 font-bold text-xs transition-all self-start sm:self-auto cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إعادة ضبط البيانات</span>
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        </main>

        {/* ==================== MOBILE BOTTOM NAVIGATION BAR (exact match to screenshot) ==================== */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#F8FAFC] text-slate-600 border-t border-slate-200 px-2 py-2 flex items-center justify-around z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
              activeTab === 'home' ? 'text-amber-600 font-extrabold' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[11px]">الرئيسية</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all relative cursor-pointer ${
              activeTab === 'tasks' ? 'text-amber-600 font-extrabold' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <ListChecks className="w-5 h-5 mb-0.5" />
            <span className="text-[11px]">المهام</span>
            {activeTasksCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 absolute top-1 right-2.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
              activeTab === 'wallet' ? 'text-amber-600 font-extrabold' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <Wallet className="w-5 h-5 mb-0.5" />
            <span className="text-[11px]">المحفظة</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
              activeTab === 'dashboard'
                ? 'text-amber-600 font-extrabold'
                : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <User className="w-5 h-5 mb-0.5" />
            <span className="text-[11px]">لوحتي</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
              activeTab === 'admin' ? 'text-amber-600 font-extrabold' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <ShieldCheck className="w-5 h-5 mb-0.5" />
            <span className="text-[11px]">الإدارة</span>
          </button>
        </nav>
      </div>

      {/* ==================== MODALS ==================== */}
      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#151B26] border border-amber-500/30 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white">تحويل عملات YT Coin</h3>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">عنوان محفظة المستلم</label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="YT9a41C8...77B2E1"
                  className="w-full bg-[#0D1119] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>المبلغ (عدد صحيح)</span>
                  <span>
                    المتاح: <strong className="text-amber-400 font-mono">{formatInt(effectiveBalance)}</strong> YT
                  </span>
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="أدخل الكمية..."
                  className="w-full bg-[#0D1119] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white font-bold focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={executeTransfer}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-sm cursor-pointer"
              >
                تأكيد الإرسال
              </button>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="px-5 py-3 rounded-xl bg-white/10 text-gray-300 font-bold text-sm cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#151B26] border border-amber-500/30 rounded-3xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white">استلام YT Coin</h3>
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="w-44 h-44 mx-auto bg-white p-3 rounded-2xl flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full fill-[#0B0E14]">
                <rect x="10" y="10" width="25" height="25" rx="3" />
                <rect x="15" y="15" width="15" height="15" fill="white" />
                <rect x="18" y="18" width="9" height="9" />
                <rect x="65" y="10" width="25" height="25" rx="3" />
                <rect x="70" y="15" width="15" height="15" fill="white" />
                <rect x="73" y="18" width="9" height="9" />
                <rect x="10" y="65" width="25" height="25" rx="3" />
                <rect x="15" y="70" width="15" height="15" fill="white" />
                <rect x="18" y="73" width="9" height="9" />
                <rect x="42" y="12" width="14" height="14" />
                <rect x="42" y="42" width="16" height="16" fill="#D49415" />
                <rect x="65" y="45" width="22" height="10" />
                <rect x="12" y="45" width="20" height="10" />
                <rect x="45" y="68" width="12" height="20" />
                <rect x="68" y="68" width="20" height="20" />
              </svg>
            </div>
            <p className="text-xs text-gray-400">امسح الرمز أو انسخ عنوان محفظتك لاستلام العملات بدون رسوم.</p>
            <div className="bg-[#0D1119] p-3 rounded-xl border border-white/10 font-mono text-xs text-amber-400 break-all">
              {walletAddress}
            </div>
            <button
              type="button"
              onClick={() => {
                copyWalletAddress();
                setShowReceiveModal(false);
              }}
              className="w-full py-3 rounded-xl bg-amber-500 text-[#0B0E14] font-black text-sm cursor-pointer"
            >
              نسخ العنوان
            </button>
          </div>
        </div>
      )}

      {/* Reset Confirm Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#151B26] border border-rose-500/30 rounded-3xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-white">تأكيد إعادة ضبط البيانات؟</h3>
            <p className="text-xs text-gray-400">سيتم مسح رصيدك المحلي وسجل المعاملات المؤقت والبدء من جديد.</p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={handleResetLocalData}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm cursor-pointer"
              >
                نعم، أعد الضبط
              </button>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 text-gray-300 font-bold text-sm cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
