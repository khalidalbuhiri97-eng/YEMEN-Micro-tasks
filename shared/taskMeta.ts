import type { TaskBuilderMeta, TaskCategory, TaskKind } from '../src/types/index.js';

export const TASK_KIND_OPTIONS: Array<{
  kind: TaskKind;
  labelAr: string;
  subtitleAr: string;
  defaultCategory: TaskCategory;
}> = [
  {
    kind: 'surveys',
    labelAr: 'استبيان',
    subtitleAr: 'أسئلة وخيارات إجابة',
    defaultCategory: 'surveys',
  },
  {
    kind: 'ad_watch',
    labelAr: 'مشاهدة إعلان',
    subtitleAr: 'رابط إعلان ومدة مشاهدة',
    defaultCategory: 'social_engagement',
  },
  {
    kind: 'app_testing',
    labelAr: 'تجربة تطبيق',
    subtitleAr: 'رابط تحميل وخطوات اختبار',
    defaultCategory: 'app_testing',
  },
  {
    kind: 'quick_tasks',
    labelAr: 'مهمة سريعة',
    subtitleAr: 'خطوات بسيطة وإثبات فوري',
    defaultCategory: 'data_entry',
  },
  {
    kind: 'external_offers',
    labelAr: 'عرض خارجي',
    subtitleAr: 'شريك وعرض مع شروط واضحة',
    defaultCategory: 'local_services',
  },
];

export function inferTaskKindFromCategory(category?: string | null): TaskKind {
  switch (category) {
    case 'surveys':
      return 'surveys';
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

export function mapTaskKindToCategory(kind?: TaskKind | string | null, preferredCategory?: string | null): TaskCategory {
  const validCategories: TaskCategory[] = [
    'app_testing',
    'surveys',
    'social_engagement',
    'content_writing',
    'data_entry',
    'review_ratings',
    'local_services',
  ];

  if (preferredCategory && validCategories.includes(preferredCategory as TaskCategory)) {
    return preferredCategory as TaskCategory;
  }

  const found = TASK_KIND_OPTIONS.find((o) => o.kind === kind);
  return found ? found.defaultCategory : 'app_testing';
}

export function sanitizeTaskBuilderMeta(input: any, fallbackCategory?: string | null): TaskBuilderMeta {
  const raw = input && typeof input === 'object' ? input : {};
  const validKinds: TaskKind[] = ['surveys', 'ad_watch', 'app_testing', 'quick_tasks', 'external_offers'];
  const taskKind: TaskKind = validKinds.includes(raw.taskKind)
    ? raw.taskKind
    : inferTaskKindFromCategory(fallbackCategory);

  const rawFields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};

  const questions = Array.isArray(rawFields.questions)
    ? rawFields.questions.map((q: any) => String(q || '').trim()).filter(Boolean).slice(0, 20)
    : [];

  const steps = Array.isArray(rawFields.steps)
    ? rawFields.steps.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 20)
    : [];

  return {
    taskKind,
    isFeatured: Boolean(raw.isFeatured),
    featuredRequested: Boolean(raw.featuredRequested),
    priority: Number.isFinite(Number(raw.priority)) ? Math.round(Number(raw.priority)) : raw.isFeatured ? 100 : 0,
    fields: {
      questions: questions.length > 0 ? questions : undefined,
      optionsText: rawFields.optionsText ? String(rawFields.optionsText).trim().slice(0, 1000) : undefined,
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
    },
  };
}
