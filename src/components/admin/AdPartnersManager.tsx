import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { AdPartner, AdPartnerCodeType, AdPartnerRotationMode } from '../../types/index.ts';
import { SandboxedAdSlot } from '../ads/SandboxedAdSlot.tsx';
import {
  Plus,
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Code2,
  RefreshCw,
  AlertCircle,
  X,
  CheckCircle2,
  Database,
} from 'lucide-react';

interface PartnerFormState {
  partnerName: string;
  placementKey: string;
  codeType: AdPartnerCodeType;
  code: string;
  width: string;
  height: string;
  rotationMode: AdPartnerRotationMode;
  sortOrder: string;
  isActive: boolean;
}

const DEFAULT_FORM: PartnerFormState = {
  partnerName: '',
  placementKey: 'home_clixwall_slot',
  codeType: 'html',
  code: '',
  width: '300',
  height: '250',
  rotationMode: 'rotate',
  sortOrder: '10',
  isActive: true,
};

const PLACEMENT_OPTIONS = [
  { key: 'home_clixwall_slot', label: 'نافذة الإعلانات بجانب ClixWall (الرئيسية 300×250)' },
  { key: 'clixwall_card_embed', label: 'منطقة الشريك المدمجة داخل بطاقة ClixWall' },
  { key: 'offerwall_hub', label: 'بوابة حوائط العروض (رابط iframe خارجي)' },
];

export const AdPartnersManager: React.FC = () => {
  const { showToast, openConfirmModal } = useAuth();
  const [partners, setPartners] = useState<AdPartner[]>([]);
  const [storageMode, setStorageMode] = useState<'supabase' | 'fallback'>('supabase');
  const [isLoading, setIsLoading] = useState(true);
  const [filterPlacement, setFilterPlacement] = useState<string>('all');

  // Editor modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<AdPartner | null>(null);
  const [form, setForm] = useState<PartnerFormState>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Live preview modal
  const [previewPartner, setPreviewPartner] = useState<AdPartner | null>(null);

  const loadPartners = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAdminAdPartners();
      setPartners(Array.isArray(res?.partners) ? res.partners : []);
      if (res?.storageMode === 'fallback' || res?.storageMode === 'supabase') {
        setStorageMode(res.storageMode);
      }
    } catch (err: any) {
      showToast(err.message || 'تعذر جلب قائمة شركاء الإعلانات.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPartners();
  }, []);

  const openCreateModal = () => {
    setEditingPartner(null);
    setForm(DEFAULT_FORM);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (p: AdPartner) => {
    setEditingPartner(p);
    setForm({
      partnerName: p.partnerName,
      placementKey: p.placementKey,
      codeType: p.codeType,
      code: p.code,
      width: String(p.width || 300),
      height: String(p.height || 250),
      rotationMode: p.rotationMode,
      sortOrder: String(p.sortOrder ?? 10),
      isActive: p.isActive,
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.partnerName.trim()) {
      setFormError('يرجى إدخال اسم الشركة أو الشريك الإعلاني.');
      return;
    }
    if (!form.code.trim()) {
      setFormError('يرجى إدخال كود الإعلان (HTML / JavaScript / iframe).');
      return;
    }

    if (
      form.placementKey === 'offerwall_hub' &&
      (form.codeType !== 'iframe' || !/^https:\/\/[^\s]+$/i.test(form.code.trim()))
    ) {
      setFormError('حوائط العروض الإضافية تتطلب نوع iframe ورابط HTTPS مباشر صالح.');
      return;
    }

    const w = Number(form.width) || 300;
    const h = Number(form.height) || 250;
    if (w < 100 || w > 1200 || h < 50 || h > 800) {
      setFormError('يجب أن يكون العرض بين 100 و1200 والارتفاع بين 50 و800 بكسل.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        partnerName: form.partnerName.trim(),
        placementKey: form.placementKey,
        codeType: form.codeType,
        code: form.code.trim(),
        width: w,
        height: h,
        rotationMode: form.rotationMode,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };

      if (editingPartner) {
        await api.updateAdminAdPartner(editingPartner.id, payload);
        showToast('تم تحديث بيانات الشريك الإعلاني بنجاح.', 'success');
      } else {
        await api.createAdminAdPartner(payload);
        showToast('تمت إضافة الشريك الإعلاني الجديد بنجاح.', 'success');
      }

      setIsModalOpen(false);
      await loadPartners();
    } catch (err: any) {
      setFormError(err.message || 'تعذر حفظ بيانات الشريك الإعلاني.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (p: AdPartner) => {
    try {
      await api.updateAdminAdPartner(p.id, { isActive: !p.isActive });
      showToast(
        !p.isActive ? `تم تفعيل عرض إعلان "${p.partnerName}"` : `تم إيقاف إعلان "${p.partnerName}" مؤقتاً`,
        'info'
      );
      await loadPartners();
    } catch (err: any) {
      showToast(err.message || 'تعذر تغيير حالة التفعيل.', 'error');
    }
  };

  const handleDelete = (p: AdPartner) => {
    openConfirmModal({
      title: 'حذف الشريك الإعلاني',
      message: `هل أنت متأكد من حذف إعلان "${p.partnerName}" نهائياً من الموقع؟`,
      confirmLabel: 'تأكيد الحذف',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminAdPartner(p.id);
          showToast('تم حذف الشريك الإعلاني بنجاح.', 'success');
          await loadPartners();
        } catch (err: any) {
          showToast(err.message || 'تعذر حذف الشريك الإعلاني.', 'error');
        }
      },
    });
  };

  const filteredPartners = partners.filter(
    (p) => filterPlacement === 'all' || p.placementKey === filterPlacement
  );

  const previewDraft: AdPartner = {
    id: editingPartner?.id || 'draft-preview',
    partnerName: form.partnerName || 'معاينة الشريك',
    placementKey: form.placementKey,
    codeType: form.codeType,
    code: form.code,
    width: Math.min(1200, Math.max(100, Number(form.width) || 300)),
    height: Math.min(800, Math.max(50, Number(form.height) || 250)),
    rotationMode: form.rotationMode,
    sortOrder: Number(form.sortOrder) || 0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Code2 className="w-5 h-5 text-emerald-600" />
            <span>إدارة شركاء الإعلانات والنوافذ المستقلة</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            أضف أكواد الإعلانات (HTML / JavaScript / iframe) للشركات المعلنة في المساحات المعزولة أمنياً عن نظام ClixWall والمحفظة.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadPartners}
            className="min-h-[40px] px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[40px] px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة شريك إعلاني</span>
          </button>
        </div>
      </div>

      {/* Isolation Notice + DB Migration Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/80 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">عزل أمني كامل لأكواد الإعلانات الخارجية</p>
            <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5 leading-relaxed">
              تُعرض كل إعلانات الشركاء داخل إطار Sandbox معزول بدون allow-same-origin وبسياسة CSP مقيدة، ما يمنع وصول أي سكريبت خارجي إلى رموز الدخول أو بيانات المحفظة أو ClixWall.
            </p>
          </div>
        </div>

        {storageMode === 'fallback' ? (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <Database className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">تخزين محلي مؤقت مفعل حتى تطبيق الترحيل</p>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5 leading-relaxed">
                جدول ad_partners غير منشأ بعد في Supabase البعيد. نفّذ الملف 033_ad_partners_and_notifications_enhancements.sql في لوحة Supabase للحفظ الدائم في PostgreSQL.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">متصل بجدول قاعدة البيانات الموثق</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                كافة الشركاء والأكواد محمية بسياسات RLS بحيث يديرها مالك المنصة فقط ويُسمح للزوار بقراءة النشطة فقط.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Placement Filter */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setFilterPlacement('all')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            filterPlacement === 'all'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          جميع المواضع ({partners.length})
        </button>
        {PLACEMENT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFilterPlacement(opt.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              filterPlacement === opt.key
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {opt.key === 'home_clixwall_slot' ? 'نافذة الرئيسية 300×250' : opt.key === 'clixwall_card_embed' ? 'داخل بطاقة ClixWall' : 'بوابة حوائط العروض'}
          </button>
        ))}
      </div>

      {/* Partners List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
          <Code2 className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            لا يوجد شركاء إعلانيون مضافون في هذا الموضع
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            أضف كود HTML أو JavaScript أو رابط iframe لشركة معلنة ليتم عرضه مباشرة داخل النافذة المعزولة في الرئيسية.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أول إعلان الآن</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPartners.map((p) => (
            <div
              key={p.id}
              className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {p.partnerName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      <span className="font-mono">{p.placementKey}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono uppercase">{p.codeType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {p.width}×{p.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {p.rotationMode === 'rotate' ? 'تدوير تلقائي' : 'عرض ثابت'}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                      p.isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {p.isActive ? 'نشط' : 'متوقف'}
                  </span>
                </div>

                <pre
                  dir="ltr"
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400 overflow-hidden max-h-20 whitespace-pre-wrap break-all"
                >
                  {p.code.slice(0, 260)}
                  {p.code.length > 260 ? ' ...' : ''}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-mono text-slate-400">
                  الترتيب: #{p.sortOrder}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewPartner(p)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>معاينة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(p)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                  >
                    {p.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{p.isActive ? 'إيقاف' : 'تفعيل'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(p)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create / Edit Partner */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-3xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                {editingPartner ? `تعديل إعلان: ${editingPartner.partnerName}` : 'إضافة كود شريك إعلاني جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    اسم الشركة / الشريك الإعلاني
                  </label>
                  <input
                    type="text"
                    required
                    value={form.partnerName}
                    onChange={(e) => setForm({ ...form, partnerName: e.target.value })}
                    placeholder="مثال: Adsterra Banner 1"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    موضع العرض المعزول
                  </label>
                  <select
                    value={form.placementKey}
                    onChange={(e) => setForm({
                      ...form,
                      placementKey: e.target.value,
                      ...(e.target.value === 'offerwall_hub' ? { codeType: 'iframe' as AdPartnerCodeType, width: '1000', height: '700' } : {}),
                    })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    {PLACEMENT_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    نوع الكود
                  </label>
                  <select
                    value={form.codeType}
                    onChange={(e) => setForm({ ...form, codeType: e.target.value as AdPartnerCodeType })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    <option value="html">HTML / Embed Snippet</option>
                    <option value="javascript">JavaScript Ad Script</option>
                    <option value="iframe">Iframe URL أو وسم iframe</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      العرض (px)
                    </label>
                    <input
                      type="number"
                      min={100}
                      max={1200}
                      value={form.width}
                      onChange={(e) => setForm({ ...form, width: e.target.value })}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      الارتفاع (px)
                    </label>
                    <input
                      type="number"
                      min={50}
                      max={800}
                      value={form.height}
                      onChange={(e) => setForm({ ...form, height: e.target.value })}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      الترتيب
                    </label>
                    <input
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {form.placementKey === 'offerwall_hub' ? 'رابط حائط العروض (HTTPS فقط)' : 'كود الإعلان الكامل (يتم تشغيله داخل Sandbox معزول)'}
                </label>
                <textarea
                  rows={5}
                  dir="ltr"
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder={form.placementKey === 'offerwall_hub' ? "https://partner.example/offerwall" : "<script>...</script> أو https://partner.example/widget"}
                  className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
                {form.placementKey === 'offerwall_hub' && (
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                    اختر نوع الكود iframe، وأدخل رابط HTTPS المباشر لحائط العروض. يفضّل ضبط العرض والارتفاع على 1000×700. سيظهر الشريك كبطاقة مستقلة داخل بوابة حوائط العروض.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    نمط العرض مع الشركاء الآخرين
                  </label>
                  <select
                    value={form.rotationMode}
                    onChange={(e) => setForm({ ...form, rotationMode: e.target.value as AdPartnerRotationMode })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    <option value="rotate">تدوير تلقائي بين الإعلانات النشطة</option>
                    <option value="single">إعلان ثابت في هذه النافذة</option>
                  </select>
                </div>

                <label className="flex items-center gap-2.5 pt-4 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  <span>تفعيل وعرض الإعلان للمستخدمين فور الحفظ</span>
                </label>
              </div>

              {form.code.trim() && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    معاينة مباشرة داخل الإطار المعزول (Sandbox):
                  </p>
                  <SandboxedAdSlot
                    placementKey={form.placementKey}
                    partnersOverride={[previewDraft]}
                    compact
                  />
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50"
                >
                  {isSaving ? 'جارِ الحفظ...' : editingPartner ? 'حفظ التعديلات' : 'حفظ ونشر الإعلان'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Standalone Live Preview */}
      {previewPartner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm"
          onClick={() => setPreviewPartner(null)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                معاينة معزولة: {previewPartner.partnerName}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewPartner(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <SandboxedAdSlot
              placementKey={previewPartner.placementKey}
              partnersOverride={[previewPartner]}
            />
          </div>
        </div>
      )}
    </div>
  );
};
