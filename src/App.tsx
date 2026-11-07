/**
 * Kasb Yemen (كسب اليمن) - Micro-tasks Earning Platform
 * Full-Stack Fintech Platform for Micro-Tasks & Remittances in Yemen
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Navbar } from './components/layout/Navbar.tsx';
import { Footer } from './components/layout/Footer.tsx';
import { Hero } from './components/public/Hero.tsx';
import { HowItWorks } from './components/public/HowItWorks.tsx';
import { YemenPayoutsSection } from './components/public/YemenPayoutsSection.tsx';
import { TaskCategoriesSection } from './components/public/TaskCategoriesSection.tsx';
import { TrustAndFaqSection } from './components/public/TrustAndFaqSection.tsx';
import { DashboardLayout } from './components/dashboard/DashboardLayout.tsx';
import { TasksView } from './components/dashboard/TasksView.tsx';
import { WalletView } from './components/dashboard/WalletView.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { LegalModal } from './components/public/LegalPages.tsx';
import { Home, CheckSquare, Wallet, User, Shield } from 'lucide-react';

function MainApp() {
  const { user, isAdmin } = useAuth();
  const [currentTab, setCurrentTab] = useState<'home' | 'tasks' | 'wallet' | 'how_it_works' | 'dashboard' | 'admin'>('home');
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

  const toggleDark = () => {
    setIsDark((prev) => !prev);
  };

  const handleSelectCategoryFromHome = (cat: string) => {
    setSelectedCategory(cat);
    setCurrentTab('tasks');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors overflow-x-hidden w-full max-w-full">
      {/* Top Bar Navigation */}
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

      {/* Main View Router */}
      <div className="flex-1 pb-16 md:pb-0">
        {currentTab === 'home' && (
          <main>
            <Hero
              onStartEarning={() => setCurrentTab('tasks')}
              onExploreTasks={() => setCurrentTab('tasks')}
            />
            <HowItWorks onStart={() => setCurrentTab('tasks')} />
            <TaskCategoriesSection onSelectCategory={handleSelectCategoryFromHome} />
            <YemenPayoutsSection />
            <TrustAndFaqSection />
          </main>
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

        {currentTab === 'how_it_works' && (
          <div className="py-8">
            <YemenPayoutsSection />
            <HowItWorks onStart={() => setCurrentTab('tasks')} />
            <TrustAndFaqSection />
          </div>
        )}

        {currentTab === 'dashboard' && (
          <DashboardLayout
            onNavigateHome={() => setCurrentTab('home')}
          />
        )}

        {currentTab === 'admin' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <AdminDashboard />
          </div>
        )}
      </div>

      {/* Footer */}
      <Footer
        onNavigate={(tab) => {
          if (tab === 'privacy') setLegalModalType('privacy');
          else if (tab === 'terms') setLegalModalType('terms');
          else setCurrentTab(tab as any);
        }}
      />

      {/* Mobile Sticky Thumb Navigation Bar (§1.I 15% Mobile Sticky Cap) */}
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
