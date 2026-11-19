import React, { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Zap } from 'lucide-react';
import { api } from '../../api/client.ts';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { HomeAdWindow } from '../ads/HomeAdWindow.tsx';
import { ClixWallHomeCard } from '../home/ClixWallHomeCard.tsx';

interface HeroProps {
  onStartEarning: () => void;
  onExploreTasks: () => void;
  onGoToOfferWall?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onStartEarning, onExploreTasks, onGoToOfferWall }) => {
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
    api.getStats().then((res) => {
      if (res) {
        setStats({
          totalCompletedTasks: res.totalCompletedTasks || 0,
          totalWithdrawnYer: res.totalWithdrawnYer || 0,
          activeTasksCount: res.activeTasksCount || 0,
          minWithdrawal: res.minWithdrawal || 1000,
        });
      }
    }).catch((err) => {
      console.error('Error loading real stats', err);
    });
  }, []);

  return (
    <section className="relative overflow-hidden bg-slate-50 dark:bg-slate-950 py-12 lg:py-16 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Right Column: Copy & Actions (RTL first) */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            {/* Context line */}
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-3">
              <Zap className="w-4 h-4 shrink-0" />
              <span>منصة رقمية مستقلة للمهام المصغرة في اليمن</span>
            </div>

            {/* Headline with text-wrap: balance */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white leading-[1.2] tracking-tight mb-4 [text-wrap:balance]">
              أنجز مهاماً رقمية بسيطة، واكسب بالريال اليمني وسدد احتياجاتك اليومية.
            </h1>

            {/* Subheading */}
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-6 max-w-2xl">
              سوق عمل مصغر موجه للشباب في صنعاء، عدن، تعز وجميع المحافظات اليمنية. اربح مكافآت نقدية فعلية عند إنجاز المهام المعتمدة مع سحب مباشر عبر الكريمي وشبكة النجم ومحفظة جوالي.
            </p>

            {/* Actions: Main Buttons + ClixWall Button */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-8">
              <button
                type="button"
                onClick={onStartEarning}
                className="px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 shrink-0 cursor-pointer"
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

              {/* ClixWall Dedicated Action Button */}
              <button
                type="button"
                onClick={onGoToOfferWall || onStartEarning}
                title="فتح حائط عروض ClixWall اليومية"
                className="px-4 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 shrink-0 cursor-pointer group"
              >
                <ClixWallIcon size={20} className="brightness-125 transition-transform group-hover:scale-110" />
                <span>عروض ClixWall</span>
                <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full font-extrabold uppercase">
                  USD
                </span>
              </button>
            </div>

            {/* Features check row */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                بدون عمولات خفية
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                سحب يبدأ من {stats.minWithdrawal.toLocaleString()} ر.ي
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                عروض دولية فورية مع ClixWall
              </span>
            </div>
          </div>

          {/* Left Column: Visual Area (300x250 Ad Window + ClixWall Card Paired) */}
          <div className="lg:col-span-6 flex flex-col sm:flex-row lg:flex-row gap-4 items-center justify-center">
            {/* 1. The Ad Window (300x250) replacing the old image */}
            <div className="w-full sm:w-auto flex justify-center">
              <HomeAdWindow />
            </div>

            {/* 2. The ClixWall Card placed directly next to the ad window */}
            <div className="w-full sm:w-auto flex-1 max-w-[340px]">
              <ClixWallHomeCard
                onOpenOfferWall={onGoToOfferWall || onStartEarning}
                className="h-full min-h-[314px]"
              />
            </div>
          </div>
        </div>

        {/* 4-Column Real Live KPI Strip (Computed directly from real database records) */}
        <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
              {stats.activeTasksCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">المهام المتاحة حالياً</div>
          </div>

          <div className="text-right">
            <div className="text-2xl lg:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
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
            <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
              {stats.totalCompletedTasks}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">مهام معتمدة ومكتملة</div>
          </div>
        </div>
      </div>
    </section>
  );
};
