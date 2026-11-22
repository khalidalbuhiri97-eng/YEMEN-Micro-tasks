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
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  formatYt,
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

  // Admin Config Form State
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [cfgMiningEnabled, setCfgMiningEnabled] = useState<boolean>(true);
  const [cfgBaseRewardYt, setCfgBaseRewardYt] = useState<string>('0.5');
  const [cfgTapRewardYt, setCfgTapRewardYt] = useState<string>('0.01');
  const [cfgAdClickRewardYt, setCfgAdClickRewardYt] = useState<string>('0.01');
  const [cfgAdViewRewardYt, setCfgAdViewRewardYt] = useState<string>('0.01');
  const [cfgDailyTapLimit, setCfgDailyTapLimit] = useState<string>('1000');
  const [cfgDailyAdLimit, setCfgDailyAdLimit] = useState<string>('20');

  // Ad Networks Management State
  const [showNetworkForm, setShowNetworkForm] = useState<boolean>(false);
  const [networkForm, setNetworkForm] = useState({ ...EMPTY_NETWORK_FORM });
  const [savingNetwork, setSavingNetwork] = useState<boolean>(false);
  const [deletingNetworkId, setDeletingNetworkId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
        setCfgBaseRewardYt(
          formatYt(s.base_reward_yt ?? Number(s.base_reward_units ?? 500) / scale).replace(/,/g, '')
        );
        setCfgTapRewardYt(
          formatYt(s.tap_reward_yt ?? Number(s.tap_reward_units ?? 10) / scale).replace(/,/g, '')
        );
        setCfgAdClickRewardYt(
          formatYt(s.ad_click_reward_yt ?? Number(s.ad_click_reward_units ?? 10) / scale).replace(/,/g, '')
        );
        setCfgAdViewRewardYt(
          formatYt(s.ad_view_reward_yt ?? Number(s.ad_view_reward_units ?? 10) / scale).replace(/,/g, '')
        );
        if (s.daily_tap_limit !== undefined && s.daily_tap_limit !== null) {
          setCfgDailyTapLimit(String(Math.max(0, Math.floor(Number(s.daily_tap_limit) || 0))));
        }
        if (s.daily_ad_limit !== undefined && s.daily_ad_limit !== null) {
          setCfgDailyAdLimit(String(Math.max(0, Math.floor(Number(s.daily_ad_limit) || 0))));
        }
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل مؤشرات خزينة وتعدين YT Coin.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const parsed = useMemo(() => {
    const root = asRecord(summary);
    if (!root) return null;

    const unitScale = pickNumber([root], ['unit_scale', 'unitScale']) ?? YT_SUBUNITS_PER_YT;

    const rewardsPoolRemainingYt = pickYtUnits(
      [root],
      ['rewards_treasury_balance_yt', 'pool_remaining_yt'],
      ['rewards_treasury_balance_units', 'pool_remaining_units'],
      unitScale
    );
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

    const treasuries = pickArray([root], ['treasuries']).filter((r) => asRecord(r) !== null);
    const adNetworks = pickArray([root], ['ad_networks']).filter((r) => asRecord(r) !== null);
    const recentClaims = pickArray([root], ['recent_claims']).filter((r) => asRecord(r) !== null);
    const recentAdEvents = pickArray([root], ['recent_ad_events']).filter((r) => asRecord(r) !== null);

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
        displayVal = k === 'unit_scale' ? '1,000' : formatYt(v);
      } else if (k.endsWith('_at')) {
        displayVal = formatDateTime(v);
      }
      scalarEntries.push({ key: k, label: displayLabel, value: displayVal });
    }

    const userRewardsCapYt = 30_000_000;
    const rewardsDistributedYt =
      rewardsPoolRemainingYt !== null ? Math.max(0, userRewardsCapYt - rewardsPoolRemainingYt) : null;
    const poolPct =
      rewardsDistributedYt !== null
        ? Math.min(100, Math.max(0, (rewardsDistributedYt / userRewardsCapYt) * 100))
        : null;

    return {
      unitScale,
      rewardsPoolRemainingYt,
      circulatingSupplyYt,
      maxSupplyYt,
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
      const baseUnits = ytToUnitsStrict(cfgBaseRewardYt, { fieldLabel: 'مكافأة الدخول اليومي', minUnits: 1 });
      const tapUnits = ytToUnitsStrict(cfgTapRewardYt, { fieldLabel: 'مكافأة النقر', minUnits: 1 });
      const clickUnits = ytToUnitsStrict(cfgAdClickRewardYt, { fieldLabel: 'مكافأة النقرة الإعلانية', minUnits: 1 });
      const viewUnits = ytToUnitsStrict(cfgAdViewRewardYt, { fieldLabel: 'مكافأة مشاهدة الإعلان', minUnits: 1 });
      const dailyTapLimit = Math.max(0, Math.floor(Number(cfgDailyTapLimit) || 0));
      const dailyAdLimit = Math.max(0, Math.floor(Number(cfgDailyAdLimit) || 0));

      setSavingConfig(true);
      await api.updateAdminYtCoinConfig({
        miningEnabled: cfgMiningEnabled,
        baseRewardYt: baseUnits / YT_SUBUNITS_PER_YT,
        tapRewardYt: tapUnits / YT_SUBUNITS_PER_YT,
        adClickRewardYt: clickUnits / YT_SUBUNITS_PER_YT,
        adViewRewardYt: viewUnits / YT_SUBUNITS_PER_YT,
        dailyTapLimit,
        dailyAdLimit,
      });
      showToast('تم تحديث إعدادات ومعدلات YT Coin في Supabase بنجاح.', 'success');
      await loadSummary();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ الإعدادات.', 'error');
    } finally {
      setSavingConfig(false);
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
        rewardClickYt: clickUnits / YT_SUBUNITS_PER_YT,
        rewardViewYt: viewUnits / YT_SUBUNITS_PER_YT,
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
              <span>إدارة اقتصاد وخزينة YT Coin</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                BIGINT • 1 YT = 1,000 جزء • سقف 100M
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              إدارة سقف الـ 100 مليون YT، التخصيصات المعتمدة والمقفلة، معدلات المكافآت، والشبكات الإعلانية الموثقة.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>تحديث المؤشرات</span>
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
            يوجد <strong className="font-mono">{parsed.pendingAuditAccounts}</strong> حساباً بأرصدة قديمة بانتظار المطابقة اليدوية (pending_audit) — تم الاحتفاظ بها كما هي دون تصفير أو تحويل تلقائي.
          </span>
        </div>
      )}

      {loading && !parsed ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
          ))}
        </div>
      ) : parsed ? (
        <>
          {/* Primary KPI Cards */}
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
                المخصص: 30,000,000 YT (30%)
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
                <span>سقف الإصدار النهائي</span>
                <Layers className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.maxSupplyYt, 0)}
                </strong>
                <span className="text-xs font-bold text-amber-600">YT</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                أصغر وحدة: 0.001 YT (1,000 جزء/عملة)
              </p>
            </div>
          </div>

          {/* User Rewards Consumption Progress */}
          {parsed.poolPct !== null && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700 dark:text-slate-200">
                  نسبة التوزيع الفعلي من مخصص مكافآت المستخدمين (30 مليون YT)
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

          {/* 4 Tokenomics Allocations Table */}
          {parsed.treasuries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Vault className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    تخصيصات سقف الـ 100 مليون YT (لا تُحسب متداولة قبل الاعتماد والتوزيع)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500">المجموع ≤ 100,000,000 YT</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">الحساب / المخصص</th>
                      <th className="py-2.5 px-4 font-bold">المخصص الكلي (YT)</th>
                      <th className="py-2.5 px-4 font-bold">الموزّع فعلياً (YT)</th>
                      <th className="py-2.5 px-4 font-bold">المتبقي (YT)</th>
                      <th className="py-2.5 px-4 font-bold">القفل والاعتماد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsed.treasuries.map((t: any, idx: number) => (
                      <tr key={String(t.treasury_key ?? idx)}>
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-800 dark:text-slate-100">
                            {t.label_ar || t.treasury_key}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">{t.treasury_key}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                          {formatNum(t.allocated_yt ?? Number(t.allocated_units ?? 0) / parsed.unitScale)} YT
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNum(t.distributed_yt ?? Number(t.distributed_units ?? 0) / parsed.unitScale)} YT
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                          {formatNum(t.balance_yt ?? Number(t.balance_units ?? 0) / parsed.unitScale)} YT
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Admin Reward Rates Config Form */}
          <form
            onSubmit={(e) => void handleSaveConfig(e)}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  ضبط معدلات المكافآت والحدود اليومية (تقبل حتى 3 خانات عشرية)
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
                  مكافأة الدخول اليومي (YT — الافتراضي 0.5)
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
                  مكافأة النقرة الإعلانية المؤهلة (YT — الافتراضي 0.01)
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
                  مكافأة مشاهدة الإعلان المؤهلة (YT — الافتراضي 0.01)
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
                  مكافأة النقر المباشر (YT — الافتراضي 0.01)
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
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer"
              >
                {savingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>حفظ معدلات المكافآت</span>
              </button>
            </div>
          </form>

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
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">ملخص المؤشرات التفصيلية</h3>
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
