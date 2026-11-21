import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  Save,
  Image as ImageIcon,
  Upload,
  RefreshCw,
  Pencil,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  GitBranch,
  Copy,
  Layers,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type {
  SurveyBranchRule,
  SurveyItem,
  SurveyOption,
  SurveyQuestion,
  SurveyQuestionType,
  TaskAssetItem,
  TaskCategoryItem,
} from '../../types/index.ts';
import { formatYer } from '../../../shared/money.ts';
import { SUPABASE_TASK_ASSET_URLS } from '../../../shared/taskMeta.ts';
import { SurveyRunnerModal } from '../tasks/SurveyRunnerModal.tsx';

const QUESTION_TYPE_LABELS: Array<{ id: SurveyQuestionType; labelAr: string }> = [
  { id: 'single_choice', labelAr: 'اختيار من متعدد (إجابة واحدة)' },
  { id: 'multiple_choice', labelAr: 'اختيار متعدد (أكثر من إجابة)' },
  { id: 'yes_no', labelAr: 'نعم أو لا' },
  { id: 'short_text', labelAr: 'نص قصير' },
  { id: 'long_text', labelAr: 'نص طويل' },
  { id: 'number', labelAr: 'إجابة رقمية' },
  { id: 'rating_1_5', labelAr: 'تقييم رقمي / نجوم (1 إلى 5)' },
];

function createEmptyQuestion(orderIndex: number): SurveyQuestion {
  const qId = `q_${crypto.randomUUID().slice(0, 8)}`;
  return {
    id: qId,
    surveyId: 'draft',
    orderIndex,
    questionText: '',
    questionType: 'single_choice',
    isRequired: true,
    options: [
      { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: qId, orderIndex: 0, optionText: 'الخيار الأول', nextQuestionId: null },
      { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: qId, orderIndex: 1, optionText: 'الخيار الثاني', nextQuestionId: null },
    ],
    branchRules: [],
  };
}

export const AdminSurveysAndAssetsView: React.FC = () => {
  const { showToast, openConfirmModal } = useAuth();
  const [subTab, setSubTab] = useState<'surveys' | 'assets'>('surveys');

  // Shared state
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [assets, setAssets] = useState<TaskAssetItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Survey Builder state
  const [isEditingSurvey, setIsEditingSurvey] = useState(false);
  const [editingSurveyId, setEditingSurveyId] = useState<string | null>(null);
  const [surveyTitle, setSurveyTitle] = useState('');
  const [surveyDesc, setSurveyDesc] = useState('');
  const [surveyReward, setSurveyReward] = useState('15');
  const [surveyMinutes, setSurveyMinutes] = useState('5');
  const [surveyMaxParticipants, setSurveyMaxParticipants] = useState('100');
  const [surveyMaxAttempts, setSurveyMaxAttempts] = useState('1');
  const [surveyStatus, setSurveyStatus] = useState<SurveyItem['status']>('active');
  const [surveyFeatured, setSurveyFeatured] = useState(false);
  const [surveySortOrder, setSurveySortOrder] = useState('0');
  const [surveyImageUrl, setSurveyImageUrl] = useState<string>(SUPABASE_TASK_ASSET_URLS.surveys);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([createEmptyQuestion(0)]);
  const [dragQuestionIdx, setDragQuestionIdx] = useState<number | null>(null);
  const [isSavingSurvey, setIsSavingSurvey] = useState(false);
  const [previewSurveyObj, setPreviewSurveyObj] = useState<SurveyItem | null>(null);

  // Asset Upload state
  const [assetTitle, setAssetTitle] = useState('');
  const [assetKind, setAssetKind] = useState<'task_illustration' | 'category_icon' | 'provider_logo'>('task_illustration');
  const [assetTaskKind, setAssetTaskKind] = useState('surveys');
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [savingCategorySlug, setSavingCategorySlug] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sRes, aRes, cRes] = await Promise.all([
        api.getAdminSurveys().catch(() => ({ surveys: [] })),
        api.getAdminAssets().catch(() => ({ assets: [] })),
        api.getTaskCategories().catch(() => ({ categories: [] })),
      ]);
      setSurveys(sRes.surveys || []);
      setAssets(aRes.assets || []);
      setCategories(cRes.categories || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const resetSurveyForm = () => {
    setEditingSurveyId(null);
    setSurveyTitle('');
    setSurveyDesc('');
    setSurveyReward('15');
    setSurveyMinutes('5');
    setSurveyMaxParticipants('100');
    setSurveyMaxAttempts('1');
    setSurveyStatus('active');
    setSurveyFeatured(false);
    setSurveySortOrder('0');
    setSurveyImageUrl(SUPABASE_TASK_ASSET_URLS.surveys);
    setQuestions([createEmptyQuestion(0)]);
  };

  const openEditSurvey = (s: SurveyItem) => {
    setEditingSurveyId(s.id);
    setSurveyTitle(s.title);
    setSurveyDesc(s.description || '');
    setSurveyReward(String(s.rewardYer));
    setSurveyMinutes(String(s.estimatedMinutes || 5));
    setSurveyMaxParticipants(String(s.maxParticipants || 100));
    setSurveyMaxAttempts(String(s.maxAttemptsPerUser || 1));
    setSurveyStatus(s.status);
    setSurveyFeatured(Boolean(s.isFeatured));
    setSurveySortOrder(String(s.sortOrder || 0));
    setSurveyImageUrl(s.imageUrl || SUPABASE_TASK_ASSET_URLS.surveys);
    setQuestions(
      s.questions && s.questions.length > 0
        ? s.questions.map((q, idx) => ({
            ...q,
            orderIndex: idx,
            options: (q.options || []).map((o, oIdx) => ({ ...o, orderIndex: oIdx })),
          }))
        : [createEmptyQuestion(0)]
    );
    setIsEditingSurvey(true);
  };

  const buildBranchRulesFromOptions = (opts: SurveyOption[]): SurveyBranchRule[] => {
    const rules: SurveyBranchRule[] = [];
    for (const o of opts) {
      if (o.nextQuestionId === 'END') {
        rules.push({ optionId: o.id, optionText: o.optionText, action: 'end', nextQuestionId: 'END' });
      } else if (o.nextQuestionId) {
        rules.push({ optionId: o.id, optionText: o.optionText, action: 'jump', nextQuestionId: o.nextQuestionId });
      }
    }
    return rules;
  };

  const handleQuestionTypeChange = (qIdx: number, nextType: SurveyQuestionType) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        let nextOpts = q.options;
        if (nextType === 'yes_no' && q.options.length === 0) {
          nextOpts = [
            { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: q.id, orderIndex: 0, optionText: 'نعم', nextQuestionId: null },
            { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: q.id, orderIndex: 1, optionText: 'لا', nextQuestionId: null },
          ];
        } else if ((nextType === 'single_choice' || nextType === 'multiple_choice') && q.options.length === 0) {
          nextOpts = [
            { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: q.id, orderIndex: 0, optionText: 'الخيار الأول', nextQuestionId: null },
            { id: `opt_${crypto.randomUUID().slice(0, 8)}`, questionId: q.id, orderIndex: 1, optionText: 'الخيار الثاني', nextQuestionId: null },
          ];
        } else if (nextType === 'short_text' || nextType === 'long_text' || nextType === 'number' || nextType === 'rating_1_5') {
          nextOpts = [];
        }
        return {
          ...q,
          questionType: nextType,
          options: nextOpts,
          branchRules: buildBranchRulesFromOptions(nextOpts),
        };
      })
    );
  };

  const moveQuestion = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= questions.length || fromIdx === toIdx) return;
    setQuestions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy.map((q, i) => ({ ...q, orderIndex: i }));
    });
  };

  const buildSurveyPayload = () => {
    const cleanQuestions = questions.map((q, qIdx) => {
      const needsOpts = q.questionType === 'single_choice' || q.questionType === 'multiple_choice' || q.questionType === 'yes_no';
      const cleanOptions = needsOpts
        ? q.options
            .map((o, oIdx) => ({
              id: o.id,
              optionText: o.optionText.trim() || `خيار ${oIdx + 1}`,
              orderIndex: oIdx,
              nextQuestionId: o.nextQuestionId || null,
            }))
            .filter((o) => Boolean(o.optionText))
        : [];
      return {
        id: q.id,
        questionText: q.questionText.trim(),
        questionType: q.questionType,
        isRequired: q.isRequired,
        imageUrl: q.imageUrl?.trim() || null,
        orderIndex: qIdx,
        options: cleanOptions,
        branchRules: buildBranchRulesFromOptions(
          cleanOptions.map((o) => ({ ...o, questionId: q.id }))
        ),
      };
    });

    return {
      title: surveyTitle.trim(),
      description: surveyDesc.trim(),
      imageUrl: surveyImageUrl || SUPABASE_TASK_ASSET_URLS.surveys,
      rewardYer: Math.max(0.000001, Number(surveyReward) || 1),
      estimatedMinutes: Math.max(1, Number(surveyMinutes) || 5),
      maxParticipants: Math.max(1, Number(surveyMaxParticipants) || 100),
      maxAttemptsPerUser: Math.max(1, Number(surveyMaxAttempts) || 1),
      status: surveyStatus,
      isFeatured: surveyFeatured,
      sortOrder: Number(surveySortOrder) || 0,
      questions: cleanQuestions,
    };
  };

  const handleOpenLivePreview = () => {
    if (questions.some((q) => !q.questionText.trim())) {
      showToast('يرجى كتابة نص جميع الأسئلة قبل المعاينة.', 'error');
      return;
    }
    const payload = buildSurveyPayload();
    setPreviewSurveyObj({
      id: editingSurveyId || 'preview',
      title: payload.title || 'معاينة استبيان جديد',
      description: payload.description || 'معاينة لتدفق الأسئلة والتفريع قبل النشر.',
      imageUrl: payload.imageUrl,
      rewardYer: payload.rewardYer,
      estimatedMinutes: payload.estimatedMinutes,
      maxParticipants: payload.maxParticipants,
      completedParticipants: 0,
      maxAttemptsPerUser: payload.maxAttemptsPerUser,
      status: payload.status,
      isFeatured: payload.isFeatured,
      sortOrder: payload.sortOrder,
      questions: payload.questions.map((q) => ({
        ...q,
        surveyId: editingSurveyId || 'preview',
        options: q.options.map((o) => ({ ...o, questionId: q.id })),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSaveSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surveyTitle.trim()) {
      showToast('عنوان الاستبيان مطلوب.', 'error');
      return;
    }
    if (questions.length === 0 || questions.some((q) => !q.questionText.trim())) {
      showToast('يرجى إضافة سؤال واحد على الأقل وكتابة نص جميع الأسئلة.', 'error');
      return;
    }
    setIsSavingSurvey(true);
    try {
      const payload = buildSurveyPayload();
      if (editingSurveyId) {
        await api.updateAdminSurvey(editingSurveyId, payload);
        showToast('تم تحديث الاستبيان وحفظ جميع الأسئلة بنجاح.', 'success');
      } else {
        await api.createAdminSurvey(payload);
        showToast('تم إنشاء الاستبيان ونشره في قاعدة البيانات بنجاح!', 'success');
      }
      setIsEditingSurvey(false);
      resetSurveyForm();
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل حفظ الاستبيان.', 'error');
    } finally {
      setIsSavingSurvey(false);
    }
  };

  const handleToggleSurveyStatus = async (s: SurveyItem) => {
    const nextStatus = s.status === 'active' ? 'paused' : 'active';
    try {
      await api.updateAdminSurvey(s.id, { status: nextStatus });
      showToast(nextStatus === 'active' ? 'تم تفعيل الاستبيان.' : 'تم إيقاف الاستبيان مؤقتاً.', 'info');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تغيير حالة الاستبيان.', 'error');
    }
  };

  const handleDeleteSurvey = (s: SurveyItem) => {
    openConfirmModal({
      title: 'حذف الاستبيان',
      message: `هل تريد حذف الاستبيان "${s.title}" نهائياً؟`,
      confirmLabel: 'تأكيد الحذف',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminSurvey(s.id);
          showToast('تم حذف الاستبيان.', 'success');
          await loadAll();
        } catch (err: any) {
          showToast(err?.message || 'تعذر حذف الاستبيان.', 'error');
        }
      },
    });
  };

  const handleAssetFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, overrideKind?: 'task_illustration' | 'category_icon' | 'provider_logo', onUploaded?: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast('الحد الأقصى لحجم الصورة 4 ميجابايت.', 'error');
      return;
    }
    setIsUploadingAsset(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(file);
      });
      const res = await api.uploadAdminTaskAsset({
        title: assetTitle.trim() || file.name.replace(/\.[^.]+$/, ''),
        assetKind: overrideKind || assetKind,
        taskKind: (overrideKind || assetKind) === 'task_illustration' ? assetTaskKind : null,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        base64Data,
      });
      showToast('تم رفع الصورة بنجاح إلى Supabase Storage (task-assets)!', 'success');
      setAssetTitle('');
      if (res.asset?.publicUrl && onUploaded) {
        onUploaded(res.asset.publicUrl);
      }
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل رفع الصورة إلى التخزين.', 'error');
    } finally {
      setIsUploadingAsset(false);
      e.target.value = '';
    }
  };

  const handleDeleteAsset = (asset: TaskAssetItem) => {
    openConfirmModal({
      title: 'حذف صورة من المكتبة',
      message: `هل تريد حذف "${asset.title}" من مكتبة الصور والتخزين السحابي؟`,
      confirmLabel: 'حذف',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminTaskAsset(asset.id);
          showToast('تم حذف الصورة من المكتبة.', 'success');
          await loadAll();
        } catch (err: any) {
          showToast(err?.message || 'تعذر حذف الصورة.', 'error');
        }
      },
    });
  };

  const handleSaveCategory = async (cat: TaskCategoryItem) => {
    setSavingCategorySlug(cat.slug);
    try {
      await api.upsertAdminTaskCategory(cat.slug, {
        labelAr: cat.labelAr,
        iconUrl: cat.iconUrl || null,
        badgeColor: cat.badgeColor,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      });
      showToast(`تم حفظ إعدادات تصنيف "${cat.labelAr}" بنجاح.`, 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل تحديث التصنيف.', 'error');
    } finally {
      setSavingCategorySlug(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('surveys')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 transition-colors ${
              subTab === 'surveys'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>منشئ الاستبيانات التفاعلية ({surveys.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('assets')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 transition-colors ${
              subTab === 'assets'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span>مكتبة الصور وأيقونات التصنيفات ({assets.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      </div>

      {/* SUB-TAB 1: SURVEY BUILDER */}
      {subTab === 'surveys' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                إدارة وبناء الاستبيانات المتسلسلة (Sequential Survey Builder)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                صمم استبيانات متعددة الأسئلة مع دعم 6 أنواع أسئلة والتفريع الشرطي وترتيب الأسئلة ومعاينة فورية.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isEditingSurvey) {
                  setIsEditingSurvey(false);
                  resetSurveyForm();
                } else {
                  resetSurveyForm();
                  setIsEditingSurvey(true);
                }
              }}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
            >
              {isEditingSurvey ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{isEditingSurvey ? 'إغلاق منشئ الاستبيان' : 'إنشاء استبيان تفاعلي جديد'}</span>
            </button>
          </div>

          {/* Survey Form & Question Builder */}
          {isEditingSurvey && (
            <form
              onSubmit={handleSaveSurvey}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-900/60 p-5 sm:p-6 shadow-sm space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  {editingSurveyId ? 'تعديل الاستبيان وأسئلته' : 'تصميم استبيان تفاعلي جديد'}
                </h3>
                <button
                  type="button"
                  onClick={handleOpenLivePreview}
                  className="px-3.5 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-extrabold inline-flex items-center gap-1.5"
                >
                  <Eye className="w-4 h-4" />
                  <span>معاينة الاستبيان التفاعلي</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    عنوان الاستبيان
                  </label>
                  <input
                    type="text"
                    required
                    value={surveyTitle}
                    onChange={(e) => setSurveyTitle(e.target.value)}
                    placeholder="مثال: استبيان قياس رضا المستخدمين عن خدمات الدفع الإلكتروني"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    الحالة
                  </label>
                  <select
                    value={surveyStatus}
                    onChange={(e) => setSurveyStatus(e.target.value as SurveyItem['status'])}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    <option value="active">نشط ومتاح للمستخدمين</option>
                    <option value="draft">مسودة (مخفي)</option>
                    <option value="paused">موقوف مؤقتاً</option>
                    <option value="completed">مكتمل</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    وصف ترحيبي للاستبيان (يظهر في شاشة الترحيب وبطاقة المهمة)
                  </label>
                  <textarea
                    rows={2}
                    value={surveyDesc}
                    onChange={(e) => setSurveyDesc(e.target.value)}
                    placeholder="أجب على أسئلة قصيرة وسريعة واكسب مكافأتك فور الإرسال..."
                    className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    المكافأة عند الإكمال (ر.ي - حتى 6 خانات عشرية)
                  </label>
                  <input
                    type="number"
                    required
                    min="0.000001"
                    step="any"
                    value={surveyReward}
                    onChange={(e) => setSurveyReward(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    المدة المتوقعة (بالدقائق)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={surveyMinutes}
                    onChange={(e) => setSurveyMinutes(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    الحد الأقصى للمشاركين
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={surveyMaxParticipants}
                    onChange={(e) => setSurveyMaxParticipants(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    المحاولات المسموحة لكل مستخدم
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={surveyMaxAttempts}
                    onChange={(e) => setSurveyMaxAttempts(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    ترتيب العرض
                  </label>
                  <input
                    type="number"
                    value={surveySortOrder}
                    onChange={(e) => setSurveySortOrder(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={surveyFeatured}
                      onChange={(e) => setSurveyFeatured(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600"
                    />
                    <span>تمييز الاستبيان (شارة مميزة)</span>
                  </label>
                </div>
              </div>

              {/* Survey Illustration Picker */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                    صورة غلاف الاستبيان (من Supabase Storage)
                  </span>
                  <label className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>رفع صورة جديدة</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => handleAssetFileUpload(e, 'task_illustration', (url) => setSurveyImageUrl(url))}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {assets
                    .filter((a) => a.assetKind !== 'category_icon')
                    .map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => setSurveyImageUrl(asset.publicUrl)}
                        className={`relative shrink-0 w-20 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                          surveyImageUrl === asset.publicUrl
                            ? 'border-emerald-600 ring-2 ring-emerald-500/30'
                            : 'border-slate-200 dark:border-slate-700 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img src={asset.publicUrl} alt={asset.title} className="w-full h-full object-cover" />
                      </button>
                    ))}
                </div>
              </div>

              {/* Questions List Builder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>أسئلة الاستبيان المتسلسلة ({questions.length})</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setQuestions((prev) => [...prev, createEmptyQuestion(prev.length)])}
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-extrabold inline-flex items-center gap-1.5 hover:bg-emerald-100"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة سؤال جديد</span>
                  </button>
                </div>

                {questions.map((q, qIdx) => {
                  const hasOptions =
                    q.questionType === 'single_choice' ||
                    q.questionType === 'multiple_choice' ||
                    q.questionType === 'yes_no';
                  const subsequentQuestions = questions.slice(qIdx + 1);

                  return (
                    <div
                      key={q.id}
                      draggable
                      onDragStart={() => setDragQuestionIdx(qIdx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragQuestionIdx !== null && dragQuestionIdx !== qIdx) {
                          moveQuestion(dragQuestionIdx, qIdx);
                        }
                        setDragQuestionIdx(null);
                      }}
                      className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold font-mono">
                            سؤال #{qIdx + 1}
                          </span>
                          <select
                            value={q.questionType}
                            onChange={(e) => handleQuestionTypeChange(qIdx, e.target.value as SurveyQuestionType)}
                            className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-200"
                          >
                            {QUESTION_TYPE_LABELS.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.labelAr}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={q.isRequired}
                              onChange={(e) =>
                                setQuestions((prev) =>
                                  prev.map((item, i) => (i === qIdx ? { ...item, isRequired: e.target.checked } : item))
                                )
                              }
                              className="w-4 h-4 rounded text-emerald-600"
                            />
                            <span>إلزامي</span>
                          </label>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveQuestion(qIdx, qIdx - 1)}
                            disabled={qIdx === 0}
                            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 disabled:opacity-40"
                            title="تحريك للأعلى"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveQuestion(qIdx, qIdx + 1)}
                            disabled={qIdx === questions.length - 1}
                            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 disabled:opacity-40"
                            title="تحريك للأسفل"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((prev) =>
                                prev.length > 1 ? prev.filter((_, i) => i !== qIdx).map((x, i) => ({ ...x, orderIndex: i })) : prev
                              )
                            }
                            disabled={questions.length <= 1}
                            className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 disabled:opacity-40"
                            title="حذف السؤال"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        required
                        value={q.questionText}
                        onChange={(e) =>
                          setQuestions((prev) =>
                            prev.map((item, i) => (i === qIdx ? { ...item, questionText: e.target.value } : item))
                          )
                        }
                        placeholder="اكتب نص السؤال هنا بوضوح..."
                        className="w-full px-3.5 py-2.5 text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          type="url"
                          value={q.imageUrl || ''}
                          onChange={(e) =>
                            setQuestions((prev) =>
                              prev.map((item, i) => (i === qIdx ? { ...item, imageUrl: e.target.value || null } : item))
                            )
                          }
                          placeholder="رابط صورة توضيحية للسؤال (اختياري https://...)"
                          className="flex-1 px-3 py-1.5 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                        />
                        {q.imageUrl && (
                          <img
                            src={q.imageUrl}
                            alt="معاينة صورة السؤال"
                            className="w-12 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        )}
                      </div>

                      {hasOptions && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                            <span>الخيارات وقواعد الانتقال الشرطي (Conditional Branching)</span>
                            <button
                              type="button"
                              onClick={() =>
                                setQuestions((prev) =>
                                  prev.map((item, i) =>
                                    i === qIdx
                                      ? {
                                          ...item,
                                          options: [
                                            ...item.options,
                                            {
                                              id: `opt_${crypto.randomUUID().slice(0, 8)}`,
                                              questionId: item.id,
                                              orderIndex: item.options.length,
                                              optionText: `خيار ${item.options.length + 1}`,
                                              nextQuestionId: null,
                                            },
                                          ],
                                        }
                                      : item
                                  )
                                )
                              }
                              className="text-emerald-600 hover:underline inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              <span>إضافة خيار</span>
                            </button>
                          </div>

                          {q.options.map((opt, oIdx) => (
                            <div key={opt.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <input
                                type="text"
                                value={opt.optionText}
                                onChange={(e) =>
                                  setQuestions((prev) =>
                                    prev.map((item, i) =>
                                      i === qIdx
                                        ? {
                                            ...item,
                                            options: item.options.map((o, oi) =>
                                              oi === oIdx ? { ...o, optionText: e.target.value } : o
                                            ),
                                          }
                                        : item
                                    )
                                  )
                                }
                                placeholder={`نص الخيار ${oIdx + 1}`}
                                className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                              />
                              <div className="flex items-center gap-1.5">
                                <GitBranch className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <select
                                  value={opt.nextQuestionId || ''}
                                  onChange={(e) => {
                                    const val = e.target.value || null;
                                    setQuestions((prev) =>
                                      prev.map((item, i) =>
                                        i === qIdx
                                          ? {
                                              ...item,
                                              options: item.options.map((o, oi) =>
                                                oi === oIdx ? { ...o, nextQuestionId: val } : o
                                              ),
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                  className="px-2.5 py-2 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300"
                                >
                                  <option value="">التالي التلقائي</option>
                                  <option value="END">إنهاء والانتقال للمراجعة النهائية</option>
                                  {subsequentQuestions.map((sq, sIdx) => (
                                    <option key={sq.id} value={sq.id}>
                                      الانتقال إلى سؤال #{qIdx + 2 + sIdx}: {sq.questionText.slice(0, 26) || 'سؤال'}
                                    </option>
                                  ))}
                                </select>
                                {q.options.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setQuestions((prev) =>
                                        prev.map((item, i) =>
                                          i === qIdx
                                            ? { ...item, options: item.options.filter((_, oi) => oi !== oIdx) }
                                            : item
                                        )
                                      )
                                    }
                                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingSurvey(false);
                    resetSurveyForm();
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleOpenLivePreview}
                  className="px-4 py-2.5 rounded-xl text-xs font-extrabold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 inline-flex items-center gap-1.5"
                >
                  <Eye className="w-4 h-4" />
                  <span>معاينة التفاعلية</span>
                </button>
                <button
                  type="submit"
                  disabled={isSavingSurvey}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {isSavingSurvey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{editingSurveyId ? 'حفظ تعديلات الاستبيان' : 'حفظ ونشر الاستبيان'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Existing Surveys List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {surveys.map((s) => (
              <div
                key={s.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3 shadow-sm"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                        s.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : s.status === 'paused'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {s.status === 'active' ? 'نشط' : s.status === 'paused' ? 'موقوف' : s.status === 'draft' ? 'مسودة' : 'مكتمل'}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-500">
                      {s.questions.length} أسئلة · {s.estimatedMinutes} د
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <img
                      src={s.imageUrl || SUPABASE_TASK_ASSET_URLS.surveys}
                      alt={s.title}
                      className="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="text-sm font-extrabold text-slate-900 dark:text-white line-clamp-1">{s.title}</h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{s.description}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                      {formatYer(s.rewardYer)} ر.ي
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      المشاركات: {s.completedParticipants} / {s.maxParticipants}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewSurveyObj(s)}
                      title="معاينة الاستبيان"
                      className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSurveyStatus(s)}
                      title={s.status === 'active' ? 'إيقاف مؤقت' : 'تفعيل'}
                      className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    >
                      {s.status === 'active' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditSurvey(s)}
                      title="تعديل الاستبيان"
                      className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSurvey(s)}
                      title="حذف الاستبيان"
                      className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SUPABASE STORAGE ASSETS & CATEGORY ICONS */}
      {subTab === 'assets' && (
        <div className="space-y-6">
          {/* Upload New Image Asset */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-sm">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-600" />
              <span>رفع صورة مهمة أو أيقونة تصنيف إلى Supabase Storage (task-assets)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الصورة / الوصف</label>
                <input
                  type="text"
                  value={assetTitle}
                  onChange={(e) => setAssetTitle(e.target.value)}
                  placeholder="مثال: أيقونة الروابط الذكية"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">استخدام الصورة</label>
                <select
                  value={assetKind}
                  onChange={(e) => setAssetKind(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="task_illustration">صورة بطاقة مهمة</option>
                  <option value="category_icon">أيقونة تصنيف علوي</option>
                  <option value="provider_logo">شعار مزود رابط ذكي</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">نوع المهمة المرتبط</label>
                <select
                  value={assetTaskKind}
                  onChange={(e) => setAssetTaskKind(e.target.value)}
                  disabled={assetKind === 'category_icon'}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl disabled:opacity-50"
                >
                  <option value="surveys">الاستبيانات</option>
                  <option value="video_watch">مشاهدة الفيديوهات</option>
                  <option value="website_visit">زيارة المواقع والروابط</option>
                  <option value="social_follow">متابعة الحسابات</option>
                  <option value="social_engagement">الإعجاب والتفاعل</option>
                  <option value="app_testing">تجربة التطبيقات</option>
                  <option value="account_signup">التسجيل وإنشاء الحسابات</option>
                  <option value="custom_proof">إثباتات مخصصة</option>
                </select>
              </div>
              <div>
                <label className="w-full min-h-[38px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2">
                  {isUploadingAsset ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  <span>{isUploadingAsset ? 'جارٍ الرفع...' : 'اختيار ورفع الصورة'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isUploadingAsset}
                    onChange={(e) => handleAssetFileUpload(e)}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden flex flex-col justify-between"
                >
                  <div className="relative h-28 bg-slate-100 dark:bg-slate-800">
                    <img src={asset.publicUrl} alt={asset.title} className="w-full h-full object-cover" />
                    <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-slate-900/75 text-white text-[9px] font-bold">
                      {asset.assetKind === 'category_icon' ? 'أيقونة تصنيف' : asset.assetKind === 'provider_logo' ? 'شعار مزوّد' : 'صورة مهمة'}
                    </span>
                  </div>
                  <div className="p-2.5 space-y-2">
                    <div className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={asset.title}>
                      {asset.title}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(asset.publicUrl);
                          showToast('تم نسخ رابط الصورة السحابي.', 'success');
                        }}
                        className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>نسخ</span>
                      </button>
                      {!asset.storagePath.startsWith('defaults/') && (
                        <button
                          type="button"
                          onClick={() => handleDeleteAsset(asset)}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="حذف الصورة"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Category Icons & Labels Manager */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-sm">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                تخصيص أيقونات وألوان التصنيفات (تظهر أعلى صفحة المهام للمستخدمين)
              </h3>
              <p className="text-xs text-slate-500">
                يمكنك رفع أيقونة خاصة أو اختيار صورة من المكتبة وتعديل اسم ولون الشارة وترتيب كل تصنيف.
              </p>
            </div>

            <div className="space-y-3">
              {categories.map((cat, idx) => (
                <div
                  key={cat.slug}
                  className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center gap-3 justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-white shrink-0">
                      {cat.iconUrl ? (
                        <img src={cat.iconUrl} alt={cat.labelAr} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">{cat.labelAr}</div>
                      <div className="text-[10px] font-mono text-slate-400">{cat.slug}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center flex-1">
                    <input
                      type="text"
                      value={cat.labelAr}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, labelAr: e.target.value } : c))
                        )
                      }
                      className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                      placeholder="اسم التصنيف"
                    />
                    <select
                      value={cat.iconUrl || ''}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, iconUrl: e.target.value || null } : c))
                        )
                      }
                      className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <option value="">اختر صورة أيقونة</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.publicUrl}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={cat.badgeColor || '#059669'}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, badgeColor: e.target.value } : c))
                          )
                        }
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="number"
                        value={cat.sortOrder}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, sortOrder: Number(e.target.value) || 0 } : c))
                          )
                        }
                        className="w-16 px-2 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                        title="الترتيب"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cat.isActive}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, isActive: e.target.checked } : c))
                          )
                        }
                        className="w-4 h-4 rounded text-emerald-600"
                      />
                      <span>ظاهر</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleSaveCategory(cat)}
                      disabled={savingCategorySlug === cat.slug}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {savingCategorySlug === cat.slug ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>حفظ</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Live Preview Modal */}
      {previewSurveyObj && (
        <SurveyRunnerModal
          previewSurvey={previewSurveyObj}
          onClose={() => setPreviewSurveyObj(null)}
        />
      )}
    </div>
  );
};
