import type {
  TaskBuilderMeta,
  TaskCardTheme,
  TaskCategory,
  TaskKind,
} from '../src/types/index.js';

export const SUPABASE_TASK_ASSET_URLS = {
  featured: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_featured_emerald.jpg',
  surveys: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_survey_art.jpg',
  smart_links: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_smartlink_art.jpg',
  quick_tasks: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_quick_violet.jpg',
  app_testing: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_app_testing.jpg',
  external_offers: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_external_offers.jpg',
  ad_watch: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_featured_emerald.jpg',
  cat_all: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_all.jpg',
  cat_popular: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_popular.jpg',
  cat_quick: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_quick.jpg',
  cat_featured: 'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_featured.jpg',
} as const;

export const TASK_KIND_OPTIONS: Array<{
  kind: TaskKind;
  labelAr: string;
  subtitleAr: string;
  defaultCategory: TaskCategory;
  defaultTheme: TaskCardTheme;
  defaultBadgeLabel: string;
  defaultImageUrl: string;
}> = [
  {
    kind: 'surveys',
    labelAr: 'استبيان',
    subtitleAr: 'استطلاع تفاعلي متسلسل',
    defaultCategory: 'surveys',
    defaultTheme: 'emerald',
    defaultBadgeLabel: 'استبيان',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.surveys,
  },
  {
    kind: 'smart_links',
    labelAr: 'الروابط الذكية',
    subtitleAr: 'تحقق آلي عبر Postback',
    defaultCategory: 'smart_links',
    defaultTheme: 'teal',
    defaultBadgeLabel: 'رابط ذكي',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.smart_links,
  },
  {
    kind: 'ad_watch',
    labelAr: 'مشاهدة إعلان',
    subtitleAr: 'رابط إعلان ومدة مشاهدة',
    defaultCategory: 'social_engagement',
    defaultTheme: 'amber',
    defaultBadgeLabel: 'إعلان',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.ad_watch,
  },
  {
    kind: 'app_testing',
    labelAr: 'تجربة تطبيق',
    subtitleAr: 'رابط تحميل وخطوات اختبار',
    defaultCategory: 'app_testing',
    defaultTheme: 'indigo',
    defaultBadgeLabel: 'تطبيقات وألعاب',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.app_testing,
  },
  {
    kind: 'quick_tasks',
    labelAr: 'مهمة سريعة',
    subtitleAr: 'خطوات بسيطة وإثبات فوري',
    defaultCategory: 'data_entry',
    defaultTheme: 'indigo',
    defaultBadgeLabel: 'مهمة سريعة',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.quick_tasks,
  },
  {
    kind: 'external_offers',
    labelAr: 'عرض خارجي',
    subtitleAr: 'شريك وعرض مع شروط واضحة',
    defaultCategory: 'local_services',
    defaultTheme: 'emerald',
    defaultBadgeLabel: 'عرض شريك',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.external_offers,
  },
];

export const TASK_CARD_THEMES: Array<{
  id: TaskCardTheme;
  labelAr: string;
  swatchClass: string;
}> = [
  { id: 'emerald', labelAr: 'زمردي رسمي', swatchClass: 'bg-emerald-600' },
  { id: 'indigo', labelAr: 'نيلي بنفسجي', swatchClass: 'bg-indigo-600' },
  { id: 'teal', labelAr: 'تركواز ذكي', swatchClass: 'bg-teal-600' },
  { id: 'amber', labelAr: 'ذهبي مميز', swatchClass: 'bg-amber-500' },
  { id: 'rose', labelAr: 'ياقوتي', swatchClass: 'bg-rose-600' },
  { id: 'slate', labelAr: 'داكن احترافي', swatchClass: 'bg-slate-800' },
];

export function inferTaskKindFromCategory(category?: string | null): TaskKind {
  switch (category) {
    case 'surveys':
      return 'surveys';
    case 'smart_links':
      return 'smart_links';
    case 'app_testing':
      return 'app_testing';
    case 'social_engagement':
      return 'ad_watch';
    case 'local_services':
      return 'external_offers';
    default:
      return 'quick_tasks';
  }
}

export function getTaskKindLabel(kind?: TaskKind | string | null, fallbackCategory?: string | null): string {
  const effectiveKind =
    kind && TASK_KIND_OPTIONS.some((o) => o.kind === kind)
      ? (kind as TaskKind)
      : inferTaskKindFromCategory(fallbackCategory);
  return TASK_KIND_OPTIONS.find((o) => o.kind === effectiveKind)?.labelAr || 'مهمة عامة';
}

export function getDefaultTaskImageUrl(kind?: TaskKind | string | null, isFeatured?: boolean, fallbackCategory?: string | null): string {
  const effectiveKind =
    kind && TASK_KIND_OPTIONS.some((o) => o.kind === kind)
      ? (kind as TaskKind)
      : inferTaskKindFromCategory(fallbackCategory);
  if (isFeatured && effectiveKind !== 'smart_links' && effectiveKind !== 'surveys') {
    return SUPABASE_TASK_ASSET_URLS.featured;
  }
  return TASK_KIND_OPTIONS.find((o) => o.kind === effectiveKind)?.defaultImageUrl || SUPABASE_TASK_ASSET_URLS.featured;
}

export function mapTaskKindToCategory(kind?: TaskKind | string | null, preferredCategory?: string | null): TaskCategory {
  const validCategories: TaskCategory[] = [
    'app_testing',
    'surveys',
    'social_engagement',
    'content_writing',
    'data_entry',
    'review_ratings',
    'local_services',
    'smart_links',
    'general',
  ];

  if (kind === 'smart_links') return 'smart_links';
  if (kind === 'surveys') return 'surveys';

  if (preferredCategory && validCategories.includes(preferredCategory as TaskCategory)) {
    return preferredCategory as TaskCategory;
  }

  const found = TASK_KIND_OPTIONS.find((o) => o.kind === kind);
  return found ? found.defaultCategory : 'app_testing';
}

export function sanitizeSafeImageUrl(raw?: string | null): string | undefined {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val || val.length > 1000) return undefined;
  if (/^https?:\/\/[^\s<>"']+$/i.test(val)) return val;
  return undefined;
}

export function sanitizeTaskBuilderMeta(input: any, fallbackCategory?: string | null): TaskBuilderMeta {
  const raw = input && typeof input === 'object' ? input : {};
  const validKinds: TaskKind[] = ['surveys', 'smart_links', 'ad_watch', 'app_testing', 'quick_tasks', 'external_offers'];
  const taskKind: TaskKind = validKinds.includes(raw.taskKind)
    ? raw.taskKind
    : inferTaskKindFromCategory(fallbackCategory);

  const validThemes: TaskCardTheme[] = ['emerald', 'indigo', 'amber', 'teal', 'rose', 'slate'];
  const defaultOpt = TASK_KIND_OPTIONS.find((o) => o.kind === taskKind);
  const cardTheme: TaskCardTheme = validThemes.includes(raw.cardTheme)
    ? raw.cardTheme
    : defaultOpt?.defaultTheme || 'emerald';

  const rawFields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};

  const questions = Array.isArray(rawFields.questions)
    ? rawFields.questions.map((q: any) => String(q || '').trim()).filter(Boolean).slice(0, 30)
    : [];

  const steps = Array.isArray(rawFields.steps)
    ? rawFields.steps.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 30)
    : [];

  return {
    taskKind,
    isFeatured: Boolean(raw.isFeatured),
    featuredRequested: Boolean(raw.featuredRequested),
    priority: Number.isFinite(Number(raw.priority)) ? Math.round(Number(raw.priority)) : raw.isFeatured ? 100 : 0,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Math.round(Number(raw.sortOrder)) : 0,
    imageUrl: sanitizeSafeImageUrl(raw.imageUrl),
    cardTheme,
    badgeLabel: raw.badgeLabel ? String(raw.badgeLabel).trim().slice(0, 40) : undefined,
    badgeColor: raw.badgeColor ? String(raw.badgeColor).trim().slice(0, 30) : undefined,
    linkedSurveyId: raw.linkedSurveyId ? String(raw.linkedSurveyId).trim().slice(0, 80) : rawFields.linkedSurveyId ? String(rawFields.linkedSurveyId).trim().slice(0, 80) : undefined,
    fields: {
      questions: questions.length > 0 ? questions : undefined,
      optionsText: rawFields.optionsText ? String(rawFields.optionsText).trim().slice(0, 1000) : undefined,
      linkedSurveyId: rawFields.linkedSurveyId ? String(rawFields.linkedSurveyId).trim().slice(0, 80) : undefined,
      adUrl: rawFields.adUrl ? String(rawFields.adUrl).trim().slice(0, 500) : undefined,
      watchDurationSeconds:
        rawFields.watchDurationSeconds !== undefined && Number(rawFields.watchDurationSeconds) > 0
          ? Math.min(3600, Math.round(Number(rawFields.watchDurationSeconds)))
          : undefined,
      completionRule: rawFields.completionRule ? String(rawFields.completionRule).trim().slice(0, 500) : undefined,
      appDownloadUrl: rawFields.appDownloadUrl ? String(rawFields.appDownloadUrl).trim().slice(0, 500) : undefined,
      testingInstructions: rawFields.testingInstructions
        ? String(rawFields.testingInstructions).trim().slice(0, 1000)
        : undefined,
      requiredProofNote: rawFields.requiredProofNote
        ? String(rawFields.requiredProofNote).trim().slice(0, 500)
        : undefined,
      steps: steps.length > 0 ? steps : undefined,
      proofNotes: rawFields.proofNotes ? String(rawFields.proofNotes).trim().slice(0, 500) : undefined,
      partnerName: rawFields.partnerName ? String(rawFields.partnerName).trim().slice(0, 120) : undefined,
      offerUrl: rawFields.offerUrl ? String(rawFields.offerUrl).trim().slice(0, 500) : undefined,
      offerConditions: rawFields.offerConditions ? String(rawFields.offerConditions).trim().slice(0, 1000) : undefined,
      providerName: rawFields.providerName ? String(rawFields.providerName).trim().slice(0, 120) : undefined,
      providerLogoUrl: sanitizeSafeImageUrl(rawFields.providerLogoUrl),
      trackingUrl: rawFields.trackingUrl ? String(rawFields.trackingUrl).trim().slice(0, 800) : undefined,
      postbackSecret: rawFields.postbackSecret ? String(rawFields.postbackSecret).trim().slice(0, 128) : undefined,
      smartLinkInstructions: rawFields.smartLinkInstructions ? String(rawFields.smartLinkInstructions).trim().slice(0, 1000) : undefined,
    },
  };
}
