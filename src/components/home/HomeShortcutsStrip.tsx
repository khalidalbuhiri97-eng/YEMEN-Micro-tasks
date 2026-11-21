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
  Coins,
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
      id: 'yt_coin',
      label: 'YT Coin',
      targetTab: 'yt_coin',
      icon: Coins,
      accent: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/60',
      featured: true,
    },
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

        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'thin' }}>
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
                className={`group snap-start shrink-0 w-[42vw] sm:w-40 min-h-[116px] flex flex-col items-center justify-center gap-2 rounded-2xl border ${item.id === 'yt_coin' ? 'border-emerald-300 dark:border-emerald-700 bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950/70 dark:to-teal-950/60 shadow-sm' : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/50'} px-3 py-3 transition-all ${disabled ? 'opacity-75 cursor-default' : 'hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 cursor-pointer'}`}
              >
                <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${item.accent}`}>
                  <Icon className="w-6 h-6" />
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-200 text-center leading-tight line-clamp-2">
                  {item.label}
                </span>
                {disabled && <span className="text-[9px] text-slate-400">قريباً</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
