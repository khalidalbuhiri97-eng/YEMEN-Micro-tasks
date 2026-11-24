/**
 * Kasb Yemen (كسب اليمن) - Micro-tasks Earning Platform
 * Full-Stack Fintech Platform for Micro-Tasks & Remittances in Yemen
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Navbar } from './components/layout/Navbar.tsx';
import { Hero } from './components/public/Hero.tsx';
import { HowItWorks } from './components/public/HowItWorks.tsx';
import { DashboardLayout } from './components/dashboard/DashboardLayout.tsx';
import { TasksView } from './components/dashboard/TasksView.tsx';
import { WalletView } from './components/dashboard/WalletView.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { AdvertiserPortal } from './components/advertiser/AdvertiserPortal.tsx';
import { LegalModal } from './components/public/LegalPages.tsx';
import { OfferWallView } from './components/dashboard/OfferWallView.tsx';
import { OfflineIndicator } from './components/pwa/OfflineIndicator.tsx';
import { SplashScreen } from './components/common/SplashScreen.tsx';
import { HomeShortcutsStrip } from './components/home/HomeShortcutsStrip.tsx';
import { InfoCenter } from './components/public/InfoCenter.tsx';
import { YtEcosystemApp } from './yt-ecosystem/YtEcosystemApp.tsx';

import { ResetPasswordPage } from './components/auth/ResetPasswordPage.tsx';
import { Home, CheckSquare, Wallet, User, Shield, Megaphone } from 'lucide-react';

function isResetPasswordLocation(): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/reset-password') return true;
  return (
    window.location.hash.includes('type=recovery') ||
    window.location.search.includes('type=recovery')
  );
}

function MainApp() {
  const { user, isAdmin, openAuthModal } = useAuth();
  const [isResetPasswordRoute, setIsResetPasswordRoute] = useState<boolean>(() =>
    isResetPasswordLocation()
  );
  const [currentTab, setCurrentTab] = useState<'home' | 'tasks' | 'wallet' | 'offerwall' | 'earn_ads' | 'how_it_works' | 'dashboard' | 'referrals' | 'settings' | 'advertiser' | 'admin' | 'ytcoin' | 'info_center'>('home');
  const [offerwallDefaultView, setOfferwallDefaultView] = useState<'hub' | 'wall' | 'gg-wall'>('hub');
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy' | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Dark mode handler adhering to §1.F
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('kasb_theme') === 'dark';
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('kasb_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('kasb_theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    const handleAuthSuccess = (event: Event) => {
      const loggedUser = (event as CustomEvent)?.detail?.user;
      if (!loggedUser) return;
      if (loggedUser.role === 'advertiser') {
        setCurrentTab('advertiser');
      } else if (loggedUser.role === 'admin') {
        setCurrentTab('admin');
      } else {
        setCurrentTab('dashboard');
      }
    };
    window.addEventListener('kasb:auth_success', handleAuthSuccess);
    return () => window.removeEventListener('kasb:auth_success', handleAuthSuccess);
  }, []);

  useEffect(() => {
    if (!user && (currentTab === 'advertiser' || currentTab === 'admin' || currentTab === 'dashboard')) {
      setCurrentTab('home');
    } else if (user && currentTab === 'advertiser' && user.role !== 'advertiser') {
      setCurrentTab('dashboard');
    } else if (user && currentTab === 'admin' && !isAdmin) {
      setCurrentTab(user.role === 'advertiser' ? 'advertiser' : 'dashboard');
    }
  }, [user, isAdmin, currentTab]);

  const toggleDark = () => {
    setIsDark((prev) => !prev);
  };

  useEffect(() => {
    const syncRoute = () => {
      setIsResetPasswordRoute(isResetPasswordLocation());
    };
    const handleNavigateReset = () => setIsResetPasswordRoute(true);
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('kasb:navigate_reset_password', handleNavigateReset);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('kasb:navigate_reset_password', handleNavigateReset);
    };
  }, []);

  const exitResetPasswordRoute = (openLogin = false) => {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, document.title, '/');
    }
    setIsResetPasswordRoute(false);
    setCurrentTab('home');
    if (openLogin) {
      openAuthModal('login');
    }
  };

  if (isResetPasswordRoute) {
    return (
      <ResetPasswordPage
        onGoHome={() => exitResetPasswordRoute(false)}
        onGoLogin={() => exitResetPasswordRoute(true)}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors overflow-x-hidden w-full max-w-full">
      {/* Non-blocking Animated Splash Overlay & Offline Status Indicator */}
      <SplashScreen />
      <OfflineIndicator />

      {/* Top Bar Navigation */}
      {currentTab !== 'ytcoin' && currentTab !== 'earn_ads' && (
        <Navbar
          currentTab={currentTab}
          onNavigate={(tab) => {
            if (tab === 'privacy') setLegalModalType('privacy');
            else if (tab === 'terms') setLegalModalType('terms');
            else setCurrentTab(tab as any);
          }}
          isDark={isDark}
          onToggleDark={toggleDark}
        />
      )}

      {/* Main View Router */}
      <div className="flex-1 pb-16 md:pb-0">
        {currentTab === 'home' && (
          <main>
            <HomeShortcutsStrip onNavigate={(tab) => setCurrentTab(tab as any)} />
            <YtEcosystemApp compact user={user} isAdmin={isAdmin} onLogin={() => openAuthModal('login')} onOpen={() => setCurrentTab('ytcoin')} />
            <Hero
              onStartEarning={() => setCurrentTab('tasks')}
              onExploreTasks={() => setCurrentTab('tasks')}
              onGoToOfferWall={(provider) => {
                if (provider === 'clixwall') setOfferwallDefaultView('wall');
                else if (provider === 'offerwall-gg') setOfferwallDefaultView('gg-wall');
                else setOfferwallDefaultView('hub');
                setCurrentTab('offerwall');
              }}
            />
          </main>
        )}

        {currentTab === 'ytcoin' && (
          <div className="w-full h-full min-h-[100dvh]">
            <YtEcosystemApp user={user} isAdmin={isAdmin} onLogin={() => openAuthModal('login')} onExit={() => setCurrentTab('home')} />
          </div>
        )}

        {currentTab === 'earn_ads' && (
          <YtEcosystemApp user={user} isAdmin={isAdmin} onLogin={() => openAuthModal('login')} initialTab="mine" onExit={() => setCurrentTab('home')} />
        )}

        {currentTab === 'tasks' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <TasksView
              initialCategory={selectedCategory}
              onGoToSubmissions={() => setCurrentTab('dashboard')}
              onGoToWallet={() => setCurrentTab('wallet')}
            />
          </div>
        )}

        {currentTab === 'wallet' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <WalletView
              onGoToWithdraw={() => setCurrentTab('dashboard')}
              onGoToTasks={() => setCurrentTab('tasks')}
            />
          </div>
        )}

        {currentTab === 'offerwall' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <OfferWallView defaultView={offerwallDefaultView} />
          </div>
        )}

        {currentTab === 'how_it_works' && <HowItWorks onStart={() => setCurrentTab('tasks')} />}

        {currentTab === 'info_center' && (
          <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
            <InfoCenter onOpenTerms={() => setLegalModalType('terms')} onOpenPrivacy={() => setLegalModalType('privacy')} />
          </div>
        )}

        {currentTab === 'dashboard' && (
          <DashboardLayout
            onNavigateHome={() => setCurrentTab('home')}
          />
        )}

        {(currentTab === 'referrals' || currentTab === 'settings') && (
          <DashboardLayout
            initialSubTab={currentTab}
            onNavigateHome={() => setCurrentTab('home')}
          />
        )}

        {currentTab === 'advertiser' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <AdvertiserPortal onNavigateWallet={() => setCurrentTab('wallet')} />
          </div>
        )}

        {currentTab === 'admin' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <AdminDashboard />
          </div>
        )}
      </div>

      {/* Mobile Sticky Thumb Navigation Bar (§1.I 15% Mobile Sticky Cap) */}
      {currentTab !== 'ytcoin' && currentTab !== 'earn_ads' && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-around text-[10px] font-bold">
        <button
          onClick={() => setCurrentTab('home')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            currentTab === 'home' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>الرئيسية</span>
        </button>

        <button
          onClick={() => setCurrentTab('tasks')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            currentTab === 'tasks' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>المهام</span>
        </button>

        <button
          onClick={() => setCurrentTab('wallet')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            currentTab === 'wallet' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>المحفظة</span>
        </button>

        <button
          onClick={() => setCurrentTab('dashboard')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            currentTab === 'dashboard' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
          }`}
        >
          <User className="w-4 h-4" />
          <span>لوحتي</span>
        </button>

        {user?.role === 'advertiser' && (
          <button
            onClick={() => setCurrentTab('advertiser')}
            className={`flex flex-col items-center gap-1 transition-colors ${
              currentTab === 'advertiser' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
            }`}
          >
            <Megaphone className="w-4 h-4" />
            <span>الحملات</span>
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => setCurrentTab('admin')}
            className={`flex flex-col items-center gap-1 transition-colors ${
              currentTab === 'admin' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>الإدارة</span>
          </button>
        )}
      </div>
      )}

      {/* Legal & Terms Modal */}
      <LegalModal type={legalModalType} onClose={() => setLegalModalType(null)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
