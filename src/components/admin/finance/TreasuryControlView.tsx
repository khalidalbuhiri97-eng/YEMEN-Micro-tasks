import React, { useEffect, useState } from 'react';
import {
  Landmark,
  ShieldCheck,
  AlertTriangle,
  Coins,
  PlusCircle,
  MinusCircle,
  TrendingUp,
  Wallet,
  RefreshCw,
  ArrowUpDown,
} from 'lucide-react';
import { api } from '../../../api/client.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import type { FinancialAccountItem, TreasuryMovement, TreasurySummary } from '../../../types/index.ts';
import { MigrationReadinessBanner } from './MigrationReadinessBanner.tsx';

interface TreasuryControlViewProps {
  treasury: TreasurySummary | null;
  onRefreshAll: () => Promise<void>;
}

type OpMode = 'CAPITAL' | 'EXPENSE' | 'OWNER_WITHDRAWAL' | 'REVENUE' | 'ISSUE_VIRTUAL';

const fmt = (n: number | undefined | null) => Math.round(Number(n || 0)).toLocaleString('en-US');

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  treasury: 'خزينة تشغيلية',
  asset: 'أصل نقدي',
  control: 'مراقبة إصدار',
  wallet: 'محفظة مستخدم',
  escrow: 'ضمان مهمة',
  revenue: 'إيراد منصة',
  expense: 'مصروف تشغيلي',
  liability: 'التزام',
  equity: 'حقوق ملكية',
};

export const TreasuryControlView: React.FC<TreasuryControlViewProps> = ({ treasury, onRefreshAll }) => {
  const { user, showToast, openConfirmModal } = useAuth();
  const [opMode, setOpMode] = useState<OpMode>('CAPITAL');

  // Form states
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('تشغيل واستضافة');
  const [revenueSource, setRevenueSource] = useState<'ADS' | 'SUBSCRIPTIONS' | 'SERVICES'>('ADS');
  const [creditToTreasury, setCreditToTreasury] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Accounts & movements
  const [accounts, setAccounts] = useState<FinancialAccountItem[]>([]);
  const [movements, setMovements] = useState<TreasuryMovement[]>([]);
  const [accountFilter, setAccountFilter] = useState<'ALL' | 'PLATFORM-CASH-VAULT' | 'PLATFORM-TREASURY'>('ALL');
  const [accountsSearch, setAccountsSearch] = useState('');
  const [loadingSubData, setLoadingSubData] = useState(true);

  const loadTreasuryDetails = async () => {
    setLoadingSubData(true);
    try {
      const [accRes, movRes] = await Promise.all([
        api.getFinancialAccounts().catch(() => ({ accounts: [] })),
        api.getTreasuryMovements(80).catch(() => ({ movements: [] })),
      ]);
      const mappedAccs: FinancialAccountItem[] = (accRes?.accounts || []).map((a: any) => ({
        id: a.id,
        accountCode: a.account_code,
        accountType: a.account_type,
        normalSide: a.normal_side,
        balanceUnits: Number(a.balance_units || 0),
        status: a.status,
        createdAt: a.created_at,
      }));
      setAccounts(mappedAccs);
      setMovements(movRes?.movements || []);
    } finally {
      setLoadingSubData(false);
    }
  };

  useEffect(() => {
    loadTreasuryDetails();
  }, []);

  const handleSubmitOperation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') {
      showToast('هذه العمليات مقيدة بمالك المنصة فقط.', 'error');
      return;
    }

    const numAmount = Math.round(Number(amount));
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      showToast('يرجى إدخال مبلغ صحيح موجب أكبر من صفر.', 'error');
      return;
    }
    if (!reason.trim()) {
      showToast('البيان المحاسبي والسبب إلزامي لتوثيق القيد.', 'error');
      return;
    }

    const opMeta: Record<
      OpMode,
      { title: string; confirmLabel: string; variant: 'primary' | 'warning' | 'danger'; summaryText: string }
    > = {
      CAPITAL: {
        title: 'تأكيد إيداع رأس مال المالك',
        confirmLabel: 'تأكيد الإيداع',
        variant: 'primary',
        summaryText: `سيتم قيد إيداع رأس مال بمبلغ ${fmt(numAmount)} ر.ي في الخزينة النقدية وحقوق الملكية.`,
      },
      EXPENSE: {
        title: 'تأكيد تسجيل مصروف تشغيلي',
        confirmLabel: 'تأكيد الخصم والتسجيل',
        variant: 'warning',
        summaryText: `سيتم خصم ${fmt(numAmount)} ر.ي كمصروف تشغيلي (${expenseCategory}) وتوثيقه بالقيد المزدوج.`,
      },
      OWNER_WITHDRAWAL: {
        title: 'تأكيد تسجيل سحب شخصي للمالك',
        confirmLabel: 'تأكيد السحب',
        variant: 'warning',
        summaryText: `سيتم تسجيل سحب شخصي للمالك بمبلغ ${fmt(numAmount)} ر.ي وخصمه من الرصيد المتاح.`,
      },
      REVENUE: {
        title: 'تأكيد تسجيل إيراد منصة',
        confirmLabel: 'تأكيد تسجيل الإيراد',
        variant: 'primary',
        summaryText: `سيتم إثبات إيراد (${revenueSource}) بمبلغ ${fmt(numAmount)} ر.ي في الخزينة النقدية.`,
      },
      ISSUE_VIRTUAL: {
        title: 'تأكيد إصدار وحدات افتراضية للخزينة',
        confirmLabel: 'تأكيد الإصدار',
        variant: 'warning',
        summaryText: `سيتم إصدار ${fmt(numAmount)} وحدة افتراضية في دفتر الأستاذ السيادي (لا يضاف للنقد الفعلي).`,
      },
    };

    const meta = opMeta[opMode];
    openConfirmModal({
      title: meta.title,
      message: `${meta.summaryText} البيان: "${reason.trim()}"`,
      confirmLabel: meta.confirmLabel,
      cancelLabel: 'إلغاء',
      variant: meta.variant,
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          if (opMode === 'CAPITAL') {
            await api.postOwnerCapital({ amount: numAmount, reason: reason.trim() });
            showToast('تم إيداع رأس مال المالك وتسجيل القيد بنجاح.', 'success');
          } else if (opMode === 'EXPENSE') {
            await api.postOperationalExpense({
              amount: numAmount,
              reason: reason.trim(),
              category: expenseCategory,
            });
            showToast('تم تسجيل المصروف التشغيلي بنجاح.', 'success');
          } else if (opMode === 'OWNER_WITHDRAWAL') {
            await api.postOwnerWithdrawal({ amount: numAmount, reason: reason.trim() });
            showToast('تم توثيق السحب الشخصي للمالك بنجاح.', 'success');
          } else if (opMode === 'REVENUE') {
            await api.postPlatformRevenue({
              source: revenueSource,
              amount: numAmount,
              reason: reason.trim(),
              creditToTreasury,
            });
            showToast('تم تسجيل الإيراد المحقق في دفتر الأستاذ بنجاح.', 'success');
          } else {
            await api.issueTreasuryUnits({ amount: numAmount, reason: reason.trim() });
            showToast('تم إصدار الوحدات الافتراضية للخزينة بنجاح.', 'success');
          }
          setAmount('');
          setReason('');
          await Promise.all([onRefreshAll(), loadTreasuryDetails()]);
        } catch (err: any) {
          showToast(err.message || 'فشل تنفيذ العملية المالية.', 'error');
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const filteredMovements = movements.filter(
    (m) => accountFilter === 'ALL' || m.accountCode === accountFilter
  );

  const visibleAccounts = accounts.filter((a) => {
    if (!accountsSearch.trim()) return true;
    const q = accountsSearch.trim().toLowerCase();
    return (
      a.accountCode.toLowerCase().includes(q) ||
      a.accountType.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <MigrationReadinessBanner treasury={treasury} />

      {/* Top Grid: Summary + Owner Operation Executor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Live Vault & Treasury Summary + Chart of Accounts */}
        <div className="lg:col-span-7 space-y-5">
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-emerald-600" />
                  <span>أرصدة الخزينة الرئيسية والرقابة السيادية</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  تتم جميع التعديلات حصرياً عبر قيود مزدوجة غير قابلة للتعديل المباشر.
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  treasury?.isReconciled
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}
              >
                {treasury?.isReconciled ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                <span>{treasury?.isReconciled ? 'الميزان متطابق 100%' : 'يوجد فرق بالميزان'}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/50">
                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block mb-1">النقد الفعلي (Vault)</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-800 dark:text-emerald-300">
                  {fmt(treasury?.cashVaultTotal)} <span className="text-[11px] font-normal">ر.ي</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">رأس مال المالك</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                  {fmt(treasury?.ownerCapitalTotal)} <span className="text-[11px] font-normal">ر.ي</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">المصروفات التشغيلية</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  {fmt(treasury?.totalOperationalExpenses)} <span className="text-[11px] font-normal">ر.ي</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">الخزينة التشغيلية المتاحة</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                  {fmt(treasury?.treasuryAvailable)} <span className="text-[11px] font-normal">وحدة</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">الوحدات الافتراضية الصادرة</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                  {fmt(treasury?.totalIssuedUnits)} <span className="text-[11px] font-normal">وحدة</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">مسحوبات المالك</span>
                <div className="text-lg font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {fmt(treasury?.ownerWithdrawalsTotal)} <span className="text-[11px] font-normal">ر.ي</span>
                </div>
              </div>
            </div>
          </div>

          {/* Chart of Accounts Live Table */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">دليل الحسابات المالية الحي (Chart of Accounts)</h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={accountsSearch}
                  onChange={(e) => setAccountsSearch(e.target.value)}
                  placeholder="بحث بكود أو نوع الحساب..."
                  className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={loadTreasuryDetails}
                  className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg"
                  title="تحديث الحسابات"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-lg">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">كود الحساب</th>
                    <th className="py-2.5 px-3">التصنيف</th>
                    <th className="py-2.5 px-3">الطبيعة</th>
                    <th className="py-2.5 px-3 font-mono">الرصيد (ر.ي)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loadingSubData ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400">
                        جارِ تحميل دليل الحسابات...
                      </td>
                    </tr>
                  ) : visibleAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400">
                        لا توجد حسابات مطابقة للبحث.
                      </td>
                    </tr>
                  ) : (
                    visibleAccounts.map((acc) => (
                      <tr key={acc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200" dir="ltr">
                          {acc.accountCode}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                          {ACCOUNT_TYPE_LABELS[acc.accountType] || acc.accountType}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                          {acc.normalSide === 'debit' ? 'مدين (Debit)' : 'دائن (Credit)'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                          {fmt(acc.balanceUnits)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Single-Owner Treasury Operation Form */}
        <div className="lg:col-span-5">
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                تنفيذ عملية خزينة مالك المنصة
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                جميع العمليات تمر عبر مسارات الخادم المؤمنة وتُسجل بقيد مزدوج متوازن في دفتر الأستاذ.
              </p>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
              {[
                { id: 'CAPITAL', label: 'إيداع رأس مال', icon: PlusCircle },
                { id: 'EXPENSE', label: 'مصروف تشغيلي', icon: MinusCircle },
                { id: 'OWNER_WITHDRAWAL', label: 'سحب للمالك', icon: Wallet },
                { id: 'REVENUE', label: 'إيراد آخر', icon: TrendingUp },
                { id: 'ISSUE_VIRTUAL', label: 'إصدار افتراضي', icon: Coins },
              ].map((m) => {
                const Icon = m.icon;
                const active = opMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setOpMode(m.id as OpMode)}
                    className={`px-2.5 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSubmitOperation} className="space-y-4">
              {opMode === 'EXPENSE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    تصنيف المصروف التشغيلي
                  </label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="تشغيل واستضافة">تشغيل واستضافة وخوادم</option>
                    <option value="رواتب ومكافآت فريق">رواتب ومكافآت فريق العمل</option>
                    <option value="تسويق وإعلانات">تسويق وإعلانات</option>
                    <option value="رسوم قانونية وإدارية">رسوم قانونية وإدارية</option>
                    <option value="مصروفات تشغيلية أخرى">مصروفات تشغيلية أخرى</option>
                  </select>
                </div>
              )}

              {opMode === 'REVENUE' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      مصدر الإيراد
                    </label>
                    <select
                      value={revenueSource}
                      onChange={(e) => setRevenueSource(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      <option value="ADS">إيرادات الإعلانات والرعاية (PLATFORM-REVENUE-ADS)</option>
                      <option value="SUBSCRIPTIONS">إيرادات الاشتراكات (PLATFORM-REVENUE-SUBSCRIPTIONS)</option>
                      <option value="SERVICES">إيرادات خدمات إضافية (PLATFORM-REVENUE-SERVICES)</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={creditToTreasury}
                      onChange={(e) => setCreditToTreasury(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>تغطية وتغذية رصيد الخزينة التشغيلية مقابل هذا الإيراد أيضاً</span>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  المبلغ (ر.ي)
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="مثال: 100000"
                  className="w-full px-3 py-2.5 text-sm font-mono font-bold tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  البيان المحاسبي والسبب (إلزامي للتدقيق)
                </label>
                <textarea
                  rows={3}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="اكتب وصفاً واضحاً للعملية المراد تسجيلها في دفتر الأستاذ..."
                  className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {!treasury?.migration011Ready && opMode !== 'ISSUE_VIRTUAL' && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
                  ملاحظة: تنفيذ هذه العملية يتطلب وجود حسابات الترحيل 011 (مثل PLATFORM-CASH-VAULT و OWNER-CAPITAL) في قاعدة البيانات الحية.
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors"
              >
                {isSubmitting ? 'جارِ التنفيذ والتوثيق...' : 'مراجعة وتنفيذ العملية'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Treasury Before & After Balance History Table */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-emerald-600" />
              <span>سجل حركات الخزينة والنقد مع الرصيد قبل وبعد كل عملية</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              يوضح الأثر التراكمي الدقيق على حسابي الخزينة النقدية (PLATFORM-CASH-VAULT) والخزينة التشغيلية (PLATFORM-TREASURY).
            </p>
          </div>

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value as any)}
            className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">جميع حسابات الخزينة</option>
            <option value="PLATFORM-CASH-VAULT">الخزينة النقدية الفعلية (PLATFORM-CASH-VAULT)</option>
            <option value="PLATFORM-TREASURY">الخزينة التشغيلية (PLATFORM-TREASURY)</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">التاريخ والوقت</th>
                <th className="py-2.5 px-3">الحساب</th>
                <th className="py-2.5 px-3">نوع العملية</th>
                <th className="py-2.5 px-3">البيان</th>
                <th className="py-2.5 px-3 font-mono">الرصيد قبل</th>
                <th className="py-2.5 px-3 font-mono">التغير</th>
                <th className="py-2.5 px-3 font-mono">الرصيد بعد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loadingSubData ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    جارِ تحميل حركات الخزينة...
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    لا توجد حركات مسجلة لهذا الحساب حتى الآن.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m, idx) => (
                  <tr key={`${m.transactionId}-${m.accountCode}-${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString('ar-YE')}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300" dir="ltr">
                      {m.accountCode}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                      {m.transactionType}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate" title={m.description}>
                      {m.description}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                      {fmt(m.beforeBalance)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono font-bold tabular-nums ${
                        m.signedDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {m.signedDelta >= 0 ? `+${fmt(m.signedDelta)}` : fmt(m.signedDelta)}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {fmt(m.afterBalance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
