import type {
  CanonicalTaskKind,
  SocialEngagementAction,
  SocialPlatform,
  SurveyQuestion,
  SurveyQuestionType,
  TaskBuilderMeta,
  TaskCardTheme,
  TaskCategory,
  TaskDifficulty,
  TaskItem,
  TaskKind,
  TaskProofMode,
  TaskProofRequirements,
} from '../src/types/index.js';
import { isSurveyQuestionAnswered } from './surveyLogic.js';

export const SUPABASE_TASK_ASSET_URLS = {
  featured:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_featured_emerald.jpg',
  surveys:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_survey_art.jpg',
  smart_links:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_smartlink_art.jpg',
  quick_tasks:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_quick_violet.jpg',
  app_testing:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_app_testing.jpg',
  external_offers:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_external_offers.jpg',
  ad_watch:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_featured_emerald.jpg',
  video_watch: '/assets/tasks/task_video_watch.jpg',
  website_visit:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_smartlink_art.jpg',
  social_follow: '/assets/tasks/task_social_follow.jpg',
  social_engagement: '/assets/tasks/task_social_engagement.jpg',
  account_signup: '/assets/tasks/task_account_signup.jpg',
  custom_proof:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/task_quick_violet.jpg',
  cat_all:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_all.jpg',
  cat_popular:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_popular.jpg',
  cat_quick:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_quick.jpg',
  cat_featured:
    'https://pevftfrgtzspiphibbla.supabase.co/storage/v1/object/public/task-assets/defaults/cat_icon_featured.jpg',
} as const;

export interface TaskKindOption {
  kind: CanonicalTaskKind;
  labelAr: string;
  subtitleAr: string;
  defaultCategory: TaskCategory;
  defaultTheme: TaskCardTheme;
  defaultBadgeLabel: string;
  defaultImageUrl: string;
  defaultProofModes: TaskProofMode[];
  accentHex: string;
}

export const TASK_KIND_OPTIONS: TaskKindOption[] = [
  {
    kind: 'surveys',
    labelAr: 'الاستبيانات',
    subtitleAr: 'أسئلة متتابعة وشريط تقدم وتفريع ذكي',
    defaultCategory: 'surveys',
    defaultTheme: 'emerald',
    defaultBadgeLabel: 'استبيان تفاعلي',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.surveys,
    defaultProofModes: ['multi_question'],
    accentHex: '#059669',
  },
  {
    kind: 'video_watch',
    labelAr: 'مشاهدة الفيديوهات',
    subtitleAr: 'مشغل فيديو مدمج وتحقق فعلي من المدة',
    defaultCategory: 'social_engagement',
    defaultTheme: 'teal',
    defaultBadgeLabel: 'مشاهدة فيديو',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.video_watch,
    defaultProofModes: ['auto_verified'],
    accentHex: '#0D9488',
  },
  {
    kind: 'website_visit',
    labelAr: 'زيارة المواقع والروابط',
    subtitleAr: 'فتح الرابط وتتبع العودة أو Postback',
    defaultCategory: 'smart_links',
    defaultTheme: 'indigo',
    defaultBadgeLabel: 'زيارة رابط',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.website_visit,
    defaultProofModes: ['auto_verified', 'code_number'],
    accentHex: '#4F46E5',
  },
  {
    kind: 'social_follow',
    labelAr: 'متابعة الحسابات',
    subtitleAr: 'منصة التواصل والحساب المستهدف للمتابعة',
    defaultCategory: 'social_engagement',
    defaultTheme: 'indigo',
    defaultBadgeLabel: 'متابعة حساب',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.social_follow,
    defaultProofModes: ['text'],
    accentHex: '#2563EB',
  },
  {
    kind: 'social_engagement',
    labelAr: 'الإعجاب والتفاعل',
    subtitleAr: 'إعجاب أو تعليق أو مشاركة أو اشتراك',
    defaultCategory: 'social_engagement',
    defaultTheme: 'rose',
    defaultBadgeLabel: 'تفاعل اجتماعي',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.social_engagement,
    defaultProofModes: ['text', 'image'],
    accentHex: '#E11D48',
  },
  {
    kind: 'app_testing',
    labelAr: 'تحميل وتجربة التطبيقات',
    subtitleAr: 'رابط المتجر ومتطلبات الجهاز وخطوات التجربة',
    defaultCategory: 'app_testing',
    defaultTheme: 'amber',
    defaultBadgeLabel: 'تطبيقات وألعاب',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.app_testing,
    defaultProofModes: ['text', 'image'],
    accentHex: '#D97706',
  },
  {
    kind: 'account_signup',
    labelAr: 'التسجيل وإنشاء الحسابات',
    subtitleAr: 'تسجيل آمن بإثبات غير حساس دون كلمات مرور',
    defaultCategory: 'local_services',
    defaultTheme: 'emerald',
    defaultBadgeLabel: 'تسجيل حساب',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.account_signup,
    defaultProofModes: ['text'],
    accentHex: '#10B981',
  },
  {
    kind: 'custom_proof',
    labelAr: 'إثباتات مخصصة',
    subtitleAr: 'نص، اختيار، رابط، رمز، صورة أو أسئلة مدمجة',
    defaultCategory: 'data_entry',
    defaultTheme: 'slate',
    defaultBadgeLabel: 'مهمة مخصصة',
    defaultImageUrl: SUPABASE_TASK_ASSET_URLS.custom_proof,
    defaultProofModes: ['text'],
    accentHex: '#334155',
  },
];

export const LEGACY_TASK_KIND_OPTIONS: Array<{
  kind: TaskKind;
  labelAr: string;
  canonical: CanonicalTaskKind;
}> = [
  { kind: 'ad_watch', labelAr: 'مشاهدة الفيديو / الإعلان', canonical: 'video_watch' },
  { kind: 'smart_links', labelAr: 'الروابط الذكية', canonical: 'website_visit' },
  { kind: 'quick_tasks', labelAr: 'مهمة سريعة', canonical: 'custom_proof' },
  { kind: 'external_offers', labelAr: 'عرض وتسجيل شريك', canonical: 'account_signup' },
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

export const TASK_DIFFICULTY_OPTIONS: Array<{
  id: TaskDifficulty;
  labelAr: string;
  badgeClass: string;
}> = [
  {
    id: 'easy',
    labelAr: 'سهل',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
  {
    id: 'medium',
    labelAr: 'متوسط',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  },
  {
    id: 'hard',
    labelAr: 'صعب',
    badgeClass:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  },
];

export const SOCIAL_PLATFORM_OPTIONS: Array<{
  id: SocialPlatform;
  labelAr: string;
  badgeClass: string;
}> = [
  { id: 'youtube', labelAr: 'يوتيوب (YouTube)', badgeClass: 'bg-rose-600 text-white' },
  { id: 'facebook', labelAr: 'فيسبوك (Facebook)', badgeClass: 'bg-blue-600 text-white' },
  { id: 'instagram', labelAr: 'إنستغرام (Instagram)', badgeClass: 'bg-pink-600 text-white' },
  { id: 'tiktok', labelAr: 'تيك توك (TikTok)', badgeClass: 'bg-slate-900 text-white' },
  { id: 'telegram', labelAr: 'تيليجرام (Telegram)', badgeClass: 'bg-sky-500 text-white' },
  { id: 'x', labelAr: 'إكس (X / Twitter)', badgeClass: 'bg-slate-800 text-white' },
  { id: 'whatsapp', labelAr: 'واتساب (WhatsApp)', badgeClass: 'bg-emerald-600 text-white' },
  { id: 'other', labelAr: 'منصة أخرى', badgeClass: 'bg-indigo-600 text-white' },
];

export const SOCIAL_ENGAGEMENT_ACTION_OPTIONS: Array<{
  id: SocialEngagementAction;
  labelAr: string;
}> = [
  { id: 'like', labelAr: 'إعجاب (Like)' },
  { id: 'comment', labelAr: 'تعليق هادف (Comment)' },
  { id: 'share', labelAr: 'مشاركة / إعادة نشر (Share)' },
  { id: 'subscribe', labelAr: 'اشتراك وتفعيل الجرس (Subscribe)' },
  { id: 'save', labelAr: 'حفظ المنشور (Save)' },
];

export const TASK_PROOF_MODE_OPTIONS: Array<{
  id: TaskProofMode;
  labelAr: string;
  descriptionAr: string;
}> = [
  { id: 'text', labelAr: 'إجابة نصية', descriptionAr: 'كتابة اسم الحساب أو الملاحظة المطلوبة' },
  { id: 'code_number', labelAr: 'رقم أو رمز إثبات', descriptionAr: 'إدخال كود التحقق أو رقم العملية' },
  { id: 'choice', labelAr: 'سؤال اختيار', descriptionAr: 'اختيار إجابة من قائمة محددة' },
  { id: 'url', labelAr: 'رابط (URL)', descriptionAr: 'إرفاق رابط التقييم أو المنشور' },
  { id: 'image', labelAr: 'صورة / لقطة شاشة', descriptionAr: 'رفع صورة إثبات (اختياري حسب الإعداد)' },
  { id: 'multi_question', labelAr: 'أسئلة متتابعة مدمجة', descriptionAr: 'نموذج أسئلة متعددة الخطوات داخل المهمة' },
  { id: 'auto_verified', labelAr: 'تحقق تلقائي موثوق', descriptionAr: 'إتمام مدة الفيديو أو العودة أو Postback' },
];

export function toCanonicalTaskKind(kind?: TaskKind | string | null, fallbackCategory?: string | null): CanonicalTaskKind {
  switch (kind) {
    case 'surveys':
    case 'video_watch':
    case 'website_visit':
    case 'social_follow':
    case 'social_engagement':
    case 'app_testing':
    case 'account_signup':
    case 'custom_proof':
      return kind;
    case 'ad_watch':
      return 'video_watch';
    case 'smart_links':
      return 'website_visit';
    case 'external_offers':
      return 'account_signup';
    case 'quick_tasks':
      return 'custom_proof';
    default:
      return inferTaskKindFromCategory(fallbackCategory);
  }
}

export function inferTaskKindFromCategory(category?: string | null): CanonicalTaskKind {
  switch (category) {
    case 'surveys':
      return 'surveys';
    case 'smart_links':
      return 'website_visit';
    case 'app_testing':
      return 'app_testing';
    case 'social_engagement':
      return 'social_engagement';
    case 'local_services':
      return 'account_signup';
    default:
      return 'custom_proof';
  }
}

export function getTaskKindLabel(kind?: TaskKind | string | null, fallbackCategory?: string | null): string {
  if (kind === 'smart_links') return 'الروابط الذكية';
  const canonical = toCanonicalTaskKind(kind, fallbackCategory);
  return TASK_KIND_OPTIONS.find((o) => o.kind === canonical)?.labelAr || 'مهمة عامة';
}

export function getDifficultyMeta(difficulty?: TaskDifficulty | string | null) {
  const found = TASK_DIFFICULTY_OPTIONS.find((d) => d.id === difficulty);
  return found || TASK_DIFFICULTY_OPTIONS[0];
}

export function getDefaultTaskImageUrl(
  kind?: TaskKind | string | null,
  isFeatured?: boolean,
  fallbackCategory?: string | null
): string {
  if (kind === 'smart_links') return SUPABASE_TASK_ASSET_URLS.smart_links;
  const canonical = toCanonicalTaskKind(kind, fallbackCategory);
  if (isFeatured && canonical !== 'website_visit' && canonical !== 'surveys' && canonical !== 'video_watch') {
    return SUPABASE_TASK_ASSET_URLS.featured;
  }
  return TASK_KIND_OPTIONS.find((o) => o.kind === canonical)?.defaultImageUrl || SUPABASE_TASK_ASSET_URLS.featured;
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

  if (kind === 'smart_links' || kind === 'website_visit') return 'smart_links';
  if (kind === 'surveys') return 'surveys';
  if (kind === 'app_testing') return 'app_testing';
  if (kind === 'video_watch' || kind === 'ad_watch' || kind === 'social_follow' || kind === 'social_engagement') {
    return 'social_engagement';
  }
  if (kind === 'account_signup' || kind === 'external_offers') return 'local_services';

  if (preferredCategory && validCategories.includes(preferredCategory as TaskCategory)) {
    return preferredCategory as TaskCategory;
  }

  return 'data_entry';
}

export function sanitizeSafeImageUrl(raw?: string | null): string | undefined {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val || val.length > 1000) return undefined;
  if (/^https?:\/\/[^\s<>"']+$/i.test(val)) return val;
  if (/^\/assets\/[a-zA-Z0-9_./-]+$/i.test(val) && !val.includes('..')) return val;
  return undefined;
}

export function sanitizeSafeHttpUrl(raw?: string | null): string | undefined {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val || val.length > 1000) return undefined;
  if (/^https?:\/\/[^\s<>"']+$/i.test(val)) return val;
  return undefined;
}

export function isNewTaskWithin48Hours(createdAt?: string | null): boolean {
  if (!createdAt) return false;
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 48 * 60 * 60 * 1000;
}

const SENSITIVE_SIGNUP_PATTERN =
  /(كلمة\s*المرور|كلمه\s*المرور|كلمة\s*السر|كلمه\s*السر|الرمز\s*السري|رمز\s*التحقق|الكود\s*السري|\bpassword\b|\bpasscode\b|\bpin\s*code\b|\botp\b|\bsecret\s*key\b|\bapi\s*token\b|\bprivate\s*key\b)/i;

export function assertNoSensitiveSignupFields(
  kind: TaskKind | string | undefined,
  texts: Array<string | undefined | null>
): void {
  const canonical = toCanonicalTaskKind(kind);
  if (canonical !== 'account_signup') return;
  for (const t of texts) {
    if (typeof t === 'string' && SENSITIVE_SIGNUP_PATTERN.test(t)) {
      throw new Error(
        'ممنوع أمنياً طلب كلمة المرور أو رموز OTP أو أي بيانات حساسة في مهام التسجيل. اطلب اسم المستخدم أو المعرف المسجل فقط.'
      );
    }
  }
}

const VALID_PROOF_MODES: TaskProofMode[] = [
  'text',
  'choice',
  'url',
  'image',
  'code_number',
  'multi_question',
  'auto_verified',
];

const VALID_SURVEY_Q_TYPES: SurveyQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'yes_no',
  'short_text',
  'long_text',
  'number',
  'rating_1_5',
];

export function sanitizeInlineQuestions(raw: any): SurveyQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 30)
    .map((q: any, idx: number): SurveyQuestion => {
      const qId = String(q?.id || `iq_${idx + 1}`).trim().slice(0, 80);
      const qType: SurveyQuestionType = VALID_SURVEY_Q_TYPES.includes(q?.questionType)
        ? q.questionType
        : 'short_text';
      const rawOpts = Array.isArray(q?.options) ? q.options : [];
      const opts =
        qType === 'yes_no' && rawOpts.length === 0
          ? [
              { id: `${qId}_yes`, questionId: qId, orderIndex: 0, optionText: 'نعم', nextQuestionId: null },
              { id: `${qId}_no`, questionId: qId, orderIndex: 1, optionText: 'لا', nextQuestionId: null },
            ]
          : rawOpts
              .filter((o: any) => String(o?.optionText || o || '').trim())
              .slice(0, 50)
              .map((o: any, oi: number) => ({
                id: String(o?.id || `${qId}_o_${oi + 1}`).slice(0, 80),
                questionId: qId,
                orderIndex: oi,
                optionText: String(o?.optionText ?? o).trim().slice(0, 300),
                nextQuestionId: o?.nextQuestionId ? String(o.nextQuestionId).slice(0, 80) : null,
              }));
      return {
        id: qId,
        surveyId: 'inline',
        orderIndex: idx,
        questionText: String(q?.questionText || '').trim().slice(0, 500),
        questionType: qType,
        isRequired: q?.isRequired !== false,
        imageUrl: sanitizeSafeImageUrl(q?.imageUrl) || null,
        options: opts,
        branchRules: Array.isArray(q?.branchRules) ? q.branchRules : [],
      };
    })
    .filter((q) => q.questionText.length > 0);
}

export function normalizeProofRequirements(
  rawProofReqs: any,
  taskMeta?: TaskBuilderMeta | null,
  taskKind?: TaskKind | string | null
): TaskProofRequirements {
  const reqObj = rawProofReqs && typeof rawProofReqs === 'object' ? rawProofReqs : {};
  const metaProof = taskMeta?.proofConfig && typeof taskMeta.proofConfig === 'object' ? taskMeta.proofConfig : {};
  const merged = { ...reqObj, ...metaProof };

  const rawModes: TaskProofMode[] = Array.isArray(merged.modes)
    ? Array.from(new Set(merged.modes.filter((m: any) => VALID_PROOF_MODES.includes(m))))
    : [];

  let modes: TaskProofMode[] = [...rawModes];
  if (modes.length === 0) {
    if (merged.requireText || merged.require_text) modes.push('text');
    if (merged.requireImage || merged.require_image) modes.push('image');
    if (merged.requireUrl || merged.require_url) modes.push('url');
    if (merged.requireCodeNumber) modes.push('code_number');
    if (merged.requireChoice) modes.push('choice');
    if (merged.requireMultiQuestion) modes.push('multi_question');
    if (merged.autoVerifyMode) modes.push('auto_verified');
  }

  const canonical = toCanonicalTaskKind(taskKind || taskMeta?.taskKind);
  if (modes.length === 0) {
    if (canonical === 'video_watch') {
      modes = ['auto_verified'];
    } else if (canonical === 'surveys' && !taskMeta?.linkedSurveyId) {
      modes = ['text'];
    } else {
      modes = ['text'];
    }
  }

  const choiceOptions = Array.isArray(merged.choiceOptions)
    ? merged.choiceOptions.map((o: any) => String(o || '').trim()).filter(Boolean).slice(0, 50)
    : [];

  const customQuestions = sanitizeInlineQuestions(merged.customQuestions);

  const requireImage = modes.includes('image');
  const requireText = modes.includes('text');
  const requireUrl = modes.includes('url');
  const requireCodeNumber = modes.includes('code_number');
  const requireChoice = modes.includes('choice');
  const requireMultiQuestion = modes.includes('multi_question') && customQuestions.length > 0;

  let autoVerifyMode = merged.autoVerifyMode;
  if (!autoVerifyMode && modes.includes('auto_verified')) {
    if (canonical === 'video_watch') autoVerifyMode = 'video_watch';
    else if (canonical === 'website_visit' && taskMeta?.fields?.useSmartLinkPostback) autoVerifyMode = 'smart_link_postback';
    else if (canonical === 'surveys') autoVerifyMode = 'survey';
  }

  return {
    modes,
    requireImage,
    requireText,
    requireUrl,
    requireCodeNumber,
    requireChoice,
    requireMultiQuestion,
    autoVerifyMode,
    proofPromptText: merged.proofPromptText ? String(merged.proofPromptText).trim().slice(0, 500) : undefined,
    choiceQuestion: merged.choiceQuestion ? String(merged.choiceQuestion).trim().slice(0, 400) : undefined,
    choiceOptions: choiceOptions.length > 0 ? choiceOptions : undefined,
    choiceMultiSelect: Boolean(merged.choiceMultiSelect),
    customQuestions: customQuestions.length > 0 ? customQuestions : undefined,
    acceptanceCriteria:
      (merged.acceptanceCriteria || taskMeta?.acceptanceCriteria)
        ? String(merged.acceptanceCriteria || taskMeta?.acceptanceCriteria).trim().slice(0, 1000)
        : undefined,
    rejectionCriteria:
      (merged.rejectionCriteria || taskMeta?.rejectionCriteria)
        ? String(merged.rejectionCriteria || taskMeta?.rejectionCriteria).trim().slice(0, 1000)
        : undefined,
    instructions: merged.instructions ? String(merged.instructions).trim().slice(0, 1000) : undefined,
    ...(taskMeta ? { _taskMeta: taskMeta } : {}),
  };
}

export function sanitizeTaskBuilderMeta(input: any, fallbackCategory?: string | null): TaskBuilderMeta {
  const raw = input && typeof input === 'object' ? input : {};
  const validKinds: TaskKind[] = [
    'surveys',
    'video_watch',
    'website_visit',
    'social_follow',
    'social_engagement',
    'app_testing',
    'account_signup',
    'custom_proof',
    'smart_links',
    'ad_watch',
    'quick_tasks',
    'external_offers',
  ];
  const taskKind: TaskKind = validKinds.includes(raw.taskKind)
    ? raw.taskKind
    : inferTaskKindFromCategory(fallbackCategory);

  const validThemes: TaskCardTheme[] = ['emerald', 'indigo', 'amber', 'teal', 'rose', 'slate'];
  const canonical = toCanonicalTaskKind(taskKind, fallbackCategory);
  const defaultOpt = TASK_KIND_OPTIONS.find((o) => o.kind === canonical);
  const cardTheme: TaskCardTheme = validThemes.includes(raw.cardTheme)
    ? raw.cardTheme
    : defaultOpt?.defaultTheme || 'emerald';

  const validDiffs: TaskDifficulty[] = ['easy', 'medium', 'hard'];
  const difficulty: TaskDifficulty = validDiffs.includes(raw.difficulty) ? raw.difficulty : 'easy';

  const rawFields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};

  const questions = Array.isArray(rawFields.questions)
    ? rawFields.questions.map((q: any) => String(q || '').trim()).filter(Boolean).slice(0, 30)
    : [];

  const steps = Array.isArray(rawFields.steps)
    ? rawFields.steps.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 30)
    : [];

  const validPlatforms: SocialPlatform[] = ['facebook', 'instagram', 'youtube', 'tiktok', 'telegram', 'x', 'whatsapp', 'other'];
  const validActions: SocialEngagementAction[] = ['like', 'comment', 'share', 'subscribe', 'save'];

  const normalizedProofConfig = raw.proofConfig
    ? (() => {
        const pr = normalizeProofRequirements(raw.proofConfig, null, taskKind);
        const { _taskMeta: _drop, ...rest } = pr;
        return rest;
      })()
    : undefined;

  return {
    taskKind,
    difficulty,
    acceptanceCriteria: raw.acceptanceCriteria ? String(raw.acceptanceCriteria).trim().slice(0, 1000) : undefined,
    rejectionCriteria: raw.rejectionCriteria ? String(raw.rejectionCriteria).trim().slice(0, 1000) : undefined,
    proofConfig: normalizedProofConfig,
    isFeatured: Boolean(raw.isFeatured),
    featuredRequested: Boolean(raw.featuredRequested),
    priority: Number.isFinite(Number(raw.priority)) ? Math.round(Number(raw.priority)) : raw.isFeatured ? 100 : 0,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Math.round(Number(raw.sortOrder)) : 0,
    imageUrl: sanitizeSafeImageUrl(raw.imageUrl),
    cardTheme,
    badgeLabel: raw.badgeLabel ? String(raw.badgeLabel).trim().slice(0, 40) : undefined,
    badgeColor: raw.badgeColor ? String(raw.badgeColor).trim().slice(0, 30) : undefined,
    linkedSurveyId: raw.linkedSurveyId
      ? String(raw.linkedSurveyId).trim().slice(0, 80)
      : rawFields.linkedSurveyId
        ? String(rawFields.linkedSurveyId).trim().slice(0, 80)
        : undefined,
    fields: {
      questions: questions.length > 0 ? questions : undefined,
      optionsText: rawFields.optionsText ? String(rawFields.optionsText).trim().slice(0, 1000) : undefined,
      linkedSurveyId: rawFields.linkedSurveyId ? String(rawFields.linkedSurveyId).trim().slice(0, 80) : undefined,
      videoUrl: sanitizeSafeHttpUrl(rawFields.videoUrl) || sanitizeSafeHttpUrl(rawFields.adUrl),
      videoProvider: rawFields.videoProvider || undefined,
      adUrl: sanitizeSafeHttpUrl(rawFields.adUrl) || sanitizeSafeHttpUrl(rawFields.videoUrl),
      watchDurationSeconds:
        rawFields.watchDurationSeconds !== undefined && Number(rawFields.watchDurationSeconds) > 0
          ? Math.min(3600, Math.round(Number(rawFields.watchDurationSeconds)))
          : undefined,
      completionRule: rawFields.completionRule ? String(rawFields.completionRule).trim().slice(0, 500) : undefined,
      targetUrl: sanitizeSafeHttpUrl(rawFields.targetUrl) || sanitizeSafeHttpUrl(rawFields.trackingUrl),
      minVisitSeconds:
        rawFields.minVisitSeconds !== undefined && Number(rawFields.minVisitSeconds) > 0
          ? Math.min(1800, Math.round(Number(rawFields.minVisitSeconds)))
          : undefined,
      useSmartLinkPostback: Boolean(rawFields.useSmartLinkPostback || taskKind === 'smart_links'),
      providerName: rawFields.providerName ? String(rawFields.providerName).trim().slice(0, 120) : undefined,
      providerLogoUrl: sanitizeSafeImageUrl(rawFields.providerLogoUrl),
      trackingUrl: sanitizeSafeHttpUrl(rawFields.trackingUrl),
      postbackSecret: rawFields.postbackSecret ? String(rawFields.postbackSecret).trim().slice(0, 128) : undefined,
      smartLinkInstructions: rawFields.smartLinkInstructions ? String(rawFields.smartLinkInstructions).trim().slice(0, 1000) : undefined,
      socialPlatform: validPlatforms.includes(rawFields.socialPlatform) ? rawFields.socialPlatform : undefined,
      socialAccountHandle: rawFields.socialAccountHandle ? String(rawFields.socialAccountHandle).trim().slice(0, 120) : undefined,
      socialAccountUrl: sanitizeSafeHttpUrl(rawFields.socialAccountUrl),
      engagementAction: validActions.includes(rawFields.engagementAction) ? rawFields.engagementAction : undefined,
      engagementTargetUrl: sanitizeSafeHttpUrl(rawFields.engagementTargetUrl),
      appDownloadUrl: sanitizeSafeHttpUrl(rawFields.appDownloadUrl),
      appRequirements: rawFields.appRequirements ? String(rawFields.appRequirements).trim().slice(0, 500) : undefined,
      testingInstructions: rawFields.testingInstructions
        ? String(rawFields.testingInstructions).trim().slice(0, 1000)
        : undefined,
      requiredProofNote: rawFields.requiredProofNote
        ? String(rawFields.requiredProofNote).trim().slice(0, 500)
        : undefined,
      signupUrl: sanitizeSafeHttpUrl(rawFields.signupUrl) || sanitizeSafeHttpUrl(rawFields.offerUrl),
      signupRequirements: rawFields.signupRequirements
        ? String(rawFields.signupRequirements).trim().slice(0, 1000)
        : undefined,
      steps: steps.length > 0 ? steps : undefined,
      proofNotes: rawFields.proofNotes ? String(rawFields.proofNotes).trim().slice(0, 500) : undefined,
      customProofSummary: rawFields.customProofSummary ? String(rawFields.customProofSummary).trim().slice(0, 1000) : undefined,
      partnerName: rawFields.partnerName ? String(rawFields.partnerName).trim().slice(0, 120) : undefined,
      offerUrl: sanitizeSafeHttpUrl(rawFields.offerUrl) || sanitizeSafeHttpUrl(rawFields.signupUrl),
      offerConditions: rawFields.offerConditions ? String(rawFields.offerConditions).trim().slice(0, 1000) : undefined,
    },
  };
}

export interface DynamicProofSubmissionInput {
  proofText?: string;
  proofImages?: string[];
  proofUrl?: string;
  proofCodeNumber?: string;
  proofChoiceAnswer?: string | string[];
  proofMultiAnswers?: Record<string, any> | Array<{ questionId: string; questionText?: string; answer: any }>;
  executionSessionVerified?: boolean;
  verifiedSeconds?: number;
}

export function validateDynamicTaskProof(
  task: Pick<TaskItem, 'taskKind' | 'category' | 'proofRequirements' | 'taskMeta'>,
  input: DynamicProofSubmissionInput
): {
  valid: boolean;
  error?: string;
  summaryText: string;
  normalizedChoice?: string | string[];
  normalizedMultiAnswers?: Array<{ questionId: string; questionText: string; answer: any }>;
} {
  const reqs = normalizeProofRequirements(task.proofRequirements, task.taskMeta, task.taskKind);
  const modes = reqs.modes || [];
  const cleanText = typeof input.proofText === 'string' ? input.proofText.trim() : '';
  const cleanUrl = typeof input.proofUrl === 'string' ? input.proofUrl.trim() : '';
  const cleanCode = typeof input.proofCodeNumber === 'string' ? input.proofCodeNumber.trim() : '';
  const cleanImages = Array.isArray(input.proofImages)
    ? input.proofImages.filter((x) => typeof x === 'string' && x.trim().length > 0)
    : [];

  if (reqs.requireText && !cleanText) {
    return { valid: false, error: 'يرجى كتابة الإجابة النصية المطلوبة في حقل الإثبات.', summaryText: '' };
  }

  if (reqs.requireCodeNumber && !cleanCode) {
    return { valid: false, error: 'يرجى إدخال رقم أو رمز الإثبات المطلوب.', summaryText: '' };
  }

  if (reqs.requireUrl) {
    if (!cleanUrl || !/^https?:\/\/[^\s<>"']+$/i.test(cleanUrl)) {
      return { valid: false, error: 'يرجى إدخال رابط إثبات صحيح يبدأ بـ http:// أو https://.', summaryText: '' };
    }
  } else if (cleanUrl && !/^https?:\/\/[^\s<>"']+$/i.test(cleanUrl)) {
    return { valid: false, error: 'صيغة رابط الإثبات غير صالحة.', summaryText: '' };
  }

  if (reqs.requireImage && cleanImages.length === 0) {
    return { valid: false, error: 'هذه المهمة تتطلب رفع صورة إثبات الإنجاز.', summaryText: '' };
  }

  let normalizedChoice: string | string[] | undefined;
  if (reqs.requireChoice) {
    if (reqs.choiceMultiSelect) {
      const arr = Array.isArray(input.proofChoiceAnswer)
        ? input.proofChoiceAnswer.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
      if (arr.length === 0) {
        return { valid: false, error: 'يرجى اختيار إجابة واحدة على الأقل.', summaryText: '' };
      }
      normalizedChoice = arr;
    } else {
      const val = Array.isArray(input.proofChoiceAnswer)
        ? String(input.proofChoiceAnswer[0] || '').trim()
        : String(input.proofChoiceAnswer || '').trim();
      if (!val) {
        return { valid: false, error: 'يرجى اختيار الإجابة المناسبة.', summaryText: '' };
      }
      normalizedChoice = val;
    }
  }

  let normalizedMultiAnswers: Array<{ questionId: string; questionText: string; answer: any }> | undefined;
  if (reqs.requireMultiQuestion && reqs.customQuestions && reqs.customQuestions.length > 0) {
    const mapAns = new Map<string, any>();
    if (Array.isArray(input.proofMultiAnswers)) {
      for (const item of input.proofMultiAnswers) {
        if (item?.questionId) mapAns.set(item.questionId, item.answer);
      }
    } else if (input.proofMultiAnswers && typeof input.proofMultiAnswers === 'object') {
      for (const [k, v] of Object.entries(input.proofMultiAnswers)) {
        mapAns.set(k, v);
      }
    }

    normalizedMultiAnswers = [];
    for (const q of reqs.customQuestions) {
      const ans = mapAns.get(q.id);
      if (q.isRequired && !isSurveyQuestionAnswered(q, ans)) {
        return {
          valid: false,
          error: `يرجى الإجابة على السؤال الإلزامي: "${q.questionText}"`,
          summaryText: '',
        };
      }
      if (ans !== undefined && ans !== null && String(ans).trim() !== '') {
        normalizedMultiAnswers.push({
          questionId: q.id,
          questionText: q.questionText,
          answer: ans,
        });
      }
    }
  }

  const canonical = toCanonicalTaskKind(task.taskKind, task.category);
  const watchSeconds = Number(task.taskMeta?.fields?.watchDurationSeconds || 0);
  const visitSeconds = Number(task.taskMeta?.fields?.minVisitSeconds || 0);
  if (
    (modes.includes('auto_verified') || (canonical === 'video_watch' && watchSeconds > 0)) &&
    (watchSeconds > 0 || (canonical === 'website_visit' && visitSeconds > 0)) &&
    !input.executionSessionVerified
  ) {
    return {
      valid: false,
      error:
        canonical === 'video_watch'
          ? `يجب إكمال مشاهدة الفيديو للمدة المطلوبة (${watchSeconds} ثانية) قبل إرسال الإثبات.`
          : `يجب قضاء المدة المطلوبة في زيارة الرابط (${visitSeconds} ثانية) قبل الإرسال.`,
      summaryText: '',
    };
  }

  // Require at least one concrete proof artifact or verified session
  const hasAny =
    Boolean(cleanText) ||
    Boolean(cleanCode) ||
    Boolean(cleanUrl) ||
    cleanImages.length > 0 ||
    Boolean(normalizedChoice) ||
    Boolean(normalizedMultiAnswers && normalizedMultiAnswers.length > 0) ||
    Boolean(input.executionSessionVerified);

  if (!hasAny) {
    return { valid: false, error: 'يرجى تقديم بيانات الإثبات المطلوبة قبل الإرسال.', summaryText: '' };
  }

  // Build readable Arabic summary for `proof.text` (satisfies DB submit_task_proof SQL constraint)
  const parts: string[] = [];
  if (cleanText) parts.push(cleanText);
  if (cleanCode) parts.push(`الرمز/الرقم: ${cleanCode}`);
  if (normalizedChoice) {
    const chLabel = Array.isArray(normalizedChoice) ? normalizedChoice.join('، ') : normalizedChoice;
    parts.push(`الاختيار: ${chLabel}`);
  }
  if (normalizedMultiAnswers && normalizedMultiAnswers.length > 0) {
    parts.push(
      normalizedMultiAnswers
        .map((a) => `${a.questionText}: ${Array.isArray(a.answer) ? a.answer.join('، ') : a.answer}`)
        .join(' | ')
    );
  }
  if (input.executionSessionVerified) {
    parts.push(
      input.verifiedSeconds && input.verifiedSeconds > 0
        ? `تم التحقق التلقائي من الإنجاز (${input.verifiedSeconds} ثانية)`
        : 'تم التحقق التلقائي من الإنجاز'
    );
  }

  return {
    valid: true,
    summaryText: parts.join(' — ').slice(0, 2000),
    normalizedChoice,
    normalizedMultiAnswers,
  };
}

export function extractYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : null;
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{6,20}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
      if (embedIdx >= 0 && parts[embedIdx + 1] && /^[a-zA-Z0-9_-]{6,20}$/.test(parts[embedIdx + 1])) {
        return parts[embedIdx + 1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function isDirectVideoFileUrl(url?: string | null): boolean {
  if (!url) return false;
  return /\.(mp4|webm|ogg|mov|m3u8)(\?.*)?$/i.test(url.trim());
}
