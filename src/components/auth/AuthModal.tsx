import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { X, Lock, Phone, User, MapPin, Mail, ArrowRight, Shield } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'register' | 'owner';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultMode = 'login' }) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'owner'>(defaultMode);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('صنعاء');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'login' || mode === 'owner') {
        await login(identifier, password);
      } else {
        await register({
          fullName,
          phone,
          email: email || undefined,
          password,
          city,
          referralCode: referralCode || undefined,
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
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {mode === 'owner'
                ? 'بوابة دخول مالك المنصة المعتمد'
                : mode === 'login'
                ? 'تسجيل الدخول إلى Yemen Micro-tasks'
                : 'إنشاء حساب جديد'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'owner'
                ? 'تسجيل الدخول الحصري المخصص للمشرف ومالك النظام'
                : mode === 'login'
                ? 'ادخل بيانات حسابك لمتابعة المهام والأرباح الفعلية'
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg">
              {error}
            </div>
          )}

          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  الاسم الرباعي الكامل (مطابق للهوية للحوالات المالية)
                </label>
                <div className="relative">
                  <User className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: محمد عبدالله أحمد القدسي"
                    className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رقم الهاتف اليمني (يمن موبايل، سبأفون، يو، واي)
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    المدينة / المحافظة
                  </label>
                  <div className="relative">
                    <MapPin className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full pr-9 pl-2 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                    >
                      <option value="صنعاء">صنعاء</option>
                      <option value="عدن">عدن</option>
                      <option value="تعز">تعز</option>
                      <option value="الحديدة">الحديدة</option>
                      <option value="إب">إب</option>
                      <option value="حضرموت (المكلا)">المكلا</option>
                      <option value="مأرب">مأرب</option>
                      <option value="ذمار">ذمار</option>
                    </select>
                  </div>
                </div>
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
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  البريد الإلكتروني (اختياري)
                </label>
                <div className="relative">
                  <Mail className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'owner') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {mode === 'owner' ? 'البريد الإلكتروني للمالك المعتمد' : 'رقم الهاتف أو البريد الإلكتروني'}
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
                  placeholder={mode === 'owner' ? 'khalidalbuhiri@gmail.com' : '770000000'}
                  className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full mt-2 py-2.5 px-4 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
              mode === 'owner'
                ? 'bg-slate-900 hover:bg-slate-800 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isSubmitting ? (
              <span>جاري التحقق من الخادم...</span>
            ) : (
              <>
                <span>
                  {mode === 'owner'
                    ? 'دخول لوحة تحكم المالك'
                    : mode === 'login'
                    ? 'تسجيل الدخول'
                    : 'إنشاء الحساب وبدء الكسب'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer switches */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 flex flex-col gap-2">
          {mode === 'login' ? (
            <div>
              ليس لديك حساب بعد؟{' '}
              <button
                type="button"
                onClick={() => setMode('register')}
                className="text-emerald-600 font-bold hover:underline"
              >
                سجل الآن مجاناً
              </button>
            </div>
          ) : mode === 'register' ? (
            <div>
              لديك حساب بالفعل؟{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-emerald-600 font-bold hover:underline"
              >
                تسجيل الدخول
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-emerald-600 font-bold hover:underline"
              >
                العودة لدخول المستخدمين
              </button>
            </div>
          )}

          {/* Discreet Owner Link at bottom */}
          {mode !== 'owner' && (
            <div className="pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
              <button
                type="button"
                onClick={() => setMode('owner')}
                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex items-center justify-center gap-1 mx-auto"
              >
                <Shield className="w-3 h-3 text-slate-400" />
                <span>بوابة دخول مالك المنصة</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
