import React, { useEffect, useState } from 'react';
import {
  Landmark,
  Receipt,
  ArrowLeftRight,
  Scale,
  PlusCircle,
  CheckCircle2,
  XCircle,
  Eye,
  Upload,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  X,
  FileSearch,
} from 'lucide-react';
import { api } from '../../../api/client.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import type {
  ExternalAccount,
  ExternalAccountOwnerRole,
  ExternalAccountReconciliation,
  ExternalAccountTransfer,
  ExternalAccountType,
  ExternalDeposit,
  ExternalFundScope,
  FinancialAuditLog,
  FundSegregationSummary,
  TreasurySummary,
} from '../../../types/index.ts';
import { SecureImageView } from '../../common/SecureImageView.tsx';

interface ExternalAccountsViewProps {
  treasury: TreasurySummary | null;
  onRefreshAll: () => Promise<void>;
}

type SubTab = 'accounts' | 'deposits' | 'transfers' | 'reconciliation';

const fmt = (n: number | undefined | null) => Math.round(Number(n || 0)).toLocaleString('en-US');

const ACCOUNT_TYPE_LABELS: Record<ExternalAccountType, string> = {
  bank: 'حساب بنكي',
  exchange: 'شركة صرافة',
  ewallet: 'محفظة إلكترونية',
  cash: 'عهدة نقدية',
};

const OWNER_ROLE_LABELS: Record<ExternalAccountOwnerRole, string> = {
  owner: 'مالك المنصة',
  admin: 'مدير مالي / إداري',
  company: 'حساب الشركة الرسمي',
};

const FUND_SCOPE_LABELS: Record<ExternalFundScope, string> = {
  platform: 'أموال المنصة',
  advertiser: 'تحصيل المعلنين (التزامات)',
  mixed: 'مشترك (مفصول دفترياً)',
};

export const ExternalAccountsView: React.FC<ExternalAccountsViewProps> = ({
  treasury,
  onRefreshAll,
}) => {
  const { user, showToast, openConfirmModal } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('accounts');
  const [isLoading, setIsLoading] = useState(true);
  const [externalAccountsReady, setExternalAccountsReady] = useState(true);

  // Overview state
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [deposits, setDeposits] = useState<ExternalDeposit[]>([]);
  const [transfers, setTransfers] = useState<ExternalAccountTransfer[]>([]);
  const [reconciliations, setReconciliations] = useState<ExternalAccountReconciliation[]>([]);
  const [advertisers, setAdvertisers] = useState<
    Array<{ id: string; fullName: string; companyName?: string; phone: string; status: string }>
  >([]);
  const [cashVaultAccount, setCashVaultAccount] = useState<{
    financialAccountId: string;
    accountCode: string;
    balanceUnits: number;
  } | null>(null);
  const [segregation, setSegregation] = useState<FundSegregationSummary | undefined>(
    treasury?.fundSegregation
  );
  const [auditLogs, setAuditLogs] = useState<FinancialAuditLog[]>([]);

  // Account creator form
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [accName, setAccName] = useState('');
  const [accOwnerName, setAccOwnerName] = useState('خالد البحيري');
  const [accOwnerRole, setAccOwnerRole] = useState<ExternalAccountOwnerRole>('owner');
  const [accType, setAccType] = useState<ExternalAccountType>('bank');
  const [accProvider, setAccProvider] = useState('');
  const [accNumber, setAccNumber] = useState('');
  const [accScope, setAccScope] = useState<ExternalFundScope>('advertiser');
  const [accNotes, setAccNotes] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  // Deposit recorder form
  const [showNewDepositForm, setShowNewDepositForm] = useState(false);
  const [depExtAccId, setDepExtAccId] = useState('');
  const [depPurpose, setDepPurpose] = useState<'advertiser_wallet' | 'platform_capital'>('advertiser_wallet');
  const [depAdvertiserId, setDepAdvertiserId] = useState('');
  const [depAmount, setDepAmount] = useState('');
  const [depReference, setDepReference] = useState('');
  const [depReceiptUrl, setDepReceiptUrl] = useState('');
  const [depReceiptPreview, setDepReceiptPreview] = useState('');
  const [depDepositorName, setDepDepositorName] = useState('');
  const [depDepositorPhone, setDepDepositorPhone] = useState('');
  const [depNotes, setDepNotes] = useState('');
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isCreatingDeposit, setIsCreatingDeposit] = useState(false);
  const [depositFilter, setDepositFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Deposit review modals
  const [previewReceipt, setPreviewReceipt] = useState<string | null>(null);
  const [rejectingDeposit, setRejectingDeposit] = useState<ExternalDeposit | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Internal Transfer form
  const [xferFromFinId, setXferFromFinId] = useState('');
  const [xferToFinId, setXferToFinId] = useState('');
  const [xferAmount, setXferAmount] = useState('');
  const [xferRef, setXferRef] = useState('');
  const [xferReason, setXferReason] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);

  // Reconciliation form
  const [recExtAccId, setRecExtAccId] = useState('');
  const [recActualBalance, setRecActualBalance] = useState('');
  const [recApplyAdjustment, setRecApplyAdjustment] = useState(false);
  const [recReason, setRecReason] = useState('');
  const [isReconciling, setIsReconciling] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, auditRes] = await Promise.all([
        api.getExternalAccountsOverview(),
        api.getFinancialAuditLogs(100).catch(() => ({ logs: [] })),
      ]);

      setExternalAccountsReady(Boolean(overviewRes?.externalAccountsReady));
      const nextAccounts: ExternalAccount[] = overviewRes?.accounts || [];
      setAccounts(nextAccounts);
      setDeposits(overviewRes?.deposits || []);
      setTransfers(overviewRes?.transfers || []);
      setReconciliations(overviewRes?.reconciliations || []);
      setAdvertisers(overviewRes?.advertisers || []);
      setCashVaultAccount(overviewRes?.cashVaultAccount || null);
      if (overviewRes?.fundSegregation) {
        setSegregation(overviewRes.fundSegregation);
      }

      const relevantActions = new Set([
        'EXTERNAL_ACCOUNT_CREATED',
        'EXTERNAL_DEPOSIT_RECORDED',
        'EXTERNAL_ADVERTISER_DEPOSIT',
        'EXTERNAL_CAPITAL_DEPOSIT',
        'EXTERNAL_DEPOSIT_REJECTED',
        'INTERNAL_ACCOUNT_TRANSFER',
        'EXTERNAL_ACCOUNT_RECONCILED',
        'EXTERNAL_RECONCILIATION_ADJUSTMENT',
      ]);
      const filteredAudit = (auditRes?.logs || []).filter((l: FinancialAuditLog) =>
        relevantActions.has(String(l.actionType || '').toUpperCase())
      );
      setAuditLogs(filteredAudit);

      if (nextAccounts.length > 0) {
        if (!depExtAccId) setDepExtAccId(nextAccounts[0].id);
        if (!recExtAccId) setRecExtAccId(nextAccounts[0].id);
        if (!xferFromFinId) setXferFromFinId(nextAccounts[0].financialAccountId);
        if (!xferToFinId && nextAccounts.length > 1) {
          setXferToFinId(nextAccounts[1].financialAccountId);
        } else if (!xferToFinId && overviewRes?.cashVaultAccount) {
          setXferToFinId(overviewRes.cashVaultAccount.financialAccountId);
        }
      }
      if ((overviewRes?.advertisers || []).length > 0 && !depAdvertiserId) {
        setDepAdvertiserId(overviewRes.advertisers[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'فشل تحميل بيانات الحسابات الخارجية.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleReceiptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type.toLowerCase())) {
      showToast('يرجى اختيار صورة إيصال بصيغة PNG أو JPEG أو WEBP.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('حجم صورة الإيصال يجب أن لا يتجاوز 5 ميجابايت.', 'error');
      return;
    }

    setIsUploadingReceipt(true);
    try {
      const localPreview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
        reader.readAsDataURL(file);
      });

      try {
        const signed = await api.getExternalDepositReceiptUploadUrl({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        });
        const uploadResp = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!uploadResp.ok) throw new Error('Storage PUT failed');
        setDepReceiptUrl(signed.path);
        setDepReceiptPreview(localPreview);
        showToast('تم رفع صورة الإيصال وتأمينها بنجاح.', 'success');
      } catch {
        setDepReceiptUrl(localPreview);
        setDepReceiptPreview(localPreview);
        showToast('تم تجهيز صورة الإيصال محلياً بنجاح.', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'فشل تجهيز صورة الإيصال.', 'error');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') return;
    setIsCreatingAccount(true);
    try {
      await api.createExternalAccount({
        accountName: accName,
        ownerName: accOwnerName,
        ownerRole: accOwnerRole,
        accountType: accType,
        providerName: accProvider,
        accountNumber: accNumber,
        fundScope: accScope,
        notes: accNotes,
      });
      showToast('تم إنشاء الحساب الخارجي وربطه بحساب مستقل في دليل الحسابات.', 'success');
      setShowNewAccountForm(false);
      setAccName('');
      setAccProvider('');
      setAccNumber('');
      setAccNotes('');
      await Promise.all([loadData(), onRefreshAll()]);
    } catch (err: any) {
      showToast(err.message || 'فشل إنشاء الحساب الخارجي.', 'error');
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depExtAccId) {
      showToast('يرجى اختيار الحساب الخارجي المستلم.', 'error');
      return;
    }
    if (!depReceiptUrl) {
      showToast('صورة الإيصال البنكي/التحويل مطلوبة لتوثيق العملية.', 'error');
      return;
    }
    setIsCreatingDeposit(true);
    try {
      await api.createExternalDeposit({
        externalAccountId: depExtAccId,
        depositPurpose: depPurpose,
        advertiserId: depPurpose === 'advertiser_wallet' ? depAdvertiserId : null,
        amountUnits: Number(depAmount),
        referenceNumber: depReference,
        receiptUrl: depReceiptUrl,
        depositorName: depDepositorName,
        depositorPhone: depDepositorPhone,
        notes: depNotes,
      });
      showToast('تم تسجيل الإيداع بنجاح. الرصيد بانتظار الاعتماد اليدوي قبل شحن المحفظة.', 'success');
      setShowNewDepositForm(false);
      setDepAmount('');
      setDepReference('');
      setDepReceiptUrl('');
      setDepReceiptPreview('');
      setDepDepositorName('');
      setDepDepositorPhone('');
      setDepNotes('');
      await Promise.all([loadData(), onRefreshAll()]);
    } catch (err: any) {
      showToast(err.message || 'فشل تسجيل الإيداع.', 'error');
    } finally {
      setIsCreatingDeposit(false);
    }
  };

  const handleApproveDeposit = (dep: ExternalDeposit) => {
    openConfirmModal({
      title: 'اعتماد التحصيل اليدوي وشحن المحفظة',
      message:
        dep.depositPurpose === 'advertiser_wallet'
          ? `تأكيد استلام مبلغ ${fmt(dep.amountUnits)} ر.ي في (${dep.externalAccountName}) بالمرجع (${dep.referenceNumber}) وشحن محفظة المعلن "${dep.advertiserName || 'المعلن'}" كالتزام على المنصة (لن يُسجل كإيراد ولن يزيد الخزينة الافتراضية).`
          : `تأكيد إيداع رأس مال بمبلغ ${fmt(dep.amountUnits)} ر.ي في (${dep.externalAccountName}) بالمرجع (${dep.referenceNumber}).`,
      confirmLabel: 'اعتماد التحصيل الآن',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await api.approveExternalDeposit(dep.id);
          showToast('تم اعتماد التحصيل وتنفيذ القيد المحاسبي وشحن المحفظة بنجاح.', 'success');
          await Promise.all([loadData(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل اعتماد التحصيل.', 'error');
        }
      },
    });
  };

  const handleRejectDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDeposit || !rejectReason.trim()) {
      showToast('يرجى إدخال سبب رفض الإيصال.', 'error');
      return;
    }
    try {
      await api.rejectExternalDeposit(rejectingDeposit.id, rejectReason.trim());
      showToast('تم رفض الإيصال وتوثيقه في سجل المراجعة دون أي تعديل على الأرصدة.', 'info');
      setRejectingDeposit(null);
      setRejectReason('');
      await Promise.all([loadData(), onRefreshAll()]);
    } catch (err: any) {
      showToast(err.message || 'فشل رفض الإيصال.', 'error');
    }
  };

  const handleInternalTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Math.round(Number(xferAmount));
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      showToast('مبلغ التحويل الداخلي غير صالح.', 'error');
      return;
    }
    if (!xferFromFinId || !xferToFinId || xferFromFinId === xferToFinId) {
      showToast('يجب اختيار حسابين مختلفين للتحويل الداخلي.', 'error');
      return;
    }
    if (!xferReason.trim()) {
      showToast('سبب التحويل الداخلي مطلوب للتوثيق.', 'error');
      return;
    }

    openConfirmModal({
      title: 'تأكيد تنفيذ تحويل داخلي بين حسابات الإدارة',
      message: `سيتم تحويل ${fmt(numAmt)} ر.ي كحركة داخلية بين حسابات الأصول دون التأثير على الأرباح أو المصروفات أو الخزينة الافتراضية.`,
      confirmLabel: 'تنفيذ التحويل الداخلي',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        setIsTransferring(true);
        try {
          await api.executeInternalAccountTransfer({
            fromFinancialAccountId: xferFromFinId,
            toFinancialAccountId: xferToFinId,
            amountUnits: numAmt,
            reason: xferReason.trim(),
            referenceNumber: xferRef.trim() || undefined,
          });
          showToast('تم توثيق التحويل الداخلي بقيد مزدوج متوازن بنجاح.', 'success');
          setXferAmount('');
          setXferRef('');
          setXferReason('');
          await Promise.all([loadData(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل تنفيذ التحويل الداخلي.', 'error');
        } finally {
          setIsTransferring(false);
        }
      },
    });
  };

  const selectedRecAccount = accounts.find((a) => a.id === recExtAccId) || null;
  const parsedActual = recActualBalance.trim() === '' ? null : Math.round(Number(recActualBalance));
  const previewDiscrepancy =
    selectedRecAccount && parsedActual !== null && Number.isFinite(parsedActual)
      ? parsedActual - selectedRecAccount.accountingBalance
      : null;

  const handleReconcileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecAccount || parsedActual === null || parsedActual < 0) {
      showToast('يرجى اختيار الحساب وإدخال الرصيد الفعلي الصحيح.', 'error');
      return;
    }
    if (previewDiscrepancy !== 0 && recApplyAdjustment && !recReason.trim()) {
      showToast('يرجى كتابة سبب التسوية المحاسبية عند وجود فرق.', 'error');
      return;
    }

    openConfirmModal({
      title: recApplyAdjustment ? 'تأكيد المطابقة وترحيل قيد تسوية' : 'تأكيد تسجيل مطابقة الرصيد الفعلي',
      message:
        previewDiscrepancy === 0
          ? `الرصيد الفعلي يطابق الرصيد المحاسبي (${fmt(parsedActual)} ر.ي) لحساب "${selectedRecAccount.accountName}".`
          : recApplyAdjustment
            ? `سيتم تثبيت الرصيد الفعلي (${fmt(parsedActual)} ر.ي) وترحيل قيد تسوية بالفارق (${fmt(previewDiscrepancy)} ر.ي) مع توثيقه في سجل التدقيق.`
            : `سيتم تسجيل وجود فرق قدره ${fmt(previewDiscrepancy)} ر.ي للمراجعة دون تعديل الرصيد المحاسبي حالياً.`,
      confirmLabel: 'تأكيد وحفظ المطابقة',
      cancelLabel: 'إلغاء',
      variant: recApplyAdjustment && previewDiscrepancy !== 0 ? 'warning' : 'primary',
      onConfirm: async () => {
        setIsReconciling(true);
        try {
          await api.reconcileExternalAccount(selectedRecAccount.id, {
            actualBalanceUnits: parsedActual,
            applyAdjustment: recApplyAdjustment && previewDiscrepancy !== 0,
            adjustmentReason: recReason.trim() || undefined,
          });
          showToast('تم حفظ نتائج المطابقة وتحديث سجل التدقيق بنجاح.', 'success');
          setRecActualBalance('');
          setRecReason('');
          setRecApplyAdjustment(false);
          await Promise.all([loadData(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل حفظ المطابقة.', 'error');
        } finally {
          setIsReconciling(false);
        }
      },
    });
  };

  const pendingDepositsCount = deposits.filter((d) => d.status === 'pending').length;
  const visibleDeposits = deposits.filter((d) => depositFilter === 'all' || d.status === depositFilter);

  const transferableAssetOptions = [
    ...accounts.map((a) => ({
      financialAccountId: a.financialAccountId,
      label: `${a.accountName} (${a.ownerName} - رصيد: ${fmt(a.accountingBalance)} ر.ي)`,
    })),
    ...(cashVaultAccount
      ? [
          {
            financialAccountId: cashVaultAccount.financialAccountId,
            label: `الخزينة النقدية الرئيسية (PLATFORM-CASH-VAULT - رصيد: ${fmt(cashVaultAccount.balanceUnits)} ر.ي)`,
          },
        ]
      : []),
  ];

  const activeSeg = segregation || treasury?.fundSegregation;

  return (
    <div className="space-y-6">
      {/* Migration 022 Readiness Notice */}
      {!externalAccountsReady && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-amber-900 dark:text-amber-200">
              جداول الحسابات الخارجية بانتظار تنفيذ ملف الترحيل 022 في قاعدة البيانات
            </div>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              الفصل المالي بين أموال المنصة والمعلنين والمستخدمين يعمل حالياً من دفتر الأستاذ الحي. لتفعيل إدارة الحسابات الخارجية والإيداعات المرفقة بإيصالات والمطابقة، نفّذ ملف{' '}
              <span className="font-mono font-semibold" dir="ltr">
                022_external_accounts_and_advertiser_custody.sql
              </span>{' '}
              في Supabase SQL Editor.
            </p>
          </div>
        </div>
      )}

      {/* 3-Way Fund Segregation Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
            <span>أموال المنصة الخاصة</span>
            <Landmark className="w-4 h-4" />
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {fmt((activeSeg?.platformFunds.cashVaultTotal || 0) + (activeSeg?.platformFunds.externalPlatformBalance || 0))}{' '}
            <span className="text-xs font-normal text-slate-500">ر.ي أصول نقدية</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span className="font-sans">الخزينة النقدية (Vault):</span>
              <span>{fmt(activeSeg?.platformFunds.cashVaultTotal)} ر.ي</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">الحسابات الخارجية للمنصة:</span>
              <span>{fmt(activeSeg?.platformFunds.externalPlatformBalance)} ر.ي</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">الإيرادات المحققة (تشمل عمولة المعلنين):</span>
              <span className="text-emerald-600">{fmt(activeSeg?.platformFunds.realizedRevenuesTotal)} ر.ي</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-blue-700 dark:text-blue-400">
            <span>أموال المعلنين (التزامات — ليست أرباحاً)</span>
            <Receipt className="w-4 h-4" />
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums text-blue-700 dark:text-blue-400">
            {fmt(activeSeg?.advertiserFunds.totalAdvertiserLiabilities)}{' '}
            <span className="text-xs font-normal text-slate-500">ر.ي التزام</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span className="font-sans">محافظ المعلنين المتاحة:</span>
              <span>{fmt(activeSeg?.advertiserFunds.advertiserWalletsTotal)} ر.ي</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">ضمان مكافآت ورسوم الحملات:</span>
              <span>
                {fmt((activeSeg?.advertiserFunds.campaignBudgetEscrow || 0) + (activeSeg?.advertiserFunds.campaignFeeEscrow || 0))} ر.ي
              </span>
            </div>
            <div className="flex justify-between text-amber-600 dark:text-amber-400">
              <span className="font-sans">بانتظار الاعتماد ({activeSeg?.advertiserFunds.pendingExternalDepositsCount || 0}):</span>
              <span>{fmt(activeSeg?.advertiserFunds.pendingExternalDepositsAmount)} ر.ي</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span>أموال المستخدمين المنفذين (التزامات للغير)</span>
            <ShieldCheck className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {fmt(activeSeg?.userFunds.totalUserLiabilities)}{' '}
            <span className="text-xs font-normal text-slate-500">ر.ي التزام</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span className="font-sans">محافظ المستخدمين المنفذين:</span>
              <span>{fmt(activeSeg?.userFunds.workerWalletsTotal)} ر.ي</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">سحوبات محجوزة قيد الصرف:</span>
              <span>{fmt(activeSeg?.userFunds.withdrawalReservedTotal)} ر.ي</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">ضمان المهام الإدارية:</span>
              <span>{fmt(activeSeg?.userFunds.adminTaskEscrowTotal)} ر.ي</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-navigation Toolbar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { id: 'accounts', label: `الحسابات الخارجية (${accounts.length})`, icon: Landmark },
            { id: 'deposits', label: `إيداعات وتحصيل المعلنين (${pendingDepositsCount} معلق)`, icon: Receipt },
            { id: 'transfers', label: `التحويلات الداخلية (${transfers.length})`, icon: ArrowLeftRight },
            { id: 'reconciliation', label: `المطابقة والتسويات (${reconciliations.length})`, icon: Scale },
          ].map((item) => {
            const Icon = item.icon;
            const active = subTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSubTab(item.id as SubTab)}
                className={`min-h-[40px] px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="min-h-[40px] px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث السجلات</span>
        </button>
      </div>

      {/* TAB 1: EXTERNAL ACCOUNTS DIRECTORY */}
      {subTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                الحسابات الخارجية للمالك والمدير (دون المساس بالخزينة الحالية)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                كل حساب خارجي يملك حساب أصل مستقل (EXT-ACC-*) في دفتر الأستاذ مع متابعة الرصيد المحاسبي مقابل الرصيد الفعلي.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewAccountForm(!showNewAccountForm)}
              className="min-h-[44px] px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>إضافة حساب خارجي جديد</span>
            </button>
          </div>

          {showNewAccountForm && (
            <form
              onSubmit={handleCreateAccount}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
            >
              <h4 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                تعريف حساب خارجي مستقل
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">اسم الحساب التعريفي</label>
                  <input
                    type="text"
                    required
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="مثال: حساب الكريمي - تحصيل المعلنين"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">صاحب الحساب</label>
                  <input
                    type="text"
                    required
                    value={accOwnerName}
                    onChange={(e) => setAccOwnerName(e.target.value)}
                    placeholder="اسم صاحب الحساب المسؤول"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">صفة صاحب الحساب</label>
                  <select
                    value={accOwnerRole}
                    onChange={(e) => setAccOwnerRole(e.target.value as ExternalAccountOwnerRole)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="owner">مالك المنصة</option>
                    <option value="admin">مدير مالي / إداري</option>
                    <option value="company">حساب الشركة الرسمي</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">نوع الحساب</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as ExternalAccountType)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="bank">حساب بنكي</option>
                    <option value="exchange">شركة صرافة</option>
                    <option value="ewallet">محفظة إلكترونية</option>
                    <option value="cash">عهدة نقدية</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">اسم البنك / الصرافة / المحفظة</label>
                  <input
                    type="text"
                    required
                    value={accProvider}
                    onChange={(e) => setAccProvider(e.target.value)}
                    placeholder="مثال: بنك الكريمي / النجم / جوالي"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">رقم الحساب / الهاتف</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={accNumber}
                    onChange={(e) => setAccNumber(e.target.value)}
                    placeholder="3001234567"
                    className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">نطاق الأموال</label>
                  <select
                    value={accScope}
                    onChange={(e) => setAccScope(e.target.value as ExternalFundScope)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="advertiser">تحصيل المعلنين (التزامات)</option>
                    <option value="platform">أموال المنصة الخاصة</option>
                    <option value="mixed">مشترك (يُفصل دفترياً)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">ملاحظات إضافية</label>
                  <input
                    type="text"
                    value={accNotes}
                    onChange={(e) => setAccNotes(e.target.value)}
                    placeholder="تفاصيل الفرع أو تعليمات التحصيل..."
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewAccountForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isCreatingAccount}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {isCreatingAccount ? 'جارِ الإنشاء...' : 'حفظ وإنشاء الحساب المستقل'}
                </button>
              </div>
            </form>
          )}

          {/* External Accounts Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.length === 0 ? (
              <div className="md:col-span-2 p-8 text-center rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                لا توجد حسابات خارجية مسجلة بعد. أضف أول حساب بنكي أو صرافة للبدء بتوثيق التحصيل.
              </div>
            ) : (
              accounts.map((acc) => {
                const hasDiff = acc.discrepancyUnits !== 0;
                return (
                  <div
                    key={acc.id}
                    className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white">{acc.accountName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {acc.providerName} · <span className="font-mono" dir="ltr">{acc.accountNumber}</span>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400" dir="ltr">
                        {acc.accountCode}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] py-2 border-y border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-slate-400 block">صاحب الحساب</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {acc.ownerName} ({OWNER_ROLE_LABELS[acc.ownerRole]})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">النوع</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {ACCOUNT_TYPE_LABELS[acc.accountType]}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">النطاق</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {FUND_SCOPE_LABELS[acc.fundScope]}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[10px] font-sans text-slate-500 block">الرصيد المحاسبي</span>
                        <strong className="text-slate-900 dark:text-white">{fmt(acc.accountingBalance)} ر.ي</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[10px] font-sans text-slate-500 block">الرصيد الفعلي</span>
                        <strong className="text-emerald-600 dark:text-emerald-400">{fmt(acc.actualBalance)} ر.ي</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[10px] font-sans text-slate-500 block">الفارق</span>
                        <strong className={hasDiff ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>
                          {acc.lastReconciledAt ? `${acc.discrepancyUnits > 0 ? '+' : ''}${fmt(acc.discrepancyUnits)} ر.ي` : 'لم يُطابق'}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RECEIPT-BACKED DEPOSITS & MANUAL APPROVAL */}
      {subTab === 'deposits' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                سجل الإيداعات والتحصيل اليدوي الموثق بالإيصال
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تُقيد أموال المعلنين كالتزامات على المنصة (WALLET-* مقابل EXT-ACC-*) بعد التحقق اليدوي من الإيصال، مع منع تكرار الرقم المرجعي.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewDepositForm(!showNewDepositForm)}
              className="min-h-[44px] px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>تسجيل إيداع جديد بإيصال</span>
            </button>
          </div>

          {showNewDepositForm && (
            <form
              onSubmit={handleCreateDeposit}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs"
            >
              <h4 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                توثيق إيداع وارد في حساب خارجي
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الحساب الخارجي المستلم</label>
                  <select
                    required
                    value={depExtAccId}
                    onChange={(e) => setDepExtAccId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="">اختر الحساب الخارجي...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} ({a.providerName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">غرض الإيداع</label>
                  <select
                    value={depPurpose}
                    onChange={(e) => setDepPurpose(e.target.value as 'advertiser_wallet' | 'platform_capital')}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="advertiser_wallet">تحصيل لشحن محفظة معلن (التزام للغير)</option>
                    <option value="platform_capital">تمويل رأس مال المالك في الحساب</option>
                  </select>
                </div>

                {depPurpose === 'advertiser_wallet' && (
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">المعلن المستفيد</label>
                    <select
                      required
                      value={depAdvertiserId}
                      onChange={(e) => setDepAdvertiserId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                    >
                      <option value="">اختر المعلن...</option>
                      {advertisers.map((adv) => (
                        <option key={adv.id} value={adv.id}>
                          {adv.fullName} {adv.companyName ? `(${adv.companyName})` : ''} — {adv.phone}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">المبلغ (ر.ي)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={depAmount}
                    onChange={(e) => setDepAmount(e.target.value)}
                    placeholder="مثال: 50000"
                    className="w-full px-3 py-2 font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الرقم المرجعي للإيصال (فريد لا يتكرر)</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={depReference}
                    onChange={(e) => setDepReference(e.target.value)}
                    placeholder="KUR-2026-98412"
                    className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">اسم المودع / المحول</label>
                  <input
                    type="text"
                    value={depDepositorName}
                    onChange={(e) => setDepDepositorName(e.target.value)}
                    placeholder="اسم المحول كما بالإيصال"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">صورة الإيصال البنكي (إلزامية)</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="min-h-[40px] px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold cursor-pointer inline-flex items-center gap-1.5">
                      <Upload className="w-4 h-4" />
                      <span>{isUploadingReceipt ? 'جارِ رفع الإيصال...' : 'رفع صورة الإيصال'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleReceiptFileChange}
                      />
                    </label>
                    {depReceiptPreview && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>تم إرفاق الإيصال بنجاح</span>
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">ملاحظات</label>
                  <input
                    type="text"
                    value={depNotes}
                    onChange={(e) => setDepNotes(e.target.value)}
                    placeholder="أي تفاصيل إضافية..."
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewDepositForm(false)}
                  className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isCreatingDeposit || isUploadingReceipt}
                  className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {isCreatingDeposit ? 'جارِ الحفظ...' : 'تسجيل بانتظار الاعتماد'}
                </button>
              </div>
            </form>
          )}

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { id: 'all', label: `الكل (${deposits.length})` },
              { id: 'pending', label: `بانتظار التحقق (${pendingDepositsCount})` },
              { id: 'approved', label: `معتمد (${deposits.filter((d) => d.status === 'approved').length})` },
              { id: 'rejected', label: `مرفوض (${deposits.filter((d) => d.status === 'rejected').length})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDepositFilter(f.id as any)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  depositFilter === f.id
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Deposits List */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الحساب الخارجي</th>
                    <th className="py-3 px-4">المستفيد / الغرض</th>
                    <th className="py-3 px-4 font-mono">المبلغ</th>
                    <th className="py-3 px-4 font-mono">المرجع والإيصال</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleDeposits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        لا توجد إيداعات مطابقة للتصفية الحالية.
                      </td>
                    </tr>
                  ) : (
                    visibleDeposits.map((dep) => (
                      <tr key={dep.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">{dep.externalAccountName}</div>
                          <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                            {new Date(dep.createdAt).toLocaleString('ar-YE')}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {dep.depositPurpose === 'advertiser_wallet' ? (
                            <>
                              <div className="font-bold text-slate-800 dark:text-slate-200">
                                {dep.advertiserName || 'معلن'}
                              </div>
                              <div className="text-[10px] text-blue-600 dark:text-blue-400">
                                شحن محفظة معلن (التزام للغير)
                              </div>
                            </>
                          ) : (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              إيداع رأس مال المالك
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-extrabold tabular-nums text-slate-900 dark:text-white">
                          {fmt(dep.amountUnits)} ر.ي
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300" dir="ltr">
                            {dep.referenceNumber}
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviewReceipt(dep.receiptUrl)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline"
                          >
                            <Eye className="w-3 h-3" />
                            <span>معاينة الإيصال</span>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          {dep.status === 'approved' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>معتمد وشُحنت المحفظة</span>
                            </span>
                          ) : dep.status === 'rejected' ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-rose-600 font-bold">
                                <XCircle className="w-3.5 h-3.5" />
                                <span>مرفوض</span>
                              </span>
                              {dep.rejectionReason && (
                                <div className="text-[10px] text-slate-400 max-w-[160px] truncate" title={dep.rejectionReason}>
                                  {dep.rejectionReason}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">بانتظار الاعتماد اليدوي</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-left">
                          {dep.status === 'pending' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleApproveDeposit(dep)}
                                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"
                              >
                                اعتماد التحصيل
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingDeposit(dep);
                                  setRejectReason('');
                                }}
                                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 font-bold text-[11px]"
                              >
                                رفض
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-400">
                              {dep.ledgerTransactionId ? `#${dep.ledgerTransactionId.slice(0, 8)}` : '—'}
                            </span>
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

      {/* TAB 3: INTERNAL TRANSFERS */}
      {subTab === 'transfers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5">
            <form
              onSubmit={handleInternalTransfer}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs"
            >
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-600" />
                  <span>تسجيل تحويل داخلي بين حسابات الإدارة</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ينقل الرصيد بين أصول المالك والمدير (بنوك / صرافات / الخزينة النقدية) دون التأثير على الأرباح أو الخزينة الافتراضية.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">من حساب (المصدر)</label>
                <select
                  required
                  value={xferFromFinId}
                  onChange={(e) => setXferFromFinId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  <option value="">اختر الحساب المصدر...</option>
                  {transferableAssetOptions.map((opt) => (
                    <option key={opt.financialAccountId} value={opt.financialAccountId}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">إلى حساب (المستلم)</label>
                <select
                  required
                  value={xferToFinId}
                  onChange={(e) => setXferToFinId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  <option value="">اختر الحساب المستلم...</option>
                  {transferableAssetOptions.map((opt) => (
                    <option key={opt.financialAccountId} value={opt.financialAccountId}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">المبلغ (ر.ي)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={xferAmount}
                    onChange={(e) => setXferAmount(e.target.value)}
                    placeholder="10000"
                    className="w-full px-3 py-2 font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">مرجع التحويل (اختياري)</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={xferRef}
                    onChange={(e) => setXferRef(e.target.value)}
                    placeholder="XFER-001"
                    className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">سبب التحويل الداخلي (إلزامي)</label>
                <textarea
                  rows={2}
                  required
                  value={xferReason}
                  onChange={(e) => setXferReason(e.target.value)}
                  placeholder="مثال: ترحيل السيولة من حساب الصرافة إلى الحساب البنكي الرئيسي"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              <button
                type="submit"
                disabled={isTransferring}
                className="w-full min-h-[44px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl"
              >
                {isTransferring ? 'جارِ تنفيذ التحويل...' : 'تنفيذ وتوثيق التحويل الداخلي'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 font-bold text-sm text-slate-900 dark:text-white">
              سجل التحويلات الداخلية بين الحسابات
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">التاريخ</th>
                    <th className="py-3 px-4">من حساب</th>
                    <th className="py-3 px-4">إلى حساب</th>
                    <th className="py-3 px-4 font-mono">المبلغ</th>
                    <th className="py-3 px-4">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {transfers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        لا توجد تحويلات داخلية مسجلة حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    transfers.map((tr) => (
                      <tr key={tr.id}>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(tr.createdAt).toLocaleString('ar-YE')}
                        </td>
                        <td className="py-2.5 px-4 font-semibold">{tr.fromAccountName}</td>
                        <td className="py-2.5 px-4 font-semibold text-emerald-700 dark:text-emerald-400">{tr.toAccountName}</td>
                        <td className="py-2.5 px-4 font-mono font-bold tabular-nums">{fmt(tr.amountUnits)} ر.ي</td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{tr.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: RECONCILIATION, ADJUSTMENTS & AUDIT */}
      {subTab === 'reconciliation' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5">
              <form
                onSubmit={handleReconcileSubmit}
                className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs"
              >
                <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Scale className="w-4 h-4 text-emerald-600" />
                    <span>مطابقة الحساب الخارجي والتسوية المحاسبية</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    قارن الرصيد الفعلي في كشف البنك أو الصرافة بالرصيد المحاسبي بدفتر الأستاذ.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الحساب الخارجي</label>
                  <select
                    required
                    value={recExtAccId}
                    onChange={(e) => setRecExtAccId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="">اختر الحساب...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} (محاسبي: {fmt(a.accountingBalance)} ر.ي)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRecAccount && (
                  <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 font-mono">
                    <div>
                      <span className="font-sans text-[10px] text-slate-500 block">الرصيد المحاسبي</span>
                      <strong className="text-slate-900 dark:text-white">{fmt(selectedRecAccount.accountingBalance)} ر.ي</strong>
                    </div>
                    <div>
                      <span className="font-sans text-[10px] text-slate-500 block">آخر رصيد فعلي مسجل</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">{fmt(selectedRecAccount.actualBalance)} ر.ي</strong>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الرصيد الفعلي من الكشف البنكي (ر.ي)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={recActualBalance}
                    onChange={(e) => setRecActualBalance(e.target.value)}
                    placeholder="أدخل الرصيد الفعلي الموجود حالياً بالحساب"
                    className="w-full px-3 py-2 font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>

                {previewDiscrepancy !== null && (
                  <div
                    className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
                      previewDiscrepancy === 0
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    <span>الفارق المكتشف (الفعلي − المحاسبي):</span>
                    <span className="font-mono font-extrabold">
                      {previewDiscrepancy > 0 ? `+${fmt(previewDiscrepancy)}` : fmt(previewDiscrepancy)} ر.ي
                    </span>
                  </div>
                )}

                {previewDiscrepancy !== null && previewDiscrepancy !== 0 && (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={recApplyAdjustment}
                        onChange={(e) => setRecApplyAdjustment(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>ترحيل قيد تسوية محاسبي لمطابقة الرصيد الدفتري مع الفعلي</span>
                    </label>
                    {recApplyAdjustment && (
                      <textarea
                        rows={2}
                        required
                        value={recReason}
                        onChange={(e) => setRecReason(e.target.value)}
                        placeholder="سبب التسوية (مثال: عمولة تحويل بنكي مخصومة من البنك، أو فرق مطابقة كشف)"
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                      />
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isReconciling || !selectedRecAccount}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl"
                >
                  {isReconciling ? 'جارِ الحفظ...' : 'تأكيد وحفظ نتيجة المطابقة'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 font-bold text-sm text-slate-900 dark:text-white">
                سجل المطابقات والتسويات
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-4">الحساب</th>
                      <th className="py-2.5 px-4 font-mono">المحاسبي</th>
                      <th className="py-2.5 px-4 font-mono">الفعلي</th>
                      <th className="py-2.5 px-4 font-mono">الفارق</th>
                      <th className="py-2.5 px-4">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {reconciliations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          لا توجد عمليات مطابقة مسجلة بعد.
                        </td>
                      </tr>
                    ) : (
                      reconciliations.map((rec) => (
                        <tr key={rec.id}>
                          <td className="py-2.5 px-4">
                            <div className="font-bold text-slate-800 dark:text-slate-200">{rec.externalAccountName}</div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {new Date(rec.createdAt).toLocaleString('ar-YE')}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums">{fmt(rec.accountingBalanceUnits)}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums">{fmt(rec.actualBalanceUnits)}</td>
                          <td className="py-2.5 px-4 font-mono font-bold tabular-nums">
                            {rec.discrepancyUnits > 0 ? `+${fmt(rec.discrepancyUnits)}` : fmt(rec.discrepancyUnits)}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`font-bold ${
                                rec.status === 'matched'
                                  ? 'text-emerald-600'
                                  : rec.status === 'adjusted'
                                    ? 'text-blue-600'
                                    : 'text-amber-600'
                              }`}
                            >
                              {rec.status === 'matched'
                                ? 'متطابق'
                                : rec.status === 'adjusted'
                                  ? 'تمت التسوية'
                                  : 'يوجد فرق'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Audit Trail */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
              <FileSearch className="w-4 h-4 text-emerald-600" />
              <span>سجل التدقيق المالي للحسابات الخارجية ({auditLogs.length})</span>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">التاريخ</th>
                    <th className="py-2.5 px-4">الإجراء</th>
                    <th className="py-2.5 px-4">المنفذ</th>
                    <th className="py-2.5 px-4">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400">
                        لا توجد سجلات تدقيق للحسابات الخارجية حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('ar-YE')}
                        </td>
                        <td className="py-2 px-4 font-mono font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                          {log.actionType}
                        </td>
                        <td className="py-2 px-4">{log.actorName || 'النظام'}</td>
                        <td className="py-2 px-4 font-mono text-[11px] text-slate-500 max-w-md truncate" dir="ltr">
                          {JSON.stringify(log.details)}
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

      {/* Receipt Image Preview Modal */}
      {previewReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">معاينة صورة الإيصال</h4>
              <button
                type="button"
                onClick={() => setPreviewReceipt(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto flex items-center justify-center bg-slate-50 dark:bg-slate-950 rounded-xl p-2">
              <SecureImageView
                storagePathOrUrl={previewReceipt}
                alt="صورة إيصال الإيداع"
                className="max-h-[65vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Reject Deposit Modal */}
      {rejectingDeposit && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleRejectDepositSubmit}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">رفض إيصال الإيداع</h4>
              <button
                type="button"
                onClick={() => setRejectingDeposit(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              سيتم رفض الإيصال رقم <strong className="font-mono">{rejectingDeposit.referenceNumber}</strong> بمبلغ{' '}
              <strong className="font-mono">{fmt(rejectingDeposit.amountUnits)} ر.ي</strong> دون أي أثر مالي على الأرصدة.
            </p>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">سبب الرفض (إلزامي)</label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="مثال: رقم المرجع غير مطابق لكشف الحساب البنكي أو صورة الإيصال غير واضحة"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectingDeposit(null)}
                className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-2 font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg"
              >
                تأكيد الرفض
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
