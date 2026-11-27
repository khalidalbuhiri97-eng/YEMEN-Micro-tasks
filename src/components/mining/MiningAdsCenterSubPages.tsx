import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type {
  AdCenterComfortSettings,
  AdTrackingSessionRecord,
  MiningAdPlacement,
  MiningAdTemplate,
  MiningAdTemplateType,
  PushAdPreference,
} from '../../types/index.ts';
import { formatYt, formatPartsLabel, ytToIntegerParts } from '../../../shared/ytCoin.ts';
import {
  AD_FORMAT_LABELS,
  MiningAdSlot,
  MiningAdTemplateCard,
  TEMPLATE_TYPE_LABELS,
  extractAdZoneKey,
  isDisplayBannerTemplate,
  isRewardEligibleTemplate,
  type ConnectedYtNetworkLite,
} from './MiningAdSandboxRenderer.tsx';
import { MiningAdsManager } from '../admin/MiningAdsManager.tsx';
import { AdsterraAd } from '../ads/AdsterraAd.tsx';
import {
  Award,
  Bell,
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Coins,
  ExternalLink,
  Eye,
  Film,
  Flame,
  History,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Link2,
  Loader2,
  LogIn,
  MousePointerClick,
  PlayCircle,
  RectangleHorizontal,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';

const EXOCLICK_DISPLAY_ZONE_ID = '6109072';

function ExoClickVideoPageDisplayAd() {
  useEffect(() => {
    const metaName = 'exoclick-delegate-client-hints';
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${metaName}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = metaName;
      meta.httpEquiv = 'Delegate-CH';
      meta.content =
        'Sec-CH-UA https://s.magsrv.com; Sec-CH-UA-Mobile https://s.magsrv.com; Sec-CH-UA-Arch https://s.magsrv.com; Sec-CH-UA-Model https://s.magsrv.com; Sec-CH-UA-Platform https://s.magsrv.com; Sec-CH-UA-Platform-Version https://s.magsrv.com; Sec-CH-UA-Bitness https://s.magsrv.com; Sec-CH-UA-Full-Version-List https://s.magsrv.com; Sec-CH-UA-Full-Version https://s.magsrv.com;';
      document.head.appendChild(meta);
    }

    const serveAd = () => {
      const providerWindow = window as typeof window & {
        AdProvider?: Array<{ serve: Record<string, never> }>;
      };
      providerWindow.AdProvider = providerWindow.AdProvider || [];
      providerWindow.AdProvider.push({ serve: {} });
    };

    const scriptId = 'exoclick-ad-provider-6109072';
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript?.dataset.loaded === 'true') {
      serveAd();
    } else if (existingScript) {
      existingScript.addEventListener('load', serveAd, { once: true });
    } else {
      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
      script.addEventListener(
        'load',
        () => {
          script.dataset.loaded = 'true';
          serveAd();
        },
        { once: true }
      );
      document.body.appendChild(script);
    }
  }, []);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#131822] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-white">إعلان إضافي</h3>
        <span className="text-[10px] rounded-full bg-white/10 px-2 py-1 text-gray-400">ExoClick</span>
      </div>
      <div className="min-h-[100px] flex items-center justify-center overflow-hidden">
        <ins className="eas6a97888e37" data-zoneid={EXOCLICK_DISPLAY_ZONE_ID} />
      </div>
    </section>
  );
}

export type MiningCenterSubPageId =
  | 'mining_tasks'
  | 'banner_ads'
  | 'recommendation_ads'
  | 'video_ads'
  | 'link_ads'
  | 'mixed_ads'
  | 'push_notifications'
  | 'ad_templates'
  | 'ads_history';

export const MINING_CENTER_SUBPAGES: Array<{
  id: MiningCenterSubPageId;
  label: string;
  shortLabel: string;
  subtitle: string;
}> = [
  {
    id: 'mining_tasks',
    label: 'مهمات التعدين والإعلانات',
    shortLabel: 'المهمات',
    subtitle: 'المهام اليومية والنقرات والمساحات الإعلانية المدمجة',
  },
  {
    id: 'banner_ads',
    label: 'إعلانات Banner',
    shortLabel: 'البانر',
    subtitle: 'بانرات الويب والجوال والبانر اللاصق القابل للإغلاق',
  },
  {
    id: 'recommendation_ads',
    label: 'Recommendation Widget',
    shortLabel: 'التوصيات',
    subtitle: 'بطاقات التوصيات الإعلانية والمحتوى الأصلي المدمج',
  },
  {
    id: 'video_ads',
    label: 'إعلانات الفيديو',
    shortLabel: 'الفيديو',
    subtitle: 'مشغلات In-Stream VAST وOutstream وVideo Slider والعمودي',
  },
  {
    id: 'link_ads',
    label: 'إعلانات الروابط',
    shortLabel: 'الروابط',
    subtitle: 'روابط الزيارات مع تسجيل الخروج والعودة وجلسات S2S الموثقة',
  },
  {
    id: 'mixed_ads',
    label: 'Multi Format والمختلطة',
    shortLabel: 'المختلطة',
    subtitle: 'وحدات Multi Format التكيفية والأكواد والمساحات القابلة للتوسعة',
  },
  {
    id: 'push_notifications',
    label: 'Push Notifications',
    shortLabel: 'الإشعارات',
    subtitle: 'إدارة تنبيهات العروض الاختيارية (Opt-in فقط) مع حق الإلغاء الفوري',
  },
  {
    id: 'ad_templates',
    label: 'قوالب الإعلانات',
    shortLabel: 'القوالب',
    subtitle: 'دليل الأنماط والتنسيقات المدعومة ومساحات العرض وإدارة القوالب',
  },
  {
    id: 'ads_history',
    label: 'سجل المشاهدات والمكافآت',
    shortLabel: 'السجل',
    subtitle: 'سجل جلسات التتبع الخادمية وحالة التحقق ومكافآت YT Coin المؤكدة',
  },
];

interface AdCenterPayload {
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
  connectedNetworks: ConnectedYtNetworkLite[];
  recentEvents: Array<{
    id: string;
    networkKey: string;
    externalEventId: string;
    eventType: 'click' | 'view';
    amountUnits: number;
    amountYt: number;
    verificationSource: string;
    createdAt: string;
  }>;
}

interface LocalTaskItem {
  id: number;
  title: string;
  desc: string;
  reward: number;
  status: 'ready' | 'progress' | 'claimed';
  target?: number;
}

interface MiningAdsCenterSubPagesProps {
  activeSubPage: MiningCenterSubPageId;
  onSelectSubPage: (page: MiningCenterSubPageId) => void;
  placements: MiningAdPlacement[];
  templates: MiningAdTemplate[];
  comfortSettings?: AdCenterComfortSettings;
  adsLoading: boolean;
  onRefreshAds: () => Promise<void>;
  tasks: LocalTaskItem[];
  onClaimTask: (taskId: number) => void;
  effectiveClaimReward: number;
  effectiveTapReward: number;
  effectiveAdViewReward: number;
  effectiveAdClickReward: number;
  effectiveTapsToday: number;
  onRefreshSummary?: () => Promise<void>;
  onOpenEarnAds?: () => void;
}

function formatDateTimeAr(iso: string): string {
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const TEMPLATE_FORMAT_DESCRIPTIONS: Record<MiningAdTemplateType, string> = {
  html: 'أكواد HTML مرنة للبانرات والنوافذ الترويجية داخل إطار معزول تماماً.',
  javascript: 'سكربتات شبكات الإعلانات الخارجية معزولة بدون أي صلاحية على الجلسات أو المحافظ.',
  external_link: 'روابط خارجية آمنة مع تسجيل وقت الخروج والعودة والربط بخادم S2S.',
  video_player: 'مشغل فيديو متجاوب (MP4 / YouTube / Vimeo) يبدأ بصمت وتفاعلاً بالضغط فقط.',
  vast_url: 'روابط VAST XML الاحترافية مع تتبع مراحل التشغيل والربعيات حتى الإكمال.',
  image_banner: 'صور وبانرات ثابتة للويب والجوال مع رابط توجيه عند النقر.',
  recommendation_widget: 'بطاقات وتوصيات إعلانية أصلية (Recommendation Widget) متناغمة مع التصميم.',
  network_code: 'أكواد الشبكات الإعلانية العالمية المتصلة عبر iframe أو script معزول.',
  multi_format: 'أكواد Multi Format تكيفية تختار الحجم المناسب للجهاز داخل Sandbox آمن.',
  push_notification: 'تنبيهات عروض اختيارية بالكامل بموافقة المستخدم وإمكانية الإلغاء الفوري.',
  mixed: 'وحدات هجينة تجمع صورة أو محتوى تفاعلي مع كود إعلاني وزر دعوة للإجراء.',
};

const SESSION_STATUS_LABELS: Record<AdTrackingSessionRecord['sessionStatus'], string> = {
  started: 'بدأت الجلسة',
  active: 'مشاهدة نشطة',
  left_to_external: 'انتقل للرابط الخارجي',
  returned: 'عاد من الرابط',
  completed: 'مكتملة وموثقة',
  rejected: 'مرفوضة',
  expired: 'منتهية الصلاحية',
};

export const MiningAdsCenterSubPages: React.FC<MiningAdsCenterSubPagesProps> = ({
  activeSubPage,
  onSelectSubPage,
  placements,
  templates,
  comfortSettings,
  adsLoading,
  onRefreshAds,
  tasks,
  onClaimTask,
  effectiveClaimReward,
  effectiveTapReward,
  effectiveAdViewReward,
  effectiveAdClickReward,
  effectiveTapsToday,
  onRefreshSummary,
  onOpenEarnAds,
}) => {
  const { user, isAdmin, openAuthModal, showToast } = useAuth();
  const [adCenter, setAdCenter] = useState<AdCenterPayload | null>(null);
  const [adCenterLoading, setAdCenterLoading] = useState(false);
  const [trackingHistory, setTrackingHistory] = useState<AdTrackingSessionRecord[]>([]);
  const [trackingHistoryLoading, setTrackingHistoryLoading] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    networkKey: string;
    displayName: string;
    eventType: 'click' | 'view';
    targetUrl: string;
  } | null>(null);
  const [showAdminEmbed, setShowAdminEmbed] = useState(false);

  // Push Notifications Page State (Strictly Opt-In)
  const [pushPref, setPushPref] = useState<PushAdPreference>({ optedIn: false, frequencyPerDay: 2 });
  const [pushBrowserSubscribed, setPushBrowserSubscribed] = useState(false);
  const [pushConfigured, setPushConfigured] = useState<{ checked: boolean; configured: boolean; publicKey: string | null; reason?: string }>({
    checked: false,
    configured: false,
    publicKey: null,
  });
  const [pushBusy, setPushBusy] = useState(false);

  const loadAdCenter = useCallback(async () => {
    if (!user) {
      setAdCenter(null);
      setTrackingHistory([]);
      return;
    }
    setAdCenterLoading(true);
    setTrackingHistoryLoading(true);
    try {
      const [centerRes, histRes] = await Promise.all([
        api.getYtCoinAdCenter().catch(() => null),
        api.getMyAdTrackingHistory().catch(() => null),
      ]);
      setAdCenter(centerRes?.adCenter ?? null);
      setTrackingHistory(Array.isArray(histRes?.sessions) ? histRes.sessions : []);
    } finally {
      setAdCenterLoading(false);
      setTrackingHistoryLoading(false);
    }
  }, [user]);

  const loadPushState = useCallback(async () => {
    if (!user) return;
    try {
      const [cfgRes, prefRes] = await Promise.all([
        api.getPushConfig().catch(() => ({ configured: false, publicKey: null })),
        api.getMyPushAdPreference().catch(() => ({ preference: { optedIn: false, frequencyPerDay: 2 } })),
      ]);
      setPushConfigured({
        checked: true,
        configured: Boolean(cfgRes?.configured),
        publicKey: cfgRes?.publicKey ?? null,
        reason: (cfgRes as any)?.reason,
      });
      if (prefRes?.preference) setPushPref(prefRes.preference);

      if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        const sub = reg?.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
        setPushBrowserSubscribed(Boolean(sub));
      }
    } catch {
      // ignore non-fatal errors
    }
  }, [user]);

  useEffect(() => {
    void loadAdCenter();
  }, [loadAdCenter]);

  useEffect(() => {
    if (activeSubPage === 'push_notifications' && user) {
      void loadPushState();
    }
  }, [activeSubPage, user, loadPushState]);

  const handleStartVerifiedSession = async (networkKey: string, eventType: 'view' | 'click') => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    const net = adCenter?.connectedNetworks?.find((n) => n.networkKey === networkKey);
    const key = `${networkKey}:${eventType}`;
    setStartingKey(key);
    try {
      const res = await api.createYtCoinAdSession({ networkKey, eventType });
      if (res?.session?.targetUrl) {
        setActiveSession({
          sessionId: res.session.sessionId,
          networkKey: res.session.networkKey,
          displayName: net?.displayName || networkKey,
          eventType: res.session.eventType,
          targetUrl: res.session.targetUrl,
        });
        showToast(
          'تم فتح جلسة إعلان موثقة. تُضاف مكافأة YT Coin فور تأكيد الشبكة للحدث.',
          'info'
        );
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر بدء جلسة الإعلان الموثقة.', 'error');
    } finally {
      setStartingKey(null);
    }
  };

  const handleRefreshVerification = async () => {
    await Promise.all([
      loadAdCenter(),
      onRefreshAds(),
      onRefreshSummary ? onRefreshSummary() : Promise.resolve(),
    ]);
    showToast('تم تحديث حالة المكافآت والإعلانات.', 'info');
  };

  const handleTogglePushOptIn = async (enable: boolean, frequencyPerDay = pushPref.frequencyPerDay) => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    setPushBusy(true);
    try {
      if (enable) {
        if (typeof window !== 'undefined' && 'Notification' in window && pushConfigured.configured && pushConfigured.publicKey) {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            showToast('لم يتم منح إذن الإشعارات في المتصفح.', 'error');
            return;
          }
          if ('serviceWorker' in navigator && 'PushManager' in window) {
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
              sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(pushConfigured.publicKey) as unknown as BufferSource,
              });
            }
            const jsonSub = sub.toJSON();
            if (jsonSub.endpoint && jsonSub.keys?.p256dh && jsonSub.keys?.auth) {
              await api.subscribePush({
                endpoint: jsonSub.endpoint,
                keys: { p256dh: jsonSub.keys.p256dh, auth: jsonSub.keys.auth },
              });
              setPushBrowserSubscribed(true);
            }
          }
        }
      } else if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        const sub = reg?.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
        if (sub) {
          await api.unsubscribePush(sub.endpoint).catch(() => {});
          await sub.unsubscribe().catch(() => {});
          setPushBrowserSubscribed(false);
        }
      }

      const res = await api.updateMyPushAdPreference({ optedIn: enable, frequencyPerDay });
      setPushPref(res.preference);
      showToast(
        enable
          ? 'تم تفعيل تنبيهات الإعلانات الاختيارية بنجاح ويمكنك إلغاؤها في أي لحظة.'
          : 'تم إلغاء الاشتراك في تنبيهات الإعلانات الاختيارية نهائياً.',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ تفضيلات الإشعارات في قاعدة البيانات.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const connectedNetworks = useMemo(
    () => adCenter?.connectedNetworks ?? [],
    [adCenter?.connectedNetworks]
  );

  const activeTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.isActive &&
          !(comfortSettings?.popunderAutoDisabled !== false && t.adFormat === 'popunder') &&
          (t.maxImpressions === 0 || t.impressionsCount < t.maxImpressions)
      ),
    [templates, comfortSettings]
  );

  const bannerTemplates = useMemo(() => {
    const seenZones = new Set<string>();
    return activeTemplates.filter((t) => {
      const matches = isDisplayBannerTemplate(t) || t.placementKey === 'mining_banner_gallery';
      if (!matches) return false;
      const zk = extractAdZoneKey(t);
      if (zk) {
        if (seenZones.has(zk)) return false;
        seenZones.add(zk);
      }
      return true;
    });
  }, [activeTemplates]);

  const recommendationTemplates = useMemo(
    () =>
      activeTemplates.filter(
        (t) =>
          ['recommendation_widget', 'native_cards'].includes(t.adFormat) ||
          t.templateType === 'recommendation_widget' ||
          t.placementKey === 'mining_recommendation_intro'
      ),
    [activeTemplates]
  );

  const videoTemplates = useMemo(
    () =>
      activeTemplates.filter(
        (t) =>
          t.templateType === 'video_player' ||
          t.templateType === 'vast_url' ||
          ['instream_video', 'invideo_banner', 'video_slider', 'outstream_video', 'vertical_video'].includes(
            t.adFormat
          ) ||
          ['mining_video_primary', 'mining_video_mid', 'mining_video_secondary'].includes(t.placementKey)
      ),
    [activeTemplates]
  );

  const linkTemplates = useMemo(
    () =>
      activeTemplates.filter(
        (t) =>
          t.templateType === 'external_link' ||
          t.adFormat === 'external_link' ||
          t.placementKey === 'mining_links_featured'
      ),
    [activeTemplates]
  );

  const mixedTemplates = useMemo(
    () =>
      activeTemplates.filter(
        (t) =>
          !isDisplayBannerTemplate(t) &&
          (t.templateType === 'multi_format' ||
            t.adFormat === 'multi_format' ||
            ['html', 'javascript', 'image_banner', 'network_code', 'mixed'].includes(t.templateType))
      ),
    [activeTemplates]
  );

  const customExtensiblePlacementsWithAds = useMemo(() => {
    const knownKeys = new Set([
      'mining_top_banner',
      'mining_recommendation_intro',
      'mining_arena_below',
      'mining_between_cards_strip',
      'mining_between_tasks_1',
      'mining_between_tasks_2',
      'mining_video_primary',
      'mining_video_mid',
      'mining_video_secondary',
      'mining_mobile_vertical',
      'mining_links_featured',
      'mining_banner_gallery',
      'mining_image_gallery',
      'mining_mixed_grid',
      'mining_mid_banner',
      'mining_sticky_bottom',
      'mining_bottom_banner',
    ]);
    return placements.filter(
      (p) =>
        p.isActive &&
        !knownKeys.has(p.placementKey) &&
        activeTemplates.some((t) => t.placementKey === p.placementKey)
    );
  }, [placements, activeTemplates]);

  const currentMeta =
    MINING_CENTER_SUBPAGES.find((s) => s.id === activeSubPage) || MINING_CENTER_SUBPAGES[0];

  return (
    <section className="space-y-5">
      {/* Sub-pages Header + Internal Multi-Page Switcher */}
      <div className="rounded-3xl bg-gradient-to-l from-[#182030] to-[#121722] border border-amber-500/25 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-white flex items-center gap-2">
              <Award className="w-6 h-6 text-amber-400 shrink-0" />
              <span>مركز الإعلانات ومهمات التعدين — {currentMeta.label}</span>
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">{currentMeta.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-3.5 py-2 text-center">
              <span className="text-[10px] text-gray-300 block">مكافآت الفيديو والروابط المؤكدة</span>
              <span className="text-xs sm:text-sm font-black text-amber-400 font-mono">
                +{formatYt(effectiveAdViewReward)} / +{formatYt(effectiveAdClickReward)} YT
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleRefreshVerification()}
              disabled={adsLoading || adCenterLoading}
              className="min-h-[42px] px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${adsLoading || adCenterLoading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* 9 Internal Pages Tab Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {MINING_CENTER_SUBPAGES.map((page) => {
            const active = activeSubPage === page.id;
            const badgeCount =
              page.id === 'banner_ads'
                ? bannerTemplates.length
                : page.id === 'recommendation_ads'
                  ? recommendationTemplates.length
                  : page.id === 'video_ads'
                    ? videoTemplates.length
                    : page.id === 'link_ads'
                      ? linkTemplates.length + connectedNetworks.length
                      : page.id === 'mixed_ads'
                        ? mixedTemplates.length
                        : page.id === 'ads_history'
                          ? trackingHistory.length + (adCenter?.recentEvents?.length ?? 0)
                          : null;

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => onSelectSubPage(page.id)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                  active
                    ? 'bg-amber-500 text-[#0B0E14] shadow-md shadow-amber-500/20'
                    : 'bg-[#0D1119] hover:bg-[#171E2E] text-gray-300 border border-white/10'
                }`}
              >
                {page.id === 'mining_tasks' && <Award className="w-3.5 h-3.5" />}
                {page.id === 'banner_ads' && <RectangleHorizontal className="w-3.5 h-3.5" />}
                {page.id === 'recommendation_ads' && <Sparkles className="w-3.5 h-3.5" />}
                {page.id === 'video_ads' && <Film className="w-3.5 h-3.5" />}
                {page.id === 'link_ads' && <Link2 className="w-3.5 h-3.5" />}
                {page.id === 'mixed_ads' && <Layers className="w-3.5 h-3.5" />}
                {page.id === 'push_notifications' && <Bell className="w-3.5 h-3.5" />}
                {page.id === 'ad_templates' && <Code2 className="w-3.5 h-3.5" />}
                {page.id === 'ads_history' && <History className="w-3.5 h-3.5" />}
                <span>{page.label}</span>
                {badgeCount !== null && badgeCount > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black ${
                      active ? 'bg-[#0B0E14] text-amber-400' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tracked Active Session Banner (when user launched a verified S2S ad session) */}
      {activeSession && (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-950/35 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-black text-sky-300 block">
                جلسة إعلان موثقة جاهزة: {activeSession.displayName} (
                {activeSession.eventType === 'click' ? 'نقرة مؤهلة' : 'مشاهدة مؤهلة'})
              </span>
              <span className="text-[11px] font-mono text-gray-400">
                Session ID: {activeSession.sessionId}
              </span>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              تأكيد الخادم مطلوب (S2S)
            </span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">
            افتح صفحة الإعلان وأكمل المتطلب. لا تُمنح مكافآت YT Coin من المتصفح عند الفتح، بل تقيد تلقائياً بعد تأكيد الشبكة في قاعدة البيانات.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={activeSession.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0B0E14] font-black text-xs"
            >
              <span>فتح الإعلان الموثق</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => void handleRefreshVerification()}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحقق من وصول المكافأة</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1. صفحة مهمات التعدين والإعلانات (MINING TASKS)              */}
      {/* ============================================================ */}
      {activeSubPage === 'mining_tasks' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.slice(0, 2).map((task) => {
              const pct = task.target
                ? Math.min(100, Math.round((effectiveTapsToday / task.target) * 100))
                : 100;
              return (
                <div
                  key={task.id}
                  className="rounded-2xl bg-[#131822] border border-white/10 p-4 flex items-center justify-between gap-3 hover:border-amber-500/30 transition-all"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
                      {task.id === 1 ? <Calendar className="w-5 h-5" /> : <Flame className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-white truncate">{task.title}</h4>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.desc}</p>
                      <span className="inline-block mt-1.5 text-xs font-extrabold text-amber-400 font-mono">
                        +{formatYt(task.id === 1 ? effectiveClaimReward : task.reward)} YT
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {task.status === 'claimed' ? (
                      <span className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 text-xs font-extrabold border border-emerald-500/25">
                        <Check className="w-3.5 h-3.5" /> مكتملة
                      </span>
                    ) : task.status === 'progress' ? (
                      <div className="text-left">
                        <span className="text-xs font-bold text-amber-400 block font-mono">
                          {Math.min(effectiveTapsToday, task.target ?? 100)} / {task.target}
                        </span>
                        <div className="w-20 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onClaimTask(task.id)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-white/5 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 font-black text-xs transition-all cursor-pointer"
                      >
                        تنفيذ
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <MiningAdSlot
            placementKey="mining_between_tasks_1"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.slice(2).map((task) => (
              <div
                key={task.id}
                className="rounded-2xl bg-[#131822] border border-white/10 p-4 flex items-center justify-between gap-3 hover:border-amber-500/30 transition-all"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
                    {task.id === 3 ? (
                      <PlayCircle className="w-5 h-5 text-sky-400" />
                    ) : (
                      <Wallet className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-white truncate">{task.title}</h4>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.desc}</p>
                    <span className="inline-block mt-1.5 text-xs font-extrabold text-amber-400 font-mono">
                      +{formatYt(task.id === 3 ? effectiveAdViewReward : task.reward)} YT
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {task.id === 3 ? (
                    <button
                      type="button"
                      onClick={() => onSelectSubPage('link_ads')}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 font-black text-xs transition-all cursor-pointer"
                    >
                      قسم الإعلانات
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onClaimTask(task.id)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-white/5 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 font-black text-xs transition-all cursor-pointer"
                    >
                      نسخ العنوان
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <MiningAdSlot
            placementKey="mining_between_cards_strip"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
            compact
          />
          <MiningAdSlot
            placementKey="mining_between_tasks_2"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. صفحة إعلانات Banner (عرض فقط بدون مهام أو مكافآت YT)       */}
      {/* ============================================================ */}
      {activeSubPage === 'banner_ads' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#131822] border border-white/10 px-4 py-3 text-xs text-gray-300 flex flex-wrap items-center justify-between gap-2">
            <span>
              إعلانات البانر مخصصة للعرض فقط ولا تمنح مكافآت YT Coin أو نقاط مهام. مكافآت YT Coin مخصصة لقسمي إعلانات الفيديو والروابط الموثقة.
            </span>
            <button
              type="button"
              onClick={() => onSelectSubPage('video_ads')}
              className="text-amber-400 hover:text-amber-300 font-bold shrink-0 cursor-pointer"
            >
              انتقل إلى فيديوهات المكافآت ←
            </button>
          </div>

          <MiningAdSlot
            placementKey="mining_banner_gallery"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
          />
          <AdsterraAd placementId="banner-filter-250x300" adKey="5cf71e97e1b47a9c6b2d89e879cc8c00" scriptSrc="https://bauval.org/22/5cf71e97e1b47a9c6b2d89e879cc8c00" width={250} height={300} className="mx-auto" />
          <MiningAdSlot
            placementKey="mining_mid_banner"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            compact
          />
          <MiningAdSlot
            placementKey="mining_mobile_vertical"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
          />

          {bannerTemplates.filter(
            (t) =>
              !['mining_banner_gallery', 'mining_mid_banner', 'mining_mobile_vertical'].includes(
                t.placementKey
              )
          ).length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {bannerTemplates
                .filter(
                  (t) =>
                    !['mining_banner_gallery', 'mining_mid_banner', 'mining_mobile_vertical'].includes(
                      t.placementKey
                    )
                )
                .map((tpl) => (
                  <MiningAdTemplateCard
                    key={tpl.id}
                    template={tpl}
                    connectedNetwork={null}
                  />
                ))}
            </div>
          )}

          {bannerTemplates.length === 0 && (
            <div className="rounded-3xl bg-[#131822] border border-white/10 p-10 text-center space-y-2.5">
              <RectangleHorizontal className="w-10 h-10 text-amber-400/70 mx-auto" />
              <h3 className="text-base font-black text-white">لا توجد إعلانات Banner مفعّلة حالياً</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                عند إضافة قوالب Banner أو Mobile Banner أو Sticky Banner من لوحة الإدارة، تظهر هنا كوحدات عرض مستقلة دون إزعاج ودون خلط مع المهام والمكافآت.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. صفحة Recommendation Widget                                */}
      {/* ============================================================ */}
      {activeSubPage === 'recommendation_ads' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#131822] border border-white/10 px-4 py-3 text-xs text-gray-300">
            بطاقات Recommendation Widget والتوصيات الأصلية مخصصة للعرض والتصفح فقط ولا تمنح مكافآت YT Coin (المكافآت مخصصة فقط لمهام الفيديو والروابط).
          </div>

          <MiningAdSlot
            placementKey="mining_recommendation_intro"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
          />

          {recommendationTemplates.filter((t) => t.placementKey !== 'mining_recommendation_intro').length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recommendationTemplates
                .filter((t) => t.placementKey !== 'mining_recommendation_intro')
                .map((tpl) => (
                  <MiningAdTemplateCard
                    key={tpl.id}
                    template={tpl}
                    connectedNetwork={null}
                  />
                ))}
            </div>
          )}

          {recommendationTemplates.length === 0 && (
            <div className="rounded-3xl bg-[#131822] border border-white/10 p-10 text-center space-y-2.5">
              <Sparkles className="w-10 h-10 text-amber-400/70 mx-auto" />
              <h3 className="text-base font-black text-white">لا توجد وحدات Recommendation Widget منشورة</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                تدعم هذه الصفحة بطاقات التوصيات الإعلانية الأصلية (Native Cards / Recommendation Widget) متجاوبة مع الهواتف.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. صفحة إعلانات الفيديو (VIDEO ADS & VAST)                   */}
      {/* ============================================================ */}
      {activeSubPage === 'video_ads' && (
        <div className="space-y-4">
          <ExoClickVideoPageDisplayAd />
          <AdsterraAd placementId="video-area-300x250" adKey="6e18ad3e7bb40480e41d4d20431b5bb4" scriptSrc="https://bauval.org/22/6e18ad3e7bb40480e41d4d20431b5bb4" width={300} height={250} className="mx-auto" />
          <AdsterraAd placementId="video-filter-250x300" adKey="5cf71e97e1b47a9c6b2d89e879cc8c00" scriptSrc="https://bauval.org/22/5cf71e97e1b47a9c6b2d89e879cc8c00" width={250} height={300} className="mx-auto" />
          <MiningAdSlot
            placementKey="mining_video_primary"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />
          <MiningAdSlot
            placementKey="mining_video_mid"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />
          <MiningAdSlot
            placementKey="mining_video_secondary"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />

          {videoTemplates.filter(
            (t) => !['mining_video_primary', 'mining_video_mid', 'mining_video_secondary'].includes(t.placementKey)
          ).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videoTemplates
                .filter(
                  (t) =>
                    !['mining_video_primary', 'mining_video_mid', 'mining_video_secondary'].includes(
                      t.placementKey
                    )
                )
                .map((tpl) => {
                  const rewardEligible = isRewardEligibleTemplate(tpl);
                  const net =
                    rewardEligible && tpl.ytNetworkKey
                      ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
                      : null;
                  return (
                    <MiningAdTemplateCard
                      key={tpl.id}
                      template={tpl}
                      connectedNetwork={net}
                      onStartVerifiedSession={rewardEligible ? handleStartVerifiedSession : undefined}
                      startingSessionKey={startingKey}
                    />
                  );
                })}
            </div>
          )}

          {connectedNetworks.filter((n) => n.adType === 'view' || n.adType === 'both').length > 0 && (
            <div className="rounded-3xl bg-[#131822] border border-sky-500/25 p-5 space-y-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-sky-400" />
                <span>شبكات مشاهدة الفيديو المؤهلة لمكافآت YT Coin</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {connectedNetworks
                  .filter((n) => n.adType === 'view' || n.adType === 'both')
                  .map((net) => (
                    <div
                      key={net.id}
                      className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-white truncate">{net.displayName}</div>
                        <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
                          +{formatYt(net.rewardViewYt)} YT ({formatPartsLabel(ytToIntegerParts(net.rewardViewYt))})
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={startingKey === `${net.networkKey}:view`}
                        onClick={() => void handleStartVerifiedSession(net.networkKey, 'view')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0B0E14] font-black text-xs shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        {startingKey === `${net.networkKey}:view` ? 'جاري التحضير...' : 'مشاهدة موثقة'}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {videoTemplates.length === 0 &&
            connectedNetworks.filter((n) => n.adType === 'view' || n.adType === 'both').length === 0 && (
              <div className="rounded-3xl bg-[#131822] border border-white/10 p-10 text-center space-y-2.5">
                <Film className="w-10 h-10 text-amber-400/70 mx-auto" />
                <h3 className="text-base font-black text-white">لا توجد إعلانات فيديو أو VAST مفعّلة حالياً</h3>
                <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                  عند نشر قوالب الفيديو أو روابط VAST XML من لوحة الإدارة، يتم تشغيلها بصمت افتراضياً وتتبع أحداث المشاهدة الفعلية على الخادم.
                </p>
              </div>
            )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. صفحة إعلانات الروابط (LINK ADS)                           */}
      {/* ============================================================ */}
      {activeSubPage === 'link_ads' && (
        <div className="space-y-4">
          <MiningAdSlot
            placementKey="mining_links_featured"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            connectedNetworks={connectedNetworks}
            onStartVerifiedSession={handleStartVerifiedSession}
            startingSessionKey={startingKey}
          />
          <AdsterraAd placementId="smart-links-468x60" adKey="5cf71e97e1b47a9c6b2d89e879cc8c00" scriptSrc="https://bauval.org/22/5cf71e97e1b47a9c6b2d89e879cc8c00" width={468} height={60} className="mx-auto" />

          {linkTemplates.filter((t) => t.placementKey !== 'mining_links_featured').length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {linkTemplates
                .filter((t) => t.placementKey !== 'mining_links_featured')
                .map((tpl) => {
                  const rewardEligible = isRewardEligibleTemplate(tpl);
                  const net =
                    rewardEligible && tpl.ytNetworkKey
                      ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
                      : null;
                  return (
                    <MiningAdTemplateCard
                      key={tpl.id}
                      template={tpl}
                      connectedNetwork={net}
                      onStartVerifiedSession={rewardEligible ? handleStartVerifiedSession : undefined}
                      startingSessionKey={startingKey}
                    />
                  );
                })}
            </div>
          )}

          {connectedNetworks.length > 0 && (
            <div className="rounded-3xl bg-[#131822] border border-emerald-500/25 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>روابط الشبكات الموثقة بمكافآت YT Coin ({connectedNetworks.length})</span>
                </h3>
                {onOpenEarnAds && (
                  <button
                    type="button"
                    onClick={onOpenEarnAds}
                    className="text-xs font-bold text-amber-400 hover:underline cursor-pointer"
                  >
                    عرض مركز الإعلانات الموسّع
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connectedNetworks.map((net) => {
                  const canView = net.adType === 'view' || net.adType === 'both';
                  const canClick = net.adType === 'click' || net.adType === 'both';
                  return (
                    <div
                      key={net.id}
                      className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-sm text-white">{net.displayName}</div>
                          <div className="text-[10px] font-mono text-gray-500">{net.networkKey}</div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          متصل بالخادم
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canClick && (
                          <button
                            type="button"
                            disabled={startingKey === `${net.networkKey}:click`}
                            onClick={() => void handleStartVerifiedSession(net.networkKey, 'click')}
                            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <MousePointerClick className="w-3.5 h-3.5" />
                            <span>نقرة مؤهلة (+{formatYt(net.rewardClickYt)} YT)</span>
                          </button>
                        )}
                        {canView && (
                          <button
                            type="button"
                            disabled={startingKey === `${net.networkKey}:view`}
                            onClick={() => void handleStartVerifiedSession(net.networkKey, 'view')}
                            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/35 text-sky-300 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>مشاهدة (+{formatYt(net.rewardViewYt)} YT)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {linkTemplates.length === 0 && connectedNetworks.length === 0 && (
            <div className="rounded-3xl bg-[#131822] border border-white/10 p-10 text-center space-y-2.5">
              <Link2 className="w-10 h-10 text-amber-400/70 mx-auto" />
              <h3 className="text-base font-black text-white">لا توجد إعلانات روابط نشطة حالياً</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                عند نشر إعلانات روابط أو تفعيل شبكات S2S موثقة من لوحة الإدارة، ستتاح هنا مع تسجيل دقيق لوقت الخروج والعودة.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 6. صفحة الإعلانات المختلطة (MIXED & MULTI FORMAT)           */}
      {/* ============================================================ */}
      {activeSubPage === 'mixed_ads' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#131822] border border-white/10 px-4 py-3 text-xs text-gray-300">
            مساحات الصور والبانرات ووحدات Multi Format للعرض الترويجي فقط؛ مكافآت YT Coin تقتصر على مهام الفيديو والروابط الموثقة.
          </div>

          <MiningAdSlot
            placementKey="mining_image_gallery"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
          />
          <MiningAdSlot
            placementKey="mining_mixed_grid"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
          />
          {customExtensiblePlacementsWithAds.map((plc) => (
            <MiningAdSlot
              key={plc.id}
              placementKey={plc.placementKey}
              placements={placements}
              templates={templates}
              comfortSettings={comfortSettings}
              connectedNetworks={connectedNetworks}
              onStartVerifiedSession={handleStartVerifiedSession}
              startingSessionKey={startingKey}
            />
          ))}
          <MiningAdSlot
            placementKey="mining_bottom_banner"
            placements={placements}
            templates={templates}
            comfortSettings={comfortSettings}
            compact
          />

          {mixedTemplates.length === 0 && (
            <div className="rounded-3xl bg-[#131822] border border-white/10 p-10 text-center space-y-2.5">
              <ImageIcon className="w-10 h-10 text-amber-400/70 mx-auto" />
              <h3 className="text-base font-black text-white">لا توجد إعلانات مختلطة أو Multi Format منشورة حالياً</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                تظهر هنا وحدات Multi Format والشبكات المعزولة والمساحات الإضافية القابلة للتوسعة التي تضيفها الإدارة.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 7. صفحة Push Notifications (OPT-IN ONLY)                    */}
      {/* ============================================================ */}
      {activeSubPage === 'push_notifications' && (
        <div className="space-y-4">
          {!user ? (
            <div className="rounded-3xl bg-[#131822] border border-amber-500/25 p-8 text-center space-y-3">
              <LogIn className="w-10 h-10 text-amber-400 mx-auto" />
              <h3 className="text-base font-black text-white">سجّل دخولك للتحكم في إشعارات العروض الاختيارية</h3>
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="min-h-[42px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer"
              >
                تسجيل الدخول
              </button>
            </div>
          ) : (
            <div className="rounded-3xl bg-[#131822] border border-amber-500/25 p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-amber-400" />
                    <span>تنبيهات العروض الإعلانية (Push Notifications — اختياري بالكامل)</span>
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    لا يتم تفعيل هذه التنبيهات أبداً بدون موافقتك الصريحة، ويمكنك إلغاء الاشتراك بضغطة واحدة في أي وقت.
                  </p>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-black border ${
                    pushPref.optedIn
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-white/5 text-gray-400 border-white/10'
                  }`}
                >
                  {pushPref.optedIn ? 'مشترك باختيارك' : 'غير مشترك'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-1.5">
                  <span className="text-gray-400 block">حالة ربط المتصفح (VAPID Web Push)</span>
                  <strong className={pushBrowserSubscribed ? 'text-emerald-400' : 'text-amber-300'}>
                    {pushConfigured.checked && !pushConfigured.configured
                      ? 'بانتظار ضبط مفاتيح VAPID على الخادم'
                      : pushBrowserSubscribed
                        ? 'الجهاز مسجل لاستلام الإشعارات'
                        : 'غير مسجل حالياً على هذا المتصفح'}
                  </strong>
                </div>

                <div className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-2">
                  <label className="text-gray-400 block">الحد الأقصى لتنبيهات العروض يومياً</label>
                  <select
                    value={String(pushPref.frequencyPerDay)}
                    disabled={pushBusy}
                    onChange={(e) => void handleTogglePushOptIn(pushPref.optedIn, Number(e.target.value))}
                    className="w-full rounded-xl bg-[#131822] border border-white/15 px-3 py-2 text-xs text-white font-bold"
                  >
                    <option value="1">1 إشعار كحد أقصى يومياً</option>
                    <option value="2">2 إشعارات كحد أقصى يومياً</option>
                    <option value="3">3 إشعارات كحد أقصى يومياً</option>
                    <option value="5">5 إشعارات كحد أقصى يومياً</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {!pushPref.optedIn ? (
                  <button
                    type="button"
                    disabled={pushBusy || comfortSettings?.pushAdsEnabled === false}
                    onClick={() => void handleTogglePushOptIn(true)}
                    className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer disabled:opacity-50"
                  >
                    {pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    <span>أوافق على استلام إشعارات العروض</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void handleTogglePushOptIn(false)}
                    className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-black text-xs cursor-pointer disabled:opacity-50"
                  >
                    {pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
                    <span>إلغاء الاشتراك في تنبيهات الإعلانات</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 8. صفحة قوالب الإعلانات (AD TEMPLATES DIRECTORY)              */}
      {/* ============================================================ */}
      {activeSubPage === 'ad_templates' && (
        <div className="space-y-5">
          {isAdmin && (
            <div className="rounded-3xl bg-[#131822] border border-amber-500/30 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm sm:text-base font-black text-amber-400 flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  <span>إدارة القوالب والشروط والتقارير (صلاحية الإدارة)</span>
                </h3>
                <p className="text-xs text-gray-400">
                  إدارة جميع أنواع الإعلانات وشروط التحقق وإعدادات الراحة وعرض تقارير التتبع الفعلية من قاعدة البيانات.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminEmbed((prev) => !prev)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer"
              >
                {showAdminEmbed ? 'إخفاء لوحة التحكم' : 'فتح لوحة إدارة الإعلانات والتتبع'}
              </button>
            </div>
          )}

          {isAdmin && showAdminEmbed && (
            <MiningAdsManager surfaceVariant="obsidian" onChanged={() => void onRefreshAds()} />
          )}

          <div className="rounded-3xl bg-[#131822] border border-white/10 p-5 space-y-4">
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <Code2 className="w-5 h-5 text-amber-400" />
              <span>أنماط القوالب والوحدات المدعومة (معزولة عبر Sandbox)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(Object.keys(TEMPLATE_TYPE_LABELS) as MiningAdTemplateType[]).map((typeKey) => {
                const count = activeTemplates.filter((t) => t.templateType === typeKey).length;
                return (
                  <div
                    key={typeKey}
                    className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-xs font-black text-amber-300">
                        {TEMPLATE_TYPE_LABELS[typeKey]}
                      </strong>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-300">
                        نشط: {count}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      {TEMPLATE_FORMAT_DESCRIPTIONS[typeKey]}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl bg-[#131822] border border-white/10 p-5 space-y-3">
            <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-sky-400" />
              <span>المساحات الإعلانية المفعّلة ({placements.filter((p) => p.isActive).length})</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {placements
                .filter((p) => p.isActive)
                .map((p) => {
                  const activeCount = activeTemplates.filter((t) => t.placementKey === p.placementKey).length;
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl bg-[#0B0E14] border border-white/10 p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate">{p.titleAr}</div>
                        <div className="text-[11px] text-gray-400 truncate mt-0.5">
                          {p.descriptionAr || p.placementKey}
                        </div>
                      </div>
                      <div className="text-left shrink-0 font-mono text-[10px]">
                        <span className="block text-amber-400 font-bold">
                          {p.defaultWidth}×{p.defaultHeight}
                        </span>
                        <span className={activeCount > 0 ? 'text-emerald-400' : 'text-gray-500'}>
                          {activeCount > 0 ? `${activeCount} إعلان` : 'مخفية حتى التفعيل'}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 9. صفحة سجل المشاهدات والمكافآت (ADS HISTORY & TELEMETRY)    */}
      {/* ============================================================ */}
      {activeSubPage === 'ads_history' && (
        <div className="space-y-4">
          {!user ? (
            <div className="rounded-3xl bg-[#131822] border border-amber-500/25 p-8 text-center space-y-3">
              <LogIn className="w-10 h-10 text-amber-400 mx-auto" />
              <h3 className="text-base font-black text-white">سجّل دخولك لعرض سجل المشاهدات ومكافآت الإعلانات</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                يتم حفظ سجل جلسات التتبع والمدة النشطة ومكافآت الإعلانات المؤكدة المرتبطة بحسابك في Supabase بدقة.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="min-h-[42px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer"
              >
                تسجيل الدخول
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                  <span className="text-[11px] text-gray-400 block">إعلانات YT المؤكدة اليوم</span>
                  <strong className="text-lg font-black text-amber-400 font-mono mt-1 block">
                    {adCenter?.adsToday ?? 0} / {adCenter?.dailyAdLimit ?? 20}
                  </strong>
                </div>
                <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                  <span className="text-[11px] text-gray-400 block">أرباح الإعلانات (YT)</span>
                  <strong className="text-lg font-black text-emerald-400 font-mono mt-1 block">
                    +{formatYt(adCenter?.totalAdEarnedYt ?? 0)} YT
                  </strong>
                </div>
                <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                  <span className="text-[11px] text-gray-400 block">جلسات التتبع المكتملة</span>
                  <strong className="text-lg font-black text-sky-400 font-mono mt-1 block">
                    {trackingHistory.filter((s) => s.sessionStatus === 'completed').length}
                  </strong>
                </div>
                <div className="rounded-2xl bg-[#131822] border border-white/10 p-4">
                  <span className="text-[11px] text-gray-400 block">جلسات مرفوضة / منتهية</span>
                  <strong className="text-lg font-black text-rose-400 font-mono mt-1 block">
                    {trackingHistory.filter((s) => s.sessionStatus === 'rejected' || s.sessionStatus === 'expired').length}
                  </strong>
                </div>
              </div>

              {/* Tracking Sessions History Table */}
              <div className="rounded-3xl bg-[#131822] border border-white/10 p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span>سجل جلسات التتبع والتحقق الخادمي ({trackingHistory.length})</span>
                  </h3>
                  {trackingHistoryLoading && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
                </div>

                {trackingHistory.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center">
                    لا توجد جلسات تتبع مسجلة بعد لهذا الحساب.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {trackingHistory.map((sess) => {
                      const isOk = sess.sessionStatus === 'completed';
                      const isFail = sess.sessionStatus === 'rejected' || sess.sessionStatus === 'expired';
                      return (
                        <div
                          key={sess.id}
                          className="rounded-2xl bg-[#0B0E14] border border-white/10 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2 font-bold text-white">
                              {isOk ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : isFail ? (
                                <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              ) : (
                                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              )}
                              <span>{AD_FORMAT_LABELS[sess.adFormat as keyof typeof AD_FORMAT_LABELS] || sess.adFormat}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-300">
                                {SESSION_STATUS_LABELS[sess.sessionStatus]}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span>المدة النشطة: {Math.floor(sess.activeDurationSec)} / {sess.requiredWatchSec}ث</span>
                              <span>• {formatDateTimeAr(sess.createdAt)}</span>
                              {sess.rejectionReason && (
                                <span className="text-rose-400">• {sess.rejectionReason}</span>
                              )}
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                              sess.eligibilityResult === 'credited'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : sess.eligibilityResult === 'eligible_for_yt_reward'
                                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                  : isFail
                                    ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                    : 'bg-white/5 text-gray-300'
                            }`}
                          >
                            {sess.eligibilityResult === 'credited'
                              ? 'تم إضافة YT عبر S2S'
                              : sess.eligibilityResult === 'eligible_for_yt_reward'
                                ? 'مؤهل بانتظار S2S'
                                : sess.eligibilityResult === 'eligible_tracking_only'
                                  ? 'مشاهدة مكتملة (تتبع)'
                                  : isFail
                                    ? 'غير مؤهل'
                                    : 'قيد التحقق'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* YT Coin Verified S2S Rewards History */}
              <div className="rounded-3xl bg-[#131822] border border-white/10 p-5 space-y-3">
                <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span>سجل مكافآت الإعلانات المؤكدة (YT Coin S2S)</span>
                </h3>

                {!adCenter?.recentEvents || adCenter.recentEvents.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center">
                    لا توجد مكافآت S2S مقيدة في دفتر YT Coin بعد.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {adCenter.recentEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-2xl bg-[#0B0E14] border border-white/10 p-3.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-bold text-xs text-white flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>
                              {ev.eventType === 'click' ? 'نقرة إعلانية مؤكدة' : 'مشاهدة إعلانية مؤكدة'} — {ev.networkKey}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-gray-500 block mt-0.5">
                            {formatDateTimeAr(ev.createdAt)} · {ev.verificationSource}
                          </span>
                        </div>
                        <div className="text-left font-mono">
                          <span className="text-xs font-black text-emerald-400 block" dir="ltr">
                            +{formatYt(ev.amountYt)} YT
                          </span>
                          <span className="text-[10px] text-amber-300">
                            {formatPartsLabel(ytToIntegerParts(ev.amountYt))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
};
