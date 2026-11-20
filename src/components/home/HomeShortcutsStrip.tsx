import React from 'react';
import {
  CheckSquare,
  Wallet,
  Sparkles,
  LayoutDashboard,
  HelpCircle,
  Shield,
  Megaphone,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';

export interface QuickShortcutItem {
  id: string;
  label: string;
  targetTab: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  badgeText?: string;
}

interface HomeShortcutsStripProps {
  onNavigate: (tab: string) => void;
}

export const HomeShortcutsStrip: React.FC<HomeShortcutsStripProps> = ({ onNavigate }) => {
  const { user, isAdmin } = useAuth();

  const shortcuts: QuickShortcutItem[] = [
    {
      id: 'tasks',
      label: 'المهام المتاحة',
      targetTab: 'tasks',
      icon: CheckSquare,
      accentClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60',
    },
    {
      id: 'offerwall',
      label: 'عروض ClixWall',
      targetTab: 'offerwall',
      icon: Sparkles,
      accentClass: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50',
      badgeText: 'USD',
    },
    {
      id: 'wallet',
      label: 'المحفظة والسحب',
      targetTab: 'wallet',
      icon: Wallet,
      accentClass: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60',
    },
    {
      id: 'dashboard',
      label: user ? 'حسابي وإثباتاتي' : 'الدخول ولوحتي',
      targetTab: 'dashboard',
      icon: LayoutDashboard,
      accentClass: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800',
    },
    {
      id: 'how_it_works',
      label: 'طرق الدفع والدعم',
      targetTab: 'how_it_works',
      icon: HelpCircle,
      accentClass: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800',
    },
    ...(user?.role === 'advertiser'
      ? [
          {
            id: 'advertiser',
            label: 'بوابة المعلنين',
            targetTab: 'advertiser',
            icon: Megaphone,
            accentClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60',
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            id: 'admin',
            label: 'لوحة الإدارة',
            targetTab: 'admin',
            icon: Shield,
            accentClass: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50',
          },
        ]
      : []),
  ];

  return (
    <section
      aria-label="اختصارات الوصول السريع"
      className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-0.5">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.targetTab)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 hover:border-emerald-500/60 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 transition-all shrink-0 cursor-pointer"
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${item.accentClass}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                  {item.label}
                </span>
                {item.badgeText && (
                  <span className="text-[10px] font-mono font-extrabold text-amber-600 dark:text-amber-400">
                    · {item.badgeText}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
