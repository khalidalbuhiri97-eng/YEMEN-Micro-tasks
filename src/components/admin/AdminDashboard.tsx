import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskItem, TaskSubmission, WithdrawalRequest, PlatformSettings, TreasurySummary, CampaignItem } from '../../types/index.ts';
import { DatabaseErrorsView } from './DatabaseErrorsView.tsx';
import { OwnerOverviewMetrics } from './finance/OwnerOverviewMetrics.tsx';
import { TreasuryControlView } from './finance/TreasuryControlView.tsx';
import { LedgerAuditView } from './finance/LedgerAuditView.tsx';
import { FinancialReportsView } from './finance/FinancialReportsView.tsx';
import { TaxManagementView } from './finance/TaxManagementView.tsx';
import { ExternalAccountsView } from './finance/ExternalAccountsView.tsx';
import { GeoManagementView } from './GeoManagementView.tsx';
import { GeoLocationSelector, type GeoMultiValue } from '../common/GeoLocationSelector.tsx';
import { fetchGeoCountries } from '../../services/geoService.ts';
import type { CountryItem } from '../../types/index.ts';
import {
  ShieldAlert,
  CheckCircle,
  Banknote,
  PlusCircle,
  Download,
  Eye,
  RefreshCw,
  Lock,
  Unlock,
  X,
  Trash2,
  Megaphone,
  Play,
  RotateCcw,
  FileText,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SecureImageView } from '../common/SecureImageView.tsx';
import {
  CampaignDetailsModal,
  CampaignInvoiceModal,
  getCampaignStatusLabel,
} from '../advertiser/CampaignModals.tsx';
import { addMoney, formatYer, mulMoney, roundYer6 } from '../../../shared/money.ts';

export const AdminDashboard: React.FC = () => {
  const { user, showToast, openConfirmModal } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'treasury' | 'external_accounts' | 'ledger' | 'reports' | 'taxes' | 'geo' | 'db_errors' | 'submissions' | 'withdrawals' | 'tasks' | 'campaigns' | 'users' | 'settings'>('overview');
  
  // Data state
  const [stats, setStats] = useState<any>(null);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  // Action modals
  const [reviewingSubmission, setReviewingSubmission] = useState<TaskSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payingWithdrawal, setPayingWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [transferRef, setTransferRef] = useState('');
  const [withdrawingRejectReason, setWithdrawingRejectReason] = useState('');
  
  // New Task form
  const isCreatingTaskRef = useRef(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [creationKey, setCreationKey] = useState<string>(() => crypto.randomUUID());
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskCat, setNewTaskCat] = useState('app_testing');
  const [newTaskReward, setNewTaskReward] = useState('10');
  const [newTaskQty, setNewTaskQty] = useState('50');
  const [newTaskTime, setNewTaskTime] = useState('10');
  const [newTaskDurationDays, setNewTaskDurationDays] = useState('7');
  const [newTaskGeo, setNewTaskGeo] = useState<GeoMultiValue>({
    countryId: '',
    isNationwide: true,
    targetDivisionIds: [],
    targetDivisions: [],
  });
  const [adminCountries, setAdminCountries] = useState<CountryItem[]>([]);
  const [userCountryFilter, setUserCountryFilter] = useState<string>('');

  // Adjust User Balance modal
  const [adjustingUser, setAdjustingUser] = useState<any | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // Proof Image Preview & Campaign Modals
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedAdminCampaign, setSelectedAdminCampaign] = useState<CampaignItem | null>(null);
  const [invoiceAdminCampaign, setInvoiceAdminCampaign] = useState<CampaignItem | null>(null);

  const loadAllAdminData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, subsRes, withsRes, tasksRes, campsRes, usersRes, setRes, treasuryRes] = await Promise.all([
        api.getAdminOverview().catch(() => ({ stats: null })),
        api.getAdminSubmissions().catch(() => ({ submissions: [] })),
        api.getAdminWithdrawals().catch(() => ({ withdrawals: [] })),
        api.getAdminTasks().catch(() => ({ tasks: [] })),
        api.getAdminCampaigns().catch(() => ({ campaigns: [] })),
        api.getAdminUsers().catch(() => ({ users: [] })),
        api.getSettings().catch(() => ({ settings: null })),
        api.getTreasury().catch(() => ({ treasury: null })),
      ]);

      if (overviewRes?.stats) setStats(overviewRes.stats);
      if (subsRes?.submissions) setSubmissions(subsRes.submissions);
      if (withsRes?.withdrawals) setWithdrawals(withsRes.withdrawals);
      if (tasksRes?.tasks) setTasks(tasksRes.tasks);
      if (campsRes?.campaigns) setCampaigns(campsRes.campaigns);
      if (usersRes?.users) setUsersList(usersRes.users);
      if (setRes?.settings) setSettings(setRes.settings);
      if (treasuryRes?.treasury) setTreasury(treasuryRes.treasury);
    } catch (err) {
      console.error('Failed to load admin data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllAdminData();
    fetchGeoCountries(true)
      .then(({ countries }) => setAdminCountries(countries))
      .catch(() => {});
  }, []);

  // --- SUBMISSION ACTIONS ---
  const handleApproveSubmission = (sub: TaskSubmission) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    openConfirmModal({
      title: 'اعتماد إثبات المهمة وصرف المكافأة',
      message: `هل تريد اعتماد إثبات "${sub.taskTitle}" وإيداع ${formatYer(sub.taskRewardYer ?? 0)} ر.ي في محفظة ${sub.userFullName}؟`,
      confirmLabel: 'تأكيد الاعتماد',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
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
      },
    });
  };

  const handleRejectSubmission = (sub: TaskSubmission) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    if (!rejectReason.trim()) {
      showToast('يرجى كتابة سبب رفض الإثبات للتوضيح للمستخدم', 'error');
      return;
    }
    openConfirmModal({
      title: 'رفض إثبات المهمة',
      message: `هل أنت متأكد من رفض إثبات "${sub.taskTitle}" المقدم من ${sub.userFullName}؟`,
      confirmLabel: 'تأكيد الرفض',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.reviewSubmission(sub.id, 'REJECT', rejectReason);
          showToast('تم رفض الإثبات وإشعار المستخدم بالسبب.', 'info');
          setReviewingSubmission(null);
          setRejectReason('');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل في رفض الإثبات', 'error');
        }
      },
    });
  };

  // --- WITHDRAWAL ACTIONS ---
  const handleConfirmPayout = (w: WithdrawalRequest) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    if (!transferRef.trim()) {
      showToast('يرجى إدخال رقم مرجع الحوالة البنكية أو إشعار الإرسال', 'error');
      return;
    }
    openConfirmModal({
      title: 'تأكيد إرسال الحوالة المالية',
      message: `هل تم تحويل مبلغ ${formatYer(w.netAmount)} ر.ي للمستفيد ${w.beneficiaryName} برقم مرجع ${transferRef.trim()}؟`,
      confirmLabel: 'تأكيد الصرف',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await api.reviewWithdrawal(w.id, 'PAY', { transferReference: transferRef.trim() });
          showToast(`تم تأكيد إرسال الحوالة برقم ${transferRef.trim()}!`, 'success');
          setPayingWithdrawal(null);
          setTransferRef('');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل في تأكيد الحوالة', 'error');
        }
      },
    });
  };

  const handleRejectWithdrawal = (w: WithdrawalRequest) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    if (!withdrawingRejectReason.trim()) {
      showToast('يرجى ذكر سبب رفض طلب السحب واسترجاع الرصيد للمستخدم', 'error');
      return;
    }
    openConfirmModal({
      title: 'رفض السحب واسترجاع الرصيد',
      message: `هل تريد رفض طلب السحب بمبلغ ${formatYer(w.amount)} ر.ي وإعادة الرصيد لمحفظة ${w.beneficiaryName}؟`,
      confirmLabel: 'تأكيد الرفض',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.reviewWithdrawal(w.id, 'REJECT', { reason: withdrawingRejectReason.trim() });
          showToast('تم رفض السحب وإرجاع الرصيد المحجوز إلى محفظة المستخدم فوراً.', 'info');
          setPayingWithdrawal(null);
          setWithdrawingRejectReason('');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل في رفض طلب السحب', 'error');
        }
      },
    });
  };

  // --- CREATE NEW TASK ---
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    if (isCreatingTaskRef.current || isSubmittingTask) return;

    isCreatingTaskRef.current = true;
    setIsSubmittingTask(true);

    try {
      const daysNum = Math.min(30, Math.max(1, Number(newTaskDurationDays) || 7));
      const deadline = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toISOString();

      await api.createAdminTask({
        title: newTaskTitle,
        description: newTaskDesc,
        category: newTaskCat,
        rewardYer: Number(newTaskReward),
        totalQuantity: Number(newTaskQty),
        timeEstimateMinutes: Number(newTaskTime),
        deadline,
        proofRequirements: { requireImage: true, requireText: true },
        creationKey,
        countryId: newTaskGeo.countryId || undefined,
        isNationwide: newTaskGeo.isNationwide,
        targetDivisionIds: newTaskGeo.isNationwide ? [] : newTaskGeo.targetDivisionIds,
      });
      showToast('تم نشر المهمة الجديدة بنجاح للمستخدمين!', 'success');
      setIsCreatingTask(false);
      setNewTaskTitle('');
      setNewTaskDesc('');
      setCreationKey(crypto.randomUUID());
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'فشل في إنشاء المهمة', 'error');
    } finally {
      isCreatingTaskRef.current = false;
      setIsSubmittingTask(false);
    }
  };

  // --- ADJUST BALANCE AUDITED ---
  const handleAdjustBalance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تنفيذ هذا الإجراء.', 'error');
      return;
    }
    if (!adjustingUser || !adjustAmount || !adjustReason.trim()) {
      showToast('يرجى إدخال المبلغ وسبب التعديل الإداري.', 'error');
      return;
    }
    const numAdjust = roundYer6(Number(adjustAmount));
    if (!Number.isFinite(numAdjust) || numAdjust === 0) {
      showToast('يرجى إدخال قيمة تسوية صحيحة غير صفرية.', 'error');
      return;
    }
    openConfirmModal({
      title: 'تأكيد تسوية الرصيد المالي',
      message: `هل أنت متأكد من ${numAdjust > 0 ? 'إضافة' : 'خصم'} ${formatYer(Math.abs(numAdjust))} ر.ي لحساب ${adjustingUser.fullName}؟`,
      confirmLabel: 'تأكيد التسوية',
      cancelLabel: 'إلغاء',
      variant: numAdjust < 0 ? 'danger' : 'warning',
      onConfirm: async () => {
        try {
          await api.adjustUserBalance(adjustingUser.id, numAdjust, adjustReason.trim());
          showToast('تم تنفيذ التعديل المالي وتوثيقه في السجل المالي بنجاح.', 'success');
          setAdjustingUser(null);
          setAdjustAmount('');
          setAdjustReason('');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل في تعديل الرصيد', 'error');
        }
      },
    });
  };

  const handleDeleteTask = (task: TaskItem) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية حذف المهام.', 'error');
      return;
    }
    openConfirmModal({
      title: 'حذف المهمة',
      message: `هل أنت متأكد من حذف المهمة "${task.title}" نهائياً؟`,
      confirmLabel: 'تأكيد الحذف',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        if (!user || user.role !== 'admin') {
          showToast('غير مصرح لك بتنفيذ هذا الإجراء.', 'error');
          return;
        }
        try {
          await api.deleteAdminTask(task.id);
          showToast('تم حذف المهمة بنجاح', 'success');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل حذف المهمة', 'error');
        }
      },
    });
  };

  // --- TOGGLE USER STATUS ---
  const handleToggleUserStatus = (targetUser: any) => {
    if (!user || user.role !== 'admin') {
      showToast('ليس لديك صلاحية تعديل حالة الحسابات.', 'error');
      return;
    }
    const nextStatus = targetUser.status === 'active' ? 'suspended' : 'active';
    const isSuspending = nextStatus === 'suspended';
    openConfirmModal({
      title: isSuspending ? 'تجميد حساب المستخدم' : 'تفعيل / اعتماد الحساب',
      message: isSuspending
        ? `هل أنت متأكد من تجميد حساب "${targetUser.fullName}" ومنعه من الدخول؟`
        : `هل تريد تفعيل واعتماد حساب "${targetUser.fullName}"؟`,
      confirmLabel: isSuspending ? 'تأكيد التجميد' : 'تأكيد التفعيل والاعتماد',
      cancelLabel: 'إلغاء',
      variant: isSuspending ? 'danger' : 'primary',
      onConfirm: async () => {
        try {
          await api.updateUserStatus(targetUser.id, nextStatus);
          showToast(`تم ${isSuspending ? 'تجميد' : 'اعتماد وتفعيل'} الحساب بنجاح.`, 'info');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل في تحديث حالة المستخدم', 'error');
        }
      },
    });
  };

  const handleStartCampaignAdmin = (camp: CampaignItem) => {
    openConfirmModal({
      title: 'تشغيل الحملة الإعلانية وإثبات الإيراد',
    message: `سيتم نشر مهام حملة "${camp.title}" وإثبات رسوم المنصة (${formatYer(camp.feeUnits)} ر.ي) في حساب إيرادات الإعلانات مرة واحدة فقط. هل تريد المتابعة؟`,
      confirmLabel: 'بدء الحملة',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await api.startAdminCampaign(camp.id);
          showToast('تم تشغيل الحملة وإثبات إيراد الرسوم بنجاح.', 'success');
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل بدء الحملة.', 'error');
        }
      },
    });
  };

  const handleSettleCampaignAdmin = (camp: CampaignItem, targetStatus: 'cancelled' | 'completed' = 'cancelled') => {
    const isComplete = targetStatus === 'completed';
    const refundEstimate = addMoney(
      camp.budgetEscrowBalance ?? 0,
      !camp.startedAt ? (camp.feeEscrowBalance ?? 0) : 0
    );
    openConfirmModal({
      title: isComplete ? 'إنهاء وإكمال الحملة الإعلانية' : 'إلغاء وتسوية الحملة الإعلانية',
      message: isComplete
        ? `سيتم إغلاق حملة "${camp.title}" بحالة (مكتملة)، وإبقاء رسوم المنصة المستحقة (${formatYer(camp.feeUnits)} ر.ي)، وإرجاع أي فائض متبقٍ من ميزانية المكافآت (${formatYer(refundEstimate)} ر.ي) لمحفظة المعلن "${camp.advertiserName}".`
        : !camp.startedAt
          ? `الحملة "${camp.title}" لم تبدأ بعد — سيتم إلغاؤها وإرجاع كامل المبلغ المحجوز (${formatYer(refundEstimate)} ر.ي شامل الميزانية والرسوم) لمحفظة المعلن "${camp.advertiserName}".`
          : `الحملة "${camp.title}" بدأت بالفعل — سيتم إلغاؤها والاحتفاظ برسوم المنصة (${formatYer(camp.feeUnits)} ر.ي) وإرجاع غير المستخدم من ميزانية المكافآت (${formatYer(camp.budgetEscrowBalance ?? 0)} ر.ي) لمحفظة المعلن.`,
      confirmLabel: isComplete ? 'تأكيد الإكمال والتسوية' : 'تأكيد الإلغاء والتسوية',
      cancelLabel: 'تراجع',
      variant: isComplete ? 'primary' : 'danger',
      onConfirm: async () => {
        try {
          const res = await api.settleAdminCampaign(camp.id, { targetStatus });
          showToast(
            `تم ${isComplete ? 'إكمال' : 'إلغاء'} الحملة وإرجاع ${formatYer(Number(res?.refundedUnits || 0))} ر.ي لمحفظة المعلن.`,
            'success'
          );
          await loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'فشل تسوية الحملة.', 'error');
        }
      },
    });
  };

  const handleQuickExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      await api.downloadFinancialCsv('ledger');
      showToast('تم تصدير السجل المالي بصيغة CSV بنجاح.', 'success');
    } catch (err: any) {
      showToast(err.message || 'فشل تصدير السجل المالي.', 'error');
    } finally {
      setIsExportingCsv(false);
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
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]" dir="ltr">
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
              type="button"
              onClick={loadAllAdminData}
              title="تحديث البيانات"
              className="px-3 py-2 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث البيانات</span>
            </button>
            <button
              type="button"
              onClick={handleQuickExportCsv}
              disabled={isExportingCsv}
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExportingCsv ? 'جارِ التصدير...' : 'تصدير السجل المالي (CSV)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 border-b border-slate-200 dark:border-slate-800 text-xs">
        {[
          { id: 'overview', label: 'المؤشرات المالية', count: null },
          { id: 'treasury', label: 'إدارة الخزينة', count: null },
          { id: 'external_accounts', label: 'الحسابات الخارجية والتحصيل', count: treasury?.pendingExternalDepositsCount ?? null },
          { id: 'ledger', label: 'دفتر الأستاذ والمراجعة', count: null },
          { id: 'reports', label: 'التقارير المالية (8)', count: null },
          { id: 'taxes', label: 'إدارة الضرائب', count: null },
          { id: 'geo', label: 'الدول والتقسيمات', count: adminCountries.length || 22 },
          { id: 'submissions', label: 'مراجعة الإثباتات', count: pendingSubmissionsCount },
          { id: 'withdrawals', label: 'طلبات السحب', count: pendingWithdrawalsCount },
          { id: 'tasks', label: 'إدارة المهام', count: tasks.length },
          { id: 'campaigns', label: 'حملات المعلنين', count: campaigns.filter((c) => c.status === 'pending_start' || c.status === 'active').length },
          { id: 'users', label: 'المستخدمين والمعلنين', count: usersList.filter((u) => u.status === 'pending').length || usersList.length },
          { id: 'db_errors', label: 'أخطاء قاعدة البيانات', count: null },
          { id: 'settings', label: 'إعدادات المنصة', count: null },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 font-bold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== null && tab.count > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
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

      {/* 1. OWNER OVERVIEW METRICS TAB */}
      {activeTab === 'overview' && (
        <OwnerOverviewMetrics
          stats={stats}
          treasury={treasury}
          pendingSubmissionsCount={pendingSubmissionsCount}
          pendingWithdrawalsCount={pendingWithdrawalsCount}
          isLoading={isLoading}
          onNavigateTab={setActiveTab}
        />
      )}

      {/* 2. TREASURY CONTROL TAB */}
      {activeTab === 'treasury' && (
        <TreasuryControlView treasury={treasury} onRefreshAll={loadAllAdminData} />
      )}

      {/* 2B. EXTERNAL ACCOUNTS & ADVERTISER DEPOSITS TAB */}
      {activeTab === 'external_accounts' && (
        <ExternalAccountsView treasury={treasury} onRefreshAll={loadAllAdminData} />
      )}

      {/* 3. GENERAL LEDGER & AUDIT TAB */}
      {activeTab === 'ledger' && (
        <LedgerAuditView onRefreshAll={loadAllAdminData} />
      )}

      {/* 4. COMPREHENSIVE FINANCIAL REPORTS TAB */}
      {activeTab === 'reports' && (
        <FinancialReportsView treasury={treasury} />
      )}

      {/* 5. TAX MANAGEMENT TAB */}
      {activeTab === 'taxes' && (
        <TaxManagementView treasury={treasury} onRefreshAll={loadAllAdminData} />
      )}

      {/* 5B. ARAB COUNTRIES & DIVISIONS GEOGRAPHY TAB */}
      {activeTab === 'geo' && <GeoManagementView />}

      {/* DATABASE ERRORS MONITORING TAB */}
      {activeTab === 'db_errors' && <DatabaseErrorsView />}

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
                          {formatYer(sub.taskRewardYer ?? 0)} ر.ي
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
                        <td className="py-3 px-4 font-mono tabular-nums">{formatYer(w.amount)} ر.ي</td>
                        <td className="py-3 px-4 font-mono font-bold tabular-nums text-emerald-600">
                          {formatYer(w.netAmount)} ر.ي
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
      {/* ADVERTISER CAMPAIGNS MANAGEMENT TAB */}
      {activeTab === 'campaigns' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-emerald-600" />
              <span>إدارة حملات المعلنين وحسابات الضمان</span>
            </h2>
            <p className="text-xs text-slate-500">
              تظهر هنا حملات المعلنين الخارجيين (ليست ممولة من المنصة). تحتفظ الإدارة بالهوية الحقيقية لكل معلن حتى عند إخفاء اسمه عن المستخدمين.
            </p>
          </div>

          {/* Mobile Card Stack (< md) */}
          <div className="md:hidden space-y-3">
            {campaigns.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                لا توجد حملات معلنين مسجلة حالياً.
              </div>
            ) : (
              campaigns.map((camp) => {
                const statusMeta = getCampaignStatusLabel(camp.status);
                const publicLabel = camp.hideAdvertiserName
                  ? 'معلن عبر يمن تاسك (مخفي عن المستخدمين)'
                  : camp.advertiserDisplayName || camp.advertiserCompany || camp.advertiserName || 'معلن عبر يمن تاسك';

                return (
                  <div
                    key={camp.id}
                    className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-slate-900 dark:text-white">{camp.title}</div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                          هوية المعلن الحقيقية: <strong>{camp.advertiserName}</strong>
                          {camp.advertiserCompany ? ` · ${camp.advertiserCompany}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          الظهور للمستخدمين: {publicLabel}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${statusMeta.cls}`}>
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">الميزانية / المنجز</span>
                        <span>{formatYer(camp.budgetUnits)} ر.ي ({camp.approvedCount ?? 0}/{camp.slots})</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">رسوم ({camp.feePercentage}%)</span>
                        <span>{formatYer(camp.feeUnits)} ر.ي</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedAdminCampaign(camp)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center justify-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>تفاصيل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setInvoiceAdminCampaign(camp)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center justify-center gap-1"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>فاتورة</span>
                      </button>
                      {camp.status === 'pending_start' && (
                        <button
                          type="button"
                          onClick={() => handleStartCampaignAdmin(camp)}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>بدء</span>
                        </button>
                      )}
                      {camp.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleSettleCampaignAdmin(camp, 'completed')}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>إكمال</span>
                        </button>
                      )}
                      {(camp.status === 'pending_start' || camp.status === 'active' || camp.status === 'paused') && (
                        <button
                          type="button"
                          onClick={() => handleSettleCampaignAdmin(camp, 'cancelled')}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-center justify-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إلغاء</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table (>= md) */}
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الحملة وهوية المعلن</th>
                    <th className="py-3 px-4 font-mono">الميزانية</th>
                    <th className="py-3 px-4 font-mono">الرسوم (النسبة)</th>
                    <th className="py-3 px-4 font-mono">الضمان المتبقي</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        لا توجد حملات معلنين مسجلة حالياً.
                      </td>
                    </tr>
                  ) : (
                    campaigns.map((camp) => {
                      const statusMeta = getCampaignStatusLabel(camp.status);
                      return (
                        <tr key={camp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">{camp.title}</div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300">
                              المعلن الفعلي: {camp.advertiserName} {camp.advertiserCompany ? `· ${camp.advertiserCompany}` : ''}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {camp.hideAdvertiserName
                                ? 'مخفي عن المستخدمين (يظهر كـ: معلن عبر يمن تاسك)'
                                : `ظاهر للمستخدمين: ${camp.advertiserDisplayName || camp.advertiserCompany || camp.advertiserName}`}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums">
                            <div>{formatYer(camp.budgetUnits)} ر.ي</div>
                            <div className="text-[10px] text-slate-400">{camp.approvedCount ?? 0} / {camp.slots} مهمة</div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums">
                            <div>{formatYer(camp.feeUnits)} ر.ي</div>
                            <div className="text-[10px] text-slate-400">({camp.feePercentage}%)</div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                            <div>مكافآت: {formatYer(camp.budgetEscrowBalance ?? 0)} ر.ي</div>
                            <div className="text-[10px] text-amber-600">رسوم معلقة: {formatYer(camp.feeEscrowBalance ?? 0)} ر.ي</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusMeta.cls}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-left">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedAdminCampaign(camp)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" />
                                <span>تفاصيل</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setInvoiceAdminCampaign(camp)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1"
                              >
                                <FileText className="w-3 h-3" />
                                <span>فاتورة</span>
                              </button>
                              {camp.status === 'pending_start' && (
                                <button
                                  type="button"
                                  onClick={() => handleStartCampaignAdmin(camp)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>بدء</span>
                                </button>
                              )}
                              {camp.status === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => handleSettleCampaignAdmin(camp, 'completed')}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[11px] flex items-center gap-1"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  <span>إكمال</span>
                                </button>
                              )}
                              {(camp.status === 'pending_start' || camp.status === 'active' || camp.status === 'paused') && (
                                <button
                                  type="button"
                                  onClick={() => handleSettleCampaignAdmin(camp, 'cancelled')}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>إلغاء وتسوية</span>
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
        </div>
      )}

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
                    min="0.000001"
                    step="any"
                    value={newTaskReward}
                    onChange={(e) => setNewTaskReward(e.target.value)}
                    placeholder="مثال: 0.25 أو 1 أو 10 أو 50..."
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                  {/* Quick reward presets */}
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {[1, 5, 10, 25, 50, 75, 100, 250, 500].map((amt) => (
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
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    مدة الصلاحية (أيام - حتى شهر 30)
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="30"
                    value={newTaskDurationDays}
                    onChange={(e) => setNewTaskDurationDays(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {[1, 3, 7, 14, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setNewTaskDurationDays(String(d))}
                        className={`px-1 py-0.5 text-[9px] rounded font-mono transition-colors ${
                          newTaskDurationDays === String(d)
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d === 30 ? 'شهر' : d === 7 ? 'أسبوع' : `${d}ج`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Geographic Targeting */}
              <GeoLocationSelector
                mode="multi"
                countryId={newTaskGeo.countryId}
                isNationwide={newTaskGeo.isNationwide}
                targetDivisionIds={newTaskGeo.targetDivisionIds}
                targetDivisions={newTaskGeo.targetDivisions}
                defaultCountryIso2="YE"
                onChange={setNewTaskGeo}
              />

              {/* Total Budget Frozen Notice */}
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs flex items-center justify-between text-emerald-900 dark:text-emerald-200">
                <span>إجمالي ميزانية المهمة (ستخصم بالكامل من محفظة المدير وتُعلق في حساب المهام الجارية):</span>
                <span className="font-mono font-extrabold text-sm">
                  {formatYer(mulMoney(Number(newTaskReward) || 0, Number(newTaskQty) || 0))} ر.ي
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
                  disabled={isSubmittingTask}
                  className="px-6 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg shadow flex items-center gap-2"
                >
                  {isSubmittingTask ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>جارٍ نشر المهمة...</span>
                    </>
                  ) : (
                    <span>نشر المهمة فوراً وتجميد المبلغ</span>
                  )}
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
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t.countryFlag ? `${t.countryFlag} ` : ''}
                  {t.locationLabel || t.countryNameAr || 'جميع الدول العربية'}
                </div>
                <div className="flex items-center justify-between font-mono text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span>المكافأة: {formatYer(t.rewardYer)} ر.ي</span>
                  <span>المكتمل: {t.completedQuantity} / {t.totalQuantity}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(t)}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    title="حذف المهمة نهائياً"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. USERS MANAGEMENT TAB */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">إدارة المستخدمين ومطابقة الحسابات</h2>
              <p className="text-xs text-slate-500">
                مراقبة الحسابات، تجميد الحسابات المشبوهة، وإجراء تسويات مالية مدققة وموثقة في السجل.
              </p>
            </div>
            <select
              value={userCountryFilter}
              onChange={(e) => setUserCountryFilter(e.target.value)}
              className="w-full sm:w-60 min-h-[40px] px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl"
            >
              <option value="">كل الدول ({usersList.length})</option>
              {adminCountries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.flagEmoji} {c.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الاسم والبيانات</th>
                    <th className="py-3 px-4">الموقع الجغرافي</th>
                    <th className="py-3 px-4">رقم الهاتف</th>
                    <th className="py-3 px-4 font-mono">الرصيد المتاح</th>
                    <th className="py-3 px-4 font-mono">الرصيد المعلق</th>
                    <th className="py-3 px-4">المهام المنجزة</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usersList
                    .filter((u) => !userCountryFilter || u.countryId === userCountryFilter)
                    .map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-1.5">
                          <span>{u.fullName}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            u.role === 'advertiser'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : u.role === 'admin'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          }`}>
                            {u.role === 'advertiser' ? 'معلن' : u.role === 'admin' ? 'مدير' : 'مستخدم'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {u.companyName ? `${u.companyName} · ` : ''}كود: {u.referralCode}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={u.locationPath || u.city}>
                        {u.countryFlag ? `${u.countryFlag} ` : ''}{u.locationPath || u.city || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono">{u.phone}</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-600 tabular-nums">
                        {formatYer(u.wallet?.availableBalance ?? 0)} ر.ي
                      </td>
                      <td className="py-3 px-4 font-mono text-amber-600 tabular-nums">
                        {formatYer(u.wallet?.pendingBalance ?? 0)} ر.ي
                      </td>
                      <td className="py-3 px-4 font-mono">{u.completedCount || 0}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : u.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {u.status === 'active' ? 'نشط' : u.status === 'pending' ? 'بانتظار الاعتماد' : 'مجمد'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <div className="flex items-center justify-end gap-2">
                          {u.status === 'pending' && (
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                            >
                              اعتماد المعلن
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setAdjustingUser(u);
                              setAdjustAmount('500');
                              setAdjustReason('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
                          >
                            {u.role === 'advertiser' ? 'شحن / تسوية رصيد' : 'تسوية رصيد'}
                          </button>
                          <button
                            onClick={() => handleToggleUserStatus(u)}
                            className={`p-1 rounded-lg ${
                              u.status === 'active'
                                ? 'text-rose-600 hover:bg-rose-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={u.status === 'active' ? 'تجميد الحساب' : 'تفعيل الحساب'}
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

      {/* Old static reports block removed; handled by <FinancialReportsView /> */}

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

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                نسبة رسوم المنصة على حملات المعلنين (%)
              </label>
              <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                الافتراضي: 20%
              </span>
            </div>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={settings.advertiserCampaignFeePercentage ?? 20}
              onChange={(e) =>
                setSettings({ ...settings, advertiserCampaignFeePercentage: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              تُطبق هذه النسبة على الحملات الجديدة عند إنشائها فقط، وتُحفظ تاريخياً داخل كل حملة دون التأثير على الحملات السابقة.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (!user || user.role !== 'admin') {
                showToast('ليس لديك صلاحية تعديل إعدادات النظام.', 'error');
                return;
              }
              openConfirmModal({
                title: 'حفظ إعدادات المنصة',
                message: 'هل تريد حفظ التعديلات على حدود السحب والرسوم ومكافأة الإحالة؟',
                confirmLabel: 'تأكيد الحفظ',
                cancelLabel: 'إلغاء',
                variant: 'primary',
                onConfirm: async () => {
                  try {
                    await api.updateAdminSettings(settings);
                    showToast('تم حفظ الإعدادات بنجاح.', 'success');
                  } catch (err: any) {
                    showToast(err.message || 'فشل حفظ الإعدادات', 'error');
                  }
                },
              });
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
              <div>الصافي المطلوب تحويله: <strong className="text-emerald-600">{formatYer(payingWithdrawal.netAmount)} ر.ي</strong></div>
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
                step="any"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="مثال: 500 أو -500 أو 0.5"
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
            <SecureImageView
              storagePathOrUrl={previewImage}
              alt="صورة الإثبات"
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
      {/* Admin Campaign Details & Invoice Modals */}
      <CampaignDetailsModal
        campaign={selectedAdminCampaign}
        isAdminView={true}
        onClose={() => setSelectedAdminCampaign(null)}
        onOpenInvoice={(camp) => {
          setSelectedAdminCampaign(null);
          setInvoiceAdminCampaign(camp);
        }}
        onStart={handleStartCampaignAdmin}
        onSettle={handleSettleCampaignAdmin}
      />

      <CampaignInvoiceModal
        campaign={invoiceAdminCampaign}
        isAdminView={true}
        onClose={() => setInvoiceAdminCampaign(null)}
      />
    </div>
  );
};
