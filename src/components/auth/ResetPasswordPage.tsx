import React, { useEffect, useState } from 'react';
import {
  supabase,
  PASSWORD_RESET_REDIRECT_URL,
  markRecoveryEventDetected,
  clearRecoveryEventDetected,
  hasRecoveryEventDetected,
} from '../../api/supabase.ts';
import { clearAuthToken } from '../../api/client.ts';
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Mail,
  ArrowRight,
  KeyRound,
  ShieldCheck,
  Loader2,
  Send,
} from 'lucide-react';

type ResetPageStatus = 'verifying' | 'ready' | 'invalid' | 'success';

interface ResetPasswordPageProps {
  onGoHome: () => void;
  onGoLogin: () => void;
}

type RecoveryVerifyResult =
  | { ok: true; email: string }
  | { ok: false; message: string };

// StrictMode-safe deduplication cache so single-use PKCE codes / token_hash values
// are never exchanged or verified twice on double-mount.
const recoveryAttemptCache = new Map<string, Promise<RecoveryVerifyResult>>();

function mapSupabaseRecoveryError(rawMessage: string, rawCode?: string): string {
  const combined = `${rawCode || ''} ${rawMessage || ''}`.toLowerCase();
  if (
    combined.includes('expired') ||
    combined.includes('otp_expired') ||
    combined.includes('invalid grant') ||
    combined.includes('token has expired')
  ) {
    return 'انتهت صلاحية رابط استعادة كلمة المرور أو تم استخدامه مسبقاً. يرجى طلب رابط جديد.';
  }
  if (
    combined.includes('code verifier') ||
    combined.includes('pkce') ||
    combined.includes('invalid')
  ) {
    return 'رابط استعادة كلمة المرور غير صالح أو تم فتحه من متصفح آخر. يرجى طلب رابط استعادة جديد.';
  }
  if (combined.includes('different from the old password') || combined.includes('same password')) {
    return 'يجب أن تختلف كلمة المرور الجديدة عن كلمة المرور الحالية.';
  }
  if (combined.includes('at least') || combined.includes('weak') || combined.includes('password')) {
    return 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وتكون قوية.';
  }
  if (combined.includes('session missing') || combined.includes('not authenticated')) {
    return 'انتهت جلسة الاستعادة، يرجى طلب رابط استعادة جديد.';
  }
  return rawMessage || 'تعذر التحقق من رابط استعادة كلمة المرور. يرجى طلب رابط جديد.';
}

async function verifyRecoveryCallbackOnce(): Promise<RecoveryVerifyResult> {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'بيئة غير صالحة للتحقق.' };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashRaw);

  const errorParam = searchParams.get('error') || hashParams.get('error');
  const errorCode = searchParams.get('error_code') || hashParams.get('error_code') || undefined;
  const errorDescription =
    searchParams.get('error_description') || hashParams.get('error_description') || '';

  if (errorParam || errorCode) {
    clearRecoveryEventDetected();
    window.history.replaceState({}, document.title, '/reset-password');
    return {
      ok: false,
      message: mapSupabaseRecoveryError(errorDescription || errorParam || '', errorCode),
    };
  }

  const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
  const queryType = searchParams.get('type') || hashParams.get('type');
  const pkceCode = searchParams.get('code');
  const hashAccessToken = hashParams.get('access_token');
  const hashRefreshToken = hashParams.get('refresh_token');

  // 1. Token Hash / OTP verification (?token_hash=...&type=recovery)
  if (tokenHash && queryType === 'recovery') {
    const cacheKey = `otp:${tokenHash}`;
    if (!recoveryAttemptCache.has(cacheKey)) {
      recoveryAttemptCache.set(
        cacheKey,
        (async (): Promise<RecoveryVerifyResult> => {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          window.history.replaceState({}, document.title, '/reset-password');
          if (error || !data?.session) {
            clearRecoveryEventDetected();
            return {
              ok: false,
              message: mapSupabaseRecoveryError(error?.message || '', (error as any)?.code),
            };
          }
          markRecoveryEventDetected();
          return { ok: true, email: data.session.user?.email || '' };
        })()
      );
    }
    return recoveryAttemptCache.get(cacheKey)!;
  }

  // 2. PKCE Code Exchange (?code=...)
  if (pkceCode) {
    const cacheKey = `pkce:${pkceCode}`;
    if (!recoveryAttemptCache.has(cacheKey)) {
      recoveryAttemptCache.set(
        cacheKey,
        (async (): Promise<RecoveryVerifyResult> => {
          // Wait briefly in case detectSessionInUrl already initiated the exchange
          await new Promise((resolve) => setTimeout(resolve, 150));

          const { data: preSessionData } = await supabase.auth.getSession();
          if (preSessionData?.session && (hasRecoveryEventDetected() || queryType === 'recovery')) {
            markRecoveryEventDetected();
            window.history.replaceState({}, document.title, '/reset-password');
            return { ok: true, email: preSessionData.session.user?.email || '' };
          }

          const { data, error } = await supabase.auth.exchangeCodeForSession(pkceCode);
          if (!error && data?.session) {
            markRecoveryEventDetected();
            window.history.replaceState({}, document.title, '/reset-password');
            return { ok: true, email: data.session.user?.email || '' };
          }

          // Re-check session once in case detectSessionInUrl finished concurrently
          const { data: postSessionData } = await supabase.auth.getSession();
          window.history.replaceState({}, document.title, '/reset-password');
          if (postSessionData?.session && (hasRecoveryEventDetected() || queryType === 'recovery')) {
            markRecoveryEventDetected();
            return { ok: true, email: postSessionData.session.user?.email || '' };
          }

          clearRecoveryEventDetected();
          return {
            ok: false,
            message: mapSupabaseRecoveryError(error?.message || '', (error as any)?.code),
          };
        })()
      );
    }
    return recoveryAttemptCache.get(cacheKey)!;
  }

  // 3. Implicit Hash Flow (#access_token=...&type=recovery)
  if (hashAccessToken && queryType === 'recovery') {
    const cacheKey = `hash:${hashAccessToken.slice(0, 24)}`;
    if (!recoveryAttemptCache.has(cacheKey)) {
      recoveryAttemptCache.set(
        cacheKey,
        (async (): Promise<RecoveryVerifyResult> => {
          await new Promise((resolve) => setTimeout(resolve, 180));
          const { data: existing } = await supabase.auth.getSession();
          if (existing?.session) {
            markRecoveryEventDetected();
            window.history.replaceState({}, document.title, '/reset-password');
            return { ok: true, email: existing.session.user?.email || '' };
          }

          if (hashRefreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: hashAccessToken,
              refresh_token: hashRefreshToken,
            });
            window.history.replaceState({}, document.title, '/reset-password');
            if (!error && data?.session) {
              markRecoveryEventDetected();
              return { ok: true, email: data.session.user?.email || '' };
            }
            clearRecoveryEventDetected();
            return {
              ok: false,
              message: mapSupabaseRecoveryError(error?.message || '', (error as any)?.code),
            };
          }

          window.history.replaceState({}, document.title, '/reset-password');
          clearRecoveryEventDetected();
          return {
            ok: false,
            message: 'رابط استعادة كلمة المرور غير مكتمل أو منتهي الصلاحية. يرجى طلب رابط جديد.',
          };
        })()
      );
    }
    return recoveryAttemptCache.get(cacheKey)!;
  }

  // 4. PASSWORD_RECOVERY event already detected (e.g. URL already processed by Supabase SDK)
  if (hasRecoveryEventDetected()) {
    const { data: sessData } = await supabase.auth.getSession();
    if (sessData?.session) {
      return { ok: true, email: sessData.session.user?.email || '' };
    }
    clearRecoveryEventDetected();
  }

  return {
    ok: false,
    message: 'رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية. يمكنك طلب رابط جديد أدناه.',
  };
}

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({
  onGoHome,
  onGoLogin,
}) => {
  const [status, setStatus] = useState<ResetPageStatus>('verifying');
  const [recoveredEmail, setRecoveredEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [invalidMessage, setInvalidMessage] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Resend new recovery link state when link is expired/invalid
  const [resendEmail, setResendEmail] = useState('');
  const [resendStatus, setResendStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [isSendingNewLink, setIsSendingNewLink] = useState(false);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        markRecoveryEventDetected();
        setRecoveredEmail(session.user.email || '');
        setStatus('ready');
      }
    });

    verifyRecoveryCallbackOnce().then((result) => {
      if (!active) return;
      if (result.ok && 'email' in result) {
        setRecoveredEmail(result.email);
        setStatus('ready');
      } else {
        setInvalidMessage('message' in result ? result.message : 'رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية.');
        setStatus('invalid');
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (newPassword.length < 8) {
      setFormError('يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('كلمة المرور وتأكيد كلمة المرور غير متطابقتين.');
      return;
    }

    setIsUpdating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        clearRecoveryEventDetected();
        setInvalidMessage('انتهت صلاحية جلسة استعادة كلمة المرور. يرجى طلب رابط جديد.');
        setStatus('invalid');
        return;
      }

      const { data: updatedData, error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError || !updatedData?.user) {
        const msg = mapSupabaseRecoveryError(
          updateError?.message || '',
          (updateError as any)?.code
        );
        if (
          (updateError?.message || '').toLowerCase().includes('session') ||
          (updateError?.message || '').toLowerCase().includes('expired')
        ) {
          clearRecoveryEventDetected();
          setInvalidMessage(msg);
          setStatus('invalid');
          return;
        }
        setFormError(msg);
        return;
      }

      clearRecoveryEventDetected();
      clearAuthToken();
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setNewPassword('');
      setConfirmPassword('');
      setStatus('success');
    } catch (err: any) {
      setFormError(mapSupabaseRecoveryError(err?.message || ''));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRequestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendStatus(null);
    const cleanEmail = resendEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setResendStatus({
        type: 'error',
        text: 'يرجى إدخال بريد إلكتروني صحيح لإرسال رابط الاستعادة.',
      });
      return;
    }

    setIsSendingNewLink(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: PASSWORD_RESET_REDIRECT_URL,
      });
      if (error) {
        throw error;
      }
      setResendStatus({
        type: 'success',
        text: 'تم إرسال رابط استعادة جديد إلى بريدك الإلكتروني بنجاح. افتح الرابط من البريد الوارد أو الرسائل غير المرغوب فيها.',
      });
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      setResendStatus({
        type: 'error',
        text:
          msg.includes('rate limit') || msg.includes('seconds')
            ? 'يرجى الانتظار دقيقة قبل طلب رابط استعادة جديد.'
            : err?.message || 'تعذر إرسال رابط الاستعادة حالياً. حاول مرة أخرى بعد قليل.',
      });
    } finally {
      setIsSendingNewLink(false);
    }
  };

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordsMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6"
    >
      {/* Top Minimal Brand Header */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between py-2">
        <button
          type="button"
          onClick={onGoHome}
          className="flex items-center gap-2.5 text-right group"
        >
          <img
            src="/brand-icon.png?v=3"
            alt="Yemen Task"
            className="w-9 h-9 rounded-xl object-contain border border-emerald-500/30 bg-white dark:bg-slate-900 p-0.5 shadow-sm"
          />
          <div>
            <div className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
              Yemen <span className="text-emerald-600 dark:text-emerald-400">Task</span>
            </div>
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              كسب اليمن · استعادة كلمة المرور
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onGoHome}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-colors"
        >
          <span>الرئيسية</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* Main Centered Recovery Card */}
      <main className="max-w-md w-full mx-auto my-8">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                تعيين كلمة مرور جديدة
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                إعادة تعيين كلمة المرور لحسابك في منصة Yemen Task
              </p>
            </div>
          </div>

          <div className="p-6">
            {status === 'verifying' && (
              <div className="py-10 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  جاري التحقق من رابط استعادة كلمة المرور...
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
                  يتم التحقق من صلاحية الرمز الأمني عبر خوادم المصادقة، يرجى الانتظار لحظة.
                </p>
              </div>
            )}

            {status === 'ready' && (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                {recoveredEmail && (
                  <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="truncate">
                      حساب الاستعادة:{' '}
                      <span className="font-mono font-bold" dir="ltr">
                        {recoveredEmail}
                      </span>
                    </div>
                  </div>
                )}

                {formError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span className="leading-relaxed">{formError}</span>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    كلمة المرور الجديدة
                  </label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      id="new-password-input"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="8 أحرف على الأقل"
                      dir="ltr"
                      className="w-full pr-9 pl-10 py-2.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      aria-label={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {passwordTooShort && (
                    <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="confirm-password-input"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    تأكيد كلمة المرور
                  </label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      id="confirm-password-input"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="أعد كتابة كلمة المرور الجديدة"
                      dir="ltr"
                      className="w-full pr-9 pl-10 py-2.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={
                        showConfirmPassword ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'
                      }
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {passwordsMismatch && (
                    <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                      كلمتا المرور غير متطابقتين.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isUpdating || passwordTooShort || passwordsMismatch}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري حفظ كلمة المرور...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>حفظ كلمة المرور</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {status === 'invalid' && (
              <div className="space-y-5">
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-extrabold">تعذر متابعة استعادة كلمة المرور</div>
                    <p className="leading-relaxed">
                      {invalidMessage ||
                        'رابط استعادة كلمة المرور منتهي الصلاحية أو غير صالح.'}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleRequestNewLink} className="space-y-3 pt-1">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    طلب رابط استعادة جديد
                  </div>
                  <div className="relative">
                    <Mail className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="أدخل بريدك الإلكتروني المسجل"
                      dir="ltr"
                      className="w-full pr-9 pl-3 py-2.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {resendStatus && (
                    <div
                      className={`p-3 rounded-xl text-xs border ${
                        resendStatus.type === 'success'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                          : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {resendStatus.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSendingNewLink}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSendingNewLink ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>جاري إرسال الرابط...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>إرسال رابط استعادة جديد</span>
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={onGoLogin}
                    className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    العودة إلى تسجيل الدخول
                  </button>
                  <button
                    type="button"
                    onClick={onGoHome}
                    className="font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    الصفحة الرئيسية
                  </button>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="py-4 space-y-5 text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                    تم تحديث كلمة المرور بنجاح
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    تم حفظ كلمة المرور الجديدة لحسابك بأمان. يمكنك الآن تسجيل الدخول باستخدام كلمة المرور الجديدة.
                  </p>
                </div>

                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onGoLogin}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-colors"
                  >
                    تسجيل الدخول الآن
                  </button>
                  <button
                    type="button"
                    onClick={onGoHome}
                    className="w-full py-2.5 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors"
                  >
                    العودة إلى الصفحة الرئيسية
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-md w-full mx-auto text-center text-[11px] text-slate-400 py-2">
        Yemen Task · منصة المهام الرقمية الآمنة
      </footer>
    </div>
  );
};
