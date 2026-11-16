import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  RefreshCw,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import { api } from '../../../api/client.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import type { ComprehensiveFinancialReport, TreasurySummary } from '../../../types/index.ts';
import { MigrationReadinessBanner } from './MigrationReadinessBanner.tsx';

interface FinancialReportsViewProps {
  treasury: TreasurySummary | null;
}

type ReportTab =
  | 'pnl'
  | 'cashflow'
  | 'balance_sheet'
  | 'revenue'
  | 'expenses'
  | 'taxes'
  | 'withdrawals'
  | 'liabilities';

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'pnl', label: 'الأرباح والخسائر' },
  { id: 'cashflow', label: 'التدفقات النقدية' },
  { id: 'balance_sheet', label: 'الأصول والالتزامات وحقوق الملكية' },
  { id: 'revenue', label: 'الإيرادات حسب المصدر' },
  { id: 'expenses', label: 'تقرير المصروفات' },
  { id: 'taxes', label: 'تقرير الضرائب' },
  { id: 'withdrawals', label: 'مسحوبات المالك' },
  { id: 'liabilities', label: 'أرصدة المستخدمين والضمانات' },
];

const fmt = (n: number | undefined | null) => Math.round(Number(n || 0)).toLocaleString('en-US');

export const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({ treasury }) => {
  const { showToast } = useAuth();
  const [activeReport, setActiveReport] = useState<ReportTab>('pnl');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [report, setReport] = useState<ComprehensiveFinancialReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const loadReports = async (fromVal = fromDate, toVal = toDate) => {
    setIsLoading(true);
    try {
      const res = await api.getComprehensiveFinancialReports({
        from: fromVal || undefined,
        to: toVal || undefined,
      });
      setReport(res?.report || null);
    } catch (err: any) {
      showToast(err.message || 'فشل تحميل التقارير المالية.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports('', '');
  }, []);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    loadReports(fromDate, toDate);
  };

  const handleClearFilter = () => {
    setFromDate('');
    setToDate('');
    loadReports('', '');
  };

  const handleExportCurrent = async () => {
    setIsExporting(true);
    try {
      await api.downloadFinancialCsv(activeReport, {
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      showToast('تم تصدير التقرير بصيغة CSV المتوافقة مع Excel بنجاح.', 'success');
    } catch (err: any) {
      showToast(err.message || 'فشل تصدير التقرير.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <MigrationReadinessBanner treasury={treasury} />

      {/* Filter & Export Header */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>التقارير والقوائم المالية الشاملة (8 تقارير حية)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              مفلترة حسب التاريخ ومصدرة مباشرة بترميز UTF-8 متوافق مع Excel.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportCurrent}
            disabled={isExporting || isLoading}
            className="px-3.5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{isExporting ? 'جارِ التصدير...' : 'تصدير التقرير الحالي (CSV / Excel)'}</span>
          </button>
        </div>

        {/* Date Filter */}
        <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>من تاريخ</span>
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-1.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>إلى تاريخ</span>
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-1.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 font-bold bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تطبيق الفترة</span>
          </button>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              إظهار كل الفترات
            </button>
          )}
        </form>

        {/* 8 Reports Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2">
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveReport(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                activeReport === t.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Report Body */}
      {isLoading || !report ? (
        <div className="p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="h-5 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        </div>
      ) : (
        <>
          {/* 1. Profit & Loss */}
          {activeReport === 'pnl' && (
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">قائمة الأرباح والخسائر (Profit & Loss Statement)</h3>
                <span className="text-xs font-mono text-slate-400">العملة: YER</span>
              </div>
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">البند المحاسبي</th>
                    <th className="py-2.5 px-4">التصنيف</th>
                    <th className="py-2.5 px-4 font-mono">المبلغ (ر.ي)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">إيرادات عمولات المهام</td>
                    <td className="py-2.5 px-4 text-emerald-600">إيراد تشغيلي</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(report.profitAndLoss.revenueTasks)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">إيرادات الإعلانات والرعاية</td>
                    <td className="py-2.5 px-4 text-emerald-600">إيراد تشغيلي</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(report.profitAndLoss.revenueAds)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">إيرادات الاشتراكات</td>
                    <td className="py-2.5 px-4 text-emerald-600">إيراد تشغيلي</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(report.profitAndLoss.revenueSubscriptions)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">إيرادات الخدمات ورسوم السحب</td>
                    <td className="py-2.5 px-4 text-emerald-600">إيراد تشغيلي</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(report.profitAndLoss.revenueServices)}</td>
                  </tr>
                  <tr className="bg-emerald-50/50 dark:bg-emerald-950/20 font-bold">
                    <td className="py-2.5 px-4">إجمالي الإيرادات المحققة</td>
                    <td className="py-2.5 px-4">—</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {fmt(report.profitAndLoss.totalRevenue)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">المصروفات التشغيلية العامة</td>
                    <td className="py-2.5 px-4 text-rose-600">مصروف</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-rose-600">
                      ({fmt(report.profitAndLoss.operationalExpenses)})
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">عمولات مزودي الدفع والصرافة</td>
                    <td className="py-2.5 px-4 text-rose-600">مصروف</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-rose-600">
                      ({fmt(report.profitAndLoss.paymentProviderFees)})
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">الضرائب المثبتة (بإقرار المالك)</td>
                    <td className="py-2.5 px-4 text-rose-600">ضريبة</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-rose-600">
                      ({fmt(report.profitAndLoss.taxExpenses)})
                    </td>
                  </tr>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 font-extrabold text-sm">
                    <td className="py-3 px-4">صافي الربح / (الخسارة) للفترة</td>
                    <td className="py-3 px-4">—</td>
                    <td
                      className={`py-3 px-4 font-mono tabular-nums ${
                        report.profitAndLoss.netProfitLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {fmt(report.profitAndLoss.netProfitLoss)} ر.ي
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500">
                ملاحظة إيضاحية: تم صرف مكافآت مهام للمستخدمين من أموال الضمان المحجوزة بقيمة{' '}
                <span className="font-mono font-bold">{fmt(report.profitAndLoss.taskRewardsDisbursedNote)}</span> ر.ي خلال الفترة (لا تدخل في أرباح المنصة).
              </p>
            </div>
          )}

          {/* 2. Cash Flow */}
          {activeReport === 'cashflow' && (
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
                قائمة التدفقات النقدية (Cash Flow Statement)
              </h3>
              <table className="w-full text-right text-xs">
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">التدفقات النقدية التشغيلية الداخلة (إيرادات نقدية)</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-emerald-600">
                      +{fmt(report.cashFlow.operatingCashInflows)} ر.ي
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">التدفقات النقدية التشغيلية الخارجة (مصروفات وضرائب)</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-rose-600">
                      -{fmt(report.cashFlow.operatingCashOutflows)} ر.ي
                    </td>
                  </tr>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                    <td className="py-2.5 px-4">صافي التدفق النقدي من الأنشطة التشغيلية</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{fmt(report.cashFlow.netOperatingCashFlow)} ر.ي</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">تدفقات إيداع رأس مال المالك</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-emerald-600">
                      +{fmt(report.cashFlow.ownerCapitalInflows)} ر.ي
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-semibold">تدفقات مسحوبات المالك الشخصية</td>
                    <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-amber-600">
                      -{fmt(report.cashFlow.ownerWithdrawalsOutflows)} ر.ي
                    </td>
                  </tr>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                    <td className="py-2.5 px-4">صافي التدفق التمويلي</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{fmt(report.cashFlow.netFinancingCashFlow)} ر.ي</td>
                  </tr>
                  <tr className="bg-emerald-50/60 dark:bg-emerald-950/20 font-extrabold">
                    <td className="py-3 px-4">الرصيد النقدي الفعلي الحالي في خزينة المنصة (PLATFORM-CASH-VAULT)</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmt(report.cashFlow.endingCashVaultBalance)} ر.ي
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-500">الوحدات الافتراضية المتاحة بالتشغيل (مفصولة عن النقد)</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {fmt(report.cashFlow.virtualTreasuryAvailable)} وحدة
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 3. Balance Sheet */}
          {activeReport === 'balance_sheet' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  الأصول (Assets)
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>النقد الفعلي بالخزينة (Vault)</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.assets.cashVault)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>أرصدة الحسابات الخارجية (EXT-ACC)</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.assets.externalAccounts)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>رقابة الوحدات الافتراضية (مفصل)</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.assets.virtualIssuanceControl)} وحدة</strong>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between font-extrabold">
                    <span>إجمالي الأصول النقدية والخارجية</span>
                    <span className="font-mono tabular-nums text-emerald-600">{fmt(report.balanceSheet.assets.totalRealAssets)} ر.ي</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-blue-700 dark:text-blue-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  الالتزامات للغير (Liabilities — مفصولة عن الأرباح)
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>محافظ المعلنين (التزامات)</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.liabilities.advertiserWalletBalances)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>محافظ المستخدمين المنفذين</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.liabilities.workerWalletBalances ?? report.balanceSheet.liabilities.userWalletBalances)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>ضمان الحملات الإعلانية (مكافآت + رسوم)</span>
                    <strong className="font-mono tabular-nums">
                      {fmt((report.balanceSheet.liabilities.campaignBudgetEscrows || 0) + (report.balanceSheet.liabilities.campaignFeeEscrows || 0))} ر.ي
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>سحوبات محجوزة + ضمان المهام الإدارية</span>
                    <strong className="font-mono tabular-nums">
                      {fmt((report.balanceSheet.liabilities.withdrawalReserved || 0) + (report.balanceSheet.liabilities.taskEscrowBalances || 0))} ر.ي
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>ضرائب مستحقة الدفع</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.liabilities.taxesPayable)} ر.ي</strong>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between font-extrabold">
                    <span>إجمالي التزامات المعلنين والمستخدمين</span>
                    <span className="font-mono tabular-nums text-blue-600">{fmt(report.balanceSheet.liabilities.totalUserAndExternalLiabilities)} ر.ي</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                  حقوق الملكية للمالك (Equity)
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>رأس مال المالك</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.equity.ownerCapital)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>الأرباح المحتجزة المرحلة</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.equity.retainedEarningsAccount)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>صافي الدخل المتراكم</span>
                    <strong className="font-mono tabular-nums">{fmt(report.balanceSheet.equity.currentNetIncome)} ر.ي</strong>
                  </div>
                  <div className="flex justify-between text-amber-600">
                    <span>ناقصاً: مسحوبات المالك</span>
                    <strong className="font-mono tabular-nums">({fmt(report.balanceSheet.equity.ownerWithdrawals)}) ر.ي</strong>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between font-extrabold">
                    <span>صافي حقوق ملكية المالك</span>
                    <span className="font-mono tabular-nums">{fmt(report.balanceSheet.equity.totalOwnerEquity)} ر.ي</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Revenue by Source */}
          {activeReport === 'revenue' && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">كود الحساب</th>
                    <th className="py-3 px-4">مصدر الإيراد</th>
                    <th className="py-3 px-4 font-mono">إيراد الفترة (ر.ي)</th>
                    <th className="py-3 px-4 font-mono">الرصيد التراكمي (ر.ي)</th>
                    <th className="py-3 px-4 font-mono">عدد القيود</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.revenueBySource.map((r) => (
                    <tr key={r.accountCode}>
                      <td className="py-3 px-4 font-mono text-[11px]" dir="ltr">{r.accountCode}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{r.label}</td>
                      <td className="py-3 px-4 font-mono font-bold tabular-nums text-emerald-600">{fmt(r.periodAmount)}</td>
                      <td className="py-3 px-4 font-mono font-bold tabular-nums">{fmt(r.cumulativeBalance)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{r.txCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 5. Expenses Report */}
          {activeReport === 'expenses' && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">التاريخ</th>
                    <th className="py-3 px-4">التصنيف</th>
                    <th className="py-3 px-4">الحساب</th>
                    <th className="py-3 px-4">البيان</th>
                    <th className="py-3 px-4 font-mono">المبلغ (ر.ي)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.expensesItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        لا توجد مصروفات تشغيلية مسجلة في هذه الفترة.
                      </td>
                    </tr>
                  ) : (
                    report.expensesItems.map((e, idx) => (
                      <tr key={`${e.transactionId}-${idx}`}>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                          {new Date(e.date).toLocaleString('ar-YE')}
                        </td>
                        <td className="py-2.5 px-4 font-semibold">{e.category}</td>
                        <td className="py-2.5 px-4 font-mono text-[11px]" dir="ltr">{e.accountCode}</td>
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{e.description}</td>
                        <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-rose-600">{fmt(e.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 6. Taxes Report */}
          {activeReport === 'taxes' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">رصيد الضرائب المستحقة (TAX-PAYABLE)</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums">{fmt(report.taxesReport.taxPayableBalance)} ر.ي</div>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">ضرائب مستحقة خلال الفترة</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums text-amber-600">{fmt(report.taxesReport.totalAccruedInPeriod)} ر.ي</div>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">ضرائب مدفوعة خلال الفترة</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-600">{fmt(report.taxesReport.totalSettledInPeriod)} ر.ي</div>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">نوع الضريبة</th>
                      <th className="py-3 px-4">الجهة</th>
                      <th className="py-3 px-4 font-mono">الوعاء الخاضع</th>
                      <th className="py-3 px-4 font-mono">قيمة الضريبة</th>
                      <th className="py-3 px-4">الحالة</th>
                      <th className="py-3 px-4">المرجع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.taxesReport.settlements.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          لا توجد تسويات أو التزامات ضريبية مسجلة في هذه الفترة.
                        </td>
                      </tr>
                    ) : (
                      report.taxesReport.settlements.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 px-4 font-bold">{s.taxType || 'ضريبة'}</td>
                          <td className="py-2.5 px-4">{s.taxAuthority || '---'}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums">{fmt(s.taxableAmount)}</td>
                          <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(s.taxAmount)}</td>
                          <td className="py-2.5 px-4">{s.status === 'SETTLED' ? 'مدفوعة' : 'مستحقة'}</td>
                          <td className="py-2.5 px-4 font-mono text-[11px]">{s.referenceId || '---'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 7. Owner Withdrawals Report */}
          {activeReport === 'withdrawals' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">مسحوبات المالك خلال الفترة</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums text-amber-600">{fmt(report.ownerWithdrawalsReport.totalInPeriod)} ر.ي</div>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">إجمالي مسحوبات المالك التراكمي</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums">{fmt(report.ownerWithdrawalsReport.cumulativeTotal)} ر.ي</div>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">التاريخ</th>
                      <th className="py-3 px-4">البيان</th>
                      <th className="py-3 px-4">المنفذ</th>
                      <th className="py-3 px-4 font-mono">المبلغ (ر.ي)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.ownerWithdrawalsReport.items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          لا توجد مسحوبات شخصية للمالك في هذه الفترة.
                        </td>
                      </tr>
                    ) : (
                      report.ownerWithdrawalsReport.items.map((w) => (
                        <tr key={w.transactionId}>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">{new Date(w.date).toLocaleString('ar-YE')}</td>
                          <td className="py-2.5 px-4 font-semibold">{w.description}</td>
                          <td className="py-2.5 px-4">{w.actorName || 'المالك'}</td>
                          <td className="py-2.5 px-4 font-mono font-bold tabular-nums text-amber-600">{fmt(w.amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. User Balances & Task Escrows Report */}
          {activeReport === 'liabilities' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">إجمالي محافظ المستخدمين</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums">{fmt(report.userBalancesAndEscrowsReport.totalUserWallets)} ر.ي</div>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">سحوبات محجوزة قيد المعالجة</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums text-amber-600">{fmt(report.userBalancesAndEscrowsReport.totalWithdrawalReserved)} ر.ي</div>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block mb-1">إجمالي أموال ضمان المهام</span>
                  <div className="text-xl font-extrabold font-mono tabular-nums text-blue-600">{fmt(report.userBalancesAndEscrowsReport.totalTaskEscrows)} ر.ي</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 font-bold text-xs">
                    أرصدة محافظ المستخدمين ({report.userBalancesAndEscrowsReport.users.length})
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                        <tr>
                          <th className="py-2 px-3">المستخدم</th>
                          <th className="py-2 px-3">الهاتف</th>
                          <th className="py-2 px-3 font-mono">الرصيد (ر.ي)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {report.userBalancesAndEscrowsReport.users.map((u) => (
                          <tr key={u.accountCode}>
                            <td className="py-2 px-3 font-semibold">{u.fullName}</td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{u.phone}</td>
                            <td className="py-2 px-3 font-mono font-bold tabular-nums">{fmt(u.balanceUnits)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 font-bold text-xs">
                    حسابات ضمان المهام (TASK-ESCROW) ({report.userBalancesAndEscrowsReport.escrows.length})
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                        <tr>
                          <th className="py-2 px-3">المهمة</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3 font-mono">الرصيد المحجوز</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {report.userBalancesAndEscrowsReport.escrows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-6 text-center text-slate-400">
                              لا توجد أرصدة ضمان مهام محجوزة حالياً.
                            </td>
                          </tr>
                        ) : (
                          report.userBalancesAndEscrowsReport.escrows.map((e) => (
                            <tr key={e.accountCode}>
                              <td className="py-2 px-3 font-semibold">{e.taskTitle}</td>
                              <td className="py-2 px-3 text-[11px]">{e.taskStatus}</td>
                              <td className="py-2 px-3 font-mono font-bold tabular-nums text-blue-600">{fmt(e.balanceUnits)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
