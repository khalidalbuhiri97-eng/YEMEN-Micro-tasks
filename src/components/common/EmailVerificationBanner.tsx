import React, { useEffect, useState } from 'react';
import { MailWarning, RefreshCw, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../api/client.ts';

interface EmailVerificationBannerProps {
  contextLabel?: string;
  className?: string;
}

export const EmailVerificationBanner: React.FC<EmailVerificationBannerProps> = ({
  contextLabel = 'قبل تنفيذ السحب المالي أو إرسال إثباتات المهام',
  className = '',
}) => {
  const { user, isAdmin, isOnline, refreshUser, showToast } = useAuth();
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  if (!user || isAdmin || user.emailVerified !== false) {
    return null;
  }

  const handleResend = async () => {
    if (!isOnline) {
      showToast('يرجى الاتصال بالإنترنت لإعادة إرسال رابط التفعيل.', 'error');
      return;
    }
    if (isSending || cooldownSec > 0) return;
    setIsSending(true);
    try {
      const res = await api.resendVerificationEmail(user.email);
      showToast(
        res?.message || 'تم إرسال رابط التفعيل إلى بريدك الإلكتروني بنجاح. تحقق من صندوق الوارد والرسائل غير المرغوب فيها.',
        'success'
      );
      setCooldownSec(60);
    } catch (err: any) {
      showToast(err?.message || 'تعذر إعادة إرسال رابط التفعيل حالياً.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!isOnline || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshUser();
      showToast('تم تحديث حالة توثيق البريد الإلكتروني.', 'info');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      role="alert"
      className={`rounded-2xl border border-amber-300/80 dark:border-amber-700/70 bg-amber-50/95 dark:bg-amber-950/40 p-4 shadow-xs space-y-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <MailWarning className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-xs sm:text-sm font-extrabold text-amber-950 dark:text-amber-100">
            حسابك بانتظار تأكيد البريد الإلكتروني
          </h3>
          <p className="text-[11px] sm:text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
            يرجى تأكيد بريدك الإلكتروني{' '}
            {user.email ? (
              <strong className="font-mono" dir="ltr">
                {user.email}
              </strong>
            ) : null}{' '}
            عبر الرابط المرسل إليك {contextLabel}.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={handleResend}
          disabled={isSending || cooldownSec > 0 || !isOnline}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
        >
          <Send className="w-3.5 h-3.5 shrink-0" />
          <span>
            {isSending
              ? 'جاري الإرسال...'
              : cooldownSec > 0
              ? `إعادة الإرسال بعد ${cooldownSec} ث`
              : 'إعادة إرسال رابط التفعيل'}
          </span>
        </button>

        <button
          type="button"
          onClick={handleRefreshStatus}
          disabled={isRefreshing || !isOnline}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/40 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
        >
          {isRefreshing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>أكدت بريدي — تحديث الحالة</span>
        </button>
      </div>
    </div>
  );
};
