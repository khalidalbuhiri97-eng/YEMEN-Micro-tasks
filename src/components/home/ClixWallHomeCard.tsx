import React from 'react';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { Layers, Sparkles } from 'lucide-react';

interface ClixWallHomeCardProps {
  onOpenOfferWall: (provider: 'clixwall' | 'offerwall-gg' | 'hub') => void;
  className?: string;
}

export const ClixWallHomeCard: React.FC<ClixWallHomeCardProps> = ({
  onOpenOfferWall,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-white dark:bg-slate-900 gold-gradient-border p-5 flex flex-col gap-4 transition-all hover:shadow-md ${className}`}
    >
      {/* Integrated Wide Banner Header */}
      <button
        type="button"
        onClick={() => onOpenOfferWall('hub')}
        className="w-full p-4 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 dark:from-slate-800 dark:to-slate-900 text-white rounded-2xl border border-amber-500/40 shadow-sm hover:shadow transition-all flex items-center justify-between gap-3 cursor-pointer group text-right"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 group-hover:scale-105 transition-transform">
            <ClixWallIcon size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-sm sm:text-base">بوابة العروض الخارجية</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-black">ClixWall & Offerwall</span>
            </div>
            <span className="text-[11px] text-slate-300 block font-normal truncate">أرباح فورية دولية بالعملة الصعبة والريال اليمني</span>
          </div>
        </div>
        <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
      </button>

      {/* Section Title */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            اختر مزود العروض للمتابعة
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            حوائط عروض معتمدة ومكافآت فورية
          </p>
        </div>
      </div>

      {/* Two side-by-side equal square cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Card 1: ClixWall */}
        <button
          type="button"
          onClick={() => onOpenOfferWall('clixwall')}
          className="group aspect-square rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-900 p-3.5 text-center shadow-sm hover:shadow-md hover:border-emerald-500 transition-all flex flex-col items-center justify-center gap-2.5 cursor-pointer"
        >
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
            <ClixWallIcon size={32} />
          </div>
          <div>
            <strong className="block text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
              ClixWall
            </strong>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">
              حائط USD
            </span>
          </div>
        </button>

        {/* Card 2: Offerwall.gg */}
        <button
          type="button"
          onClick={() => onOpenOfferWall('offerwall-gg')}
          className="group aspect-square rounded-2xl border border-cyan-200 dark:border-cyan-900/60 bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-cyan-950/40 dark:via-slate-900 dark:to-slate-900 p-3.5 text-center shadow-sm hover:shadow-md hover:border-cyan-500 transition-all flex flex-col items-center justify-center gap-2.5 cursor-pointer"
        >
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-cyan-100 dark:border-cyan-900 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform text-cyan-600">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <strong className="block text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
              Offerwall.GG
            </strong>
            <span className="text-[10px] text-cyan-700 dark:text-cyan-400 font-bold">
              حائط YER
            </span>
          </div>
        </button>
      </div>
    </div>
  );
};
