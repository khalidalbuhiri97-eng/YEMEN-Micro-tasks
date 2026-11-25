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
import { ClixWallHomeCard } from '../home/ClixWallHomeCard.tsx';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';

interface HeroProps {
  onStartEarning: () => void;
  onExploreTasks: () => void;
  onGoToOfferWall?: (provider?: 'clixwall' | 'offerwall-gg' | 'hub') => void;
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
    // Hydrate cached public stats immediately (Stale-While-Revalidate)
    getCacheItem<typeof stats>('public_stats')
      .then((cached) => {
        if (!cancelled && cached?.value) {
          setStats(cached.value);
        }
      })
      .catch(() => {});

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
      .catch(() => {});
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
            <h1 className="text-[19px] sm:text-2xl lg:text-3xl font-black text-slate-950 dark:text-white leading-[1.35] tracking-tight mb-4">
              <span className="block">
                حَوّل وقتك إلى{' '}
                <span className="bg-gradient-to-l from-emerald-600 via-teal-600 to-amber-500 dark:from-emerald-400 dark:via-teal-300 dark:to-amber-300 bg-clip-text text-transparent">
                  أرباح يومية فورية
                </span>
              </span>
              <span className="block mt-1 text-slate-800 dark:text-slate-100">
                بالريال اليمني وسحب مباشر
              </span>
            </h1>
          </div>

          {/* Swipeable offer and ad cards */}
          <div className="lg:col-span-6">
            <div className="w-full max-w-lg mx-auto">
              <ClixWallHomeCard
                onOpenOfferWall={(provider) => (onGoToOfferWall ? onGoToOfferWall(provider) : onStartEarning())}
                className="w-full min-h-[300px]"
              />
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
