import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { supabase } from '../../api/supabase.ts';
import { GeoLocationSelector, type GeoSingleValue } from '../common/GeoLocationSelector.tsx';
import { X, Lock, Phone, User, Mail, ArrowRight, Shield, Eye, EyeOff, Building2 } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'register' | 'owner' | 'forgot' | 'reset';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultMode = 'login' }) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'owner' | 'forgot' | 'reset'>(defaultMode);
  const [userType, setUserType] = useState<'user' | 'advertiser'>('user');
  
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('صنعاء');
  const [geoSelection, setGeoSelection] = useState<GeoSingleValue>({
    countryId: '',
    divisionId: null,
    pathTextAr: '',
    lowestNameAr: '',
  });
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(defaultMode);
    setUserType('user');
    setError('');
    setSuccessMessage('');
    if (typeof window !== 'undefined') {
      const refParam = new URLSearchParams(window.location.search).get('ref');
      if (refParam && refParam.trim()) {
        setReferralCode((prev) => prev || refParam.trim().toUpperCase());
      }
    }
  }, [isOpen, defaultMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'forgot') {
        const recoveryEmail = identifier.trim().toLowerCase();
        if (!recoveryEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recoveryEmail)) {
          throw new Error('أدخل البريد الإلكتروني المسجل في حسابك.');
        }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
          redirectTo: `${window.location.origin}/`,
        });
        if (resetError) throw resetError;
        setSuccessMessage('إذا كان البريد مسجلاً، فستصلك رسالة تحتوي رابطاً آمناً لإعادة تعيين كلمة المرور. تحقق من الوارد والرسائل غير المرغوب فيها.');
      } else if (mode === 'reset') {
        if (password.length < 8) throw new Error('يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.');
        if (password !== passwordConfirm) throw new Error('تأكيد كلمة المرور غير مطابق.');
        const { data: userData } = await supabase.auth.getUser();
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        const recoveredEmail = userData.user?.email || '';
        await supabase.auth.signOut({ scope: 'local' });
        setPassword('');
        setPasswordConfirm('');
        setIdentifier(recoveredEmail);
        setMode('login');
        setSuccessMessage('تم تغيير كلمة المرور بنجاح. سجّل الدخول الآن باستخدام كلمة المرور الجديدة.');
      } else if (mode === 'login' || mode === 'owner') {
        await login(identifier, password);
      } else {
        if (!geoSelection.countryId || !geoSelection.divisionId) {
          setError('يرجى تحديد الدولة والتقسيم الإداري الخاص بك قبل إنشاء الحساب.');
          setIsSubmitting(false);
          return;
        }
        const resolvedCity = geoSelection.lowestNameAr || geoSelection.pathTextAr || city || 'صنعاء';
        await register({
          fullName,
          phone,
          email: email.trim().toLowerCase(),
          password,
          city: resolvedCity,
          countryId: geoSelection.countryId,
          administrativeDivisionId: geoSelection.divisionId,
          referralCode: userType === 'user' ? (referralCode || undefined) : undefined,
          role: userType,
          companyName: userType === 'advertiser' ? companyName : undefined,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'فشلت العملية، يرجى التأكد من البيانات المدخلة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {mode === 'owner'
                ? 'بوابة دخول مالك المنصة المعتمد'
                : mode === 'login'
                ? 'تسجيل الدخول إلى Yemen Task'
                : userType === 'advertiser'
                ? 'إنشاء حساب معلن جديد'
                : 'إنشاء حساب مستخدم جديد'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'owner'
                ? 'تسجيل الدخول الحصري المخصص للمشرف ومالك النظام'
                : mode === 'login'
                ? 'أدخل بيانات حسابك للانتقال مباشرة إلى لوحة حسابك'
                : userType === 'advertiser'
                ? 'إدارة الحملات الإعلانية الممولة والترويج لأنشطتك'
                : 'انضم للمنصة وابدأ في إنجاز المهام وكسب الريال اليمني'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Type Switcher Tabs (Strictly only in Register mode) */}
        {mode === 'register' && (
          <div className="grid grid-cols-2 p-2 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs font-bold">
            <button
              type="button"
              onClick={() => setUserType('user')}
              className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                userType === 'user'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <User className="w-4 h-4" />
              <span>أنا مستخدم</span>
            </button>
            <button
              type="button"
              onClick={() => setUserType('advertiser')}
              className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                userType === 'advertiser'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>أنا معلن</span>
            </button>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {successMessage && (
            <div className="p-3 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg">
              {successMessage}
            </div>
          )}
          {error && (
            <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg">
              {error}
            </div>
          )}

          {userType === 'advertiser' && mode === 'register' && (
            <div className="p-3 text-xs bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl text-indigo-900 dark:text-indigo-200">
              تنبيه: حسابات المعلنين الجديدة تخضع للمراجعة والاعتماد من قِبل إدارة المنصة قبل السماح بإنشاء الحملات.
            </div>
          )}

          {mode === 'register' && (
            <>
              {userType === 'advertiser' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    اسم المنشأة أو الشركة التجارية
                  </label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="مثال: شركة اليمن للتقنية والاتصالات"
                      className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {userType === 'advertiser' ? 'اسم المسؤول أو الممثل الرسمي' : 'الاسم الرباعي الكامل (مطابق للهوية)'}
                </label>
                <div className="relative">
                  <User className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={userType === 'advertiser' ? 'مثال: مهندس خالد البحيري' : 'مثال: محمد عبدالله أحمد'}
                    className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رقم الهاتف الرسمي
                </label>
                <div className="relative">
                  <Phone className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="770000000"
                    className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <GeoLocationSelector
                  mode="single"
                  countryId={geoSelection.countryId}
                  divisionId={geoSelection.divisionId}
                  defaultCountryIso2="YE"
                  required
                  compact
                  onChange={(val) => {
                    setGeoSelection(val);
                    if (val.lowestNameAr) setCity(val.lowestNameAr);
                  }}
                />
                {userType === 'user' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      كود الإحالة (اختياري)
                    </label>
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      placeholder="كود دعوة الصديق"
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  البريد الإلكتروني {userType === 'advertiser' && '(مطلوب للمعلنين)'}
                </label>
                <div className="relative">
                  <Mail className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'owner' || mode === 'forgot') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {mode === 'owner' ? 'البريد الإلكتروني للمالك المعتمد' : mode === 'forgot' ? 'البريد الإلكتروني المسجل' : 'رقم الهاتف أو البريد الإلكتروني'}
              </label>
              <div className="relative">
                {mode === 'owner' ? (
                  <Mail className="absolute right-3 top-2.5 w-4 h-4 text-emerald-600" />
                ) : (
                  <Phone className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                )}
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={mode === 'owner' || mode === 'forgot' ? 'email@example.com' : '770000000'}
                  className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>
            </div>
          )}

          {mode !== 'forgot' && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {mode === 'reset' ? 'كلمة المرور الجديدة' : 'كلمة المرور'}
            </label>
            <div className="relative">
              <Lock className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pr-9 pl-10 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          )}
          {mode === 'reset' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">تأكيد كلمة المرور الجديدة</label>
              <input type="password" required minLength={8} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="أعد كتابة كلمة المرور" className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100" />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full mt-2 py-2.5 px-4 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
              mode === 'owner'
                ? 'bg-slate-900 hover:bg-slate-800 border border-slate-700'
                : mode === 'register' && userType === 'advertiser'
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isSubmitting ? (
              <span>جارٍ تنفيذ الطلب...</span>
            ) : (
              <>
                <span>
                  {mode === 'owner'
                    ? 'دخول لوحة تحكم المالك'
                    : mode === 'login'
                    ? 'تسجيل الدخول'
                    : mode === 'forgot'
                    ? 'إرسال رابط الاستعادة'
                    : mode === 'reset'
                    ? 'حفظ كلمة المرور الجديدة'
                    : (userType === 'advertiser' ? 'إنشاء حساب معلن جديد' : 'إنشاء الحساب وبدء الكسب')}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer switches */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 flex flex-col gap-2">
          {mode === 'login' ? (
            <>
            <div>
              نسيت كلمة المرور؟{' '}
              <button type="button" onClick={() => { setError(''); setSuccessMessage(''); setMode('forgot'); }} className="text-emerald-600 font-bold hover:underline">استعدها الآن</button>
            </div>
            <div>
              ليس لديك حساب بعد؟{' '}
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setMode('register');
                }}
                className="text-emerald-600 font-bold hover:underline"
              >
                سجل الآن مجاناً
              </button>
            </div>
            </>
          ) : mode === 'register' ? (
            <div>
              لديك حساب بالفعل؟{' '}
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setUserType('user');
                  setMode('login');
                }}
                className="text-emerald-600 font-bold hover:underline"
              >
                تسجيل الدخول
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setUserType('user');
                  setMode('login');
                }}
                className="text-emerald-600 font-bold hover:underline"
              >
                العودة لدخول المستخدمين
              </button>
            </div>
          )}

          {/* Discreet Owner Link at bottom */}
          {mode !== 'owner' && mode !== 'reset' && (
            <div className="pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
              <button
                type="button"
                onClick={() => { setError(''); setSuccessMessage(''); setMode('owner'); }}
                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex items-center justify-center gap-1 mx-auto"
              >
                <Shield className="w-3 h-3 text-slate-400" />
                <span>بوابة دخول مالك المنصة</span>
              </button>
            </div>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" onClick={() => { setError(''); setSuccessMessage(''); setMode('login'); }} className="text-emerald-600 font-bold hover:underline">العودة إلى تسجيل الدخول</button>
          )}
        </div>
      </div>
    </div>
  );
};
