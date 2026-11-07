import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { ReferralStat } from '../../types/index.ts';
import { Users, Copy, Check, Gift, Share2, Award } from 'lucide-react';

export const ReferralView: React.FC = () => {
  const { user, showToast, openAuthModal } = useAuth();
  const [referrals, setReferrals] = useState<ReferralStat | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadReferrals = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.getMyReferrals();
      setReferrals(res.referrals);
    } catch (err) {
      console.error('Error loading referrals', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadReferrals();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const handleCopyLink = () => {
    const link = referrals?.shareUrl || `https://kasbyemen.com/?ref=${user?.referralCode || 'AHMED26'}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    showToast('تم نسخ رابط الإحالة الخاص بك بنجاح!', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  if (!user) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center">
        <div className="p-8 sm:p-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm">
            <Users className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              برنامج دعوة الأصدقاء
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              يرجى تسجيل الدخول للحصول على رابط الإحالة الخاص بك وكسب مكافآت الريال اليمني عند انضمام أصدقائك.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <span>تسجيل الدخول</span>
            </button>
            <button
              type="button"
              onClick={() => openAuthModal('register')}
              className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors"
            >
              <span>إنشاء حساب جديد</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
          برنامج دعوة الأصدقاء والإحالات
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          شارك رابطك مع أصدقائك في اليمن واكسب 300 ريال يمني عن كل صديق ينجز مهمته الأولى.
        </p>
      </div>

      {/* Share Box */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 text-white shadow-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold">كود الإحالة الخاص بك</h2>
            <p className="text-xs text-emerald-100">يحصل صديقك على مكافأة ترحيبية فورية وتحصل أنت على 300 ر.ي</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <div className="flex-1 w-full bg-slate-950/40 border border-white/20 rounded-xl px-4 py-3 flex items-center justify-between font-mono text-sm">
            <span className="truncate" dir="ltr">
              {referrals?.shareUrl || `https://kasbyemen.com/?ref=${user?.referralCode || 'AHMED26'}`}
            </span>
            <span className="text-emerald-300 font-bold mr-2 text-xs">كود: {user?.referralCode}</span>
          </div>

          <button
            onClick={handleCopyLink}
            className="w-full sm:w-auto px-6 py-3 bg-white text-emerald-900 font-bold text-xs rounded-xl hover:bg-emerald-50 transition-colors flex items-center justify-center gap-2 shrink-0 shadow"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الرابط'}</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">عدد الأصدقاء المسجلين عبرك</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {referrals?.totalReferred || 0}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-emerald-600">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">أرباح الإحالات المكتسبة</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {referrals?.totalEarnedYer.toLocaleString() || '0'}{' '}
              <span className="text-xs font-normal">ر.ي</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-emerald-600">
            <Award className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Table of referred friends */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">قائمة الأصدقاء المسجلين</h3>
        {isLoading ? (
          <p className="text-xs text-slate-400">جاري تحميل قائمة الإحالات...</p>
        ) : !referrals || referrals.referredUsers.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            لم يقم أحد بالتسجيل عبر رابطك بعد. شارك الرابط على واتساب وفيسبوك وابدأ بجني المكافآت!
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {referrals.referredUsers.map((u) => (
              <div key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white block">{u.fullName}</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {new Date(u.createdAt).toLocaleDateString('ar-YE')}
                  </span>
                </div>
                <div className="text-left font-mono font-bold text-emerald-600">
                  +{u.rewardEarned.toLocaleString()} ر.ي
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
