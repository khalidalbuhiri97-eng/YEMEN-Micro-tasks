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
} from 'lucide-react';
import { api } from '../../api/client.ts';

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

function formatNum(value: number | null, maxDecimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? '-<0.01' : '<0.01';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(2, Math.max(0, maxDecimals)),
  }).format(value);
}

function pickYtUnits(sources: Array<Record<string, any> | null>, ytKeys: string[], unitKeys: string[]): number | null {
  const direct = pickNumber(sources, ytKeys);
  if (direct !== null) return direct;
  const units = pickNumber(sources, unitKeys);
  return units === null ? null : units / 2;
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
  treasury_key: 'مفتاح الخزينة',
  balance_yt: 'رصيد الخزينة (YT)',
  backing_yer: 'التغطية المرجعية (ر.ي)',
  exchange_rate_yt_per_yer: 'سعر الصرف المرجعي (YT / ر.ي)',
  total_supply_yt: 'إجمالي المعروض (YT)',
  max_supply_yt: 'الحد الأقصى للمعروض (YT)',
  mining_cap_yt: 'سقف التعدين (YT)',
  rewards_pool_balance_yt: 'رصيد خزينة مكافآت التعدين (YT)',
  rewards_treasury_balance_yt: 'رصيد خزينة مكافآت التعدين (YT)',
  total_mined_yt: 'إجمالي المُعدَّن (YT)',
  total_distributed_yt: 'إجمالي الموزّع (YT)',
  circulating_supply_yt: 'المتداول لدى المستخدمين (YT)',
  total_user_balances_yt: 'إجمالي أرصدة المستخدمين (YT)',
  active_miners_count: 'عدد المعدّنين النشطين',
  total_miners: 'إجمالي المعدّنين',
  unique_miners: 'المعدّنون الفريدون',
  claims_today: 'مطالبات اليوم',
  today_claims_count: 'مطالبات اليوم',
  today_mined_yt: 'مُعدَّن اليوم (YT)',
  total_claims: 'إجمالي المطالبات',
  total_claims_count: 'إجمالي المطالبات',
  daily_reward_yt: 'مكافأة التعدين اليومي (YT)',
  mining_enabled: 'حالة التعدين',
  cap_reached: 'بلوغ سقف التعدين',
  updated_at: 'آخر تحديث',
};

export const YtCoinAdminView: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminYtCoinSummary();
      setSummary(res?.summary ?? null);
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

    const legacyTreasury =
      asRecord(root.legacy_treasury) ||
      asRecord(root.yt_treasury) ||
      asRecord(root.main_treasury) ||
      asRecord(root.treasury);
    const rewardsTreasury =
      asRecord(root.rewards_treasury) ||
      asRecord(root.mining_treasury) ||
      asRecord(root.mining_pool) ||
      asRecord(root.rewards_pool);
    const miningStats = asRecord(root.mining) || asRecord(root.stats) || asRecord(root.metrics);

    const sources: Array<Record<string, any> | null> = [
      root,
      miningStats,
      rewardsTreasury,
      legacyTreasury,
    ];

    const mainTreasuryYt = pickYtUnits(
      [legacyTreasury, root],
      ['balance_yt', 'treasury_balance_yt', 'legacy_treasury_balance_yt', 'backing_treasury_yt'],
      ['balance_units', 'balanceUnits', 'treasury_balance_units']
    );
    const rewardsPoolRemainingYt = pickYtUnits(
      [rewardsTreasury, root, miningStats],
      [
        'rewards_treasury_balance_yt',
        'rewards_pool_balance_yt',
        'mining_pool_remaining_yt',
        'pool_remaining_yt',
        'remaining_yt',
        'balance_yt',
      ],
      ['balance_units', 'balanceUnits', 'rewards_treasury_balance_units', 'pool_remaining_units']
    );
    const miningCapYt = pickYtUnits(sources, [
      'mining_cap_yt',
      'pool_cap_yt',
      'total_mining_cap_yt',
      'allocated_yt',
      'max_mining_supply_yt',
    ], ['daily_global_cap_units', 'daily_cap_units', 'allocated_units', 'max_daily_reward_units']);
    const totalMinedYt = pickYtUnits(sources, [
      'total_mined_yt',
      'total_distributed_yt',
      'distributed_yt',
      'circulating_supply_yt',
      'total_user_balances_yt',
      'user_balances_total_yt',
    ], ['total_mined_units', 'total_distributed_units', 'circulating_supply_units', 'total_user_balances_units']);
    const backingYer = pickNumber(
      [legacyTreasury, root],
      ['backing_yer', 'total_backing_yer']
    );
    const exchangeRate = pickNumber(
      [legacyTreasury, root],
      ['exchange_rate_yt_per_yer', 'exchange_rate']
    );
    const activeMiners = pickNumber(sources, [
      'active_miners_count',
      'total_miners',
      'unique_miners',
      'miners_count',
      'holders_count',
    ]);
    const claimsToday = pickNumber(sources, [
      'claims_today',
      'today_claims_count',
      'today_claims',
    ]);
    const totalClaims = pickNumber(sources, [
      'total_claims',
      'total_claims_count',
      'claims_count',
    ]);
    const todayMinedYt = pickYtUnits(sources, ['today_mined_yt', 'mined_today_yt'], ['today_mined_units', 'mined_today_units']);
    const updatedAt = pickString(sources, ['updated_at', 'generated_at', 'as_of']);

    const treasuries = pickArray([root], [
      'treasuries',
      'system_treasuries',
      'pools',
      'accounts',
    ]).filter((r) => asRecord(r) !== null);

    const recentClaims = pickArray([root, miningStats], [
      'recent_claims',
      'recent_rewards',
      'recent_mining_claims',
      'claims',
      'mining_events',
    ]).filter((r) => asRecord(r) !== null);

    const recentLedger = pickArray([root], [
      'recent_ledger',
      'ledger',
      'ledger_entries',
      'recent_transactions',
      'transactions',
    ]).filter((r) => asRecord(r) !== null);

    // Preserve any scalar top-level keys returned by the RPC for complete transparency
    const scalarEntries: Array<{ key: string; label: string; value: string }> = [];
    for (const [k, v] of Object.entries(root)) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      let displayVal = String(v);
      let displayLabel = METRIC_LABELS[k] || k;
      if (typeof v === 'boolean') displayVal = v ? 'نعم' : 'لا';
      else if (typeof v === 'number' && (k.endsWith('_units') || k.endsWith('Units'))) {
        displayVal = formatNum(v / 2);
        displayLabel = METRIC_LABELS[k.replace(/_units$|Units$/, '_yt')] || k.replace(/_units$|Units$/, ' (YT)');
      } else if (typeof v === 'number') displayVal = formatNum(v);
      else if (k.endsWith('_at')) displayVal = formatDateTime(v);
      scalarEntries.push({
        key: k,
        label: displayLabel,
        value: displayVal,
      });
    }

    const poolPct =
      miningCapYt !== null && miningCapYt > 0 && totalMinedYt !== null
        ? Math.min(100, Math.max(0, (totalMinedYt / miningCapYt) * 100))
        : null;

    return {
      mainTreasuryYt,
      rewardsPoolRemainingYt,
      miningCapYt,
      totalMinedYt,
      backingYer,
      exchangeRate,
      activeMiners,
      claimsToday,
      totalClaims,
      todayMinedYt,
      updatedAt,
      treasuries,
      recentClaims,
      recentLedger,
      scalarEntries,
      poolPct,
    };
  }, [summary]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-12 h-12 rounded-full aspect-square shrink-0 overflow-hidden bg-slate-950 ring-2 ring-amber-400/80 shadow-sm">
            <img
              src={YT_COIN_LOGO_SRC}
              alt="YT Coin"
              className="w-full h-full object-cover rounded-full"
            />
          </span>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <span>خزينة وتعدين YT Coin</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                مستقل عن دفتر الريال اليمني
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              مراقبة لحظية لأرصدة الخزينة ومخزون مكافآت التعدين اليومي والمطالبات الفعلية من قاعدة البيانات.
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
            className="rounded-lg bg-rose-600 text-white px-3 py-1.5 font-bold hover:bg-rose-700"
          >
            إعادة المحاولة
          </button>
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
                <span>رصيد خزينة التعدين المتبقي</span>
                <Vault className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.rewardsPoolRemainingYt)}
                </strong>
                <span className="text-xs font-bold text-amber-600">YT</span>
              </div>
              {parsed.miningCapYt !== null && (
                <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                  سقف التعدين: {formatNum(parsed.miningCapYt)} YT
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/25 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <span>إجمالي المُعدَّن والموزّع</span>
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.totalMinedYt)}
                </strong>
                <span className="text-xs font-bold text-emerald-600">YT</span>
              </div>
              {parsed.todayMinedYt !== null && (
                <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                  مُعدَّن اليوم: {formatNum(parsed.todayMinedYt)} YT
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-blue-700 dark:text-blue-400">
                <span>المعدّنون والمطالبات</span>
                <Users className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.activeMiners, 0)}
                </strong>
                <span className="text-xs font-bold text-slate-500">مستخدم</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                اليوم: {formatNum(parsed.claimsToday, 0)} • الإجمالي: {formatNum(parsed.totalClaims, 0)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>الخزينة الرئيسية / التغطية</span>
                <Layers className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatNum(parsed.mainTreasuryYt)}
                </strong>
                <span className="text-xs font-bold text-amber-600">YT</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                {parsed.backingYer !== null ? `تغطية: ${formatNum(parsed.backingYer)} ر.ي` : ''}
                {parsed.backingYer !== null && parsed.exchangeRate !== null ? ' • ' : ''}
                {parsed.exchangeRate !== null ? `1 ر.ي = ${formatNum(parsed.exchangeRate)} YT` : ''}
              </p>
            </div>
          </div>

          {/* Cap Progress */}
          {parsed.poolPct !== null && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700 dark:text-slate-200">نسبة استهلاك سقف التعدين</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {parsed.poolPct.toFixed(2)}%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-amber-500 to-emerald-500"
                  style={{ width: `${parsed.poolPct}%` }}
                />
              </div>
            </div>
          )}

          {/* System Treasuries Table (when returned) */}
          {parsed.treasuries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Vault className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">حسابات خزينة YT Coin</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">الحساب</th>
                      <th className="py-2.5 px-4 font-bold">الرصيد (YT)</th>
                      <th className="py-2.5 px-4 font-bold">آخر تحديث</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsed.treasuries.map((t: any, idx: number) => (
                      <tr key={String(t.id ?? t.treasury_key ?? t.code ?? idx)}>
                        <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-100">
                          {t.name || t.treasury_key || t.code || t.account_code || `خزينة #${idx + 1}`}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                          {formatNum(
                            pickYtUnits([t], ['balance_yt', 'available_yt'], ['balance_units', 'balanceUnits']) ??
                              (t.balance_atomic != null ? Number(t.balance_atomic) / 2 : null)
                          )}{' '}
                          YT
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">
                          {formatDateTime(t.updated_at || t.created_at || null)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Claims / Ledger Table */}
          {(parsed.recentClaims.length > 0 || parsed.recentLedger.length > 0) && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {parsed.recentClaims.length > 0 ? 'أحدث مطالبات التعدين' : 'أحدث قيود YT Coin'}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">العملية / المرجع</th>
                      <th className="py-2.5 px-4 font-bold">الكمية (YT)</th>
                      <th className="py-2.5 px-4 font-bold">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(parsed.recentClaims.length > 0 ? parsed.recentClaims : parsed.recentLedger)
                      .slice(0, 20)
                      .map((row: any, idx: number) => (
                        <tr key={String(row.id ?? row.reference ?? idx)}>
                          <td className="py-2.5 px-4 text-slate-800 dark:text-slate-100 font-semibold">
                            {row.user_name ||
                              row.full_name ||
                              row.event_type ||
                              row.reference ||
                              row.claim_date ||
                              `عملية #${idx + 1}`}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                            {formatNum(
                              pickYtUnits([row], ['amount_yt', 'reward_yt', 'claimed_yt', 'amount'], ['amount_units', 'amountUnits', 'reward_units', 'rewardUnits'])
                            )}{' '}
                            YT
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">
                            {formatDateTime(row.created_at || row.claimed_at || null)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Full Detailed Scalar Metrics from RPC */}
          {parsed.scalarEntries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  ملخص المؤشرات التفصيلية
                </h3>
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
