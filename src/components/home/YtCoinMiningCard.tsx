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
  ArrowRight,
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
  Hourglass,
  ExternalLink,
  Layers,
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
  type: 'mine' | 'task' | 'send' | 'system' | string;
  txHash: string;
}

interface NormalizedYtCoinSummary {
  balanceYt: number | null;
  totalMinedYt: number | null;
  todayRewardYt: number | null;
  baseRewardYt: number;
  dailyIncrementYt: number;
  maxDailyRewardYt: number;
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
    return 'إيداع كتلة تعدين YT';
  }
  if (normalized.includes('streak') || normalized.includes('bonus')) {
    return 'مكافأة سلسلة التعدين';
  }
  if (normalized.includes('referral')) {
    return 'تحويل مكافأة إحالة';
  }
  if (normalized.includes('transfer')) {
    return 'تحويل خارجي عبر الشبكة';
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
    if (atomicBalance !== null) balanceYt = atomicBalance / 2;
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
    if (atomicMined !== null) totalMinedYt = atomicMined / 2;
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
    if (atomicReward !== null) todayRewardYt = atomicReward / 2;
  }

  const baseRewardUnitsRaw = pickNumber(sources, ['baseRewardUnits', 'base_reward_units']);
  const dailyIncrementUnitsRaw = pickNumber(sources, ['dailyIncrementUnits', 'daily_increment_units']);
  const maxDailyRewardUnitsRaw = pickNumber(sources, ['maxDailyRewardUnits', 'max_daily_reward_units']);
  const baseRewardYt = baseRewardUnitsRaw !== null ? baseRewardUnitsRaw / 2 : 0.5;
  const dailyIncrementYt = dailyIncrementUnitsRaw !== null ? dailyIncrementUnitsRaw / 2 : 0.5;
  const maxDailyRewardYt = maxDailyRewardUnitsRaw !== null ? maxDailyRewardUnitsRaw / 2 : 20;

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
    if (atomicPoolRem !== null) poolRemainingYt = atomicPoolRem / 2;
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
    if (atomicPoolCap !== null) poolCapYt = atomicPoolCap / 2;
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
  if (poolDistributedYt === null) {
    const atomicTotalMined = pickNumber(sources, [
      'totalMinedUnits',
      'total_mined_units',
      'total_distributed_units',
      'poolDistributedUnits',
    ]);
    if (atomicTotalMined !== null) poolDistributedYt = atomicTotalMined / 2;
  }
  if (poolDistributedYt === null && poolCapYt !== null && poolRemainingYt !== null) {
    poolDistributedYt = Math.max(0, poolCapYt - poolRemainingYt);
  }

  let dailyCapYt = pickNumber(sources, ['daily_cap_yt', 'dailyCapYt']);
  if (dailyCapYt === null) {
    const atomicDailyCap = pickNumber(sources, ['dailyCapUnits', 'daily_cap_units']);
    if (atomicDailyCap !== null) dailyCapYt = atomicDailyCap / 2;
  }

  let dailyMinedYt = pickNumber(sources, ['daily_mined_yt', 'mined_today_yt', 'dailyMinedYt']);
  if (dailyMinedYt === null) {
    const atomicDailyMined = pickNumber(sources, ['minedTodayUnits', 'mined_today_units', 'dailyMinedUnits']);
    if (atomicDailyMined !== null) dailyMinedYt = atomicDailyMined / 2;
  }

  let dailyRemainingYt = pickNumber(sources, ['daily_remaining_yt', 'dailyRemainingYt']);
  const dailyRemainingUnits = pickNumber(sources, [
    'dailyCapRemainingUnits',
    'daily_cap_remaining_units',
    'daily_remaining_units',
  ]);
  if (dailyRemainingYt === null && dailyRemainingUnits !== null) {
    dailyRemainingYt = dailyRemainingUnits / 2;
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

  const streakDays = pickNumber(sources, [
    'streakDay',
    'streak_day',
    'streak_days',
    'current_streak',
    'streak',
    'consecutive_days',
    'streakDays',
  ]);
  const totalClaims = pickNumber(sources, ['total_claims', 'claims_count', 'claim_count', 'days_claimed', 'totalClaims']);

  const lastClaimAt = pickString(sources, ['last_claim_at', 'last_claimed_at', 'lastClaimAt']);
  let nextClaimAt = pickString(sources, ['next_claim_at', 'next_available_at', 'cooldown_until', 'reset_at', 'nextClaimAt']);
  if (!nextClaimAt && claimedToday) {
    const adenNow = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Aden',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(adenNow);
    const tomorrowMidnightUtc = new Date(`${parts}T00:00:00+03:00`).getTime() + 86400000;
    if (Number.isFinite(tomorrowMidnightUtc)) {
      nextClaimAt = new Date(tomorrowMidnightUtc).toISOString();
    }
  }
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
        if (atomic !== null) amountYt = atomic / 2;
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
      const rowId = String(rec.id ?? rec.claim_id ?? rec.entry_id ?? reference ?? `TX-${1000 + idx}`);
      return {
        id: rowId,
        amountYt,
        label: translateEventLabel(rawLabel),
        createdAt,
        claimDate,
        streakDay,
        reference,
        type: isNegative ? 'send' : 'mine',
        txHash: reference || rowId,
      };
    })
    .filter((item): item is NormalizedHistoryItem => item !== null);

  return {
    balanceYt,
    totalMinedYt,
    todayRewardYt,
    baseRewardYt,
    dailyIncrementYt,
    maxDailyRewardYt,
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

function formatYt(value: number | null, maxDecimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '0';
  if (value !== 0 && Math.abs(value) < 0.1) return value < 0 ? '-<0.1' : '<0.1';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(1, Math.max(0, maxDecimals)),
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
  wallet: 'محفظة YT Coin الرقمية',
  dashboard: 'لوحة الإحصائيات ونمو المعروض',
  admin: 'لوحة الإدارة وضبط إعدادات المنجم',
};

export const YtCoinMiningCard: React.FC<{
  compact?: boolean;
  onOpen?: () => void;
  onExit?: () => void;
}> = ({ compact = false, onOpen, onExit }) => {
  const { user, isAdmin, openAuthModal, showToast } = useAuth();
  const [rawSummary, setRawSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [loadedAtTs, setLoadedAtTs] = useState<number>(() => Date.now());
  const [isRefreshingSpin, setIsRefreshingSpin] = useState<boolean>(false);

  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const arenaRef = useRef<HTMLDivElement | null>(null);

  // Admin-Only State & Real Supabase Configuration Controls
  const [adminSummary, setAdminSummary] = useState<any>(null);
  const [adminLoading, setAdminLoading] = useState<boolean>(false);
  const [savingAdminConfig, setSavingAdminConfig] = useState<boolean>(false);
  const [adminMiningEnabled, setAdminMiningEnabled] = useState<boolean>(true);
  const [adminBaseRewardYt, setAdminBaseRewardYt] = useState<string>('0.5');
  const [adminDailyIncrementYt, setAdminDailyIncrementYt] = useState<string>('0.5');
  const [adminMaxDailyRewardYt, setAdminMaxDailyRewardYt] = useState<string>('20');
  const [adminDailyCapStartYt, setAdminDailyCapStartYt] = useState<string>('1000');
  const [adminDailyCapMaxYt, setAdminDailyCapMaxYt] = useState<string>('1000000');

  // Wallet Modals & States
  const [showReceiveModal, setShowReceiveModal] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  // Tasks
  const [tasks, setTasks] = useState<LocalTaskItem[]>([
    {
      id: 1,
      title: 'تسجيل الدخول اليومي للمنجم',
      desc: 'احصل على مكافأة الحضور اليومي المتصاعدة من 0.5 إلى 20 YT',
      reward: 0.5,
      status: 'ready',
    },
    {
      id: 2,
      title: 'تحقيق سلسلة 20 يوم تعدين متتالية',
      desc: 'واصل التعدين اليومي لفتح مكافأة 20 YT ثابتة كل يوم',
      reward: 20,
      status: 'progress',
      target: 20,
    },
    {
      id: 3,
      title: 'توثيق عنوان محفظة YT Coin',
      desc: 'انسخ أو شارك عنوان محفظتك على شبكة YT Mainnet',
      reward: 1,
      status: 'ready',
    },
    {
      id: 4,
      title: 'دعوة صديق للتعدين السحابي',
      desc: 'شارك رابط المنصة مع أصدقائك لتوسيع مجتمع المعدّنين',
      reward: 2,
      status: 'ready',
    },
  ]);

  
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

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('home');
    }
  }, [isAdmin, activeTab]);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setAdminLoading(true);
    try {
      const res = await api.getAdminYtCoinSummary();
      const s = res?.summary ?? null;
      setAdminSummary(s);
      if (s && typeof s === 'object') {
        if (typeof s.mining_enabled === 'boolean') setAdminMiningEnabled(s.mining_enabled);
        const toYtStr = (val: unknown, fallback: string) => {
          const n = Number(val);
          if (!Number.isFinite(n) || n < 0) return fallback;
          return String(Math.round((n / 2) * 10) / 10);
        };
        setAdminBaseRewardYt(toYtStr(s.base_reward_units, '0.5'));
        setAdminDailyIncrementYt(toYtStr(s.daily_increment_units, '0.5'));
        setAdminMaxDailyRewardYt(toYtStr(s.max_daily_reward_units, '20'));
        setAdminDailyCapStartYt(toYtStr(s.daily_cap_start_units ?? s.daily_global_cap_units, '1000'));
        setAdminDailyCapMaxYt(toYtStr(s.daily_cap_max_units ?? s.daily_global_cap_max_units, '1000000'));
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل لوحة إدارة YT Coin', 'error');
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin, showToast]);

  useEffect(() => {
    if (!compact && isAdmin && activeTab === 'admin') {
      void loadAdminData();
    }
  }, [compact, isAdmin, activeTab, loadAdminData]);

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
    const rawId = String((user as any)?.id || (user as any)?.user_id || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    return rawId ? `yt1${rawId}` : 'غير متصل';
  }, [user]);

  const shortWalletAddress = useMemo(() => {
    if (!walletAddress.startsWith('yt1') || walletAddress.length <= 16) return walletAddress;
    return `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`;
  }, [walletAddress]);

  // Effective Values synced directly from Supabase RPC
  const effectiveBalance = Math.max(0, summary?.balanceYt ?? 0);
  const currentStreakDays = Math.max(0, summary?.streakDays ?? 0);
  const upcomingStreakDay = currentStreakDays + 1;
  const computedFallbackReward =
    upcomingStreakDay >= 20
      ? (summary?.maxDailyRewardYt ?? 20)
      : (summary?.baseRewardYt ?? 0.5) + (upcomingStreakDay - 1) * (summary?.dailyIncrementYt ?? 0.5);
  const effectiveClaimReward = summary?.todayRewardYt ?? computedFallbackReward;
  const effectiveDailyCap = summary?.dailyCapYt ?? 0;
  const effectiveDailyUsed = Math.min(effectiveDailyCap, summary?.dailyMinedYt ?? 0);
  const effectiveCapPercent =
    effectiveDailyCap > 0 ? Math.min(100, Number(((effectiveDailyUsed / effectiveDailyCap) * 100).toFixed(1))) : 0;
  const effectiveCapRemaining = Math.max(0, effectiveDailyCap - effectiveDailyUsed);
  const effectiveNetworkActive = summary?.miningEnabled ?? false;

  const combinedTransactions = useMemo(() => {
    const apiList = summary?.history ?? [];
    return apiList;
  }, [summary?.history]);

  const handleRefreshData = async () => {
    setIsRefreshingSpin(true);
    window.setTimeout(() => setIsRefreshingSpin(false), 650);
    await loadSummary(false);
    if (isAdmin && activeTab === 'admin') {
      await loadAdminData();
    }
    showToast('تمت مزامنة الرصيد ومحفظة YT Coin بنجاح', 'info');
  };

  const spawnClaimParticle = (e?: React.MouseEvent<HTMLButtonElement>, text?: string) => {
    if (!arenaRef.current) return;
    const rect = arenaRef.current.getBoundingClientRect();
    const x = (e?.clientX ? e.clientX - rect.left : rect.width / 2) - 28;
    const y = (e?.clientY ? e.clientY - rect.top : rect.height / 2) - 20;
    const id = Date.now() + Math.random();
    setParticles((prev) => [...prev, { id, x, y, text: text || `+${formatYt(effectiveClaimReward)} YT` }]);
    window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 950);
  };

  const handleCoinPress = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!effectiveNetworkActive) {
      showToast('الشبكة متوقفة حالياً من لوحة الإدارة', 'error');
      return;
    }
    if (summary?.capReached) {
      showToast('تم بلوغ سقف التعدين المتاح حالياً.', 'info');
      return;
    }
    if (summary && !summary.canClaim) {
      showToast(
        remainingCooldownSec > 0
          ? `تم استلام مكافأة اليوم بالفعل — المطالبة القادمة خلال ${formatCountdown(remainingCooldownSec)}`
          : 'تم استلام مكافأة اليوم بنجاح.',
        'info'
      );
      return;
    }
    spawnClaimParticle(e, `+${formatYt(effectiveClaimReward)} YT`);
    void handleClaim();
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
        if (claimedUnits !== null) claimedAmount = claimedUnits / 2;
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
        showToast(
          resultMessage || `تم إيداع +${formatYt(claimedAmount)} YT Coin في محفظتك بنجاح!`,
          'success'
        );
      } else {
        showToast(resultMessage || 'تم إيداع مكافأة التعدين في محفظتك بنجاح!', 'success');
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

  const handleClaimTask = (_taskId: number) => {
    showToast('مكافآت المهام الإضافية قيد التفعيل؛ يمكنك تعدين مكافأتك اليومية من الرئيسية.', 'info');
  };

  const copyWalletAddress = () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(walletAddress);
    }
    setCopiedAddress(true);
    showToast('تم نسخ عنوان المحفظة بنجاح', 'success');
    window.setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleSaveAdminSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin || savingAdminConfig) return;

    const parseDecimalStep = (raw: string, label: string, minVal: number): number | null => {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < minVal) {
        showToast(`قيمة "${label}" يجب أن تكون ${minVal} YT على الأقل.`, 'error');
        return null;
      }
      if (Math.abs(val * 2 - Math.round(val * 2)) > 1e-6) {
        showToast(`"${label}" يقبل خانة عشرية واحدة من مضاعفات 0.5 YT فقط (مثل 0.5 أو 1.5 أو 20).`, 'error');
        return null;
      }
      return Math.round(val * 10) / 10;
    };

    const baseRewardYt = parseDecimalStep(adminBaseRewardYt, 'مكافأة اليوم الأول', 0.5);
    const dailyIncrementYt = parseDecimalStep(adminDailyIncrementYt, 'الزيادة اليومية', 0);
    const maxDailyRewardYt = parseDecimalStep(adminMaxDailyRewardYt, 'مكافأة اليوم 20 وما بعده', 0.5);
    const dailyCapStartYt = parseDecimalStep(adminDailyCapStartYt, 'السقف اليومي الابتدائي', 0.5);
    const dailyCapMaxYt = parseDecimalStep(adminDailyCapMaxYt, 'الحد الأقصى للسقف اليومي', 0.5);

    if (
      baseRewardYt === null ||
      dailyIncrementYt === null ||
      maxDailyRewardYt === null ||
      dailyCapStartYt === null ||
      dailyCapMaxYt === null
    ) {
      return;
    }

    setSavingAdminConfig(true);
    try {
      await api.updateAdminYtCoinConfig({
        miningEnabled: adminMiningEnabled,
        baseRewardYt,
        dailyIncrementYt,
        maxDailyRewardYt,
        dailyCapStartYt,
        dailyCapMaxYt,
      });
      showToast('تم حفظ وتحديث إعدادات تعدين YT Coin في Supabase بنجاح.', 'success');
      await Promise.all([loadAdminData(), loadSummary(true)]);
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ إعدادات التعدين في قاعدة البيانات.', 'error');
    } finally {
      setSavingAdminConfig(false);
    }
  };

  const handleToggleMiningEnabled = async () => {
    if (!isAdmin || savingAdminConfig) return;
    const nextEnabled = !adminMiningEnabled;
    setSavingAdminConfig(true);
    try {
      await api.updateAdminYtCoinConfig({ miningEnabled: nextEnabled });
      setAdminMiningEnabled(nextEnabled);
      showToast(nextEnabled ? 'تم تفعيل شبكة التعدين بنجاح' : 'تم إيقاف شبكة التعدين مؤقتاً', 'success');
      await Promise.all([loadAdminData(), loadSummary(true)]);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تغيير حالة شبكة التعدين.', 'error');
    } finally {
      setSavingAdminConfig(false);
    }
  };

  const handleResetLocalData = () => {
    setAdminBaseRewardYt('0.5');
    setAdminDailyIncrementYt('0.5');
    setAdminMaxDailyRewardYt('20');
    setTasks((prev) => prev.map((t) => ({ ...t, status: t.id === 2 ? 'progress' : 'ready' })));
    setShowResetModal(false);
    showToast('تمت إعادة تعيين حقول المعاينة الافتراضية (اضغط حفظ لتطبيقها على الخادم).', 'info');
  };

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
            <img
              src={YT_COIN_LOGO_SRC}
              alt="YT Coin"
              className="w-11 h-11 rounded-full object-cover ring-2 ring-amber-400/80 shadow-lg shrink-0 select-none bg-[#080E1B]"
            />
            <div>
              <span className="font-extrabold text-lg text-white tracking-wide block">YT Coin</span>
              <p className="text-xs text-gray-400">منصة التعدين الرقمي المستقلة</p>
            </div>
          </div>

          {/* Wallet Balance Quick Card */}
          <div
            onClick={() => setActiveTab('wallet')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveTab('wallet');
            }}
            className="mt-5 p-4 rounded-2xl bg-gradient-to-br from-[#192233] via-[#131926] to-[#0E131D] border border-amber-500/30 shadow-lg hover:border-amber-400/60 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-gray-300 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                <span>الرصيد المتاح</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                YT Chain
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-white tracking-tight font-mono">
                {formatYt(effectiveBalance)}
              </span>
              <span className="text-xs font-black text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-lg border border-amber-500/25">
                YT
              </span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-gray-400">إجمالي التعدين:</span>
              <span className="text-amber-300 font-extrabold font-mono">
                {formatYt(summary?.totalMinedYt ?? 0)} YT
              </span>
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
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'wallet'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <Wallet className="w-5 h-5 shrink-0" />
                <span>المحفظة</span>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25">
                {formatYt(effectiveBalance)} YT
              </span>
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

            {isAdmin && (
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
                <span>لوحة الإدارة (Admin)</span>
              </button>
            )}
          </nav>
        </div>

        {/* Network Status Footer */}
        <div className="space-y-2">
          <div className="p-3.5 rounded-xl bg-[#131822] border border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  effectiveNetworkActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span className="text-xs font-semibold text-gray-300">
                {effectiveNetworkActive ? 'YT Chain Mainnet' : 'الصيانة مجدولة'}
              </span>
            </div>
            <span className="text-[11px] text-amber-400/80 font-mono">v2.4</span>
          </div>

          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="w-full py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-gray-300 hover:text-white transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>العودة ليمن تاسك</span>
            </button>
          )}
        </div>
      </aside>

      {/* ==================== MAIN CONTENT CONTAINER ==================== */}
      <div className="flex-1 flex flex-col h-full w-full overflow-hidden relative">
        {/* Top Header */}
        <header className="w-full px-3.5 sm:px-4 md:px-8 py-3 bg-[#0F131C]/90 backdrop-blur-md border-b border-amber-500/15 flex items-center justify-between gap-2 shrink-0 z-20">
          {/* Mobile Brand */}
          <div className="flex items-center gap-2.5 md:hidden min-w-0">
            <img
              src={YT_COIN_LOGO_SRC}
              alt="YT Coin"
              className="w-9 h-9 rounded-full object-cover ring-2 ring-amber-400/80 shadow-md shrink-0 select-none bg-[#080E1B]"
            />
            <div className="min-w-0">
              <h1 className="font-extrabold text-sm text-white truncate">YT Coin</h1>
              <span className="text-[10px] text-gray-400 block truncate">منصة التعدين السحابي</span>
            </div>
          </div>

          {/* Desktop Current Section Title */}
          <div className="hidden md:flex items-center gap-3 min-w-0">
            <h2 className="text-xl font-extrabold text-white truncate">{PAGE_TITLES[activeTab]}</h2>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Zap className="w-3.5 h-3.5" /> تدرج +0.5 YT حتى 20 YT يومياً
            </span>
          </div>

          {/* Live Balance & Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                aria-label="العودة إلى التطبيق الأصلي يمن تاسك"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 hover:text-emerald-200 text-[11px] sm:text-xs font-extrabold transition-all active:scale-95 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">العودة ليمن تاسك</span>
                <span className="sm:hidden">يمن تاسك</span>
              </button>
            )}

            {!user ? (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-[#0B0E14] px-3 py-1.5 rounded-full text-xs font-black transition-all cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>تسجيل الدخول</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('wallet')}
                className="flex items-center gap-2 bg-[#161C28] hover:bg-[#1E2636] border border-amber-500/30 px-2.5 sm:px-3 py-1.5 rounded-full transition-all shadow-sm cursor-pointer"
              >
                <YtCoinLogo size="xs" />
                <span className="font-extrabold text-sm md:text-base text-amber-400 font-mono">
                  {formatYt(effectiveBalance)}
                </span>
                <span className="text-[11px] text-gray-400 font-semibold hidden sm:inline">YT</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => showToast('النظام يعمل بدقة حتى خانة عشرية واحدة (0.5 YT ← 20 YT في اليوم 20)', 'info')}
              aria-label="الإشعارات"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#161C28] border border-white/10 flex items-center justify-center text-gray-300 hover:text-amber-400 hover:border-amber-500/30 transition-all relative cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-amber-500 absolute top-1.5 right-2 sm:top-2 sm:right-2.5" />
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
                            <span>نمو يومي +0.5 YT ← 20 YT في اليوم 20</span>
                          </div>
                        </div>

                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full p-0.5 border-2 border-amber-400/70 bg-[#080E1B] shrink-0 overflow-hidden shadow-[0_0_30px_rgba(245,185,33,0.3)]">
                          <img
                            src={YT_COIN_LOGO_SRC}
                            alt="YT Coin"
                            className="w-full h-full rounded-full object-cover select-none"
                          />
                        </div>
                      </div>

                      <p className="text-gray-300 text-xs sm:text-sm md:text-base leading-relaxed max-w-2xl">
                        منصة تعدين مستقلة تبدأ مكافأتها اليومية بـ{' '}
                        <span className="text-amber-400 font-bold">0.5 YT</span> وتزداد{' '}
                        <span className="text-emerald-400 font-bold">+0.5 YT يومياً</span> مع كل دخول متتالٍ حتى تصل إلى{' '}
                        <span className="text-amber-400 font-bold">اليوم 20</span> فتبدأ بالحصول على{' '}
                        <span className="text-amber-300 font-extrabold">20 YT يومياً</span> باستمرار (بدقة حتى خانة عشرية واحدة).
                      </p>
                    </div>

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

                  <div className="my-5 border-t border-white/10" />

                  {/* Center Interactive Mining Arena */}
                  <div
                    ref={arenaRef}
                    className="rounded-2xl bg-[#0D1119]/90 border border-amber-500/20 p-5 sm:p-8 flex flex-col items-center justify-center relative overflow-hidden"
                  >
                    {particles.map((p) => (
                      <div
                        key={p.id}
                        style={{ left: `${p.x}px`, top: `${p.y}px` }}
                        className="floating-reward font-black text-amber-300 text-lg sm:text-xl"
                      >
                        {p.text}
                      </div>
                    ))}

                    <div className="w-full flex items-center justify-between text-xs text-gray-400 mb-4">
                      <span
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${
                          summary?.canClaim
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : 'bg-white/5 border-white/10 text-gray-300'
                        }`}
                      >
                        <Gem className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {!user
                            ? 'سجّل الدخول للتعدين'
                            : summary?.canClaim
                              ? 'اضغط على العملة لاستلام مكافأة اليوم'
                              : 'تم تأكيد تعدين اليوم'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 bg-white/5 px-3 py-1 rounded-full">
                        <Flame className="w-3.5 h-3.5 text-orange-400" />
                        السلسلة: <strong className="text-white font-mono">{formatInt(currentStreakDays)} / 20 يوم</strong>
                      </span>
                    </div>

                    <div className="relative my-3 sm:my-5 flex items-center justify-center">
                      <div className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-amber-500/15 blur-2xl animate-pulse-ring pointer-events-none" />

                      <button
                        type="button"
                        onClick={handleCoinPress}
                        disabled={claiming}
                        aria-label="المطالبة بمكافأة التعدين اليومي"
                        className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-full p-1.5 border-[3px] border-amber-400/80 bg-[#080E1B] shadow-[0_0_40px_rgba(245,185,33,0.3)] cursor-pointer focus:outline-none group transition-transform active:scale-95 overflow-hidden disabled:opacity-75"
                      >
                        <img
                          src={YT_COIN_LOGO_SRC}
                          alt="YT Coin"
                          className="w-full h-full rounded-full object-cover select-none group-hover:scale-105 transition-transform duration-200"
                        />
                      </button>
                    </div>

                    <div className="text-center mt-3 space-y-1">
                      <p className="text-amber-400/90 font-bold text-sm sm:text-base">
                        {summary?.claimedToday
                          ? `مكافأة الدخول القادم (اليوم ${upcomingStreakDay}${upcomingStreakDay >= 20 ? '+' : ''})`
                          : `مكافأة اليوم (اليوم ${upcomingStreakDay}${upcomingStreakDay >= 20 ? '+' : ''})`}
                      </p>
                      <div className="flex items-baseline justify-center gap-2" dir="ltr">
                        <span className="text-3xl sm:text-4xl md:text-5xl font-black text-amber-400 tracking-tight font-mono">
                          {formatYt(effectiveClaimReward)}+
                        </span>
                        <span className="text-base sm:text-lg font-extrabold text-amber-300">YT Coin</span>
                      </div>
                    </div>

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
                            disabled={claiming || summary === null || !summary.canClaim}
                            className={`w-full py-3.5 px-6 rounded-2xl font-black text-base sm:text-lg transition-all flex items-center justify-center gap-2.5 ${
                              summary !== null && summary.canClaim
                                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] shadow-[0_0_35px_rgba(245,185,33,0.25)] cursor-pointer active:scale-98'
                                : 'bg-slate-800/90 border border-slate-700 text-slate-300 opacity-80 cursor-not-allowed'
                            }`}
                          >
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>جاري الإيداع في المحفظة...</span>
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
                                <span>مطالبة بمكافأة +{formatYt(effectiveClaimReward)} YT الآن</span>
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
                              <span>المكافأة جاهزة للإيداع الفوري في محفظتك!</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Daily Streak Progression Roadmap (0.5 -> Day 20 = 20 YT) */}
                    <div className="w-full mt-6 rounded-2xl bg-[#131926] border border-amber-500/20 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-amber-300 flex items-center gap-1.5">
                          <TrendingUp className="w-4 h-4 text-amber-400" />
                          مسار المكافأة المتتالية (اليوم 1 ← اليوم 20)
                        </span>
                        <span className="font-mono font-black text-emerald-400">
                          {Math.min(currentStreakDays, 20)} / 20 يوم
                          {currentStreakDays >= 20 ? ' (المستوى الأقصى 20 YT يومياً!)' : ''}
                        </span>
                      </div>

                      <div className="w-full h-2 bg-[#0A0E17] rounded-full overflow-hidden border border-white/5">
                        <div
                          className="h-full bg-gradient-to-l from-emerald-400 via-amber-400 to-amber-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.round((Math.min(currentStreakDays, 20) / 20) * 100))}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                        <div className="rounded-xl bg-[#0B0F18] border border-white/5 px-2 py-2">
                          <span className="text-gray-400 block">اليوم 1</span>
                          <strong className="text-white font-mono">{formatYt(summary?.baseRewardYt ?? 0.5)} YT</strong>
                        </div>
                        <div className="rounded-xl bg-[#0B0F18] border border-white/5 px-2 py-2">
                          <span className="text-gray-400 block">الزيادة اليومية</span>
                          <strong className="text-emerald-400 font-mono">+{formatYt(summary?.dailyIncrementYt ?? 0.5)} YT</strong>
                        </div>
                        <div className="rounded-xl bg-[#0B0F18] border border-amber-500/30 px-2 py-2">
                          <span className="text-amber-300 block">اليوم 20 وما بعده</span>
                          <strong className="text-amber-400 font-mono">{formatYt(summary?.maxDailyRewardYt ?? 20)} YT / يوم</strong>
                        </div>
                      </div>
                    </div>

                    {/* Daily Cap Progress Bar */}
                    <div className="w-full mt-6 pt-5 border-t border-white/10">
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold mb-2">
                        <span className="text-gray-300">استهلاك السقف اليومي</span>
                        <span className="text-amber-400 font-mono" dir="ltr">
                          {formatYt(effectiveDailyUsed)} / {formatYt(effectiveDailyCap)}
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
                          المتبقي لليوم: <strong className="text-gray-200">{formatYt(effectiveCapRemaining)}</strong> YT
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
                    <span className="text-base sm:text-lg font-black text-amber-400 mt-1">
                      {currentStreakDays >= 20 ? 'أسطورة اليوم 20+' : 'مُعدِّن ذهبي'}
                    </span>
                    <span className="text-[10px] text-emerald-400 mt-1">
                      سلسلة: {formatInt(currentStreakDays)} يوم متتالٍ
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
                    <span className="text-xs text-gray-400">دقة التعدين</span>
                    <span className="text-base sm:text-lg font-black text-emerald-400 mt-1">مُدقّق وآمن</span>
                    <span className="text-[10px] text-gray-400 mt-1">دقة حتى خانة عشرية واحدة (0.5)</span>
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
                      المهام الإضافية قيد الربط مع سجل مكافآت YT Coin الرسمي.
                    </p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 text-center shrink-0">
                    <span className="text-xs text-gray-300 block">مكافآت متاحة للاستلام</span>
                    <span className="text-xl font-black text-amber-400 font-mono">
                      غير مفعّلة
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tasks.map((task) => {
                    const pct = task.target ? Math.min(100, Math.round((currentStreakDays / task.target) * 100)) : 100;
                    return (
                      <div
                        key={task.id}
                        className="rounded-2xl bg-[#131822] border border-white/10 p-4 flex items-center justify-between gap-3 hover:border-amber-500/30 transition-all"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
                            {task.id === 1 && <Calendar className="w-5 h-5" />}
                            {task.id === 2 && <Flame className="w-5 h-5" />}
                            {task.id === 3 && <Wallet className="w-5 h-5" />}
                            {task.id === 4 && <Users className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-white truncate">{task.title}</h4>
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.desc}</p>
                            <span className="inline-block mt-1.5 text-xs font-extrabold text-amber-400 font-mono">
                              +{formatYt(task.reward)} YT
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
                                {Math.min(currentStreakDays, task.target ?? 20)} / {task.target}
                              </span>
                              <div className="w-20 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                                <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleClaimTask(task.id)}
                              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 font-black text-xs transition-all cursor-pointer"
                            >
                              التفاصيل
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ======================================================================== */}
            {/* 3. تبويب المحفظة الرقمية الاحترافية (CRYPTO WALLET)                      */}
            {/* ======================================================================== */}
            {activeTab === 'wallet' && (
              <section className="space-y-5">
                {/* Wallet Top Header Bar */}
                <div className="rounded-2xl bg-[#101521] border border-amber-500/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-center gap-3">
                    <YtCoinLogo size="md" className="ring-amber-400/80" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm sm:text-base font-black text-white tracking-wide">
                          محفظة YT Coin
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          YT Mainnet
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 font-mono block" dir="ltr">
                        {shortWalletAddress}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      متصل
                    </span>
                    <button
                      type="button"
                      onClick={() => (user ? setShowReceiveModal(true) : openAuthModal('login'))}
                      title="عرض رمز الاستلام QR"
                      className="p-2 rounded-xl bg-white/5 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/35 text-gray-200 hover:text-amber-400 transition-colors cursor-pointer"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Main Crypto Balance Vault Card */}
                <div className="rounded-3xl bg-gradient-to-br from-[#192235] via-[#101625] to-[#090D16] border border-amber-500/35 p-5 sm:p-7 shadow-2xl relative overflow-hidden">
                  <div className="absolute -top-20 -left-20 w-56 h-56 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-24 right-10 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                  <div className="relative flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    {/* Available Balance & Core Metrics */}
                    <div className="space-y-4 flex-1">
                      <div>
                        <span className="text-xs font-bold text-gray-400 block mb-1.5">
                          إجمالي الرصيد المتاح
                        </span>
                        <div className="flex items-baseline gap-3">
                          <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight font-mono">
                            {formatYt(effectiveBalance)}
                          </h2>
                          <span className="text-base sm:text-lg font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-xl">
                            YT
                          </span>
                        </div>
                      </div>

                      {/* Portfolio Sub-Stats */}
                      <div className="grid grid-cols-3 gap-2.5 max-w-lg">
                        <div className="rounded-2xl bg-[#0B101A]/85 border border-white/10 px-3 py-2.5">
                          <span className="text-[10px] sm:text-[11px] text-gray-400 block">إجمالي التعدين</span>
                          <strong className="text-xs sm:text-sm font-black text-emerald-400 font-mono mt-0.5 block">
                            {formatYt(summary?.totalMinedYt ?? 0)} YT
                          </strong>
                        </div>
                        <div className="rounded-2xl bg-[#0B101A]/85 border border-white/10 px-3 py-2.5">
                          <span className="text-[10px] sm:text-[11px] text-gray-400 block">مكافأة اليوم</span>
                          <strong className="text-xs sm:text-sm font-black text-amber-400 font-mono mt-0.5 block">
                            +{formatYt(effectiveClaimReward)} YT
                          </strong>
                        </div>
                        <div className="rounded-2xl bg-[#0B101A]/85 border border-white/10 px-3 py-2.5">
                          <span className="text-[10px] sm:text-[11px] text-gray-400 block">السلسلة</span>
                          <strong className="text-xs sm:text-sm font-black text-white font-mono mt-0.5 block">
                            {formatInt(currentStreakDays)} يوم
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Wallet Address Box */}
                    <div className="bg-[#080C14]/90 border border-amber-500/25 rounded-2xl p-4 lg:w-80 xl:w-96 w-full space-y-2.5 shrink-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-300">عنوان المحفظة</span>
                        <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/25">
                          YT-20
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 bg-[#0F1522] px-3 py-2.5 rounded-xl border border-white/10">
                        <code className="text-xs text-amber-300 font-mono truncate" dir="ltr">
                          {walletAddress}
                        </code>
                        <button
                          type="button"
                          onClick={copyWalletAddress}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition-colors shrink-0 cursor-pointer"
                        >
                          {copiedAddress ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedAddress ? 'تم النسخ' : 'نسخ'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Primary Working Wallet Actions */}
                  <div className="relative grid grid-cols-3 gap-2.5 sm:gap-3 mt-6 pt-5 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => (user ? setShowReceiveModal(true) : openAuthModal('login'))}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3.5 px-3 rounded-2xl bg-gradient-to-l from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-[#0B0E14] font-black text-xs sm:text-sm transition-all active:scale-95 shadow-lg shadow-amber-500/20 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4 shrink-0" />
                      <span>استلام / QR</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!user) {
                          openAuthModal('login');
                        } else if (summary?.canClaim) {
                          void handleClaim();
                        } else {
                          setActiveTab('home');
                        }
                      }}
                      disabled={claiming}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3.5 px-3 rounded-2xl bg-[#192236] hover:bg-[#222E47] text-white border border-amber-500/30 font-extrabold text-xs sm:text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-60"
                    >
                      <Gem className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>{summary?.canClaim ? 'مطالبة اليوم' : 'التعدين'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleRefreshData()}
                      disabled={loading}
                      className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3.5 px-3 rounded-2xl bg-[#192236] hover:bg-[#222E47] text-white border border-white/10 font-extrabold text-xs sm:text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 text-emerald-400 shrink-0 ${isRefreshingSpin || loading ? 'animate-spin' : ''}`} />
                      <span>تحديث الرصيد</span>
                    </button>
                  </div>
                </div>

                {/* Assets Portfolio */}
                <div className="rounded-3xl bg-[#111622] border border-white/10 p-5">
                  <div className="flex items-center justify-between mb-3.5">
                    <h3 className="text-sm font-extrabold text-gray-200 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-amber-400" />
                      <span>الأصول الرقمية</span>
                    </h3>
                    <span className="text-[11px] font-bold text-gray-400 bg-white/5 px-2.5 py-0.5 rounded-full">
                      1 أصل
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-2xl bg-[#0A0E17] border border-amber-500/25">
                    <div className="flex items-center gap-3.5">
                      <YtCoinLogo size="md" className="ring-amber-400" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm sm:text-base text-white">YT Coin</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 font-bold border border-amber-500/25">
                            YT Mainnet
                          </span>
                        </div>
                        <span className="text-xs text-gray-400 block mt-0.5">عملة التعدين والمكافآت الرقمية</span>
                      </div>
                    </div>
                    <div className="text-left">
                      <span className="block font-black text-base sm:text-lg text-white font-mono">
                        {formatYt(effectiveBalance)} YT
                      </span>
                      <span className="block text-[11px] text-emerald-400 font-mono">
                        المكتسب: {formatYt(summary?.totalMinedYt ?? 0)} YT
                      </span>
                    </div>
                  </div>
                </div>

                {/* Transactions Ledger */}
                <div className="rounded-3xl bg-[#111622] border border-white/10 p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                      <History className="w-5 h-5 text-amber-400" />
                      <span>سجل المعاملات</span>
                    </h3>
                    <span className="text-xs text-gray-300 bg-white/5 px-3 py-1 rounded-full font-mono">
                      {combinedTransactions.length} عملية
                    </span>
                  </div>

                  {combinedTransactions.length === 0 ? (
                    <div className="rounded-2xl bg-[#0A0E17] border border-white/5 py-10 px-4 text-center space-y-2">
                      <Coins className="w-8 h-8 text-amber-400/60 mx-auto" />
                      <p className="text-sm font-bold text-gray-300">لا توجد معاملات مسجلة بعد</p>
                      <p className="text-xs text-gray-500">
                        ستظهر هنا جميع إيداعات التعدين اليومي فور استلام أول مكافأة.
                      </p>
                    </div>
                  ) : (
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
                            className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0A0E17] border border-white/5 hover:border-white/10 transition-colors"
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
                                {tx.type === 'task' ? (
                                  <Award className="w-4 h-4" />
                                ) : (
                                  <Coins className="w-4 h-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-xs sm:text-sm font-bold text-gray-200 truncate">{tx.label}</h5>
                                <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                                  <span>{tx.createdAt ? formatDateTime(tx.createdAt) : tx.claimDate || 'الآن'}</span>
                                  <span>•</span>
                                  <span className="font-mono text-amber-400/80 flex items-center gap-0.5" dir="ltr">
                                    {tx.txHash || tx.reference || tx.id}
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div
                              className={`text-left font-black text-xs sm:text-sm font-mono shrink-0 ${amountColor}`}
                              dir="ltr"
                            >
                              {prefix}
                              {formatYt(val)} YT
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ========================================== */}
            {/* 4. تبويب لوحتي والإحصائيات (DASHBOARD TAB)  */}
            {/* ========================================== */}
            {activeTab === 'dashboard' && (
              <section className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-2xl bg-[#131822] border border-amber-500/20 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>إجمالي المعروض المعتمد</span>
                      <Coins className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">1,000,000,000</div>
                    <div className="text-[11px] text-amber-400 mt-1">سقف ثابت: 1 مليار YT Coin</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>إجمالي العملات المعدّنة</span>
                      <Hammer className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-xl font-black text-emerald-400 font-mono">
                      {formatYt(summary?.poolDistributedYt ?? 0)}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">توزيع مستمر من السقف الكلي</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>السقف التصاعدي لليوم</span>
                      <TrendingUp className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">{formatYt(effectiveDailyCap)}</div>
                    <div className="text-[11px] text-emerald-400 mt-1">دقة التعدين: حتى 0.5 YT</div>
                  </div>

                  <div className="rounded-2xl bg-[#131822] border border-white/5 p-4">
                    <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                      <span>إجمالي ما عدّنته شخصياً</span>
                      <Users className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="text-xl font-black text-white font-mono">
                      {formatYt(summary?.totalMinedYt ?? 0)}
                    </div>
                    <div className="text-[11px] text-sky-400 mt-1">
                      سلسلة الالتزام: {formatInt(summary?.streakDays ?? 0)} يوم
                    </div>
                  </div>
                </div>

                {/* Visual Growth Chart */}
                <div className="rounded-3xl bg-[#131822] border border-amber-500/20 p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                    <div>
                      <h3 className="text-base sm:text-lg font-extrabold text-white">
                        منحنى السقف التصاعدي اليومي للتعدين
                      </h3>
                      <p className="text-xs text-gray-400">
                        تطور سقف التعدين اليومي وفق إعدادات Supabase
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
                  <h3 className="text-base font-extrabold text-white mb-4">توزيع المعروض المعتمد (Tokenomics)</h3>
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

            {/* ================================================== */}
            {/* 5. تبويب الإدارة والإعدادات (ADMIN-ONLY TAB)       */}
            {/* ================================================== */}
            {activeTab === 'admin' && isAdmin && (
              <section className="space-y-5">
                {/* Live Admin KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-2xl bg-[#131822] border border-amber-500/25 p-4">
                    <span className="text-[11px] text-gray-400 block">رصيد خزينة التعدين</span>
                    <strong className="text-lg sm:text-xl font-black text-amber-400 font-mono mt-1 block">
                      {adminLoading && !adminSummary
                        ? '...'
                        : `${formatYt((Number(adminSummary?.rewards_treasury_balance_units ?? 0)) / 2)} YT`}
                    </strong>
                  </div>
                  <div className="rounded-2xl bg-[#131822] border border-emerald-500/25 p-4">
                    <span className="text-[11px] text-gray-400 block">إجمالي المُعدَّن فعلياً</span>
                    <strong className="text-lg sm:text-xl font-black text-emerald-400 font-mono mt-1 block">
                      {adminLoading && !adminSummary
                        ? '...'
                        : `${formatYt((Number(adminSummary?.total_mined_units ?? 0)) / 2)} YT`}
                    </strong>
                  </div>
                  <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                    <span className="text-[11px] text-gray-400 block">مُعدَّن اليوم</span>
                    <strong className="text-lg sm:text-xl font-black text-white font-mono mt-1 block">
                      {adminLoading && !adminSummary
                        ? '...'
                        : `${formatYt((Number(adminSummary?.today_mined_units ?? 0)) / 2)} YT`}
                    </strong>
                  </div>
                  <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                    <span className="text-[11px] text-gray-400 block">المعدّنون / المطالبات</span>
                    <strong className="text-lg sm:text-xl font-black text-sky-400 font-mono mt-1 block">
                      {adminLoading && !adminSummary
                        ? '...'
                        : `${formatInt(adminSummary?.active_miners_count)} / ${formatInt(adminSummary?.total_claims)}`}
                    </strong>
                  </div>
                </div>

                {/* Admin Configuration Form (0.5-YT decimal support) */}
                <form
                  onSubmit={(e) => void handleSaveAdminSettings(e)}
                  className="rounded-3xl bg-[#131822] border border-amber-500/25 p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                        <Sliders className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-lg sm:text-xl font-black text-white">لوحة تحكم الإدارة (للمدير فقط)</h2>
                        <p className="text-xs text-gray-400">
                          إدارة قواعد التعدين والسقف اليومي بدقة حتى خانة عشرية واحدة (مضاعفات 0.5 YT).
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void loadAdminData()}
                      disabled={adminLoading}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-amber-400 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${adminLoading ? 'animate-spin' : ''}`} />
                      <span>تحديث المؤشرات</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-2">
                      <label className="text-xs font-bold text-gray-300 block">
                        مكافأة اليوم الأول (YT — خانة عشرية واحدة مثل 0.5)
                      </label>
                      <input
                        name="baseRewardYt"
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={adminBaseRewardYt}
                        onChange={(e) => setAdminBaseRewardYt(e.target.value)}
                        className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-2">
                      <label className="text-xs font-bold text-gray-300 block">
                        الزيادة التراكمية لكل يوم متتالٍ (YT — مثل 0.5)
                      </label>
                      <input
                        name="dailyIncrementYt"
                        type="number"
                        min={0}
                        step={0.5}
                        value={adminDailyIncrementYt}
                        onChange={(e) => setAdminDailyIncrementYt(e.target.value)}
                        className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-2">
                      <label className="text-xs font-bold text-gray-300 block">
                        مكافأة اليوم 20 وما بعده يومياً (YT)
                      </label>
                      <input
                        name="maxDailyRewardYt"
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={adminMaxDailyRewardYt}
                        onChange={(e) => setAdminMaxDailyRewardYt(e.target.value)}
                        className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-2">
                      <label className="text-xs font-bold text-gray-300 block">
                        السقف اليومي الابتدائي للمنصة (YT)
                      </label>
                      <input
                        name="dailyCapStartYt"
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={adminDailyCapStartYt}
                        onChange={(e) => setAdminDailyCapStartYt(e.target.value)}
                        className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 space-y-2">
                      <label className="text-xs font-bold text-gray-300 block">
                        الحد الأقصى للسقف اليومي للمنصة (YT)
                      </label>
                      <input
                        name="dailyCapMaxYt"
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={adminDailyCapMaxYt}
                        onChange={(e) => setAdminDailyCapMaxYt(e.target.value)}
                        className="w-full bg-[#161C28] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-[#0D1119] border border-white/10 flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold text-gray-200 block">حالة التعدين في المنصة</span>
                        <span className="text-[11px] text-gray-400">تفعيل أو إيقاف مطالبات التعدين فوراً</span>
                      </div>
                      <button
                        type="button"
                        disabled={savingAdminConfig}
                        onClick={() => void handleToggleMiningEnabled()}
                        className={`px-4 py-2 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-60 ${
                          adminMiningEnabled
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        }`}
                      >
                        {adminMiningEnabled ? 'نشط (Active)' : 'متوقف (Paused)'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 pt-5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 font-bold text-xs transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إعادة القيم الافتراضية</span>
                    </button>

                    <button
                      type="submit"
                      disabled={savingAdminConfig}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] font-black text-xs sm:text-sm shadow-lg cursor-pointer disabled:opacity-60"
                    >
                      {savingAdminConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>حفظ الإعدادات في قاعدة البيانات</span>
                    </button>
                  </div>
                </form>

                {/* Recent Claims Table for Admin */}
                {Array.isArray(adminSummary?.recent_claims) && adminSummary.recent_claims.length > 0 && (
                  <div className="rounded-3xl bg-[#131822] border border-white/10 p-5 overflow-hidden">
                    <h3 className="text-sm font-extrabold text-white mb-3 flex items-center gap-2">
                      <History className="w-4 h-4 text-amber-400" />
                      <span>أحدث مطالبات التعدين للمستخدمين</span>
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="text-gray-400 border-b border-white/10">
                          <tr>
                            <th className="py-2 px-3">المستخدم</th>
                            <th className="py-2 px-3">اليوم المتتالي</th>
                            <th className="py-2 px-3">المكافأة</th>
                            <th className="py-2 px-3">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {adminSummary.recent_claims.slice(0, 15).map((claim: any) => (
                            <tr key={String(claim.id)}>
                              <td className="py-2.5 px-3 font-bold text-gray-200">
                                {claim.full_name || String(claim.user_id || '').slice(0, 8)}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-sky-400">اليوم {claim.streak_day ?? 1}</td>
                              <td className="py-2.5 px-3 font-mono font-black text-amber-400">
                                +{formatYt(Number(claim.amount_units ?? claim.reward_units ?? 0) / 2)} YT
                              </td>
                              <td className="py-2.5 px-3 text-gray-400">{formatDateTime(claim.created_at || claim.claim_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>

        {/* ==================== MOBILE BOTTOM NAVIGATION BAR ==================== */}
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

          {isAdmin && (
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
          )}
        </nav>
      </div>

      {/* ==================== WALLET & SYSTEM MODALS ==================== */}
      {/* Receive QR Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121826] border border-amber-500/35 rounded-3xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
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
            <div className="w-44 h-44 mx-auto bg-white p-3 rounded-2xl flex items-center justify-center shadow-lg">
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
            <p className="text-xs text-gray-400">
              عنوان محفظة <strong>YT Coin</strong> على شبكة <strong>YT Mainnet</strong>:
            </p>
            <div
              className="bg-[#0A0E17] p-3 rounded-xl border border-white/10 font-mono text-xs text-amber-400 break-all"
              dir="ltr"
            >
              {walletAddress}
            </div>
            <button
              type="button"
              onClick={() => {
                copyWalletAddress();
                setShowReceiveModal(false);
              }}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-sm cursor-pointer"
            >
              نسخ عنوان المحفظة
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
            <h3 className="text-lg font-black text-white">استعادة القيم الافتراضية للحقول؟</h3>
            <p className="text-xs text-gray-400">سيتم إرجاع قيم الحقول إلى الافتراضي (0.5 YT ثم 20 YT في اليوم 20) دون المساس بأي أرصدة محفوظة.</p>
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
