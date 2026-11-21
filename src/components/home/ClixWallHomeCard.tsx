import React from 'react';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { ExternalLink, Sparkles, DollarSign, CheckCircle2 } from 'lucide-react';
import { SandboxedAdSlot } from '../ads/SandboxedAdSlot.tsx';

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
      className={`rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-white dark:bg-slate-900 shadow-sm p-5 flex flex-col justify-between transition-all hover:shadow-md hover:border-emerald-400/70 relative overflow-hidden ${className}`}
    >
      <div>
        {/* Header with ClixWall Icon */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shrink-0">
              <ClixWallIcon size={30} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white truncate">
                  بوابة حوائط العروض
                </h3>
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  · حائط العروض
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                ClixWall وشركاء عروض إضافيون
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-600 dark:text-amber-400 font-mono shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
            <span>USD</span>
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          اختر ClixWall أو حائط عروض آخر من صفحة واحدة. يمكن للإدارة إضافة شركاء جدد دون تغيير حائط ClixWall الحالي.
        </p>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-semibold bg-amber-50/70 dark:bg-amber-950/30 p-2 rounded-xl border border-amber-200/70 dark:border-amber-800/50">
            <DollarSign className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-mono tabular-nums">1 USD = 1,600 ر.ي</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-semibold bg-emerald-50/70 dark:bg-emerald-950/30 p-2 rounded-xl border border-emerald-200/70 dark:border-emerald-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>إيداع تلقائي فوري</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Action Button */}
        <button
          type="button"
          onClick={onOpenOfferWall}
          className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 group cursor-pointer"
        >
          <ClixWallIcon size={18} />
          <span>استكشاف حوائط العروض</span>
          <ExternalLink className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
        </button>

        {/* Technically Isolated Advertiser Partner Area embedded cleanly inside card */}
        <SandboxedAdSlot
          placementKey="clixwall_card_embed"
          compact
          emptyPlaceholderText="مساحة إعلانية معزولة مخصصة لشركاء المنصة"
        />
      </div>
    </div>
  );
};
