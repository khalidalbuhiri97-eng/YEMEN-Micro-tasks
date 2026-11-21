import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Clock,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Star,
  AlertCircle,
  ClipboardList,
  Edit3,
  Sparkles,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SurveyAttempt, SurveyItem, SurveyQuestion } from '../../types/index.ts';
import { formatYer } from '../../../shared/money.ts';
import { SUPABASE_TASK_ASSET_URLS } from '../../../shared/taskMeta.ts';
import {
  evaluateSurveyPath,
  isSurveyQuestionAnswered,
  resolveSurveyNextQuestionIndex,
} from '../../../shared/surveyLogic.ts';

interface SurveyRunnerModalProps {
  surveyId?: string | null;
  previewSurvey?: SurveyItem | null;
  onClose: () => void;
  onCompleted?: () => void;
}

type Stage = 'welcome' | 'question' | 'review' | 'success';

const RATING_LABELS: Record<number, string> = {
  1: 'ضعيف جداً',
  2: 'مقبول',
  3: 'جيد',
  4: 'جيد جداً',
  5: 'ممتاز جداً',
};

export const SurveyRunnerModal: React.FC<SurveyRunnerModalProps> = ({
  surveyId,
  previewSurvey,
  onClose,
  onCompleted,
}) => {
  const { isOnline, refreshWallet, showToast } = useAuth();
  const isPreview = Boolean(previewSurvey);

  const [survey, setSurvey] = useState<SurveyItem | null>(previewSurvey || null);
  const [attempt, setAttempt] = useState<SurveyAttempt | null>(null);
  const [stage, setStage] = useState<Stage>('welcome');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [historyStack, setHistoryStack] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(!previewSurvey);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [rewardedAmount, setRewardedAmount] = useState(0);

  useEffect(() => {
    if (previewSurvey) {
      setSurvey(previewSurvey);
      setIsLoading(false);
      return;
    }
    if (!surveyId) return;
    let active = true;
    setIsLoading(true);
    setErrorMsg('');
    api
      .getSurveyById(surveyId)
      .then((res) => {
        if (!active) return;
        setSurvey(res.survey);
        if (res.survey.activeAttempt) {
          setAttempt(res.survey.activeAttempt);
          setAnswers(res.survey.activeAttempt.answers || {});
          const resumeIdx = Math.min(
            Math.max(0, res.survey.activeAttempt.currentQuestionIndex || 0),
            Math.max(0, (res.survey.questions?.length || 1) - 1)
          );
          setCurrentIdx(resumeIdx);
        }
      })
      .catch((err: any) => {
        if (active) setErrorMsg(err?.message || 'تعذر تحميل الاستبيان.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [surveyId, previewSurvey]);

  const orderedQuestions = useMemo<SurveyQuestion[]>(() => {
    return [...(survey?.questions || [])].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [survey]);

  const currentQuestion = orderedQuestions[currentIdx] || null;
  const activePath = useMemo(
    () => evaluateSurveyPath(orderedQuestions, answers),
    [orderedQuestions, answers]
  );

  const progressStep = useMemo(() => {
    if (!currentQuestion) return 0;
    const pos = activePath.visitedQuestions.findIndex((q) => q.id === currentQuestion.id);
    return pos >= 0 ? pos + 1 : currentIdx + 1;
  }, [activePath.visitedQuestions, currentQuestion, currentIdx]);

  const totalEstimatedSteps = Math.max(activePath.visitedQuestions.length, orderedQuestions.length, 1);
  const progressPercent =
    stage === 'review' || stage === 'success'
      ? 100
      : Math.min(100, Math.round((progressStep / totalEstimatedSteps) * 100));

  const handleStart = async () => {
    if (!survey) return;
    if (orderedQuestions.length === 0) {
      setErrorMsg('هذا الاستبيان لا يحتوي على أسئلة حالياً.');
      return;
    }
    setErrorMsg('');

    if (isPreview) {
      setCurrentIdx(0);
      setHistoryStack([]);
      setStage('question');
      return;
    }

    if (!isOnline) {
      setErrorMsg('بدء الاستبيان يتطلب اتصالاً بالإنترنت.');
      return;
    }

    setIsSavingStep(true);
    try {
      const res = await api.startSurvey(survey.id);
      setSurvey(res.survey);
      setAttempt(res.attempt);
      const savedAnswers = res.attempt.answers || {};
      setAnswers(savedAnswers);
      const resumeIdx = Math.min(
        Math.max(0, res.attempt.currentQuestionIndex || 0),
        Math.max(0, res.survey.questions.length - 1)
      );
      setCurrentIdx(resumeIdx);
      setHistoryStack([]);
      setStage('question');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر بدء الاستبيان.');
    } finally {
      setIsSavingStep(false);
    }
  };

  const setQuestionAnswer = (questionId: string, val: any) => {
    setErrorMsg('');
    setAnswers((prev) => ({ ...prev, [questionId]: val }));
  };

  const persistProgress = async (nextIdx: number, nextAnswers: Record<string, any>) => {
    if (isPreview || !attempt) return;
    try {
      await api.saveSurveyProgress(attempt.id, {
        currentQuestionIndex: nextIdx,
        answers: nextAnswers,
      });
    } catch {
      // Non-blocking background sync; retried on next step or submit
    }
  };

  const handleNext = async () => {
    if (!currentQuestion) return;
    const ans = answers[currentQuestion.id];
    if (currentQuestion.isRequired && !isSurveyQuestionAnswered(currentQuestion, ans)) {
      setErrorMsg('هذا السؤال إلزامي، يرجى اختيار أو كتابة إجابتك قبل الانتقال للسؤال التالي.');
      return;
    }
    setErrorMsg('');

    const nextTarget = resolveSurveyNextQuestionIndex(orderedQuestions, currentIdx, answers);
    if (nextTarget === 'REVIEW') {
      setHistoryStack((prev) => [...prev, currentIdx]);
      setIsSavingStep(true);
      await persistProgress(currentIdx, answers);
      setIsSavingStep(false);
      setStage('review');
      return;
    }

    setHistoryStack((prev) => [...prev, currentIdx]);
    setCurrentIdx(nextTarget);
    setIsSavingStep(true);
    await persistProgress(nextTarget, answers);
    setIsSavingStep(false);
  };

  const handlePrevious = async () => {
    setErrorMsg('');
    if (stage === 'review') {
      const lastIdx = historyStack.length > 0 ? historyStack[historyStack.length - 1] : Math.max(0, orderedQuestions.length - 1);
      setHistoryStack((prev) => prev.slice(0, -1));
      setCurrentIdx(lastIdx);
      setStage('question');
      return;
    }

    if (historyStack.length > 0) {
      const prevIdx = historyStack[historyStack.length - 1];
      setHistoryStack((prev) => prev.slice(0, -1));
      setCurrentIdx(prevIdx);
      await persistProgress(prevIdx, answers);
    } else if (currentIdx > 0) {
      const prevIdx = currentIdx - 1;
      setCurrentIdx(prevIdx);
      await persistProgress(prevIdx, answers);
    } else {
      setStage('welcome');
    }
  };

  const handleJumpToQuestionFromReview = (questionId: string) => {
    const targetIdx = orderedQuestions.findIndex((q) => q.id === questionId);
    if (targetIdx >= 0) {
      setCurrentIdx(targetIdx);
      setStage('question');
    }
  };

  const handleFinalSubmit = async () => {
    if (!survey) return;
    if (activePath.missingRequiredQuestions.length > 0) {
      const firstMissing = activePath.missingRequiredQuestions[0];
      setErrorMsg(`يرجى إكمال السؤال الإلزامي: "${firstMissing.questionText}"`);
      handleJumpToQuestionFromReview(firstMissing.id);
      return;
    }

    if (isPreview) {
      setRewardedAmount(survey.rewardYer);
      setStage('success');
      return;
    }

    if (!attempt) return;
    if (!isOnline) {
      setErrorMsg('إرسال الاستبيان يتطلب اتصالاً بالإنترنت.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      await api.saveSurveyProgress(attempt.id, {
        currentQuestionIndex: currentIdx,
        answers,
      });
      const res = await api.submitSurvey(attempt.id);
      setRewardedAmount(Number(res.rewardYer ?? survey.rewardYer));
      setStage('success');
      try {
        confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
      } catch {}
      showToast('تم إرسال الاستبيان وقيد المكافأة في محفظتك بنجاح!', 'success');
      refreshWallet();
      onCompleted?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر إرسال الاستبيان.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatAnswerPreview = (q: SurveyQuestion, ans: any): string => {
    if (ans === null || ans === undefined || ans === '') return 'لم يتم الإجابة (اختياري)';
    if (q.questionType === 'multiple_choice' && Array.isArray(ans)) {
      return ans
        .map((idOrText) => q.options.find((o) => o.id === idOrText)?.optionText || idOrText)
        .join('، ');
    }
    if ((q.questionType === 'single_choice' || q.questionType === 'yes_no') && typeof ans === 'string') {
      return q.options.find((o) => o.id === ans)?.optionText || ans;
    }
    if (q.questionType === 'rating_1_5') {
      const n = Number(ans);
      return `${n} / 5 (${RATING_LABELS[n] || ''})`;
    }
    return String(ans);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative w-full sm:max-w-xl max-h-[94vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                  {isPreview ? 'معاينة الاستبيان التفاعلي' : 'استبيان متسلسل'}
                </span>
                {survey && (
                  <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                    · {formatYer(survey.rewardYer)} ر.ي
                  </span>
                )}
              </div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                {survey?.title || 'تحميل الاستبيان...'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        {survey && stage !== 'welcome' && (
          <div className="px-5 py-2.5 bg-emerald-50/60 dark:bg-emerald-950/20 border-b border-emerald-100 dark:border-emerald-900/50 shrink-0">
            <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900 dark:text-emerald-300 mb-1.5">
              <span>
                {stage === 'review'
                  ? 'المراجعة النهائية قبل الإرسال'
                  : stage === 'success'
                    ? 'تم الإرسال بنجاح'
                    : `السؤال ${progressStep} من ${totalEstimatedSteps}`}
              </span>
              <span className="font-mono tabular-nums">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-emerald-200/70 dark:border-emerald-900">
              <div
                className="h-full bg-gradient-to-l from-emerald-500 to-emerald-600 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
              <span className="text-xs font-bold">جارٍ تحميل الاستبيان...</span>
            </div>
          ) : errorMsg && !survey ? (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : survey && stage === 'welcome' ? (
            <div className="space-y-5">
              <div className="relative rounded-2xl overflow-hidden border border-emerald-100 dark:border-emerald-900/60 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/50 dark:to-slate-900">
                <img
                  src={survey.imageUrl || SUPABASE_TASK_ASSET_URLS.surveys}
                  alt={survey.title}
                  className="w-full h-44 object-cover"
                />
                <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold shadow-md">
                  {orderedQuestions.length} أسئلة تفاعلية
                </div>
              </div>

              <div>
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                  {survey.title}
                </h3>
                {survey.description && (
                  <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {survey.description}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/50 text-center">
                  <span className="block text-[10px] text-amber-700 dark:text-amber-300 font-semibold">المكافأة</span>
                  <span className="text-sm sm:text-base font-extrabold font-mono text-amber-600 dark:text-amber-400">
                    {formatYer(survey.rewardYer)} <span className="text-[11px]">ر.ي</span>
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-semibold">الوقت المتوقع</span>
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white inline-flex items-center gap-1 justify-center">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{survey.estimatedMinutes} د</span>
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-semibold">المتبقي</span>
                  <span className="text-sm font-extrabold font-mono text-emerald-700 dark:text-emerald-400">
                    {Math.max(0, survey.maxParticipants - survey.completedParticipants)} من {survey.maxParticipants}
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {survey.userCompleted && !isPreview ? (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>لقد أتممت هذا الاستبيان مسبقاً ولا يمكن إعادة إرساله.</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={isSavingStep}
                  className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all"
                >
                  {isSavingStep ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>{attempt ? 'استكمال الاستبيان من حيث توقفت' : 'بدء الاستبيان الآن'}</span>
                      <ArrowLeft className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          ) : survey && stage === 'question' && currentQuestion ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    currentQuestion.isRequired
                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {currentQuestion.isRequired ? 'إجابة إلزامية' : 'سؤال اختياري'}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {currentQuestion.questionType === 'single_choice'
                    ? 'اختيار واحد'
                    : currentQuestion.questionType === 'multiple_choice'
                      ? 'اختيار متعدد'
                      : currentQuestion.questionType === 'yes_no'
                        ? 'نعم أو لا'
                        : currentQuestion.questionType === 'rating_1_5'
                          ? 'تقييم بالنجوم (1-5)'
                          : currentQuestion.questionType === 'number'
                            ? 'رقم / قيمة عددية'
                            : currentQuestion.questionType === 'long_text'
                              ? 'نص طويل'
                              : 'نص قصير'}
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-relaxed">
                {currentQuestion.questionText}
              </h3>

              {currentQuestion.imageUrl && (
                <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                  <img
                    src={currentQuestion.imageUrl}
                    alt={currentQuestion.questionText}
                    className="w-full max-h-52 object-contain mx-auto"
                  />
                </div>
              )}

              {/* Question Input UI */}
              <div className="space-y-2.5 pt-1">
                {(currentQuestion.questionType === 'single_choice' || currentQuestion.questionType === 'yes_no') && (
                  <div className="grid grid-cols-1 gap-2.5 max-h-[340px] overflow-y-auto pl-1">
                    {(currentQuestion.options.length > 0
                      ? currentQuestion.options
                      : currentQuestion.questionType === 'yes_no'
                        ? [
                            { id: 'نعم', questionId: currentQuestion.id, orderIndex: 0, optionText: 'نعم' },
                            { id: 'لا', questionId: currentQuestion.id, orderIndex: 1, optionText: 'لا' },
                          ]
                        : []
                    ).map((opt) => {
                      const selected = answers[currentQuestion.id] === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setQuestionAnswer(currentQuestion.id, opt.id)}
                          className={`w-full p-4 rounded-2xl border text-right transition-all flex items-center justify-between gap-3 ${
                            selected
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 ring-2 ring-emerald-500/20 text-emerald-950 dark:text-white'
                              : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-emerald-400'
                          }`}
                        >
                          <span className="text-xs sm:text-sm font-bold">{opt.optionText}</span>
                          <span
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              selected
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQuestion.questionType === 'multiple_choice' && (
                  <div className="grid grid-cols-1 gap-2.5 max-h-[340px] overflow-y-auto pl-1">
                    {currentQuestion.options.map((opt) => {
                      const currentArr: string[] = Array.isArray(answers[currentQuestion.id])
                        ? answers[currentQuestion.id]
                        : [];
                      const checked = currentArr.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const next = checked
                              ? currentArr.filter((x) => x !== opt.id)
                              : [...currentArr, opt.id];
                            setQuestionAnswer(currentQuestion.id, next);
                          }}
                          className={`w-full p-4 rounded-2xl border text-right transition-all flex items-center justify-between gap-3 ${
                            checked
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 ring-2 ring-emerald-500/20 text-emerald-950 dark:text-white'
                              : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-emerald-400'
                          }`}
                        >
                          <span className="text-xs sm:text-sm font-bold">{opt.optionText}</span>
                          <span
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                              checked
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {checked && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQuestion.questionType === 'number' && (
                  <input
                    type="number"
                    step="any"
                    dir="ltr"
                    value={answers[currentQuestion.id] ?? ''}
                    onChange={(e) => setQuestionAnswer(currentQuestion.id, e.target.value)}
                    placeholder="أدخل القيمة الرقمية المطلوبة..."
                    className="w-full px-4 py-3 text-sm font-mono bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                  />
                )}

                {currentQuestion.questionType === 'short_text' && (
                  <input
                    type="text"
                    value={String(answers[currentQuestion.id] || '')}
                    onChange={(e) => setQuestionAnswer(currentQuestion.id, e.target.value)}
                    placeholder="اكتب إجابتك المختصرة هنا..."
                    className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                  />
                )}

                {currentQuestion.questionType === 'long_text' && (
                  <textarea
                    rows={4}
                    value={String(answers[currentQuestion.id] || '')}
                    onChange={(e) => setQuestionAnswer(currentQuestion.id, e.target.value)}
                    placeholder="اكتب إجابتك بالتفصيل هنا..."
                    className="w-full p-4 text-sm bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                  />
                )}

                {currentQuestion.questionType === 'rating_1_5' && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const selectedVal = Number(answers[currentQuestion.id] || 0);
                        const active = star <= selectedVal;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setQuestionAnswer(currentQuestion.id, star)}
                            className={`p-2.5 rounded-2xl border transition-all ${
                              active
                                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 scale-105'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-amber-300'
                            }`}
                          >
                            <Star
                              className={`w-7 h-7 ${
                                active ? 'fill-amber-400 text-amber-500' : 'text-slate-300 dark:text-slate-600'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-center text-xs font-bold text-amber-600 dark:text-amber-400 min-h-[18px]">
                      {answers[currentQuestion.id]
                        ? `${answers[currentQuestion.id]} من 5 · ${RATING_LABELS[Number(answers[currentQuestion.id])] || ''}`
                        : 'اختر تقييمك من 1 إلى 5 نجوم'}
                    </div>
                  </div>
                )}
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Navigation Footer */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handlePrevious}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSavingStep}
                  className="min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <span>
                    {resolveSurveyNextQuestionIndex(orderedQuestions, currentIdx, answers) === 'REVIEW'
                      ? 'مراجعة الإجابات'
                      : 'السؤال التالي'}
                  </span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : survey && stage === 'review' ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-900 dark:text-emerald-200 font-semibold">
                راجع إجاباتك قبل الإرسال النهائي. يمكنك تعديل أي إجابة بالضغط على زر "تعديل".
              </div>

              <div className="space-y-2.5">
                {activePath.visitedQuestions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        سؤال {idx + 1}: {q.questionText}
                      </div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white break-words">
                        {formatAnswerPreview(q, answers[q.id])}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJumpToQuestionFromReview(q.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 hover:border-emerald-500"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>تعديل</span>
                    </button>
                  </div>
                ))}
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handlePrevious}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={isSubmitting}
                  className="min-h-[46px] px-6 py-2.5 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white text-xs font-extrabold shadow-md inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>جارٍ الإرسال والاعتماد...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isPreview ? 'إنهاء المعاينة' : 'إرسال الاستبيان واستلام المكافأة'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <Sparkles className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {isPreview ? 'تمت تجربة المعاينة بنجاح!' : 'شكراً لمشاركتك! تم إرسال إجاباتك بنجاح'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isPreview
                    ? 'هكذا سيظهر مسار الاستبيان وشاشة النجاح للمستخدمين عند النشر.'
                    : 'تم قيد مكافأة الاستبيان مباشرة في رصيد محفظتك.'}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300">المكافأة:</span>
                <span className="text-lg font-extrabold font-mono text-amber-600 dark:text-amber-400">
                  +{formatYer(rewardedAmount)} ر.ي
                </span>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm"
                >
                  العودة إلى قائمة المهام
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
