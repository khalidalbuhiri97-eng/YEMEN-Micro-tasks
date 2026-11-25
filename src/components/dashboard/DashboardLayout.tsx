import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { OverviewView } from './OverviewView.tsx';
import { TasksView } from './TasksView.tsx';
import { MySubmissionsView } from './MySubmissionsView.tsx';
import { WalletView } from './WalletView.tsx';
import { WithdrawView } from './WithdrawView.tsx';
import { ReferralView } from './ReferralView.tsx';
import { SupportView } from './SupportView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { AdvertiserPortal } from '../advertiser/AdvertiserPortal.tsx';
import { EmailVerificationBanner } from '../common/EmailVerificationBanner.tsx';
import { GeoLocationSelector, type GeoSingleValue } from '../common/GeoLocationSelector.tsx';
import {
  LayoutDashboard,
  CheckSquare,
  FileCheck,
  Wallet,
  Banknote,
  Users,
  HelpCircle,
  Megaphone,
  Settings,
  ChevronLeft,
  MapPin,
  ArrowLeft,
  X,
} from 'lucide-react';
import { formatYer } from '../../../shared/money.ts';

interface DashboardLayoutProps {
  initialSubTab?: string;
  onNavigateHome: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  initialSubTab,
  onNavigateHome,
}) => {
  const { user, wallet, refreshUser, showToast, openAuthModal, isOnline, isUsingOfflineSession } = useAuth();
  const [subTab, setSubTab] = useState(
    initialSubTab || (user?.role === 'advertiser' ? 'advertiser' : 'overview')
  );
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [editGeo, setEditGeo] = useState<GeoSingleValue>({
    countryId: user?.countryId || '',
    divisionId: user?.administrativeDivisionId || null,
    pathTextAr: user?.locationPath || user?.city || '',
    lowestNameAr: user?.city || '',
  });

  useEffect(() => {
    if (!initialSubTab && user?.role === 'advertiser' && subTab === 'overview') {
      setSubTab('advertiser');
    } else if (!initialSubTab && user?.role !== 'advertiser' && subTab === 'advertiser') {
      setSubTab('overview');
    }
  }, [user?.role, initialSubTab, subTab]);

  const menuItems =
    user?.role === 'advertiser'
      ? [
          { id: 'advertiser', label: 'بوابة الحملات الإعلانية', icon: Megaphone },
          { id: 'wallet', label: 'محفظة المعلن والحركات', icon: Wallet },
          { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
          { id: 'support', label: 'مركز الدعم والمساعدة', icon: HelpCircle },
        ]
      : [
          { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
          { id: 'tasks', label: 'المهام المتاحة', icon: CheckSquare },
          { id: 'submissions', label: 'إثباتاتي المرفوعة', icon: FileCheck },
          { id: 'wallet', label: 'المحفظة وسجل الحركات', icon: Wallet },
          { id: 'withdraw', label: 'سحب الأرباح نقداً', icon: Banknote },
          { id: 'referrals', label: 'دعوة الأصدقاء والإحالة', icon: Users },
          { id: 'settings', label: 'إعدادات الحساب', icon: Settings },
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
    <div dir="rtl" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5">
      {/* Unified Hero Profile & Balance Card */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-lg border border-amber-400/30">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -left-16 w-56 h-56 rounded-full bg-emerald-500/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -right-12 w-52 h-52 rounded-full bg-amber-400/10 blur-3xl"
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {/* Identity & Location */}
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-extrabold text-lg flex items-center justify-center shrink-0 ring-2 ring-amber-400/40 shadow-md">
              {user.fullName ? user.fullName.slice(0, 1) : 'م'}
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-base sm:text-xl font-extrabold text-white leading-snug">
                  {user?.fullName}
                </h1>
                {user?.phone && (
                  <span className="text-[11px] font-mono text-slate-300/80" dir="ltr">
                    {user.phone}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-200/90">
                <span className="inline-flex items-center gap-1 leading-snug">
                  <MapPin className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>
                    {user?.countryFlag ? `${user.countryFlag} ` : ''}
                    {user?.locationPath || user?.city || 'صنعاء'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditGeo({
                      countryId: user?.countryId || '',
                      divisionId: user?.administrativeDivisionId || null,
                      pathTextAr: user?.locationPath || user?.city || '',
                      lowestNameAr: user?.city || '',
                    });
                    setIsLocationModalOpen(true);
                  }}
                  className="px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-amber-200 border border-white/15 transition-colors cursor-pointer"
                >
                  تعديل
                </button>
              </div>

              <p className="text-[11px] text-slate-300/90 leading-relaxed max-w-xl hidden sm:block">
                محفظتك جاهزة لاستقبال مكافآت المهام المصغرة وسحب أرباحك عبر الكريمي وشبكات الصرافة.
              </p>
            </div>
          </div>

          {/* Balance & Primary CTAs */}
          <div className="flex flex-col sm:flex-row sm:items-center lg:items-end lg:flex-col xl:flex-row xl:items-center gap-4 pt-3 lg:pt-0 border-t border-white/10 lg:border-t-0 shrink-0">
            <div className="flex items-baseline justify-between sm:block text-right sm:pl-4 sm:border-l sm:border-white/10 lg:border-l-0 lg:pl-0 xl:pl-4 xl:border-l xl:border-white/10">
              <span className="text-[11px] font-medium text-emerald-200/80 block">
                الرصيد المتاح
              </span>
              {isOnline && !isUsingOfflineSession ? (
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-amber-300 tracking-tight">
                    {formatYer(wallet?.availableBalance ?? 0)}
                  </span>
                  <span className="text-xs font-bold text-amber-200/90">ر.ي</span>
                </div>
              ) : (
                <span className="font-bold text-amber-300 text-xs mt-1 block">
                  يتطلب اتصالاً بالإنترنت
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSubTab('withdraw')}
                className="min-h-[44px] px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 rounded-2xl shadow-md shadow-emerald-950/40 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Banknote className="w-4 h-4 shrink-0" />
                <span>طلب سحب أرباح</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('tasks')}
                className="min-h-[44px] px-4 py-2.5 text-xs font-bold text-slate-900 bg-white/95 hover:bg-white rounded-2xl border border-white/40 shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <span>المهام المتاحة</span>
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Clean Untruncated 2-Column Mobile Action Grid / Desktop Sidebar */}
        <aside className="lg:col-span-3 shrink-0">
          <nav
            aria-label="أقسام لوحتي"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2.5"
          >
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = subTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group min-h-[58px] w-full flex items-center gap-2.5 p-3 rounded-2xl border transition-all duration-200 text-right ${
                    isActive
                      ? 'bg-gradient-to-l from-slate-900 via-emerald-950 to-slate-900 text-white border-amber-400/50 shadow-md shadow-emerald-950/15'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-100 dark:border-slate-800 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/30 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <span
                    className={`p-2 rounded-xl shrink-0 flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-white/15 text-amber-300'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0 text-xs font-bold whitespace-normal leading-snug text-right">
                    {item.label}
                  </span>
                  <ChevronLeft
                    className={`w-3.5 h-3.5 shrink-0 transition-transform group-hover:-translate-x-0.5 ${
                      isActive ? 'text-amber-300/90' : 'text-slate-300 dark:text-slate-600 group-hover:text-emerald-500'
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="lg:col-span-9 min-h-[500px]">
          {subTab !== 'withdraw' && subTab !== 'tasks' && (
            <EmailVerificationBanner className="mb-5" />
          )}
          {subTab === 'advertiser' && (
            <AdvertiserPortal onNavigateWallet={() => setSubTab('wallet')} />
          )}
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
          {subTab === 'settings' && <SettingsView />}
          {subTab === 'support' && <SupportView />}
        </main>
      </div>

      {/* Edit Geographic Location Modal */}
      {isLocationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">تحديث الموقع الجغرافي</h3>
              </div>
              <button
                type="button"
                onClick={() => !isSavingLocation && setIsLocationModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <GeoLocationSelector
                mode="single"
                countryId={editGeo.countryId}
                divisionId={editGeo.divisionId}
                defaultCountryIso2={user?.countryCode || 'YE'}
                required
                onChange={setEditGeo}
              />
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSavingLocation}
                  onClick={() => setIsLocationModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={isSavingLocation || !editGeo.countryId || !editGeo.divisionId}
                  onClick={async () => {
                    if (!editGeo.countryId || !editGeo.divisionId) return;
                    setIsSavingLocation(true);
                    try {
                      await api.updateMyProfileLocation({
                        countryId: editGeo.countryId,
                        administrativeDivisionId: editGeo.divisionId,
                        city: editGeo.lowestNameAr || editGeo.pathTextAr,
                      });
                      await refreshUser();
                      showToast('تم تحديث موقعك الجغرافي بنجاح', 'success');
                      setIsLocationModalOpen(false);
                    } catch (err: any) {
                      showToast(err?.message || 'تعذر تحديث الموقع الجغرافي', 'error');
                    } finally {
                      setIsSavingLocation(false);
                    }
                  }}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl transition-colors"
                >
                  {isSavingLocation ? 'جاري الحفظ...' : 'حفظ الموقع'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
