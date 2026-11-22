import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  Wallet,
  Moon,
  Sun,
  Shield,
  LogOut,
  User,
  Megaphone,
  Menu,
  X,
  Home,
  CheckSquare,
  HelpCircle,
  LayoutDashboard,
  Tv,
} from 'lucide-react';
import { ClixWallIcon } from '../common/ClixWallIcon.tsx';
import { AndroidApkDownloadButton } from '../pwa/PWAInstallButton.tsx';
import { NotificationBell } from '../notifications/NotificationBell.tsx';
import { formatYer } from '../../../shared/money.ts';

interface NavbarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  isDark: boolean;
  onToggleDark: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onNavigate, isDark, onToggleDark }) => {
  const { user, wallet, isAdmin, logout, openAuthModal } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navigateFromDrawer = (tab: string) => {
    onNavigate(tab);
    setIsSidebarOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-16">
            {/* Zone 1: Drawer Toggle + Official Brand Icon */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="فتح القائمة الجانبية"
                className="p-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="flex items-center gap-2.5 group text-right cursor-pointer"
              >
                <img
                  src="/brand-icon.png?v=3"
                  alt="Yemen Task"
                  className="w-9 h-9 rounded-xl object-contain border border-emerald-600/20 shadow-xs shrink-0 bg-emerald-950"
                />
                <span className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 group-hover:text-emerald-600 transition-colors">
                  Yemen Task
                </span>
              </button>
            </div>

            {/* Zone 2: Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-slate-600 dark:text-slate-300">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                  currentTab === 'home' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                الرئيسية
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                  currentTab === 'tasks' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                المهام المتاحة
              </button>
              <button
                type="button"
                onClick={() => onNavigate('wallet')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                  currentTab === 'wallet' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                المحفظة والسحب
              </button>
              <button
                type="button"
                onClick={() => onNavigate('earn_ads')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 flex items-center gap-1.5 cursor-pointer ${
                  currentTab === 'earn_ads' ? 'text-sky-600 dark:text-sky-400 font-bold border-b-2 border-sky-600' : ''
                }`}
              >
                <Tv className="w-3.5 h-3.5 text-sky-500" />
                <span>اكسب من الإعلانات</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('offerwall')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 flex items-center gap-1.5 cursor-pointer ${
                  currentTab === 'offerwall' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                <ClixWallIcon size={16} />
                <span>عروض ClixWall</span>
                <span className="text-[11px] font-mono font-extrabold text-amber-600 dark:text-amber-400">
                  USD
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('how_it_works')}
                className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                  currentTab === 'how_it_works' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                }`}
              >
                طرق الدفع باليمن
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                    currentTab === 'dashboard' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                  }`}
                >
                  لوحة التحكم
                </button>
              )}
              {user?.role === 'advertiser' && (
                <button
                  type="button"
                  onClick={() => onNavigate('advertiser')}
                  className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 flex items-center gap-1.5 cursor-pointer ${
                    currentTab === 'advertiser' ? 'text-emerald-600 dark:text-emerald-400 font-bold border-b-2 border-emerald-600' : ''
                  }`}
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>بوابة المعلنين</span>
                </button>
              )}
            </nav>

            {/* Zone 3: Android APK Download, Notifications, Theme Toggle & User Account */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <div className="hidden sm:block">
                <AndroidApkDownloadButton variant="compact" />
              </div>

              <NotificationBell onNavigate={onNavigate} />

              <button
                type="button"
                onClick={onToggleDark}
                title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
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
                    <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="hidden sm:inline text-xs font-bold max-w-[96px] truncate">
                      {user.fullName}
                    </span>
                  </button>

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

                          {user?.role === 'advertiser' && (
                            <button
                              type="button"
                              onClick={() => {
                                onNavigate('advertiser');
                                setIsUserMenuOpen(false);
                              }}
                              className="w-full text-right px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-1.5 transition-colors"
                            >
                              <Megaphone className="w-3.5 h-3.5" />
                              <span>بوابة المعلنين والحملات</span>
                            </button>
                          )}

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
                  className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  تسجيل الدخول
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Smooth RTL Slide-out Drawer Sidebar */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          isSidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!isSidebarOpen}
      >
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setIsSidebarOpen(false)}
        />

        <aside
          className={`fixed top-0 bottom-0 right-0 w-76 max-w-[85vw] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between transition-transform duration-300 ease-out ${
            isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex flex-col flex-1 overflow-y-auto">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/brand-icon.png?v=3"
                  alt="Yemen Task"
                  className="w-9 h-9 rounded-xl object-contain border border-emerald-600/20 bg-emerald-950"
                />
                <div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                    Yemen Task
                  </div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    كسب اليمن
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="إغلاق القائمة"
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Profile Card inside Drawer */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              {user ? (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0">
                      {user.fullName?.slice(0, 1) || 'ي'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                        {user.fullName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate" dir="ltr">
                        {user.phone}
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">الرصيد المتاح:</span>
                    <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {wallet ? `${formatYer(wallet.availableBalance)} ر.ي` : 'يتطلب اتصالاً'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800 space-y-2.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    سجّل دخولك لبدء الكسب وحفظ مهامك
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSidebarOpen(false);
                      openAuthModal('login');
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors"
                  >
                    تسجيل الدخول / حساب جديد
                  </button>
                </div>
              )}
            </div>

            {/* Real Navigation Links */}
            <nav className="p-3 space-y-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => navigateFromDrawer('home')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'home'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Home className="w-4 h-4 shrink-0" />
                <span>الصفحة الرئيسية</span>
              </button>

              <button
                type="button"
                onClick={() => navigateFromDrawer('tasks')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'tasks'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <CheckSquare className="w-4 h-4 shrink-0" />
                <span>المهام المتاحة</span>
              </button>

              <button
                type="button"
                onClick={() => navigateFromDrawer('earn_ads')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'earn_ads'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Tv className="w-4 h-4 shrink-0 text-sky-500" />
                <span>اكسب من الإعلانات</span>
                <span className="mr-auto font-mono text-[10px] text-amber-500">YT</span>
              </button>

              <button
                type="button"
                onClick={() => navigateFromDrawer('offerwall')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'offerwall'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ClixWallIcon size={16} />
                <span>عروض ClixWall</span>
                <span className="mr-auto font-mono text-[10px] text-amber-500">USD</span>
              </button>

              <button
                type="button"
                onClick={() => navigateFromDrawer('wallet')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'wallet'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Wallet className="w-4 h-4 shrink-0" />
                <span>المحفظة وسجل الأرباح</span>
              </button>

              {user && (
                <button
                  type="button"
                  onClick={() => navigateFromDrawer('dashboard')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                    currentTab === 'dashboard'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  <span>الملف الشخصي ولوحة التحكم</span>
                </button>
              )}

              {user?.role === 'advertiser' && (
                <button
                  type="button"
                  onClick={() => navigateFromDrawer('advertiser')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                    currentTab === 'advertiser'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  <Megaphone className="w-4 h-4 shrink-0" />
                  <span>بوابة المعلنين والحملات</span>
                </button>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => navigateFromDrawer('admin')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                    currentTab === 'admin'
                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  <Shield className="w-4 h-4 shrink-0" />
                  <span>لوحة الإدارة الحصرية</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => navigateFromDrawer('how_it_works')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                  currentTab === 'how_it_works'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <HelpCircle className="w-4 h-4 shrink-0" />
                <span>المساعدة وطرق الدفع</span>
              </button>
            </nav>

            {/* Drawer Settings & Install */}
            <div className="p-3 mx-3 mt-2 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <button
                type="button"
                onClick={onToggleDark}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 px-1 py-1"
              >
                <span className="flex items-center gap-2">
                  {isDark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}
                  <span>المظهر: {isDark ? 'الوضع الليلي' : 'الوضع النهاري'}</span>
                </span>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400">تبديل</span>
              </button>

              <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700 flex justify-center">
                <AndroidApkDownloadButton variant="full" />
              </div>
            </div>
          </div>

          {user && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  logout();
                  setIsSidebarOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-bold text-xs hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
};
