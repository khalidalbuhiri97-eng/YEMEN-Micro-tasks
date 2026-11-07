import React, { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { api } from '../../api/client.ts';

interface HeroProps {
  onStartEarning: () => void;
  onExploreTasks: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onStartEarning, onExploreTasks }) => {
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          {/* Right Column: Copy & Actions (RTL first) */}
          <div className="lg:col-span-7 flex flex-col justify-center">
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
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-8 max-w-2xl">
              سوق عمل مصغر موجه للشباب في صنعاء، عدن، تعز وجميع المحافظات اليمنية. اربح مكافآت نقدية فعلية عند إنجاز المهام المعتمدة مع سحب مباشر عبر الكريمي وشبكة النجم ومحفظة جوالي.
            </p>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-4 mb-10">
              <button
                type="button"
                onClick={onStartEarning}
                className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 shrink-0"
              >
                <span>ابدأ الكسب وسجل حسابك</span>
                <ArrowLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onExploreTasks}
                className="px-6 py-3.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold text-sm rounded-xl border border-slate-300 dark:border-slate-700 transition-colors shrink-0"
              >
                تصفح المهام المتاحة
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
                دفتر أستاذ مالي مدقق بالكامل
              </span>
            </div>
          </div>

          {/* Left Column: Visual Banner */}
          <div className="lg:col-span-5 relative flex items-center">
            <div className="relative w-full h-full min-h-[340px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl bg-slate-900">
              <img
                src="/src/assets/images/hero_yemen_earning_1793978996548.jpg"
                alt="شباب يمنيون يعملون على منصة كسب اليمن"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent"></div>

              <div className="absolute bottom-4 right-4 left-4 p-4 rounded-xl bg-slate-900/85 backdrop-blur-md border border-white/10 text-white">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    تحويل مباشر معتمد
                  </span>
                  <span className="font-mono tabular-nums text-slate-300">صنعاء / عدن</span>
                </div>
                <p className="text-xs text-slate-200">
                  معاملات مالية حقيقية وتوثيق فوري لجميع حركات الصرف عبر شبكات الصرافة اليمنية.
                </p>
              </div>
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
