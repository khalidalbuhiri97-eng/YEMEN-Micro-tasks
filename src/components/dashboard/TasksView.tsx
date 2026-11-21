import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, NetworkOfflineError } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SurveyItem, TaskCategoryItem, TaskItem } from '../../types/index.ts';
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
  Zap,
  WifiOff,
  Star,
  ExternalLink,
  ShieldCheck,
  Coins,
  Users,
  ChevronsLeft,
  ClipboardList,
  Link2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SecureImageView } from '../common/SecureImageView.tsx';
import { AdsterraAd } from '../ads/AdsterraAd.tsx';
import { GeoLocationSelector, type GeoFilterValue } from '../common/GeoLocationSelector.tsx';
import { formatYer } from '../../../shared/money.ts';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';
import {
  SUPABASE_TASK_ASSET_URLS,
  getTaskKindLabel,
  inferTaskKindFromCategory,
} from '../../../shared/taskMeta.ts';
import { TaskVisualCard } from '../tasks/TaskVisualCard.tsx';
import { SmartLinkModal } from '../tasks/SmartLinkModal.tsx';
import { SurveyRunnerModal } from '../tasks/SurveyRunnerModal.tsx';

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

function isSafeHttpUrl(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}

type QuickFilterType = 'all' | 'featured' | 'popular' | 'quick';

interface TasksViewProps {
  onGoToSubmissions: () => void;
  onGoToWallet: () => void;
  initialCategory?: string;
}

export const TasksView: React.FC<TasksViewProps> = ({ initialCategory }) => {
  const { refreshWallet, showToast, isOnline } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryItem[]>([]);
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

  // Modal state for standard tasks, info sheet, smart links, and sequential surveys
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [infoModalTask, setInfoModalTask] = useState<TaskItem | null>(null);
  const [activeSmartLinkTask, setActiveSmartLinkTask] = useState<TaskItem | null>(null);
  const [activeSurveyId, setActiveSurveyId] = useState<string | null>(null);

  const [proofText, setProofText] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofImages, setProofImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load categories & synced favorites
  useEffect(() => {
    api
      .getTaskCategories()
      .then((res) => {
        if (Array.isArray(res.categories)) {
          setCategories(res.categories);
          saveCacheItem('task_categories_v1', res.categories).catch(() => {});
        }
      })
      .catch(async () => {
        const cached = await getCacheItem<TaskCategoryItem[]>('task_categories_v1').catch(() => null);
        if (cached?.value) setCategories(cached.value);
      });

    api
      .getFavoriteTaskIds()
      .then((res) => {
        if (Array.isArray(res.favoriteIds)) {
          setFavoriteIds(res.favoriteIds);
          saveCacheItem('task_favorites', res.favoriteIds).catch(() => {});
        }
      })
      .catch(async () => {
        const cached = await getCacheItem<string[]>('task_favorites').catch(() => null);
        if (cached && Array.isArray(cached.value)) {
          setFavoriteIds(cached.value);
        }
      });
  }, []);

  const toggleFavorite = useCallback(
    async (taskId: string) => {
      const wasFav = favoriteIds.includes(taskId);
      const optimistic = wasFav
        ? favoriteIds.filter((id) => id !== taskId)
        : [...favoriteIds, taskId];
      setFavoriteIds(optimistic);
      saveCacheItem('task_favorites', optimistic).catch(() => {});

      if (taskId.startsWith('survey-')) {
        return;
      }

      if (!isOnline) {
        return;
      }

      try {
        const res = await api.toggleFavoriteTask(taskId);
        if (Array.isArray(res.favoriteIds)) {
          setFavoriteIds(res.favoriteIds);
          saveCacheItem('task_favorites', res.favoriteIds).catch(() => {});
        }
      } catch {
        // Keep optimistic UI without crashing
      }
    },
    [favoriteIds, isOnline]
  );

  const filterClientFallback = useCallback(
    (list: TaskItem[]) => {
      return list.filter((item) => {
        if (selectedCategory !== 'all' && selectedCategory !== 'favorites' && item.category !== selectedCategory) {
          return false;
        }
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
    const apiCategory =
      selectedCategory === 'all' || selectedCategory === 'favorites' || selectedCategory === 'smart_links'
        ? undefined
        : selectedCategory;

    try {
      const [res, surveysRes] = await Promise.all([
        api.getTasks({
          category: apiCategory,
          search: searchQuery || undefined,
          countryId: geoFilter.countryId || undefined,
          divisionId: geoFilter.divisionId || undefined,
        }),
        api.getSurveys().catch(() => ({ surveys: [] })),
      ]);
      const fetched = res.tasks || [];
      setTasks(fetched);
      if (Array.isArray(surveysRes?.surveys)) {
        setSurveys(surveysRes.surveys);
        saveCacheItem('surveys_list_v1', surveysRes.surveys).catch(() => {});
      }

      // Sync favorited flags returned from server if user is authenticated
      const serverFavs = fetched.filter((t) => t.isFavorited).map((t) => t.id);
      if (serverFavs.length > 0) {
        setFavoriteIds((prev) => Array.from(new Set([...prev, ...serverFavs])));
      }

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
      const cachedSurveys = await getCacheItem<SurveyItem[]>('surveys_list_v1').catch(() => null);
      if (cachedSurveys?.value) {
        setSurveys(cachedSurveys.value);
      }

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

  const handleOpenProofTask = (task: TaskItem) => {
    setActiveTask(task);
    setProofText('');
    setProofUrl('');
    setProofImages([]);
    setSubmitError('');
    setIsUploadingImage(false);
  };

  const handleStartTask = (task: TaskItem) => {
    const kind = task.taskKind || task.taskMeta?.taskKind || inferTaskKindFromCategory(task.category);
    if (kind === 'smart_links') {
      setActiveSmartLinkTask(task);
      return;
    }
    const linkedSurvey = task.linkedSurveyId || task.taskMeta?.linkedSurveyId || task.taskMeta?.fields?.linkedSurveyId;
    if (linkedSurvey) {
      setActiveSurveyId(linkedSurvey);
      return;
    }
    handleOpenProofTask(task);
  };

  const handleInfoTask = (task: TaskItem) => {
    const kind = task.taskKind || task.taskMeta?.taskKind || inferTaskKindFromCategory(task.category);
    const linkedSurvey = task.linkedSurveyId || task.taskMeta?.linkedSurveyId || task.taskMeta?.fields?.linkedSurveyId;
    if (kind === 'smart_links' || linkedSurvey) {
      setInfoModalTask(task);
      return;
    }
    handleOpenProofTask(task);
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

  const categoryTabs = useMemo(() => {
    const base = [
      { id: 'all', label: 'كافة المهام', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_all },
      { id: 'smart_links', label: 'الروابط الذكية', iconUrl: SUPABASE_TASK_ASSET_URLS.smart_links },
      { id: 'surveys', label: 'الاستبيانات', iconUrl: SUPABASE_TASK_ASSET_URLS.surveys },
      { id: 'app_testing', label: 'تجربة التطبيقات', iconUrl: SUPABASE_TASK_ASSET_URLS.app_testing },
      { id: 'social_engagement', label: 'التفاعل والإعلانات', iconUrl: SUPABASE_TASK_ASSET_URLS.ad_watch },
      { id: 'data_entry', label: 'إدخال البيانات', iconUrl: SUPABASE_TASK_ASSET_URLS.quick_tasks },
      { id: 'review_ratings', label: 'التقييمات والخرائط', iconUrl: SUPABASE_TASK_ASSET_URLS.external_offers },
      { id: 'local_services', label: 'عروض الشركاء', iconUrl: SUPABASE_TASK_ASSET_URLS.external_offers },
    ];
    const catBySlug = new Map(categories.map((c) => [c.slug, c]));
    return [
      ...base.map((b) => {
        const remote = catBySlug.get(b.id);
        if (remote && !remote.isActive) return null;
        return {
          id: b.id,
          label: remote?.labelAr || b.label,
          iconUrl: remote?.iconUrl || b.iconUrl,
        };
      }).filter(Boolean) as Array<{ id: string; label: string; iconUrl: string }>,
      { id: 'favorites', label: `المفضلة (${favoriteIds.length})`, iconUrl: SUPABASE_TASK_ASSET_URLS.cat_featured },
    ];
  }, [categories, favoriteIds.length]);

  const getCategoryLabel = (cat: string) => {
    const matched = categories.find((c) => c.slug === cat);
    if (matched) return matched.labelAr;
    switch (cat) {
      case 'smart_links':
        return 'رابط ذكي';
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

  // Merge standalone active surveys into unified TaskVisualCard list
  const combinedTasks = useMemo<TaskItem[]>(() => {
    const linkedSurveyIds = new Set(
      tasks
        .map((t) => t.linkedSurveyId || t.taskMeta?.linkedSurveyId || t.taskMeta?.fields?.linkedSurveyId)
        .filter(Boolean)
    );
    const surveyCards: TaskItem[] = surveys
      .filter((s) => s.status === 'active' && !s.linkedTaskId && !linkedSurveyIds.has(s.id))
      .map((s) => ({
        id: `survey-${s.id}`,
        linkedSurveyId: s.id,
        title: s.title,
        description: s.description || `استبيان متسلسل مكون من ${s.questions.length} أسئلة تفاعلية.`,
        category: 'surveys',
        taskKind: 'surveys',
        isFeatured: s.isFeatured,
        sortOrder: s.sortOrder,
        imageUrl: s.imageUrl || SUPABASE_TASK_ASSET_URLS.surveys,
        cardTheme: s.isFeatured ? 'emerald' : 'indigo',
        badgeLabel: s.isFeatured ? 'مهمة مميزة' : 'استبيان تفاعلي',
        isVerifiedAdvertiser: true,
        rewardYer: s.rewardYer,
        steps: s.questions.map((q) => q.questionText),
        proofRequirements: { requireImage: false, requireText: false },
        timeEstimateMinutes: s.estimatedMinutes || 5,
        totalQuantity: s.maxParticipants || 100,
        completedQuantity: s.completedParticipants || 0,
        maxPerUser: s.maxAttemptsPerUser || 1,
        userAttemptsCount: s.userAttemptsCount || 0,
        budgetYer: 0,
        budgetSpentYer: 0,
        status: s.completedParticipants >= s.maxParticipants ? 'COMPLETED' : 'ACTIVE',
        advertiserDisplayName: 'مصدّق من المعلن',
        locationLabel: 'عن بُعد',
        createdAt: s.createdAt,
      }));

    return [...tasks, ...surveyCards];
  }, [tasks, surveys]);

  const displayedTasks = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase();
    const filtered = combinedTasks.filter((item) => {
      const kind = item.taskKind || item.taskMeta?.taskKind || inferTaskKindFromCategory(item.category);
      const isFeat = Boolean(item.isFeatured || item.taskMeta?.isFeatured);

      if (selectedCategory === 'favorites') {
        if (!favoriteIds.includes(item.id)) return false;
      } else if (selectedCategory === 'smart_links') {
        if (item.category !== 'smart_links' && kind !== 'smart_links') return false;
      } else if (selectedCategory !== 'all') {
        if (item.category !== selectedCategory) return false;
      }

      if (qLower) {
        const hay = `${item.title} ${item.description} ${item.providerName || ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }

      if (quickFilter === 'featured') return isFeat;
      if (quickFilter === 'popular') return (item.completedQuantity || 0) > 0 || (item.totalQuantity || 0) >= 50;
      if (quickFilter === 'quick') return (item.timeEstimateMinutes || 10) <= 5 || kind === 'quick_tasks' || kind === 'ad_watch';
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aFeat = a.isFeatured || a.taskMeta?.isFeatured ? 1 : 0;
      const bFeat = b.isFeatured || b.taskMeta?.isFeatured ? 1 : 0;
      if (aFeat !== bFeat) return bFeat - aFeat;

      const aSort = Number(a.sortOrder ?? a.taskMeta?.sortOrder ?? 0);
      const bSort = Number(b.sortOrder ?? b.taskMeta?.sortOrder ?? 0);
      if (aSort !== bSort) return aSort - bSort;

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
  }, [combinedTasks, selectedCategory, quickFilter, favoriteIds, searchQuery]);

  const quickPills = useMemo(() => {
    const catBySlug = new Map(categories.map((c) => [c.slug, c]));
    return [
      {
        id: 'all' as QuickFilterType,
        label: catBySlug.get('all')?.labelAr || 'جميع المهام',
        iconUrl: catBySlug.get('all')?.iconUrl || SUPABASE_TASK_ASSET_URLS.cat_all,
      },
      {
        id: 'popular' as QuickFilterType,
        label: catBySlug.get('popular')?.labelAr || 'الأكثر شعبية',
        iconUrl: catBySlug.get('popular')?.iconUrl || SUPABASE_TASK_ASSET_URLS.cat_popular,
      },
      {
        id: 'quick' as QuickFilterType,
        label: catBySlug.get('quick')?.labelAr || 'المهام السريعة',
        iconUrl: catBySlug.get('quick')?.iconUrl || SUPABASE_TASK_ASSET_URLS.cat_quick,
      },
      {
        id: 'featured' as QuickFilterType,
        label: catBySlug.get('featured')?.labelAr || 'مميزة',
        iconUrl: catBySlug.get('featured')?.iconUrl || SUPABASE_TASK_ASSET_URLS.cat_featured,
      },
    ];
  }, [categories]);

  return (
    <div className="space-y-5">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            المهام المتاحة للكسب اليوم
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            اختر المهمة أو الاستبيان أو الرابط الذكي المناسب، واكسب المكافأة بالريال اليمني.
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

      {/* Top Quick Filter Pills with Uploaded Supabase Icons */}
      <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
        {quickPills.map((pill) => {
          const active = quickFilter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setQuickFilter(pill.id)}
              className={`min-h-[42px] px-4 py-1.5 rounded-full text-xs font-extrabold border transition-all whitespace-nowrap inline-flex items-center gap-2 shrink-0 ${
                active
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-emerald-500/60'
              }`}
            >
              <img
                src={pill.iconUrl}
                alt={pill.label}
                className="w-5 h-5 rounded-full object-cover border border-white/60 shrink-0"
              />
              <span>{pill.label}</span>
            </button>
          );
        })}
      </div>

      {/* Category Filter Strip with Uploaded Supabase Icons */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 p-1.5 bg-slate-100/90 dark:bg-slate-800/80 rounded-2xl no-scrollbar">
        {categoryTabs.map((tab) => {
          const active = selectedCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedCategory(tab.id)}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-2 ${
                active
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm ring-1 ring-emerald-500/20'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <img
                src={tab.iconUrl}
                alt={tab.label}
                className="w-4 h-4 rounded-full object-cover shrink-0"
              />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Cascading Arab Country & Division Filter */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
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

      {/* Visual Task Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-60 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-800"
            />
          ))}
        </div>
      ) : displayedTasks.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8">
          <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            لا توجد مهام مطابقة حالياً
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            جرب اختيار تصنيف آخر أو تفقد المنصة لاحقاً حيث يتم إضافة مهام واستبيانات جديدة على مدار اليوم.
          </p>
          <button
            type="button"
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {displayedTasks.map((task, index) => (
            <React.Fragment key={task.id}>
              <TaskVisualCard
                task={task}
                isFavorited={favoriteIds.includes(task.id) || Boolean(task.isFavorited)}
                onStart={handleStartTask}
                onInfo={handleInfoTask}
                onToggleFavorite={toggleFavorite}
              />

              {(index + 1) % 2 === 0 && (
                <AdsterraAd
                  placementId={`tasks_between_${index + 1}`}
                  className="col-span-full"
                />
              )}
            </React.Fragment>
          ))}
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

      {/* Info Modal for Smart Links & Sequential Surveys */}
      {infoModalTask && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setInfoModalTask(null)}
        >
          <div
            dir="rtl"
            className="relative w-full sm:max-w-lg max-h-[90vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
              <div className="flex items-center gap-2.5 min-w-0">
                {infoModalTask.taskKind === 'smart_links' ? (
                  <Link2 className="w-5 h-5 text-teal-600 shrink-0" />
                ) : (
                  <ClipboardList className="w-5 h-5 text-emerald-600 shrink-0" />
                )}
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                  {infoModalTask.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoModalTask(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 text-center">
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1">
                    <Coins className="w-3 h-3" />
                    <span>المكافأة</span>
                  </span>
                  <span className="text-sm font-extrabold font-mono text-amber-600 dark:text-amber-400">
                    {formatYer(infoModalTask.rewardYer)} ر.ي
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    <span>الوقت</span>
                  </span>
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                    {infoModalTask.timeEstimateMinutes} د
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
                    <Users className="w-3 h-3 text-emerald-600" />
                    <span>المتبقي</span>
                  </span>
                  <span className="text-sm font-extrabold font-mono text-emerald-700 dark:text-emerald-400">
                    {Math.max(0, infoModalTask.totalQuantity - infoModalTask.completedQuantity)} / {infoModalTask.totalQuantity}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                <div className="font-extrabold text-slate-900 dark:text-white">تفاصيل وشروط المهمة:</div>
                <p>{infoModalTask.description}</p>
                {infoModalTask.taskMeta?.fields?.smartLinkInstructions && (
                  <p className="text-teal-700 dark:text-teal-300 font-semibold">
                    {infoModalTask.taskMeta.fields.smartLinkInstructions}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const target = infoModalTask;
                  setInfoModalTask(null);
                  handleStartTask(target);
                }}
                className="w-full min-h-[46px] px-5 py-3 rounded-2xl bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-extrabold text-sm shadow-md flex items-center justify-center gap-2"
              >
                <span>{infoModalTask.taskKind === 'smart_links' ? 'الانتقال لبدء العرض' : 'بدء الاستبيان الآن'}</span>
                <ChevronsLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Link Postback-Verified Launch Modal */}
      {activeSmartLinkTask && (
        <SmartLinkModal
          task={activeSmartLinkTask}
          onClose={() => setActiveSmartLinkTask(null)}
          onAttemptStarted={() => loadTasks()}
        />
      )}

      {/* Interactive Sequential Survey Runner Modal */}
      {activeSurveyId && (
        <SurveyRunnerModal
          surveyId={activeSurveyId}
          onClose={() => setActiveSurveyId(null)}
          onCompleted={() => loadTasks()}
        />
      )}
    </div>
  );
};
