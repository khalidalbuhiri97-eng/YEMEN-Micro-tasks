import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api, SessionExpiredError } from '../../api/client.ts';
import type { TaskItem, TaskSubmission, WalletTransaction } from '../../types/index.ts';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle,
  PlusCircle,
  Banknote,
  Send,
  Sparkles,
  ArrowLeft,
  ShieldCheck,
  MapPin,
  X,
} from 'lucide-react';
import { GeoLocationSelector, type GeoSingleValue } from '../common/GeoLocationSelector.tsx';
import { formatYer } from '../../../shared/money.ts';

interface OverviewViewProps {
  onNavigateTab: (tab: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ onNavigateTab }) => {
  const { user, wallet, refreshUser, showToast } = useAuth();
  const [recentTasks, setRecentTasks] = useState<TaskItem[]>([]);
  const [recentSubmissions, setRecentSubmissions] = useState<TaskSubmission[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [editGeo, setEditGeo] = useState<GeoSingleValue>({
    countryId: user?.countryId || '',
    divisionId: user?.administrativeDivisionId || null,
    pathTextAr: user?.locationPath || user?.city || '',
    lowestNameAr: user?.city || '',
  });

  useEffect(() => {
    let isMounted = true;
    const loadOverviewData = async () => {
      try {
        const tasksRes = await api.getTasks();
        if (!isMounted) return;
        setRecentTasks((tasksRes.tasks || []).slice(0, 3));

        if (user) {
          const [subsRes, walletRes] = await Promise.all([
            api.getMySubmissions(),
            api.getMyWallet(),
          ]);
          if (!isMounted) return;
          setRecentSubmissions((subsRes.submissions || []).slice(0, 3));
          setRecentTransactions((walletRes.transactions || []).slice(0, 5));
        } else {
          setRecentSubmissions([]);
          setRecentTransactions([]);
        }
      } catch (err) {
        if (!isMounted) return;
        if (err instanceof SessionExpiredError) {
          setRecentSubmissions([]);
          setRecentTransactions([]);
        } else {
          console.error('Error loading dashboard overview', err);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadOverviewData();
    return () => {
      isMounted = false;
    };
  }, [user]);

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs text-emerald-400 font-bold">
              لوحة تحكم المستخدم · {user?.countryFlag ? `${user.countryFlag} ` : ''}{user?.locationPath || user?.city || 'صنعاء'}
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
              className="text-[11px] font-semibold text-slate-300 hover:text-white underline underline-offset-2 flex items-center gap-1"
            >
              <MapPin className="w-3 h-3" />
              <span>تعديل الموقع</span>
            </button>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">
            أهلاً بك مجدداً، {user?.fullName} 👋
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
            محفظتك جاهزة لاستقبال مكافآت المهام المصغرة. أنجز مهام اليوم واطلب سحب أرباحك فوراً عبر الكريمي أو النجم.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onNavigateTab('withdraw')}
            className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow transition-colors flex items-center gap-1.5"
          >
            <Banknote className="w-4 h-4" />
            <span>طلب سحب أرباح</span>
          </button>
          <button
            onClick={() => onNavigateTab('tasks')}
            className="px-5 py-2.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <span>المهام المتاحة</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4 Financial Balances Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">الرصيد المتاح</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatYer(wallet?.availableBalance ?? 0)}{' '}
            <span className="text-xs font-bold text-emerald-600">ر.ي</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">قابل للسحب الفوري الآن</p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>الرصيد المعلق</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatYer(wallet?.pendingBalance ?? 0)}{' '}
            <span className="text-xs font-bold text-slate-400">ر.ي</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">طلبات سحب قيد الصرف</p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>إجمالي الأرباح</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatYer(wallet?.totalEarned ?? 0)}{' '}
            <span className="text-xs font-bold text-slate-400">ر.ي</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">الأرباح المعتمدة تاريخياً</p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>إجمالي المسحوبات</span>
            <ArrowDownLeft className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatYer(wallet?.totalWithdrawn ?? 0)}{' '}
            <span className="text-xs font-bold text-slate-400">ر.ي</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">تم استلامها نقداً</p>
        </div>
      </div>


      {/* 2-Column Split: Recommended Tasks & Recent Submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recommended Tasks */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>مهام مقترحة لك اليوم</span>
            </h2>
            <button
              onClick={() => onNavigateTab('tasks')}
              className="text-xs font-bold text-emerald-600 hover:underline"
            >
              عرض الكل ({recentTasks.length})
            </button>
          </div>

          <div className="space-y-3">
            {recentTasks.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                لا توجد مهام منشورة حالياً. تابع الصفحة لاحقاً عند إضافة مهام جديدة من أصحاب الأعمال.
              </p>
            ) : (
              recentTasks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onNavigateTab('tasks')}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-500/50 cursor-pointer transition-all flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1 truncate">
                      {t.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>الوقت: {t.timeEstimateMinutes} دقائق</span>
                      <span>·</span>
                      <span>المتبقي: {t.totalQuantity - t.completedQuantity}</span>
                      <span>·</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {t.isExternalCampaign
                          ? t.hideAdvertiserName
                            ? 'معلن عبر يمن تاسك (حملة خارجية)'
                            : `${t.advertiserDisplayName || 'معلن عبر يمن تاسك'} (حملة خارجية)`
                          : 'مهمة مباشرة من المنصة'}
                      </span>
                    </div>
                  </div>

                  <div className="text-left shrink-0">
                    <div className="text-sm sm:text-base font-extrabold font-mono text-emerald-600 tabular-nums">
                      +{formatYer(t.rewardYer)} ر.ي
                    </div>
                    <span className="text-[10px] text-slate-400 block">بدء الآن</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Submissions Tracker */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>آخر الإثباتات المرسلة</span>
            </h2>
            <button
              onClick={() => onNavigateTab('submissions')}
              className="text-xs font-bold text-emerald-600 hover:underline"
            >
              متابعة الإثباتات
            </button>
          </div>

          {recentSubmissions.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              لم تقدم أي إثبات بعد. اختر مهمة وابدأ الكسب!
            </p>
          ) : (
            <div className="space-y-3">
              {recentSubmissions.map((s) => (
                <div
                  key={s.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white truncate max-w-[180px]">
                      {s.taskTitle}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        s.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : s.status === 'REJECTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {s.status === 'APPROVED' ? 'معتمد' : s.status === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>{new Date(s.createdAt).toLocaleDateString('ar-YE')}</span>
                    <span className="font-bold text-emerald-600">+{formatYer(s.taskRewardYer ?? 0)} ر.ي</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* Recent Ledger Transactions */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            آخر العمليات في المحفظة المالية
          </h2>
          <button
            onClick={() => onNavigateTab('wallet')}
            className="text-xs font-bold text-emerald-600 hover:underline"
          >
            عرض سجل المعاملات كاملاً
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-medium">
              <tr>
                <th className="py-2.5 px-3">نوع الحركة</th>
                <th className="py-2.5 px-3">البيان</th>
                <th className="py-2.5 px-3 text-left">المبلغ</th>
                <th className="py-2.5 px-3 text-left font-mono">الرصيد بعد الحركة</th>
                <th className="py-2.5 px-3">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد حركات مالية مسجلة حتى الآن.
                  </td>
                </tr>
              ) : (
                recentTransactions.map((tx) => {
                  const isCredit = tx.amount > 0;
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {tx.type === 'TASK_REWARD'
                          ? 'مكافأة مهمة'
                          : tx.type === 'CLIXWALL_REWARD'
                          ? 'مكافأة ClixWall'
                          : tx.type === 'CLIXWALL_REVERSAL'
                          ? 'استرجاع ClixWall'
                          : tx.type === 'WITHDRAWAL_REQUEST'
                          ? 'طلب سحب'
                          : 'حركة مالية'}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                        {tx.description}
                      </td>
                      <td
                        className={`py-3 px-3 text-left font-mono font-bold tabular-nums ${
                          isCredit ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isCredit ? '+' : ''}
                        {formatYer(tx.amount)} ر.ي
                      </td>
                      <td className="py-3 px-3 text-left font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {formatYer(tx.newBalance)}
                      </td>
                      <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                        {new Date(tx.createdAt).toLocaleDateString('ar-YE')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
