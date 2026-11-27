import React from 'react';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { Layers, Sparkles, ArrowLeft, Gift, BadgeCheck } from 'lucide-react';

interface ClixWallHomeCardProps {
  onOpenOfferWall: (provider: 'clixwall' | 'offerwall-gg' | 'hub') => void;
  className?: string;
}

export const ClixWallHomeCard: React.FC<ClixWallHomeCardProps> = ({ onOpenOfferWall, className = '' }) => (
  <section className={'relative overflow-hidden rounded-3xl border border-amber-300/50 dark:border-amber-500/20 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-lg shadow-amber-900/5 transition-all ' + className}>
    <button type="button" onClick={() => onOpenOfferWall('hub')} aria-label="ادخل الآن إلى نافذة العروض واربح" className="group relative w-full overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-l from-[#102b27] via-[#123b32] to-[#172b36] p-4 sm:p-5 text-right text-white shadow-md transition-all hover:shadow-xl active:scale-[0.99]">
      <div className="pointer-events-none absolute -left-8 -top-10 h-36 w-36 rounded-full bg-amber-400/10 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/15 text-amber-300 shadow-inner"><Gift className="h-7 w-7" /></span>
          <span className="min-w-0">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-amber-200"><Sparkles className="h-3.5 w-3.5" /> فرص ومكافآت إضافية</span>
            <strong className="block text-base font-black leading-6 sm:text-lg">ادخل الآن نافذة العروض واربح!</strong>
            <span className="mt-1 block text-[11px] leading-5 text-slate-200">اكتشف عروضاً جديدة واجمع مكافآتك عند إكمالها.</span>
          </span>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow-lg transition-transform group-hover:-translate-x-1"><ArrowLeft className="h-5 w-5" /></span>
      </div>
      <span className="relative mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-amber-300 to-yellow-400 px-4 py-2.5 text-sm font-black text-slate-950 shadow-md transition-all group-hover:brightness-105"><Gift className="h-4 w-4" /> ادخل واكتشف العروض</span>
    </button>
    <div className="mt-4 flex items-center justify-between gap-2 px-1">
      <div><h3 className="text-sm font-extrabold text-slate-900 dark:text-white">اختر نافذة العروض</h3><p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">اختر المنصة المناسبة وابدأ بجمع المكافآت</p></div>
      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><BadgeCheck className="h-3.5 w-3.5" /> منصات متاحة</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <button type="button" onClick={() => onOpenOfferWall('clixwall')} className="group flex min-h-[126px] flex-col items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md active:scale-[0.98] dark:border-emerald-900/60 dark:from-emerald-950/40 dark:to-slate-900">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-white shadow-sm transition-transform group-hover:scale-105 dark:border-emerald-900 dark:bg-slate-800"><ClixWallIcon size={30} /></span>
        <strong className="text-xs font-black text-slate-900 dark:text-white">ClixWall</strong><span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">نافذة العروض بالدولار</span><span className="mt-0.5 flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">ادخل الآن <ArrowLeft className="h-3 w-3" /></span>
      </button>
      <button type="button" onClick={() => onOpenOfferWall('offerwall-gg')} className="group flex min-h-[126px] flex-col items-center justify-center gap-2 rounded-2xl border border-cyan-200 bg-gradient-to-b from-cyan-50 to-white p-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-md active:scale-[0.98] dark:border-cyan-900/60 dark:from-cyan-950/40 dark:to-slate-900">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-100 bg-white text-cyan-600 shadow-sm transition-transform group-hover:scale-105 dark:border-cyan-900 dark:bg-slate-800 dark:text-cyan-300"><Layers className="h-7 w-7" /></span>
        <strong className="text-xs font-black text-slate-900 dark:text-white">Offerwall.GG</strong><span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-400">نافذة عروض ومكافآت</span><span className="mt-0.5 flex items-center gap-1 text-[10px] font-extrabold text-cyan-700 dark:text-cyan-300">ادخل الآن <ArrowLeft className="h-3 w-3" /></span>
      </button>
    </div>
  </section>
);
