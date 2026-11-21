import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  FileCheck2,
  Globe,
  Heart,
  Link as LinkIcon,
  Pause,
  Play,
  PlaySquare,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  Upload,
  UserCheck,
  UserPlus,
  WifiOff,
  X,
  Building2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SurveyQuestion, TaskItem } from '../../types/index.ts';
import { formatYer } from '../../../shared/money.ts';
import {
  SOCIAL_ENGAGEMENT_ACTION_OPTIONS,
  SOCIAL_PLATFORM_OPTIONS,
  extractYouTubeVideoId,
  getDifficultyMeta,
  getTaskKindLabel,
  isDirectVideoFileUrl,
  normalizeProofRequirements,
  sanitizeSafeHttpUrl,
  toCanonicalTaskKind,
  validateDynamicTaskProof,
} from '../../../shared/taskMeta.ts';
import { isSurveyQuestionAnswered } from '../../../shared/surveyLogic.ts';
import { SecureImageView } from '../common/SecureImageView.tsx';

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

interface TaskExecutionModalProps {
  task: TaskItem;
  onClose: () => void;
  onSubmitted: () => void;
}

export const TaskExecutionModal: React.FC<TaskExecutionModalProps> = ({
  task,
  onClose,
  onSubmitted,
}) => {
  const { isOnline, refreshWallet, showToast } = useAuth();

  const canonicalKind = useMemo(
    () => toCanonicalTaskKind(task.taskKind, task.category),
    [task.taskKind, task.category]
  );
  const fields = task.taskMeta?.fields || {};
  const proofReqs = useMemo(
    () => normalizeProofRequirements(task.proofRequirements, task.taskMeta, task.taskKind),
    [task.proofRequirements, task.taskMeta, task.taskKind]
  );
  const difficultyMeta = getDifficultyMeta(task.difficulty || task.taskMeta?.difficulty);
  const kindLabel = getTaskKindLabel(task.taskKind, task.category);

  // Proof input states (rendered strictly per proofReqs)
  const [proofText, setProofText] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofCodeNumber, setProofCodeNumber] = useState('');
  const [proofImages, setProofImages] = useState<string[]>([]);
  const [choiceSingle, setChoiceSingle] = useState('');
  const [choiceMulti, setChoiceMulti] = useState<string[]>([]);

  // Inline sequential multi-question state
  const inlineQuestions: SurveyQuestion[] = proofReqs.customQuestions || [];
  const [mqIdx, setMqIdx] = useState(0);
  const [mqAnswers, setMqAnswers] = useState<Record<string, any>>({});
  const [mqDone, setMqDone] = useState(false);

  // Server-verified execution session state (video_watch & website_visit)
  const watchSecondsRequired = Number(fields.watchDurationSeconds || 0);
  const visitSecondsRequired = Number(fields.minVisitSeconds || 0);
  const needsExecutionSession =
    (canonicalKind === 'video_watch' && (watchSecondsRequired > 0 || proofReqs.modes?.includes('auto_verified'))) ||
    (canonicalKind === 'website_visit' && visitSecondsRequired > 0);
  const sessionMode: 'video_watch' | 'website_visit' =
    canonicalKind === 'video_watch' ? 'video_watch' : 'website_visit';
  const targetRequiredSeconds = Math.max(
    1,
    sessionMode === 'video_watch' ? watchSecondsRequired || 15 : visitSecondsRequired || 10
  );

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [verifiedSeconds, setVerifiedSeconds] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [isTrackingActive, setIsTrackingActive] = useState(false);
  const [visitOpened, setVisitOpened] = useState(false);
  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [isStartingSession, setIsStartingSession] = useState(false);

  // Upload & Submit states
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const pingBusyRef = useRef(false);

  const videoUrl = sanitizeSafeHttpUrl(fields.videoUrl || fields.adUrl);
  const youtubeId = useMemo(() => extractYouTubeVideoId(videoUrl), [videoUrl]);
  const isDirectVideo = useMemo(() => isDirectVideoFileUrl(videoUrl), [videoUrl]);
  const visitUrl = sanitizeSafeHttpUrl(fields.targetUrl || fields.trackingUrl);
  const socialPlatformObj = SOCIAL_PLATFORM_OPTIONS.find((p) => p.id === fields.socialPlatform);
  const engagementActionObj = SOCIAL_ENGAGEMENT_ACTION_OPTIONS.find((a) => a.id === fields.engagementAction);

  // Visibility listener: pause video countdown when user leaves tab; ping on return for website_visit
  useEffect(() => {
    const handleVisibility = () => {
      const vis = document.visibilityState === 'visible';
      setTabVisible(vis);
      if (vis && sessionMode === 'website_visit' && visitOpened && sessionId && !sessionCompleted) {
        api
          .pingTaskExecutionSession(task.id, {
            sessionId,
            returnedFromVisit: true,
          })
          .then((res) => {
            setVerifiedSeconds(res.session.verifiedSeconds);
            setSessionCompleted(res.session.completed);
          })
          .catch(() => {});
      }
    };
    const handleFocus = () => {
      if (sessionMode === 'website_visit' && visitOpened && sessionId && !sessionCompleted) {
        api
          .pingTaskExecutionSession(task.id, {
            sessionId,
            returnedFromVisit: true,
          })
          .then((res) => {
            setVerifiedSeconds(res.session.verifiedSeconds);
            setSessionCompleted(res.session.completed);
          })
          .catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [sessionMode, visitOpened, sessionId, sessionCompleted, task.id]);

  // Start execution session automatically on open if required
  useEffect(() => {
    if (!needsExecutionSession || !isOnline) return;
    let mounted = true;
    setIsStartingSession(true);
    api
      .startTaskExecutionSession(task.id, sessionMode)
      .then((res) => {
        if (!mounted) return;
        setSessionId(res.session.id);
        setVerifiedSeconds(res.session.verifiedSeconds);
        setSessionCompleted(res.session.completed);
        if (sessionMode === 'video_watch' && (youtubeId || !isDirectVideo)) {
          setIsTrackingActive(true);
        }
      })
      .catch((err: any) => {
        if (mounted) setErrorMsg(err?.message || 'تعذر تهيئة جلسة التحقق.');
      })
      .finally(() => {
        if (mounted) setIsStartingSession(false);
      });
    return () => {
      mounted = false;
    };
  }, [needsExecutionSession, isOnline, task.id, sessionMode, youtubeId, isDirectVideo]);

  // Live 1s visual progress + 3s server heartbeat while tracking active
  useEffect(() => {
    if (!needsExecutionSession || !sessionId || sessionCompleted) return;
    const shouldTick =
      sessionMode === 'video_watch'
        ? isTrackingActive && tabVisible
        : visitOpened;

    if (!shouldTick) return;

    const visualInterval = setInterval(() => {
      setVerifiedSeconds((prev) => Math.min(targetRequiredSeconds, prev + 1));
    }, 1000);

    const serverPingInterval = setInterval(() => {
      if (pingBusyRef.current) return;
      pingBusyRef.current = true;
      api
        .pingTaskExecutionSession(task.id, {
          sessionId,
          deltaSeconds: 3,
          playerActive: sessionMode === 'video_watch' ? isTrackingActive && tabVisible : true,
        })
        .then((res) => {
          setVerifiedSeconds(res.session.verifiedSeconds);
          setSessionCompleted(res.session.completed);
        })
        .catch(() => {})
        .finally(() => {
          pingBusyRef.current = false;
        });
    }, 3000);

    return () => {
      clearInterval(visualInterval);
      clearInterval(serverPingInterval);
    };
  }, [
    needsExecutionSession,
    sessionId,
    sessionCompleted,
    sessionMode,
    isTrackingActive,
    tabVisible,
    visitOpened,
    targetRequiredSeconds,
    task.id,
  ]);

  const handleOpenVisitUrl = async () => {
    if (!visitUrl) return;
    if (needsExecutionSession && !sessionId && isOnline) {
      try {
        const res = await api.startTaskExecutionSession(task.id, 'website_visit');
        setSessionId(res.session.id);
      } catch {}
    }
    setVisitOpened(true);
    setIsTrackingActive(true);
    window.open(visitUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyText = (val: string) => {
    if (!val) return;
    navigator.clipboard?.writeText(val).then(() => {
      showToast('تم النسخ إلى الحافظة', 'success');
    }).catch(() => {});
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isOnline) {
      setErrorMsg('رفع صور الإثبات يتطلب اتصالاً نشطاً بالإنترنت.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('حجم الصورة يتجاوز الحد المسموح (5 ميجابايت).');
      return;
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (file.type && !allowedTypes.includes(file.type.toLowerCase())) {
      setErrorMsg('صيغة الصورة غير مدعومة (المسموح PNG / JPG / WEBP).');
      return;
    }

    setIsUploadingImage(true);
    setErrorMsg('');
    try {
      const signRes = await api.getUploadSignedUrl({
        taskId: task.id,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        fileSize: file.size,
      });
      const uploadRes = await fetch(signRes.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error('فشل رفع الصورة إلى التخزين السحابي.');
      }
      setProofImages((prev) => [...prev, signRes.path]);
      showToast('تم رفع صورة الإثبات بنجاح', 'success');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر رفع الصورة.');
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleNextInlineQuestion = () => {
    const q = inlineQuestions[mqIdx];
    if (!q) return;
    const ans = mqAnswers[q.id];
    if (q.isRequired && !isSurveyQuestionAnswered(q, ans)) {
      setErrorMsg('هذا السؤال إلزامي، يرجى الإجابة قبل الانتقال للسؤال التالي.');
      return;
    }
    setErrorMsg('');
    if (mqIdx + 1 >= inlineQuestions.length) {
      setMqDone(true);
    } else {
      setMqIdx((p) => p + 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      setErrorMsg('إرسال الإثبات يتطلب اتصالاً بالإنترنت.');
      return;
    }
    setErrorMsg('');

    // Final sync ping if session exists and not yet confirmed completed
    let latestSessionVerified = sessionCompleted;
    let latestVerifiedSeconds = verifiedSeconds;
    if (needsExecutionSession && sessionId && !sessionCompleted) {
      try {
        const res = await api.pingTaskExecutionSession(task.id, {
          sessionId,
          deltaSeconds: 2,
          returnedFromVisit: sessionMode === 'website_visit' && visitOpened,
          playerActive: sessionMode === 'video_watch' ? isTrackingActive && tabVisible : true,
        });
        latestSessionVerified = res.session.completed;
        latestVerifiedSeconds = res.session.verifiedSeconds;
        setSessionCompleted(res.session.completed);
        setVerifiedSeconds(res.session.verifiedSeconds);
      } catch {}
    }

    const chosenAnswer = proofReqs.choiceMultiSelect ? choiceMulti : choiceSingle || undefined;
    const multiPayload =
      proofReqs.requireMultiQuestion && inlineQuestions.length > 0
        ? inlineQuestions.map((q) => ({
            questionId: q.id,
            questionText: q.questionText,
            answer: mqAnswers[q.id],
          }))
        : undefined;

    const validation = validateDynamicTaskProof(task, {
      proofText,
      proofImages,
      proofUrl,
      proofCodeNumber,
      proofChoiceAnswer: chosenAnswer,
      proofMultiAnswers: multiPayload,
      executionSessionVerified: latestSessionVerified,
      verifiedSeconds: latestVerifiedSeconds,
    });

    if (!validation.valid) {
      setErrorMsg(validation.error || 'يرجى استكمال حقول الإثبات المطلوبة.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.submitTaskProof({
        taskId: task.id,
        proofText: proofText.trim() || undefined,
        proofImages: proofImages.length > 0 ? proofImages : undefined,
        proofUrl: proofUrl.trim() || undefined,
        proofCodeNumber: proofCodeNumber.trim() || undefined,
        proofChoiceAnswer: chosenAnswer,
        proofMultiAnswers: multiPayload,
        executionSessionId: sessionId || undefined,
      });

      try {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      } catch {}
      showToast('تم إرسال إثبات المهمة بنجاح! سيتم مراجعته وقيد المكافأة.', 'success');
      refreshWallet();
      onSubmitted();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل إرسال الإثبات.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sessionProgressPct = Math.min(100, Math.round((verifiedSeconds / targetRequiredSeconds) * 100));
  const currentInlineQ = inlineQuestions[mqIdx] || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative w-full sm:max-w-2xl max-h-[93vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 shrink-0 gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                {kindLabel}
              </span>
              <span className={`px-2 py-0.5 rounded-full border ${difficultyMeta.badgeClass}`}>
                {difficultyMeta.labelAr}
              </span>
              <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {task.timeEstimateMinutes} د
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                · {task.locationLabel || task.countryNameAr || 'عن بُعد'}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Advertiser & Reward Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5 text-xs">
              {task.isExternalCampaign && !task.hideAdvertiserName && task.advertiserLogoUrl ? (
                <SecureImageView
                  storagePathOrUrl={task.advertiserLogoUrl}
                  alt={task.advertiserDisplayName || 'شعار المعلن'}
                  className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                  {task.isExternalCampaign && task.hideAdvertiserName ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Building2 className="w-4 h-4 text-emerald-600" />
                  )}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">الجهة المعلنة</div>
                <div className="font-bold text-slate-900 dark:text-white truncate">
                  {task.isExternalCampaign
                    ? task.hideAdvertiserName
                      ? 'معلن عبر يمن تاسك'
                      : task.advertiserDisplayName || 'معلن عبر يمن تاسك'
                    : 'مهمة مباشرة موثقة'}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">المكافأة المعتمدة</div>
                <div className="text-lg font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {formatYer(task.rewardYer)} <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">ر.ي</span>
                </div>
              </div>
              <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
            </div>
          </div>

          {/* ================================================================= */}
          {/* INTERACTIVE TYPE-SPECIFIC WORKSPACE */}
          {/* ================================================================= */}

          {/* 1) VIDEO WATCH WORKSPACE */}
          {canonicalKind === 'video_watch' && (
            <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-teal-800 dark:text-teal-300">
                  <PlaySquare className="w-4 h-4" />
                  <span>مشغل الفيديو والتحقق من مدة المشاهدة</span>
                </div>
                <span className="text-xs font-mono font-extrabold text-teal-700 dark:text-teal-300">
                  {verifiedSeconds} / {targetRequiredSeconds} ث
                </span>
              </div>

              {videoUrl ? (
                isDirectVideo ? (
                  <video
                    controls
                    playsInline
                    src={videoUrl}
                    onPlay={() => setIsTrackingActive(true)}
                    onPause={() => setIsTrackingActive(false)}
                    onEnded={() => setIsTrackingActive(false)}
                    className="w-full max-h-64 rounded-xl bg-black border border-slate-200 dark:border-slate-700"
                  />
                ) : youtubeId ? (
                  <div className="space-y-2">
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-700">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`}
                        title={task.title}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-600 dark:text-slate-300">
                        {tabVisible
                          ? isTrackingActive
                            ? 'جارٍ احتساب وقت المشاهدة النشطة تلقائياً...'
                            : 'العد متوقف مؤقتاً'
                          : 'توقف العداد لأن التبويب غير مرئي'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsTrackingActive((p) => !p)}
                        className="px-3 py-1 rounded-lg bg-teal-600 text-white font-bold inline-flex items-center gap-1"
                      >
                        {isTrackingActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        <span>{isTrackingActive ? 'إيقاف مؤقت' : 'استئناف المشاهدة'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      افتح الفيديو وابقَ في الصفحة حتى يكتمل المؤقت ({targetRequiredSeconds} ثانية).
                    </span>
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsTrackingActive(true)}
                      className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5"
                    >
                      <span>فتح الفيديو</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )
              ) : (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  شاهد الفيديو الموضح في خطوات المهمة وأكمل مدة المشاهدة المطلوبة ({targetRequiredSeconds} ثانية).
                </div>
              )}

              {/* Live Watch Timer Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full h-2.5 rounded-full bg-white dark:bg-slate-800 border border-teal-200 dark:border-teal-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      sessionCompleted ? 'bg-emerald-500' : 'bg-teal-500'
                    }`}
                    style={{ width: `${sessionProgressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className={sessionCompleted ? 'text-emerald-700 dark:text-emerald-400' : 'text-teal-700 dark:text-teal-300'}>
                    {isStartingSession
                      ? 'جارٍ تهيئة مؤقت التحقق الآمن...'
                      : sessionCompleted
                        ? 'تم التحقق من إتمام مدة المشاهدة المطلوبة بنجاح!'
                        : `متبقي ${Math.max(0, targetRequiredSeconds - verifiedSeconds)} ثانية من المشاهدة الفعلية لتفعيل الإكمال`}
                  </span>
                  <span className="font-mono">{sessionProgressPct}%</span>
                </div>
              </div>
              {fields.completionRule && (
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  <strong>شرط المشاهدة:</strong> {fields.completionRule}
                </p>
              )}
            </div>
          )}

          {/* 2) WEBSITE VISIT WORKSPACE */}
          {canonicalKind === 'website_visit' && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-800 dark:text-indigo-300">
                  <Globe className="w-4 h-4" />
                  <span>زيارة الموقع والتحقق من العودة</span>
                </div>
                {needsExecutionSession && (
                  <span className="text-xs font-mono font-extrabold text-indigo-700 dark:text-indigo-300">
                    {verifiedSeconds} / {targetRequiredSeconds} ث
                  </span>
                )}
              </div>

              {visitUrl ? (
                <button
                  type="button"
                  onClick={handleOpenVisitUrl}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>فتح الموقع المستهدف الآن</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              ) : (
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  اتبع الرابط المذكور في تفاصيل المهمة بالأسفل ثم عد لإرسال الإثبات.
                </div>
              )}

              {needsExecutionSession && (
                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-white dark:bg-slate-800 overflow-hidden border border-indigo-200 dark:border-indigo-800">
                    <div
                      className={`h-full transition-all duration-500 ${
                        sessionCompleted ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${sessionProgressPct}%` }}
                    />
                  </div>
                  <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300">
                    {sessionCompleted
                      ? 'تم التحقق من الزيارة واستيفاء المدة المطلوبة!'
                      : visitOpened
                        ? `تم تسجيل فتح الرابط · تبقى ${Math.max(0, targetRequiredSeconds - verifiedSeconds)} ثانية`
                        : `اضغط "فتح الموقع المستهدف الآن" واقضِ ${targetRequiredSeconds} ثانية ثم عد للتطبيق`}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3) SOCIAL FOLLOW WORKSPACE */}
          {canonicalKind === 'social_follow' && (
            <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-blue-800 dark:text-blue-300">
                  <UserCheck className="w-4 h-4" />
                  <span>بيانات الحساب للمتابعة</span>
                </span>
                {socialPlatformObj && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${socialPlatformObj.badgeClass}`}>
                    {socialPlatformObj.labelAr}
                  </span>
                )}
              </div>

              {fields.socialAccountHandle && (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-xs">
                  <span className="font-mono font-bold text-slate-900 dark:text-white" dir="ltr">
                    {fields.socialAccountHandle}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(fields.socialAccountHandle!)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold inline-flex items-center gap-1 hover:bg-blue-100"
                  >
                    <Copy className="w-3 h-3" />
                    <span>نسخ</span>
                  </button>
                </div>
              )}

              {sanitizeSafeHttpUrl(fields.socialAccountUrl) && (
                <a
                  href={fields.socialAccountUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2"
                >
                  <span>الانتقال للحساب ومتابعته الآن</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          )}

          {/* 4) SOCIAL ENGAGEMENT WORKSPACE */}
          {canonicalKind === 'social_engagement' && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-rose-800 dark:text-rose-300">
                  <Heart className="w-4 h-4" />
                  <span>التفاعل المطلوب</span>
                </span>
                <div className="flex items-center gap-1.5">
                  {socialPlatformObj && (
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${socialPlatformObj.badgeClass}`}>
                      {socialPlatformObj.labelAr}
                    </span>
                  )}
                  {engagementActionObj && (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 text-[11px] font-extrabold">
                      {engagementActionObj.labelAr}
                    </span>
                  )}
                </div>
              </div>

              {sanitizeSafeHttpUrl(fields.engagementTargetUrl) && (
                <a
                  href={fields.engagementTargetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2"
                >
                  <span>فتح المنشور / المحتوى للتفاعل</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          )}

          {/* 5) APP TESTING WORKSPACE */}
          {canonicalKind === 'app_testing' && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-800 dark:text-amber-300">
                <Smartphone className="w-4 h-4" />
                <span>تحميل وتجربة التطبيق</span>
              </div>
              {fields.appRequirements && (
                <div className="text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-800/60">
                  <strong>متطلبات الجهاز / النظام:</strong> {fields.appRequirements}
                </div>
              )}
              {fields.testingInstructions && (
                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong>تعليمات التجربة:</strong> {fields.testingInstructions}
                </div>
              )}
              {sanitizeSafeHttpUrl(fields.appDownloadUrl) && (
                <a
                  href={fields.appDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>فتح صفحة التحميل / المتجر</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {/* 6) ACCOUNT SIGNUP WORKSPACE + SENSITIVE FIELD PROTECTION */}
          {canonicalKind === 'account_signup' && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
                <UserPlus className="w-4 h-4" />
                <span>التسجيل وإنشاء الحساب</span>
              </div>
              {fields.partnerName && (
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  <strong>المنصة / الشريك:</strong> {fields.partnerName}
                </div>
              )}
              {(fields.signupRequirements || fields.offerConditions) && (
                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong>متطلبات التسجيل:</strong> {fields.signupRequirements || fields.offerConditions}
                </div>
              )}
              {sanitizeSafeHttpUrl(fields.signupUrl || fields.offerUrl) && (
                <a
                  href={fields.signupUrl || fields.offerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2"
                >
                  <span>الانتقال لصفحة التسجيل</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  تنبيه أمني: ممنوع إدخال كلمة المرور أو رمز التحقق (OTP) أو أي معلومات سرية هنا. أدخل فقط اسم المستخدم أو المعرف المسجل.
                </span>
              </div>
            </div>
          )}

          {/* 7) CUSTOM PROOF NOTES */}
          {canonicalKind === 'custom_proof' && (fields.customProofSummary || fields.proofNotes) && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3.5 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
              <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{fields.customProofSummary || fields.proofNotes}</span>
            </div>
          )}

          {/* Instructions Steps & Description */}
          <div className="space-y-2.5">
            <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
              خطوات وتعليمات المهمة:
            </h3>
            {task.steps && task.steps.length > 0 ? (
              <ul className="space-y-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                {task.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center font-mono text-[11px] font-extrabold shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{renderTextWithSafeLinks(step)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {renderTextWithSafeLinks(task.description)}
              </p>
            )}
          </div>

          {/* Acceptance & Rejection Criteria */}
          {(proofReqs.acceptanceCriteria || proofReqs.rejectionCriteria || proofReqs.instructions) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              {(proofReqs.acceptanceCriteria || proofReqs.instructions) && (
                <div className="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-1">
                  <div className="font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>شروط القبول</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {proofReqs.acceptanceCriteria || proofReqs.instructions}
                  </p>
                </div>
              )}
              {proofReqs.rejectionCriteria && (
                <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 space-y-1">
                  <div className="font-extrabold text-rose-800 dark:text-rose-300 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>أسباب الرفض</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {proofReqs.rejectionCriteria}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* DYNAMIC PROOF SUBMISSION FORM */}
          {/* ================================================================= */}
          <form onSubmit={handleSubmit} className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
              تقديم الإثبات المطلوب:
            </h3>

            {!isOnline && (
              <div className="p-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl flex items-center gap-2">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>إرسال الإثبات يتطلب اتصالاً نشطاً بالإنترنت.</span>
              </div>
            )}

            {/* Dynamic 1: Inline Sequential Multi-Question Proof */}
            {proofReqs.requireMultiQuestion && inlineQuestions.length > 0 && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  <span>أسئلة التحقق ({inlineQuestions.length})</span>
                  <span className="font-mono">
                    {mqDone ? 'مكتمل 100%' : `${mqIdx + 1} / ${inlineQuestions.length}`}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all"
                    style={{
                      width: `${mqDone ? 100 : Math.round(((mqIdx + 1) / inlineQuestions.length) * 100)}%`,
                    }}
                  />
                </div>

                {!mqDone && currentInlineQ ? (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                        {currentInlineQ.questionText}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
                        {currentInlineQ.isRequired ? 'إلزامي' : 'اختياري'}
                      </span>
                    </div>

                    {(currentInlineQ.questionType === 'single_choice' || currentInlineQ.questionType === 'yes_no') && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {currentInlineQ.options.map((opt) => {
                          const active = mqAnswers[currentInlineQ.id] === opt.optionText;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setMqAnswers((prev) => ({ ...prev, [currentInlineQ.id]: opt.optionText }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-right text-xs font-bold transition-all ${
                                active
                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-600 text-emerald-900 dark:text-white'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {opt.optionText}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {currentInlineQ.questionType === 'multiple_choice' && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {currentInlineQ.options.map((opt) => {
                          const arr: string[] = Array.isArray(mqAnswers[currentInlineQ.id]) ? mqAnswers[currentInlineQ.id] : [];
                          const checked = arr.includes(opt.optionText);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                const next = checked ? arr.filter((x) => x !== opt.optionText) : [...arr, opt.optionText];
                                setMqAnswers((prev) => ({ ...prev, [currentInlineQ.id]: next }));
                              }}
                              className={`w-full px-3 py-2.5 rounded-xl border text-right text-xs font-bold transition-all ${
                                checked
                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-600 text-emerald-900 dark:text-white'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {opt.optionText}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {currentInlineQ.questionType === 'number' && (
                      <input
                        type="number"
                        step="any"
                        dir="ltr"
                        value={mqAnswers[currentInlineQ.id] ?? ''}
                        onChange={(e) => setMqAnswers((prev) => ({ ...prev, [currentInlineQ.id]: e.target.value }))}
                        placeholder="أدخل الرقم المطلوب..."
                        className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                      />
                    )}

                    {(currentInlineQ.questionType === 'short_text' || currentInlineQ.questionType === 'long_text') && (
                      <textarea
                        rows={currentInlineQ.questionType === 'long_text' ? 3 : 2}
                        value={String(mqAnswers[currentInlineQ.id] || '')}
                        onChange={(e) => setMqAnswers((prev) => ({ ...prev, [currentInlineQ.id]: e.target.value }))}
                        placeholder="اكتب إجابتك هنا..."
                        className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                      />
                    )}

                    {currentInlineQ.questionType === 'rating_1_5' && (
                      <div className="flex items-center justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setMqAnswers((prev) => ({ ...prev, [currentInlineQ.id]: s }))}
                            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <Star
                              className={`w-5 h-5 ${
                                s <= Number(mqAnswers[currentInlineQ.id] || 0)
                                  ? 'fill-amber-400 text-amber-500'
                                  : 'text-slate-300'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        disabled={mqIdx === 0}
                        onClick={() => setMqIdx((p) => Math.max(0, p - 1))}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>السابق</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleNextInlineQuestion}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-extrabold inline-flex items-center gap-1"
                      >
                        <span>{mqIdx + 1 >= inlineQuestions.length ? 'حفظ ومراجعة' : 'التالي'}</span>
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
                      <span>تمت الإجابة على جميع الأسئلة ({inlineQuestions.length})</span>
                      <button
                        type="button"
                        onClick={() => {
                          setMqDone(false);
                          setMqIdx(0);
                        }}
                        className="underline text-[11px]"
                      >
                        تعديل الإجابات
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dynamic 2: Choice Proof */}
            {proofReqs.requireChoice && (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {proofReqs.choiceQuestion || 'اختر الإجابة الصحيحة لإثبات الإنجاز:'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto">
                  {(proofReqs.choiceOptions || []).map((opt) => {
                    const active = proofReqs.choiceMultiSelect
                      ? choiceMulti.includes(opt)
                      : choiceSingle === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          if (proofReqs.choiceMultiSelect) {
                            setChoiceMulti((prev) =>
                              prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]
                            );
                          } else {
                            setChoiceSingle(opt);
                          }
                        }}
                        className={`w-full px-3.5 py-2.5 rounded-xl border text-right text-xs font-bold flex items-center justify-between transition-all ${
                          active
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 text-emerald-900 dark:text-white'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <span>{opt}</span>
                        {active && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dynamic 3: Code / Number Proof */}
            {proofReqs.requireCodeNumber && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  رقم أو رمز الإثبات المطلوب <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={proofCodeNumber}
                  onChange={(e) => setProofCodeNumber(e.target.value)}
                  placeholder="أدخل الكود أو الرقم المطلوب..."
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                />
              </div>
            )}

            {/* Dynamic 4: Text Proof */}
            {proofReqs.requireText && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {proofReqs.proofPromptText || 'الإجابة النصية أو اسم المستخدم / الملاحظة المطلوبة'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={proofText}
                  onChange={(e) => setProofText(e.target.value)}
                  placeholder={
                    canonicalKind === 'account_signup'
                      ? 'أدخل اسم المستخدم أو المعرف الذي سجلت به فقط (ممنوع كتابة كلمة المرور)...'
                      : 'اكتب بيانات الإثبات المطلوبة بوضوح...'
                  }
                  className="w-full p-3 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {/* Dynamic 5: URL Proof */}
            {proofReqs.requireUrl && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  رابط الإثبات (URL) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <LinkIcon className="absolute right-3 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="url"
                    dir="ltr"
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full pr-9 pl-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Dynamic 6: Image Proof (ONLY shown if required by this task!) */}
            {proofReqs.requireImage && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  صورة / لقطة شاشة إثبات الإنجاز <span className="text-rose-500">*</span>
                </label>
                <div className="mt-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-4 hover:border-emerald-500 transition-colors bg-slate-50/50 dark:bg-slate-800/30">
                  {proofImages.length > 0 ? (
                    <div className="w-full space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {proofImages.map((imgPath, i) => (
                          <div key={imgPath} className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            <SecureImageView
                              storagePathOrUrl={imgPath}
                              alt={`إثبات ${i + 1}`}
                              className="w-full h-36 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setProofImages((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute top-2 left-2 px-2 py-1 bg-rose-600 text-white rounded-lg text-[11px] font-bold hover:bg-rose-700"
                            >
                              حذف
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : isUploadingImage ? (
                    <div className="py-5 flex flex-col items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                      <span>جارٍ رفع الصورة إلى التخزين الآمن...</span>
                    </div>
                  ) : (
                    <label
                      className={`flex flex-col items-center justify-center w-full py-3 ${
                        isOnline ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <Upload className="w-7 h-7 text-emerald-600 mb-1.5" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        انقر لاختيار لقطة الشاشة من جهازك
                      </span>
                      <span className="text-[11px] text-slate-400 mt-0.5">PNG, JPG, WEBP حتى 5 ميجابايت</span>
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
            )}

            {errorMsg && (
              <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={
                  !isOnline ||
                  isSubmitting ||
                  isUploadingImage ||
                  (needsExecutionSession && !sessionCompleted)
                }
                className="min-h-[44px] px-6 py-2.5 text-xs sm:text-sm font-extrabold text-white bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-xl shadow-md disabled:opacity-50 inline-flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ الإرسال...</span>
                  </>
                ) : needsExecutionSession && !sessionCompleted ? (
                  <span>انتظر اكتمال المؤقت ({Math.max(0, targetRequiredSeconds - verifiedSeconds)} ث)</span>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>إرسال وإتمام المهمة</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
