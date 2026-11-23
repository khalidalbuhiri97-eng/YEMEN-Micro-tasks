import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Users,
  Activity,
  Vault,
  TrendingUp,
  Layers,
  Clock,
  ShieldCheck,
  Lock,
  Unlock,
  CheckCircle2,
  Sliders,
  Tv,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  Wallet,
  Search,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  formatPartsLabel,
  formatYt,
  unitsToYt,
  ytToUnitsStrict,
  YT_MAX_SUPPLY_YT,
  YT_SUBUNITS_PER_YT,
} from '../../../shared/ytCoin.ts';

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

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

function formatNum(value: number | null, maxDecimals = 3): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return formatYt(value, maxDecimals);
}

function pickYtUnits(
  sources: Array<Record<string, any> | null>,
  ytKeys: string[],
  unitKeys: string[],
  unitScale = YT_SUBUNITS_PER_YT
): number | null {
  const direct = pickNumber(sources, ytKeys);
  if (direct !== null) return direct;
  const units = pickNumber(sources, unitKeys);
  return units === null ? null : units / unitScale;
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

const METRIC_LABELS: Record<string, string> = {
  economy_version: 'إصدار اقتصاد العملة',
  unit_scale: 'مقياس الأجزاء (1 YT = جزء)',
  max_supply_yt: 'سقف الإصدار النهائي (YT)',
  rewards_treasury_allocated_yt: 'إجمالي مخصص مكافآت المستخدمين (YT)',
  rewards_treasury_balance_yt: 'المتبقي من مخصص مكافآت المستخدمين (YT)',
  circulating_supply_yt: 'المتداول الفعلي الموزّع (YT)',
  total_mined_yt: 'إجمالي المقيد بالمكافآت (YT)',
  today_mined_yt: 'مُعدَّن اليوم (YT)',
  active_miners_count: 'إجمالي حسابات YT Coin',
  pending_audit_accounts: 'حسابات قديمة بانتظار التدقيق',
  today_claims_count: 'مطالبات الدخول اليوم',
  today_taps_count: 'نقرات اليوم',
  today_ads_count: 'أحداث الإعلانات المؤكدة اليوم',
  base_reward_yt: 'مكافأة الدخول اليومي (YT)',
  tap_reward_yt: 'مكافأة النقر (YT)',
  ad_click_reward_yt: 'مكافأة النقرة الإعلانية (YT)',
  ad_view_reward_yt: 'مكافأة مشاهدة الإعلان (YT)',
  daily_tap_limit: 'الحد اليومي للنقرات',
  daily_ad_limit: 'الحد اليومي للإعلانات',
  daily_cap_start_yt: 'السقف اليومي الابتدائي (YT)',
  daily_cap_max_yt: 'الحد الأقصى للسقف اليومي (YT)',
  exchange_rate_yer_per_yt: 'السعر المرجعي (ر.ي / YT)',
  mining_enabled: 'حالة منظومة التعدين',
  swap_enabled: 'التبديل المباشر مع يمن تاسك',
  updated_at: 'آخر تحديث',
};

const EMPTY_NETWORK_FORM = {
  id: '' as string,
  networkKey: '',
  displayName: '',
  description: '',
  authMode: 'hmac_sha256' as 'hmac_sha256' | 'shared_secret',
  secretEnvKey: 'YT_COIN_AD_POSTBACK_SECRET',
  placementUrl: '',
  adType: 'both' as 'view' | 'click' | 'both',
  rewardClickYt: '0.01',
  rewardViewYt: '0.01',
  dailyUserLimit: '20',
  isActive: true,
};

export const YtCoinAdminView: React.FC = () => {
  const { showToast } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Admin Economy Config Form State (populated live from server)
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [cfgMiningEnabled, setCfgMiningEnabled] = useState<boolean>(true);
  const [cfgMaxSupplyYt, setCfgMaxSupplyYt] = useState<string>('');
  const [cfgBaseRewardYt, setCfgBaseRewardYt] = useState<string>('');
  const [cfgTapRewardYt, setCfgTapRewardYt] = useState<string>('');
  const [cfgAdClickRewardYt, setCfgAdClickRewardYt] = useState<string>('');
  const [cfgAdViewRewardYt, setCfgAdViewRewardYt] = useState<string>('');
  const [cfgDailyTapLimit, setCfgDailyTapLimit] = useState<string>('');
  const [cfgDailyAdLimit, setCfgDailyAdLimit] = useState<string>('');
  const [cfgDailyCapStartYt, setCfgDailyCapStartYt] = useState<string>('');
  const [cfgDailyCapMaxYt, setCfgDailyCapMaxYt] = useState<string>('');
  const [cfgExchangeRateYerPerYt, setCfgExchangeRateYerPerYt] = useState<string>('');

  // Editable Treasury Allocations State
  const [editingTreasury, setEditingTreasury] = useState<{
    treasuryKey: string;
    labelAr: string;
    allocatedYt: string;
    distributedYt: number;
    isLocked: boolean;
    approvedForDistribution: boolean;
  } | null>(null);
  const [savingTreasury, setSavingTreasury] = useState<boolean>(false);

  // User YT Coin Wallets Management State
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false);
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [editingWallet, setEditingWallet] = useState<{
    userId: string;
    fullName: string;
    walletAddress: string;
    currentBalanceYt: number;
    newBalanceYt: string;
    reason: string;
    clearPendingAudit: boolean;
  } | null>(null);
  const [savingWallet, setSavingWallet] = useState<boolean>(false);

  // Ad Networks Management State
  const [showNetworkForm, setShowNetworkForm] = useState<boolean>(false);
  const [networkForm, setNetworkForm] = useState({ ...EMPTY_NETWORK_FORM });
  const [savingNetwork, setSavingNetwork] = useState<boolean>(false);
  const [deletingNetworkId, setDeletingNetworkId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Double-entry Journal Integrity Verification State
  const [integrity, setIntegrity] = useState<any>(null);
  const [integrityLoading, setIntegrityLoading] = useState<boolean>(false);
  const [integrityMigrationRequired, setIntegrityMigrationRequired] = useState<boolean>(false);
  const [integrityMessage, setIntegrityMessage] = useState<string | null>(null);

  const loadAccounts = useCallback(async (search = '') => {
    setAccountsLoading(true);
    try {
      const res = await api.getAdminYtCoinAccounts(search, 30);
      if (Array.isArray(res?.accounts)) {
        setAccounts(res.accounts);
      }
    } catch {
      // Fallback gracefully if summary.accounts already provided
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminYtCoinSummary();
      const s = res?.summary ?? null;
      setSummary(s);
      if (s && typeof s === 'object') {
        const scale = Number(s.unit_scale) > 0 ? Number(s.unit_scale) : YT_SUBUNITS_PER_YT;
        if (typeof s.mining_enabled === 'boolean') setCfgMiningEnabled(s.mining_enabled);

        const toInputStr = (directVal: unknown, unitVal: unknown): string => {
          if (directVal !== undefined && directVal !== null && directVal !== '') {
            const n = Number(directVal);
            if (Number.isFinite(n)) return formatYt(n).replace(/,/g, '');
          }
          if (unitVal !== undefined && unitVal !== null && unitVal !== '') {
            const u = Number(unitVal);
            if (Number.isFinite(u)) return formatYt(u / scale).replace(/,/g, '');
          }
          return '';
        };

        setCfgMaxSupplyYt(toInputStr(s.max_supply_yt, s.max_supply_units));
        setCfgBaseRewardYt(toInputStr(s.base_reward_yt, s.base_reward_units));
        setCfgTapRewardYt(toInputStr(s.tap_reward_yt, s.tap_reward_units));
        setCfgAdClickRewardYt(toInputStr(s.ad_click_reward_yt, s.ad_click_reward_units));
        setCfgAdViewRewardYt(toInputStr(s.ad_view_reward_yt, s.ad_view_reward_units));
        setCfgDailyCapStartYt(toInputStr(s.daily_cap_start_yt, s.daily_cap_start_units));
        setCfgDailyCapMaxYt(toInputStr(s.daily_cap_max_yt, s.daily_cap_max_units));

        if (s.daily_tap_limit !== undefined && s.daily_tap_limit !== null) {
          setCfgDailyTapLimit(String(Math.max(0, Math.floor(Number(s.daily_tap_limit) || 0))));
        }
        if (s.daily_ad_limit !== undefined && s.daily_ad_limit !== null) {
          setCfgDailyAdLimit(String(Math.max(0, Math.floor(Number(s.daily_ad_limit) || 0))));
        }
        if (s.exchange_rate_yer_per_yt !== undefined && s.exchange_rate_yer_per_yt !== null) {
          setCfgExchangeRateYerPerYt(String(Number(s.exchange_rate_yer_per_yt)));
        }
        if (Array.isArray(s.accounts)) {
          setAccounts(s.accounts);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل مؤشرات خزينة وتعدين YT Coin.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIntegrity = useCallback(async () => {
    setIntegrityLoading(true);
    try {
      const res = await api.getAdminYtCoinIntegrity();
      setIntegrity(res?.integrity ?? null);
      setIntegrityMigrationRequired(Boolean(res?.migrationRequired));
      setIntegrityMessage(res?.message || null);
    } catch (err: any) {
      setIntegrityMessage(err?.message || 'تعذر فحص توازن القيود.');
    } finally {
      setIntegrityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadAccounts('');
    void loadIntegrity();
  }, [loadSummary, loadAccounts, loadIntegrity]);

  const parsed = useMemo(() => {
    const root = asRecord(summary);
    if (!root) return null;

    const unitScale = pickNumber([root], ['unit_scale', 'unitScale']) ?? YT_SUBUNITS_PER_YT;

    const treasuries = pickArray([root], ['treasuries']).filter((r) => asRecord(r) !== null);
    const userRewardsRow = treasuries.find((t: any) => t?.treasury_key === 'YT-USER-REWARDS') || null;

    const rewardsPoolRemainingYt = pickYtUnits(
      [root, userRewardsRow],
      ['rewards_treasury_balance_yt', 'pool_remaining_yt', 'balance_yt'],
      ['rewards_treasury_balance_units', 'pool_remaining_units', 'balance_units'],
      unitScale
    );
    const rewardsAllocatedYt =
      pickYtUnits(
        [root, userRewardsRow],
        ['rewards_treasury_allocated_yt', 'allocated_yt'],
        ['rewards_treasury_allocated_units', 'allocated_units'],
        unitScale
      ) ?? 0;

    const circulatingSupplyYt = pickYtUnits(
      [root],
      ['circulating_supply_yt', 'total_mined_yt'],
      ['circulating_supply_units', 'total_mined_units'],
      unitScale
    );
    const maxSupplyYt = pickYtUnits([root], ['max_supply_yt'], ['max_supply_units'], unitScale) ?? YT_MAX_SUPPLY_YT;
    const todayMinedYt = pickYtUnits([root], ['today_mined_yt'], ['today_mined_units'], unitScale);

    const activeMiners = pickNumber([root], ['active_miners_count']);
    const pendingAuditAccounts = pickNumber([root], ['pending_audit_accounts']) ?? 0;
    const claimsToday = pickNumber([root], ['today_claims_count']);
    const tapsToday = pickNumber([root], ['today_taps_count']);
    const adsToday = pickNumber([root], ['today_ads_count']);
    const updatedAt = pickString([root], ['updated_at']);

    const adNetworks = pickArray([root], ['ad_networks']).filter((r) => asRecord(r) !== null);
    const recentClaims = pickArray([root], ['recent_claims']).filter((r) => asRecord(r) !== null);
    const recentAdEvents = pickArray([root], ['recent_ad_events']).filter((r) => asRecord(r) !== null);

    const totalTreasuryAllocatedYt = treasuries.reduce((acc, t: any) => {
      const val =
        t?.allocated_yt !== undefined && t?.allocated_yt !== null
          ? Number(t.allocated_yt)
          : Number(t?.allocated_units ?? 0) / unitScale;
      return acc + (Number.isFinite(val) ? val : 0);
    }, 0);

    const scalarEntries: Array<{ key: string; label: string; value: string }> = [];
    for (const [k, v] of Object.entries(root)) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      let displayVal = String(v);
      let displayLabel = METRIC_LABELS[k] || k;
      if (typeof v === 'boolean') displayVal = v ? 'نعم' : 'لا';
      else if (typeof v === 'number' && (k.endsWith('_units') || k.endsWith('Units'))) {
        displayVal = `${formatYt(v / unitScale)} YT (${v.toLocaleString('en-US')} جزء)`;
        displayLabel = METRIC_LABELS[k.replace(/_units$|Units$/, '_yt')] || k;
      } else if (typeof v === 'number') {
        displayVal = k === 'unit_scale' ? v.toLocaleString('en-US') : formatYt(v);
      } else if (k.endsWith('_at')) {
        displayVal = formatDateTime(v);
      }
      scalarEntries.push({ key: k, label: displayLabel, value: displayVal });
    }

    const rewardsDistributedYt =
      rewardsPoolRemainingYt !== null && rewardsAllocatedYt > 0
        ? Math.max(0, rewardsAllocatedYt - rewardsPoolRemainingYt)
        : null;
    const poolPct =
      rewardsDistributedYt !== null && rewardsAllocatedYt > 0
        ? Math.min(100, Math.max(0, (rewardsDistributedYt / rewardsAllocatedYt) * 100))
        : null;
    const rewardsSharePct = maxSupplyYt > 0 ? (rewardsAllocatedYt / maxSupplyYt) * 100 : 0;

    return {
      unitScale,
      rewardsPoolRemainingYt,
      rewardsAllocatedYt,
      rewardsSharePct,
      circulatingSupplyYt,
      maxSupplyYt,
      totalTreasuryAllocatedYt,
      todayMinedYt,
      activeMiners,
      pendingAuditAccounts,
      claimsToday,
      tapsToday,
      adsToday,
      updatedAt,
      treasuries,
      adNetworks,
      recentClaims,
      recentAdEvents,
      scalarEntries,
      poolPct,
    };
  }, [summary]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingConfig) return;
    try {
      const serverMaxSupplyUnits = parsed
        ? Math.round(parsed.maxSupplyYt * YT_SUBUNITS_PER_YT)
        : null;

      const maxSupplyUnits = ytToUnitsStrict(cfgMaxSupplyYt, {
        fieldLabel: 'سقف الإصدار الكلي',
        minUnits: 1000,
        maxUnits: Number.MAX_SAFE_INTEGER,
      });
      const baseUnits = ytToUnitsStrict(cfgBaseRewardYt, { fieldLabel: 'مكافأة الدخول اليومي', minUnits: 1 });
      const tapUnits = ytToUnitsStrict(cfgTapRewardYt, { fieldLabel: 'مكافأة النقر', minUnits: 1 });
      const clickUnits = ytToUnitsStrict(cfgAdClickRewardYt, { fieldLabel: 'مكافأة النقرة الإعلانية', minUnits: 1 });
      const viewUnits = ytToUnitsStrict(cfgAdViewRewardYt, { fieldLabel: 'مكافأة مشاهدة الإعلان', minUnits: 1 });
      const dailyCapStartUnits = ytToUnitsStrict(cfgDailyCapStartYt, {
        fieldLabel: 'السقف اليومي الابتدائي',
        minUnits: 1,
        maxUnits: Number.MAX_SAFE_INTEGER,
      });
      const dailyCapMaxUnits = ytToUnitsStrict(cfgDailyCapMaxYt, {
        fieldLabel: 'الحد الأقصى للسقف اليومي',
        minUnits: 1,
        maxUnits: Number.MAX_SAFE_INTEGER,
      });
      const dailyTapLimit = Math.max(0, Math.floor(Number(cfgDailyTapLimit) || 0));
      const dailyAdLimit = Math.max(0, Math.floor(Number(cfgDailyAdLimit) || 0));
      const exchangeRate = Number(cfgExchangeRateYerPerYt);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        throw new Error('قيمة السعر المرجعي يجب أن تكون أكبر من صفر.');
      }

      setSavingConfig(true);
      await api.updateAdminYtCoinConfig({
        miningEnabled: cfgMiningEnabled,
        ...(serverMaxSupplyUnits !== maxSupplyUnits ? { maxSupplyYt: unitsToYt(maxSupplyUnits) } : {}),
        baseRewardYt: unitsToYt(baseUnits),
        tapRewardYt: unitsToYt(tapUnits),
        adClickRewardYt: unitsToYt(clickUnits),
        adViewRewardYt: unitsToYt(viewUnits),
        dailyTapLimit,
        dailyAdLimit,
        dailyCapStartYt: unitsToYt(dailyCapStartUnits),
        dailyCapMaxYt: unitsToYt(dailyCapMaxUnits),
        exchangeRateYerPerYt: exchangeRate,
      });
      showToast('تم حفظ وتخزين جميع إعدادات ومعدلات YT Coin على الخادم بنجاح.', 'success');
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ الإعدادات على الخادم.', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveTreasury = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTreasury || savingTreasury) return;
    try {
      const allocatedUnits = ytToUnitsStrict(editingTreasury.allocatedYt, {
        allowZero: true,
        fieldLabel: 'المخصص الكلي (YT)',
        minUnits: 0,
        maxUnits: Number.MAX_SAFE_INTEGER,
      });
      setSavingTreasury(true);
      await api.updateAdminYtCoinTreasury(editingTreasury.treasuryKey, {
        labelAr: editingTreasury.labelAr.trim(),
        allocatedYt: unitsToYt(allocatedUnits),
        isLocked: editingTreasury.isLocked,
        approvedForDistribution: editingTreasury.approvedForDistribution,
      });
      showToast('تم تعديل وتخزين بيانات المخصص في الخادم بنجاح.', 'success');
      setEditingTreasury(null);
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ تعديل الخزينة.', 'error');
    } finally {
      setSavingTreasury(false);
    }
  };

  const handleSaveWalletAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWallet || savingWallet) return;
    try {
      const newBalanceUnits = ytToUnitsStrict(editingWallet.newBalanceYt, {
        allowZero: true,
        fieldLabel: 'الرصيد الجديد (YT)',
        minUnits: 0,
        maxUnits: Number.MAX_SAFE_INTEGER,
      });
      setSavingWallet(true);
      await api.adjustAdminYtCoinWallet({
        userId: editingWallet.userId,
        newBalanceYt: unitsToYt(newBalanceUnits),
        reason: editingWallet.reason.trim() || undefined,
        clearPendingAudit: editingWallet.clearPendingAudit,
      });
      showToast('تم تعديل رصيد المحفظة وتوثيقه في الخادم بنجاح.', 'success');
      setEditingWallet(null);
      await Promise.all([loadSummary(), loadAccounts(accountSearch), loadIntegrity()]);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تعديل رصيد المحفظة.', 'error');
    } finally {
      setSavingWallet(false);
    }
  };

  const handleSaveAdNetwork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNetwork) return;
    try {
      const clickUnits = ytToUnitsStrict(networkForm.rewardClickYt, {
        fieldLabel: 'مكافأة النقرة للشبكة',
        minUnits: 1,
      });
      const viewUnits = ytToUnitsStrict(networkForm.rewardViewYt, {
        fieldLabel: 'مكافأة المشاهدة للشبكة',
        minUnits: 1,
      });
      setSavingNetwork(true);
      const res = await api.upsertAdminYtCoinAdNetwork({
        id: networkForm.id || null,
        networkKey: networkForm.networkKey.trim().toLowerCase(),
        displayName: networkForm.displayName.trim(),
        description: networkForm.description.trim() || null,
        authMode: networkForm.authMode,
        secretEnvKey: networkForm.secretEnvKey.trim() || 'YT_COIN_AD_POSTBACK_SECRET',
        placementUrl: networkForm.placementUrl.trim() || null,
        adType: networkForm.adType,
        rewardClickYt: unitsToYt(clickUnits),
        rewardViewYt: unitsToYt(viewUnits),
        dailyUserLimit: Math.max(0, Math.floor(Number(networkForm.dailyUserLimit) || 0)),
        isActive: networkForm.isActive,
      });
      showToast(
        res?.secretConfigured
          ? 'تم حفظ الشبكة الإعلانية وتفعيلها مع التحقق من وجود المفتاح بالخادم.'
          : 'تم حفظ الشبكة الإعلانية. تنبيه: متغير المفتاح السري غير مضبوط على الخادم بعد.',
        res?.secretConfigured ? 'success' : 'info'
      );
      setShowNetworkForm(false);
      setNetworkForm({ ...EMPTY_NETWORK_FORM });
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ الشبكة الإعلانية.', 'error');
    } finally {
      setSavingNetwork(false);
    }
  };

  const handleToggleNetworkActive = async (net: any) => {
    try {
      await api.upsertAdminYtCoinAdNetwork({
        id: net.id,
        networkKey: net.network_key,
        displayName: net.display_name,
        description: net.description || null,
        authMode: net.auth_mode === 'shared_secret' ? 'shared_secret' : 'hmac_sha256',
        secretEnvKey: net.secret_env_key || 'YT_COIN_AD_POSTBACK_SECRET',
        placementUrl: net.placement_url || null,
        adType: net.ad_type || 'both',
        rewardClickYt: Number(net.reward_click_yt ?? 0.01),
        rewardViewYt: Number(net.reward_view_yt ?? 0.01),
        dailyUserLimit: Number(net.daily_user_limit ?? 20),
        isActive: !net.is_active,
      });
      showToast(!net.is_active ? 'تم تفعيل الشبكة الإعلانية.' : 'تم تعطيل الشبكة الإعلانية.', 'success');
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث حالة الشبكة.', 'error');
    }
  };

  const handleDeleteNetwork = async (id: string) => {
    setDeletingNetworkId(id);
    try {
      const res = await api.deleteAdminYtCoinAdNetwork(id);
      showToast(res?.result?.message || 'تم حذف/تعطيل الشبكة الإعلانية بنجاح.', 'success');
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حذف الشبكة الإعلانية.', 'error');
    } finally {
      setDeletingNetworkId(null);
    }
  };

  const handleCopyPostbackUrl = (networkKey: string) => {
    const url = `${window.location.origin}/api/postbacks/yt-coin-ads/${networkKey}?user_id={user_id}&event_id={event_id}&event_type={event_type}&session_id={session_id}&signature={hmac}`;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url);
      setCopiedKey(networkKey);
      showToast('تم نسخ رابط الاستدعاء الخادمي (S2S Postback URL)', 'success');
      window.setTimeout(() => setCopiedKey(null), 2200);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-12 h-12 rounded-full aspect-square shrink-0 overflow-hidden bg-slate-950 ring-2 ring-amber-400/80 shadow-sm">
            <img src={YT_COIN_LOGO_SRC} alt="YT Coin" className="w-full h-full object-cover rounded-full" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
              <span>إدارة اقتصاد وخزينة ومحافظ YT Coin</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                BIGINT • 1 YT = {(parsed?.unitScale ?? YT_SUBUNITS_PER_YT).toLocaleString('en-US')} جزء • السقف {formatNum(parsed?.maxSupplyYt ?? null, 0)} YT
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              تعديل وحفظ جميع الأرقام والإعدادات وسقف الإصدار والتخصيصات وأرصدة المحافظ مباشرة في الخادم.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void Promise.all([loadSummary(), loadAccounts(accountSearch)])}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>تحديث من الخادم</span>
        </button>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-4 text-xs text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="rounded-lg bg-rose-600 text-white px-3 py-1.5 font-bold hover:bg-rose-700 cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {parsed && parsed.pendingAuditAccounts > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            يوجد <strong className="font-mono">{parsed.pendingAuditAccounts}</strong> حساباً بأرصدة قديمة بانتظار المطابقة (pending_audit) — يمكنك مراجعتها وتعديلها من جدول المحافظ أدناه.
          </span>
        </div>
      )}

      {/* Double-Entry Journal Balance Verification Panel */}
      <div
        className={`rounded-2xl border p-4 text-xs flex flex-wrap items-center justify-between gap-3 ${
          integrityMigrationRequired
            ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
            : integrity?.isBalanced
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-200'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
        }`}
      >
        <div className="space-y-1">
          <div className="font-extrabold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              فحص توازن قيود YT Coin (المدين = الدائن • 1 YT = 1,000 جزء)
            </span>
          </div>
          {integrityMigrationRequired ? (
            <p className="text-[11px]">{integrityMessage}</p>
          ) : integrity ? (
            <p className="text-[11px] font-mono">
              {integrity.isBalanced ? 'متوازن 100% ✓' : 'غير متوازن!'} • المعاملات:{' '}
              {Number(integrity.totalPostedJournalTx ?? 0).toLocaleString('en-US')} • المدين:{' '}
              {formatPartsLabel(integrity.totalDebitUnits ?? 0)} • الدائن:{' '}
              {formatPartsLabel(integrity.totalCreditUnits ?? 0)}
            </p>
            {integrity.adRewards && (
              <p className="text-[11px] font-mono mt-1">
                مكافآت الإعلانات — النقر: {Number(integrity.adRewards.click?.events ?? 0).toLocaleString('en-US')} حدث / {formatPartsLabel(integrity.adRewards.click?.rewardParts ?? 0)}،
                المشاهدة: {Number(integrity.adRewards.view?.events ?? 0).toLocaleString('en-US')} حدث / {formatPartsLabel(integrity.adRewards.view?.rewardParts ?? 0)}
              </p>
            )}
          ) : (
            <p className="text-[11px] text-slate-500">
              {integrityMessage || 'اضغط لفحص توازن قيود دفتر YT Coin في قاعدة البيانات.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadIntegrity()}
          disabled={integrityLoading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white px-3 py-1.5 font-bold cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${integrityLoading ? 'animate-spin' : ''}`} />
          <span>فحص التوازن الآن</span>
        </button>
      </div>

      {loading && !parsed ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
          ))}
        </div>
      ) : parsed ? (
        <>
          {/* Primary Live KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-400">
                <span>متبقي مخصص مكافآت المستخدمين</span>
                <Vault className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.rewardsPoolRemainingYt)}
                </strong>
                <span className="text-xs font-bold text-amber-600">YT</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                المخصص الحالي: {formatNum(parsed.rewardsAllocatedYt)} YT ({parsed.rewardsSharePct.toFixed(1)}%)
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/25 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <span>المتداول الفعلي الموزّع</span>
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.circulatingSupplyYt)}
                </strong>
                <span className="text-xs font-bold text-emerald-600">YT</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                مُعدَّن اليوم: {formatNum(parsed.todayMinedYt)} YT
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-blue-700 dark:text-blue-400">
                <span>الحسابات والنشاط اليوم</span>
                <Users className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.activeMiners, 0)}
                </strong>
                <span className="text-xs font-bold text-slate-500">محفظة</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                دخول: {parsed.claimsToday ?? 0} • نقر: {parsed.tapsToday ?? 0} • إعلانات: {parsed.adsToday ?? 0}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>سقف الإصدار الكلي (المُخزّن)</span>
                <Layers className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.maxSupplyYt, 3)}
                </strong>
                <span className="text-xs font-bold text-amber-600">YT</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono">
                إجمالي المخصصات: {formatNum(parsed.totalTreasuryAllocatedYt)} YT
              </p>
            </div>
          </div>

          {/* User Rewards Consumption Progress */}
          {parsed.poolPct !== null && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700 dark:text-slate-200">
                  نسبة التوزيع الفعلي من مخصص مكافآت المستخدمين ({formatNum(parsed.rewardsAllocatedYt)} YT)
                </span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {parsed.poolPct.toFixed(3)}%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-amber-500 to-emerald-500"
                  style={{ width: `${Math.max(parsed.poolPct, 0.5)}%` }}
                />
              </div>
            </div>
          )}

          {/* Editable Economy Config Form */}
          <form
            onSubmit={(e) => void handleSaveConfig(e)}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  تعديل وحفظ أرقام الاقتصاد والمكافآت والحدود في الخادم
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCfgMiningEnabled((v) => !v)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                  cfgMiningEnabled
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                }`}
              >
                {cfgMiningEnabled ? 'التعدين والمكافآت: مفعّل' : 'التعدين والمكافآت: متوقف'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  سقف الإصدار الكلي للعملة (YT)
                </label>
                <input
                  type="number"
                  min={1}
                  step={0.001}
                  value={cfgMaxSupplyYt}
                  onChange={(e) => setCfgMaxSupplyYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  مكافأة الدخول اليومي (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgBaseRewardYt}
                  onChange={(e) => setCfgBaseRewardYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  مكافأة النقر المباشر (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgTapRewardYt}
                  onChange={(e) => setCfgTapRewardYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  مكافأة النقرة الإعلانية المؤهلة (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgAdClickRewardYt}
                  onChange={(e) => setCfgAdClickRewardYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  مكافأة مشاهدة الإعلان المؤهلة (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgAdViewRewardYt}
                  onChange={(e) => setCfgAdViewRewardYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  السعر المرجعي للعملة (ر.ي لكل 1 YT)
                </label>
                <input
                  type="number"
                  min={0.000001}
                  step="any"
                  value={cfgExchangeRateYerPerYt}
                  onChange={(e) => setCfgExchangeRateYerPerYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  الحد اليومي للإعلانات للمستخدم (0 = مفتوح)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={cfgDailyAdLimit}
                  onChange={(e) => setCfgDailyAdLimit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  الحد اليومي للنقرات للمستخدم (0 = مفتوح)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={cfgDailyTapLimit}
                  onChange={(e) => setCfgDailyTapLimit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  السقف اليومي الابتدائي للمنصة (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgDailyCapStartYt}
                  onChange={(e) => setCfgDailyCapStartYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-600 dark:text-slate-300 block">
                  الحد الأقصى للسقف اليومي للمنصة (YT)
                </label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={cfgDailyCapMaxYt}
                  onChange={(e) => setCfgDailyCapMaxYt(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer"
              >
                {savingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>حفظ وتخزين الإعدادات في الخادم</span>
              </button>
            </div>
          </form>

          {/* Editable System Treasury Allocations Table */}
          {parsed.treasuries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Vault className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    إدارة وتعديل تخصيصات الخزينة (سقف الخادم: {formatNum(parsed.maxSupplyYt)} YT)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  المخصص حالياً: {formatNum(parsed.totalTreasuryAllocatedYt)} / {formatNum(parsed.maxSupplyYt)} YT
                </span>
              </div>

              {editingTreasury && (
                <form
                  onSubmit={(e) => void handleSaveTreasury(e)}
                  className="p-4 bg-amber-50/70 dark:bg-amber-950/25 border-b border-amber-200 dark:border-amber-800 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-slate-900 dark:text-white">
                      تعديل مخصص: <span className="font-mono text-amber-700 dark:text-amber-400">{editingTreasury.treasuryKey}</span>
                    </strong>
                    <button
                      type="button"
                      onClick={() => setEditingTreasury(null)}
                      className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">الاسم الظاهر</label>
                      <input
                        type="text"
                        required
                        value={editingTreasury.labelAr}
                        onChange={(e) => setEditingTreasury({ ...editingTreasury, labelAr: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                        المخصص الكلي (YT) — الحد الأدنى الموزّع: {formatNum(editingTreasury.distributedYt)}
                      </label>
                      <input
                        type="number"
                        required
                        min={editingTreasury.distributedYt}
                        step={0.001}
                        value={editingTreasury.allocatedYt}
                        onChange={(e) => setEditingTreasury({ ...editingTreasury, allocatedYt: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold"
                      />
                    </div>
                    <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 pt-5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingTreasury.isLocked}
                        onChange={(e) => setEditingTreasury({ ...editingTreasury, isLocked: e.target.checked })}
                      />
                      <span>حساب مقفل (Locked)</span>
                    </label>
                    <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 pt-5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingTreasury.approvedForDistribution}
                        onChange={(e) =>
                          setEditingTreasury({ ...editingTreasury, approvedForDistribution: e.target.checked })
                        }
                      />
                      <span>معتمد للتوزيع الفعلي</span>
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingTreasury(null)}
                      className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={savingTreasury}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-60"
                    >
                      {savingTreasury ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      <span>حفظ التعديل في الخادم</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">الحساب / المخصص</th>
                      <th className="py-2.5 px-4 font-bold">المخصص الكلي (YT)</th>
                      <th className="py-2.5 px-4 font-bold">الموزّع فعلياً (YT)</th>
                      <th className="py-2.5 px-4 font-bold">المتبقي (YT)</th>
                      <th className="py-2.5 px-4 font-bold">القفل والاعتماد</th>
                      <th className="py-2.5 px-4 font-bold">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsed.treasuries.map((t: any, idx: number) => {
                      const allocYt =
                        t.allocated_yt !== undefined && t.allocated_yt !== null
                          ? Number(t.allocated_yt)
                          : Number(t.allocated_units ?? 0) / parsed.unitScale;
                      const distYt =
                        t.distributed_yt !== undefined && t.distributed_yt !== null
                          ? Number(t.distributed_yt)
                          : Number(t.distributed_units ?? 0) / parsed.unitScale;
                      const balYt =
                        t.balance_yt !== undefined && t.balance_yt !== null
                          ? Number(t.balance_yt)
                          : Number(t.balance_units ?? 0) / parsed.unitScale;

                      return (
                        <tr key={String(t.treasury_key ?? idx)}>
                          <td className="py-2.5 px-4">
                            <div className="font-bold text-slate-800 dark:text-slate-100">
                              {t.label_ar || t.treasury_key}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">{t.treasury_key}</div>
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                            {formatNum(allocYt)} YT
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                            {formatNum(distYt)} YT
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                            {formatNum(balYt)} YT
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {t.is_locked ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                  <Lock className="w-3 h-3" /> مقفل باستحقاق
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                                  <Unlock className="w-3 h-3" /> غير مقفل
                                </span>
                              )}
                              {t.approved_for_distribution ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                  معتمد للتوزيع
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                  غير متداول بعد
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingTreasury({
                                  treasuryKey: String(t.treasury_key),
                                  labelAr: String(t.label_ar || t.treasury_key),
                                  allocatedYt: formatYt(allocYt).replace(/,/g, ''),
                                  distributedYt: distYt,
                                  isLocked: Boolean(t.is_locked),
                                  approvedForDistribution: Boolean(t.approved_for_distribution),
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold hover:bg-amber-100 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>تعديل</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* User YT Coin Wallets Management */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    إدارة وتعديل أرصدة محافظ المستخدمين (YT Coin)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    بحث وتعديل الرصيد الفعلي لأي محفظة مستخدم وتخزين التعديل في دفتر العملة وسجل التدقيق بالخادم.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadAccounts(accountSearch);
                }}
                className="flex items-center gap-2"
              >
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    placeholder="ابحث بالاسم، الهاتف، أو yt1..."
                    className="pr-8 pl-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs w-52 sm:w-64"
                  />
                </div>
                <button
                  type="submit"
                  disabled={accountsLoading}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {accountsLoading ? 'جاري البحث...' : 'بحث'}
                </button>
              </form>
            </div>

            {editingWallet && (
              <form
                onSubmit={(e) => void handleSaveWalletAdjust(e)}
                className="p-4 bg-emerald-50/70 dark:bg-emerald-950/25 border-b border-emerald-200 dark:border-emerald-800 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <strong className="text-slate-900 dark:text-white">
                    تعديل رصيد محفظة: {editingWallet.fullName} ({editingWallet.walletAddress})
                  </strong>
                  <button
                    type="button"
                    onClick={() => setEditingWallet(null)}
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      الرصيد الجديد (YT) — الحالي: {formatNum(editingWallet.currentBalanceYt)} YT
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      step={0.001}
                      value={editingWallet.newBalanceYt}
                      onChange={(e) => setEditingWallet({ ...editingWallet, newBalanceYt: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">سبب التعديل / المرجع</label>
                    <input
                      type="text"
                      placeholder="مثال: تسوية أو مكافأة إدارية"
                      value={editingWallet.reason}
                      onChange={(e) => setEditingWallet({ ...editingWallet, reason: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 pt-5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingWallet.clearPendingAudit}
                      onChange={(e) => setEditingWallet({ ...editingWallet, clearPendingAudit: e.target.checked })}
                    />
                    <span>اعتماد حالة المحفظة (verified)</span>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingWallet(null)}
                    className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingWallet}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-60"
                  >
                    {savingWallet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>حفظ الرصيد الجديد</span>
                  </button>
                </div>
              </form>
            )}

            {accounts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {accountsLoading ? 'جاري تحميل المحافظ من الخادم...' : 'لا توجد محافظ مطابقة حالياً.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">المستخدم / العنوان</th>
                      <th className="py-2.5 px-4 font-bold">الرصيد الحالي (YT)</th>
                      <th className="py-2.5 px-4 font-bold">إجمالي المكتسب</th>
                      <th className="py-2.5 px-4 font-bold">أرباح الإعلانات</th>
                      <th className="py-2.5 px-4 font-bold">حالة التدقيق</th>
                      <th className="py-2.5 px-4 font-bold">تعديل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {accounts.map((acc: any, idx: number) => {
                      const balYt =
                        acc.balance_yt !== undefined && acc.balance_yt !== null
                          ? Number(acc.balance_yt)
                          : Number(acc.balance_units ?? 0) / parsed.unitScale;
                      const lifeYt =
                        acc.lifetime_earned_yt !== undefined && acc.lifetime_earned_yt !== null
                          ? Number(acc.lifetime_earned_yt)
                          : Number(acc.lifetime_earned_units ?? 0) / parsed.unitScale;
                      const adYt =
                        acc.ad_earned_yt !== undefined && acc.ad_earned_yt !== null
                          ? Number(acc.ad_earned_yt)
                          : Number(acc.ad_earned_units ?? 0) / parsed.unitScale;

                      return (
                        <tr key={String(acc.user_id ?? idx)}>
                          <td className="py-2.5 px-4">
                            <div className="font-bold text-slate-800 dark:text-slate-100">
                              {acc.full_name || acc.phone || acc.email || String(acc.user_id || '').slice(0, 8)}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                              {acc.wallet_address}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                            {formatNum(balYt)} YT
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-bold">
                            {formatNum(lifeYt)} YT
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-sky-700 dark:text-sky-400 font-bold">
                            {formatNum(adYt)} YT
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                acc.migration_audit_status === 'pending_audit'
                                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {acc.migration_audit_status === 'pending_audit' ? 'بانتظار المطابقة' : 'موثّقة'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingWallet({
                                  userId: String(acc.user_id),
                                  fullName: String(acc.full_name || acc.phone || acc.wallet_address),
                                  walletAddress: String(acc.wallet_address),
                                  currentBalanceYt: balYt,
                                  newBalanceYt: formatYt(balYt).replace(/,/g, ''),
                                  reason: '',
                                  clearPendingAudit: true,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-100 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>تعديل الرصيد</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Verified Ad Networks Manager */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-sky-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    إدارة الشبكات الإعلانية الموثقة (S2S Postback Verified)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    لا تظهر أي شبكة في صفحة «اكسب من الإعلانات» إلا إذا كانت مفعّلة ومزودة برابط عرض ومفتاح سري مضبوط في بيئة الخادم.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setNetworkForm({ ...EMPTY_NETWORK_FORM });
                  setShowNetworkForm((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showNetworkForm ? 'إغلاق النموذج' : 'إضافة شبكة إعلانية'}</span>
              </button>
            </div>

            {showNetworkForm && (
              <form
                onSubmit={(e) => void handleSaveAdNetwork(e)}
                className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20 p-4 space-y-3 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      مفتاح الشبكة (إنجليزي صغير، مثال: ad_partner_1)
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      disabled={Boolean(networkForm.id)}
                      value={networkForm.networkKey}
                      onChange={(e) => setNetworkForm({ ...networkForm, networkKey: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">الاسم الظاهر للمستخدم</label>
                    <input
                      type="text"
                      required
                      value={networkForm.displayName}
                      onChange={(e) => setNetworkForm({ ...networkForm, displayName: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">نوع الإعلانات</label>
                    <select
                      value={networkForm.adType}
                      onChange={(e) => setNetworkForm({ ...networkForm, adType: e.target.value as any })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="both">مشاهدة + نقرة (both)</option>
                      <option value="view">مشاهدة فقط (view)</option>
                      <option value="click">نقرة فقط (click)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      رابط العرض الإعلاني (يدعم {'{user_id}'} و {'{session_id}'})
                    </label>
                    <input
                      type="url"
                      dir="ltr"
                      placeholder="https://example-ad-network.com/watch?subid={user_id}&click_id={session_id}"
                      value={networkForm.placementUrl}
                      onChange={(e) => setNetworkForm({ ...networkForm, placementUrl: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">نمط التحقق</label>
                    <select
                      value={networkForm.authMode}
                      onChange={(e) => setNetworkForm({ ...networkForm, authMode: e.target.value as any })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="hmac_sha256">توقيع HMAC-SHA256</option>
                      <option value="shared_secret">مفتاح سري مشترك (Shared Secret)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">مكافأة النقرة (YT)</label>
                    <input
                      type="number"
                      min={0.001}
                      step={0.001}
                      value={networkForm.rewardClickYt}
                      onChange={(e) => setNetworkForm({ ...networkForm, rewardClickYt: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">مكافأة المشاهدة (YT)</label>
                    <input
                      type="number"
                      min={0.001}
                      step={0.001}
                      value={networkForm.rewardViewYt}
                      onChange={(e) => setNetworkForm({ ...networkForm, rewardViewYt: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">اسم متغير السر بالخادم</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={networkForm.secretEnvKey}
                      onChange={(e) => setNetworkForm({ ...networkForm, secretEnvKey: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <label className="inline-flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={networkForm.isActive}
                      onChange={(e) => setNetworkForm({ ...networkForm, isActive: e.target.checked })}
                    />
                    <span>تفعيل الشبكة فور الحفظ</span>
                  </label>
                  <button
                    type="submit"
                    disabled={savingNetwork}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold cursor-pointer"
                  >
                    {savingNetwork ? 'جاري الحفظ...' : 'حفظ الشبكة الإعلانية'}
                  </button>
                </div>
              </form>
            )}

            {parsed.adNetworks.length === 0 ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-5 text-center text-xs text-slate-500">
                لا توجد شبكات إعلانية مضافة حالياً. تعرض صفحة «اكسب من الإعلانات» للمستخدمين حالة «الإعلانات غير متاحة حالياً» حتى يتم ربط شبكة موثقة وضبط مفتاحها السري على الخادم.
              </div>
            ) : (
              <div className="space-y-2.5">
                {parsed.adNetworks.map((net: any) => (
                  <div
                    key={String(net.id)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-slate-900 dark:text-white">{net.display_name}</strong>
                        <span className="font-mono text-[11px] text-slate-400">({net.network_key})</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            net.is_active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {net.is_active ? 'مفعّلة' : 'معطّلة'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            net.secret_configured
                              ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {net.secret_configured ? 'مفتاح الخادم جاهز' : `ينقص ضبط ${net.secret_env_key} في البيئة`}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        مشاهدة: +{formatYt(net.reward_view_yt ?? 0.01)} YT • نقرة: +{formatYt(net.reward_click_yt ?? 0.01)} YT • النمط: {net.auth_mode}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyPostbackUrl(net.network_key)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-200 cursor-pointer"
                      >
                        {copiedKey === net.network_key ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>نسخ Postback</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNetworkForm({
                            id: net.id,
                            networkKey: net.network_key,
                            displayName: net.display_name,
                            description: net.description || '',
                            authMode: net.auth_mode === 'shared_secret' ? 'shared_secret' : 'hmac_sha256',
                            secretEnvKey: net.secret_env_key || 'YT_COIN_AD_POSTBACK_SECRET',
                            placementUrl: net.placement_url || '',
                            adType: net.ad_type || 'both',
                            rewardClickYt: String(net.reward_click_yt ?? 0.01),
                            rewardViewYt: String(net.reward_view_yt ?? 0.01),
                            dailyUserLimit: String(net.daily_user_limit ?? 20),
                            isActive: Boolean(net.is_active),
                          });
                          setShowNetworkForm(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 font-bold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleNetworkActive(net)}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold cursor-pointer"
                      >
                        {net.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button
                        type="button"
                        disabled={deletingNetworkId === net.id}
                        onClick={() => void handleDeleteNetwork(net.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Verified Ad Events */}
          {parsed.recentAdEvents.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Tv className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">أحدث أحداث الإعلانات الموثقة</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">المستخدم / الشبكة</th>
                      <th className="py-2.5 px-4 font-bold">المرجع الفريد</th>
                      <th className="py-2.5 px-4 font-bold">المكافأة (YT)</th>
                      <th className="py-2.5 px-4 font-bold">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsed.recentAdEvents.slice(0, 15).map((ev: any, idx: number) => (
                      <tr key={String(ev.id ?? idx)}>
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-800 dark:text-slate-100">
                            {ev.full_name || String(ev.user_id || '').slice(0, 8)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {ev.network_key} • {ev.event_type}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500">{ev.external_event_id}</td>
                        <td className="py-2.5 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          +{formatNum(pickYtUnits([ev], ['amount_yt'], ['amount_units'], parsed.unitScale))} YT
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">{formatDateTime(ev.created_at || null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Claims Table */}
          {parsed.recentClaims.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">أحدث مطالبات الدخول اليومي</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">المستخدم</th>
                      <th className="py-2.5 px-4 font-bold">الكمية (YT)</th>
                      <th className="py-2.5 px-4 font-bold">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsed.recentClaims.slice(0, 15).map((row: any, idx: number) => (
                      <tr key={String(row.id ?? idx)}>
                        <td className="py-2.5 px-4 text-slate-800 dark:text-slate-100 font-semibold">
                          {row.full_name || row.claim_date || `عملية #${idx + 1}`}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNum(pickYtUnits([row], ['amount_yt'], ['amount_units'], parsed.unitScale))} YT
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">{formatDateTime(row.created_at || null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detailed Scalar Metrics */}
          {parsed.scalarEntries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">ملخص المؤشرات المخزنة في الخادم</h3>
                {parsed.updatedAt && (
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDateTime(parsed.updatedAt)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {parsed.scalarEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 truncate">
                      {entry.label}
                    </span>
                    <span className="text-xs font-mono tabular-nums font-bold text-slate-900 dark:text-white shrink-0">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
          لا توجد بيانات متاحة حالياً لخزينة YT Coin.
        </div>
      )}
    </div>
  );
};
