import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { ReferralStat, ReferralRewardStatus } from '../../types/index.ts';
import { Users, Copy, Check, Gift, Award, CheckCircle2, Clock } from 'lucide-react';
import { formatYer } from '../../../shared/money.ts';

const STATUS_BADGES: Record<ReferralRewardStatus, { label: string; className: string }> = {
  awaiting_first_task: {
    label: 'بانتظار أول مهمة معتمدة',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  pending: {
    label: 'قيد التسوية المالية',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  },
  approved: {
    label: 'معتمدة بانتظار الصرف',
    className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
  },
  paid: {
    label: 'تم الصرف',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  },
  rejected: {
    label: 'مرفوضة',
    className: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800',
  },
};

export const ReferralView: React.FC = () => {
  const { user, showToast, openAuthModal } = useAuth();
  const [referrals, setReferrals] = useState<ReferralStat | null>(null);
  const [fallbackBonus, setFallbackBonus] = useState<number>(30);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadReferrals = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [res, settingsRes] = await Promise.all([
        api.getMyReferrals(),
        api.getSettings().catch(() => null),
      ]);
      const data: ReferralStat = res?.referrals || res;
      if (settingsRes?.referralBonus !== undefined) {
        setFallbackBonus(Number(settingsRes.referralBonus));
      } else if (settingsRes?.settings?.referralBonus !== undefined) {
        setFallbackBonus(Number(settingsRes.settings.referralBonus));
      }
      setReferrals(data);
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

  const activeCode = referrals?.code || user?.referralCode || '';
  const activeBonus = referrals?.referralBonus ?? fallbackBonus;
  const shareUrl =
    referrals?.shareUrl ||
    (activeCode ? `https://yemen-micro-tasks.vercel.app/?ref=${encodeURIComponent(activeCode)}` : 'https://yemen-micro-tasks.vercel.app/');

  const handleCopyLink = () => {
    if (!activeCode) {
      showToast('جاري تجهيز كود الإحالة الخاص بك، يرجى المحاولة بعد لحظة.', 'error');
      return;
    }
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    showToast('تم نسخ رابط الإحالة الخاص بك بنجاح!', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyCode = async () => {
    if (!activeCode) return;
    await navigator.clipboard.writeText(activeCode);
    showToast('تم نسخ كود الإحالة بنجاح!', 'success');
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
              يرجى تسجيل الدخول للحصول على رابط الإحالة الخاص بك وكسب مكافآت الريال اليمني عند إتمام أصدقائك أول مهمة معتمدة.
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
          شارك رابطك مع أصدقائك واكسب {formatYer(activeBonus)} ريال يمني فور إتمام كل صديق أول مهمة حقيقية واعتمادها من الإدارة.
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
            <p className="text-xs text-emerald-100">
              تُصرف مكافأة {formatYer(activeBonus)} ر.ي تلقائياً من خزينة المنصة بعد اعتماد أول مهمة ينجزها صديقك.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <div className="flex-1 w-full bg-slate-950/40 border border-white/20 rounded-xl px-4 py-3 flex items-center justify-between font-mono text-sm">
            <span className="truncate" dir="ltr">
              {shareUrl}
            </span>
            <button type="button" onClick={handleCopyCode} disabled={!activeCode} className="text-emerald-300 hover:text-white font-bold mr-2 text-xs shrink-0 underline disabled:opacity-50">
              نسخ الكود: {activeCode || '---'}
            </button>
          </div>

          <button
            onClick={handleCopyLink}
            disabled={!activeCode}
            className="w-full sm:w-auto px-6 py-3 bg-white text-emerald-900 font-bold text-xs rounded-xl hover:bg-emerald-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shrink-0 shadow"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الرابط'}</span>
          </button>
        </div>
      </div>

      {/* 4 Real Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">المسجلون عبر رابطك</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {referrals?.totalReferred ?? 0}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">المؤهلون (أتموا أول مهمة)</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-sky-600 dark:text-sky-400">
              {referrals?.qualifiedReferralsCount ?? 0}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center text-sky-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">المكافآت المصروفة</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {referrals?.paidRewardsCount ?? 0}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block mb-1">إجمالي الأرباح المحققة</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatYer(referrals?.totalEarnedYer ?? 0)}{' '}
              <span className="text-xs font-normal">ر.ي</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
            <Award className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Table of referred friends */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">قائمة الأصدقاء المسجلين وحالة الاستحقاق</h3>
        {isLoading ? (
          <p className="text-xs text-slate-400">جاري تحميل قائمة الإحالات...</p>
        ) : !referrals || referrals.referredUsers.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            لم يقم أحد بالتسجيل عبر رابطك بعد. شارك الرابط على واتساب وفيسبوك وابدأ بجني المكافآت!
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {referrals.referredUsers.map((u) => {
              const badge = STATUS_BADGES[u.rewardStatus] || STATUS_BADGES.awaiting_first_task;
              return (
                <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white block">{u.fullName}</span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(u.createdAt).toLocaleDateString('ar-YE')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <div
                      className={`text-left font-mono font-bold min-w-[72px] ${
                        u.rewardStatus === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {u.rewardEarned > 0 ? `+${formatYer(u.rewardEarned)} ر.ي` : '0 ر.ي'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

