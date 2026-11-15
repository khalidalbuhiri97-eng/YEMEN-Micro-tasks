import React from 'react';
import {
  Banknote,
  Clock,
  Landmark,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  Lock,
  Coins,
  Receipt,
  ArrowUpRight,
  PiggyBank,
} from 'lucide-react';
import type { TreasurySummary } from '../../../types/index.ts';
import { MigrationReadinessBanner } from './MigrationReadinessBanner.tsx';

interface OwnerOverviewMetricsProps {
  stats: any;
  treasury: TreasurySummary | null;
  pendingSubmissionsCount: number;
  pendingWithdrawalsCount: number;
  isLoading: boolean;
  onNavigateTab: (tab: any) => void;
}

const fmtYer = (val: number | undefined | null): string =>
  Math.round(Number(val || 0)).toLocaleString('en-US');

export const OwnerOverviewMetrics: React.FC<OwnerOverviewMetricsProps> = ({
  stats,
  treasury,
  pendingSubmissionsCount,
  pendingWithdrawalsCount,
  isLoading,
  onNavigateTab,
}) => {
  if (isLoading && !treasury) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const cashVault = treasury?.cashVaultTotal ?? 0;
  const ownerCapital = treasury?.ownerCapitalTotal ?? 0;
  const revTasks = treasury?.revenueTotals?.tasks ?? 0;
  const revAds = treasury?.revenueTotals?.ads ?? 0;
  const revSubs = treasury?.revenueTotals?.subscriptions ?? 0;
  const revServices = treasury?.revenueTotals?.services ?? 0;
  const totalRevenue = treasury?.revenueTotals?.total ?? 0;
  const totalOpEx = treasury?.totalOperationalExpenses ?? ((treasury?.expensesTotal ?? 0) + (treasury?.providerFeesTotal ?? 0));
  const netProfitLoss = treasury?.netProfitLoss ?? (totalRevenue - totalOpEx);
  const retainedEarnings = treasury?.computedRetainedEarnings ?? treasury?.retainedEarningsTotal ?? 0;
  const ownerWithdrawals = treasury?.ownerWithdrawalsTotal ?? 0;
  const userLiabilities =
    treasury?.userLiabilitiesTotal ??
    ((treasury?.userAvailableTotal ?? 0) + (treasury?.withdrawalReservedTotal ?? 0));
  const taskEscrowReserved = treasury?.taskBudgetReserved ?? 0;
  const taxPayable = treasury?.taxPayableTotal ?? 0;
  const taxesPaid = treasury?.taxesPaidTotal ?? 0;
  const virtualIssued = treasury?.totalIssuedUnits ?? 0;
  const virtualTreasuryAvail = treasury?.treasuryAvailable ?? 0;
  const isReconciled = treasury?.isReconciled ?? false;

  return (
    <div className="space-y-6">
      <MigrationReadinessBanner treasury={treasury} />

      {/* Section 1: Owner Cash, Capital, Revenues, Expenses, Profit & Withdrawals */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-600" />
              <span>الوضع المالي للمالك والمنصة (مفصول محاسبياً عن أموال المستخدمين)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              أرقام فعلية مباشرة من حسابات دفتر الأستاذ العام بعملة الريال اليمني (YER).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('treasury')}
            className="px-3 py-1.5 text-xs font-bold bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            <span>إدارة الخزينة والعمليات</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* 1. Actual Cash Vault */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60">
            <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-400 font-semibold mb-1.5">
              <span>إجمالي النقد الفعلي في الخزينة</span>
              <Banknote className="w-4 h-4" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
              {fmtYer(cashVault)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">PLATFORM-CASH-VAULT</div>
          </div>

          {/* 2. Owner Capital */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>رأس مال المالك</span>
              <PiggyBank className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {fmtYer(ownerCapital)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">OWNER-CAPITAL</div>
          </div>

          {/* 3. Realized Revenues */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>إجمالي الإيرادات المحققة</span>
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtYer(totalRevenue)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-x-2 font-mono">
              <span>مهام: {fmtYer(revTasks)}</span>
              <span>إعلانات: {fmtYer(revAds)}</span>
              <span>خدمات: {fmtYer(revServices + revSubs)}</span>
            </div>
          </div>

          {/* 4. Operational Expenses */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>إجمالي المصروفات التشغيلية</span>
              <TrendingDown className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {fmtYer(totalOpEx)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              تشغيلية: {fmtYer(treasury?.expensesTotal)} | مزودين: {fmtYer(treasury?.providerFeesTotal)}
            </div>
          </div>

          {/* 5. Net Profit / Loss */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>صافي الربح والخسارة</span>
              {netProfitLoss >= 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-rose-600" />
              )}
            </div>
            <div
              className={`text-xl font-extrabold font-mono tabular-nums ${
                netProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {netProfitLoss > 0 ? '+' : ''}
              {fmtYer(netProfitLoss)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">الإيرادات المحققة − المصروفات التشغيلية</div>
          </div>

          {/* 6. Retained Earnings */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>الأرباح المحتجزة</span>
              <Landmark className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {fmtYer(retainedEarnings)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              رصيد حساب RETAINED-EARNINGS: {fmtYer(treasury?.retainedEarningsTotal)}
            </div>
          </div>

          {/* 7. Owner Withdrawals */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>مسحوبات المالك</span>
              <Wallet className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {fmtYer(ownerWithdrawals)} <span className="text-[11px] font-normal">ر.ي</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">OWNER-WITHDRAWALS</div>
          </div>

          {/* 8. Taxes Due & Paid */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              <span>الضرائب المستحقة والمدفوعة</span>
              <Receipt className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {fmtYer(taxPayable)} <span className="text-[11px] font-normal">ر.ي مستحقة</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
              المدفوعة فعلياً: {fmtYer(taxesPaid)} ر.ي
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: User Liabilities, Task Escrows & Virtual Issued Units (Strict Separation) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User Liabilities & Task Escrows */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-600" />
                <span>التزامات المستخدمين وضمان المهام (أموال للغير)</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                لا تُحتسب ضمن أرباح المنصة أو السيولة الحرة للمالك.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70">
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                الالتزامات المستحقة للمستخدمين
              </span>
              <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                {fmtYer(userLiabilities)} <span className="text-xs font-normal">ر.ي</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                محافظ: {fmtYer(treasury?.userAvailableTotal)} | سحوبات محجوزة: {fmtYer(treasury?.withdrawalReservedTotal)}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70">
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                الأموال المحجوزة في ضمان المهام
              </span>
              <div className="text-lg font-extrabold font-mono tabular-nums text-blue-600 dark:text-blue-400">
                {fmtYer(taskEscrowReserved)} <span className="text-xs font-normal">ر.ي</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                مكافآت المهام المعتمدة: {fmtYer(stats?.totalApprovedRewards)} ر.ي
              </div>
            </div>
          </div>
        </div>

        {/* Virtual Units vs Real Cash Reconciliation */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-600" />
                <span>الوحدات الافتراضية وميزان المراجعة</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                وحدات دفترية مغلقة لتشغيل المهام والمحافظ — منفصلة عن النقد الفعلي.
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                isReconciled
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}
            >
              {isReconciled ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              <span>{isReconciled ? 'ميزان المراجعة متطابق' : 'يتطلب مطابقة محاسبية'}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70">
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                إجمالي الوحدات الافتراضية الصادرة
              </span>
              <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                {fmtYer(virtualIssued)} <span className="text-xs font-normal">وحدة</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-1">VIRTUAL-ISSUANCE-CONTROL</div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70">
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                الرصيد الافتراضي المتاح بالخزينة
              </span>
              <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                {fmtYer(virtualTreasuryAvail)} <span className="text-xs font-normal">وحدة</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-1">
                مسحوبات مصروفة: {fmtYer(stats?.totalCompletedWithdrawals ?? treasury?.withdrawalSettledTotal)} ر.ي
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Pending Operational Queues */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="tabular-nums">إثباتات تنتظر التدقيق والاعتماد ({pendingSubmissionsCount})</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('submissions')}
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
            >
              فتح مكتب التدقيق
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            يوجد {pendingSubmissionsCount} إثبات مهمة مقدم من المستخدمين بانتظار المراجعة وصرف المكافأة من ضمان المهمة.
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-600" />
              <span className="tabular-nums">طلبات سحب بانتظار التحويل ({pendingWithdrawalsCount})</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('withdrawals')}
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
            >
              فتح طابور السحوبات
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            يوجد {pendingWithdrawalsCount} طلب سحب محجوز ومطلوب تحويله عبر الشبكات المحلية وتوثيق المرجع.
          </p>
        </div>
      </div>
    </div>
  );
};
