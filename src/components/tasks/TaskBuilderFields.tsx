import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  PlaySquare,
  Smartphone,
  Sparkles,
  Globe,
  Crown,
  Link2,
  Eye,
  Image as ImageIcon,
  Palette,
  Upload,
  RefreshCw,
  UserPlus,
  Heart,
  ShieldCheck,
  AlertTriangle,
  Plus,
  Trash2,
  SlidersHorizontal,
  CheckSquare,
} from 'lucide-react';
import type {
  CanonicalTaskKind,
  SurveyItem,
  SurveyQuestion,
  SurveyQuestionType,
  TaskAssetItem,
  TaskBuilderMeta,
  TaskDifficulty,
  TaskItem,
  TaskKind,
  TaskProofMode,
  TaskProofRequirements,
} from '../../types/index.ts';
import {
  SOCIAL_ENGAGEMENT_ACTION_OPTIONS,
  SOCIAL_PLATFORM_OPTIONS,
  TASK_CARD_THEMES,
  TASK_DIFFICULTY_OPTIONS,
  TASK_KIND_OPTIONS,
  TASK_PROOF_MODE_OPTIONS,
  assertNoSensitiveSignupFields,
  getDefaultTaskImageUrl,
  mapTaskKindToCategory,
  normalizeProofRequirements,
  toCanonicalTaskKind,
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

const CANONICAL_KIND_ICONS: Record<CanonicalTaskKind, React.ReactNode> = {
  surveys: <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
  video_watch: <PlaySquare className="w-4 h-4 text-teal-600 dark:text-teal-400" />,
  website_visit: <Globe className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
  social_follow: <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
  social_engagement: <Heart className="w-4 h-4 text-rose-600 dark:text-rose-400" />,
  app_testing: <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
  account_signup: <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />,
  custom_proof: <Sparkles className="w-4 h-4 text-slate-700 dark:text-slate-300" />,
};

const INLINE_Q_TYPES: Array<{ id: SurveyQuestionType; labelAr: string }> = [
  { id: 'single_choice', labelAr: 'اختيار واحد' },
  { id: 'multiple_choice', labelAr: 'اختيار متعدد' },
  { id: 'yes_no', labelAr: 'نعم / لا' },
  { id: 'short_text', labelAr: 'نص قصير' },
  { id: 'long_text', labelAr: 'نص طويل' },
  { id: 'number', labelAr: 'رقم' },
  { id: 'rating_1_5', labelAr: 'تقييم 1 إلى 5' },
];

export const TaskBuilderFields: React.FC<TaskBuilderFieldsProps> = ({
  meta,
  onChange,
  canFeatureDirectly,
  assets: propAssets,
  surveys: propSurveys,
}) => {
  const canonicalKind = toCanonicalTaskKind(meta.taskKind);
  const fields = meta.fields || {};
  const normalizedProof = normalizeProofRequirements(meta.proofConfig, meta, meta.taskKind);
  const activeModes: TaskProofMode[] = normalizedProof.modes || ['text'];
  const difficulty: TaskDifficulty = meta.difficulty || 'easy';

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
    } else if (canFeatureDirectly && canonicalKind === 'surveys') {
      api
        .getAdminSurveys()
        .then((res) => setAvailableSurveys(res.surveys || []))
        .catch(() => {});
    }
  }, [propSurveys, canFeatureDirectly, canonicalKind]);

  const updateFields = (patch: Partial<NonNullable<TaskBuilderMeta['fields']>>) => {
    onChange({
      ...meta,
      fields: {
        ...fields,
        ...patch,
      },
    });
  };

  const updateProofConfig = (patch: Partial<TaskProofRequirements>) => {
    const nextConfig: TaskProofRequirements = {
      ...normalizedProof,
      ...patch,
    };
    delete nextConfig._taskMeta;
    const modes = nextConfig.modes || [];
    nextConfig.requireText = modes.includes('text');
    nextConfig.requireImage = modes.includes('image');
    nextConfig.requireUrl = modes.includes('url');
    nextConfig.requireCodeNumber = modes.includes('code_number');
    nextConfig.requireChoice = modes.includes('choice');
    nextConfig.requireMultiQuestion = modes.includes('multi_question');
    onChange({
      ...meta,
      proofConfig: nextConfig,
    });
  };

  const toggleProofMode = (mode: TaskProofMode) => {
    const exists = activeModes.includes(mode);
    const nextModes = exists ? activeModes.filter((m) => m !== mode) : [...activeModes, mode];
    const safeModes: TaskProofMode[] = nextModes.length > 0 ? nextModes : ['text'];
    const patch: Partial<TaskProofRequirements> = { modes: safeModes };
    if (mode === 'multi_question' && !exists && (!normalizedProof.customQuestions || normalizedProof.customQuestions.length === 0)) {
      patch.customQuestions = [
        {
          id: `iq_${Date.now().toString(36)}`,
          surveyId: 'inline',
          orderIndex: 0,
          questionText: '',
          questionType: 'short_text',
          isRequired: true,
          options: [],
          branchRules: [],
        },
      ];
    }
    if (mode === 'choice' && !exists && (!normalizedProof.choiceOptions || normalizedProof.choiceOptions.length === 0)) {
      patch.choiceOptions = ['نعم، تم التنفيذ', 'لا'];
    }
    updateProofConfig(patch);
  };

  const handleSelectKind = (opt: (typeof TASK_KIND_OPTIONS)[number]) => {
    const nextProof = normalizeProofRequirements(
      { modes: opt.defaultProofModes },
      { ...meta, taskKind: opt.kind },
      opt.kind
    );
    delete nextProof._taskMeta;

    onChange({
      ...meta,
      taskKind: opt.kind,
      cardTheme: opt.defaultTheme,
      badgeLabel: opt.defaultBadgeLabel,
      proofConfig: {
        ...nextProof,
        acceptanceCriteria: meta.acceptanceCriteria,
        rejectionCriteria: meta.rejectionCriteria,
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
        taskKind: canonicalKind,
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

  // Detect any sensitive signup warning in live editing
  let signupSecurityWarning = '';
  if (canonicalKind === 'account_signup') {
    try {
      assertNoSensitiveSignupFields('account_signup', [
        fields.signupRequirements,
        fields.offerConditions,
        fields.proofNotes,
        normalizedProof.proofPromptText,
        meta.acceptanceCriteria,
      ]);
    } catch (err: any) {
      signupSecurityWarning = err?.message || 'ممنوع طلب بيانات سرية.';
    }
  }

  const illustrationAssets = galleryAssets.filter((a) => a.assetKind !== 'category_icon');
  const inlineQuestions: SurveyQuestion[] = normalizedProof.customQuestions || [];

  const updateInlineQuestions = (next: SurveyQuestion[]) => {
    updateProofConfig({
      customQuestions: next.map((q, idx) => ({ ...q, orderIndex: idx })),
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Task Type Visual Selector (All 8 Primary Types) */}
      <div>
        <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 mb-2">
          نوع المهمة (8 أنواع متخصصة — تتغير الحقول وطرق الإثبات تلقائياً)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TASK_KIND_OPTIONS.map((opt) => {
            const active = canonicalKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() => handleSelectKind(opt)}
                className={`p-2.5 rounded-xl border text-right transition-all flex flex-col gap-1 min-h-[72px] ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  {CANONICAL_KIND_ICONS[opt.kind]}
                  {active && <span className="w-2 h-2 rounded-full bg-emerald-600" />}
                </div>
                <div className="text-xs font-extrabold text-slate-900 dark:text-white leading-tight">
                  {opt.labelAr}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight line-clamp-2">
                  {opt.subtitleAr}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Dynamic Type-Specific Fields */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-4">
        {/* A. SURVEYS */}
        {canonicalKind === 'surveys' && (
          <div className="space-y-3">
            {canFeatureDirectly && availableSurveys.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ربط باستبيان تفاعلي متسلسل من منشئ الاستبيانات (موصى به)
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
                  <option value="">بدون ربط (استخدم الأسئلة المدمجة أو وصف المهمة أدناه)</option>
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
                ملخص محاور الاستبيان (اختياري — يظهر للمنفذ في بطاقة التفاصيل)
              </label>
              <textarea
                rows={2}
                value={(fields.questions || []).join('\n')}
                onChange={(e) => updateFields({ questions: e.target.value.split('\n') })}
                placeholder={'1. تقييم تجربة التسوق\n2. اقتراحات التحسين'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* B. VIDEO WATCH */}
        {canonicalKind === 'video_watch' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رابط الفيديو (YouTube أو رابط MP4/WebM مباشر)
              </label>
              <input
                type="url"
                value={fields.videoUrl || fields.adUrl || ''}
                onChange={(e) => updateFields({ videoUrl: e.target.value, adUrl: e.target.value })}
                placeholder="https://www.youtube.com/watch?v=... أو https://.../video.mp4"
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                مدة المشاهدة الإلزامية قبل تفعيل الإكمال (ثانية)
              </label>
              <input
                type="number"
                min="5"
                max="3600"
                value={fields.watchDurationSeconds || 30}
                onChange={(e) => updateFields({ watchDurationSeconds: Math.max(5, Number(e.target.value) || 30) })}
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                تعليمات المشاهدة (اختياري)
              </label>
              <input
                type="text"
                value={fields.completionRule || ''}
                onChange={(e) => updateFields({ completionRule: e.target.value })}
                placeholder="مثال: شاهد الفيديو دون إغلاق النافذة حتى اكتمال العداد"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* C. WEBSITE VISIT & SMART LINKS */}
        {canonicalKind === 'website_visit' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رابط الموقع المستهدف (URL)
                </label>
                <input
                  type="url"
                  value={fields.targetUrl || fields.trackingUrl || ''}
                  onChange={(e) => updateFields({ targetUrl: e.target.value })}
                  placeholder="https://example.com/article"
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  أقل مدة تصفح (ثانية)
                </label>
                <input
                  type="number"
                  min="5"
                  max="1800"
                  value={fields.minVisitSeconds || 20}
                  onChange={(e) => updateFields({ minVisitSeconds: Math.max(5, Number(e.target.value) || 20) })}
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(fields.useSmartLinkPostback || meta.taskKind === 'smart_links')}
                onChange={(e) => updateFields({ useSmartLinkPostback: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600"
              />
              <Link2 className="w-3.5 h-3.5" />
              <span>تفعيل وضع الرابط الذكي المتتبع (Smart Link Postback)</span>
            </label>

            {(fields.useSmartLinkPostback || meta.taskKind === 'smart_links') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    اسم المزوّد / الشريك
                  </label>
                  <input
                    type="text"
                    value={fields.providerName || ''}
                    onChange={(e) => updateFields({ providerName: e.target.value })}
                    placeholder="مثال: TimeWall أو CPX Research"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رابط التتبع الذكي ({'{click_id}'} و {'{user_id}'})
                  </label>
                  <input
                    type="url"
                    value={fields.trackingUrl || ''}
                    onChange={(e) => updateFields({ trackingUrl: e.target.value })}
                    placeholder="https://provider.example/offer?subid={click_id}"
                    className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                {canFeatureDirectly && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      مفتاح Postback السري
                    </label>
                    <input
                      type="text"
                      value={fields.postbackSecret || ''}
                      onChange={(e) => updateFields({ postbackSecret: e.target.value })}
                      className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                )}
                <div className={canFeatureDirectly ? '' : 'sm:col-span-2'}>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    تعليمات العرض الذكي
                  </label>
                  <input
                    type="text"
                    value={fields.smartLinkInstructions || ''}
                    onChange={(e) => updateFields({ smartLinkInstructions: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* D. SOCIAL FOLLOW */}
        {canonicalKind === 'social_follow' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  منصة التواصل
                </label>
                <select
                  value={fields.socialPlatform || 'instagram'}
                  onChange={(e) => updateFields({ socialPlatform: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  {SOCIAL_PLATFORM_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.labelAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  معرف الحساب المستهدف (@Handle)
                </label>
                <input
                  type="text"
                  value={fields.socialAccountHandle || ''}
                  onChange={(e) => updateFields({ socialAccountHandle: e.target.value })}
                  placeholder="@YemenTaskOfficial"
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رابط الحساب أو القناة المباشر
                </label>
                <input
                  type="url"
                  value={fields.socialAccountUrl || ''}
                  onChange={(e) => updateFields({ socialAccountUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خطوات المتابعة (كل خطوة في سطر)
              </label>
              <textarea
                rows={2}
                value={(fields.steps || []).join('\n')}
                onChange={(e) => updateFields({ steps: e.target.value.split('\n') })}
                placeholder={'افتح الحساب من الرابط أعلاه\nاضغط متابعة / اشتراك\nأدخل اسم حسابك في خانة الإثبات'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        )}

        {/* E. SOCIAL ENGAGEMENT */}
        {canonicalKind === 'social_engagement' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  منصة التواصل
                </label>
                <select
                  value={fields.socialPlatform || 'youtube'}
                  onChange={(e) => updateFields({ socialPlatform: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  {SOCIAL_PLATFORM_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.labelAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  نوع التفاعل المطلوب
                </label>
                <select
                  value={fields.engagementAction || 'like'}
                  onChange={(e) => updateFields({ engagementAction: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  {SOCIAL_ENGAGEMENT_ACTION_OPTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.labelAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رابط المنشور أو الفيديو
                </label>
                <input
                  type="url"
                  value={fields.engagementTargetUrl || ''}
                  onChange={(e) => updateFields({ engagementTargetUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خطوات التفاعل المطلوبة (كل خطوة في سطر)
              </label>
              <textarea
                rows={2}
                value={(fields.steps || []).join('\n')}
                onChange={(e) => updateFields({ steps: e.target.value.split('\n') })}
                placeholder={'افتح المنشور من الرابط\nنفّذ الإعجاب والتعليق المطلوب\nأرسل اسم حسابك أو لقطة الشاشة حسب الإعداد'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        )}

        {/* F. APP TESTING */}
        {canonicalKind === 'app_testing' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رابط تحميل أو متجر التطبيق
                </label>
                <input
                  type="url"
                  value={fields.appDownloadUrl || ''}
                  onChange={(e) => updateFields({ appDownloadUrl: e.target.value })}
                  placeholder="https://play.google.com/store/apps/..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  متطلبات الجهاز والنظام
                </label>
                <input
                  type="text"
                  value={fields.appRequirements || ''}
                  onChange={(e) => updateFields({ appRequirements: e.target.value })}
                  placeholder="مثال: أندرويد 9 فأحدث — حجم 25 ميجا"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خطوات التجربة (كل خطوة في سطر)
              </label>
              <textarea
                rows={2}
                value={(fields.steps || []).join('\n')}
                onChange={(e) => updateFields({ steps: e.target.value.split('\n') })}
                placeholder={'ثبّت التطبيق من المتجر الرسمي\nافتح التطبيق وتصفحه لمدة دقيقتين\nسجّل ملاحظتك أو لقطة الشاشة'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        )}

        {/* G. ACCOUNT SIGNUP (With Strict Privacy/No-Secrets Guard) */}
        {canonicalKind === 'account_signup' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>حماية الخصوصية الإلزامية:</strong> يُمنع تماماً طلب كلمات المرور أو رموز التحقق (OTP) أو أي بيانات سرية. اطلب فقط <strong>اسم المستخدم أو المعرف المسجل</strong> كإثبات غير حساس.
              </div>
            </div>

            {signupSecurityWarning && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{signupSecurityWarning}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  اسم المنصة أو التطبيق
                </label>
                <input
                  type="text"
                  value={fields.partnerName || ''}
                  onChange={(e) => updateFields({ partnerName: e.target.value })}
                  placeholder="مثال: منصة المتجر المحلي"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رابط التسجيل المباشر
                </label>
                <input
                  type="url"
                  value={fields.signupUrl || fields.offerUrl || ''}
                  onChange={(e) => updateFields({ signupUrl: e.target.value, offerUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                خطوات التسجيل وشروط الإثبات غير الحساس (كل خطوة في سطر)
              </label>
              <textarea
                rows={2}
                value={(fields.steps || []).join('\n')}
                onChange={(e) => updateFields({ steps: e.target.value.split('\n') })}
                placeholder={'افتح رابط التسجيل وأنشئ حساباً جديداً\nأرسل اسم المستخدم المسجل به فقط (دون أي كلمة مرور)'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        )}

        {/* H. CUSTOM PROOF */}
        {canonicalKind === 'custom_proof' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                وصف خطوات المهمة المخصصة (كل خطوة في سطر)
              </label>
              <textarea
                rows={2}
                value={(fields.steps || []).join('\n')}
                onChange={(e) => updateFields({ steps: e.target.value.split('\n') })}
                placeholder={'نفّذ المطلوب وفق التعليمات\nقدم الإثبات المحدد أدناه'}
                className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                ملاحظات إضافية للمنفذ
              </label>
              <input
                type="text"
                value={fields.customProofSummary || fields.proofNotes || ''}
                onChange={(e) => updateFields({ customProofSummary: e.target.value, proofNotes: e.target.value })}
                placeholder="مثال: أدخل الرمز الظاهر نهاية الصفحة..."
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        )}

        {/* 3. Difficulty + Acceptance & Rejection Criteria */}
        <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                مستوى صعوبة المهمة
              </label>
              <div className="flex items-center gap-1.5">
                {TASK_DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onChange({ ...meta, difficulty: d.id })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                      difficulty === d.id
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {d.labelAr}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                شروط القبول السريع (اختياري)
              </label>
              <input
                type="text"
                value={meta.acceptanceCriteria || ''}
                onChange={(e) => onChange({ ...meta, acceptanceCriteria: e.target.value })}
                placeholder="مثال: حساب نشط وظاهر للاسم"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                أسباب الرفض المحتملة (اختياري)
              </label>
              <input
                type="text"
                value={meta.rejectionCriteria || ''}
                onChange={(e) => onChange({ ...meta, rejectionCriteria: e.target.value })}
                placeholder="مثال: إلغاء المتابعة قبل المراجعة"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* 4. Dynamic Proof Config Builder (No hardcoded mandatory screenshots!) */}
        <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
              <span>نظام الإثبات المطلوب لهذه المهمة (مرن ومخصص لكل مهمة)</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              يظهر للمنفذ ما تختاره هنا فقط
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {TASK_PROOF_MODE_OPTIONS.map((opt) => {
              const checked = activeModes.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`p-2.5 rounded-xl border cursor-pointer flex items-start gap-2.5 transition-all ${
                    checked
                      ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-500'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-emerald-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProofMode(opt.id)}
                    className="w-4 h-4 mt-0.5 rounded text-emerald-600"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">{opt.labelAr}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{opt.descriptionAr}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Conditional Sub-Editors for Selected Proof Modes */}
          {activeModes.includes('text') && (
            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                عنوان/توجيه حقل الإجابة النصية للمنفذ
              </label>
              <input
                type="text"
                value={normalizedProof.proofPromptText || ''}
                onChange={(e) => updateProofConfig({ proofPromptText: e.target.value })}
                placeholder="مثال: اكتب اسم حسابك المسجل أو ملخص تجربتك..."
                className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
          )}

          {activeModes.includes('choice') && (
            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>إعداد سؤال الاختيار</span>
                </span>
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(normalizedProof.choiceMultiSelect)}
                    onChange={(e) => updateProofConfig({ choiceMultiSelect: e.target.checked })}
                    className="w-3.5 h-3.5 rounded text-emerald-600"
                  />
                  <span>السماح باختيار أكثر من إجابة</span>
                </label>
              </div>
              <input
                type="text"
                value={normalizedProof.choiceQuestion || ''}
                onChange={(e) => updateProofConfig({ choiceQuestion: e.target.value })}
                placeholder="اكتب نص السؤال الاختياري للمنفذ..."
                className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
              <textarea
                rows={3}
                value={(normalizedProof.choiceOptions || []).join('\n')}
                onChange={(e) =>
                  updateProofConfig({
                    choiceOptions: e.target.value.split('\n').map((x) => x),
                  })
                }
                placeholder={'اكتب كل خيار في سطر مستقل:\nالخيار الأول\nالخيار الثاني'}
                className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
          )}

          {activeModes.includes('multi_question') && (
            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                  الأسئلة المتتابعة المدمجة داخل المهمة ({inlineQuestions.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateInlineQuestions([
                      ...inlineQuestions,
                      {
                        id: `iq_${Date.now().toString(36)}_${inlineQuestions.length + 1}`,
                        surveyId: 'inline',
                        orderIndex: inlineQuestions.length,
                        questionText: '',
                        questionType: 'short_text',
                        isRequired: true,
                        options: [],
                        branchRules: [],
                      },
                    ])
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة سؤال</span>
                </button>
              </div>

              {inlineQuestions.map((iq, idx) => {
                const needsOpts =
                  iq.questionType === 'single_choice' ||
                  iq.questionType === 'multiple_choice' ||
                  iq.questionType === 'yes_no';
                return (
                  <div
                    key={iq.id}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-emerald-600">#{idx + 1}</span>
                        <select
                          value={iq.questionType}
                          onChange={(e) => {
                            const nextType = e.target.value as SurveyQuestionType;
                            updateInlineQuestions(
                              inlineQuestions.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      questionType: nextType,
                                      options:
                                        nextType === 'yes_no'
                                          ? [
                                              { id: `${item.id}_y`, questionId: item.id, orderIndex: 0, optionText: 'نعم', nextQuestionId: null },
                                              { id: `${item.id}_n`, questionId: item.id, orderIndex: 1, optionText: 'لا', nextQuestionId: null },
                                            ]
                                          : nextType === 'single_choice' || nextType === 'multiple_choice'
                                            ? item.options.length > 0
                                              ? item.options
                                              : [
                                                  { id: `${item.id}_1`, questionId: item.id, orderIndex: 0, optionText: 'خيار 1', nextQuestionId: null },
                                                  { id: `${item.id}_2`, questionId: item.id, orderIndex: 1, optionText: 'خيار 2', nextQuestionId: null },
                                                ]
                                            : [],
                                    }
                                  : item
                              )
                            );
                          }}
                          className="px-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold"
                        >
                          {INLINE_Q_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.labelAr}
                            </option>
                          ))}
                        </select>
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={iq.isRequired}
                            onChange={(e) =>
                              updateInlineQuestions(
                                inlineQuestions.map((item, i) =>
                                  i === idx ? { ...item, isRequired: e.target.checked } : item
                                )
                              )
                            }
                            className="w-3.5 h-3.5 rounded text-emerald-600"
                          />
                          <span>إلزامي</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateInlineQuestions(inlineQuestions.filter((_, i) => i !== idx))}
                        className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                        title="حذف السؤال"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={iq.questionText}
                      onChange={(e) =>
                        updateInlineQuestions(
                          inlineQuestions.map((item, i) =>
                            i === idx ? { ...item, questionText: e.target.value } : item
                          )
                        )
                      }
                      placeholder="نص السؤال..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />

                    {needsOpts && (
                      <textarea
                        rows={2}
                        value={(iq.options || []).map((o) => o.optionText).join('\n')}
                        onChange={(e) => {
                          const lines = e.target.value.split('\n');
                          updateInlineQuestions(
                            inlineQuestions.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    options: lines.map((txt, oi) => ({
                                      id: `${item.id}_o_${oi + 1}`,
                                      questionId: item.id,
                                      orderIndex: oi,
                                      optionText: txt,
                                      nextQuestionId: null,
                                    })),
                                  }
                                : item
                            )
                          );
                        }}
                        placeholder="خيار في كل سطر..."
                        className="w-full p-2 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Visual Card Design & Custom Artwork Selection */}
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

        {/* 6. Featured Toggle */}
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
  const canonicalKind = toCanonicalTaskKind(meta.taskKind, category);
  const normalizedProof = normalizeProofRequirements(meta.proofConfig, meta, meta.taskKind);

  const previewTask: TaskItem = {
    id: 'preview-task',
    title: title.trim() || 'عنوان المهمة سيظهر هنا للمستخدمين...',
    description: description.trim() || 'وصف المهمة المختصر وتعليماتها سيظهر هنا للمنفذين...',
    category: mapTaskKindToCategory(meta.taskKind, category),
    taskKind: canonicalKind,
    difficulty: meta.difficulty || 'easy',
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
    steps: (meta.fields?.steps || []).filter(Boolean),
    proofRequirements: normalizedProof,
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
