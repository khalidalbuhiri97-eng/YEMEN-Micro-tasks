import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { Wallet, Moon, Sun, Shield, LogOut, User } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  isDark: boolean;
  onToggleDark: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onNavigate, isDark, onToggleDark }) => {
  const { user, wallet, isAdmin, logout, openAuthModal } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-8 h-16">
            {/* Zone 1: Brand Wordmark (Single text element) */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="flex items-center gap-2 group text-right"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
                  Y
                </div>
                <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 group-hover:text-emerald-600 transition-colors">
                  Yemen Micro-tasks
                </span>
              </button>
            </div>

            {/* Zone 2: Navigation Links */}
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
              <button
                onClick={() => onNavigate('home')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
                  currentTab === 'home' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                الرئيسية
              </button>
              <button
                onClick={() => onNavigate('tasks')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
                  currentTab === 'tasks' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                المهام المتاحة
              </button>
              <button
                onClick={() => onNavigate('wallet')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
                  currentTab === 'wallet' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                المحفظة والسحب
              </button>
              <button
                onClick={() => onNavigate('how_it_works')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
                  currentTab === 'how_it_works' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                طرق الدفع باليمن
              </button>
              {user && (
                <button
                  onClick={() => onNavigate('dashboard')}
                  className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
                    currentTab === 'dashboard' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                  }`}
                >
                  لوحة التحكم
                </button>
              )}
            </nav>

            {/* Zone 3: User Profile Icon Dropdown & Theme Toggle */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onToggleDark}
                title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {user ? (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                    title="حساب المستخدم"
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <span className="hidden sm:inline text-xs font-bold max-w-[100px] truncate">
                      {user.fullName}
                    </span>
                  </button>

                  {/* Profile Dropdown Menu & Backdrop */}
                  {isUserMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40 bg-transparent"
                        onClick={() => setIsUserMenuOpen(false)}
                      />
                      <div className="absolute left-0 mt-2 w-60 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 text-right">
                          <p className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                            {user.fullName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 mt-0.5" dir="ltr">
                            {user.phone}
                          </p>
                        </div>

                        <div className="py-1">
                          <button
                            type="button"
                            onClick={() => {
                              onNavigate('dashboard');
                              setIsUserMenuOpen(false);
                            }}
                            className="w-full text-right px-4 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold transition-colors"
                          >
                            لوحة التحكم الشخصية
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onNavigate('wallet');
                              setIsUserMenuOpen(false);
                            }}
                            className="w-full text-right px-4 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold transition-colors"
                          >
                            المحفظة وسجل الأرباح
                          </button>

                          {/* PRIVATE OWNER ADMINISTRATOR ONLY LINK */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                onNavigate('admin');
                                setIsUserMenuOpen(false);
                              }}
                              className="w-full text-right px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-1.5 transition-colors border-t border-slate-100 dark:border-slate-800"
                            >
                              <Shield className="w-3.5 h-3.5" />
                              <span>لوحة الإدارة الحصرية (مالك المنصة)</span>
                            </button>
                          )}
                        </div>

                        <div className="pt-2 mt-1 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              logout();
                              setIsUserMenuOpen(false);
                            }}
                            className="w-full text-right px-4 py-1.5 text-xs text-rose-600 font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5 transition-colors"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>تسجيل الخروج</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0"
                >
                  تسجيل الدخول / البدء
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
};
