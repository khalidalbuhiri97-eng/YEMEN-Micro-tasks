import React from 'react';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { ExternalLink, Sparkles, DollarSign, CheckCircle2 } from 'lucide-react';

interface ClixWallHomeCardProps {
  onOpenOfferWall: () => void;
  className?: string;
}

export const ClixWallHomeCard: React.FC<ClixWallHomeCardProps> = ({
  onOpenOfferWall,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl border border-blue-200/80 dark:border-blue-900/40 bg-gradient-to-br from-blue-50/90 via-indigo-50/70 to-cyan-50/80 dark:from-slate-900 dark:via-blue-950/40 dark:to-slate-900 shadow-md p-5 flex flex-col justify-between transition-all hover:shadow-lg relative overflow-hidden ${className}`}
    >
      {/* Decorative background glow */}
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/10 dark:bg-blue-400/10 rounded-full blur-2xl pointer-events-none" />

      <div>
        {/* Header with ClixWall Icon */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-1 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700/80">
              <ClixWallIcon size={32} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  عروض ClixWall
                </h3>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-600 text-white shadow-xs">
                  Offer Wall
                </span>
              </div>
              <p className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">
                مكافآت يومية إضافية بالدولار
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
            <Sparkles className="w-3 h-3" />
            <span>USD</span>
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          اربح مكافآت فورية بالدولار عبر إنجاز استطلاعات الرأي والعروض العالمية، مع إيداع مباشر في محفظتك بالريال اليمني.
        </p>

        {/* Feature Badges */}
        <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-medium bg-white/70 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
            <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>1 USD = 1,600 ر.ي</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-medium bg-white/70 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>إيداع تلقائي فوري</span>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <button
        type="button"
        onClick={onOpenOfferWall}
        className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-700 hover:via-indigo-700 hover:to-cyan-700 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 group cursor-pointer"
      >
        <ClixWallIcon size={18} className="brightness-125" />
        <span>فتح حائط عروض ClixWall الآن</span>
        <ExternalLink className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
      </button>
    </div>
  );
};
