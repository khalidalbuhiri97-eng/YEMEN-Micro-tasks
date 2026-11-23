import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../api/client.ts';
import { supabase, PASSWORD_RESET_REDIRECT_URL } from '../../api/supabase.ts';
import { EmailVerificationBanner } from '../common/EmailVerificationBanner.tsx';
import {
  User,
  Mail,
  Lock,
  ShieldCheck,
  LogOut,
  Send,
  CheckCircle2,
  AlertCircle,
  Building2,
  Phone,
  MapPin,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { user, logout, refreshUser, showToast, openConfirmModal } = useAuth();
  
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!user) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        يرجى تسجيل الدخول للوصول إلى إعدادات الحساب.
      </div>
    );
  }

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg('يرجى إدخال بريد إلكتروني جديد صحيح.');
      return;
    }

    if (cleanEmail === user.email?.toLowerCase()) {
      setErrorMsg('البريد الإلكتروني الجديد مطابق للبريد الحالي.');
      return;
    }

    openConfirmModal({
      title: 'تغيير البريد الإلكتروني للحساب',
      message: `هل تريد حقاً تغيير بريدك الإلكتروني إلى ${cleanEmail}؟ سيتم إرسال رسالة تأكيد أمنية إلى البريد الجديد.`,
      confirmLabel: 'تأكيد التغيير',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        setIsUpdatingEmail(true);
        try {
          const { error } = await supabase.auth.updateUser({ email: cleanEmail });
          if (error) throw error;
          setSuccessMsg('تم إرسال رسالة التأكيد إلى بريدك الإلكتروني الجديد. يرجى التحقق لإتمام التغيير.');
          setNewEmail('');
          await refreshUser();
        } catch (err: any) {
          setErrorMsg(err?.message || 'تعذر تغيير البريد الإلكتروني.');
        } finally {
          setIsUpdatingEmail(false);
        }
      },
    });
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (newPassword.length < 8) {
      setErrorMsg('يجب ألا تقل كلمة المرور الجديدة عن 8 أحرف.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('تأكيد كلمة المرور غير مطابق.');
      return;
    }

    openConfirmModal({
      title: 'تغيير كلمة المرور',
      message: 'هل أنت متأكد من رغبتك في تغيير كلمة المرور الحالية؟',
      confirmLabel: 'تغيير كلمة المرور',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        setIsUpdatingPassword(true);
        try {
          const { error } = await supabase.auth.updateUser({ password: newPassword });
          if (error) throw error;
          setSuccessMsg('تم تحديث كلمة المرور بنجاح.');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        } catch (err: any) {
          setErrorMsg(err?.message || 'تعذر تحديث كلمة المرور.');
        } finally {
          setIsUpdatingPassword(false);
        }
      },
    });
  };

  const handleSendPasswordReset = async () => {
    if (!user.email || isSendingReset) return;
    setIsSendingReset(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: PASSWORD_RESET_REDIRECT_URL,
      });
      if (error) throw error;
      setSuccessMsg('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر إرسال رابط إعادة تعيين كلمة المرور.');
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
          إعدادات الحساب والمصادقة الآمنة
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          إدارة بياناتك الشخصية، البريد الإلكتروني، كلمات المرور، وحالة توثيق الحساب عبر Supabase Auth.
        </p>
      </div>

      <EmailVerificationBanner contextLabel="لضمان كامل صلاحيات السحب وتوثيق العمليات" />

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Account Info Summary Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <User className="w-4 h-4 text-emerald-600" />
          <span>معلومات الحساب الأساسية</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">الاسم الكامل:</span>
            <div className="font-extrabold text-slate-900 dark:text-white">{user.fullName}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">رقم الهاتف:</span>
            <div className="font-mono font-bold text-slate-900 dark:text-white" dir="ltr">{user.phone}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">البريد الإلكتروني الحالي:</span>
            <div className="font-mono font-bold text-slate-900 dark:text-white truncate" dir="ltr">{user.email || 'غير متوفر'}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">حالة توثيق البريد:</span>
            <div className="font-bold">
              {user.emailVerified ? (
                <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> موثق رسمياً
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> بانتظار التأكيد
                </span>
              )}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">المدينة / النطاق:</span>
            <div className="font-bold text-slate-900 dark:text-white">{user.locationPath || user.city || 'صنعاء'}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 space-y-1">
            <span className="text-slate-400">كود الإحالة الخاص:</span>
            <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{user.referralCode}</div>
          </div>
        </div>
      </div>

      {/* Change Email Form */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Mail className="w-4 h-4 text-emerald-600" />
          <span>تغيير البريد الإلكتروني الآمن (Secure Email Change)</span>
        </h2>
        <p className="text-xs text-slate-500">
          سيتم إرسال رابط تأكيد إلى بريدك الإلكتروني الجديد لضمان أمان حسابك وعدم انقطاع الوصول.
        </p>

        <form onSubmit={handleUpdateEmail} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              البريد الإلكتروني الجديد
            </label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new-email@example.com"
              className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            disabled={isUpdatingEmail}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow transition-colors disabled:opacity-50"
          >
            {isUpdatingEmail ? 'جاري إرسال طلب التغيير...' : 'تحديث البريد الإلكتروني'}
          </button>
        </form>
      </div>

      {/* Change Password Form */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-600" />
          <span>تغيير كلمة المرور</span>
        </h2>

        <form onSubmit={handleUpdatePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              كلمة المرور الجديدة (8 أحرف على الأقل)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              تأكيد كلمة المرور الجديدة
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              dir="ltr"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isUpdatingPassword}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow transition-colors disabled:opacity-50"
            >
              {isUpdatingPassword ? 'جاري التحديث...' : 'حفظ كلمة المرور الجديدة'}
            </button>

            <button
              type="button"
              onClick={handleSendPasswordReset}
              disabled={isSendingReset}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
            >
              {isSendingReset ? 'جاري الإرسال...' : 'إرسال رابط الاستعادة عبر البريد'}
            </button>
          </div>
        </form>
      </div>

      {/* Logout Action */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">تسجيل الخروج الآمن</div>
          <p className="text-xs text-slate-500 mt-0.5">إنهاء الجلسة الحالية وإزالة رموز المصادقة من الجهاز.</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 shrink-0 border border-rose-200 dark:border-rose-800"
        >
          <LogOut className="w-4 h-4" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );
};
