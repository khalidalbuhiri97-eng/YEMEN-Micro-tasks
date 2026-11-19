import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskItem } from '../../types/index.ts';
import {
  Search,
  Clock,
  Sparkles,
  CheckCircle,
  Upload,
  Link as LinkIcon,
  X,
  FileText,
  AlertCircle,
  Eye,
  Building2,
  EyeOff,
  MapPin,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SecureImageView } from '../common/SecureImageView.tsx';
import { AdsterraAd } from '../ads/AdsterraAd.tsx';
import { GeoLocationSelector, type GeoFilterValue } from '../common/GeoLocationSelector.tsx';
import { formatYer } from '../../../shared/money.ts';

function renderTextWithSafeLinks(text: string) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(/^https?:\/\//i)) {
      const lower = part.toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
        return part;
      }
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-600 dark:text-emerald-400 underline hover:text-emerald-700 font-medium break-all inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

interface TasksViewProps {
  onGoToSubmissions: () => void;
  onGoToWallet: () => void;
  initialCategory?: string;
}

export const TasksView: React.FC<TasksViewProps> = ({ onGoToSubmissions, onGoToWallet, initialCategory }) => {
  const { user, refreshWallet, showToast } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [geoFilter, setGeoFilter] = useState<GeoFilterValue>({ countryId: '', divisionId: '' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory]);

  // Modal state
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [proofText, setProofText] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofImages, setProofImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTasks = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getTasks({
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        search: searchQuery || undefined,
        countryId: geoFilter.countryId || undefined,
        divisionId: geoFilter.divisionId || undefined,
      });
      setTasks(res.tasks || []);
    } catch (err: any) {
      console.error('Failed to load tasks', err);
      setLoadError(err.message || 'تعذر تحميل المهام مؤقتاً.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [selectedCategory, searchQuery, geoFilter.countryId, geoFilter.divisionId]);

  const handleOpenTask = (task: TaskItem) => {
    setActiveTask(task);
    setProofText('');
    setProofUrl('');
    setProofImages([]);
    setSubmitError('');
    setIsUploadingImage(false);
  };

  const handleCloseModal = () => {
    setActiveTask(null);
    setIsUploadingImage(false);
  };

  // Direct browser-to-storage upload via Signed Upload URL
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 5 ميجابايت.');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (file.type && !allowedTypes.includes(file.type.toLowerCase())) {
      setSubmitError('صيغة الملف غير مدعومة. يرجى اختيار صورة JPEG أو PNG أو WEBP.');
      return;
    }

    setIsUploadingImage(true);
    setSubmitError('');

    try {
      const signRes = await api.getUploadSignedUrl({
        taskId: activeTask!.id,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        fileSize: file.size,
      });

      if (!signRes?.signedUrl || !signRes?.path) {
        throw new Error('تعذر الحصول على رابط الرفع المؤقت.');
      }

      const uploadRes = await fetch(signRes.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'image/jpeg',
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error('فشل رفع الصورة مباشرة إلى التخزين السحابي.');
      }

      setProofImages([signRes.path]);
      showToast('تم رفع الصورة بنجاح إلى التخزين السحابي الآمن', 'success');
    } catch (err: any) {
      setSubmitError(err.message || 'فشل رفع الصورة إلى التخزين السحابي، يرجى المحاولة مجدداً.');
    } finally {
      setIsUploadingImage(false);
      // Reset input value so same file can be chosen again if needed
      e.target.value = '';
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;

    if (activeTask.proofRequirements.requireText && !proofText.trim()) {
      setSubmitError('يرجى كتابة نص الإثبات أو الملاحظات المطلوبة.');
      return;
    }

    if (proofImages.length === 0) {
      setSubmitError('صورة إثبات الإنجاز إجبارية. يرجى رفع لقطة الشاشة كإثبات.');
      return;
    }

    if (activeTask.proofRequirements.requireUrl && !proofUrl.trim()) {
      setSubmitError('هذه المهمة تتطلب إدخال رابط الإثبات (URL).');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      await api.submitTaskProof({
        taskId: activeTask.id,
        proofText: proofText.trim() || undefined,
        proofImages,
        proofUrl: proofUrl.trim() || undefined,
      });

      // Launch reward celebration confetti
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
        });
      } catch {}

      showToast('تم إرسال إثبات المهمة بنجاح! سيتم تدقيقه وقيد المكافأة.', 'success');
      handleCloseModal();
      refreshWallet();
      loadTasks();
    } catch (err: any) {
      setSubmitError(err.message || 'فشل في إرسال الإثبات.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoryTabs = [
    { id: 'all', label: 'كافة المهام' },
    { id: 'app_testing', label: 'تجربة التطبيقات' },
    { id: 'surveys', label: 'الاستبيانات' },
    { id: 'review_ratings', label: 'التقييمات والخرائط' },
    { id: 'data_entry', label: 'إدخال البيانات' },
    { id: 'social_engagement', label: 'النشر والتفاعل' },
    { id: 'content_writing', label: 'صياغة المحتوى' },
  ];

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'app_testing':
        return 'تجربة تطبيق';
      case 'surveys':
        return 'استبيان';
      case 'review_ratings':
        return 'خرائط وجوجل';
      case 'data_entry':
        return 'إدخال بيانات';
      case 'social_engagement':
        return 'نشر اجتماعي';
      case 'content_writing':
        return 'كتابة محتوى';
      default:
        return 'مهمة عامة';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            المهام المتاحة للكسب اليوم
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            اختر المهمة التي ترغب بإنجازها، واكسب المكافأة بالريال اليمني فور تدقيق إثباتك.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في أسماء وتفاصيل المهام..."
            className="w-full pr-9 pl-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Segmented Filter Buttons (Interactive filter controls allowed per §1.A) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedCategory(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              selectedCategory === tab.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Cascading Arab Country & Division Filter */}
      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <GeoLocationSelector
          mode="filter"
          countryId={geoFilter.countryId}
          divisionId={geoFilter.divisionId}
          onChange={setGeoFilter}
        />
      </div>

      {loadError && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadTasks}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs transition-colors shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Task List Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-48 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-800"
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8">
          <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            لا توجد مهام مطابقة حالياً
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            جرب اختيار تصنيف آخر أو تفقد المنصة لاحقاً حيث يتم إضافة مهام جديدة على مدار اليوم.
          </p>
          <button
            onClick={() => {
              setSelectedCategory('all');
              setSearchQuery('');
              setGeoFilter({ countryId: '', divisionId: '' });
            }}
            className="px-4 py-2 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg hover:bg-emerald-100"
          >
            عرض كافة المهام
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tasks.map((task, index) => {
            const percentCompleted =
              task.totalQuantity > 0
                ? Math.min(100, Math.round((task.completedQuantity / task.totalQuantity) * 100))
                : 0;
            const remaining = Math.max(0, task.totalQuantity - task.completedQuantity);

            return (
              <React.Fragment key={task.id}>
                <div
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 hover:shadow-md transition-all flex flex-col justify-between"
                >
                <div>
                  {/* Category & Time Unboxed Metadata (§1.A) */}
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2.5">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {getCategoryBadge(task.category)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{task.timeEstimateMinutes} دقائق</span>
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mb-2 leading-snug line-clamp-2">
                    {task.title}
                  </h3>

                  {/* Advertiser Identity Attribution (§ Phase 4) */}
                  <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {task.isExternalCampaign ? (
                      <div className="flex items-center gap-2 min-w-0">
                        {!task.hideAdvertiserName && task.advertiserLogoUrl ? (
                          <SecureImageView
                            storagePathOrUrl={task.advertiserLogoUrl}
                            alt={task.advertiserDisplayName || 'شعار المعلن'}
                            className="w-5 h-5 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        ) : task.hideAdvertiserName ? (
                          <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {task.hideAdvertiserName
                            ? 'معلن عبر يمن تاسك'
                            : task.advertiserDisplayName || 'معلن عبر يمن تاسك'}
                        </span>
                      </div>
                    ) : (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        مهمة مباشرة من المنصة
                      </span>
                    )}
                    {task.isExternalCampaign && (
                      <span className="shrink-0 text-[10px] text-slate-400">حملة معلن خارجي</span>
                    )}
                  </div>

                  {/* Geographic Scope Metadata */}
                  <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">
                      {task.countryFlag ? `${task.countryFlag} ` : ''}
                      {task.locationLabel || task.countryNameAr || 'جميع الدول العربية'}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4 line-clamp-3">
                    {renderTextWithSafeLinks(task.description)}
                  </p>
                </div>

                <div>
                  {/* Quota Progress */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>المتبقي: {remaining} من {task.totalQuantity}</span>
                      <span className="font-mono tabular-nums">{percentCompleted}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${percentCompleted}%` }}
                      />
                    </div>
                  </div>

                  {/* Reward & Action */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">المكافأة المباشرة</span>
                      <span className="text-base font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatYer(task.rewardYer)}{' '}
                        <span className="text-xs font-normal">ر.ي</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenTask(task)}
                      className="px-4 py-2 text-xs font-bold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 rounded-xl transition-colors"
                    >
                      بدء المهمة
                    </button>
                  </div>
                </div>
                </div>
                {(index + 1) % 2 === 0 && (
                  <AdsterraAd
                    placementId={`tasks_between_${index + 1}`}
                    className="col-span-full"
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Task Details & Submission Modal (Mobile-first bottom sheet) */}
      {activeTask && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={handleCloseModal}
        >
          <div
            className="relative w-full sm:max-w-xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />
            {/* Header */}
            <div className="flex items-start justify-between px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
              <div>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {getCategoryBadge(activeTask.category)} · {activeTask.timeEstimateMinutes} دقائق تقريباً ·{' '}
                  {activeTask.countryFlag ? `${activeTask.countryFlag} ` : ''}
                  {activeTask.locationLabel || activeTask.countryNameAr || 'جميع الدول العربية'}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {activeTask.title}
                </h2>
              </div>
              <button
                onClick={handleCloseModal}
                aria-label="إغلاق"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
              {/* Advertiser Attribution Strip inside Task Modal */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  {activeTask.isExternalCampaign && !activeTask.hideAdvertiserName && activeTask.advertiserLogoUrl ? (
                    <SecureImageView
                      storagePathOrUrl={activeTask.advertiserLogoUrl}
                      alt={activeTask.advertiserDisplayName || 'شعار المعلن'}
                      className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                      {activeTask.isExternalCampaign && activeTask.hideAdvertiserName ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Building2 className="w-4 h-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activeTask.isExternalCampaign ? 'الجهة المعلنة' : 'مصدر المهمة'}
                    </div>
                    <div className="font-bold text-slate-900 dark:text-white truncate">
                      {activeTask.isExternalCampaign
                        ? activeTask.hideAdvertiserName
                          ? 'معلن عبر يمن تاسك'
                          : activeTask.advertiserDisplayName || 'معلن عبر يمن تاسك'
                        : 'مهمة مباشرة من المنصة'}
                    </div>
                  </div>
                </div>
                {activeTask.isExternalCampaign && (
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                    حملة معلن خارجي
                  </span>
                )}
              </div>

              {/* Reward Strip */}
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                    المكافأة عند اعتماد الإثبات:
                  </span>
                  <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                    {formatYer(activeTask.rewardYer)} ريال يمني (YER)
                  </div>
                </div>
                <div className="text-left text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  إيداع فوري في المحفظة
                </div>
              </div>

              {/* Instructions Steps */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                  خطوات تنفيذ المهمة:
                </h3>
                {activeTask.steps && activeTask.steps.length > 0 ? (
                  <ul className="space-y-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                    {activeTask.steps.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-mono text-[11px] font-bold shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {renderTextWithSafeLinks(activeTask.description)}
                  </p>
                )}
              </div>

              {/* Submission Form */}
              <form onSubmit={handleSubmitProof} className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  تقديم إثبات الإنجاز:
                </h3>

                {submitError && (
                  <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Text Proof */}
                {activeTask.proofRequirements.requireText && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      النص أو الملاحظات المطلوبة
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={proofText}
                      onChange={(e) => setProofText(e.target.value)}
                      placeholder="اكتب الإجابات أو الملاحظات التي تم التوصل إليها بدقة..."
                      className="w-full p-3 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}

                {/* URL Proof (if requested) */}
                {activeTask.proofRequirements.requireUrl && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      رابط التقييم أو المنشور (URL)
                    </label>
                    <div className="relative">
                      <LinkIcon className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="url"
                        value={proofUrl}
                        onChange={(e) => setProofUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Image Proof Upload (Always Available) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    لقطة الشاشة / صورة الإثبات <span className="text-rose-500">* (إجباري)</span>
                  </label>
                  <div className="mt-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 hover:border-emerald-500 transition-colors bg-slate-50/50 dark:bg-slate-800/30">
                    {proofImages.length > 0 ? (
                      <div className="relative w-full max-h-48 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                        <SecureImageView
                          storagePathOrUrl={proofImages[0]}
                          alt="إثبات المهمة المرفوع"
                          className="w-full h-40 object-cover rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setProofImages([])}
                          className="absolute top-2 left-2 p-1 bg-rose-600 text-white rounded-md text-xs hover:bg-rose-700"
                        >
                          حذف وتغيير الصورة
                        </button>
                      </div>
                    ) : isUploadingImage ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-2">
                        <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          جاري رفع الصورة إلى التخزين الآمن...
                        </span>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center cursor-pointer w-full py-3">
                        <Upload className="w-8 h-8 text-emerald-600 mb-2" />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          انقر لاختيار لقطة الشاشة من جهازك
                        </span>
                        <span className="text-[11px] text-slate-400 mt-1">
                          PNG, JPG, WEBP حتى 5 ميجابايت
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isUploadingImage || proofImages.length === 0}
                    className="px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <span>جاري إرسال الإثبات...</span>
                    ) : isUploadingImage ? (
                      <span>جاري رفع الصورة...</span>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>إرسال الإثبات للاعتماد</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
