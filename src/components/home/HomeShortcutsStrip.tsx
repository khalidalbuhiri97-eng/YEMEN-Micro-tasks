import React from 'react';
import {
  CheckSquare,
  Wallet,
  Sparkles,
  LayoutDashboard,
  HelpCircle,
  Shield,
  Megaphone,
  Store,
  Gift,
  CircleDollarSign,
  Clock3,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { formatYer } from '../../../shared/money.ts';

interface HomeShortcutsStripProps {
  onNavigate: (tab: string) => void;
}

export const HomeShortcutsStrip: React.FC<HomeShortcutsStripProps> = ({ onNavigate }) => {
  const { user, wallet, isAdmin } = useAuth();

  const shortcuts = [
    {
      id: 'tasks',
      label: 'المهام',
      targetTab: 'tasks',
      icon: CheckSquare,
      accent: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/60',
    },
    {
      id: 'offerwall',
      label: 'عروض ClixWall',
      targetTab: 'offerwall',
      icon: Sparkles,
      accent: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/50',
    },
    {
      id: 'wallet',
      label: 'المحفظة',
      targetTab: 'wallet',
      icon: Wallet,
      accent: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/50',
    },
    {
      id: 'dashboard',
      label: 'حسابي',
      targetTab: 'dashboard',
      icon: LayoutDashboard,
      accent: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/50',
    },
    {
      id: 'how_it_works',
      label: 'الدعم والدفع',
      targetTab: 'how_it_works',
      icon: HelpCircle,
      accent: 'text-cyan-700 bg-cyan-50 dark:text-cyan-300 dark:bg-cyan-950/50',
    },
    {
      id: 'store',
      label: 'سوق Yemen Task',
      targetTab: '',
      icon: Store,
      accent: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/50',
      comingSoon: true,
    },
    {
      id: 'rewards',
      label: 'المكافآت',
      targetTab: '',
      icon: Gift,
      accent: 'text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-950/50',
      comingSoon: true,
    },
    ...(user?.role === 'advertiser'
      ? [{
          id: 'advertiser',
          label: 'حملاتي',
          targetTab: 'advertiser',
          icon: Megaphone,
          accent: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/50',
        }]
      : []),
    ...(isAdmin
      ? [{
          id: 'admin',
          label: 'الإدارة',
          targetTab: 'admin',
          icon: Shield,
          accent: 'text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800',
        }]
      : []),
  ];

  const money = (value?: number) => (typeof value === 'number' ? formatYer(value) : '—');

  return (
    <section
      aria-label="ملخص الحساب والاختصارات"
      className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="min-w-0 rounded-xl border border-emerald-100 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-2 py-2 text-right"
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              <CircleDollarSign className="w-3 h-3 shrink-0" /> الرصيد المتاح
            </span>
            <strong className="block mt-1 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate">
              {user ? money(wallet?.availableBalance) : 'سجّل الدخول'}
            </strong>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="min-w-0 rounded-xl border border-amber-100 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-2 py-2 text-right"
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <Sparkles className="w-3 h-3 shrink-0" /> إجمالي الأرباح
            </span>
            <strong className="block mt-1 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate">
              {user ? money(wallet?.totalEarned) : '—'}
            </strong>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="min-w-0 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 px-2 py-2 text-right"
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
              <Clock3 className="w-3 h-3 shrink-0" /> قيد المراجعة
            </span>
            <strong className="block mt-1 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate">
              {user ? money(wallet?.pendingBalance) : '—'}
            </strong>
          </button>
        </div>

        <div className="relative">
          <div
            dir="rtl"
            className="flex flex-row gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-3 pt-1 px-0.5 [scrollbar-width:thin] [scrollbar-color:#a7f3d0_transparent]"
            aria-label="بطاقات الخدمات والتنقل - مرر جانبياً"
          >
            {shortcuts.map((item) => {
              const Icon = item.icon;
              const disabled = Boolean((item as any).comingSoon);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => item.targetTab && onNavigate(item.targetTab)}
                  aria-label={disabled ? item.label + ' - قريباً' : item.label}
                  className={`group relative flex h-[132px] w-[112px] min-w-[112px] shrink-0 snap-start flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 px-2 py-3 text-center shadow-sm transition-all duration-200 ${disabled ? 'opacity-75 cursor-default' : 'cursor-pointer hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md active:scale-[0.98]'} before:absolute before:inset-x-5 before:top-0 before:h-1 before:rounded-b-full before:bg-emerald-400/70`}
                >
                  <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-transform duration-200 ${item.accent} ${disabled ? '' : 'group-hover:scale-105'}`}>
                    <Icon className="h-7 w-7" strokeWidth={2.1} />
                  </span>
                  <span className="w-full text-[11px] font-extrabold leading-4 text-slate-800 dark:text-slate-100 line-clamp-2">
                    {item.label}
                  </span>
                  {disabled ? (
                    <span className="absolute bottom-1.5 rounded-full bg-slate-200/80 dark:bg-slate-700 px-2 py-0.5 text-[9px] font-semibold text-slate-500 dark:text-slate-300">قريباً</span>
                  ) : (
                    <span className="absolute bottom-1.5 h-1 w-5 rounded-full bg-emerald-400/70 opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">اسحب جانبياً لاستعراض جميع الخدمات <span aria-hidden="true">←</span></p>
        </div>
      </div>
    </section>
  );
};
