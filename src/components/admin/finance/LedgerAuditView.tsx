import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Search,
  RotateCcw,
  Eye,
  Download,
  RefreshCw,
  ShieldAlert,
  X,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../../api/client.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import type { FinancialAuditLog, LedgerTransaction } from '../../../types/index.ts';

interface LedgerAuditViewProps {
  onRefreshAll: () => Promise<void>;
}

const fmt = (n: number | undefined | null) => Math.round(Number(n || 0)).toLocaleString('en-US');

export const LedgerAuditView: React.FC<LedgerAuditViewProps> = ({ onRefreshAll }) => {
  const { user, showToast, openConfirmModal } = useAuth();
  const [subView, setSubView] = useState<'ledger' | 'audit'>('ledger');

  // Filters
  const [search, setSearch] = useState('');
  const [transactionType, setTransactionType] = useState('ALL');
  const [accountCode, setAccountCode] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Data
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<FinancialAuditLog[]>([]);
  const [auditTableReady, setAuditTableReady] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Modals
  const [selectedTx, setSelectedTx] = useState<LedgerTransaction | null>(null);
  const [reversingTx, setReversingTx] = useState<LedgerTransaction | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  const loadLedgerData = async () => {
    setIsLoading(true);
    try {
      const [ledgerRes, auditRes] = await Promise.all([
        api.getLedger({
          limit: 200,
          transactionType: transactionType !== 'ALL' ? transactionType : undefined,
          accountCode: accountCode !== 'ALL' ? accountCode : undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          search: search.trim() || undefined,
        }),
        api.getFinancialAuditLogs(100).catch(() => ({ auditTableReady: false, logs: [] })),
      ]);
      setTransactions(ledgerRes?.transactions || []);
      setAuditLogs(auditRes?.logs || []);
      setAuditTableReady(Boolean(auditRes?.auditTableReady));
    } catch (err: any) {
      showToast(err.message || 'فشل تحميل قيود دفتر الأستاذ.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedgerData();
  }, [transactionType, accountCode]);

  const handleApplySearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadLedgerData();
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      await api.downloadFinancialCsv('ledger', {
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      showToast('تم تصدير دفتر الأستاذ بصيغة CSV بنجاح.', 'success');
    } catch (err: any) {
      showToast(err.message || 'فشل تصدير دفتر الأستاذ.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExecuteReversal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') {
      showToast('غير مصرح لك بتنفيذ قيود عكسية.', 'error');
      return;
    }
    if (!reversingTx || !reversalReason.trim()) {
      showToast('يرجى إدخال سبب القيد العكسي الموثق.', 'error');
      return;
    }

    const targetTx = reversingTx;
    const cleanReason = reversalReason.trim();
    openConfirmModal({
      title: 'تأكيد إنشاء قيد عكسي محاسبي',
      message: `سيتم إنشاء قيد عكسي جديد يعكس كافة أرصدة القيد (${targetTx.id.slice(0, 8)}...) بقيمة ${fmt(targetTx.totalAmount)} ر.ي دون حذف القيد الأصلي. السبب: "${cleanReason}"`,
      confirmLabel: 'تأكيد القيد العكسي',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.reverseLedgerTransaction({
            transactionId: targetTx.id,
            reason: cleanReason,
          });
          showToast('تم تسجيل القيد العكسي في دفتر الأستاذ وتحديث الأرصدة بنجاح.', 'success');
          setReversingTx(null);
          setReversalReason('');
          await Promise.all([loadLedgerData(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل تنفيذ القيد العكسي.', 'error');
        }
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Top Bar & Sub-navigation */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <span>دفتر الأستاذ العام والمراجعة المحاسبية (Immutable General Ledger)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              سجل مقيد غير قابل للتعديل أو الحذف — أي تصحيح يتم عبر قيد عكسي موثق.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setSubView('ledger')}
                className={`px-3 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap ${
                  subView === 'ledger'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                دفتر القيود ({transactions.length})
              </button>
              <button
                type="button"
                onClick={() => setSubView('audit')}
                className={`px-3 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap ${
                  subView === 'audit'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                سجل التدقيق المالي ({auditLogs.length})
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExporting}
              className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? 'جارِ التصدير...' : 'تصدير CSV'}</span>
            </button>
          </div>
        </div>

        {/* Filters Form (shown for Ledger view) */}
        {subView === 'ledger' && (
          <form onSubmit={handleApplySearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="lg:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالرقم، البيان، المرجع، المنفذ..."
                className="w-full pr-8 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">كل أنواع العمليات</option>
              <option value="TREASURY_ISSUANCE">إصدار وحدات خزينة</option>
              <option value="OWNER_CAPITAL_DEPOSIT">إيداع رأس مال</option>
              <option value="OPERATIONAL_EXPENSE">مصروف تشغيلي</option>
              <option value="OWNER_WITHDRAWAL">سحب للمالك</option>
              <option value="TASK_BUDGET_RESERVATION">حجز ميزانية مهمة</option>
              <option value="TASK_REWARD_PAYOUT">صرف مكافأة مهمة</option>
              <option value="TASK_COMMISSION_REVENUE">عمولة مهمة</option>
              <option value="TASK_BUDGET_REFUND">تحرير ضمان مهمة</option>
              <option value="WITHDRAWAL_REQUEST">حجز طلب سحب</option>
              <option value="WITHDRAWAL_PAYOUT">إتمام صرف سحب</option>
              <option value="WITHDRAWAL_REFUND">استرجاع سحب مرفوض</option>
              <option value="AD_REVENUE">إيراد إعلانات</option>
              <option value="SUBSCRIPTION_REVENUE">إيراد اشتراكات</option>
              <option value="SERVICE_REVENUE">إيراد خدمات</option>
              <option value="TAX_ACCRUAL">استحقاق ضريبي</option>
              <option value="TAX_SETTLEMENT">سداد ضريبي</option>
              <option value="ADMIN_ADJUSTMENT">تسوية إدارية</option>
            </select>

            <select
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              className="px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">كل الحسابات</option>
              <option value="PLATFORM-CASH-VAULT">PLATFORM-CASH-VAULT</option>
              <option value="PLATFORM-TREASURY">PLATFORM-TREASURY</option>
              <option value="VIRTUAL-ISSUANCE-CONTROL">VIRTUAL-ISSUANCE-CONTROL</option>
              <option value="OWNER-CAPITAL">OWNER-CAPITAL</option>
              <option value="OWNER-WITHDRAWALS">OWNER-WITHDRAWALS</option>
              <option value="PLATFORM-EXPENSES">PLATFORM-EXPENSES</option>
              <option value="PLATFORM-REVENUE-TASKS">PLATFORM-REVENUE-TASKS</option>
              <option value="PLATFORM-REVENUE-ADS">PLATFORM-REVENUE-ADS</option>
              <option value="PLATFORM-REVENUE-SERVICES">PLATFORM-REVENUE-SERVICES</option>
              <option value="WITHDRAWAL-RESERVED">WITHDRAWAL-RESERVED</option>
              <option value="WITHDRAWAL-SETTLED">WITHDRAWAL-SETTLED</option>
              <option value="TAX-PAYABLE">TAX-PAYABLE</option>
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-2 py-2 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                title="من تاريخ"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-2 py-2 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                title="إلى تاريخ"
              />
            </div>

            <button
              type="submit"
              className="px-3 py-2 text-xs font-bold bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تطبيق الفلتر</span>
            </button>
          </form>
        )}
      </div>

      {/* Ledger Table */}
      {subView === 'ledger' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-3">رقم القيد</th>
                  <th className="py-3 px-3">التاريخ والوقت</th>
                  <th className="py-3 px-3">النوع والمصدر</th>
                  <th className="py-3 px-3">الطرف المدين (Debit)</th>
                  <th className="py-3 px-3">الطرف الدائن (Credit)</th>
                  <th className="py-3 px-3 font-mono">المبلغ</th>
                  <th className="py-3 px-3">المنفذ</th>
                  <th className="py-3 px-3">الحالة</th>
                  <th className="py-3 px-3 text-left">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={9} className="py-3.5 px-3">
                        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-400">
                      لا توجد قيود مطابقة لمعايير البحث في دفتر الأستاذ.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const debitEntries = (tx.entries || []).filter((e) => e.debitAmount > 0);
                    const creditEntries = (tx.entries || []).filter((e) => e.creditAmount > 0);
                    const isReversalTx = tx.transactionType.toUpperCase().startsWith('REVERSAL_');

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 align-top">
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap" dir="ltr">
                          {tx.id.slice(0, 8)}…
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleString('ar-YE')}
                        </td>
                        <td className="py-3 px-3 max-w-[200px]">
                          <div className="font-bold text-slate-900 dark:text-white">{tx.transactionType}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={tx.description}>
                            {tx.description}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300" dir="ltr">
                          {debitEntries.map((e) => (
                            <div key={e.id}>
                              {e.accountCode}: <span className="font-bold">{fmt(e.debitAmount)}</span>
                            </div>
                          ))}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300" dir="ltr">
                          {creditEntries.map((e) => (
                            <div key={e.id}>
                              {e.accountCode}: <span className="font-bold">{fmt(e.creditAmount)}</span>
                            </div>
                          ))}
                        </td>
                        <td className="py-3 px-3 font-mono font-extrabold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                          {fmt(tx.totalAmount)} <span className="text-[10px] font-normal text-slate-400">YER</span>
                        </td>
                        <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-slate-300">
                          {tx.createdByName || 'النظام'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {tx.isReversed ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                              تم عكسه
                            </span>
                          ) : isReversalTx ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300">
                              قيد عكسي
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                              مرحل ({tx.status || 'posted'})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-left whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedTx(tx)}
                              className="px-2 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>تفاصيل</span>
                            </button>
                            {!tx.isReversed && !isReversalTx && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReversingTx(tx);
                                  setReversalReason('');
                                }}
                                className="px-2 py-1 text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 rounded-md inline-flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>عكس</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Financial Audit Logs View */}
      {subView === 'audit' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {!auditTableReady && (
            <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                جدول <span className="font-mono">financial_audit_logs</span> بانتظار تنفيذ الترحيل 011 — يتم عرض سجل التدقيق الإداري الحي <span className="font-mono">admin_logs</span> حالياً.
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">التاريخ والوقت</th>
                  <th className="py-3 px-4">الإجراء الحساس</th>
                  <th className="py-3 px-4">المنفذ</th>
                  <th className="py-3 px-4">معرف القيد المرتبط</th>
                  <th className="py-3 px-4">التفاصيل الموثقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      لا توجد أحداث تدقيق مسجلة بعد.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('ar-YE')}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">
                        {log.actionType}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                        {log.actorName || log.actorId || 'النظام'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500" dir="ltr">
                        {log.transactionId ? `${log.transactionId.slice(0, 10)}…` : '---'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-md truncate" title={JSON.stringify(log.details)}>
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Transaction Details */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">تفاصيل القيد المحاسبي</h3>
                <p className="text-[11px] font-mono text-slate-500" dir="ltr">{selectedTx.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-lg">
              <div>
                <span className="text-slate-500">نوع العملية:</span>{' '}
                <strong className="text-slate-900 dark:text-white">{selectedTx.transactionType}</strong>
              </div>
              <div>
                <span className="text-slate-500">التاريخ:</span>{' '}
                <strong className="font-mono">{new Date(selectedTx.createdAt).toLocaleString('ar-YE')}</strong>
              </div>
              <div>
                <span className="text-slate-500">المنفذ:</span>{' '}
                <strong>{selectedTx.createdByName || 'النظام'}</strong>
              </div>
              <div>
                <span className="text-slate-500">مفتاح عدم التكرار (Idempotency):</span>{' '}
                <strong className="font-mono text-[11px]" dir="ltr">{selectedTx.idempotencyKey || '---'}</strong>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">البيان:</span>{' '}
                <strong className="text-slate-900 dark:text-white">{selectedTx.description}</strong>
              </div>
              {selectedTx.isReversed && (
                <div className="sm:col-span-2 flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تم عكس هذا القيد بالمعاملة رقم: <span className="font-mono">{selectedTx.reversedByTransactionId}</span></span>
                </div>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <tr>
                    <th className="py-2 px-3">الحساب</th>
                    <th className="py-2 px-3 font-mono">مدين (Debit)</th>
                    <th className="py-2 px-3 font-mono">دائن (Credit)</th>
                    <th className="py-2 px-3">الملاحظة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedTx.entries || []).map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 px-3 font-mono text-[11px] font-semibold" dir="ltr">{e.accountCode}</td>
                      <td className="py-2 px-3 font-mono tabular-nums text-emerald-600 font-bold">
                        {e.debitAmount > 0 ? fmt(e.debitAmount) : '---'}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-blue-600 font-bold">
                        {e.creditAmount > 0 ? fmt(e.creditAmount) : '---'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{e.memo || '---'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Accounting Reversal Reason */}
      {reversingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleExecuteReversal}
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-600" />
              <span>إنشاء قيد عكسي للمعاملة</span>
            </h3>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs space-y-1">
              <div>النوع: <strong>{reversingTx.transactionType}</strong></div>
              <div>المبلغ: <strong className="font-mono">{fmt(reversingTx.totalAmount)} ر.ي</strong></div>
              <div className="text-slate-500">{reversingTx.description}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                سبب القيد العكسي الموثق (إلزامي)
              </label>
              <textarea
                rows={3}
                required
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="مثال: تصحيح إدخال مكرر أو إلغاء فاتورة مصروف..."
                className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReversingTx(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                متابعة لتأكيد العكس
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
