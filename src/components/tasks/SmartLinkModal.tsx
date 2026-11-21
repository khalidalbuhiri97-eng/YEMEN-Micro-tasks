import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Link2,
  RefreshCw,
  CheckCircle2,
  Coins,
  Clock,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskItem } from '../../types/index.ts';
import { formatYer } from '../../../shared/money.ts';
import { SUPABASE_TASK_ASSET_URLS } from '../../../shared/taskMeta.ts';

interface SmartLinkModalProps {
  task: TaskItem;
  onClose: () => void;
  onAttemptStarted?: () => void;
}

export const SmartLinkModal: React.FC<SmartLinkModalProps> = ({
  task,
  onClose,
  onAttemptStarted,
}) => {
  const { isOnline, showToast } = useAuth();
  const [isPreparing, setIsPreparing] = useState(false);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [clickToken, setClickToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const providerName = task.providerName || task.taskMeta?.fields?.providerName || 'مزوّد العرض الذكي';
  const providerLogo =
    task.providerLogoUrl ||
    task.taskMeta?.fields?.providerLogoUrl ||
    task.imageUrl ||
    SUPABASE_TASK_ASSET_URLS.smart_links;
  const instructions =
    task.taskMeta?.fields?.smartLinkInstructions ||
    task.proofRequirements?.instructions ||
    task.description;
  const remaining = Math.max(0, task.totalQuantity - task.completedQuantity);
  const userAttempts = Number(task.userAttemptsCount || 0);
  const maxPerUser = Math.max(1, Number(task.maxPerUser || 1));

  const handlePrepareLink = async () => {
    if (!isOnline) {
      setErrorMsg('بدء الرابط الذكي يتطلب اتصالاً نشطاً بالإنترنت.');
      return;
    }
    setIsPreparing(true);
    setErrorMsg('');
    try {
      const res = await api.startSmartLink(task.id);
      setLaunchUrl(res.launchUrl);
      setClickToken(res.attempt.clickToken);
      showToast('تم إنشاء جلسة التتبع بنجاح. اضغط "الانتقال للعرض" لإكماله.', 'success');
      onAttemptStarted?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تجهيز الرابط الذكي.');
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative w-full sm:max-w-lg max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-teal-50/50 dark:bg-teal-950/20">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={providerLogo}
              alt={providerName}
              className="w-11 h-11 rounded-2xl object-cover border border-teal-200 dark:border-teal-800 bg-white shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-teal-700 dark:text-teal-400">
                <Link2 className="w-3.5 h-3.5" />
                <span>رابط ذكي · {providerName}</span>
              </div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                {task.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/60 text-center">
              <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold flex items-center justify-center gap-1">
                <Coins className="w-3 h-3" />
                <span>المكافأة</span>
              </span>
              <span className="text-sm sm:text-base font-extrabold font-mono text-amber-600 dark:text-amber-400">
                {formatYer(task.rewardYer)} ر.ي
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-semibold">محاولاتك</span>
              <span className="text-sm font-extrabold font-mono text-slate-900 dark:text-white">
                {userAttempts} / {maxPerUser}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 text-emerald-600" />
                <span>المتبقي</span>
              </span>
              <span className="text-sm font-extrabold font-mono text-emerald-700 dark:text-emerald-400">
                {remaining} من {task.totalQuantity}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
            <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">معلومات ومتطلبات العرض:</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
              {instructions}
            </p>
          </div>

          {/* Postback-only security notice */}
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 text-[11px] leading-relaxed flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong>التحقق الآلي عبر Postback:</strong> تُضاف المكافأة آلياً إلى محفظتك فقط بعد وصول إشعار التحقق الفعلي من مزوّد الخدمة ({providerName}) ولا تُمنح أي مكافأة بمجرد النقر أو العودة للتطبيق.
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {launchUrl ? (
            <div className="space-y-3 p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>جلسة التتبع جاهزة الآن</span>
                </span>
                {clickToken && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-700 text-teal-700 dark:text-teal-300">
                    {clickToken}
                  </span>
                )}
              </div>
              <a
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[46px] px-5 py-3 rounded-xl bg-gradient-to-l from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-extrabold text-sm shadow-md flex items-center justify-center gap-2 transition-all"
              >
                <span>فتح العرض عند المزوّد الآن</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 min-h-[46px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handlePrepareLink}
                disabled={isPreparing || userAttempts >= maxPerUser || remaining <= 0}
                className="flex-1 min-h-[46px] px-5 py-3 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPreparing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ تجهيز رابط التتبع الآمن...</span>
                  </>
                ) : userAttempts >= maxPerUser ? (
                  <span>تم استيفاء الحد الأقصى لمحاولاتك</span>
                ) : (
                  <>
                    <span>ابدأ وتجهيز الرابط الذكي</span>
                    <ExternalLink className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
