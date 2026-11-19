import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { CampaignItem, TaskCategory } from '../../types/index.ts';
import { CampaignServiceFeeDetails } from './CampaignServiceFeeDetails.tsx';
import { CampaignDetailsModal, CampaignInvoiceModal, getCampaignStatusLabel } from './CampaignModals.tsx';
import { SecureImageView } from '../common/SecureImageView.tsx';
import { GeoLocationSelector, type GeoMultiValue } from '../common/GeoLocationSelector.tsx';
import { addMoney, calcPercentageYer, formatYer, mulMoney, roundYer6, subMoney } from '../../../shared/money.ts';
import {
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';

interface AdvertiserPortalProps {
  onNavigateWallet?: () => void;
}

const CATEGORIES: Array<{ value: TaskCategory; label: string }> = [
  { value: 'app_testing', label: 'تجربة وتقييم التطبيقات' },
  { value: 'social_engagement', label: 'تفاعل شبكات التواصل' },
  { value: 'surveys', label: 'استبيانات وآراء' },
  { value: 'content_writing', label: 'كتابة ومراجعة المحتوى' },
  { value: 'data_entry', label: 'إدخال وتنظيم البيانات' },
  { value: 'review_ratings', label: 'مراجعات وتقييمات' },
  { value: 'local_services', label: 'خدمات محلية' },
];

const REWARD_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500];
const SLOTS_PRESETS = [50, 100, 250, 500];

async function compressLogoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الشعار.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ملف الصورة غير صالح.'));
      img.onload = () => {
        const maxDim = 256;
        const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
        const w = Math.max(32, Math.round((img.width || maxDim) * scale));
        const h = Math.max(32, Math.round((img.height || maxDim) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('تعذر معالجة الصورة في المتصفح.'));
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const AdvertiserPortal: React.FC<AdvertiserPortalProps> = ({ onNavigateWallet }) => {
  const { user, wallet, refreshWallet, showToast, openConfirmModal } = useAuth();

  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [feePercentage, setFeePercentage] = useState<number>(20);
  const [walletBalance, setWalletBalance] = useState<number>(wallet?.availableBalance || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create campaign form state
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('app_testing');
  const [rewardInput, setRewardInput] = useState('10');
  const [slotsInput, setSlotsInput] = useState('100');
  const [timeEstimate, setTimeEstimate] = useState('10');
  const [durationDays, setDurationDays] = useState('7');
  const [requireImage, setRequireImage] = useState(true);
  const [requireText, setRequireText] = useState(true);

  // Phase 4: Advertiser Identity controls
  const [hideAdvertiserName, setHideAdvertiserName] = useState(false);
  const [advertiserDisplayName, setAdvertiserDisplayName] = useState(
    () => user?.companyName || user?.fullName || ''
  );
  const [advertiserLogoUrl, setAdvertiserLogoUrl] = useState<string>('');
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Geographic Targeting State
  const [geoTarget, setGeoTarget] = useState<GeoMultiValue>({
    countryId: '',
    isNationwide: true,
    targetDivisionIds: [],
    targetDivisions: [],
  });

  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [creationKey, setCreationKey] = useState<string>(() => crypto.randomUUID());

  // Phase 4: Modals & Post-Create Banner
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null);
  const [invoiceCampaign, setInvoiceCampaign] = useState<CampaignItem | null>(null);
  const [lastCreatedCampaign, setLastCreatedCampaign] = useState<CampaignItem | null>(null);

  const isApprovedAdvertiser = Boolean(user && user.role === 'advertiser' && user.status === 'active');

  useEffect(() => {
    if (!advertiserDisplayName && (user?.companyName || user?.fullName)) {
      setAdvertiserDisplayName(user.companyName || user.fullName || '');
    }
  }, [user?.companyName, user?.fullName]);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getAdvertiserCampaigns();
      setCampaigns(Array.isArray(res.campaigns) ? res.campaigns : []);
      if (typeof res.feePercentage === 'number') setFeePercentage(res.feePercentage);
      if (typeof res.walletBalance === 'number') setWalletBalance(res.walletBalance);
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تحميل بيانات بوابة المعلن.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'advertiser') {
      loadData();
    } else {
      setIsLoading(false);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (typeof wallet?.availableBalance === 'number') {
      setWalletBalance(wallet.availableBalance);
    }
  }, [wallet?.availableBalance]);

  // Live instant cost breakdown
  const costBreakdown = useMemo(() => {
    const rewardUnits = Math.max(0, roundYer6(rewardInput || 0));
    const slots = Math.max(0, Math.round(Number(slotsInput) || 0));
    const budgetUnits = mulMoney(rewardUnits, slots);
    const feeUnits = calcPercentageYer(budgetUnits, feePercentage);
    const totalUnits = addMoney(budgetUnits, feeUnits);
    const isValid = rewardUnits > 0 && slots > 0 && budgetUnits > 0;
    const deficitUnits = Math.max(0, subMoney(totalUnits, walletBalance));
    const isInsufficient = isValid && walletBalance < totalUnits;

    return {
      rewardUnits,
      slots,
      budgetUnits,
      feeUnits,
      totalUnits,
      isValid,
      deficitUnits,
      isInsufficient,
    };
  }, [rewardInput, slotsInput, feePercentage, walletBalance]);

  const effectivePublicIdentity = useMemo(() => {
    if (hideAdvertiserName) return 'معلن عبر يمن تاسك';
    return advertiserDisplayName.trim() || user?.companyName || user?.fullName || 'معلن عبر يمن تاسك';
  }, [hideAdvertiserName, advertiserDisplayName, user?.companyName, user?.fullName]);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast('حجم الشعار كبير جداً، يرجى اختيار صورة أقل من 2 ميجابايت.', 'error');
      e.target.value = '';
      return;
    }

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (file.type && !allowed.includes(file.type.toLowerCase())) {
      showToast('صيغة الشعار غير مدعومة. يرجى اختيار PNG أو JPEG أو WEBP.', 'error');
      e.target.value = '';
      return;
    }

    setIsUploadingLogo(true);
    try {
      const signRes = await api.getAdvertiserLogoUploadUrl({
        fileName: file.name,
        contentType: file.type || 'image/png',
        fileSize: file.size,
      });

      if (signRes?.signedUrl && signRes?.path) {
        const putRes = await fetch(signRes.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'image/png' },
          body: file,
        });
        if (putRes.ok) {
          setAdvertiserLogoUrl(signRes.path);
          showToast('تم رفع شعار المعلن بأمان.', 'success');
          return;
        }
      }

      // Safe raster fallback when cloud signed upload is unavailable
      const fallbackDataUrl = await compressLogoToDataUrl(file);
      setAdvertiserLogoUrl(fallbackDataUrl);
      showToast('تم تجهيز شعار المعلن وإرفاقه بالحملة.', 'success');
    } catch {
      try {
        const fallbackDataUrl = await compressLogoToDataUrl(file);
        setAdvertiserLogoUrl(fallbackDataUrl);
        showToast('تم تجهيز شعار المعلن وإرفاقه بالحملة.', 'success');
      } catch (innerErr: any) {
        showToast(innerErr?.message || 'تعذر معالجة صورة الشعار.', 'error');
      }
    } finally {
      setIsUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isApprovedAdvertiser) {
      showToast('حساب المعلن قيد المراجعة ولم يتم اعتماده من الإدارة بعد.', 'error');
      return;
    }
    if (!costBreakdown.isValid) {
      showToast('يرجى إدخال سعر مهمة وعدد مهمات صحيحين أكبر من صفر.', 'error');
      return;
    }
    if (costBreakdown.isInsufficient) {
      showToast(
        `رصيد المحفظة غير كافٍ. العجز المطلوب شحنه: ${formatYer(costBreakdown.deficitUnits)} ر.ي`,
        'error'
      );
      return;
    }
    if (isSubmittingRef.current || isSubmitting) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const daysNum = Math.min(30, Math.max(1, Number(durationDays) || 7));
      const deadlineAt = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toISOString();

      const res = await api.createAdvertiserCampaign({
        title: title.trim(),
        description: description.trim(),
        category,
        rewardUnits: costBreakdown.rewardUnits,
        slots: costBreakdown.slots,
        timeEstimateMinutes: Math.max(1, Math.round(Number(timeEstimate) || 10)),
        deadlineAt,
        proofRequirements: { requireImage, requireText },
        creationKey,
        hideAdvertiserName,
        advertiserDisplayName: hideAdvertiserName
          ? undefined
          : (advertiserDisplayName.trim() || user?.companyName || user?.fullName || undefined),
        advertiserLogoUrl: hideAdvertiserName ? undefined : (advertiserLogoUrl || undefined),
        countryId: geoTarget.countryId || undefined,
        isNationwide: geoTarget.isNationwide,
        targetDivisionIds: geoTarget.isNationwide ? [] : geoTarget.targetDivisionIds,
      });

      showToast(
        res?.idempotent
          ? 'تم استرجاع الحملة المنشأة مسبقاً بنفس طلب التمويل.'
          : 'تم إنشاء الحملة وحجز الميزانية والرسوم بأمان! يمكنك عرض الفاتورة أو تشغيل الحملة الآن.',
        'success'
      );

      if (res?.campaign) {
        setLastCreatedCampaign(res.campaign);
      }

      setTitle('');
      setDescription('');
      setCreationKey(crypto.randomUUID());
      await Promise.all([loadData(), refreshWallet()]);
    } catch (err: any) {
      showToast(err?.message || 'تعذر إنشاء الحملة الإعلانية.', 'error');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleStartCampaign = (camp: CampaignItem) => {
    openConfirmModal({
      title: 'تفعيل وبدء الحملة الإعلانية',
      message: `سيتم نشر المهمة للجمهور (${camp.slots} مهمة × ${formatYer(camp.rewardUnits)} ر.ي) وتثبيت رسوم المنصة المحجوزة (${formatYer(camp.feeUnits)} ر.ي). هل تريد المتابعة؟`,
      confirmLabel: 'بدء الحملة الآن',
      cancelLabel: 'تراجع',
      variant: 'primary',
      onConfirm: async () => {
        setActionBusyId(camp.id);
        try {
          await api.startAdvertiserCampaign(camp.id);
          showToast('تم بدء الحملة ونشر مهامها للمنفذين بنجاح.', 'success');
          await Promise.all([loadData(), refreshWallet()]);
        } catch (err: any) {
          showToast(err?.message || 'فشل بدء الحملة.', 'error');
        } finally {
          setActionBusyId(null);
        }
      },
    });
  };

  const handleSettleCampaign = (camp: CampaignItem) => {
    const refundableNote = camp.startedAt
      ? `سيتم إيقاف الحملة وإرجاع المتبقي من ميزانية المكافآت (${formatYer(camp.budgetEscrowBalance ?? 0)} ر.ي) إلى محفظتك.`
      : `سيتم إلغاء الحملة وإرجاع كامل الميزانية والرسوم المحتجزة (${formatYer(addMoney(camp.budgetEscrowBalance ?? 0, camp.feeEscrowBalance ?? 0))} ر.ي) إلى محفظتك.`;

    openConfirmModal({
      title: 'إغلاق وتسوية الحملة الإعلانية',
      message: `${refundableNote} هل أنت متأكد؟`,
      confirmLabel: 'تأكيد التسوية والاسترجاع',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusyId(camp.id);
        try {
          const res = await api.settleAdvertiserCampaign(camp.id, { targetStatus: 'cancelled' });
          showToast(
            `تمت تسوية الحملة وإرجاع ${formatYer(res?.refundedUnits || 0)} ر.ي إلى محفظتك.`,
            'success'
          );
          await Promise.all([loadData(), refreshWallet()]);
        } catch (err: any) {
          showToast(err?.message || 'فشل تسوية الحملة.', 'error');
        } finally {
          setActionBusyId(null);
        }
      },
    });
  };

  if (!user || user.role !== 'advertiser') {
    return (
      <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
        <Megaphone className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">بوابة المعلنين</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">هذه البوابة مخصصة لحسابات المعلنين فقط.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Strip (Mobile-first responsive stack) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
              بوابة تمويل وإدارة الحملات الإعلانية
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user.companyName ? `${user.companyName} · ` : ''}
            إنشاء حملات المهام المصغرة، حساب التكلفة والرسوم لحظياً، والتحكم في ظهور هويتك للمنفذين.
          </p>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
          <div className="text-right">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">الرصيد المتاح بالمحفظة</div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatYer(walletBalance)} ر.ي
            </div>
          </div>
          {onNavigateWallet && (
            <button
              type="button"
              onClick={onNavigateWallet}
              className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span>المحفظة والسجل</span>
            </button>
          )}
        </div>
      </div>

      {/* Pending Approval Block Banner */}
      {!isApprovedAdvertiser && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <div className="font-bold text-amber-900 dark:text-amber-200">
              حساب المعلن قيد المراجعة والاعتماد الإداري
            </div>
            <p className="text-amber-800 dark:text-amber-300/90 leading-relaxed">
              تم استلام بيانات منشأتك بنجاح. يمكنك استخدام حاسبة التكلفة لمعاينة الميزانيات الآن، ولن يتم السماح بإنشاء أو تمويل الحملات إلا بعد اعتماد حسابك من إدارة المنصة.
            </p>
          </div>
        </div>
      )}

      {/* Post-creation quick action banner for immediate Invoice / Details */}
      {lastCreatedCampaign && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-emerald-900 dark:text-emerald-200">
                تم تمويل وإنشاء الحملة: {lastCreatedCampaign.title}
              </div>
              <div className="text-emerald-800 dark:text-emerald-300/90 font-mono tabular-nums mt-0.5">
                الإجمالي المحجوز: {formatYer(lastCreatedCampaign.totalUnits)} ر.ي · الميزانية:{' '}
                {formatYer(lastCreatedCampaign.budgetUnits)} ر.ي · الرسوم ({lastCreatedCampaign.feePercentage}%):{' '}
                {formatYer(lastCreatedCampaign.feeUnits)} ر.ي
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setInvoiceCampaign(lastCreatedCampaign)}
              className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span>عرض فاتورة الحملة</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCampaign(lastCreatedCampaign)}
              className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5"
            >
              <Eye className="w-4 h-4" />
              <span>التفاصيل</span>
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={loadData}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-rose-600 text-white font-bold shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Campaign Builder + Instant Cost Calculator */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              إنشاء حملة جديدة وحاسبة التمويل الفورية
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="min-h-[44px] px-3 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            {showCreateForm ? 'إخفاء النموذج' : 'إظهار النموذج'}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateCampaign} className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left / Form Inputs */}
            <div className="lg:col-span-7 space-y-5">
              {/* Step 1: Core Task Info */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      عنوان الحملة / المهمة
                    </label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="مثال: تحميل وتقييم تطبيق متجر صنعاء"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm sm:text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      تصنيف الحملة
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as TaskCategory)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm sm:text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    وصف المهمة وخطوات التنفيذ المطلوبة
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="اشرح للمنفذين الخطوات الدقيقة المطلوبة وإثبات الإنجاز المطلوب..."
                    className="w-full px-3.5 py-2.5 text-sm sm:text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Pricing, Slots, Time & Duration with quick presets */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      سعر المهمة (يبدأ من 1 ر.ي)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={rewardInput}
                      onChange={(e) => setRewardInput(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {REWARD_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setRewardInput(String(p))}
                          className={`px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums border transition-colors ${
                            Number(rewardInput) === p
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      عدد المهمات المطلوب
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={slotsInput}
                      onChange={(e) => setSlotsInput(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {SLOTS_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setSlotsInput(String(p))}
                          className={`px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums border transition-colors ${
                            Number(slotsInput) === p
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      الوقت المقدر (دقائق)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={timeEstimate}
                      onChange={(e) => setTimeEstimate(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      المدة (أيام - حتى شهر 30)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      step="1"
                      required
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex flex-wrap gap-1">
                      {[1, 3, 7, 14, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDurationDays(String(d))}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                            Number(durationDays) === d
                              ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {d === 30 ? 'شهر' : d === 7 ? 'أسبوع' : `${d}ج`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Proof requirements */}
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-600 dark:text-slate-300">
                  <label className="min-h-[44px] inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireImage}
                      onChange={(e) => setRequireImage(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>إلزام المنفذ بإرفاق لقطة شاشة</span>
                  </label>
                  <label className="min-h-[44px] inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireText}
                      onChange={(e) => setRequireText(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>إلزام المنفذ بكتابة ملاحظة إثبات</span>
                  </label>
                </div>
              </div>

              {/* Geographic Targeting Section */}
              <GeoLocationSelector
                mode="multi"
                countryId={geoTarget.countryId}
                isNationwide={geoTarget.isNationwide}
                targetDivisionIds={geoTarget.targetDivisionIds}
                targetDivisions={geoTarget.targetDivisions}
                defaultCountryIso2={user?.countryCode || 'YE'}
                onChange={setGeoTarget}
              />

              {/* Phase 4: Advertiser Identity Section */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      هوية المعلن وظهورها للمستخدمين
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    محفوظة دائماً لإدارة المنصة
                  </span>
                </div>

                {/* Two clear choices with 44px+ targets */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setHideAdvertiserName(false)}
                    className={`min-h-[48px] p-3 rounded-xl border text-right transition-colors flex items-start gap-2.5 ${
                      !hideAdvertiserName
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Eye className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                    <div className="text-xs">
                      <div className="font-bold">إظهار هويتي وشعاري</div>
                      <div className="text-[11px] opacity-80">عرض اسمك التجاري وشعارك للمنفذين</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setHideAdvertiserName(true)}
                    className={`min-h-[48px] p-3 rounded-xl border text-right transition-colors flex items-start gap-2.5 ${
                      hideAdvertiserName
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 shrink-0 mt-0.5 text-slate-600 dark:text-slate-400" />
                    <div className="text-xs">
                      <div className="font-bold">إخفاء الاسم عن المستخدمين</div>
                      <div className="text-[11px] opacity-80">يظهر للمنفذين: معلن عبر يمن تاسك</div>
                    </div>
                  </button>
                </div>

                {hideAdvertiserName ? (
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>
                      سيظهر للمنفذين في تفاصيل المهمة: <strong className="text-slate-900 dark:text-white">معلن عبر يمن تاسك</strong>، وتظل بياناتك الحقيقية محفوظة لدى إدارة المنصة فقط.
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        اسم العرض اختياري (المنشأة / المعلن)
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={advertiserDisplayName}
                        onChange={(e) => setAdvertiserDisplayName(e.target.value)}
                        placeholder={user.companyName || user.fullName || 'اسم العلامة التجارية'}
                        className="w-full min-h-[44px] px-3 py-2 text-sm sm:text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        شعار المعلن (اختياري)
                      </label>
                      <div className="flex items-center gap-2">
                        {advertiserLogoUrl ? (
                          <div className="flex items-center gap-2 w-full p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                            <SecureImageView
                              storagePathOrUrl={advertiserLogoUrl}
                              alt="شعار المعلن"
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold truncate flex-1">
                              الشعار جاهز
                            </span>
                            <button
                              type="button"
                              onClick={() => setAdvertiserLogoUrl('')}
                              aria-label="إزالة الشعار"
                              className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <label className="min-h-[44px] w-full px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-emerald-500 text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2 cursor-pointer transition-colors">
                            {isUploadingLogo ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                                <span>جارٍ تجهيز الشعار...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4 text-emerald-600" />
                                <span>رفع شعار (PNG / JPG)</span>
                              </>
                            )}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={handleLogoFileChange}
                              className="hidden"
                              disabled={isUploadingLogo}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Worker Feed Identity Preview */}
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {!hideAdvertiserName && advertiserLogoUrl ? (
                      <SecureImageView
                        storagePathOrUrl={advertiserLogoUrl}
                        alt={effectivePublicIdentity}
                        className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                        {hideAdvertiserName ? <EyeOff className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-400">معاينة ما سيراه المستخدم في قائمة المهام:</div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {effectivePublicIdentity}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                    حملة معلن خارجي
                  </span>
                </div>
              </div>
            </div>

            {/* Right / Live Cost Summary + Required Fee Details Section */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    ملخص إنشاء الحملة والتكلفة الفورية
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    نسبة الرسوم: {feePercentage}%
                  </span>
                </div>

                <div className="space-y-2 text-xs divide-y divide-slate-200/70 dark:divide-slate-700/70">
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-600 dark:text-slate-300">
                      ميزانية المهام ({formatYer(costBreakdown.rewardUnits)} × {costBreakdown.slots.toLocaleString()})
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatYer(costBreakdown.budgetUnits)} ر.ي
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-slate-600 dark:text-slate-300">
                      رسوم خدمة يمن تاسك ({feePercentage}%)
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatYer(costBreakdown.feeUnits)} ر.ي
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2.5 text-sm sm:text-base">
                    <span className="font-extrabold text-slate-900 dark:text-white">الإجمالي المطلوب</span>
                    <span className="font-mono font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatYer(costBreakdown.totalUnits)} ر.ي
                    </span>
                  </div>
                </div>

                {/* Required Phase 4 Section directly below campaign creation cost summary */}
                <CampaignServiceFeeDetails feePercentage={feePercentage} />

                {/* Wallet sufficiency status */}
                {costBreakdown.isValid &&
                  (costBreakdown.isInsufficient ? (
                    <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>الرصيد المتاح غير كافٍ لتمويل الحملة</span>
                      </div>
                      <div className="font-mono tabular-nums text-[11px]">
                        المتاح: {formatYer(walletBalance)} ر.ي · المطلوب: {formatYer(costBreakdown.totalUnits)} ر.ي
                      </div>
                      <div className="font-mono font-extrabold tabular-nums text-xs">
                        العجز المطلوب شحنه: {formatYer(costBreakdown.deficitUnits)} ر.ي (بدون أي رسوم شحن)
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>
                        رصيدك المتاح كافٍ وسيبقى{' '}
                        <strong className="font-mono tabular-nums">
                          {formatYer(subMoney(walletBalance, costBreakdown.totalUnits))} ر.ي
                        </strong>{' '}
                        بعد الحجز.
                      </span>
                    </div>
                  ))}
              </div>

              <button
                type="submit"
                disabled={
                  !isApprovedAdvertiser ||
                  !costBreakdown.isValid ||
                  costBreakdown.isInsufficient ||
                  isSubmitting ||
                  isUploadingLogo
                }
                className="min-h-[48px] w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400 transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ حجز التمويل وإنشاء الحملة...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>تمويل وحجز ميزانية الحملة</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Campaigns List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            حملاتي الإعلانية ({campaigns.length})
          </h2>
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="min-h-[44px] px-3 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500">جارٍ تحميل الحملات...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Megaphone className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <div className="text-sm font-bold text-slate-700 dark:text-slate-300">لا توجد حملات إعلانية بعد</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              استخدم حاسبة التكلفة أعلاه لتمويل وإطلاق أول حملة مهام لمشروعك.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {campaigns.map((camp) => {
              const meta = getCampaignStatusLabel(camp.status);
              const busy = actionBusyId === camp.id;
              const progressPct =
                camp.slots > 0
                  ? Math.min(100, Math.round(((camp.approvedCount ?? 0) / camp.slots) * 100))
                  : 0;
              const visibleIdentity = camp.hideAdvertiserName
                ? 'معلن عبر يمن تاسك (مخفي)'
                : camp.advertiserDisplayName || camp.advertiserCompany || camp.advertiserName || 'معلن عبر يمن تاسك';

              return (
                <div
                  key={camp.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`px-2.5 py-0.5 rounded-md font-bold ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        نسبة الرسوم: {camp.feePercentage}%
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        الظهور: <strong className="text-slate-700 dark:text-slate-200">{visibleIdentity}</strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        النطاق:{' '}
                        <strong className="text-slate-700 dark:text-slate-200">
                          {camp.countryFlag ? `${camp.countryFlag} ` : ''}
                          {camp.countryNameAr
                            ? camp.isNationwide === false && camp.targetDivisions && camp.targetDivisions.length > 0
                              ? `${camp.countryNameAr} (${camp.targetDivisions.map((d) => d.nameAr).join('، ')})`
                              : `${camp.countryNameAr} (شاملة)`
                            : 'جميع الدول العربية'}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {new Date(camp.createdAt).toLocaleDateString('ar-YE')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {!camp.hideAdvertiserName && camp.advertiserLogoUrl && (
                        <SecureImageView
                          storagePathOrUrl={camp.advertiserLogoUrl}
                          alt={visibleIdentity}
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{camp.title}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{camp.description}</p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="max-w-md space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        <span>الإنجاز: {camp.approvedCount ?? 0} / {camp.slots}</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <span>الميزانية: {formatYer(camp.budgetUnits)} ر.ي</span>
                      <span>·</span>
                      <span>الرسوم: {formatYer(camp.feeUnits)} ر.ي</span>
                      <span>·</span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        الإجمالي: {formatYer(camp.totalUnits)} ر.ي
                      </span>
                      {camp.refundedUnits > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            مسترجع: {formatYer(camp.refundedUnits)} ر.ي
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Mobile-first 44px action grid */}
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedCampaign(camp)}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>التفاصيل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInvoiceCampaign(camp)}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>الفاتورة</span>
                    </button>

                    {camp.status === 'pending_start' && isApprovedAdvertiser && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleStartCampaign(camp)}
                        className="min-h-[44px] col-span-2 sm:col-span-1 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>بدء الحملة الآن</span>
                      </button>
                    )}

                    {(camp.status === 'pending_start' || camp.status === 'active' || camp.status === 'paused') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSettleCampaign(camp)}
                        className="min-h-[44px] col-span-2 sm:col-span-1 px-3.5 py-2 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>إغلاق وإرجاع الفائض</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Campaign Details Modal */}
      <CampaignDetailsModal
        campaign={selectedCampaign}
        isApprovedAdvertiser={isApprovedAdvertiser}
        actionBusy={selectedCampaign ? actionBusyId === selectedCampaign.id : false}
        onClose={() => setSelectedCampaign(null)}
        onOpenInvoice={(camp) => {
          setSelectedCampaign(null);
          setInvoiceCampaign(camp);
        }}
        onStart={handleStartCampaign}
        onSettle={handleSettleCampaign}
      />

      {/* Campaign Invoice Modal */}
      <CampaignInvoiceModal
        campaign={invoiceCampaign}
        onClose={() => setInvoiceCampaign(null)}
      />
    </div>
  );
};
