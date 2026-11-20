import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, NetworkOfflineError } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskItem } from '../../types/index.ts';
import {
  Search,
  Clock,
  CheckCircle,
  Upload,
  Link as LinkIcon,
  X,
  FileText,
  AlertCircle,
  Building2,
  EyeOff,
  MapPin,
  Smartphone,
  ClipboardList,
  Share2,
  Zap,
  WifiOff,
  ArrowLeft,
  Crown,
  Star,
  Flame,
  Info,
  LayoutGrid,
  PlaySquare,
  Globe,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SecureImageView } from '../common/SecureImageView.tsx';
import { AdsterraAd } from '../ads/AdsterraAd.tsx';
import { GeoLocationSelector, type GeoFilterValue } from '../common/GeoLocationSelector.tsx';
import { formatYer } from '../../../shared/money.ts';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';
import { getTaskKindLabel, inferTaskKindFromCategory } from '../../../shared/taskMeta.ts';

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

type CardVisualVariant = 'visual_social' | 'survey' | 'app_testing' | 'quick_task';

function isSafeHttpUrl(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}

type QuickFilterType = 'all' | 'featured' | 'popular' | 'quick';

function getTaskVisualVariant(category: string, taskKind?: string): CardVisualVariant {
  if (taskKind === 'surveys' || category === 'surveys') return 'survey';
  if (taskKind === 'app_testing' || category === 'app_testing') return 'app_testing';
  if (taskKind === 'ad_watch' || category === 'social_engagement' || category === 'review_ratings') return 'visual_social';
  return 'quick_task';
}

interface TasksViewProps {
  onGoToSubmissions: () => void;
  onGoToWallet: () => void;
  initialCategory?: string;
}

export const TasksView: React.FC<TasksViewProps> = ({ initialCategory }) => {
  const { refreshWallet, showToast, isOnline } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'all');
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [geoFilter, setGeoFilter] = useState<GeoFilterValue>({ countryId: '', divisionId: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isStaleOfflineCache, setIsStaleOfflineCache] = useState(false);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<string | number | null>(null);

  useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory]);

  useEffect(() => {
    getCacheItem<string[]>('task_favorites')
      .then((res) => {
        if (res && Array.isArray(res.value)) {
          setFavoriteIds(res.value);
        }
      })
      .catch(() => {});
  }, []);

  const toggleFavorite = useCallback((taskId: string) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId];
      saveCacheItem('task_favorites', next).catch(() => {});
      return next;
    });
  }, []);

  // Modal state
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [proofText, setProofText] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofImages, setProofImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const filterClientFallback = useCallback(
    (list: TaskItem[]) => {
      return list.filter((item) => {
        if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
        if (geoFilter.countryId && item.countryId !== geoFilter.countryId) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          if (
            !item.title.toLowerCase().includes(q) &&
            !item.description.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      });
    },
    [selectedCategory, geoFilter.countryId, searchQuery]
  );

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const cacheKey = `tasks_list_${selectedCategory}_${geoFilter.countryId || 'all'}`;

    try {
      const res = await api.getTasks({
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        search: searchQuery || undefined,
        countryId: geoFilter.countryId || undefined,
        divisionId: geoFilter.divisionId || undefined,
      });
      const fetched = res.tasks || [];
      setTasks(fetched);
      setIsStaleOfflineCache(false);
      setCacheUpdatedAt(Date.now());
      if (!searchQuery.trim()) {
        saveCacheItem(cacheKey, fetched).catch(() => {});
        if (selectedCategory === 'all' && !geoFilter.countryId && !geoFilter.divisionId) {
          saveCacheItem('tasks_list_all_all', fetched).catch(() => {});
        }
      }
    } catch (err: any) {
      const specificCache = await getCacheItem<TaskItem[]>(cacheKey);
      const fallbackAll =
        specificCache?.value?.length
          ? specificCache
          : await getCacheItem<TaskItem[]>('tasks_list_all_all');

      if (fallbackAll && Array.isArray(fallbackAll.value)) {
        setTasks(filterClientFallback(fallbackAll.value));
        setIsStaleOfflineCache(true);
        setCacheUpdatedAt(fallbackAll.updatedAt);
        setLoadError(null);
      } else {
        setLoadError(
          err instanceof NetworkOfflineError || !isOnline
            ? 'لا يوجد اتصال بالإنترنت ولم يتم حفظ مهام محلياً بعد.'
            : err.message || 'تعذر تحميل المهام مؤقتاً.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, searchQuery, geoFilter.countryId, geoFilter.divisionId, filterClientFallback, isOnline]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Auto-resync tasks when connection recovers
  useEffect(() => {
    const onOnlineSync = () => {
      loadTasks();
    };
    window.addEventListener('kasb:sync_online', onOnlineSync);
    return () => window.removeEventListener('kasb:sync_online', onOnlineSync);
  }, [loadTasks]);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isOnline) {
      setSubmitError('رفع صور الإثبات يتطلب اتصالاً نشطاً بالإنترنت.');
      e.target.value = '';
      return;
    }

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
      e.target.value = '';
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;

    if (!isOnline) {
      setSubmitError('لا يمكن إرسال إثبات المهمة بدون اتصال بالإنترنت. يرجى المحاولة عند عودة الشبكة.');
      return;
    }

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

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'app_testing':
        return 'تجربة تطبيق';
      case 'surveys':
        return 'استبيان';
      case 'review_ratings':
        return 'خرائط وتقييم';
      case 'data_entry':
        return 'إدخال بيانات';
      case 'social_engagement':
        return 'تفاعل اجتماعي';
      case 'content_writing':
        return 'كتابة محتوى';
      default:
        return 'مهمة عامة';
    }
  };

  const renderCategoryIcon = (variant: CardVisualVariant, taskKind?: string) => {
    if (taskKind === 'ad_watch') return <PlaySquare className="w-4 h-4 text-emerald-500" />;
    if (taskKind === 'external_offers') return <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
    switch (variant) {
      case 'visual_social':
        return <Share2 className="w-4 h-4 text-emerald-500" />;
      case 'survey':
        return <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      case 'app_testing':
        return <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      default:
        return <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    }
  };

  const displayedTasks = useMemo(() => {
    const filtered = tasks.filter((item) => {
      const isFeat = Boolean(item.isFeatured || item.taskMeta?.isFeatured);
      const kind = item.taskKind || item.taskMeta?.taskKind || inferTaskKindFromCategory(item.category);
      if (quickFilter === 'featured') return isFeat;
      if (quickFilter === 'popular') return (item.completedQuantity || 0) > 0 || (item.totalQuantity || 0) >= 50;
      if (quickFilter === 'quick') return (item.timeEstimateMinutes || 10) <= 5 || kind === 'quick_tasks' || kind === 'ad_watch';
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aFeat = a.isFeatured || a.taskMeta?.isFeatured ? 1 : 0;
      const bFeat = b.isFeatured || b.taskMeta?.isFeatured ? 1 : 0;
      if (aFeat !== bFeat) return bFeat - aFeat;

      if (quickFilter === 'popular') {
        const compDiff = (b.completedQuantity || 0) - (a.completedQuantity || 0);
        if (compDiff !== 0) return compDiff;
      }

      const aAvail = Math.max(0, (a.totalQuantity || 0) - (a.completedQuantity || 0)) > 0 ? 1 : 0;
      const bAvail = Math.max(0, (b.totalQuantity || 0) - (b.completedQuantity || 0)) > 0 ? 1 : 0;
      if (aAvail !== bAvail) return bAvail - aAvail;

      const aPrio = Number(a.priority ?? a.taskMeta?.priority ?? 0);
      const bPrio = Number(b.priority ?? b.taskMeta?.priority ?? 0);
      if (aPrio !== bPrio) return bPrio - aPrio;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tasks, quickFilter]);

  const quickPills: Array<{ id: QuickFilterType; label: string; icon: React.ReactNode }> = [
    { id: 'all', label: 'جميع المهام', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { id: 'featured', label: 'مميزة', icon: <Crown className="w-3.5 h-3.5 text-amber-500" /> },
    { id: 'popular', label: 'الأكثر شعبية', icon: <Flame className="w-3.5 h-3.5 text-amber-500" /> },
    { id: 'quick', label: 'المهام السريعة', icon: <Zap className="w-3.5 h-3.5 text-emerald-500" /> },
  ];

  return (
    <div className="space-y-5">
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

      {/* Quick Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {quickPills.map((pill) => {
          const active = quickFilter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setQuickFilter(pill.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap inline-flex items-center gap-1.5 shrink-0 ${
                active
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-emerald-500/60'
              }`}
            >
              <span className={active ? '[&>svg]:text-white' : ''}>{pill.icon}</span>
              <span>{pill.label}</span>
            </button>
          );
        })}
      </div>

      {/* Segmented Filter Buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl no-scrollbar">
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedCategory(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              selectedCategory === tab.id
                ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
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

      {/* Stale Offline Cache Notice */}
      {isStaleOfflineCache && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              البيانات المعروضة محفوظة مؤقتاً على جهازك وقد تكون غير محدثة
              {cacheUpdatedAt ? ` · آخر تحديث: ${new Date(cacheUpdatedAt).toLocaleTimeString('ar-YE')}` : ''}.
            </span>
          </div>
          {isOnline && (
            <button
              type="button"
              onClick={loadTasks}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs self-start sm:self-auto"
            >
              تحديث المهام الآن
            </button>
          )}
        </div>
      )}

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

      {/* Task List Grid with Category-Distinct Visual Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-52 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-800"
            />
          ))}
        </div>
      ) : displayedTasks.length === 0 ? (
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
              setQuickFilter('all');
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
          {displayedTasks.map((task, index) => {
            const percentCompleted =
              task.totalQuantity > 0
                ? Math.min(100, Math.round((task.completedQuantity / task.totalQuantity) * 100))
                : 0;
            const remaining = Math.max(0, task.totalQuantity - task.completedQuantity);
            const taskKind = task.taskKind || task.taskMeta?.taskKind;
            const variant = getTaskVisualVariant(task.category, taskKind);
            const stepsCount = task.steps?.length || 0;
            const isFeatured = Boolean(task.isFeatured || task.taskMeta?.isFeatured);
            const isFav = favoriteIds.includes(task.id);
            const isAvailable = task.status === 'ACTIVE' && remaining > 0;
            const typeDisplayLabel = taskKind ? getTaskKindLabel(taskKind, task.category) : getCategoryLabel(task.category);

            return (
              <React.Fragment key={task.id}>
                <article
                  className={`rounded-2xl bg-white dark:bg-slate-900 border overflow-hidden hover:shadow-md transition-all flex flex-col justify-between ${
                    isFeatured
                      ? 'border-amber-400 dark:border-amber-500/80 ring-1 ring-amber-400/30 shadow-sm'
                      : variant === 'visual_social'
                        ? 'border-slate-300 dark:border-slate-700 hover:border-emerald-500'
                        : variant === 'app_testing'
                          ? 'border-emerald-200 dark:border-emerald-900/70 hover:border-emerald-500'
                          : 'border-slate-200 dark:border-slate-800 hover:border-emerald-500/60'
                  }`}
                >
                  {/* Visual Variant & Featured Header Strip */}
                  <div
                    className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b ${
                      isFeatured
                        ? 'bg-gradient-to-l from-amber-50 via-emerald-50/60 to-white dark:from-amber-950/40 dark:via-emerald-950/20 dark:to-slate-900 border-amber-200/70 dark:border-amber-800/50'
                        : variant === 'visual_social'
                          ? 'bg-slate-900 dark:bg-slate-950 text-white border-slate-800'
                          : variant === 'app_testing'
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/60'
                            : 'bg-slate-50/80 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isFeatured && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold shadow-sm">
                          <Crown className="w-3 h-3" />
                          <span>مهمة مميزة</span>
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                          !isFeatured && variant === 'visual_social'
                            ? 'text-emerald-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {renderCategoryIcon(variant, taskKind)}
                        <span>{typeDisplayLabel}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isAvailable
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {isAvailable ? 'متاح الآن' : 'مكتمل'}
                      </span>
                      <span
                        className={`text-[11px] font-mono tabular-nums flex items-center gap-1 ${
                          !isFeatured && variant === 'visual_social'
                            ? 'text-slate-300'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <span>{task.timeEstimateMinutes} د</span>
                      </span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white mb-2 leading-snug line-clamp-2">
                        {task.title}
                      </h3>

                      {/* Clean unboxed metadata row */}
                      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5 min-w-0 font-semibold text-slate-700 dark:text-slate-300">
                          {task.isExternalCampaign && !task.hideAdvertiserName && task.advertiserLogoUrl ? (
                            <SecureImageView
                              storagePathOrUrl={task.advertiserLogoUrl}
                              alt={task.advertiserDisplayName || 'شعار المعلن'}
                              className="w-4 h-4 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                          ) : task.isExternalCampaign && task.hideAdvertiserName ? (
                            <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                          <span className="truncate max-w-[140px]">
                            {task.isExternalCampaign
                              ? task.hideAdvertiserName
                                ? 'معلن عبر يمن تاسك'
                                : task.advertiserDisplayName || 'معلن عبر يمن تاسك'
                              : 'مصدّق من المنصة'}
                          </span>
                        </span>

                        <span aria-hidden="true">·</span>

                        <span className="inline-flex items-center gap-1 truncate max-w-[150px]">
                          <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="truncate">
                            {task.countryFlag ? `${task.countryFlag} ` : ''}
                            {task.locationLabel || task.countryNameAr || 'عن بُعد / جميع الدول'}
                          </span>
                        </span>

                        {stepsCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{stepsCount} خطوات</span>
                          </>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                        {renderTextWithSafeLinks(task.description)}
                      </p>
                    </div>

                    <div>
                      {/* Quota Progress Bar */}
                      <div className="mb-3.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          <span>
                            المتبقي: <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{remaining}</strong> من{' '}
                            <span className="font-mono tabular-nums">{task.totalQuantity}</span>
                          </span>
                          <span className="font-mono tabular-nums font-semibold">{percentCompleted}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isFeatured ? 'bg-amber-500' : 'bg-emerald-600'}`}
                            style={{ width: `${percentCompleted}%` }}
                          />
                        </div>
                      </div>

                      {/* Reward & Action Buttons */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-medium text-slate-400 block">
                              مكافأة الإنجاز
                            </span>
                            <span className="text-base font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                              {formatYer(task.rewardYer)}{' '}
                              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">ر.ي</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleFavorite(task.id)}
                              title={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                              aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                              className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center gap-1 ${
                                isFav
                                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                              }`}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-500 text-amber-500' : ''}`} />
                              <span className="hidden sm:inline">{isFav ? 'مفضلة' : 'مفضلة'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenTask(task)}
                              title="تفاصيل المهمة"
                              aria-label="تفاصيل المهمة"
                              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-emerald-500 transition-colors"
                            >
                              <Info className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenTask(task)}
                          className="w-full min-h-[42px] px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <span>بدء المهمة الآن</span>
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>

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
                  {getCategoryLabel(activeTask.category)} · {activeTask.timeEstimateMinutes} دقائق تقريباً ·{' '}
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
                  <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                    {formatYer(activeTask.rewardYer)}{' '}
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">ريال يمني (YER)</span>
                  </div>
                </div>
                <div className="text-left text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  إيداع فوري في المحفظة
                </div>
              </div>

              {/* Dynamic Type-Specific Metadata Details */}
              {activeTask.taskMeta?.fields &&
                Object.values(activeTask.taskMeta.fields).some((v) =>
                  Array.isArray(v) ? v.length > 0 : Boolean(v)
                ) && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-emerald-600" />
                      <span>متطلبات وتفاصيل {getTaskKindLabel(activeTask.taskKind, activeTask.category)}</span>
                    </div>

                    {activeTask.taskMeta.fields.questions && activeTask.taskMeta.fields.questions.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-700 dark:text-slate-300">الأسئلة المطلوبة:</div>
                        <ul className="list-disc pr-4 space-y-1 text-slate-600 dark:text-slate-300">
                          {activeTask.taskMeta.fields.questions.map((q, idx) => (
                            <li key={idx}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activeTask.taskMeta.fields.optionsText && (
                      <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200">خيارات الإجابة: </strong>
                        {activeTask.taskMeta.fields.optionsText}
                      </div>
                    )}

                    {isSafeHttpUrl(activeTask.taskMeta.fields.adUrl) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-slate-600 dark:text-slate-300">
                          مدة المشاهدة:{' '}
                          <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                            {activeTask.taskMeta.fields.watchDurationSeconds || 30} ثانية
                          </strong>
                        </span>
                        <a
                          href={activeTask.taskMeta.fields.adUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                        >
                          <span>فتح رابط الإعلان</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )}

                    {activeTask.taskMeta.fields.completionRule && (
                      <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200">شرط الإتمام: </strong>
                        {activeTask.taskMeta.fields.completionRule}
                      </div>
                    )}

                    {isSafeHttpUrl(activeTask.taskMeta.fields.appDownloadUrl) && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">رابط التطبيق:</span>
                        <a
                          href={activeTask.taskMeta.fields.appDownloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                        >
                          <span>فتح / تحميل التطبيق</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )}

                    {activeTask.taskMeta.fields.testingInstructions && (
                      <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200">تعليمات الاختبار: </strong>
                        {activeTask.taskMeta.fields.testingInstructions}
                      </div>
                    )}

                    {(activeTask.taskMeta.fields.requiredProofNote || activeTask.taskMeta.fields.proofNotes) && (
                      <div className="text-amber-700 dark:text-amber-300 font-medium">
                        ملاحظة الإثبات:{' '}
                        {activeTask.taskMeta.fields.requiredProofNote || activeTask.taskMeta.fields.proofNotes}
                      </div>
                    )}

                    {activeTask.taskMeta.fields.partnerName && (
                      <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200">الشريك: </strong>
                        {activeTask.taskMeta.fields.partnerName}
                      </div>
                    )}

                    {isSafeHttpUrl(activeTask.taskMeta.fields.offerUrl) && (
                      <div>
                        <a
                          href={activeTask.taskMeta.fields.offerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                        >
                          <span>فتح رابط العرض</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )}

                    {activeTask.taskMeta.fields.offerConditions && (
                      <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200">الشروط: </strong>
                        {activeTask.taskMeta.fields.offerConditions}
                      </div>
                    )}
                  </div>
                )}

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

                {!isOnline && (
                  <div className="p-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg flex items-center gap-2">
                    <WifiOff className="w-4 h-4 shrink-0" />
                    <span>إرسال الإثبات ورفع لقطة الشاشة يتطلبان اتصالاً بالإنترنت.</span>
                  </div>
                )}

                {submitError && (
                  <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

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

                {/* Image Proof Upload */}
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
                      <label className={`flex flex-col items-center justify-center w-full py-3 ${isOnline ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
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
                          disabled={!isOnline}
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
                    disabled={!isOnline || isSubmitting || isUploadingImage || proofImages.length === 0}
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
