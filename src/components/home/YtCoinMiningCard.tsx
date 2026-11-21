import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Pickaxe, Flame, RefreshCw, ShieldCheck, LockKeyhole } from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';

type MiningSummary = {
  balanceUnits?: number;
  lifetimeEarnedUnits?: number;
  miningEnabled?: boolean;
  dailyCapConfigured?: boolean;
  nextRewardUnits?: number;
  lastClaimDate?: string | null;
  streakDay?: number;
  eligible?: boolean;
  eligibilityMessage?: string | null;
  dailyCapRemainingUnits?: number;
};

const toCoin = (units?: number) => (Number(units || 0) / 1_000_000).toFixed(2);

export const YtCoinMiningCard: React.FC = () => {
  const { user, openAuthModal, showToast } = useAuth();
  const [summary, setSummary] = useState<MiningSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user || typeof navigator !== 'undefined' && !navigator.onLine) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.getMyYtCoinSummary();
      setSummary(result.summary || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل بيانات التعدين.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const claim = async () => {
    if (!user || claiming) return;
    setClaiming(true);
    try {
      const response = await api.claimDailyYtCoin();
      const result = response.result || {};
      if (result.success && result.status === 'claimed') {
        showToast(`تمت إضافة ${toCoin(result.amount_units)} YT إلى رصيدك.`, 'success');
      } else {
        showToast(result.message || 'لم تتم المطالبة بالمكافأة.', 'info');
      }
      await refresh();
    } catch (e: any) {
      showToast(e?.message || 'تعذر تنفيذ المطالبة.', 'error');
    } finally {
      setClaiming(false);
    }
  };

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const claimedToday = summary?.lastClaimDate === today;
  const enabled = Boolean(summary?.miningEnabled && summary?.dailyCapConfigured);
  const eligible = Boolean(summary?.eligible);

  return (
    <section dir="rtl" aria-label="تعدين عملة YT Coin" className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 py-3">
      <div className="relative overflow-hidden rounded-2xl border border-amber-200/80 dark:border-amber-900/60 bg-gradient-to-l from-amber-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/40 p-4 sm:p-5 shadow-sm">
        <div className="absolute -left-8 -top-10 h-32 w-32 rounded-full bg-amber-300/15 blur-2xl pointer-events-none" />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                <Coins className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white">تعدين YT Coin</h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">اجمع عملات التطبيق يومياً دون التأثير على محفظة الريال اليمني</p>
              </div>
            </div>
            <button type="button" onClick={refresh} disabled={!user || loading} aria-label="تحديث بيانات التعدين" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-emerald-600 disabled:opacity-40">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {!user ? (
            <div className="rounded-xl bg-white/80 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">سجّل الدخول لمتابعة رصيد YT Coin وأهلية التعدين.</p>
              <button type="button" onClick={() => openAuthModal('login')} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">تسجيل الدخول</button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/85 dark:bg-slate-800/75 border border-amber-100 dark:border-slate-700 p-3">
                  <span className="text-[10px] text-slate-500">رصيدك الحالي</span>
                  <strong className="block mt-1 text-lg font-extrabold font-mono text-amber-700 dark:text-amber-300">{toCoin(summary?.balanceUnits)} <small className="text-xs">YT</small></strong>
                </div>
                <div className="rounded-xl bg-white/85 dark:bg-slate-800/75 border border-slate-200 dark:border-slate-700 p-3">
                  <span className="text-[10px] text-slate-500">مكافأة اليوم التالية</span>
                  <strong className="block mt-1 text-lg font-extrabold font-mono text-emerald-700 dark:text-emerald-300">{toCoin(summary?.nextRewardUnits)} <small className="text-xs">YT</small></strong>
                </div>
                <div className="rounded-xl bg-white/85 dark:bg-slate-800/75 border border-slate-200 dark:border-slate-700 p-3">
                  <span className="text-[10px] text-slate-500">أيام الاستمرار</span>
                  <strong className="flex items-center gap-1 mt-1 text-lg font-extrabold font-mono text-slate-800 dark:text-white"><Flame className="w-4 h-4 text-orange-500" />{summary?.streakDay || 0}</strong>
                </div>
                <div className="rounded-xl bg-white/85 dark:bg-slate-800/75 border border-slate-200 dark:border-slate-700 p-3">
                  <span className="text-[10px] text-slate-500">إجمالي المكتسب</span>
                  <strong className="block mt-1 text-lg font-extrabold font-mono text-slate-800 dark:text-white">{toCoin(summary?.lifetimeEarnedUnits)} <small className="text-xs">YT</small></strong>
                </div>
              </div>
              {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  {enabled ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <LockKeyhole className="w-4 h-4 text-amber-600" />}
                  <span>{!enabled ? 'التعدين غير مفعّل حالياً.' : !eligible ? (summary?.eligibilityMessage || 'يلزم حساب نشط ومهمة واحدة معتمدة على الأقل.') : claimedToday ? 'استلمت مكافأة اليوم؛ عد غداً للمطالبة التالية.' : 'أنت مؤهل؛ المطالبة مرة واحدة يومياً بتوقيت اليمن.'}</span>
                </div>
                <button type="button" onClick={claim} disabled={!enabled || !eligible || claimedToday || claiming || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 px-5 py-3 text-xs font-extrabold text-white shadow-sm transition-colors">
                  <Pickaxe className="w-4 h-4" />{claiming ? 'جارٍ تسجيل المطالبة...' : claimedToday ? 'تم التعدين اليوم' : 'استلام مكافأة التعدين'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">المكافأة تبدأ من 0.50 YT وتزداد 0.01 YT لكل يوم متتالٍ حتى 1.50 YT. تفويت يوم يعيدها إلى 0.50 YT. سقف المنصة اليومي 10,000 YT.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
