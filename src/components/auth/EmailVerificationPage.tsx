import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Mail, Loader2, RefreshCw, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react';
import { supabase } from '../../api/supabase.ts';
import { api, setAuthTokens } from '../../api/client.ts';

type VerifyStatus = 'waiting' | 'verifying' | 'success' | 'error';
type VerifyResult = { ok: true; email: string } | { ok: false; message: string };
const attempts = new Map<string, Promise<VerifyResult>>();

function errorText(message: string, code?: string): string {
  const value = `${message || ''} ${code || ''}`.toLowerCase();
  if (value.includes('expired') || value.includes('otp_expired')) return 'انتهت صلاحية رمز التحقق. أرسل رمزاً جديداً وحاول مرة أخرى.';
  if (value.includes('invalid') || value.includes('token')) return 'رمز التحقق غير صحيح أو تم استخدامه مسبقاً. تأكد من الرمز الموجود في أحدث رسالة.';
  if (value.includes('rate limit') || value.includes('too many')) return 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.';
  return message || 'تعذر التحقق من البريد الإلكتروني. حاول مرة أخرى.';
}

// Keep support for confirmation messages already sent before switching to OTP.
async function processLegacyVerification(): Promise<VerifyResult> {
  const url = new URL(window.location.href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const error = query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error');
  const errorCode = query.get('error_code') || hash.get('error_code') || undefined;
  if (error || errorCode) {
    window.history.replaceState({}, document.title, '/verify-email');
    return { ok: false, message: errorText(error || 'تعذر التحقق من الرابط.', errorCode) };
  }

  const tokenHash = query.get('token_hash') || hash.get('token_hash');
  const type = query.get('type') || hash.get('type');
  const code = query.get('code');
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');

  if (tokenHash && (type === 'signup' || type === 'email')) {
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' });
    window.history.replaceState({}, document.title, '/verify-email');
    if (verifyError || !data?.session) return { ok: false, message: errorText(verifyError?.message || 'تعذر إنشاء جلسة الدخول بعد التحقق.') };
    setAuthTokens(data.session.access_token, data.session.refresh_token);
    return { ok: true, email: data.session.user?.email || '' };
  }
  if (code) {
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    window.history.replaceState({}, document.title, '/verify-email');
    if (exchangeError || !data.session) return { ok: false, message: errorText(exchangeError?.message || 'رابط التحقق القديم غير صالح.') };
    setAuthTokens(data.session.access_token, data.session.refresh_token);
    return { ok: true, email: data.session.user?.email || '' };
  }
  if (accessToken && refreshToken && (type === 'signup' || type === 'email')) {
    const { data, error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    window.history.replaceState({}, document.title, '/verify-email');
    if (sessionError || !data.session) return { ok: false, message: errorText(sessionError?.message || 'تعذر إكمال التحقق القديم.') };
    setAuthTokens(data.session.access_token, data.session.refresh_token);
    return { ok: true, email: data.session.user?.email || '' };
  }
  return { ok: false, message: 'تعذر قراءة رابط التحقق القديم.' };
}

export const EmailVerificationPage: React.FC<{ onGoHome: () => void }> = ({ onGoHome }) => {
  const emailFromUrl = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('email') || ''; } catch { return ''; }
  }, []);
  const onGoHomeRef = useRef(onGoHome);
  useEffect(() => { onGoHomeRef.current = onGoHome; }, [onGoHome]);
  const [status, setStatus] = useState<VerifyStatus>('waiting');
  const [message, setMessage] = useState('أدخل رمز التحقق المكوّن من 6 أرقام الذي أرسلناه إلى بريدك الإلكتروني.');
  const [verifiedEmail, setVerifiedEmail] = useState(emailFromUrl);
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hasLegacyCallback = Boolean(
      url.searchParams.get('token_hash') || url.searchParams.get('code') ||
      url.searchParams.get('error') || url.searchParams.get('error_description') ||
      url.hash.includes('access_token=') || url.hash.includes('token_hash=')
    );
    if (!hasLegacyCallback) return;
    let active = true;
    processLegacyVerification().then(result => {
      if (!active) return;
      if (result.ok) {
        setVerifiedEmail(result.email || emailFromUrl);
        setStatus('success');
        setMessage('تم تأكيد بريدك الإلكتروني وتسجيل دخولك بنجاح. سيتم تحويلك إلى الصفحة الرئيسية.');
        window.setTimeout(() => onGoHomeRef.current(), 1300);
      } else {
        setStatus('error');
        setMessage(result.message);
      }
    }).catch(err => {
      if (!active) return;
      setStatus('error');
      setMessage(errorText(err?.message || 'تعذر إكمال التحقق القديم.'));
    });
    return () => { active = false; };
  }, [emailFromUrl]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const verifyCode = async () => {
    const cleanEmail = verifiedEmail.trim().toLowerCase();
    const cleanToken = token.replace(/\\D/g, '').slice(0, 6);
    if (!cleanEmail) { setMessage('البريد الإلكتروني غير موجود. ارجع إلى التسجيل وأعد المحاولة.'); return; }
    if (!/^\\d{6}$/.test(cleanToken)) { setMessage('أدخل رمز التحقق المكوّن من 6 أرقام.'); return; }
    if (verifying) return;
    setVerifying(true);
    setStatus('verifying');
    setMessage('جارٍ التحقق من الرمز...');
    try {
      const key = `${cleanEmail}:${cleanToken}`;
      let request = attempts.get(key);
      if (!request) {
        request = (async () => {
          const { data, error } = await supabase.auth.verifyOtp({ email: cleanEmail, token: cleanToken, type: 'email' });
          if (error || !data?.session) return { ok: false, message: errorText(error?.message || 'لم يُرجع خادم المصادقة جلسة دخول.') };
          setAuthTokens(data.session.access_token, data.session.refresh_token);
          return { ok: true, email: data.session.user?.email || cleanEmail };
        })();
        attempts.set(key, request);
      }
      const result = await request;
      if (!result.ok) {
        setStatus('error');
        setMessage(result.message);
        return;
      }
      setVerifiedEmail(result.email);
      setStatus('success');
      setMessage('تم تأكيد بريدك الإلكتروني وتسجيل دخولك بنجاح. سيتم تحويلك إلى الصفحة الرئيسية.');
      window.setTimeout(() => onGoHomeRef.current(), 1300);
    } catch (err: any) {
      setStatus('error');
      setMessage(errorText(err?.message || 'تعذر التحقق من الرمز.'));
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (!verifiedEmail || resending || cooldown > 0) return;
    setResending(true);
    setMessage('');
    try {
      const result = await api.resendVerificationEmail(verifiedEmail);
      setMessage(result?.message || 'تم طلب إرسال رمز تحقق جديد. افحص الوارد والرسائل غير المرغوب فيها.');
      setCooldown(60);
      setToken('');
      setStatus('waiting');
    } catch (err: any) {
      setMessage(err?.message || 'تعذر إرسال رمز التحقق حالياً. حاول لاحقاً.');
      setStatus('error');
    } finally {
      setResending(false);
    }
  };

  const busy = verifying || status === 'success';

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-md w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <img src="/brand-icon.png?v=3" alt="Yemen Task" className="w-9 h-9 rounded-xl object-contain border border-emerald-500/30 bg-white dark:bg-slate-900 p-0.5" />
          <div><div className="text-sm font-black">Yemen <span className="text-emerald-600">Task</span></div><div className="text-[10px] text-slate-500">تفعيل الحساب</div></div>
        </div>
        <button type="button" onClick={onGoHome} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"><span>الرئيسية</span><ArrowRight className="w-3.5 h-3.5" /></button>
      </header>
      <main className="max-w-md w-full mx-auto my-8">
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
          <div className="p-6 text-center border-b border-slate-100 dark:border-slate-800">
            <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center ${status === 'success' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950' : status === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950'}`}>
              {status === 'verifying' ? <Loader2 className="w-8 h-8 animate-spin" /> : status === 'success' ? <CheckCircle2 className="w-8 h-8" /> : <KeyRound className="w-8 h-8" />}
            </div>
            <h1 className="mt-4 text-xl font-black">{status === 'success' ? 'تم تفعيل حسابك بنجاح' : status === 'verifying' ? 'جارٍ التحقق من الرمز' : 'أدخل رمز التحقق'}</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">{message}</p>
          </div>
          <div className="p-6 space-y-4">
            {verifiedEmail && <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-center"><div className="text-[11px] text-slate-500 mb-1">أرسلنا الرمز إلى</div><div dir="ltr" className="font-semibold text-sm break-all">{verifiedEmail}</div></div>}
            {status !== 'success' && <>
              <label htmlFor="email-verification-code" className="block text-sm font-bold">رمز التحقق (6 أرقام)</label>
              <input id="email-verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={token} onChange={e => setToken(e.target.value.replace(/\\D/g, '').slice(0, 6))} placeholder="000000" dir="ltr" className="w-full text-center tracking-[0.55em] text-2xl font-black rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-4 outline-none focus:border-emerald-500" />
              <button type="button" onClick={verifyCode} disabled={busy || token.length !== 6 || !verifiedEmail} className="w-full rounded-xl py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50 inline-flex justify-center items-center gap-2">{verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}{verifying ? 'جارٍ التحقق...' : 'تأكيد الرمز وتسجيل الدخول'}</button>
              <div className="flex gap-2 items-start text-xs text-slate-500"><ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /><span>لا تشارك رمز التحقق مع أي شخص. إذا لم تجد الرسالة، افحص البريد غير المرغوب فيه.</span></div>
              {verifiedEmail && <button type="button" onClick={resend} disabled={resending || cooldown > 0} className="w-full rounded-xl py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold disabled:opacity-50 inline-flex justify-center items-center gap-2">{resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{resending ? 'جارٍ إرسال الرمز...' : cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : 'إعادة إرسال رمز التحقق'}</button>}
            </>}
            {status === 'success' && <div className="text-center text-xs text-emerald-600 font-semibold">سيتم تحويلك تلقائياً إلى Yemen Task…</div>}
            {status === 'error' && <div role="alert" className="rounded-xl p-3 text-xs leading-6 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><AlertCircle className="w-4 h-4 inline ml-1" />{message}</div>}
          </div>
        </section>
      </main>
      <footer className="max-w-md w-full mx-auto text-center text-[10px] text-slate-400">Yemen Task · رمز تحقق لمرة واحدة لحماية حسابك</footer>
    </div>
  );
};
