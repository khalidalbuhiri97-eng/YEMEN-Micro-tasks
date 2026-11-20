import React from 'react';
import {
  ClipboardList,
  PlaySquare,
  Smartphone,
  Zap,
  Globe,
  Crown,
  Clock,
  MapPin,
  ArrowLeft,
  Building2,
  Eye,
} from 'lucide-react';
import type { TaskBuilderMeta, TaskKind } from '../../types/index.ts';
import { TASK_KIND_OPTIONS, getTaskKindLabel } from '../../../shared/taskMeta.ts';
import { formatYer } from '../../../shared/money.ts';

interface TaskBuilderFieldsProps {
  meta: TaskBuilderMeta;
  onChange: (next: TaskBuilderMeta) => void;
  canFeatureDirectly: boolean;
}

const KIND_ICONS: Record<TaskKind, React.ReactNode> = {
  surveys: <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
  ad_watch: <PlaySquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />,
  app_testing: <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
  quick_tasks: <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
  external_offers: <Globe className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />,
};

export const TaskBuilderFields: React.FC<TaskBuilderFieldsProps> = ({
  meta,
  onChange,
  canFeatureDirectly,
}) => {
  const fields = meta.fields || {};

  const updateFields = (patch: Partial<NonNullable<TaskBuilderMeta['fields']>>) => {
    onChange({
      ...meta,
      fields: {
        ...fields,
        ...patch,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Task Type Visual Selector */}
      <div>
        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
          نوع المهمة (تتغير الحقول تلقائياً حسب النوع)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TASK_KIND_OPTIONS.map((opt) => {
            const active = meta.taskKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() => onChange({ ...meta, taskKind: opt.kind })}
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
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                أسئلة الاستبيان (اكتب كل سؤال في سطر مستقل)
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
          </>
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
                ? 'تمييز المهمة (شارة ذهبية وأولوية في الظهور)'
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
  locationLabel = 'جميع الدول العربية',
  advertiserLabel = 'مهمة مباشرة من المنصة',
}) => {
  const showGoldFeatured = Boolean(meta.isFeatured || meta.featuredRequested);
  const typeLabel = getTaskKindLabel(meta.taskKind, category);

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

      <article
        className={`rounded-2xl bg-white dark:bg-slate-900 border overflow-hidden shadow-sm transition-all ${
          showGoldFeatured
            ? 'border-amber-400 dark:border-amber-500/80 ring-1 ring-amber-400/25'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div
          className={`px-4 py-2.5 flex items-center justify-between gap-2 text-xs ${
            showGoldFeatured
              ? 'bg-gradient-to-l from-amber-50 via-emerald-50/60 to-white dark:from-amber-950/40 dark:via-emerald-950/30 dark:to-slate-900 border-b border-amber-200/70 dark:border-amber-800/50'
              : 'bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {showGoldFeatured && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold shadow-sm">
                <Crown className="w-3 h-3" />
                <span>مهمة مميزة</span>
              </span>
            )}
            <span className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              {KIND_ICONS[meta.taskKind]}
              <span>{typeLabel}</span>
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span>{Math.max(1, Number(timeEstimateMinutes) || 10)} د</span>
          </span>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-white line-clamp-1">
              {title.trim() || 'عنوان المهمة سيظهر هنا...'}
            </h4>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>{advertiserLabel}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3 text-emerald-600" />
                <span>{locationLabel}</span>
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
              {description.trim() || 'وصف المهمة المختصر وتعليماتها سيظهر هنا للمنفذين...'}
            </p>
          </div>

          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] text-slate-400 block">
                المتبقي: <strong className="font-mono text-slate-700 dark:text-slate-200">{slots || 0}</strong> من{' '}
                <span className="font-mono">{slots || 0}</span>
              </span>
              <span className="text-sm font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {formatYer(Number(rewardYer) || 0)}{' '}
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">ر.ي</span>
              </span>
            </div>
            <span className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1">
              <span>بدء المهمة الآن</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </article>
    </div>
  );
};
