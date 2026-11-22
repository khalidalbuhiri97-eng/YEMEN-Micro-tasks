import React, { useState, useEffect, useCallback } from 'react';
import {
  Tv,
  MousePointerClick,
  Eye,
  Coins,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
  LogIn,
  Loader2,
  Clock,
  Layers,
  Wallet,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { formatYt } from '../../../shared/ytCoin.ts';

interface EarnFromAdsViewProps {
  onBackHome: () => void;
  onOpenYtCoin: () => void;
}

type ConnectedNetwork = {
  id: string;
  networkKey: string;
  displayName: string;
  description?: string | null;
  adType: 'view' | 'click' | 'both';
  rewardClickUnits: number;
  rewardClickYt: number;
  rewardViewUnits: number;
  rewardViewYt: number;
  dailyUserLimit: number;
  isActive: boolean;
  isConnected: boolean;
};

type AdEventItem = {
  id: string;
  networkKey: string;
  externalEventId: string;
  eventType: 'click' | 'view';
  amountUnits: number;
  amountYt: number;
  verificationSource: string;
  createdAt: string;
};

type AdCenterPayload = {
  unitScale: number;
  adClickRewardUnits: number;
  adClickRewardYt: number;
  adViewRewardUnits: number;
  adViewRewardYt: number;
  dailyAdLimit: number;
  adsToday: number;
  totalAdEarnedUnits: number;
  totalAdEarnedYt: number;
  availableAdsCount: number;
  hasConnectedNetwork: boolean;
  connectedNetworks: ConnectedNetwork[];
  recentEvents: AdEventItem[];
};

const YT_COIN_LOGO_SRC = '/assets/yt-coin-logo.jpg';

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export const EarnFromAdsView: React.FC<EarnFromAdsViewProps> = ({ onBackHome, onOpenYtCoin }) => {
  const { user, openAuthModal, showToast } = useAuth();
  const [adCenter, setAdCenter] = useState<AdCenterPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    networkKey: string;
    displayName: string;
    eventType: 'click' | 'view';
    targetUrl: string;
  } | null>(null);

  const loadAdCenter = useCallback(async () => {
    if (!user) {
      setAdCenter(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getYtCoinAdCenter();
      setAdCenter(res?.adCenter ?? null);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل بيانات الإعلانات المتاحة حالياً.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadAdCenter();
  }, [loadAdCenter]);

  const handleStartSession = async (net: ConnectedNetwork, eventType: 'click' | 'view') => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    const key = `${net.networkKey}:${eventType}`;
    setStartingKey(key);
    try {
      const res = await api.createYtCoinAdSession({
        networkKey: net.networkKey,
        eventType,
      });
      if (res?.session?.targetUrl) {
        setActiveSession({
          sessionId: res.session.sessionId,
          networkKey: res.session.networkKey,
          displayName: net.displayName,
          eventType: res.session.eventType,
          targetUrl: res.session.targetUrl,
        });
        showToast('تم إنشاء جلسة إعلان موثقة. افتح الرابط وأكمل الإجراء ليتم الاحتساب من الشبكة.', 'info');
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر بدء جلسة الإعلان.', 'error');
    } finally {
      setStartingKey(null);
    }
  };

  return (
    <div dir="rtl" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
            <Tv className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                اكسب من الإعلانات
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                <img src={YT_COIN_LOGO_SRC} alt="YT Coin" className="w-3.5 h-3.5 rounded-full object-cover" />
                مكافآت YT Coin
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              تُضاف المكافآت إلى محفظة YT Coin المستقلة فقط بعد إتمام المشاهدة أو النقرة وتأكيد نجاح الحدث من مصدر الشبكة الموثوق.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenYtCoin}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>محفظة YT Coin</span>
          </button>
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>الرئيسية</span>
          </button>
        </div>
      </div>

      {/* Unauthenticated Guard */}
      {!user ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center space-y-4 shadow-sm max-w-xl mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mx-auto border border-sky-200 dark:border-sky-800">
            <LogIn className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
            سجّل دخولك للوصول إلى الإعلانات الموثقة
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            يرتبط كل حدث إعلاني مؤكد بمعرّف حسابك ومرجع فريد في قاعدة البيانات لحماية مكافآتك ومنع التكرار.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-1">
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => openAuthModal('register')}
              className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer"
            >
              إنشاء حساب جديد
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Error Banner */}
          {error && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
              <span className="flex items-center gap-2 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </span>
              <button
                type="button"
                onClick={() => void loadAdCenter()}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-sky-700 dark:text-sky-400">
                <span>مكافأة المشاهدة المؤهلة</span>
                <Eye className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono text-slate-900 dark:text-white">
                  {formatYt(adCenter?.adViewRewardYt ?? 0.01)}
                </strong>
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">YT</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">
                = {adCenter?.adViewRewardUnits ?? 10} جزء
              </p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <span>مكافأة النقرة المؤهلة</span>
                <MousePointerClick className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono text-slate-900 dark:text-white">
                  {formatYt(adCenter?.adClickRewardYt ?? 0.01)}
                </strong>
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">YT</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">
                = {adCenter?.adClickRewardUnits ?? 10} جزء
              </p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>الإعلانات المتاحة</span>
                <Layers className="w-4 h-4 text-sky-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono text-slate-900 dark:text-white">
                  {loading && !adCenter ? '...' : adCenter?.availableAdsCount ?? 0}
                </strong>
                <span className="text-xs font-bold text-slate-500">شبكة متصلة</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">
                اليوم: {adCenter?.adsToday ?? 0}
                {(adCenter?.dailyAdLimit ?? 0) > 0 ? ` / ${adCenter?.dailyAdLimit}` : ''}
              </p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-400">
                <span>إجمالي أرباح الإعلانات</span>
                <Coins className="w-4 h-4" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <strong className="text-xl font-black font-mono text-amber-700 dark:text-amber-300">
                  {formatYt(adCenter?.totalAdEarnedYt ?? 0)}
                </strong>
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">YT</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">أحداث مؤكدة ومقيدة بالدفتر</p>
            </div>
          </div>

          {/* Security Verification Notice */}
          <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              تخضع كل مكافأة إعلانية للتحقق من الخادم عبر توقيع الشبكة ومرجع الحدث الفريد دون احتساب أي نقرات متصفح.
            </span>
            <button
              type="button"
              onClick={() => void loadAdCenter()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] hover:bg-slate-50 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث الحالة</span>
            </button>
          </div>

          {/* Tracked Active Session Launch Box */}
          {activeSession && (
            <div className="rounded-2xl border border-sky-300 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/40 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-black text-sky-800 dark:text-sky-300 block">
                    جلسة إعلان جاهزة: {activeSession.displayName} (
                    {activeSession.eventType === 'click' ? 'نقرة مؤهلة' : 'مشاهدة مؤهلة'})
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                    Session ID: {activeSession.sessionId}
                  </span>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                  بانتظار تأكيد الشبكة
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                اضغط على الرابط أدناه لفتح الإعلان في صفحة الشبكة الإعلانية. لن تُضاف المكافأة لمجرد الضغط، بل فور تأكيد الإتمام من الشبكة وتسجيلها في Supabase.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <a
                  href={activeSession.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors"
                >
                  <span>فتح صفحة الإعلان الموثقة</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => void loadAdCenter()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>تحقق من وصول المكافأة</span>
                </button>
              </div>
            </div>
          )}

          {/* Available Ads / Connected Networks OR Honest Unavailable State */}
          {loading && !adCenter ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500 mx-auto" />
              <p className="text-xs font-bold text-slate-500">جاري فحص الشبكات الإعلانية المتصلة...</p>
            </div>
          ) : !adCenter?.hasConnectedNetwork || adCenter.connectedNetworks.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 sm:p-10 text-center space-y-3 shadow-sm">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                <Tv className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                الإعلانات غير متاحة حالياً
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                لا توجد حالياً أي شبكة إعلانية موثقة متصلة ومفعّلة بمفتاح تحقق خادمي صالح. حفاظاً على مصداقية أرباحك، لا نعرض إعلانات وهمية أو تجريبية على أنها مكافآت حقيقية.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  الشبكات الإعلانية المتاحة ({adCenter.connectedNetworks.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {adCenter.connectedNetworks.map((net) => {
                  const canView = net.adType === 'view' || net.adType === 'both';
                  const canClick = net.adType === 'click' || net.adType === 'both';
                  return (
                    <div
                      key={net.id}
                      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                              {net.displayName}
                            </h3>
                            <span className="text-[11px] font-mono text-slate-400">{net.networkKey}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            متصلة وموثقة
                          </span>
                        </div>

                        {net.description && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {net.description}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                          {canView && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 font-bold font-mono">
                              <Eye className="w-3.5 h-3.5" />
                              مشاهدة: +{formatYt(net.rewardViewYt)} YT
                            </span>
                          )}
                          {canClick && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold font-mono">
                              <MousePointerClick className="w-3.5 h-3.5" />
                              نقرة: +{formatYt(net.rewardClickYt)} YT
                            </span>
                          )}
                          {net.dailyUserLimit > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                              الحد اليومي: {net.dailyUserLimit}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {canView && (
                          <button
                            type="button"
                            disabled={startingKey === `${net.networkKey}:view`}
                            onClick={() => void handleStartSession(net, 'view')}
                            className="flex-1 min-w-[130px] py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {startingKey === `${net.networkKey}:view` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                            <span>مشاهدة (+{formatYt(net.rewardViewYt)} YT)</span>
                          </button>
                        )}
                        {canClick && (
                          <button
                            type="button"
                            disabled={startingKey === `${net.networkKey}:click`}
                            onClick={() => void handleStartSession(net, 'click')}
                            className="flex-1 min-w-[130px] py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {startingKey === `${net.networkKey}:click` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <MousePointerClick className="w-3.5 h-3.5" />
                            )}
                            <span>نقرة مؤهلة (+{formatYt(net.rewardClickYt)} YT)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Verified Ad Reward History */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                <span>سجل مكافآت الإعلانات الموثقة</span>
              </h2>
              <span className="text-xs font-mono text-slate-400">
                {adCenter?.recentEvents?.length ?? 0} حدث
              </span>
            </div>

            {!adCenter?.recentEvents || adCenter.recentEvents.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                لم يتم تسجيل أي مكافآت إعلانية موثقة بعد في حسابك.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {adCenter.recentEvents.map((ev) => (
                  <div key={ev.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{ev.eventType === 'click' ? 'نقرة إعلانية مؤهلة' : 'مشاهدة إعلان مؤهلة'}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {ev.networkKey}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                        المرجع: {ev.externalEventId} • {formatDateTime(ev.createdAt)}
                      </div>
                    </div>
                    <strong className="font-mono font-black text-emerald-600 dark:text-emerald-400 shrink-0" dir="ltr">
                      +{formatYt(ev.amountYt)} YT
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
