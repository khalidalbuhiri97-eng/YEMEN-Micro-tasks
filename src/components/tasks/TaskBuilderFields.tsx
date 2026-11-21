import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  PlaySquare,
  Smartphone,
  Zap,
  Globe,
  Crown,
  Link2,
  Eye,
  Image as ImageIcon,
  Palette,
  Upload,
  RefreshCw,
} from 'lucide-react';
import type {
  SurveyItem,
  TaskAssetItem,
  TaskBuilderMeta,
  TaskItem,
  TaskKind,
} from '../../types/index.ts';
import {
  TASK_CARD_THEMES,
  TASK_KIND_OPTIONS,
  getDefaultTaskImageUrl,
  mapTaskKindToCategory,
} from '../../../shared/taskMeta.ts';
import { api } from '../../api/client.ts';
import { TaskVisualCard } from './TaskVisualCard.tsx';

interface TaskBuilderFieldsProps {
  meta: TaskBuilderMeta;
  onChange: (next: TaskBuilderMeta) => void;
  canFeatureDirectly: boolean;
  assets?: TaskAssetItem[];
  surveys?: SurveyItem[];
}

const KIND_ICONS: Record<TaskKind, React.ReactNode> = {
  surveys: <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
  smart_links: <Link2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />,
  ad_watch: <PlaySquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />,
  app_testing: <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
  quick_tasks: <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
  external_offers: <Globe className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />,
};

export const TaskBuilderFields: React.FC<TaskBuilderFieldsProps> = ({
  meta,
  onChange,
  canFeatureDirectly,
  assets: propAssets,
  surveys: propSurveys,
}) => {
  const fields = meta.fields || {};
  const [galleryAssets, setGalleryAssets] = useState<TaskAssetItem[]>(propAssets || []);
  const [availableSurveys, setAvailableSurveys] = useState<SurveyItem[]>(propSurveys || []);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  useEffect(() => {
    if (propAssets) {
      setGalleryAssets(propAssets);
    } else {
      api
        .getTaskAssets()
        .then((res) => setGalleryAssets(res.assets || []))
        .catch(() => {});
    }
  }, [propAssets]);

  useEffect(() => {
    if (propSurveys) {
      setAvailableSurveys(propSurveys);
    } else if (canFeatureDirectly && meta.taskKind === 'surveys') {
      api
        .getAdminSurveys()
        .then((res) => setAvailableSurveys(res.surveys || []))
        .catch(() => {});
    }
  }, [propSurveys, canFeatureDirectly, meta.taskKind]);

  const updateFields = (patch: Partial<NonNullable<TaskBuilderMeta['fields']>>) => {
    onChange({
      ...meta,
      fields: {
        ...fields,
        ...patch,
      },
    });
  };

  const handleUploadCustomImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setUploadErr('الحد الأقصى لحجم الصورة 4 ميجابايت.');
      return;
    }
    setIsUploadingAsset(true);
    setUploadErr('');
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(file);
      });
      const res = await api.uploadAdminTaskAsset({
        title: file.name.replace(/\.[^.]+$/, ''),
        assetKind: 'task_illustration',
        taskKind: meta.taskKind,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        base64Data,
      });
      if (res.asset) {
        setGalleryAssets((prev) => [res.asset, ...prev]);
        onChange({ ...meta, imageUrl: res.asset.publicUrl });
      }
    } catch (err: any) {
      setUploadErr(err?.message || 'تعذر رفع الصورة.');
    } finally {
      setIsUploadingAsset(false);
      e.target.value = '';
    }
  };

  const illustrationAssets = galleryAssets.filter((a) => a.assetKind !== 'category_icon');

  return (
    <div className="space-y-4">
      {/* Task Type Visual Selector */}
      <div>
        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
          نوع المهمة (تتغير الحقول والتصميم تلقائياً حسب النوع)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {TASK_KIND_OPTIONS.map((opt) => {
            const active = meta.taskKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() =>
                  onChange({
                    ...meta,
                    taskKind: opt.kind,
                    cardTheme: opt.defaultTheme,
                    badgeLabel: meta.badgeLabel || opt.defaultBadgeLabel,
                  })
                }
                className={`p-2.5 rounded-xl border text-right transition-all flex flex-col gap-1 min-h-[68px] ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500/30'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  {KIND_ICONS[opt.kind]}
                  {active && <span className="w-2 h-2 rounded-full bg-emerald-600" />}
                </div>
                <div className="text-xs font-extrabold text-slate-900 dark:text-white leading-tight">
                  {opt.labelAr}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                  {opt.subtitleAr}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dynamic Type-Specific Fields */}
      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-3">
        {meta.taskKind === 'surveys' && (
          <div className="space-y-3">
            {canFeatureDirectly && availableSurveys.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ربط باستبيان تفاعلي متسلسل (اختياري)
                </label>
                <select
                  value={meta.linkedSurveyId || fields.linkedSurveyId || ''}
                  onChange={(e) =>
                    onChange({
                      ...meta,
                      linkedSurveyId: e.target.value || undefined,
                      fields: { ...fields, linkedSurveyId: e.target.value || undefined },
                    })
                  }
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                >
                  <option value="">بدون ربط (مهمة استبيان تقليدية)</option>
                  {availableSurveys.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.questions.length} أسئلة · {s.status})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                ملخص أسئلة الاستبيان (اكتب كل سؤال في سطر مستقل)
              </label>
              <textarea
                rows={3}
                value={(fields.questions || []).join('\n')}
                onChange={(e) =>
                  updateFields({
                    questions: e.target.value.split('\n').map((s) => s),
                  })
                }
                placeholder={'1. ما رأيك في سرعة التطبيق؟\n2. ما الميزة التي تقترح إضافتها؟'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خيارات الإجابة المتاحة (اختياري)
              </label>
              <input
                type="text"
                value={fields.optionsText || ''}
                onChange={(e) => updateFields({ optionsText: e.target.value })}
                placeholder="مثال: ممتاز / جيد / مقبول / يحتاج تحسين"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {meta.taskKind === 'smart_links' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                اسم المزوّد / الشريك (Smart Link Provider)
              </label>
              <input
                type="text"
                value={fields.providerName || ''}
                onChange={(e) => updateFields({ providerName: e.target.value })}
                placeholder="مثال: TimeWall أو CPX Research"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط شعار المزوّد (اختياري)
              </label>
              <input
                type="url"
                value={fields.providerLogoUrl || ''}
                onChange={(e) => updateFields({ providerLogoUrl: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط التتبع الذكي (يدعم {'{click_id}'} و {'{user_id}'})
              </label>
              <input
                type="url"
                value={fields.trackingUrl || ''}
                onChange={(e) => updateFields({ trackingUrl: e.target.value })}
                placeholder="https://provider.example/offer?subid={click_id}&uid={user_id}"
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            {canFeatureDirectly && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  مفتاح التحقق السري للـ Postback (Secret)
                </label>
                <input
                  type="text"
                  value={fields.postbackSecret || ''}
                  onChange={(e) => updateFields({ postbackSecret: e.target.value })}
                  placeholder="أدخل مفتاح التحقق السري المعتمد مع المزوّد"
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
            )}
            <div className={canFeatureDirectly ? '' : 'sm:col-span-2'}>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                تعليمات وشروط التحقق
              </label>
              <input
                type="text"
                value={fields.smartLinkInstructions || ''}
                onChange={(e) => updateFields({ smartLinkInstructions: e.target.value })}
                placeholder="مثال: أكمل العرض بالكامل وتُضاف المكافأة آلياً بعد تأكيد المزوّد"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {meta.taskKind === 'ad_watch' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط الإعلان أو الفيديو
              </label>
              <input
                type="url"
                value={fields.adUrl || ''}
                onChange={(e) => updateFields({ adUrl: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                مدة المشاهدة المطلوبة (ثانية)
              </label>
              <input
                type="number"
                min="5"
                max="3600"
                value={fields.watchDurationSeconds || 30}
                onChange={(e) => updateFields({ watchDurationSeconds: Number(e.target.value) || 30 })}
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                شرط إتمام المشاهدة
              </label>
              <input
                type="text"
                value={fields.completionRule || ''}
                onChange={(e) => updateFields({ completionRule: e.target.value })}
                placeholder="مثال: إكمال الفيديو وإرفاق لقطة النهاية"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {meta.taskKind === 'app_testing' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط تحميل أو متجر التطبيق
              </label>
              <input
                type="url"
                value={fields.appDownloadUrl || ''}
                onChange={(e) => updateFields({ appDownloadUrl: e.target.value })}
                placeholder="https://play.google.com/store/apps/..."
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  تعليمات الاختبار
                </label>
                <input
                  type="text"
                  value={fields.testingInstructions || ''}
                  onChange={(e) => updateFields({ testingInstructions: e.target.value })}
                  placeholder="مثال: ثبت التطبيق وأنشئ حساباً وتصفح لمدة دقيقتين"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  الإثبات المطلوب بعد التجربة
                </label>
                <input
                  type="text"
                  value={fields.requiredProofNote || ''}
                  onChange={(e) => updateFields({ requiredProofNote: e.target.value })}
                  placeholder="مثال: لقطة شاشة للشاشة الرئيسية داخل التطبيق"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>
        )}

        {meta.taskKind === 'quick_tasks' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خطوات التنفيذ السريعة (كل خطوة في سطر)
              </label>
              <textarea
                rows={3}
                value={(fields.steps || []).join('\n')}
                onChange={(e) =>
                  updateFields({
                    steps: e.target.value.split('\n').map((s) => s),
                  })
                }
                placeholder={'افتح الرابط المرفق\nأكمل الإجراء المطلوب\nأرفع لقطة الشاشة'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                ملاحظات إضافية للإثبات
              </label>
              <input
                type="text"
                value={fields.proofNotes || ''}
                onChange={(e) => updateFields({ proofNotes: e.target.value })}
                placeholder="مثال: اسم الحساب أو رقم العملية..."
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {meta.taskKind === 'external_offers' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                اسم الشريك أو المنصة
              </label>
              <input
                type="text"
                value={fields.partnerName || ''}
                onChange={(e) => updateFields({ partnerName: e.target.value })}
                placeholder="مثال: متجر الشريك المعتمد"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط العرض الخارجي
              </label>
              <input
                type="url"
                value={fields.offerUrl || ''}
                onChange={(e) => updateFields({ offerUrl: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                شروط احتساب العرض
              </label>
              <input
                type="text"
                value={fields.offerConditions || ''}
                onChange={(e) => updateFields({ offerConditions: e.target.value })}
                placeholder="مثال: مخصص للتسجيلات الجديدة فقط من داخل اليمن"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* Visual Card Design & Custom Artwork Selection */}
        <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-emerald-600" />
              <span>تخصيص صورة البطاقة والألوان والترتيب</span>
            </span>
            {canFeatureDirectly && (
              <label className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">
                {isUploadingAsset ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>رفع صورة مخصصة</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleUploadCustomImage}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {uploadErr && <div className="text-[11px] text-rose-600 font-semibold">{uploadErr}</div>}

          {/* Saved Gallery Picker */}
          {illustrationAssets.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => onChange({ ...meta, imageUrl: undefined })}
                className={`shrink-0 px-2.5 py-2 rounded-xl border text-[10px] font-bold flex items-center gap-1 ${
                  !meta.imageUrl
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>الافتراضي للنوع</span>
              </button>
              {illustrationAssets.map((asset) => {
                const selected = meta.imageUrl === asset.publicUrl;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onChange({ ...meta, imageUrl: asset.publicUrl })}
                    title={asset.title}
                    className={`relative shrink-0 w-16 h-12 rounded-xl overflow-hidden border-2 transition-all ${
                      selected
                        ? 'border-emerald-600 ring-2 ring-emerald-500/30 scale-105'
                        : 'border-slate-200 dark:border-slate-700 opacity-85 hover:opacity-100'
                    }`}
                  >
                    <img src={asset.publicUrl} alt={asset.title} className="w-full h-full object-cover" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                سمة لون البطاقة
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {TASK_CARD_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.labelAr}
                    onClick={() => onChange({ ...meta, cardTheme: t.id })}
                    className={`w-7 h-7 rounded-full ${t.swatchClass} transition-transform ${
                      (meta.cardTheme || 'emerald') === t.id
                        ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                نص الشارة العلوية (اختياري)
              </label>
              <input
                type="text"
                value={meta.badgeLabel || ''}
                onChange={(e) => onChange({ ...meta, badgeLabel: e.target.value })}
                placeholder="مثال: مهمة سريعة / عرض خاص"
                className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>

            {canFeatureDirectly && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ترتيب الظهور (الأصغر أولاً)
                </label>
                <input
                  type="number"
                  value={meta.sortOrder ?? 0}
                  onChange={(e) => onChange({ ...meta, sortOrder: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
            )}
          </div>
        </div>

        {/* Featured Toggle (Permission-Aware) */}
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={canFeatureDirectly ? Boolean(meta.isFeatured) : Boolean(meta.featuredRequested)}
              onChange={(e) =>
                canFeatureDirectly
                  ? onChange({ ...meta, isFeatured: e.target.checked, priority: e.target.checked ? 100 : 0 })
                  : onChange({ ...meta, featuredRequested: e.target.checked })
              }
              className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
            />
            <Crown className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {canFeatureDirectly
                ? 'تمييز المهمة (شارة مهمة مميزة وأولوية في الظهور)'
                : 'طلب تمييز المهمة (يُفعّل باعتماد الإدارة)'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

interface TaskCardLivePreviewProps {
  title: string;
  description: string;
  rewardYer: number;
  slots: number;
  timeEstimateMinutes: number;
  category: string;
  meta: TaskBuilderMeta;
  locationLabel?: string;
  advertiserLabel?: string;
}

export const TaskCardLivePreview: React.FC<TaskCardLivePreviewProps> = ({
  title,
  description,
  rewardYer,
  slots,
  timeEstimateMinutes,
  category,
  meta,
  locationLabel = 'عن بُعد / جميع الدول',
  advertiserLabel = 'مصدّق من المعلن',
}) => {
  const isFeatured = Boolean(meta.isFeatured || meta.featuredRequested);
  const previewTask: TaskItem = {
    id: 'preview-task',
    title: title.trim() || 'عنوان المهمة سيظهر هنا للمستخدمين...',
    description: description.trim() || 'وصف المهمة المختصر وتعليماتها سيظهر هنا للمنفذين...',
    category: mapTaskKindToCategory(meta.taskKind, category),
    taskKind: meta.taskKind,
    isFeatured,
    sortOrder: meta.sortOrder ?? 0,
    imageUrl: meta.imageUrl || getDefaultTaskImageUrl(meta.taskKind, isFeatured, category),
    cardTheme: meta.cardTheme || 'emerald',
    badgeLabel: meta.badgeLabel,
    badgeColor: meta.badgeColor,
    isVerifiedAdvertiser: advertiserLabel === 'مصدّق من المعلن' || advertiserLabel === 'مهمة مباشرة من المنصة',
    providerName: meta.fields?.providerName,
    providerLogoUrl: meta.fields?.providerLogoUrl,
    taskMeta: meta,
    rewardYer: Number(rewardYer) || 0,
    steps: meta.fields?.steps || [],
    proofRequirements: { requireImage: true, requireText: true },
    timeEstimateMinutes: Math.max(1, Number(timeEstimateMinutes) || 10),
    totalQuantity: Math.max(1, Number(slots) || 50),
    completedQuantity: 0,
    maxPerUser: 1,
    budgetYer: 0,
    budgetSpentYer: 0,
    status: 'ACTIVE',
    advertiserDisplayName: advertiserLabel,
    locationLabel,
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-emerald-600" />
          <span>معاينة حية لبطاقة المهمة قبل النشر</span>
        </span>
        {meta.featuredRequested && !meta.isFeatured && (
          <span className="text-amber-600 dark:text-amber-400">مقترحة للتمييز (بانتظار الإدارة)</span>
        )}
      </div>

      <TaskVisualCard
        task={previewTask}
        isPreview={true}
        onStart={() => {}}
        onInfo={() => {}}
      />
    </div>
  );
};
