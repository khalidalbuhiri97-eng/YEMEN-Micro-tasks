import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { OverviewView } from './OverviewView.tsx';
import { TasksView } from './TasksView.tsx';
import { MySubmissionsView } from './MySubmissionsView.tsx';
import { WalletView } from './WalletView.tsx';
import { WithdrawView } from './WithdrawView.tsx';
import { ReferralView } from './ReferralView.tsx';
import { SupportView } from './SupportView.tsx';
import {
  LayoutDashboard,
  CheckSquare,
  FileCheck,
  Wallet,
  Banknote,
  Users,
  HelpCircle,
} from 'lucide-react';

interface DashboardLayoutProps {
  initialSubTab?: string;
  onNavigateHome: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  initialSubTab = 'overview',
  onNavigateHome,
}) => {
  const { user, wallet, openAuthModal } = useAuth();
  const [subTab, setSubTab] = useState(initialSubTab);

  const menuItems = [
    { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
    { id: 'tasks', label: 'المهام المتاحة', icon: CheckSquare },
    { id: 'submissions', label: 'إثباتاتي المرفوعة', icon: FileCheck },
    { id: 'wallet', label: 'المحفظة وسجل الحركات', icon: Wallet },
    { id: 'withdraw', label: 'سحب الأرباح نقداً', icon: Banknote },
    { id: 'referrals', label: 'دعوة الأصدقاء والإحالة', icon: Users },
    { id: 'support', label: 'مركز الدعم والمساعدة', icon: HelpCircle },
  ];

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center">
        <div className="p-8 sm:p-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm">
            <LayoutDashboard className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            لوحة تحكم المستخدم
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            يجب تسجيل الدخول أو إنشاء حساب للوصول إلى لوحة التحكم الخاصة بك ومتابعة إنجاز المهام وسحب الأرباح.
          </p>
          <div className="pt-2 flex flex-col gap-2.5">
            <button
              onClick={() => openAuthModal('login')}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
            >
              تسجيل الدخول / إنشاء حساب
            </button>
            <button
              onClick={onNavigateHome}
              className="w-full py-2.5 px-4 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"
            >
              العودة للصفحة الرئيسية
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Desktop Sidebar (240px - 280px equivalent) */}
        <aside className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-6 shrink-0">
          {/* User mini profile card */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0">
                {user.fullName ? user.fullName.slice(0, 1) : 'م'}
              </div>
              <div className="overflow-hidden">
                <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                  {user?.fullName}
                </div>
                <div className="text-[11px] font-mono text-slate-400 truncate">
                  {user?.phone} · {user?.city}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">الرصيد:</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {wallet?.availableBalance.toLocaleString() || '0'} ر.ي
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = subTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSubTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-right ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="lg:col-span-9 min-h-[500px]">
          {subTab === 'overview' && (
            <OverviewView onNavigateTab={(tab) => setSubTab(tab)} />
          )}
          {subTab === 'tasks' && (
            <TasksView
              onGoToSubmissions={() => setSubTab('submissions')}
              onGoToWallet={() => setSubTab('wallet')}
            />
          )}
          {subTab === 'submissions' && (
            <MySubmissionsView onBrowseTasks={() => setSubTab('tasks')} />
          )}
          {subTab === 'wallet' && (
            <WalletView
              onGoToWithdraw={() => setSubTab('withdraw')}
              onGoToTasks={() => setSubTab('tasks')}
            />
          )}
          {subTab === 'withdraw' && (
            <WithdrawView onGoToWallet={() => setSubTab('wallet')} />
          )}
          {subTab === 'referrals' && <ReferralView />}
          {subTab === 'support' && <SupportView />}
        </main>
      </div>
    </div>
  );
};
