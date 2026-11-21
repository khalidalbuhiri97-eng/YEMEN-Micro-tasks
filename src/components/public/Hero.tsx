import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Zap,
  Sparkles,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { HomeAdWindow } from '../ads/HomeAdWindow.tsx';
import { SandboxedAdSlot } from '../ads/SandboxedAdSlot.tsx';
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
    <section className="relative overflow-hidden bg-slate-50 dark:bg-slate-950 py-5 lg:py-9 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center">
          {/* Main headline */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 dark:text-white leading-[1.3] tracking-tight mb-3 [text-wrap:balance]">
              أنجز مهاماً رقمية بسيطة، واكسب بالريال اليمني وسدد احتياجاتك اليومية.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed mb-5 max-w-2xl">
              سوق عمل مصغر موجه للشباب في صنعاء، عدن، تعز وجميع المحافظات اليمنية. اربح مكافآت نقدية فعلية عند إنجاز المهام المعتمدة مع سحب مباشر عبر الكريمي وشبكة النجم ومحفظة جوالي.
            </p>

            {/* Keep task and offer navigation; remove the oversized signup CTA */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 mb-5">
              <button
                type="button"
                onClick={onExploreTasks}
                className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm hover:shadow-md transition-all shrink-0 cursor-pointer"
              >
                تصفح المهام المتاحة
              </button>

              <button
                type="button"
                onClick={onGoToOfferWall || onStartEarning}
                title="فتح حائط عروض ClixWall اليومية"
                className="px-4 py-3 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-sm rounded-xl border border-amber-500/40 shadow-sm transition-all flex items-center gap-2 shrink-0 cursor-pointer group"
              >
                <ClixWallIcon size={19} />
                <span>عروض ClixWall</span>
                <span className="text-xs text-amber-400 font-mono font-extrabold">USD</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-[11px] sm:text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                بدون عمولات خفية
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                سحب يبدأ من <strong className="font-mono text-slate-900 dark:text-white">{stats.minWithdrawal.toLocaleString()} ر.ي</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                عروض دولية مع ClixWall
              </span>
            </div>
          </div>

          {/* Swipeable offer and ad cards */}
          <div className="lg:col-span-6">
            <div className="flex items-center justify-between mb-2 lg:hidden text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              <span>اسحب أفقياً لاستعراض العروض والإعلانات</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">◀ تصفح ▶</span>
            </div>

            <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible no-scrollbar items-stretch">
              <div className="snap-center shrink-0 w-[86vw] max-w-[340px] sm:w-[320px] lg:w-auto flex">
                <ClixWallHomeCard
                  onOpenOfferWall={onGoToOfferWall || onStartEarning}
                  className="w-full min-h-[300px]"
                />
              </div>

              <div className="snap-center shrink-0 w-[86vw] max-w-[340px] sm:w-[320px] lg:w-auto flex justify-center">
                <HomeAdWindow className="w-full min-h-[300px]" />
              </div>

              <div className="snap-center shrink-0 w-[82vw] max-w-[320px] sm:w-[300px] lg:hidden flex">
                <div className="w-full min-h-[300px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-white p-5 flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex items-center gap-2 text-amber-400 text-xs font-bold mb-2">
                      <Layers className="w-4 h-4 shrink-0" />
                      <span>بوابة العروض والمهام المتجددة</span>
                    </div>
                    <h3 className="text-base font-extrabold mb-2">
                      شركات عروض ومهام محلية جديدة قريباً
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      استمر بإنجاز المهام المباشرة وشبكة ClixWall يومياً بينما نضيف المزيد من شركاء العروض المعتمدين.
                    </p>
                    <div className="mt-4">
                      <SandboxedAdSlot
                        placementKey="home_upcoming_offers"
                        compact
                        emptyPlaceholderText="مساحة إعلانية متاحة للإدارة"
                        className="!bg-slate-800 !border-slate-700"
                      />
                    </div>
                  </div>
                  <div className="space-y-2.5 pt-4 border-t border-slate-800">
                    <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>أرباح موثقة بالريال اليمني</span>
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

        <div className="mt-7 pt-5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-right">
            <div className="text-xl lg:text-2xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">{stats.activeTasksCount}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">المهام المتاحة حالياً</div>
          </div>
          <div className="text-right">
            <div className="text-xl lg:text-2xl font-extrabold text-amber-600 dark:text-amber-400 font-mono tabular-nums">{stats.totalWithdrawnYer.toLocaleString()} ر.ي</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">إجمالي المبالغ المسحوبة فعلياً</div>
          </div>
          <div className="text-right">
            <div className="text-xl lg:text-2xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">{stats.minWithdrawal.toLocaleString()} ر.ي</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">الحد الأدنى للسحب</div>
          </div>
          <div className="text-right">
            <div className="text-xl lg:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">{stats.totalCompletedTasks}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">مهام معتمدة ومكتملة</div>
          </div>
        </div>
      </div>
    </section>
  );
};
