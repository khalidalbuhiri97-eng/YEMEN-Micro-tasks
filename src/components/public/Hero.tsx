import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Zap,
  Sparkles,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { HomeAdWindow } from '../ads/HomeAdWindow.tsx';
import { ClixWallHomeCard } from '../home/ClixWallHomeCard.tsx';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';

interface HeroProps {
  onStartEarning: () => void;
  onExploreTasks: () => void;
  onGoToOfferWall?: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onStartEarning,
  onExploreTasks,
  onGoToOfferWall,
}) => {
  const [stats, setStats] = useState<{
    totalCompletedTasks: number;
    totalWithdrawnYer: number;
    activeTasksCount: number;
    minWithdrawal: number;
  }>({
    totalCompletedTasks: 0,
    totalWithdrawnYer: 0,
    activeTasksCount: 0,
    minWithdrawal: 1000,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .getStats()
      .then((res) => {
        if (!cancelled && res) {
          const next = {
            totalCompletedTasks: res.totalCompletedTasks || 0,
            totalWithdrawnYer: res.totalWithdrawnYer || 0,
            activeTasksCount: res.activeTasksCount || 0,
            minWithdrawal: res.minWithdrawal || 1000,
          };
          setStats(next);
          saveCacheItem('public_stats', next).catch(() => {});
        }
      })
      .catch(async () => {
        const cached = await getCacheItem<typeof stats>('public_stats');
        if (!cancelled && cached?.value) {
          setStats(cached.value);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="relative overflow-hidden bg-slate-50 dark:bg-slate-950 py-8 lg:py-14 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Right Column: Copy & Actions (RTL first) */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-3">
              <Zap className="w-4 h-4 shrink-0" />
              <span>Yemen Task · المنصة اليمنية الأولى للمهام المصغرة</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white leading-[1.2] tracking-tight mb-4 [text-wrap:balance]">
              أنجز مهاماً رقمية بسيطة، واكسب بالريال اليمني وسدد احتياجاتك اليومية.
            </h1>

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-6 max-w-2xl">
              سوق عمل مصغر موجه للشباب في صنعاء، عدن، تعز وجميع المحافظات اليمنية. اربح مكافآت نقدية فعلية عند إنجاز المهام المعتمدة مع سحب مباشر عبر الكريمي وشبكة النجم ومحفظة جوالي.
            </p>

            {/* Primary Actions */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-7">
              <button
                type="button"
                onClick={onStartEarning}
                className="px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <span>ابدأ الكسب وسجل حسابك</span>
                <ArrowLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onExploreTasks}
                className="px-5 py-3.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold text-sm rounded-xl border border-slate-300 dark:border-slate-700 transition-colors shrink-0 cursor-pointer"
              >
                تصفح المهام المتاحة
              </button>

              <button
                type="button"
                onClick={onGoToOfferWall || onStartEarning}
                title="فتح حائط عروض ClixWall اليومية"
                className="px-4 py-3 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-sm rounded-xl border border-amber-500/40 shadow-sm transition-all flex items-center gap-2 shrink-0 cursor-pointer group"
              >
                <ClixWallIcon size={20} />
                <span>عروض ClixWall</span>
                <span className="text-xs text-amber-400 font-mono font-extrabold">USD</span>
              </button>
            </div>

            {/* Highlights row */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                بدون عمولات خفية
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                سحب يبدأ من <strong className="font-mono text-slate-900 dark:text-white">{stats.minWithdrawal.toLocaleString()} ر.ي</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                عروض دولية فورية مع ClixWall
              </span>
            </div>
          </div>

          {/* Left Column: Mobile Horizontal Swipe Strip + Desktop Paired Showcase */}
          <div className="lg:col-span-6">
            <div className="flex items-center justify-between mb-2 lg:hidden text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>اسحب أفقياً لاستعراض العروض والإعلانات</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">◀ تصفح ▶</span>
            </div>

            <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible no-scrollbar items-stretch">
              {/* Slide 1: ClixWall OfferWall Card + Isolated Partner Embed */}
              <div className="snap-center shrink-0 w-[86vw] max-w-[340px] sm:w-[320px] lg:w-auto flex">
                <ClixWallHomeCard
                  onOpenOfferWall={onGoToOfferWall || onStartEarning}
                  className="w-full min-h-[320px]"
                />
              </div>

              {/* Slide 2: Isolated Ad Partner Window (admin configurable + 300x250 sandboxed fallback) */}
              <div className="snap-center shrink-0 w-[86vw] max-w-[340px] sm:w-[320px] lg:w-auto flex justify-center">
                <HomeAdWindow className="w-full min-h-[320px]" />
              </div>

              {/* Slide 3 (Mobile Swipe Card for future OfferWalls & Local Direct Tasks) */}
              <div className="snap-center shrink-0 w-[82vw] max-w-[320px] sm:w-[300px] lg:hidden flex">
                <div className="w-full min-h-[320px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-white p-5 flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex items-center gap-2 text-amber-400 text-xs font-bold mb-2">
                      <Layers className="w-4 h-4 shrink-0" />
                      <span>بوابة العروض والمهام المتجددة</span>
                    </div>
                    <h3 className="text-base font-extrabold mb-2">
                      شركات عروض ومهام محلية جديدة قريباً
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      استمر بإنجاز المهام المباشرة وشبكة ClixWall يومياً بينما نضيف المزيد من شركاء العروض المعتمدين بحماية مالية كاملة.
                    </p>
                  </div>
                  <div className="space-y-2.5 pt-4 border-t border-slate-800">
                    <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>أرباح موثقة بنظام الدفتر المالي بالريال اليمني</span>
                    </div>
                    <button
                      type="button"
                      onClick={onExploreTasks}
                      className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>استعراض المهام المتاحة الآن</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4-Column Real Live KPI Strip */}
        <div className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
              {stats.activeTasksCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">المهام المتاحة حالياً</div>
          </div>

          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-amber-600 dark:text-amber-400 font-mono tabular-nums">
              {stats.totalWithdrawnYer.toLocaleString()} ر.ي
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">إجمالي المبالغ المسحوبة فعلياً</div>
          </div>

          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
              {stats.minWithdrawal.toLocaleString()} ر.ي
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">الحد الأدنى للسحب</div>
          </div>

          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
              {stats.totalCompletedTasks}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">مهام معتمدة ومكتملة</div>
          </div>
        </div>
      </div>
    </section>
  );
};
