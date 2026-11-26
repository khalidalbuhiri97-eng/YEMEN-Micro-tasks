import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Mail, Loader2, RefreshCw, ArrowRight, ShieldCheck } from 'lucide-react';
import { supabase } from '../../api/supabase.ts';
import { api, setAuthTokens } from '../../api/client.ts';

type VerifyStatus = 'checking' | 'waiting' | 'success' | 'error';
type VerifyResult = { ok: true; email: string } | { ok: false; message: string };
const attempts = new Map<string, Promise<VerifyResult>>();

function errorText(message: string, code?: string): string {
  const value = `${message || ''} ${code || ''}`.toLowerCase();
  if (value.includes('expired') || value.includes('otp_expired') || value.includes('invalid grant')) {
    return 'انتهت صلاحية رابط التحقق أو تم استخدامه مسبقاً. أرسل رسالة تحقق جديدة.';
  }
  if (value.includes('code verifier') || value.includes('pkce') || value.includes('invalid')) {
    return 'رابط التحقق غير صالح. افتح أحدث رسالة وصلتك أو اطلب رسالة جديدة.';
  }
  return message || 'تعذر التحقق من البريد الإلكتروني. حاول مرة أخرى.';
}

async function processVerification(): Promise<VerifyResult> {
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
    const key = 'otp:' + tokenHash;
    if (!attempts.has(key)) attempts.set(key, (async () => {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' });
      window.history.replaceState({}, document.title, '/verify-email');
      if (verifyError || !data?.session) return { ok: false, message: errorText(verifyError?.message || 'لم يتم إنشاء جلسة دخول بعد التحقق.', (verifyError as any)?.code) };
      setAuthTokens(data.session.access_token, data.session.refresh_token);
      return { ok: true, email: data.session.user?.email || '' };
    })());
    return attempts.get(key)!;
  }

  if (code) {
    const key = 'pkce:' + code;
    if (!attempts.has(key)) attempts.set(key, (async () => {
      await new Promise(resolve => setTimeout(resolve, 180));
      let { data: current } = await supabase.auth.getSession();
      if (!current.session) {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error) {
          await new Promise(resolve => setTimeout(resolve, 150));
          current = (await supabase.auth.getSession()).data;
          if (!current.session) {
            window.history.replaceState({}, document.title, '/verify-email');
            return { ok: false, message: errorText(exchanged.error.message, (exchanged.error as any).code) };
          }
        } else {
          current = { session: exchanged.data.session, user: exchanged.data.user };
        }
      }
      window.history.replaceState({}, document.title, '/verify-email');
      if (!current.session?.user?.email_confirmed_at) return { ok: false, message: 'لم يؤكد خادم المصادقة البريد بعد. اطلب رسالة تحقق جديدة.' };
      setAuthTokens(current.session.access_token, current.session.refresh_token);
      return { ok: true, email: current.session.user.email || '' };
    })());
    return attempts.get(key)!;
  }

  if (accessToken && refreshToken && (type === 'signup' || type === 'email')) {
    const key = 'implicit:' + accessToken.slice(0, 24);
    if (!attempts.has(key)) attempts.set(key, (async () => {
      const { data, error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      window.history.replaceState({}, document.title, '/verify-email');
      if (sessionError || !data.session?.user?.email_confirmed_at) return { ok: false, message: errorText(sessionError?.message || 'لم يكتمل تأكيد البريد.', (sessionError as any)?.code) };
      setAuthTokens(data.session.access_token, data.session.refresh_token);
      return { ok: true, email: data.session.user.email || '' };
    })());
    return attempts.get(key)!;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session?.user?.email_confirmed_at) {
    setAuthTokens(data.session.access_token, data.session.refresh_token);
    window.history.replaceState({}, document.title, '/verify-email');
    return { ok: true, email: data.session.user.email || '' };
  }
  return { ok: false, message: 'لم نعثر على رابط تحقق صالح. افتح رابط التفعيل من أحدث رسالة بريدية.' };
}

export const EmailVerificationPage: React.FC<{ onGoHome: () => void }> = ({ onGoHome }) => {
  const email = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('email') || ''; } catch { return ''; }
  }, []);
  const onGoHomeRef = useRef(onGoHome);
  useEffect(() => { onGoHomeRef.current = onGoHome; }, [onGoHome]);
  const [status, setStatus] = useState<VerifyStatus>('checking');
  const [message, setMessage] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState(email);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let active = true;
    processVerification().then(result => {
      if (!active) return;
      if (result.ok) {
        setVerifiedEmail(result.email || email);
        setStatus('success');
        setMessage('تم تأكيد بريدك الإلكتروني وتسجيل دخولك بنجاح. سيتم تحويلك إلى الصفحة الرئيسية.');
        window.setTimeout(() => onGoHomeRef.current(), 1300);
      } else {
        setStatus('waiting');
        setMessage(result.message);
      }
    }).catch(err => {
      if (!active) return;
      setStatus('waiting');
      setMessage(errorText(err?.message || 'تعذر إكمال التحقق.'));
    });
    return () => { active = false; };
  }, [email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!verifiedEmail || resending || cooldown > 0) return;
    setResending(true);
    setMessage('');
    try {
      const result = await api.resendVerificationEmail(verifiedEmail);
      setMessage(result?.message || 'تم إرسال رسالة تحقق جديدة إذا كان الحساب بحاجة إلى التفعيل. افحص الوارد والرسائل غير المرغوب فيها.');
      setCooldown(60);
    } catch (err: any) {
      setMessage(err?.message || 'تعذر إرسال رسالة التحقق حالياً. حاول لاحقاً.');
    } finally {
      setResending(false);
    }
  };

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
              {status === 'checking' ? <Loader2 className="w-8 h-8 animate-spin" /> : status === 'success' ? <CheckCircle2 className="w-8 h-8" /> : <Mail className="w-8 h-8" />}
            </div>
            <h1 className="mt-4 text-xl font-black">{status === 'checking' ? 'جارٍ التحقق من بريدك' : status === 'success' ? 'تم تفعيل حسابك بنجاح' : 'تحقق من بريدك الإلكتروني'}</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">{status === 'checking' ? 'لحظة واحدة، نتحقق من رابط التفعيل بأمان.' : message || 'افتح رسالة Yemen Task واضغط على رابط التفعيل لإكمال التسجيل.'}</p>
          </div>
          <div className="p-6 space-y-4">
            {verifiedEmail && <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-center"><div className="text-[11px] text-slate-500 mb-1">البريد الإلكتروني</div><div dir="ltr" className="font-semibold text-sm break-all">{verifiedEmail}</div></div>}
            {status !== 'success' && <div className="space-y-3">
              <div className="flex gap-2 items-start text-xs text-slate-500"><ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /><span>إذا لم تجد الرسالة، افحص مجلد الرسائل غير المرغوب فيها أو البريد الترويجي.</span></div>
              {verifiedEmail && <button type="button" onClick={resend} disabled={resending || cooldown > 0} className="w-full rounded-xl py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50 inline-flex justify-center items-center gap-2">{resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{resending ? 'جارٍ إرسال الرسالة...' : cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : 'إعادة إرسال رسالة التحقق'}</button>}
            </div>}
            {message && status !== 'checking' && <div role="status" className={`rounded-xl p-3 text-xs leading-6 flex gap-2 ${status === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'}`}><AlertCircle className="w-4 h-4 shrink-0 mt-1" /><span>{message}</span></div>}
            {status === 'success' && <div className="text-center text-xs text-emerald-600 font-semibold">سيتم تحويلك تلقائياً إلى Yemen Task…</div>}
          </div>
        </section>
      </main>
      <footer className="max-w-md w-full mx-auto text-center text-[10px] text-slate-400">Yemen Task · حسابك محمي بنظام التحقق من البريد الإلكتروني</footer>
    </div>
  );
};
