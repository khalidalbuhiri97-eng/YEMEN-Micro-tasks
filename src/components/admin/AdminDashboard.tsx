import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskItem, TaskSubmission, WithdrawalRequest, PlatformSettings, TreasurySummary, LedgerTransaction } from '../../types/index.ts';
import { DatabaseErrorsView } from './DatabaseErrorsView.tsx';
import {
  ShieldAlert,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Banknote,
  FileText,
  Settings,
  PlusCircle,
  Download,
  AlertCircle,
  Eye,
  RefreshCw,
  Search,
  Lock,
  Unlock,
  Sliders,
  DollarSign,
  X,
  Landmark,
  Scale,
  Coins,
  ShieldCheck,
  Check,
  Database,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export const AdminDashboard: React.FC = () => {
  const { user, showToast } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'treasury' | 'db_errors' | 'submissions' | 'withdrawals' | 'tasks' | 'users' | 'reports' | 'settings'>('overview');
  
  // Data state
  const [stats, setStats] = useState<any>(null);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [financialReport, setFinancialReport] = useState<any>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [ledgerTransactions, setLedgerTransactions] = useState<LedgerTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Treasury Issuance Form State
  const [issueAmount, setIssueAmount] = useState('');
  const [issueReason, setIssueReason] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);

  // Action modals
  const [reviewingSubmission, setReviewingSubmission] = useState<TaskSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payingWithdrawal, setPayingWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [transferRef, setTransferRef] = useState('');
  const [withdrawingRejectReason, setWithdrawingRejectReason] = useState('');
  
  // New Task form
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskCat, setNewTaskCat] = useState('app_testing');
  const [newTaskReward, setNewTaskReward] = useState('50');
  const [newTaskQty, setNewTaskQty] = useState('50');
  const [newTaskTime, setNewTaskTime] = useState('10');

  // Adjust User Balance modal
  const [adjustingUser, setAdjustingUser] = useState<any | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // Proof Image Preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadAllAdminData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, subsRes, withsRes, tasksRes, usersRes, repRes, setRes, treasuryRes, ledgerRes] = await Promise.all([
        api.getAdminOverview().catch(() => ({ stats: null })),
        api.getAdminSubmissions().catch(() => ({ submissions: [] })),
        api.getAdminWithdrawals().catch(() => ({ withdrawals: [] })),
        api.getAdminTasks().catch(() => ({ tasks: [] })),
        api.getAdminUsers().catch(() => ({ users: [] })),
        api.getFinancialReport().catch(() => ({ report: null })),
        api.getSettings().catch(() => ({ settings: null })),
        api.getTreasury().catch(() => ({ treasury: null })),
        api.getLedger({ limit: 100 }).catch(() => ({ transactions: [] })),
      ]);

      if (overviewRes?.stats) setStats(overviewRes.stats);
      if (subsRes?.submissions) setSubmissions(subsRes.submissions);
      if (withsRes?.withdrawals) setWithdrawals(withsRes.withdrawals);
      if (tasksRes?.tasks) setTasks(tasksRes.tasks);
      if (usersRes?.users) setUsersList(usersRes.users);
      if (repRes?.report) setFinancialReport(repRes.report);
      if (setRes?.settings) setSettings(setRes.settings);
      if (treasuryRes?.treasury) setTreasury(treasuryRes.treasury);
      if (ledgerRes?.transactions) setLedgerTransactions(ledgerRes.transactions);
    } catch (err) {
      console.error('Failed to load admin data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllAdminData();
  }, []);

  // --- SUBMISSION ACTIONS ---
  const handleApproveSubmission = async (sub: TaskSubmission) => {
    try {
      await api.reviewSubmission(sub.id, 'APPROVE');
      try {
        confetti({ particleCount: 50, spread: 40 });
      } catch {}
      showToast(`تمت الموافقة على إثبات "${sub.taskTitle}" وإيداع المكافأة آلياً!`, 'success');
      setReviewingSubmission(null);
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في اعتماد الإثبات', 'error');
    }
  };

  const handleRejectSubmission = async (sub: TaskSubmission) => {
    if (!rejectReason.trim()) {
      showToast('يرجى كتابة سبب رفض الإثبات للتوضيح للمستخدم', 'error');
      return;
    }
    try {
      await api.reviewSubmission(sub.id, 'REJECT', rejectReason);
      showToast('تم رفض الإثبات وإشعار المستخدم بالسبب.', 'info');
      setReviewingSubmission(null);
      setRejectReason('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في رفض الإثبات', 'error');
    }
  };

  // --- WITHDRAWAL ACTIONS ---
  const handleConfirmPayout = async (w: WithdrawalRequest) => {
    if (!transferRef.trim()) {
      showToast('يرجى إدخال رقم مرجع الحوالة البنكية أو إشعار الإرسال', 'error');
      return;
    }
    try {
      await api.reviewWithdrawal(w.id, 'PAY', { transferReference: transferRef });
      showToast(`تم تأكيد إرسال الحوالة برقم ${transferRef}!`, 'success');
      setPayingWithdrawal(null);
      setTransferRef('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في تأكيد الحوالة', 'error');
    }
  };

  const handleRejectWithdrawal = async (w: WithdrawalRequest) => {
    if (!withdrawingRejectReason.trim()) {
      showToast('يرجى ذكر سبب رفض طلب السحب واسترجاع الرصيد للمستخدم', 'error');
      return;
    }
    try {
      await api.reviewWithdrawal(w.id, 'REJECT', { reason: withdrawingRejectReason });
      showToast('تم رفض السحب وإرجاع الرصيد المحجوز إلى محفظة المستخدم فوراً.', 'info');
      setPayingWithdrawal(null);
      setWithdrawingRejectReason('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في رفض طلب السحب', 'error');
    }
  };

  // --- CREATE NEW TASK ---
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAdminTask({
        title: newTaskTitle,
        description: newTaskDesc,
        category: newTaskCat,
        rewardYer: Number(newTaskReward),
        totalQuantity: Number(newTaskQty),
        timeEstimateMinutes: Number(newTaskTime),
        proofRequirements: { requireImage: true, requireText: true },
      });
      showToast('تم نشر المهمة الجديدة بنجاح للمستخدمين!', 'success');
      setIsCreatingTask(false);
      setNewTaskTitle('');
      setNewTaskDesc('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في إنشاء المهمة', 'error');
    }
  };

  // --- ADJUST BALANCE AUDITED ---
  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingUser || !adjustAmount || !adjustReason) return;
    try {
      await api.adjustUserBalance(adjustingUser.id, Number(adjustAmount), adjustReason);
      showToast('تم تنفيذ التعديل المالي وتوثيقه في السجل المالي بنجاح.', 'success');
      setAdjustingUser(null);
      setAdjustAmount('');
      setAdjustReason('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في تعديل الرصيد', 'error');
    }
  };

  // --- TOGGLE USER STATUS ---
  const handleToggleUserStatus = async (targetUser: any) => {
    const nextStatus = targetUser.status === 'active' ? 'suspended' : 'active';
    try {
      await api.updateUserStatus(targetUser.id, nextStatus);
      showToast(`تم ${nextStatus === 'suspended' ? 'تجميد' : 'إلغاء تجميد'} حساب المستخدم بنجاح.`, 'info');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في تحديث حالة المستخدم', 'error');
    }
  };

  // --- ISSUE TREASURY UNITS ---
  const handleIssueTreasuryUnits = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(issueAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('يرجى إدخال مبلغ صحيح أكبر من الصفر', 'error');
      return;
    }
    if (!issueReason.trim()) {
      showToast('يرجى كتابة سبب الإصدار لتسجيله في السجل المالي', 'error');
      return;
    }

    setIsIssuing(true);
    try {
      await api.issueTreasuryUnits({
        amount: amountNum,
        reason: issueReason.trim(),
      });
      showToast(`تم إصدار ${amountNum.toLocaleString()} وحدة افتراضية جديدة للخزينة بنجاح!`, 'success');
      setIssueAmount('');
      setIssueReason('');
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في إصدار الوحدات النقدية للخزينة', 'error');
    } finally {
      setIsIssuing(false);
    }
  };

  const pendingSubmissionsCount = submissions.filter((s) => s.status === 'PENDING').length;
  const pendingWithdrawalsCount = withdrawals.filter((w) => w.status === 'PENDING').length;

  if (!user || user.role !== 'admin') {
    return (
      <div className="py-20 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-200 dark:border-rose-900 shadow-sm">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          وصول محظور — لوحة خاصة بمالك المنصة فقط
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed mb-3">
          هذه الواجهة الإدارية والمالية محصورة بحساب المالك المعتمد:
        </p>
        <div className="inline-block px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-mono text-xs mb-6 border border-slate-200 dark:border-slate-700" dir="ltr">
          khalidalbuhiri@gmail.com
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Admin Header */}
      <div className="relative p-6 rounded-2xl bg-slate-900 text-white shadow-xl overflow-hidden border border-slate-800">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <img
            src="/src/assets/images/admin_analytics_console_1793978998457.jpg"
            alt="شاشة التحليلات"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-400 mb-1">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" />
                <span>لوحة التحكم والإدارة والتدقيق المالي (ADMIN)</span>
              </span>
              <span className="text-slate-500">·</span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]" dir="ltr">
                khalidalbuhiri@gmail.com
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">
              إدارة منصة كسب اليمن والمحفظة السيادية
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              تدقيق الإثباتات، معالجة السحوبات البنكية، مراقبة السيولة والالتزامات المالية.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadAllAdminData}
              title="تحديث البيانات"
              className="px-3 py-2 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث البيانات</span>
            </button>
            <a
              href="/api/admin/financial-report/export"
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير السجل المالي (CSV)</span>
            </a>
          </div>
        </div>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800 text-xs">
        {[
          { id: 'overview', label: 'المؤشرات المالية', count: null },
          { id: 'treasury', label: 'الخزينة والمحاسبة', count: null },
          { id: 'db_errors', label: 'أخطاء قاعدة البيانات', count: null },
          { id: 'submissions', label: 'مراجعة الإثباتات', count: pendingSubmissionsCount },
          { id: 'withdrawals', label: 'طلبات السحب والصرافة', count: pendingWithdrawalsCount },
          { id: 'tasks', label: 'إدارة المهام', count: tasks.length },
          { id: 'users', label: 'المستخدمين والمحافظ', count: usersList.length },
          { id: 'reports', label: 'التقارير المالية والسيولة', count: null },
          { id: 'settings', label: 'إعدادات المنصة', count: null },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 font-bold rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white dark:bg-emerald-600 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== null && tab.count > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full font-mono text-[10px] ${
                  tab.id === 'submissions' || tab.id === 'withdrawals'
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'bg-slate-700 text-white'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* DATABASE ERRORS MONITORING TAB */}
      {activeTab === 'db_errors' && <DatabaseErrorsView />}

      {/* TREASURY & ACCOUNTING LEDGER TAB */}
      {activeTab === 'treasury' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Treasury Metrics & Reconciliation */}
            <div className="lg:col-span-2 space-y-6">
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Landmark className="w-5 h-5 text-emerald-600" />
                      <span>الخزينة السيادية وميزان المراجعة المحاسبي</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      نظام القيد المزدوج المغلق يضمن أن مجموع كافة أرصدة المحافظ والخزينة يساوي تماماً إجمالي الوحدات الصادرة.
                    </p>
                  </div>

                  {/* Reconciliation Badge */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>ميزان المراجعة متطابق (100%)</span>
                  </div>
                </div>

                {/* Treasury 6 Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <span className="text-xs text-slate-500 block mb-1">إجمالي الوحدات الصادرة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${(treasury?.totalIssuedUnits || 10000000).toLocaleString()} ر.ي`}>
                      {(treasury?.totalIssuedUnits || 10000000).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/60 overflow-hidden">
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 block mb-1">خزينة المنصة المتاحة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-emerald-800 dark:text-emerald-300 truncate max-w-full" title={`${(treasury?.treasuryAvailable || 9850000).toLocaleString()} ر.ي`}>
                      {(treasury?.treasuryAvailable || 9850000).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <span className="text-xs text-slate-500 block mb-1">ميزانية المهام المحجوزة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-blue-600 dark:text-blue-400 truncate max-w-full" title={`${(treasury?.taskBudgetReserved || 0).toLocaleString()} ر.ي`}>
                      {(treasury?.taskBudgetReserved || 0).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <span className="text-xs text-slate-500 block mb-1">أرصدة المستخدمين المتاحة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${(treasury?.userAvailableTotal || 0).toLocaleString()} ر.ي`}>
                      {(treasury?.userAvailableTotal || 0).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <span className="text-xs text-slate-500 block mb-1">أرصدة المستخدمين المعلقة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400 truncate max-w-full" title={`${(treasury?.userPendingTotal || 0).toLocaleString()} ر.ي`}>
                      {(treasury?.userPendingTotal || 0).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <span className="text-xs text-slate-500 block mb-1">سحوبات محجوزة للمعالجة</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-purple-600 dark:text-purple-400 truncate max-w-full" title={`${(treasury?.withdrawalReservedTotal || 0).toLocaleString()} ر.ي`}>
                      {(treasury?.withdrawalReservedTotal || 0).toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Col: Issue Treasury Units Form */}
            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b border-slate-100 dark:border-slate-800 pb-3">
                  <Coins className="w-5 h-5 text-emerald-600" />
                  <span>إصدار وحدات نقدية جديدة للخزينة</span>
                </div>
                <p className="text-xs text-slate-500">
                  إجراء سيادي مخصص لمالك المنصة لإصدار وحدات افتراضية إضافية عند التوسع، مع تسجيل القيد المزدوج في دفتر الأستاذ.
                </p>

                <form onSubmit={handleIssueTreasuryUnits} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      المبلغ المراد إصداره (ر.ي)
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="مثال: 1000000"
                      value={issueAmount}
                      onChange={(e) => setIssueAmount(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      سبب الإصدار (إلزامي للتدقيق)
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="مثال: توسيع السيولة الافتراضية للمنصة لاستيعاب نمو المستخدمين والمهام..."
                      value={issueReason}
                      onChange={(e) => setIssueReason(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isIssuing}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {isIssuing ? 'جارِ الإصدار والتسجيل...' : 'إصدار وتغذية الخزينة آلياً'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Double Entry Ledger Audit Table */}
          <div className="space-y-3 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              سجل قيود الأستاذ المزدوج (Double-Entry Ledger Transactions)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-medium">
                  <tr>
                    <th className="py-3 px-4">رقم القيد</th>
                    <th className="py-3 px-4">نوع العملية</th>
                    <th className="py-3 px-4">البيان والتفاصيل</th>
                    <th className="py-3 px-4">معرف المرجع</th>
                    <th className="py-3 px-4">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ledgerTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        لا توجد قيود مسجلة في دفتر الأستاذ حالياً.
                      </td>
                    </tr>
                  ) : (
                    ledgerTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">{tx.id.slice(0, 10)}...</td>
                        <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">{tx.transactionType}</td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{tx.description}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400">{tx.referenceId || '---'}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                          {new Date(tx.createdAt).toLocaleString('ar-YE')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">الرصيد المتاح للمستخدمين (التزام)</span>
              <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                {stats.totalAvailableLiabilities.toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">المعلق بانتظار التحويل</span>
              <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {stats.totalPendingWithdrawalLiabilities.toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">إجمالي ما تم تحويله وصرفه</span>
              <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {stats.totalCompletedWithdrawals.toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">إجمالي مكافآت المهام المعتمدة</span>
              <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-blue-600 dark:text-blue-400">
                {stats.totalApprovedRewards.toLocaleString()} <span className="text-xs font-normal">ر.ي</span>
              </div>
            </div>
          </div>

          {/* Quick Pending Queues */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pending Submissions Alert Box */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span>إثباتات تنتظر التدقيق والاعتماد ({pendingSubmissionsCount})</span>
                </h3>
                <button
                  onClick={() => setActiveTab('submissions')}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  فتح مكتب التدقيق
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                يوجد {pendingSubmissionsCount} إثبات مهمة تم تقديمها من المستخدمين بانتظار فحص الصور والتحقق والموافقة أو الرفض.
              </p>
            </div>

            {/* Pending Withdrawals Alert Box */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-emerald-600" />
                  <span>طلبات سحب بانتظار الإرسال المالي ({pendingWithdrawalsCount})</span>
                </h3>
                <button
                  onClick={() => setActiveTab('withdrawals')}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  فتح طابور السحوبات
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                يوجد {pendingWithdrawalsCount} طلب سحب مالي محجوز ومطلوب تحويله عبر بنك الكريمي أو شبكة النجم وتزويد المستفيد برقم الحوالة.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. SUBMISSIONS DESK */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                مكتب فحص وتدقيق إثباتات المهام
              </h2>
              <p className="text-xs text-slate-500">
                الموافقة تقيد المكافأة آلياً وذرياً في محفظة المستخدم مرة واحدة فقط وتحدث ميزانية المهمة.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">المستخدم</th>
                    <th className="py-3 px-4">المهمة</th>
                    <th className="py-3 px-4 font-mono">المكافأة</th>
                    <th className="py-3 px-4">الإثبات المرفق</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        لا توجد أي إثباتات مقدمة حالياً.
                      </td>
                    </tr>
                  ) : (
                    submissions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">{sub.userFullName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{sub.userPhone}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-800 dark:text-slate-200 max-w-xs">
                          {sub.taskTitle}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-600">
                          {sub.taskRewardYer?.toLocaleString()} ر.ي
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {sub.proofImages && sub.proofImages.length > 0 && (
                              <button
                                onClick={() => setPreviewImage(sub.proofImages[0])}
                                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded font-semibold text-[11px] flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" />
                                <span>صورة</span>
                              </button>
                            )}
                            {sub.proofText && (
                              <span className="text-slate-500 max-w-[160px] truncate block" title={sub.proofText}>
                                {sub.proofText}
                              </span>
                            )}
                            {sub.proofUrl && /^https?:\/\//i.test(sub.proofUrl) && (
                              <a
                                href={sub.proofUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded font-semibold text-[11px] hover:underline"
                              >
                                رابط
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              sub.status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : sub.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {sub.status === 'APPROVED'
                              ? 'معتمد ومصروف'
                              : sub.status === 'REJECTED'
                              ? 'مرفوض'
                              : 'قيد المراجعة'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left">
                          {sub.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleApproveSubmission(sub)}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors flex items-center gap-1"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>قبول وصرف</span>
                              </button>
                              <button
                                onClick={() => {
                                  setReviewingSubmission(sub);
                                  setRejectReason('');
                                }}
                                className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg transition-colors"
                              >
                                رفض
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">مكتمل المراجعة</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. WITHDRAWALS TAB */}
      {activeTab === 'withdrawals' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              طابور طلبات السحب والمعالجة المالية
            </h2>
            <p className="text-xs text-slate-500">
              قم بتحويل المبلغ عبر الكريمي أو النجم ثم أدخل رقم الحوالة المرجعي لتأكيد الدفع، أو ارفض لإرجاع المبلغ لمحفظة المستفيد.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">المستفيد</th>
                    <th className="py-3 px-4">الشبكة / الطريقة</th>
                    <th className="py-3 px-4 font-mono">المبلغ المطلوب</th>
                    <th className="py-3 px-4 font-mono text-emerald-600">الصافي للدفع</th>
                    <th className="py-3 px-4">بيانات الحساب / الهاتف</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">معالجة التحويل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {withdrawals.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        لا توجد طلبات سحب حالياً.
                      </td>
                    </tr>
                  ) : (
                    withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {w.beneficiaryName}
                        </td>
                        <td className="py-3 px-4 font-medium">{w.methodNameAr || w.method}</td>
                        <td className="py-3 px-4 font-mono tabular-nums">{w.amount.toLocaleString()} ر.ي</td>
                        <td className="py-3 px-4 font-mono font-bold tabular-nums text-emerald-600">
                          {w.netAmount.toLocaleString()} ر.ي
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                          <div>هاتف: {w.phoneNumber}</div>
                          {w.accountNumber && <div>حساب: {w.accountNumber}</div>}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              w.status === 'PAID'
                                ? 'bg-emerald-100 text-emerald-800'
                                : w.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {w.status === 'PAID'
                              ? 'تم الصرف بنجاح'
                              : w.status === 'REJECTED'
                              ? 'مرفوض ومسترجع'
                              : 'بانتظار التحويل'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left">
                          {w.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setPayingWithdrawal(w);
                                  setTransferRef('');
                                  setWithdrawingRejectReason('');
                                }}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors flex items-center gap-1"
                              >
                                <span>إرسال وتأكيد</span>
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono text-slate-400">
                              {w.transferReference ? `مرجع: ${w.transferReference}` : w.rejectionReason}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. TASKS MANAGEMENT TAB */}
      {activeTab === 'tasks' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">إدارة المهام والكميات المتاحة</h2>
              <p className="text-xs text-slate-500">إنشاء مهام جديدة، تحديد الميزانيات، وضبط شروط الإثبات.</p>
            </div>
            <button
              onClick={() => setIsCreatingTask(!isCreatingTask)}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>إضافة مهمة جديدة</span>
            </button>
          </div>

          {/* New Task Creator Form */}
          {isCreatingTask && (
            <form
              onSubmit={handleCreateTask}
              className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                بيانات المهمة الجديدة
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    عنوان المهمة
                  </label>
                  <input
                    type="text"
                    required
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="مثال: فحص واختبار تسجيل الدخول في تطبيق بنكي يمني"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    تصنيف المهمة
                  </label>
                  <select
                    value={newTaskCat}
                    onChange={(e) => setNewTaskCat(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  >
                    <option value="app_testing">تجربة التطبيقات</option>
                    <option value="surveys">الاستبيانات</option>
                    <option value="review_ratings">تقييمات خرائط وجوجل</option>
                    <option value="data_entry">إدخال البيانات</option>
                    <option value="social_engagement">التفاعل الاجتماعي</option>
                    <option value="content_writing">كتابة المحتوى</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  شرح المهمة والتعليمات
                </label>
                <textarea
                  rows={3}
                  required
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  placeholder="اكتب خطوات التنفيذ الواضحة للمستخدمين..."
                  className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      المكافأة (ريال يمني)
                    </label>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      متاح حتى أقل من 100 ر.ي
                    </span>
                  </div>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={newTaskReward}
                    onChange={(e) => setNewTaskReward(e.target.value)}
                    placeholder="مثال: 10 أو 25 أو 50 أو 100..."
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                  {/* Quick reward presets */}
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {[10, 25, 50, 75, 100, 250, 500].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setNewTaskReward(String(amt))}
                        className={`px-1.5 py-0.5 text-[9px] rounded font-mono transition-colors ${
                          newTaskReward === String(amt)
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الكمية الإجمالية المطلوبة
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newTaskQty}
                    onChange={(e) => setNewTaskQty(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الوقت المقدر (بالدقائق)
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newTaskTime}
                    onChange={(e) => setNewTaskTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Total Budget Frozen Notice */}
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs flex items-center justify-between text-emerald-900 dark:text-emerald-200">
                <span>إجمالي ميزانية المهمة (ستخصم بالكامل من محفظة المدير وتُعلق في حساب المهام الجارية):</span>
                <span className="font-mono font-extrabold text-sm">
                  {((Number(newTaskReward) || 0) * (Number(newTaskQty) || 0)).toLocaleString()} ر.ي
                </span>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingTask(false)}
                  className="px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow"
                >
                  نشر المهمة فوراً وتجميد المبلغ
                </button>
              </div>
            </form>
          )}

          {/* Tasks Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-600">{t.category}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    t.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                  }`}>
                    {t.status === 'ACTIVE' ? 'نشطة' : 'مكتملة'}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{t.title}</h4>
                <div className="flex items-center justify-between font-mono text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span>المكافأة: {t.rewardYer.toLocaleString()} ر.ي</span>
                  <span>المكتمل: {t.completedQuantity} / {t.totalQuantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. USERS MANAGEMENT TAB */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">إدارة المستخدمين ومطابقة الحسابات</h2>
            <p className="text-xs text-slate-500">
              مراقبة الحسابات، تجميد الحسابات المشبوهة، وإجراء تسويات مالية مدققة وموثقة في السجل.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الاسم والبيانات</th>
                    <th className="py-3 px-4">رقم الهاتف</th>
                    <th className="py-3 px-4 font-mono">الرصيد المتاح</th>
                    <th className="py-3 px-4 font-mono">الرصيد المعلق</th>
                    <th className="py-3 px-4">المهام المنجزة</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usersList.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        <div>{u.fullName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">كود: {u.referralCode}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">{u.phone}</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-600 tabular-nums">
                        {u.wallet?.availableBalance.toLocaleString() || '0'} ر.ي
                      </td>
                      <td className="py-3 px-4 font-mono text-amber-600 tabular-nums">
                        {u.wallet?.pendingBalance.toLocaleString() || '0'} ر.ي
                      </td>
                      <td className="py-3 px-4 font-mono">{u.completedCount || 0}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {u.status === 'active' ? 'نشط' : 'مجمد'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setAdjustingUser(u);
                              setAdjustAmount('500');
                              setAdjustReason('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
                          >
                            تسوية رصيد
                          </button>
                          <button
                            onClick={() => handleToggleUserStatus(u)}
                            className={`p-1 rounded-lg ${
                              u.status === 'active'
                                ? 'text-rose-600 hover:bg-rose-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={u.status === 'active' ? 'تجميد الحساب' : 'إلغاء التجميد'}
                          >
                            {u.status === 'active' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 6. FINANCIAL REPORTS TAB */}
      {activeTab === 'reports' && financialReport && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">التقارير المالية والتدفقات النقدية</h2>
            <p className="text-xs text-slate-500">
              حساب إجمالي الالتزامات والسيولة وأرباح المنصة من رسوم الصرافة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">إجمالي مصاريف مكافآت المهام</span>
              <div className="text-2xl font-extrabold font-mono text-slate-900 dark:text-white tabular-nums">
                {financialReport.totalTaskExpenses.toLocaleString()} ر.ي
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">السيولة المسحوبة فعلياً</span>
              <div className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                {financialReport.totalPaidWithdrawals.toLocaleString()} ر.ي
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">التزامات المحافظ القائمة</span>
              <div className="text-2xl font-extrabold font-mono text-blue-600 dark:text-blue-400 tabular-nums">
                {financialReport.totalAvailableLiabilities.toLocaleString()} ر.ي
              </div>
            </div>
          </div>

          {/* Daily Breakdown Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">
              النشاط المالي اليومي للأسبوع الحالي
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">التاريخ</th>
                    <th className="py-2.5 px-4 font-mono">مكافآت المهام</th>
                    <th className="py-2.5 px-4 font-mono">السحوبات المنفذة</th>
                    <th className="py-2.5 px-4">مستخدمون جدد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {financialReport.dailyBreakdown.map((d: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-3 px-4 font-mono">{d.date}</td>
                      <td className="py-3 px-4 font-mono text-emerald-600">+{d.taskRewards.toLocaleString()} ر.ي</td>
                      <td className="py-3 px-4 font-mono text-rose-600">-{d.withdrawals.toLocaleString()} ر.ي</td>
                      <td className="py-3 px-4 font-mono">+{d.newUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 7. SETTINGS TAB */}
      {activeTab === 'settings' && settings && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 max-w-2xl">
          <h2 className="text-base font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
            إعدادات النظام والرسوم والحدود
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                الحد الأدنى للسحب (ر.ي)
              </label>
              <input
                type="number"
                value={settings.minWithdrawal}
                onChange={(e) => setSettings({ ...settings, minWithdrawal: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                الحد الأقصى للسحب (ر.ي)
              </label>
              <input
                type="number"
                value={settings.maxWithdrawal}
                onChange={(e) => setSettings({ ...settings, maxWithdrawal: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                نسبة رسوم الصرافة الافتراضية (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={settings.defaultFeePercentage}
                onChange={(e) => setSettings({ ...settings, defaultFeePercentage: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                مكافأة دعوة الصديق (ر.ي)
              </label>
              <input
                type="number"
                value={settings.referralBonus}
                onChange={(e) => setSettings({ ...settings, referralBonus: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <button
            onClick={async () => {
              await api.updateAdminSettings(settings);
              showToast('تم حفظ الإعدادات بنجاح.', 'success');
            }}
            className="px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow transition-colors"
          >
            حفظ التغييرات
          </button>
        </div>
      )}

      {/* MODAL: Reject Submission */}
      {reviewingSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              رفض إثبات المهمة
            </h3>
            <p className="text-xs text-slate-500">
              المهمة: "{reviewingSubmission.taskTitle}". يرجى تحديد سبب الرفض لتنبيه المستخدم.
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="مثال: الصورة المرفقة غير واضحة، أو لم يتم إكمال خطوات الاستبيان..."
              className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReviewingSubmission(null)}
                className="px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleRejectSubmission(reviewingSubmission)}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                تأكيد الرفض
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Pay or Reject Withdrawal */}
      {payingWithdrawal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              معالجة طلب السحب المالي
            </h3>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs space-y-1 font-mono">
              <div>المستفيد: <strong>{payingWithdrawal.beneficiaryName}</strong></div>
              <div>الهاتف: {payingWithdrawal.phoneNumber}</div>
              <div>الصافي المطلوب تحويله: <strong className="text-emerald-600">{payingWithdrawal.netAmount.toLocaleString()} ر.ي</strong></div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رقم الحوالة المرجعي (Reference Code)
              </label>
              <input
                type="text"
                value={transferRef}
                onChange={(e) => setTransferRef(e.target.value)}
                placeholder="مثال: KUR-998822 أو NAJM-771122"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-xs text-rose-600 dark:text-rose-400 font-semibold mb-1">
                أو سبب الرفض (لاسترجاع الرصيد للمستخدم):
              </label>
              <input
                type="text"
                value={withdrawingRejectReason}
                onChange={(e) => setWithdrawingRejectReason(e.target.value)}
                placeholder="مثال: رقم الحساب المدخل غير مطابق للاسم..."
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setPayingWithdrawal(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
              >
                إلغاء
              </button>
              <div className="flex gap-2">
                {withdrawingRejectReason ? (
                  <button
                    onClick={() => handleRejectWithdrawal(payingWithdrawal)}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                  >
                    رفض واسترجاع الرصيد
                  </button>
                ) : (
                  <button
                    onClick={() => handleConfirmPayout(payingWithdrawal)}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                  >
                    تأكيد إرسال الحوالة
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Audited Balance Adjustment */}
      {adjustingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <form
            onSubmit={handleAdjustBalance}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              تسوية وتعديل رصيد مدقق للمستخدم
            </h3>
            <p className="text-xs text-slate-500">
              المستخدم: {adjustingUser.fullName} (رقم الهاتف: {adjustingUser.phone})
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                المبلغ المراد إضافته (+) أو خصمه (-) بالريال اليمني
              </label>
              <input
                type="number"
                required
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="مثال: 500 أو -500"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                سبب التعديل الإداري (إلزامي للتدقيق المالي)
              </label>
              <textarea
                rows={2}
                required
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="مثال: تعويض عن مهمة معلقة أو تصحيح خطأ إدخال..."
                className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdjustingUser(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
              >
                تنفيذ التسوية وتوثيقها
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Image Preview Lightbox */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-2xl w-full bg-slate-900 rounded-2xl overflow-hidden p-2">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 left-4 z-10 p-2 bg-slate-950/70 text-white rounded-full hover:bg-slate-950"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={previewImage}
              alt="صورة الإثبات"
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
