import React from 'react';
import {
  Clock,
  MapPin,
  ShieldCheck,
  Coins,
  Users,
  Star,
  Info,
  ChevronsLeft,
  Crown,
  Zap,
  ClipboardList,
  Smartphone,
  PlaySquare,
  Globe,
  Link2,
  Building2,
  UserPlus,
  Heart,
  UserCheck,
  FileCheck2,
  Sparkles,
} from 'lucide-react';
import type { TaskCardTheme, TaskItem, TaskKind } from '../../types/index.ts';
import { formatYer } from '../../../shared/money.ts';
import {
  TASK_KIND_OPTIONS,
  getDefaultTaskImageUrl,
  getDifficultyMeta,
  getTaskKindLabel,
  inferTaskKindFromCategory,
  isNewTaskWithin48Hours,
  toCanonicalTaskKind,
} from '../../../shared/taskMeta.ts';
import { SecureImageView } from '../common/SecureImageView.tsx';

const THEME_STYLES: Record<
  TaskCardTheme,
  {
    border: string;
    glow: string;
    pill: string;
    accentBar: string;
    badge: string;
    cta: string;
  }
> = {
  emerald: {
    border: 'border-emerald-200/90 dark:border-emerald-800/70 hover:border-emerald-400',
    glow: 'from-emerald-50/70 via-white to-white dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-emerald-600 text-white',
    accentBar: 'border-emerald-500',
    badge: 'bg-gradient-to-l from-emerald-600 to-emerald-500 text-white',
    cta: 'bg-gradient-to-l from-emerald-700 via-emerald-600 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600 text-white shadow-emerald-600/20',
  },
  indigo: {
    border: 'border-indigo-200/90 dark:border-indigo-800/70 hover:border-indigo-400',
    glow: 'from-indigo-50/70 via-white to-white dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-indigo-600 text-white',
    accentBar: 'border-indigo-500',
    badge: 'bg-gradient-to-l from-indigo-600 to-violet-600 text-white',
    cta: 'bg-gradient-to-l from-emerald-700 via-emerald-600 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600 text-white shadow-emerald-600/20',
  },
  teal: {
    border: 'border-teal-200/90 dark:border-teal-800/70 hover:border-teal-400',
    glow: 'from-teal-50/70 via-white to-white dark:from-teal-950/30 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-teal-600 text-white',
    accentBar: 'border-teal-500',
    badge: 'bg-gradient-to-l from-teal-600 to-cyan-600 text-white',
    cta: 'bg-gradient-to-l from-teal-700 via-emerald-600 to-emerald-500 hover:from-teal-800 hover:to-emerald-600 text-white shadow-teal-600/20',
  },
  amber: {
    border: 'border-amber-300/90 dark:border-amber-700/70 hover:border-amber-400',
    glow: 'from-amber-50/70 via-white to-white dark:from-amber-950/25 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-amber-600 text-white',
    accentBar: 'border-amber-500',
    badge: 'bg-gradient-to-l from-amber-500 to-yellow-500 text-slate-950',
    cta: 'bg-gradient-to-l from-emerald-700 via-emerald-600 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600 text-white shadow-emerald-600/20',
  },
  rose: {
    border: 'border-rose-200/90 dark:border-rose-800/70 hover:border-rose-400',
    glow: 'from-rose-50/70 via-white to-white dark:from-rose-950/25 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-rose-600 text-white',
    accentBar: 'border-rose-500',
    badge: 'bg-gradient-to-l from-rose-600 to-pink-600 text-white',
    cta: 'bg-gradient-to-l from-emerald-700 via-emerald-600 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600 text-white shadow-emerald-600/20',
  },
  slate: {
    border: 'border-slate-300 dark:border-slate-700 hover:border-emerald-500',
    glow: 'from-slate-100/80 via-white to-white dark:from-slate-800/60 dark:via-slate-900 dark:to-slate-900',
    pill: 'bg-slate-800 text-white',
    accentBar: 'border-slate-700 dark:border-slate-500',
    badge: 'bg-slate-900 text-white',
    cta: 'bg-gradient-to-l from-emerald-700 via-emerald-600 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600 text-white shadow-emerald-600/20',
  },
};

function getKindIcon(kind: TaskKind, category?: string) {
  if (kind === 'smart_links') return <Link2 className="w-3.5 h-3.5" />;
  const canonical = toCanonicalTaskKind(kind, category);
  switch (canonical) {
    case 'surveys':
      return <ClipboardList className="w-3.5 h-3.5" />;
    case 'video_watch':
      return <PlaySquare className="w-3.5 h-3.5" />;
    case 'website_visit':
      return <Globe className="w-3.5 h-3.5" />;
    case 'social_follow':
      return <UserCheck className="w-3.5 h-3.5" />;
    case 'social_engagement':
      return <Heart className="w-3.5 h-3.5" />;
    case 'app_testing':
      return <Smartphone className="w-3.5 h-3.5" />;
    case 'account_signup':
      return <UserPlus className="w-3.5 h-3.5" />;
    case 'custom_proof':
      return <FileCheck2 className="w-3.5 h-3.5" />;
    default:
      return <Zap className="w-3.5 h-3.5" />;
  }
}

function getStartButtonLabel(kind: TaskKind, category?: string): string {
  if (kind === 'smart_links') return 'ابدأ العرض الآن';
  const canonical = toCanonicalTaskKind(kind, category);
  switch (canonical) {
    case 'surveys':
      return 'بدء الاستبيان';
    case 'video_watch':
      return 'مشاهدة الفيديو';
    case 'website_visit':
      return 'زيارة الرابط الآن';
    case 'social_follow':
      return 'متابعة الحساب';
    case 'social_engagement':
      return 'تنفيذ التفاعل';
    case 'app_testing':
      return 'تحميل وتجربة';
    case 'account_signup':
      return 'التسجيل وتنفيذ المهمة';
    default:
      return 'بدء المهمة الآن';
  }
}

interface TaskVisualCardProps {
  task: TaskItem;
  isFavorited?: boolean;
  isPreview?: boolean;
  onStart: (task: TaskItem) => void;
  onInfo: (task: TaskItem) => void;
  onToggleFavorite?: (taskId: string) => void;
}

export const TaskVisualCard: React.FC<TaskVisualCardProps> = ({
  task,
  isFavorited = false,
  isPreview = false,
  onStart,
  onInfo,
  onToggleFavorite,
}) => {
  const taskKind: TaskKind =
    task.taskKind || task.taskMeta?.taskKind || inferTaskKindFromCategory(task.category);
  const canonicalKind = toCanonicalTaskKind(taskKind, task.category);
  const defaultKindOpt = TASK_KIND_OPTIONS.find((o) => o.kind === canonicalKind);
  const themeKey: TaskCardTheme =
    task.cardTheme ||
    task.taskMeta?.cardTheme ||
    (task.isFeatured ? 'emerald' : defaultKindOpt?.defaultTheme || 'indigo');
  const style = THEME_STYLES[themeKey] || THEME_STYLES.emerald;

  const isFeatured = Boolean(task.isFeatured || task.taskMeta?.isFeatured);
  const isNew = isNewTaskWithin48Hours(task.createdAt);
  const difficultyMeta = getDifficultyMeta(task.difficulty || task.taskMeta?.difficulty);
  const remaining = Math.max(0, Number(task.totalQuantity || 0) - Number(task.completedQuantity || 0));
  const isAvailable = task.status === 'ACTIVE' && remaining > 0;
  const typeLabel = getTaskKindLabel(taskKind, task.category);

  const imageUrl =
    task.imageUrl ||
    task.taskMeta?.imageUrl ||
    getDefaultTaskImageUrl(taskKind, isFeatured, task.category);

  const badgeText =
    task.badgeLabel ||
    task.taskMeta?.badgeLabel ||
    (isFeatured ? 'مهمة مميزة' : taskKind === 'smart_links' ? 'رابط ذكي' : defaultKindOpt?.defaultBadgeLabel || typeLabel);

  const isSmartLink = taskKind === 'smart_links' || Boolean(task.taskMeta?.fields?.useSmartLinkPostback);
  const providerLogo = task.providerLogoUrl || task.taskMeta?.fields?.providerLogoUrl;
  const userAttempts = Number(task.userAttemptsCount || 0);
  const maxPerUser = Math.max(1, Number(task.maxPerUser || 1));

  // Only show verified advertiser badge when genuinely verified (never fake for hidden/anonymous advertisers)
  const isVerifiedAdvertiser =
    task.isVerifiedAdvertiser !== undefined
      ? task.isVerifiedAdvertiser
      : !task.isExternalCampaign ||
        Boolean(
          !task.hideAdvertiserName &&
            task.advertiserDisplayName &&
            task.advertiserDisplayName !== 'معلن عبر يمن تاسك'
        );

  const locationText =
    task.locationLabel ||
    task.countryNameAr ||
    (task.isNationwide !== false ? 'عن بُعد' : 'منطقة محددة');

  return (
    <article
      dir="rtl"
      className={`group relative rounded-3xl bg-gradient-to-br ${style.glow} border ${
        isFeatured ? 'border-emerald-400/90 dark:border-emerald-600 ring-1 ring-emerald-400/20' : style.border
      } shadow-[0_8px_30px_rgb(15,23,42,0.06)] hover:shadow-[0_14px_38px_rgb(5,150,105,0.12)] transition-all duration-300 overflow-hidden p-4 sm:p-5 flex flex-col justify-between gap-4`}
    >
      {/* Top Content Area: Text on Right (RTL), Illustration on Left (RTL) */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch justify-between gap-4">
        {/* Right Column (Metadata Badges, Title, Description, 3-Tile Stats) */}
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
          {/* Top Metadata Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/70 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 max-w-[140px] truncate">
              <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
              <span className="truncate">{locationText}</span>
            </span>

            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50/80 dark:bg-slate-800 border border-emerald-200/60 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">
              <Clock className="w-3 h-3 text-emerald-600 shrink-0" />
              <span>{Math.max(1, Number(task.timeEstimateMinutes || 10))} د</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold shadow-sm ${style.pill}`}
              style={task.badgeColor ? { backgroundColor: task.badgeColor } : undefined}
            >
              {getKindIcon(taskKind, task.category)}
              <span>{typeLabel}</span>
            </span>

            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${difficultyMeta.badgeClass}`}
            >
              {difficultyMeta.labelAr}
            </span>

            {isNew && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[10px] font-extrabold">
                <Sparkles className="w-2.5 h-2.5" />
                <span>جديدة</span>
              </span>
            )}
          </div>

          {/* Title & Vertical Bar Description */}
          <div className="space-y-2">
            <h3 className="text-base sm:text-[17px] font-extrabold text-slate-900 dark:text-white leading-snug line-clamp-2">
              {task.title || 'عنوان المهمة'}
            </h3>

            <p
              className={`text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 border-r-[3px] ${style.accentBar} pr-2.5`}
            >
              {task.description || 'تفاصيل وتعليمات المهمة للمنفذين.'}
            </p>
          </div>

          {/* 3-Tile Info Strip (Verified / Reward / Remaining or SmartLink Quota) */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {/* Tile 1: Verified Advertiser or Neutral Partner Label */}
            <div className="rounded-2xl bg-slate-50/90 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 px-2.5 py-2 flex items-center justify-center gap-1.5 text-center">
              {isVerifiedAdvertiser ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-[10px] sm:text-[11px] font-extrabold text-slate-800 dark:text-slate-200 leading-tight">
                    مصدّق من المعلن
                  </span>
                </>
              ) : (
                <>
                  {task.advertiserLogoUrl && !task.hideAdvertiserName ? (
                    <SecureImageView
                      storagePathOrUrl={task.advertiserLogoUrl}
                      alt="شعار المعلن"
                      className="w-4 h-4 rounded object-cover shrink-0"
                    />
                  ) : (
                    <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 leading-tight truncate">
                    {task.hideAdvertiserName ? 'معلن عبر المنصة' : task.advertiserDisplayName || 'حملة معلن'}
                  </span>
                </>
              )}
            </div>

            {/* Tile 2: Reward in 6-decimal YER */}
            <div className="rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-900/50 px-2.5 py-2 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Coins className="w-3 h-3 text-amber-500" />
                <span>المكافأة</span>
              </span>
              <span className="text-xs sm:text-sm font-extrabold font-mono tabular-nums text-emerald-700 dark:text-amber-400 leading-tight mt-0.5">
                {formatYer(task.rewardYer)} <span className="text-[10px] font-bold">ر.ي</span>
              </span>
            </div>

            {/* Tile 3: Remaining Slots OR Smart Link User Attempts */}
            <div className="rounded-2xl bg-slate-50/90 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 px-2.5 py-2 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Users className="w-3 h-3 text-emerald-600" />
                <span>{isSmartLink ? `محاولات ${userAttempts}/${maxPerUser}` : 'المتبقي'}</span>
              </span>
              <span className="text-xs sm:text-sm font-extrabold font-mono tabular-nums text-slate-900 dark:text-white leading-tight mt-0.5">
                {remaining} <span className="text-[10px] font-semibold text-slate-500">من {task.totalQuantity}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Left Column: Visual Artwork Container with Top-Left Ribbon Badge */}
        <div className="relative w-full sm:w-[155px] md:w-[170px] h-36 sm:h-auto sm:min-h-[168px] shrink-0 rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800 shadow-inner">
          <img
            src={imageUrl}
            alt={task.title || typeLabel}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-transparent pointer-events-none" />

          {/* Overlapping Top-Left Ribbon Badge */}
          <div
            className={`absolute top-2.5 left-2.5 px-2.5 py-1 rounded-xl text-[10px] font-extrabold shadow-md inline-flex items-center gap-1 ${
              isFeatured
                ? 'bg-gradient-to-l from-emerald-600 to-emerald-500 text-white'
                : style.badge
            }`}
          >
            {isFeatured ? <Crown className="w-3 h-3 text-amber-300" /> : getKindIcon(taskKind, task.category)}
            <span>{badgeText}</span>
          </div>

          {/* Optional Provider Logo Overlay for Smart Links */}
          {isSmartLink && providerLogo && (
            <div className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl bg-white dark:bg-slate-900 p-0.5 shadow-md border border-white/80 overflow-hidden">
              <img
                src={providerLogo}
                alt={task.providerName || 'مزوّد العرض'}
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => !isPreview && onStart(task)}
          disabled={!isPreview && !isAvailable}
          className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold shadow-md transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${style.cta}`}
        >
          <span>
            {!isAvailable && !isPreview ? 'مكتملة حالياً' : getStartButtonLabel(taskKind, task.category)}
          </span>
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => !isPreview && onToggleFavorite?.(task.id)}
          title={isFavorited ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          aria-label={isFavorited ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          className={`min-h-[44px] px-3.5 py-2 rounded-2xl border text-xs font-bold transition-colors inline-flex items-center gap-1.5 shrink-0 ${
            isFavorited
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-amber-400'
          }`}
        >
          <Star className={`w-4 h-4 ${isFavorited ? 'fill-amber-500 text-amber-500' : ''}`} />
          <span className="hidden sm:inline">{isFavorited ? 'في المفضلة' : 'إضافة للمفضلة'}</span>
        </button>

        <button
          type="button"
          onClick={() => !isPreview && onInfo(task)}
          title="معلومات المهمة"
          aria-label="معلومات المهمة"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-emerald-500 hover:text-emerald-600 transition-colors shrink-0"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
};

