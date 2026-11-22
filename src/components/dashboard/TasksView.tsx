import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, NetworkOfflineError } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SurveyItem, TaskCategoryItem, TaskDifficulty, TaskItem } from '../../types/index.ts';
import {
  Search,
  Clock,
  X,
  FileText,
  AlertCircle,
  WifiOff,
  Coins,
  Users,
  ChevronsLeft,
  ClipboardList,
  Link2,
  SlidersHorizontal,
} from 'lucide-react';
import { AdsterraAd } from '../ads/AdsterraAd.tsx';
import { GeoLocationSelector, type GeoFilterValue } from '../common/GeoLocationSelector.tsx';
import { formatYer } from '../../../shared/money.ts';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';
import {
  SUPABASE_TASK_ASSET_URLS,
  TASK_DIFFICULTY_OPTIONS,
  TASK_KIND_OPTIONS,
  inferTaskKindFromCategory,
  toCanonicalTaskKind,
} from '../../../shared/taskMeta.ts';
import { TaskVisualCard } from '../tasks/TaskVisualCard.tsx';
import { SmartLinkModal } from '../tasks/SmartLinkModal.tsx';
import { SurveyRunnerModal } from '../tasks/SurveyRunnerModal.tsx';
import { TaskExecutionModal } from '../tasks/TaskExecutionModal.tsx';
import { EmailVerificationBanner } from '../common/EmailVerificationBanner.tsx';

type QuickFilterType = 'all' | 'featured' | 'popular' | 'quick';
type SortOptionType = 'recommended' | 'newest' | 'reward_desc' | 'quickest';

interface TasksViewProps {
  onGoToSubmissions: () => void;
  onGoToWallet: () => void;
  initialCategory?: string;
}

export const TasksView: React.FC<TasksViewProps> = ({ initialCategory }) => {
  const { isOnline } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'all');
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | TaskDifficulty>('all');
  const [sortBy, setSortBy] = useState<SortOptionType>('recommended');
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

  // Modal state for dynamic task execution, info sheet, smart links, and sequential surveys
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [infoModalTask, setInfoModalTask] = useState<TaskItem | null>(null);
  const [activeSmartLinkTask, setActiveSmartLinkTask] = useState<TaskItem | null>(null);
  const [activeSurveyId, setActiveSurveyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load categories & synced favorites with instant IndexedDB Stale-While-Revalidate
  useEffect(() => {
    let cancelled = false;
    getCacheItem<TaskCategoryItem[]>('task_categories_v1')
      .then((cached) => {
        if (!cancelled && cached?.value?.length) setCategories(cached.value);
      })
      .catch(() => {});

    getCacheItem<string[]>('task_favorites')
      .then((cached) => {
        if (!cancelled && Array.isArray(cached?.value)) setFavoriteIds(cached.value);
      })
      .catch(() => {});

    api
      .getTaskCategories()
      .then((res) => {
        if (!cancelled && Array.isArray(res.categories)) {
          setCategories(res.categories);
          saveCacheItem('task_categories_v1', res.categories).catch(() => {});
        }
      })
      .catch(() => {});

    api
      .getFavoriteTaskIds()
      .then((res) => {
        if (!cancelled && Array.isArray(res.favoriteIds)) {
          setFavoriteIds(res.favoriteIds);
          saveCacheItem('task_favorites', res.favoriteIds).catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
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
    setLoadError(null);
    const cacheKey = `tasks_list_all_${geoFilter.countryId || 'all'}`;

    // Stale-While-Revalidate Step 1: Hydrate cached tasks & surveys immediately for instant paint
    let hydratedFromCache = false;
    try {
      const [specificCache, fallbackAll, cachedSurveys] = await Promise.all([
        getCacheItem<TaskItem[]>(cacheKey),
        getCacheItem<TaskItem[]>('tasks_list_all_all'),
        getCacheItem<SurveyItem[]>('surveys_list_v1'),
      ]);
      const bestTasksCache = specificCache?.value?.length ? specificCache : fallbackAll;
      if (bestTasksCache && Array.isArray(bestTasksCache.value) && bestTasksCache.value.length > 0) {
        setTasks(filterClientFallback(bestTasksCache.value));
        setCacheUpdatedAt(bestTasksCache.updatedAt);
        hydratedFromCache = true;
      }
      if (cachedSurveys?.value?.length) {
        setSurveys(cachedSurveys.value);
        hydratedFromCache = true;
      }
    } catch {
      // Ignore IndexedDB read errors and proceed to network
    }

    // Only show blocking skeleton if no cached data was available
    setIsLoading(!hydratedFromCache);

    // Stale-While-Revalidate Step 2: Revalidate silently in background from server
    try {
      const [res, surveysRes] = await Promise.all([
        api.getTasks({
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
      if (hydratedFromCache) {
        setIsStaleOfflineCache(true);
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
  };

  const handleStartTask = (task: TaskItem) => {
    const kind = task.taskKind || task.taskMeta?.taskKind || inferTaskKindFromCategory(task.category);
    if (kind === 'smart_links' || Boolean(task.taskMeta?.fields?.useSmartLinkPostback)) {
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
    if (kind === 'smart_links' || Boolean(task.taskMeta?.fields?.useSmartLinkPostback) || linkedSurvey) {
      setInfoModalTask(task);
      return;
    }
    handleOpenProofTask(task);
  };

  const categoryTabs = useMemo(() => {
    const catBySlug = new Map(categories.map((c) => [c.slug, c]));
    const base = [
      { id: 'all', label: 'كافة المهام', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_all },
      ...TASK_KIND_OPTIONS.map((opt) => ({
        id: opt.kind,
        label: opt.labelAr,
        iconUrl: opt.defaultImageUrl,
      })),
      { id: 'smart_links', label: 'الروابط الذكية', iconUrl: SUPABASE_TASK_ASSET_URLS.smart_links },
    ];
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
        difficulty: 'easy',
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
      const rawKind = item.taskKind || item.taskMeta?.taskKind || inferTaskKindFromCategory(item.category);
      const canonical = toCanonicalTaskKind(rawKind, item.category);
      const isFeat = Boolean(item.isFeatured || item.taskMeta?.isFeatured);
      const itemDiff = item.difficulty || item.taskMeta?.difficulty || 'easy';

      if (selectedCategory === 'favorites') {
        if (!favoriteIds.includes(item.id)) return false;
      } else if (selectedCategory === 'smart_links') {
        if (item.category !== 'smart_links' && rawKind !== 'smart_links' && !item.taskMeta?.fields?.useSmartLinkPostback) {
          return false;
        }
      } else if (selectedCategory !== 'all') {
        const isCanonicalMatch = canonical === selectedCategory;
        const isCategoryMatch = item.category === selectedCategory;
        if (!isCanonicalMatch && !isCategoryMatch) return false;
      }

      if (difficultyFilter !== 'all' && itemDiff !== difficultyFilter) {
        return false;
      }

      if (qLower) {
        const hay = `${item.title} ${item.description} ${item.providerName || ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }

      if (quickFilter === 'featured') return isFeat;
      if (quickFilter === 'popular') return (item.completedQuantity || 0) > 0 || (item.totalQuantity || 0) >= 50;
      if (quickFilter === 'quick') return (item.timeEstimateMinutes || 10) <= 5 || rawKind === 'quick_tasks' || canonical === 'video_watch';
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === 'reward_desc') {
        return Number(b.rewardYer || 0) - Number(a.rewardYer || 0);
      }
      if (sortBy === 'quickest') {
        return Number(a.timeEstimateMinutes || 10) - Number(b.timeEstimateMinutes || 10);
      }

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
  }, [combinedTasks, selectedCategory, quickFilter, difficultyFilter, sortBy, favoriteIds, searchQuery]);

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
      <EmailVerificationBanner contextLabel="قبل إرسال إثباتات المهام واستلام المكافآت" />
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

      {/* Cascading Arab Country & Division Filter + Difficulty & Sort Controls */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <GeoLocationSelector
          mode="filter"
          countryId={geoFilter.countryId}
          divisionId={geoFilter.divisionId}
          onChange={setGeoFilter}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 inline-flex items-center gap-1 ml-1">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>الصعوبة:</span>
            </span>
            <button
              type="button"
              onClick={() => setDifficultyFilter('all')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                difficultyFilter === 'all'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              الكل
            </button>
            {TASK_DIFFICULTY_OPTIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDifficultyFilter(d.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  difficultyFilter === d.id
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {d.labelAr}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-bold text-slate-500">ترتيب:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOptionType)}
              className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <option value="recommended">الموصى به (المميز أولاً)</option>
              <option value="newest">الأحدث إضافة</option>
              <option value="reward_desc">الأعلى مكافأة</option>
              <option value="quickest">الأقصر مدة</option>
            </select>
          </div>
        </div>
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

      {/* Dynamic Multi-Type Task Execution & Proof Modal */}
      {activeTask && (
        <TaskExecutionModal
          task={activeTask}
          onClose={() => setActiveTask(null)}
          onSubmitted={() => loadTasks()}
        />
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
