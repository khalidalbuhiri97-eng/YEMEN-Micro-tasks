import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { formatYer, toYerDecimal } from '../../../shared/money.ts';
import {
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  DollarSign,
  Coins,
  LogIn,
  Wallet,
  RotateCcw,
} from 'lucide-react';

interface ClixWallReward {
  id: string;
  transaction_id: string;
  offer_id?: string | null;
  offer_name?: string;
  user_payout_usd: number;
  reward_usd?: number;
  publisher_payout_usd?: number;
  exchange_rate: number;
  reward_yer: number;
  status: string;
  created_at: string;
}

interface ClixWallSummary {
  totalUsdEarned: number;
  totalYerCredited: number;
  offersCount: number;
  reversedCount?: number;
  walletBalanceYer?: number;
}

export const OfferWallView: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const [activeTab, setActiveTab] = useState<'wall' | 'history'>('wall');
  const [offerWallUrl, setOfferWallUrl] = useState<string>('');
  const [rewards, setRewards] = useState<ClixWallReward[]>([]);
  const [summary, setSummary] = useState<ClixWallSummary>({
    totalUsdEarned: 0,
    totalYerCredited: 0,
    offersCount: 0,
    reversedCount: 0,
    walletBalanceYer: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOfferWallData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [urlRes, rewardsRes] = await Promise.allSettled([
        api.getClixWallOfferWallUrl(),
        api.getClixWallRewards(),
      ]);

      if (urlRes.status === 'fulfilled' && urlRes.value?.offerWallUrl) {
        setOfferWallUrl(urlRes.value.offerWallUrl);
      } else {
        const failureReason =
          urlRes.status === 'rejected'
            ? urlRes.reason?.message || 'فشل الاتصال بخدمة ClixWall'
            : 'لم يرجع الخادم رابط حائط العروض.';
        setError(failureReason);
      }

      if (rewardsRes.status === 'fulfilled' && rewardsRes.value) {
        setRewards(rewardsRes.value.rewards || []);
        setSummary(
          rewardsRes.value.summary || {
            totalUsdEarned: 0,
            totalYerCredited: 0,
            offersCount: 0,
            reversedCount: 0,
            walletBalanceYer: 0,
          }
        );
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء تحميل بيانات حائط العروض.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchOfferWallData();
  }, [fetchOfferWallData]);

  const fmtYer = (n: number | undefined | null) => formatYer(n ?? 0);
  const fmtUsd = (n: number | undefined | null) => {
    const fixed = toYerDecimal(n ?? 0).toDecimalPlaces(8).toFixed(8);
    const trimmed = fixed.replace(/\.?0+$/, '');
    return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
  };

  if (!user) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center space-y-4" dir="rtl">
        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-950/50 rounded-2xl flex items-center justify-center mx-auto border border-blue-100 dark:border-blue-900">
          <ClixWallIcon size={40} />
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white">تسجيل الدخول مطلوب</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
          يجب تسجيل الدخول لعرض حائط عروض ClixWall المخصص لك وربط مكافآتك بحسابك مباشرة.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
        >
          <LogIn className="w-4 h-4" />
          <span>تسجيل الدخول الآن</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute left-4 bottom-2 opacity-15 pointer-events-none">
          <ClixWallIcon size={130} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-white/20 p-2 rounded-xl backdrop-blur-md shadow-inner">
              <ClixWallIcon size={32} />
            </span>
            <h1 className="text-2xl font-bold">عروض كسب الإضافية (ClixWall Offer Wall)</h1>
          </div>
          <p className="text-emerald-100 text-sm max-w-2xl leading-relaxed">
            أتمم المهام والعروض واستطلع العطاءات المتاحة لتحصل على مكافآت فورية بالدولار تُصرف وتُودع مباشرة في محفظتك بالريال اليمني بسعر صرف ثابت (1 دولار = 1,600 ر.ي).
          </p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">صافي الأرباح (USD)</p>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">${fmtUsd(summary.totalUsdEarned)}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-xl">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">صافي مكافآت ClixWall (YER)</p>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">{fmtYer(summary.totalYerCredited)} ر.ي</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">العروض المنجزة (الصافية)</p>
            <div className="flex items-center gap-2 mt-0.5">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">{summary.offersCount} عرض</h3>
              {(summary.reversedCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                  <RotateCcw className="w-3 h-3" />
                  {summary.reversedCount} مسترجع
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">رصيد المحفظة (دفتر الأستاذ)</p>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">
              {fmtYer(summary.walletBalanceYer ?? 0)} ر.ي
            </h3>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 gap-6">
        <button
          onClick={() => setActiveTab('wall')}
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'wall'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Layers className="w-4 h-4" />
          حائط العروض المباشر
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          سجل المكافآت والمعاملات ({rewards.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'wall' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span>اتصال آمن وموثق مع نظام ClixWall</span>
            </div>
            {offerWallUrl && (
              <a
                href={offerWallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
              >
                <span>فتح في نافذة مستقلة</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="w-full min-h-[600px] bg-slate-50 dark:bg-slate-900 relative">
            {loading ? (
              <div className="h-[600px] flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-slate-500">جاري تحميل حائط العروض...</p>
              </div>
            ) : error ? (
              <div className="h-[600px] flex flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertCircle className="w-10 h-10 text-rose-500" />
                <p className="text-sm text-rose-600 font-medium">{error}</p>
                <button
                  onClick={fetchOfferWallData}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium transition"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : offerWallUrl ? (
              <div className="w-full h-[600px] overflow-hidden">
                <iframe
                  src={offerWallUrl}
                  title="ClixWall offers"
                  width="100%"
                  height="600"
                  frameBorder="0"
                  allow="clipboard-write"
                  className="w-full h-[600px] border-0 block"
                />
              </div>
            ) : (
              <div className="h-[600px] flex flex-col items-center justify-center gap-3">
                <AlertCircle className="w-10 h-10 text-amber-500" />
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  لم نتمكن من العثور على رابط العروض، يرجى إعادة المحاولة.
                </p>
                <button
                  onClick={fetchOfferWallData}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium transition"
                >
                  تحديث
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-semibold text-slate-800 dark:text-white flex justify-between items-center">
            <span>سجل عروض ومكافآت ClixWall</span>
            <button
              onClick={fetchOfferWallData}
              className="p-2 text-slate-500 hover:text-emerald-600 transition rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              title="تحديث القائمة"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {rewards.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="flex justify-center opacity-60">
                <ClixWallIcon size={44} />
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">لا توجد مكافآت مسجلة حتى الآن.</p>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">ابدأ بإتمام العروض من حائط العروض لتظهر هنا فوراً.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3 px-4">رقم المعاملة (TID)</th>
                    <th className="py-3 px-4">اسم العرض</th>
                    <th className="py-3 px-4">المكافأة (USD)</th>
                    <th className="py-3 px-4">سعر الصرف</th>
                    <th className="py-3 px-4">المكافأة (YER)</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-sm text-slate-700 dark:text-slate-200">
                  {rewards.map((r) => {
                    const isCredited = r.status === 'credited' || r.status === 'completed';
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/25 transition">
                        <td className="py-3 px-4 font-mono text-xs text-slate-500">{r.transaction_id}</td>
                        <td className="py-3 px-4 font-medium">{r.offer_name || 'عرض ClixWall'}</td>
                        <td
                          className={`py-3 px-4 font-semibold ${
                            isCredited
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-500/80 dark:text-rose-400/80 line-through'
                          }`}
                        >
                          ${fmtUsd(r.user_payout_usd ?? r.reward_usd ?? 0)}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">{fmtYer(r.exchange_rate || 1600)}</td>
                        <td
                          className={`py-3 px-4 font-bold ${
                            isCredited
                              ? 'text-teal-600 dark:text-teal-400'
                              : 'text-rose-500/80 dark:text-rose-400/80 line-through'
                          }`}
                        >
                          {fmtYer(r.reward_yer)} ر.ي
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                              isCredited
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400'
                            }`}
                          >
                            {isCredited ? 'مكتمل ومودع' : 'مسترجع / معكوس (مستبعد)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500">{new Date(r.created_at).toLocaleString('ar-YE')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
