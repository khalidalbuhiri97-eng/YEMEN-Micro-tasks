import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type {
  AdCenterComfortSettings,
  AdCompletionRule,
  AdTrackingRiskFlag,
  AdVerificationMode,
  AdminAdTrackingReport,
  MiningAdDeviceTarget,
  MiningAdFormat,
  MiningAdPageScope,
  MiningAdPlacement,
  MiningAdSlotType,
  MiningAdTemplate,
  MiningAdTemplateType,
} from '../../types/index.ts';
import {
  AD_FORMAT_LABELS,
  DISPLAY_BANNER_FORMATS,
  MiningAdTemplateCard,
  REWARD_ELIGIBLE_AD_FORMATS,
  TEMPLATE_TYPE_LABELS,
  extractAdZoneKey,
  isDisplayBannerTemplate,
  isRewardEligibleTemplate,
} from '../mining/MiningAdSandboxRenderer.tsx';
import {
  Plus,
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Code2,
  RefreshCw,
  AlertCircle,
  X,
  Database,
  Layers,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  Loader2,
  CheckCircle2,
  Sparkles,
  Sliders,
  BarChart3,
  ShieldAlert,
  Activity,
  Save,
  Filter,
} from 'lucide-react';

const PAGE_SCOPE_LABELS: Record<MiningAdPageScope, string> = {
  all: 'جميع صفحات مركز التعدين',
  mining_home: 'الرئيسية (منجم التعدين)',
  mining_tasks: 'صفحة مهمات التعدين والإعلانات',
  banner_ads: 'صفحة إعلانات Banner',
  recommendation_ads: 'صفحة Recommendation Widget',
  video_ads: 'صفحة إعلانات الفيديو',
  link_ads: 'صفحة إعلانات الروابط',
  mixed_ads: 'صفحة Multi Format والمختلطة',
  push_notifications: 'صفحة Push Notifications',
  ad_templates: 'صفحة قوالب الإعلانات',
  ads_history: 'صفحة سجل المشاهدات والمكافآت',
};

const SLOT_TYPE_LABELS: Record<MiningAdSlotType, string> = {
  banner: 'بانر إعلاني',
  between_tasks: 'نافذة بين المهمات',
  horizontal_strip: 'شريط أفقي بين البطاقات',
  video: 'مساحة فيديو',
  image: 'مساحة مصوّرة',
  link: 'مساحة روابط',
  mixed: 'مساحة مختلطة / Multi Format',
  recommendation: 'وحدة توصيات (Recommendation Widget)',
  sticky: 'بانر لاصق (Sticky)',
  native: 'بطاقات أصلية (Native)',
  push: 'إشعارات اختيارية (Push)',
  popunder: 'Popunder (معطّل للراحة)',
  extensible: 'وحدة قابلة للتوسعة',
};

const DEVICE_TARGET_LABELS: Record<MiningAdDeviceTarget, string> = {
  all: 'الكل (ويب + جوال)',
  desktop: 'سطح المكتب فقط',
  mobile: 'الهواتف فقط',
};

const VERIFICATION_MODE_LABELS: Record<AdVerificationMode, string> = {
  dwell: 'تتبع البقاء النشط (Dwell Timer)',
  vast: 'مراحل فيديو VAST XML',
  link_return: 'خروج للرابط وعودة مؤكدة (Link Return)',
  s2s_postback: 'تأكيد خادم الشبكة (S2S Postback)',
  impression_only: 'ظهور فقط بدون إكمال زمني',
};

const RISK_FLAG_LABELS: Record<AdTrackingRiskFlag['flagType'], string> = {
  premature_complete: 'محاولة إكمال مبكرة قبل المدة',
  visibility_bypass: 'إخفاء التبويب ومحاولة احتساب الوقت',
  duplicate_complete: 'محاولة إكمال مكررة',
  forged_template_id: 'معرّف إعلان مزوّر أو غير نشط',
  rate_limit_exceeded: 'تجاوز حد الطلبات (Rate Limit)',
  expired_session: 'جلسة تتبع منتهية الصلاحية',
  invalid_vast_sequence: 'تسلسل VAST غير سليم',
  duplicate_postback: 'تكرار إشعار Postback (Replay)',
  velocity_anomaly: 'شذوذ سرعة الطلبات',
};

const DEFAULT_COMFORT_FORM: AdCenterComfortSettings = {
  popunderAutoDisabled: true,
  maxStickyAds: 1,
  maxAnimatedAdsInView: 1,
  cooldownAfterDismissSec: 120,
  minSpacingPx: 16,
  pushAdsEnabled: true,
  defaultSessionTtlSec: 900,
  defaultMaxDailyPerUser: 25,
  trackingEnabledByFormat: (Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).reduce<Record<string, boolean>>(
    (acc, fmt) => {
      acc[fmt] = fmt !== 'popunder';
      return acc;
    },
    {}
  ),
};

const VAST_REQUIRED_OPTIONS = ['impression', 'start', 'firstQuartile', 'midpoint', 'thirdQuartile', 'complete'];

interface TemplateFormState {
  title: string;
  placementKey: string;
  templateType: MiningAdTemplateType;
  adFormat: MiningAdFormat;
  deviceTarget: MiningAdDeviceTarget;
  sourceName: string;
  codeContent: string;
  targetUrl: string;
  mediaUrl: string;
  vastUrl: string;
  ctaLabel: string;
  width: string;
  height: string;
  priority: string;
  sortOrder: string;
  maxImpressions: string;
  ytNetworkKey: string;
  rewardEventType: 'view' | 'click';
  isDismissible: boolean;
  trackingEnabled: boolean;
  isActive: boolean;
  // Completion Rule fields
  verificationMode: AdVerificationMode;
  requiredWatchSec: string;
  requireActiveVisibility: boolean;
  requiredVastEvents: string[];
  requireLinkReturn: boolean;
  requireServerPostback: boolean;
  sessionTtlSec: string;
  maxDailyPerUser: string;
  frequencyCapMinutes: string;
}

interface PlacementFormState {
  id?: string;
  placementKey: string;
  titleAr: string;
  descriptionAr: string;
  pageScope: MiningAdPageScope;
  slotType: MiningAdSlotType;
  defaultWidth: string;
  defaultHeight: string;
  maxAds: string;
  sortOrder: string;
  isActive: boolean;
  isSystem?: boolean;
}

const EXOCLICK_BANNER_CODE = `<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
<ins class="eas6a97888e2" data-zoneid="6104102"></ins>
<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>`;

const EXOCLICK_VIDEO_VAST_URL = 'https://s.magsrv.com/v1/vast.php?idz=6104150';

function defaultVerificationForFormat(adFormat: MiningAdFormat): AdVerificationMode {
  if (['instream_video', 'invideo_banner', 'video_slider', 'outstream_video', 'vertical_video'].includes(adFormat)) {
    return 'vast';
  }
  if (adFormat === 'external_link') return 'link_return';
  return 'dwell';
}

function defaultFormatForTemplateType(tplType: MiningAdTemplateType): MiningAdFormat {
  switch (tplType) {
    case 'vast_url':
      return 'instream_video';
    case 'video_player':
      return 'outstream_video';
    case 'external_link':
      return 'external_link';
    case 'recommendation_widget':
      return 'recommendation_widget';
    case 'multi_format':
      return 'multi_format';
    case 'push_notification':
      return 'push_notification';
    case 'image_banner':
      return 'banner';
    default:
      return 'banner';
  }
}

const DEFAULT_TEMPLATE_FORM: TemplateFormState = {
  title: '',
  placementKey: 'mining_top_banner',
  templateType: 'html',
  adFormat: 'banner',
  deviceTarget: 'all',
  sourceName: '',
  codeContent: '',
  targetUrl: '',
  mediaUrl: '',
  vastUrl: '',
  ctaLabel: '',
  width: '728',
  height: '90',
  priority: '10',
  sortOrder: '10',
  maxImpressions: '0',
  ytNetworkKey: '',
  rewardEventType: 'view',
  isDismissible: true,
  trackingEnabled: true,
  isActive: true,
  verificationMode: 'dwell',
  requiredWatchSec: '30',
  requireActiveVisibility: true,
  requiredVastEvents: ['start', 'complete'],
  requireLinkReturn: false,
  requireServerPostback: false,
  sessionTtlSec: '900',
  maxDailyPerUser: '25',
  frequencyCapMinutes: '0',
};

const DEFAULT_PLACEMENT_FORM: PlacementFormState = {
  placementKey: '',
  titleAr: '',
  descriptionAr: '',
  pageScope: 'all',
  slotType: 'extensible',
  defaultWidth: '320',
  defaultHeight: '250',
  maxAds: '3',
  sortOrder: '150',
  isActive: true,
};

interface MiningAdsManagerProps {
  surfaceVariant?: 'standard' | 'obsidian';
  onChanged?: () => void;
}

export const MiningAdsManager: React.FC<MiningAdsManagerProps> = ({
  surfaceVariant = 'standard',
  onChanged,
}) => {
  const { showToast, openConfirmModal } = useAuth();
  const isObsidian = surfaceVariant === 'obsidian';

  const [subTab, setSubTab] = useState<'templates' | 'placements' | 'tracking_comfort' | 'reports'>('templates');
  const [placements, setPlacements] = useState<MiningAdPlacement[]>([]);
  const [templates, setTemplates] = useState<MiningAdTemplate[]>([]);
  const [completionRules, setCompletionRules] = useState<AdCompletionRule[]>([]);
  const [comfortForm, setComfortForm] = useState<AdCenterComfortSettings>(DEFAULT_COMFORT_FORM);
  const [ytNetworks, setYtNetworks] = useState<Array<{ network_key: string; display_name: string; is_active: boolean }>>([]);
  const [storageMode, setStorageMode] = useState<'supabase' | 'unmigrated'>('supabase');
  const [isLoading, setIsLoading] = useState(true);
  const [filterPlacement, setFilterPlacement] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterFormat, setFilterFormat] = useState<string>('all');

  // Comfort Settings & Format Default Rules Save States
  const [savingComfort, setSavingComfort] = useState(false);
  const [selectedRuleFormat, setSelectedRuleFormat] = useState<MiningAdFormat>('banner');
  const [formatRuleDraft, setFormatRuleDraft] = useState<AdCompletionRule>({
    adFormat: 'banner',
    trackingEnabled: true,
    verificationMode: 'dwell',
    requiredWatchSec: 15,
    requireActiveVisibility: true,
    requiredVastEvents: ['start', 'complete'],
    requireLinkReturn: false,
    requireServerPostback: false,
    sessionTtlSec: 900,
    maxDailyPerUser: 25,
    frequencyCapMinutes: 0,
  });
  const [savingFormatRule, setSavingFormatRule] = useState(false);

  // Reports State
  const [reportFilters, setReportFilters] = useState({
    dateFrom: '',
    dateTo: '',
    networkKey: '',
    adFormat: '',
    userId: '',
  });
  const [reportData, setReportData] = useState<AdminAdTrackingReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Template Modal State
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<MiningAdTemplate | null>(null);
  const [tplForm, setTplForm] = useState<TemplateFormState>(DEFAULT_TEMPLATE_FORM);
  const [tplError, setTplError] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const [showInlinePreview, setShowInlinePreview] = useState(false);

  // Placement Modal State
  const [plcModalOpen, setPlcModalOpen] = useState(false);
  const [plcForm, setPlcForm] = useState<PlacementFormState>(DEFAULT_PLACEMENT_FORM);
  const [plcError, setPlcError] = useState('');
  const [savingPlc, setSavingPlc] = useState(false);

  // Standalone Preview Modal
  const [previewTemplate, setPreviewTemplate] = useState<MiningAdTemplate | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [adsRes, ytRes] = await Promise.all([
        api.getAdminMiningAds(),
        api.getAdminYtCoinSummary().catch(() => null),
      ]);
      setPlacements(Array.isArray(adsRes?.placements) ? adsRes.placements : []);
      setTemplates(Array.isArray(adsRes?.templates) ? adsRes.templates : []);
      setCompletionRules(Array.isArray(adsRes?.completionRules) ? adsRes.completionRules : []);
      if (adsRes?.comfortSettings) {
        setComfortForm({
          ...DEFAULT_COMFORT_FORM,
          ...adsRes.comfortSettings,
          trackingEnabledByFormat: {
            ...DEFAULT_COMFORT_FORM.trackingEnabledByFormat,
            ...(adsRes.comfortSettings.trackingEnabledByFormat || {}),
          },
        });
      }
      if (adsRes?.storageMode === 'unmigrated' || adsRes?.storageMode === 'supabase') {
        setStorageMode(adsRes.storageMode);
      }
      if (Array.isArray(ytRes?.summary?.ad_networks)) {
        setYtNetworks(ytRes.summary.ad_networks);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل إدارة إعلانات مركز التعدين.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const loadReports = useCallback(
    async (customFilters = reportFilters) => {
      setLoadingReport(true);
      setReportError(null);
      try {
        const res = await api.getAdminAdTrackingReports({
          ...(customFilters.dateFrom ? { dateFrom: customFilters.dateFrom } : {}),
          ...(customFilters.dateTo ? { dateTo: customFilters.dateTo } : {}),
          ...(customFilters.networkKey.trim() ? { networkKey: customFilters.networkKey.trim() } : {}),
          ...(customFilters.adFormat ? { adFormat: customFilters.adFormat } : {}),
          ...(customFilters.userId.trim() ? { userId: customFilters.userId.trim() } : {}),
        });
        setReportData(res);
      } catch (err: any) {
        setReportError(err?.message || 'تعذر تحميل تقارير التتبع.');
      } finally {
        setLoadingReport(false);
      }
    },
    [reportFilters]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (subTab === 'reports' && !reportData && !loadingReport) {
      void loadReports();
    }
  }, [subTab, reportData, loadingReport, loadReports]);

  // Keep Format Default Rule draft synced when selecting a format or reloading rules
  useEffect(() => {
    const existing = completionRules.find((r) => !r.templateId && r.adFormat === selectedRuleFormat);
    if (existing) {
      setFormatRuleDraft({ ...existing, adFormat: selectedRuleFormat });
    } else {
      const mode = defaultVerificationForFormat(selectedRuleFormat);
      setFormatRuleDraft({
        adFormat: selectedRuleFormat,
        trackingEnabled: comfortForm.trackingEnabledByFormat[selectedRuleFormat] !== false,
        verificationMode: mode,
        requiredWatchSec: mode === 'vast' ? 15 : mode === 'link_return' ? 10 : 15,
        requireActiveVisibility: true,
        requiredVastEvents: ['start', 'complete'],
        requireLinkReturn: mode === 'link_return',
        requireServerPostback: false,
        sessionTtlSec: comfortForm.defaultSessionTtlSec || 900,
        maxDailyPerUser: comfortForm.defaultMaxDailyPerUser || 25,
        frequencyCapMinutes: 0,
      });
    }
  }, [selectedRuleFormat, completionRules, comfortForm]);

  const placementMap = useMemo(() => {
    const map = new Map<string, MiningAdPlacement>();
    placements.forEach((p) => map.set(p.placementKey, p));
    return map;
  }, [placements]);

  const filteredTemplates = useMemo(() => {
    return templates
      .filter((t) => filterPlacement === 'all' || t.placementKey === filterPlacement)
      .filter((t) => filterType === 'all' || t.templateType === filterType)
      .filter((t) => filterFormat === 'all' || t.adFormat === filterFormat)
      .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority);
  }, [templates, filterPlacement, filterType, filterFormat]);

  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => a.sortOrder - b.sortOrder),
    [placements]
  );

  const cardSurface = isObsidian
    ? 'bg-[#131822] border border-amber-500/20 text-gray-100'
    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white shadow-sm';
  const subSurface = isObsidian
    ? 'bg-[#0B0E14] border border-white/10'
    : 'bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700';
  const inputSurface = isObsidian
    ? 'bg-[#0B0E14] border border-white/15 text-white focus:border-amber-400'
    : 'bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:border-emerald-500';
  const mutedText = isObsidian ? 'text-gray-400' : 'text-slate-500 dark:text-slate-400';

  const openCreateTemplate = (preselectedPlacementKey?: string) => {
    const targetPlc =
      (preselectedPlacementKey && placementMap.get(preselectedPlacementKey)) ||
      sortedPlacements[0] ||
      null;
    setEditingTpl(null);
    setTplForm({
      ...DEFAULT_TEMPLATE_FORM,
      placementKey: targetPlc?.placementKey || 'mining_top_banner',
      width: String(targetPlc?.defaultWidth || 728),
      height: String(targetPlc?.defaultHeight || 90),
    });
    setTplError('');
    setShowInlinePreview(false);
    setTplModalOpen(true);
  };

  const openEditTemplate = (tpl: MiningAdTemplate) => {
    setEditingTpl(tpl);
    const cr = tpl.completionRule;
    const isBanner = isDisplayBannerTemplate(tpl);
    const isRewardEligible = isRewardEligibleTemplate(tpl);
    const rawMode = cr?.verificationMode || defaultVerificationForFormat(tpl.adFormat || 'banner');
    setTplForm({
      title: tpl.title,
      placementKey: tpl.placementKey,
      templateType: tpl.templateType,
      adFormat: tpl.adFormat || defaultFormatForTemplateType(tpl.templateType),
      deviceTarget: tpl.deviceTarget || 'all',
      sourceName: tpl.sourceName || '',
      codeContent: tpl.codeContent || '',
      targetUrl: tpl.targetUrl || '',
      mediaUrl: tpl.mediaUrl || '',
      vastUrl: tpl.vastUrl || '',
      ctaLabel: tpl.ctaLabel || '',
      width: String(tpl.width || 320),
      height: String(tpl.height || 250),
      priority: String(tpl.priority ?? 10),
      sortOrder: String(tpl.sortOrder ?? 10),
      maxImpressions: String(tpl.maxImpressions ?? 0),
      ytNetworkKey: isRewardEligible ? tpl.ytNetworkKey || '' : '',
      rewardEventType: tpl.rewardEventType === 'click' ? 'click' : 'view',
      isDismissible: tpl.isDismissible !== false,
      trackingEnabled: tpl.trackingEnabled !== false,
      isActive: tpl.isActive,
      verificationMode: !isRewardEligible && rawMode === 's2s_postback' ? 'dwell' : rawMode,
      requiredWatchSec: String(cr?.requiredWatchSec ?? (isBanner ? 30 : 15)),
      requireActiveVisibility: cr?.requireActiveVisibility !== false,
      requiredVastEvents:
        Array.isArray(cr?.requiredVastEvents) && cr.requiredVastEvents.length > 0
          ? cr.requiredVastEvents
          : isBanner
            ? []
            : ['start', 'complete'],
      requireLinkReturn: isBanner ? false : Boolean(cr?.requireLinkReturn),
      requireServerPostback: isRewardEligible ? Boolean(cr?.requireServerPostback) : false,
      sessionTtlSec: String(cr?.sessionTtlSec ?? 900),
      maxDailyPerUser: String(cr?.maxDailyPerUser ?? 25),
      frequencyCapMinutes: String(cr?.frequencyCapMinutes ?? (isBanner ? 5 : 0)),
    });
    setTplError('');
    setShowInlinePreview(false);
    setTplModalOpen(true);
  };

  const openExoClickPreset = () => {
    const existing = templates.find(
      (t) => extractAdZoneKey(t) === 'exoclick:zone:6104102' || t.title.trim() === 'YemenTask_Website_Banner'
    );
    if (existing) {
      openEditTemplate(existing);
      showToast('قالب ExoClick (Zone 6104102) مضاف مسبقاً — تم فتحه للتعديل دون تكرار.', 'info');
      return;
    }
    const targetPlc =
      placementMap.get('mining_banner_gallery') ||
      placementMap.get('mining_mid_banner') ||
      sortedPlacements[0] ||
      null;
    setEditingTpl(null);
    setTplForm({
      ...DEFAULT_TEMPLATE_FORM,
      title: 'YemenTask_Website_Banner',
      sourceName: 'ExoClick',
      placementKey: targetPlc?.placementKey || 'mining_banner_gallery',
      templateType: 'network_code',
      adFormat: 'banner',
      deviceTarget: 'all',
      codeContent: EXOCLICK_BANNER_CODE,
      width: '300',
      height: '250',
      priority: '20',
      sortOrder: '10',
      maxImpressions: '0',
      ytNetworkKey: '',
      rewardEventType: 'view',
      isDismissible: true,
      trackingEnabled: true,
      isActive: true,
      verificationMode: 'dwell',
      requiredWatchSec: '30',
      requireActiveVisibility: true,
      requiredVastEvents: [],
      requireLinkReturn: false,
      requireServerPostback: false,
      maxDailyPerUser: '25',
      frequencyCapMinutes: '5',
    });
    setTplError('');
    setShowInlinePreview(false);
    setTplModalOpen(true);
  };

  const openExoClickVideoPreset = () => {
    const existing = templates.find(
      (t) =>
        (t.vastUrl || '').includes('6104150') ||
        t.title.trim() === 'YemenTask_Video_VAST_6104150'
    );
    if (existing) {
      openEditTemplate(existing);
      showToast('قالب فيديو ExoClick VAST (Zone 6104150) مضاف مسبقاً — تم فتحه للتعديل.', 'info');
      return;
    }
    const targetPlc =
      placementMap.get('mining_video_primary') ||
      placementMap.get('mining_video_mid') ||
      sortedPlacements[0] ||
      null;
    setEditingTpl(null);
    setTplForm({
      ...DEFAULT_TEMPLATE_FORM,
      title: 'YemenTask_Video_VAST_6104150',
      sourceName: 'ExoClick',
      placementKey: targetPlc?.placementKey || 'mining_video_primary',
      templateType: 'vast_url',
      adFormat: 'instream_video',
      deviceTarget: 'all',
      codeContent: '',
      vastUrl: EXOCLICK_VIDEO_VAST_URL,
      width: '640',
      height: '360',
      priority: '20',
      sortOrder: '10',
      maxImpressions: '0',
      ytNetworkKey: '',
      rewardEventType: 'view',
      isDismissible: true,
      trackingEnabled: true,
      isActive: true,
      verificationMode: 'vast',
      requiredWatchSec: '30',
      requireActiveVisibility: true,
      requiredVastEvents: ['start', 'complete'],
      requireLinkReturn: false,
      requireServerPostback: false,
    });
    setTplError('');
    setShowInlinePreview(false);
    setTplModalOpen(true);
  };

  const isTplFormBannerOnly = isDisplayBannerTemplate({
    adFormat: tplForm.adFormat,
    sourceName: tplForm.sourceName,
    codeContent: tplForm.codeContent,
  });

  const isTplFormRewardEligible = isRewardEligibleTemplate({
    adFormat: tplForm.adFormat,
    templateType: tplForm.templateType,
    sourceName: tplForm.sourceName,
    codeContent: tplForm.codeContent,
  });

  const buildPreviewTemplateObject = (): MiningAdTemplate => ({
    id: editingTpl?.id || '00000000-0000-4000-8000-000000000000',
    title: tplForm.title.trim() || 'معاينة القالب الإعلاني',
    placementKey: tplForm.placementKey,
    templateType: tplForm.templateType,
    adFormat: tplForm.adFormat,
    deviceTarget: tplForm.deviceTarget,
    sourceName: tplForm.sourceName.trim(),
    codeContent: tplForm.codeContent,
    targetUrl: tplForm.targetUrl.trim() || null,
    mediaUrl: tplForm.mediaUrl.trim() || null,
    vastUrl: tplForm.vastUrl.trim() || null,
    ctaLabel: tplForm.ctaLabel.trim() || null,
    width: Math.min(1400, Math.max(100, Number(tplForm.width) || 320)),
    height: Math.min(900, Math.max(50, Number(tplForm.height) || 250)),
    priority: Number(tplForm.priority) || 10,
    sortOrder: Number(tplForm.sortOrder) || 0,
    maxImpressions: Math.max(0, Number(tplForm.maxImpressions) || 0),
    impressionsCount: editingTpl?.impressionsCount ?? 0,
    ytNetworkKey: isTplFormRewardEligible ? tplForm.ytNetworkKey.trim() || null : null,
    rewardEventType: isTplFormRewardEligible
      ? tplForm.ytNetworkKey.trim()
        ? tplForm.rewardEventType
        : null
      : null,
    isDismissible: tplForm.isDismissible,
    trackingEnabled: tplForm.trackingEnabled,
    isActive: tplForm.isActive,
    completionRule: {
      adFormat: tplForm.adFormat,
      trackingEnabled: tplForm.trackingEnabled,
      verificationMode:
        !isTplFormRewardEligible && tplForm.verificationMode === 's2s_postback'
          ? 'dwell'
          : tplForm.verificationMode,
      requiredWatchSec: Number(tplForm.requiredWatchSec) || (isTplFormBannerOnly ? 30 : 15),
      requireActiveVisibility: tplForm.requireActiveVisibility,
      requiredVastEvents: tplForm.requiredVastEvents,
      requireLinkReturn: isTplFormBannerOnly ? false : tplForm.requireLinkReturn,
      requireServerPostback: isTplFormRewardEligible ? tplForm.requireServerPostback : false,
      sessionTtlSec: Number(tplForm.sessionTtlSec) || 900,
      maxDailyPerUser: Number(tplForm.maxDailyPerUser) || 25,
      frequencyCapMinutes: Number(tplForm.frequencyCapMinutes) || 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTplError('');

    if (!tplForm.title.trim()) {
      setTplError('يرجى إدخال عنوان القالب الإعلاني.');
      return;
    }

    const bannerOnly = isDisplayBannerTemplate({
      adFormat: tplForm.adFormat,
      sourceName: tplForm.sourceName,
      codeContent: tplForm.codeContent,
    });
    const rewardEligible = isRewardEligibleTemplate({
      adFormat: tplForm.adFormat,
      templateType: tplForm.templateType,
      sourceName: tplForm.sourceName,
      codeContent: tplForm.codeContent,
    });

    const payload = {
      title: tplForm.title.trim(),
      placementKey: tplForm.placementKey,
      templateType: tplForm.templateType,
      adFormat: tplForm.adFormat,
      deviceTarget: tplForm.deviceTarget,
      sourceName: tplForm.sourceName.trim(),
      codeContent: tplForm.codeContent.trim(),
      targetUrl: tplForm.targetUrl.trim() || null,
      mediaUrl: tplForm.mediaUrl.trim() || null,
      vastUrl: tplForm.vastUrl.trim() || null,
      ctaLabel: tplForm.ctaLabel.trim() || null,
      width: Math.min(1400, Math.max(100, Number(tplForm.width) || 320)),
      height: Math.min(900, Math.max(50, Number(tplForm.height) || 250)),
      priority: Number(tplForm.priority) || 10,
      sortOrder: Number(tplForm.sortOrder) || 0,
      maxImpressions: Math.max(0, Number(tplForm.maxImpressions) || 0),
      ytNetworkKey: rewardEligible ? tplForm.ytNetworkKey.trim() || null : null,
      rewardEventType: rewardEligible
        ? tplForm.ytNetworkKey.trim()
          ? tplForm.rewardEventType
          : null
        : null,
      isDismissible: tplForm.isDismissible,
      trackingEnabled: tplForm.trackingEnabled,
      isActive: tplForm.isActive,
      completionRule: {
        adFormat: tplForm.adFormat,
        trackingEnabled: tplForm.trackingEnabled,
        verificationMode:
          !rewardEligible && tplForm.verificationMode === 's2s_postback'
            ? ('dwell' as AdVerificationMode)
            : tplForm.verificationMode,
        requiredWatchSec: Math.max(0, Math.min(600, Number(tplForm.requiredWatchSec) || 0)),
        requireActiveVisibility: tplForm.requireActiveVisibility,
        requiredVastEvents:
          tplForm.requiredVastEvents.length > 0
            ? tplForm.requiredVastEvents
            : bannerOnly
              ? []
              : ['start', 'complete'],
        requireLinkReturn: bannerOnly ? false : tplForm.requireLinkReturn,
        requireServerPostback: rewardEligible ? tplForm.requireServerPostback : false,
        sessionTtlSec: Math.max(60, Math.min(7200, Number(tplForm.sessionTtlSec) || 900)),
        maxDailyPerUser: Math.max(0, Math.min(500, Number(tplForm.maxDailyPerUser) || 25)),
        frequencyCapMinutes: Math.max(0, Math.min(1440, Number(tplForm.frequencyCapMinutes) || 0)),
      },
    };

    setSavingTpl(true);
    try {
      if (editingTpl) {
        await api.updateAdminMiningAdTemplate(editingTpl.id, payload);
        showToast('تم تحديث القالب الإعلاني بنجاح.', 'success');
      } else {
        await api.createAdminMiningAdTemplate(payload);
        showToast('تم إضافة القالب الإعلاني وحفظه في قاعدة البيانات بنجاح.', 'success');
      }
      setTplModalOpen(false);
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      setTplError(err?.message || 'تعذر حفظ القالب الإعلاني.');
    } finally {
      setSavingTpl(false);
    }
  };

  const handleToggleTemplateActive = async (tpl: MiningAdTemplate) => {
    try {
      await api.updateAdminMiningAdTemplate(tpl.id, { isActive: !tpl.isActive });
      showToast(tpl.isActive ? 'تم إيقاف القالب مؤقتاً.' : 'تم تفعيل القالب بنجاح.', 'success');
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تغيير حالة القالب.', 'error');
    }
  };

  const handleChangeTemplatePlacement = async (tpl: MiningAdTemplate, nextPlacementKey: string) => {
    if (!nextPlacementKey || nextPlacementKey === tpl.placementKey) return;
    try {
      await api.updateAdminMiningAdTemplate(tpl.id, { placementKey: nextPlacementKey });
      const plcTitle = placementMap.get(nextPlacementKey)?.titleAr || nextPlacementKey;
      showToast(`تم نقل "${tpl.title}" إلى مساحة "${plcTitle}".`, 'success');
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر نقل القالب إلى المساحة المختارة.', 'error');
    }
  };

  const handleMoveTemplate = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= filteredTemplates.length) return;
    const current = filteredTemplates[index];
    const sibling = filteredTemplates[targetIdx];
    const currentOrder = current.sortOrder;
    const siblingOrder = sibling.sortOrder === currentOrder ? currentOrder + direction : sibling.sortOrder;
    try {
      await Promise.all([
        api.updateAdminMiningAdTemplate(current.id, { sortOrder: siblingOrder }),
        api.updateAdminMiningAdTemplate(sibling.id, { sortOrder: currentOrder }),
      ]);
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث الترتيب.', 'error');
    }
  };

  const handleDeleteTemplate = (tpl: MiningAdTemplate) => {
    openConfirmModal({
      title: 'حذف القالب الإعلاني',
      message: `هل أنت متأكد من حذف القالب "${tpl.title}" نهائياً؟`,
      confirmLabel: 'نعم، احذف القالب',
      cancelLabel: 'تراجع',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminMiningAdTemplate(tpl.id);
          showToast('تم حذف القالب الإعلاني.', 'success');
          await loadAll();
          onChanged?.();
        } catch (err: any) {
          showToast(err?.message || 'تعذر حذف القالب.', 'error');
        }
      },
    });
  };

  // Placements CRUD
  const openCreatePlacement = () => {
    setPlcForm({
      ...DEFAULT_PLACEMENT_FORM,
      sortOrder: String((sortedPlacements[sortedPlacements.length - 1]?.sortOrder ?? 150) + 10),
    });
    setPlcError('');
    setPlcModalOpen(true);
  };

  const openEditPlacement = (plc: MiningAdPlacement) => {
    setPlcForm({
      id: plc.id,
      placementKey: plc.placementKey,
      titleAr: plc.titleAr,
      descriptionAr: plc.descriptionAr || '',
      pageScope: plc.pageScope,
      slotType: plc.slotType,
      defaultWidth: String(plc.defaultWidth),
      defaultHeight: String(plc.defaultHeight),
      maxAds: String(plc.maxAds),
      sortOrder: String(plc.sortOrder),
      isActive: plc.isActive,
      isSystem: plc.isSystem,
    });
    setPlcError('');
    setPlcModalOpen(true);
  };

  const handleSavePlacement = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlcError('');
    if (!plcForm.placementKey.trim() || !plcForm.titleAr.trim()) {
      setPlcError('يرجى إدخال معرف المساحة الإعلانية وعنوانها.');
      return;
    }

    setSavingPlc(true);
    try {
      await api.upsertAdminMiningAdPlacement({
        ...(plcForm.id ? { id: plcForm.id } : {}),
        placementKey: plcForm.placementKey.trim().toLowerCase(),
        titleAr: plcForm.titleAr.trim(),
        descriptionAr: plcForm.descriptionAr.trim() || null,
        pageScope: plcForm.pageScope,
        slotType: plcForm.slotType,
        defaultWidth: Number(plcForm.defaultWidth) || 320,
        defaultHeight: Number(plcForm.defaultHeight) || 250,
        maxAds: Number(plcForm.maxAds) || 3,
        sortOrder: Number(plcForm.sortOrder) || 0,
        isActive: plcForm.isActive,
      });
      showToast(plcForm.id ? 'تم تحديث المساحة الإعلانية.' : 'تم إضافة المساحة الإعلانية الجديدة.', 'success');
      setPlcModalOpen(false);
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      setPlcError(err?.message || 'تعذر حفظ المساحة الإعلانية.');
    } finally {
      setSavingPlc(false);
    }
  };

  const handleTogglePlacementActive = async (plc: MiningAdPlacement) => {
    try {
      await api.upsertAdminMiningAdPlacement({
        id: plc.id,
        placementKey: plc.placementKey,
        titleAr: plc.titleAr,
        descriptionAr: plc.descriptionAr,
        pageScope: plc.pageScope,
        slotType: plc.slotType,
        defaultWidth: plc.defaultWidth,
        defaultHeight: plc.defaultHeight,
        maxAds: plc.maxAds,
        sortOrder: plc.sortOrder,
        isActive: !plc.isActive,
      });
      showToast(plc.isActive ? 'تم تعطيل المساحة مؤقتاً.' : 'تم تفعيل المساحة.', 'success');
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تغيير حالة المساحة.', 'error');
    }
  };

  const handleMovePlacement = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sortedPlacements.length) return;
    const current = sortedPlacements[index];
    const sibling = sortedPlacements[targetIdx];
    const currentOrder = current.sortOrder;
    const siblingOrder = sibling.sortOrder === currentOrder ? currentOrder + direction : sibling.sortOrder;
    try {
      await Promise.all([
        api.upsertAdminMiningAdPlacement({ ...current, sortOrder: siblingOrder }),
        api.upsertAdminMiningAdPlacement({ ...sibling, sortOrder: currentOrder }),
      ]);
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث ترتيب المساحات.', 'error');
    }
  };

  const handleDeletePlacement = (plc: MiningAdPlacement) => {
    if (plc.isSystem) return;
    openConfirmModal({
      title: 'حذف مساحة إعلانية مخصصة',
      message: `هل تريد حذف المساحة "${plc.titleAr}" وكل القوالب المرتبطة بها؟`,
      confirmLabel: 'نعم، احذف المساحة',
      cancelLabel: 'تراجع',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminMiningAdPlacement(plc.id);
          showToast('تم حذف المساحة الإعلانية.', 'success');
          await loadAll();
          onChanged?.();
        } catch (err: any) {
          showToast(err?.message || 'تعذر حذف المساحة.', 'error');
        }
      },
    });
  };

  const handleSaveComfortSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingComfort(true);
    try {
      const res = await api.saveAdminAdComfortSettings(comfortForm);
      if (res?.comfortSettings) {
        setComfortForm(res.comfortSettings);
      }
      showToast('تم حفظ سياسة راحة المستخدم وإعدادات التتبع بنجاح.', 'success');
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ إعدادات الراحة والتتبع.', 'error');
    } finally {
      setSavingComfort(false);
    }
  };

  const handleSaveFormatRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFormatRule(true);
    try {
      const isRewardFmt = REWARD_ELIGIBLE_AD_FORMATS.has(selectedRuleFormat);
      await api.saveAdminAdFormatRule({
        ...formatRuleDraft,
        adFormat: selectedRuleFormat,
        ...(!isRewardFmt
          ? {
              requireServerPostback: false,
              verificationMode:
                formatRuleDraft.verificationMode === 's2s_postback' ? 'dwell' : formatRuleDraft.verificationMode,
            }
          : {}),
      });
      showToast(`تم حفظ شروط التحقق الافتراضية لنوع ${AD_FORMAT_LABELS[selectedRuleFormat]}.`, 'success');
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ شروط التحقق الافتراضية.', 'error');
    } finally {
      setSavingFormatRule(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-5">
      {/* Header Banner */}
      <div className={`rounded-3xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${cardSurface}`}>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
              <LayoutGrid className={`w-5 h-5 ${isObsidian ? 'text-amber-400' : 'text-emerald-600'}`} />
              <span>إدارة مركز الإعلانات والتتبع الذكي</span>
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                storageMode === 'supabase'
                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              <Database className="w-3 h-3" />
              {storageMode === 'supabase'
                ? 'متصل بقاعدة البيانات Supabase'
                : 'بانتظار تنفيذ ترحيلات SQL في Supabase'}
            </span>
          </div>
          <p className={`text-xs leading-relaxed ${mutedText}`}>
            إدارة القوالب والأنماط (11 نوعاً و18 تنسيقاً)، المواضع الإعلانية للـ 9 صفحات، سياسة راحة المستخدم والتتبع الخادمي المضاد للتلاعب، والتقارير الحقيقية من قاعدة البيانات بدون أي بيانات وهمية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={isLoading}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isObsidian
                ? 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={openCreatePlacement}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isObsidian
                ? 'bg-sky-500/15 hover:bg-sky-500/25 border-sky-500/35 text-sky-300'
                : 'bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مساحة</span>
          </button>

          <button
            type="button"
            onClick={openExoClickPreset}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isObsidian
                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 text-emerald-300'
                : 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>بانر ExoClick (6104102)</span>
          </button>

          <button
            type="button"
            onClick={openExoClickVideoPreset}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isObsidian
                ? 'bg-violet-500/15 hover:bg-violet-500/25 border-violet-500/35 text-violet-300'
                : 'bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>فيديو ExoClick VAST (6104150)</span>
          </button>

          <button
            type="button"
            onClick={() => openCreateTemplate()}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-gradient-to-l from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] font-black text-xs shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة قالب إعلاني</span>
          </button>
        </div>
      </div>

      {/* Honest Unmigrated Database Notice */}
      {storageMode === 'unmigrated' && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3.5 text-xs text-rose-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <strong className="font-black block">جداول مركز الإعلانات والتتبع غير منفّذة في Supabase بعد:</strong>
            <p className="leading-relaxed">
              تم تحضير ملفي الترحيل المقترحين (<code className="font-mono">20261126000000_mining_ad_center_templates_and_placements.sql</code> و<code className="font-mono">20261127000000_ad_tracking_anti_fraud_and_comfort.sql</code>) ولم يُنفّذا تلقائياً التزاماً بقواعد الأمان. لن يتم حفظ أي بيانات وهمية أو مؤقتة — يجب تنفيذ الترحيلات بعد مراجعتك لتفعيل الحفظ والتقارير الفعلية.
            </p>
          </div>
        </div>
      )}

      {/* 4 Sub-Tabs Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('templates')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'templates'
                ? 'bg-amber-500 text-[#0B0E14] shadow-sm'
                : isObsidian
                  ? 'bg-[#131822] text-gray-300 border border-white/10 hover:border-amber-500/30'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>قوالب الإعلانات والأكواد ({templates.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('placements')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'placements'
                ? 'bg-amber-500 text-[#0B0E14] shadow-sm'
                : isObsidian
                  ? 'bg-[#131822] text-gray-300 border border-white/10 hover:border-amber-500/30'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>المساحات الإعلانية ({placements.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('tracking_comfort')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'tracking_comfort'
                ? 'bg-amber-500 text-[#0B0E14] shadow-sm'
                : isObsidian
                  ? 'bg-[#131822] text-gray-300 border border-white/10 hover:border-amber-500/30'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>التتبع وسياسة الراحة</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('reports')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'reports'
                ? 'bg-amber-500 text-[#0B0E14] shadow-sm'
                : isObsidian
                  ? 'bg-[#131822] text-gray-300 border border-white/10 hover:border-amber-500/30'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>التقارير وكشف التلاعب</span>
          </button>
        </div>

        {subTab === 'templates' && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterPlacement}
              onChange={(e) => setFilterPlacement(e.target.value)}
              className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-bold ${inputSurface}`}
            >
              <option value="all">كل المساحات ({templates.length})</option>
              {sortedPlacements.map((p) => (
                <option key={p.placementKey} value={p.placementKey}>
                  {p.titleAr}
                </option>
              ))}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-bold ${inputSurface}`}
            >
              <option value="all">كل أنماط القوالب</option>
              {(Object.keys(TEMPLATE_TYPE_LABELS) as MiningAdTemplateType[]).map((k) => (
                <option key={k} value={k}>
                  {TEMPLATE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>

            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-bold ${inputSurface}`}
            >
              <option value="all">كل التنسيقات (18)</option>
              {(Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).map((k) => (
                <option key={k} value={k}>
                  {AD_FORMAT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Tab Body */}
      {isLoading && placements.length === 0 ? (
        <div className={`rounded-3xl p-10 text-center space-y-2 ${cardSurface}`}>
          <Loader2 className="w-7 h-7 animate-spin text-amber-400 mx-auto" />
          <p className={`text-xs font-bold ${mutedText}`}>جاري تحميل بيانات المساحات وقوالب الإعلانات...</p>
        </div>
      ) : subTab === 'templates' ? (
        /* ================= 1. TEMPLATES LIST ================= */
        filteredTemplates.length === 0 ? (
          <div className={`rounded-3xl p-10 text-center space-y-3 ${cardSurface}`}>
            <Code2 className="w-10 h-10 text-amber-400/70 mx-auto" />
            <h3 className="text-base font-black">لا توجد قوالب إعلانية مضافة حالياً</h3>
            <p className={`text-xs max-w-md mx-auto leading-relaxed ${mutedText}`}>
              لا يتم إدراج أي إعلانات أو روابط تجريبية تلقائياً. وتبقى المساحات مخفية تماماً عن المستخدمين حتى تضيف قالباً فعلياً وتفعّله هنا.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={openExoClickPreset}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0B0E14] font-black text-xs cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>تحضير قالب ExoClick (300×250 · Zone 6104102)</span>
              </button>
              <button
                type="button"
                onClick={() => openCreateTemplate()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إنشاء أول قالب إعلاني</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filteredTemplates.map((tpl, idx) => {
              const plc = placementMap.get(tpl.placementKey);
              const capped = tpl.maxImpressions > 0 && tpl.impressionsCount >= tpl.maxImpressions;
              const isBannerOnly = isDisplayBannerTemplate(tpl);
              const isRewardable = isRewardEligibleTemplate(tpl);
              const zoneKey = extractAdZoneKey(tpl);
              return (
                <div
                  key={tpl.id}
                  className={`rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${cardSurface}`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                          tpl.isActive && !capped
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {capped ? 'بلغ الحد الأقصى' : tpl.isActive ? 'نشط' : 'متوقف'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        {TEMPLATE_TYPE_LABELS[tpl.templateType]}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        {AD_FORMAT_LABELS[tpl.adFormat] || tpl.adFormat}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/5 text-gray-300 border border-white/10">
                        {DEVICE_TARGET_LABELS[tpl.deviceTarget || 'all']}
                      </span>
                      {tpl.sourceName && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                          {tpl.sourceName}
                        </span>
                      )}
                      {zoneKey && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-white/5 text-amber-300 border border-amber-500/25">
                          {zoneKey}
                        </span>
                      )}
                      {isBannerOnly ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-500/15 text-slate-300 border border-slate-500/30">
                          بانر عرض فقط (بدون YT Coin)
                        </span>
                      ) : !isRewardable ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-500/15 text-slate-300 border border-slate-500/30">
                          عرض بدون مكافآت YT Coin
                        </span>
                      ) : (
                        tpl.ytNetworkKey && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            YT: {tpl.ytNetworkKey} ({tpl.rewardEventType || 'view'})
                          </span>
                        )
                      )}
                    </div>

                    <h3 className="text-sm sm:text-base font-black truncate">{tpl.title}</h3>

                    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] ${mutedText}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <span>المساحة:</span>
                        <select
                          aria-label={`نقل مساحة ${tpl.title}`}
                          value={tpl.placementKey}
                          onChange={(e) => void handleChangeTemplatePlacement(tpl, e.target.value)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-bold text-amber-400 ${inputSurface}`}
                        >
                          {sortedPlacements.map((p) => (
                            <option key={p.placementKey} value={p.placementKey}>
                              {p.titleAr}
                            </option>
                          ))}
                        </select>
                        {!plc && <span className="text-rose-400 font-mono">({tpl.placementKey})</span>}
                      </span>
                      <span className="font-mono tabular-nums">الأبعاد: {tpl.width}×{tpl.height}</span>
                      <span className="font-mono tabular-nums">
                        الظهور: {tpl.impressionsCount.toLocaleString('en-US')}
                        {tpl.maxImpressions > 0 ? ` / ${tpl.maxImpressions.toLocaleString('en-US')}` : ' / مفتوح'}
                      </span>
                      <span>
                        التتبع:{' '}
                        <strong className={!isBannerOnly && tpl.trackingEnabled ? 'text-emerald-400' : 'text-gray-400'}>
                          {isBannerOnly
                            ? 'عرض صامت فقط (مفصول عن المهام)'
                            : tpl.trackingEnabled
                              ? `${VERIFICATION_MODE_LABELS[tpl.completionRule?.verificationMode || 'dwell']} (${tpl.completionRule?.requiredWatchSec ?? 15}ث)`
                              : 'معطّل'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleMoveTemplate(idx, -1)}
                      disabled={idx === 0}
                      title="تحريك للأعلى"
                      className={`p-2 rounded-xl border text-xs disabled:opacity-40 cursor-pointer ${subSurface}`}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleMoveTemplate(idx, 1)}
                      disabled={idx === filteredTemplates.length - 1}
                      title="تحريك للأسفل"
                      className={`p-2 rounded-xl border text-xs disabled:opacity-40 cursor-pointer ${subSurface}`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewTemplate(tpl)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-400 text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>معاينة</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleTemplateActive(tpl)}
                      className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                        tpl.isActive
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {tpl.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      <span>{tpl.isActive ? 'تعطيل' : 'تفعيل'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditTemplate(tpl)}
                      className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${subSurface}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(tpl)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-xs font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : subTab === 'placements' ? (
        /* ================= 2. PLACEMENTS LIST ================= */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedPlacements.map((plc, idx) => {
            const countForSlot = templates.filter((t) => t.placementKey === plc.placementKey).length;
            const activeForSlot = templates.filter((t) => t.placementKey === plc.placementKey && t.isActive).length;
            return (
              <div key={plc.id} className={`rounded-2xl p-4 flex flex-col justify-between gap-3 ${cardSurface}`}>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                          plc.isActive
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {plc.isActive ? 'مفعّلة' : 'معطّلة'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                        {SLOT_TYPE_LABELS[plc.slotType] || plc.slotType}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        {PAGE_SCOPE_LABELS[plc.pageScope] || plc.pageScope}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-500">#{plc.sortOrder}</span>
                  </div>

                  <h3 className="text-sm font-black">{plc.titleAr}</h3>
                  {plc.descriptionAr && <p className={`text-[11px] leading-relaxed ${mutedText}`}>{plc.descriptionAr}</p>}

                  <div className={`flex flex-wrap items-center gap-3 text-[11px] font-mono ${mutedText}`}>
                    <span>{plc.placementKey}</span>
                    <span>• {plc.defaultWidth}×{plc.defaultHeight}</span>
                    <span>• قوالب نشطة: {activeForSlot}/{countForSlot}</span>
                    <span>• أقصى إعلانات: {plc.maxAds}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleMovePlacement(idx, -1)}
                      disabled={idx === 0}
                      className={`p-1.5 rounded-lg border disabled:opacity-40 cursor-pointer ${subSurface}`}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleMovePlacement(idx, 1)}
                      disabled={idx === sortedPlacements.length - 1}
                      className={`p-1.5 rounded-lg border disabled:opacity-40 cursor-pointer ${subSurface}`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openCreateTemplate(plc.placementKey)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-[11px] font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>قالب هنا</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleTogglePlacementActive(plc)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                        plc.isActive
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {plc.isActive ? 'تعطيل' : 'تفعيل'}
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditPlacement(plc)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${subSurface}`}
                    >
                      تعديل
                    </button>

                    {!plc.isSystem && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePlacement(plc)}
                        className="p-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : subTab === 'tracking_comfort' ? (
        /* ================= 3. COMFORT POLICY & FORMAT TRACKING RULES ================= */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Comfort Policy Settings Form */}
          <form onSubmit={(e) => void handleSaveComfortSettings(e)} className={`rounded-3xl p-5 space-y-4 ${cardSurface}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>سياسة راحة المستخدم والتحكم بالإزعاج</span>
                </h3>
                <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                  إلغاء النوافذ المنبثقة القسرية تلقائياً وتحديد الحدود القصوى للبانرات اللاصقة والتباعد.
                </p>
              </div>
            </div>

            <div className={`rounded-2xl p-3.5 space-y-2.5 text-xs ${subSurface}`}>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="font-bold">إيقاف Popunder تلقائياً لحماية تجربة التعدين</span>
                <input
                  type="checkbox"
                  checked={comfortForm.popunderAutoDisabled}
                  onChange={(e) => setComfortForm({ ...comfortForm, popunderAutoDisabled: e.target.checked })}
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="font-bold">تفعيل إعلانات Push Notifications الاختيارية (Opt-in)</span>
                <input
                  type="checkbox"
                  checked={comfortForm.pushAdsEnabled}
                  onChange={(e) => setComfortForm({ ...comfortForm, pushAdsEnabled: e.target.checked })}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-bold block mb-1">أقصى عدد Sticky Banner معاً</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  value={comfortForm.maxStickyAds}
                  onChange={(e) => setComfortForm({ ...comfortForm, maxStickyAds: Number(e.target.value) || 0 })}
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">أقصى عناصر متحركة بالمشهد</label>
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={comfortForm.maxAnimatedAdsInView}
                  onChange={(e) =>
                    setComfortForm({ ...comfortForm, maxAnimatedAdsInView: Number(e.target.value) || 0 })
                  }
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">فترة التهدئة بعد الإغلاق (ثانية)</label>
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={comfortForm.cooldownAfterDismissSec}
                  onChange={(e) =>
                    setComfortForm({ ...comfortForm, cooldownAfterDismissSec: Number(e.target.value) || 0 })
                  }
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">المسافة الدنيا بين الإعلانات (px)</label>
                <input
                  type="number"
                  min={8}
                  max={96}
                  value={comfortForm.minSpacingPx}
                  onChange={(e) => setComfortForm({ ...comfortForm, minSpacingPx: Number(e.target.value) || 16 })}
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">مدة صلاحية جلسة التتبع الافتراضية (ث)</label>
                <input
                  type="number"
                  min={60}
                  max={7200}
                  value={comfortForm.defaultSessionTtlSec}
                  onChange={(e) =>
                    setComfortForm({ ...comfortForm, defaultSessionTtlSec: Number(e.target.value) || 900 })
                  }
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">الحد اليومي الافتراضي للمستخدم</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={comfortForm.defaultMaxDailyPerUser}
                  onChange={(e) =>
                    setComfortForm({ ...comfortForm, defaultMaxDailyPerUser: Number(e.target.value) || 25 })
                  }
                  className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-black">تشغيل / إيقاف التتبع حسب تنسيق الإعلان (18 تنسيقاً):</div>
              <div className={`rounded-2xl p-3 max-h-60 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] ${subSurface}`}>
                {(Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).map((fmt) => (
                  <label key={fmt} className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-white/5 cursor-pointer">
                    <span className="truncate font-semibold">{AD_FORMAT_LABELS[fmt]}</span>
                    <input
                      type="checkbox"
                      checked={comfortForm.trackingEnabledByFormat[fmt] !== false}
                      onChange={(e) =>
                        setComfortForm({
                          ...comfortForm,
                          trackingEnabledByFormat: {
                            ...comfortForm.trackingEnabledByFormat,
                            [fmt]: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingComfort}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer disabled:opacity-60"
            >
              {savingComfort ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>حفظ سياسة الراحة وإعدادات التتبع</span>
            </button>
          </form>

          {/* Per-Format Default Completion Rule Form */}
          <form onSubmit={(e) => void handleSaveFormatRule(e)} className={`rounded-3xl p-5 space-y-4 ${cardSurface}`}>
            <div>
              <h3 className="text-base font-black flex items-center gap-2">
                <Activity className="w-5 h-5 text-sky-400" />
                <span>شروط التحقق الافتراضية لكل تنسيق إعلاني</span>
              </h3>
              <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                تحدد القواعد الخادمية المطلوبة لإتمام جلسة المشاهدة/النقر أو التوصية قبل الأهلية للمكافأة.
              </p>
            </div>

            <div className="text-xs">
              <label className="font-bold block mb-1">اختر التنسيق لتعديل قاعدته الافتراضية:</label>
              <select
                value={selectedRuleFormat}
                onChange={(e) => setSelectedRuleFormat(e.target.value as MiningAdFormat)}
                className={`w-full rounded-xl px-3 py-2.5 font-bold ${inputSurface}`}
              >
                {(Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {AD_FORMAT_LABELS[fmt]}
                  </option>
                ))}
              </select>
            </div>

            {DISPLAY_BANNER_FORMATS.has(selectedRuleFormat) && (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed font-semibold">
                تنبيه: إعلانات البانر ({AD_FORMAT_LABELS[selectedRuleFormat]}) تُسجّل ظهورها ومدة مشاهدتها النشطة ومكافحة التلاعب بالكامل، لكنها مفصولة عن مكافآت YT Coin (بدون ربط S2S).
              </div>
            )}
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="font-bold block mb-1">نمط التحقق الخادمي</label>
                    <select
                      value={formatRuleDraft.verificationMode}
                      onChange={(e) =>
                        setFormatRuleDraft({
                          ...formatRuleDraft,
                          verificationMode: e.target.value as AdVerificationMode,
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                    >
                      {(Object.keys(VERIFICATION_MODE_LABELS) as AdVerificationMode[])
                        .filter((mode) => mode !== 's2s_postback' || REWARD_ELIGIBLE_AD_FORMATS.has(selectedRuleFormat))
                        .map((mode) => (
                          <option key={mode} value={mode}>
                            {VERIFICATION_MODE_LABELS[mode]}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold block mb-1">مدة المشاهدة النشطة المطلوبة (ثانية)</label>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={formatRuleDraft.requiredWatchSec}
                      onChange={(e) =>
                        setFormatRuleDraft({
                          ...formatRuleDraft,
                          requiredWatchSec: Number(e.target.value) || 0,
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                    />
                  </div>
                  <div>
                    <label className="font-bold block mb-1">صلاحية الجلسة (ثانية)</label>
                    <input
                      type="number"
                      min={60}
                      max={7200}
                      value={formatRuleDraft.sessionTtlSec}
                      onChange={(e) =>
                        setFormatRuleDraft({
                          ...formatRuleDraft,
                          sessionTtlSec: Number(e.target.value) || 900,
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                    />
                  </div>
                  <div>
                    <label className="font-bold block mb-1">الحد اليومي لكل مستخدم</label>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={formatRuleDraft.maxDailyPerUser}
                      onChange={(e) =>
                        setFormatRuleDraft({
                          ...formatRuleDraft,
                          maxDailyPerUser: Number(e.target.value) || 25,
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="font-bold block mb-1">فترة التهدئة بين الجلسات (دقيقة — 0 بدون تهدئة)</label>
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={formatRuleDraft.frequencyCapMinutes}
                      onChange={(e) =>
                        setFormatRuleDraft({
                          ...formatRuleDraft,
                          frequencyCapMinutes: Number(e.target.value) || 0,
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2 font-mono font-bold ${inputSurface}`}
                    />
                  </div>
                </div>

                <div className={`rounded-2xl p-3.5 space-y-2 text-xs ${subSurface}`}>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={formatRuleDraft.trackingEnabled}
                      onChange={(e) => setFormatRuleDraft({ ...formatRuleDraft, trackingEnabled: e.target.checked })}
                    />
                    <span>تفعيل التتبع لهذا التنسيق</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={formatRuleDraft.requireActiveVisibility}
                      onChange={(e) =>
                        setFormatRuleDraft({ ...formatRuleDraft, requireActiveVisibility: e.target.checked })
                      }
                    />
                    <span>إلزامية بقاء التبويب نشطاً (Page Visibility) — إيقاف العدّاد عند التبديل</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={formatRuleDraft.requireLinkReturn}
                      onChange={(e) => setFormatRuleDraft({ ...formatRuleDraft, requireLinkReturn: e.target.checked })}
                    />
                    <span>إلزامية فتح الرابط الخارجي وتسجيل العودة</span>
                  </label>
                  {REWARD_ELIGIBLE_AD_FORMATS.has(selectedRuleFormat) ? (
                    <label className="flex items-center gap-2 cursor-pointer font-bold">
                      <input
                        type="checkbox"
                        checked={formatRuleDraft.requireServerPostback}
                        onChange={(e) =>
                          setFormatRuleDraft({ ...formatRuleDraft, requireServerPostback: e.target.checked })
                        }
                      />
                      <span>إلزامية تأكيد S2S Postback من الشبكة قبل اعتماد المكافأة</span>
                    </label>
                  ) : (
                    <p className="text-[11px] font-semibold text-amber-300 pt-1">
                      مكافآت YT Coin (S2S) متاحة فقط لإعلانات الفيديو والروابط وما يشبهها، ولا تشمل البانرات أو الودجات أو التنسيقات المختلطة.
                    </p>
                  )}
                </div>
              </>

            <button
              type="submit"
              disabled={savingFormatRule}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0B0E14] font-black text-xs cursor-pointer disabled:opacity-60"
            >
              {savingFormatRule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>حفظ قاعدة التنسيق ({AD_FORMAT_LABELS[selectedRuleFormat]})</span>
            </button>
          </form>
        </div>
      ) : (
        /* ================= 4. REAL DATABASE REPORTS & ANTI-FRAUD ================= */
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className={`rounded-3xl p-4 sm:p-5 space-y-3 ${cardSurface}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Filter className="w-4 h-4 text-amber-400" />
                <span>تصفية تقارير التتبع الفعلي (من قاعدة البيانات فقط)</span>
              </h3>
              <button
                type="button"
                onClick={() => void loadReports()}
                disabled={loadingReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] text-xs font-black cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? 'animate-spin' : ''}`} />
                <span>تطبيق التصفية</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
              <div>
                <label className="font-bold block mb-1">من تاريخ</label>
                <input
                  type="date"
                  value={reportFilters.dateFrom}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateFrom: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-mono ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  value={reportFilters.dateTo}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateTo: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-mono ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">الشبكة (networkKey)</label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder="مثال: adsterra"
                  value={reportFilters.networkKey}
                  onChange={(e) => setReportFilters({ ...reportFilters, networkKey: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-mono ${inputSurface}`}
                />
              </div>
              <div>
                <label className="font-bold block mb-1">تنسيق الإعلان</label>
                <select
                  value={reportFilters.adFormat}
                  onChange={(e) => setReportFilters({ ...reportFilters, adFormat: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                >
                  <option value="">كل التنسيقات</option>
                  {(Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {AD_FORMAT_LABELS[fmt]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-bold block mb-1">معرّف المستخدم (UUID)</label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder="UUID"
                  value={reportFilters.userId}
                  onChange={(e) => setReportFilters({ ...reportFilters, userId: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-mono ${inputSurface}`}
                />
              </div>
            </div>
          </div>

          {reportError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs text-rose-300 font-bold">
              {reportError}
            </div>
          )}

          {loadingReport ? (
            <div className={`rounded-3xl p-10 text-center space-y-2 ${cardSurface}`}>
              <Loader2 className="w-7 h-7 animate-spin text-amber-400 mx-auto" />
              <p className={`text-xs font-bold ${mutedText}`}>جاري احتساب الإحصائيات الفعلية من قاعدة البيانات...</p>
            </div>
          ) : reportData?.storageMode === 'unmigrated' ? (
            <div className={`rounded-3xl p-8 text-center space-y-2 ${cardSurface}`}>
              <Database className="w-8 h-8 text-rose-400 mx-auto" />
              <h4 className="text-sm font-black">لا توجد تقارير متاحة قبل تنفيذ ترحيل التتبع (20261127000000)</h4>
              <p className={`text-xs ${mutedText}`}>
                جميع الأرقام في التقارير حقيقية من قاعدة البيانات ولا يتم عرض أرقام افتراضية مطلقاً.
              </p>
            </div>
          ) : reportData ? (
            <>
              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'إجمالي الظهور', val: reportData.totals.impressions, accent: 'text-amber-400' },
                  { label: 'بدء المشاهدة', val: reportData.totals.viewStarts, accent: 'text-sky-400' },
                  { label: 'مشاهدات مكتملة', val: reportData.totals.completedViews, accent: 'text-emerald-400' },
                  { label: 'غير مكتملة', val: reportData.totals.incompleteViews, accent: 'text-gray-300' },
                  { label: 'النقرات', val: reportData.totals.clicks, accent: 'text-amber-300' },
                  { label: 'زيارات / عودة روابط', val: `${reportData.totals.externalOpens} / ${reportData.totals.externalReturns}`, accent: 'text-indigo-300' },
                  { label: 'نسبة الإكمال %', val: `${reportData.totals.completionRatePct}%`, accent: 'text-emerald-400' },
                  { label: 'نسبة التحويل %', val: `${reportData.totals.conversionRatePct}%`, accent: 'text-sky-300' },
                  { label: 'مكافآت معتمدة (S2S)', val: reportData.totals.approvedRewards, accent: 'text-emerald-400' },
                  { label: 'جلسات مرفوضة', val: reportData.totals.rejectedSessions, accent: 'text-rose-400' },
                  { label: 'جلسات منتهية', val: reportData.totals.expiredSessions, accent: 'text-orange-400' },
                  { label: 'تنبيهات مكافحة الغش', val: reportData.totals.riskFlagsCount, accent: 'text-rose-400' },
                ].map((kpi) => (
                  <div key={kpi.label} className={`rounded-2xl p-3.5 ${cardSurface}`}>
                    <span className={`text-[10px] block ${mutedText}`}>{kpi.label}</span>
                    <strong className={`text-lg font-black font-mono mt-1 block ${kpi.accent}`} dir="ltr">
                      {typeof kpi.val === 'number' ? kpi.val.toLocaleString('en-US') : kpi.val}
                    </strong>
                  </div>
                ))}
              </div>

              {/* By Network & By Template */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={`rounded-3xl p-4 sm:p-5 space-y-3 ${cardSurface}`}>
                  <h4 className="text-sm font-black">الأداء حسب الشبكة (byNetwork)</h4>
                  {reportData.byNetwork.length === 0 ? (
                    <p className={`text-xs ${mutedText}`}>لا توجد جلسات مرتبطة بشبكات S2S ضمن النطاق المحدد.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-right">
                        <thead>
                          <tr className={`border-b border-white/10 ${mutedText}`}>
                            <th className="py-2">الشبكة</th>
                            <th className="py-2">الجلسات</th>
                            <th className="py-2">مكتمل</th>
                            <th className="py-2">مرفوض</th>
                            <th className="py-2">S2S معتمد</th>
                            <th className="py-2">النقرات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.byNetwork.map((row) => (
                            <tr key={row.networkKey} className="border-b border-white/5 font-mono">
                              <td className="py-2 font-bold">{row.networkKey}</td>
                              <td className="py-2">{row.sessions}</td>
                              <td className="py-2 text-emerald-400">{row.completed}</td>
                              <td className="py-2 text-rose-400">{row.rejected}</td>
                              <td className="py-2 text-amber-400">{row.approvedRewards}</td>
                              <td className="py-2">{row.clicks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className={`rounded-3xl p-4 sm:p-5 space-y-3 ${cardSurface}`}>
                  <h4 className="text-sm font-black">الأداء حسب القالب (byTemplate)</h4>
                  {reportData.byTemplate.length === 0 ? (
                    <p className={`text-xs ${mutedText}`}>لا توجد جلسات قوالب مسجلة ضمن النطاق المحدد.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-right">
                        <thead>
                          <tr className={`border-b border-white/10 ${mutedText}`}>
                            <th className="py-2">القالب</th>
                            <th className="py-2">التنسيق</th>
                            <th className="py-2">البدء</th>
                            <th className="py-2">مكتمل</th>
                            <th className="py-2">مرفوض</th>
                            <th className="py-2">النسبة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.byTemplate.map((row) => (
                            <tr key={row.templateId} className="border-b border-white/5">
                              <td className="py-2 font-bold max-w-[140px] truncate">{row.title}</td>
                              <td className="py-2 font-mono text-[11px]">{row.adFormat}</td>
                              <td className="py-2 font-mono">{row.starts}</td>
                              <td className="py-2 font-mono text-emerald-400">{row.completed}</td>
                              <td className="py-2 font-mono text-rose-400">{row.rejected}</td>
                              <td className="py-2 font-mono text-amber-400">{row.completionRatePct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Risk Flags & Recent Sessions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={`rounded-3xl p-4 sm:p-5 space-y-3 ${cardSurface}`}>
                  <h4 className="text-sm font-black flex items-center gap-2 text-rose-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>سجل إشارات مكافحة التلاعب (Anti-Fraud Risk Flags)</span>
                  </h4>
                  {reportData.recentRiskFlags.length === 0 ? (
                    <p className={`text-xs ${mutedText}`}>لا توجد محاولات تلاعب مرصودة في الفترة المحددة.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {reportData.recentRiskFlags.map((flag) => (
                        <div key={flag.id} className={`rounded-2xl p-3 text-xs space-y-1 ${subSurface}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-black text-rose-300">
                              {RISK_FLAG_LABELS[flag.flagType] || flag.flagType}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                flag.severity === 'high'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : flag.severity === 'medium'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-sky-500/20 text-sky-300'
                              }`}
                            >
                              {flag.severity}
                            </span>
                          </div>
                          <div className={`text-[10px] font-mono ${mutedText}`}>
                            {flag.userId ? `المستخدم: ${flag.userId.slice(0, 8)}...` : 'مجهول'} •{' '}
                            {new Date(flag.createdAt).toLocaleString('ar-YE')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={`rounded-3xl p-4 sm:p-5 space-y-3 ${cardSurface}`}>
                  <h4 className="text-sm font-black">أحدث جلسات التتبع الخادمية</h4>
                  {reportData.recentSessions.length === 0 ? (
                    <p className={`text-xs ${mutedText}`}>لا توجد جلسات مسجلة بعد.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {reportData.recentSessions.map((sess) => (
                        <div key={sess.id} className={`rounded-2xl p-3 text-xs space-y-1 ${subSurface}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold truncate">{sess.templateTitle || sess.placementKey}</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300">
                              {sess.sessionStatus} · {sess.verificationStatus}
                            </span>
                          </div>
                          <div className={`text-[10px] font-mono flex flex-wrap gap-3 ${mutedText}`}>
                            <span>{sess.adFormat}</span>
                            <span>{Math.floor(sess.activeDurationSec)}ث / {sess.requiredWatchSec}ث</span>
                            <span>{sess.eligibilityResult}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ==================== CREATE / EDIT TEMPLATE MODAL ==================== */}
      {tplModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className={`w-full max-w-3xl rounded-3xl p-5 sm:p-6 space-y-4 my-6 ${cardSurface}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base sm:text-lg font-black flex items-center gap-2">
                <Code2 className="w-5 h-5 text-amber-400" />
                <span>{editingTpl ? 'تعديل القالب الإعلاني وقواعد التحقق' : 'إضافة قالب إعلاني جديد'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {tplError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-300 font-bold">
                {tplError}
              </div>
            )}

            <form onSubmit={(e) => void handleSaveTemplate(e)} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold block mb-1">عنوان الإعلان / القالب *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: مشغل VAST للفيديو أعلى القسم"
                    value={tplForm.title}
                    onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2.5 font-semibold focus:outline-none ${inputSurface}`}
                  />
                </div>

                <div>
                  <label className="font-bold block mb-1">اسم الشبكة / المصدر</label>
                  <input
                    type="text"
                    placeholder="مثال: Adsterra / HilltopAds / مباشر"
                    value={tplForm.sourceName}
                    onChange={(e) => setTplForm({ ...tplForm, sourceName: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2.5 font-semibold focus:outline-none ${inputSurface}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold block mb-1">مساحة العرض *</label>
                  <select
                    value={tplForm.placementKey}
                    onChange={(e) => {
                      const nextKey = e.target.value;
                      const matched = placementMap.get(nextKey);
                      setTplForm((prev) => ({
                        ...prev,
                        placementKey: nextKey,
                        ...(!editingTpl && matched
                          ? {
                              width: String(matched.defaultWidth),
                              height: String(matched.defaultHeight),
                            }
                          : {}),
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2.5 font-bold focus:outline-none ${inputSurface}`}
                  >
                    {sortedPlacements.map((p) => (
                      <option key={p.placementKey} value={p.placementKey}>
                        {p.titleAr} ({p.defaultWidth}×{p.defaultHeight})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold block mb-1">نوع القالب (11 نوعاً) *</label>
                  <select
                    value={tplForm.templateType}
                    onChange={(e) => {
                      const nextType = e.target.value as MiningAdTemplateType;
                      const suggestedFmt = defaultFormatForTemplateType(nextType);
                      const suggestedMode = defaultVerificationForFormat(suggestedFmt);
                      setTplForm((prev) => ({
                        ...prev,
                        templateType: nextType,
                        ...(!editingTpl
                          ? {
                              adFormat: suggestedFmt,
                              verificationMode: suggestedMode,
                              requireLinkReturn: suggestedMode === 'link_return',
                            }
                          : {}),
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2.5 font-bold focus:outline-none ${inputSurface}`}
                  >
                    {(Object.keys(TEMPLATE_TYPE_LABELS) as MiningAdTemplateType[]).map((k) => (
                      <option key={k} value={k}>
                        {TEMPLATE_TYPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold block mb-1">تنسيق الوحدة الإعلانية (18) *</label>
                  <select
                    value={tplForm.adFormat}
                    onChange={(e) => {
                      const nextFmt = e.target.value as MiningAdFormat;
                      const nextMode = defaultVerificationForFormat(nextFmt);
                      setTplForm((prev) => ({
                        ...prev,
                        adFormat: nextFmt,
                        verificationMode: nextMode,
                        requireLinkReturn: nextMode === 'link_return',
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2.5 font-bold focus:outline-none ${inputSurface}`}
                  >
                    {(Object.keys(AD_FORMAT_LABELS) as MiningAdFormat[]).map((k) => (
                      <option key={k} value={k}>
                        {AD_FORMAT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {['html', 'javascript', 'network_code', 'mixed', 'video_player', 'image_banner', 'recommendation_widget', 'multi_format', 'push_notification'].includes(
                tplForm.templateType
              ) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold">
                      {tplForm.templateType === 'javascript'
                        ? 'كود JavaScript (يُشغّل معزولاً داخل Sandbox)'
                        : tplForm.templateType === 'network_code'
                          ? 'كود شبكة الإعلانات (HTML/Script/HTTPS URL)'
                          : 'كود أو محتوى القالب الإعلاني (HTML / Embed)'}
                    </label>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold">
                      <ShieldCheck className="w-3 h-3" />
                      معزول بدون allow-same-origin
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    dir="ltr"
                    placeholder={
                      tplForm.templateType === 'javascript'
                        ? '<script async src="https://..."></script>'
                        : '<div>...</div>'
                    }
                    value={tplForm.codeContent}
                    onChange={(e) => setTplForm({ ...tplForm, codeContent: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2 font-mono text-[11px] focus:outline-none ${inputSurface}`}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold block mb-1">الرابط الخارجي المستهدف (HTTPS)</label>
                  <input
                    type="url"
                    dir="ltr"
                    placeholder="https://..."
                    value={tplForm.targetUrl}
                    onChange={(e) => setTplForm({ ...tplForm, targetUrl: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2 font-mono focus:outline-none ${inputSurface}`}
                  />
                </div>

                <div>
                  <label className="font-bold block mb-1">رابط الصورة أو الفيديو المباشر (HTTPS)</label>
                  <input
                    type="url"
                    dir="ltr"
                    placeholder="https://.../banner.webp أو .mp4"
                    value={tplForm.mediaUrl}
                    onChange={(e) => setTplForm({ ...tplForm, mediaUrl: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2 font-mono focus:outline-none ${inputSurface}`}
                  />
                </div>

                <div>
                  <label className="font-bold block mb-1">رابط VAST XML (لإعلانات الفيديو)</label>
                  <input
                    type="url"
                    dir="ltr"
                    placeholder="https://.../vast.xml"
                    value={tplForm.vastUrl}
                    onChange={(e) => setTplForm({ ...tplForm, vastUrl: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2 font-mono focus:outline-none ${inputSurface}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                <div>
                  <label className="font-bold block mb-1">الجهاز</label>
                  <select
                    value={tplForm.deviceTarget}
                    onChange={(e) => setTplForm({ ...tplForm, deviceTarget: e.target.value as MiningAdDeviceTarget })}
                    className={`w-full rounded-xl px-2 py-2 font-bold ${inputSurface}`}
                  >
                    {(Object.keys(DEVICE_TARGET_LABELS) as MiningAdDeviceTarget[]).map((d) => (
                      <option key={d} value={d}>
                        {DEVICE_TARGET_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold block mb-1">العرض (px)</label>
                  <input
                    type="number"
                    min={100}
                    max={1400}
                    value={tplForm.width}
                    onChange={(e) => setTplForm({ ...tplForm, width: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">الارتفاع (px)</label>
                  <input
                    type="number"
                    min={50}
                    max={900}
                    value={tplForm.height}
                    onChange={(e) => setTplForm({ ...tplForm, height: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">الأولوية</label>
                  <input
                    type="number"
                    value={tplForm.priority}
                    onChange={(e) => setTplForm({ ...tplForm, priority: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">الترتيب</label>
                  <input
                    type="number"
                    value={tplForm.sortOrder}
                    onChange={(e) => setTplForm({ ...tplForm, sortOrder: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">أقصى ظهور</label>
                  <input
                    type="number"
                    min={0}
                    value={tplForm.maxImpressions}
                    onChange={(e) => setTplForm({ ...tplForm, maxImpressions: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold block mb-1">نص الزر (اختياري)</label>
                  <input
                    type="text"
                    placeholder="مثال: شاهد العرض"
                    value={tplForm.ctaLabel}
                    onChange={(e) => setTplForm({ ...tplForm, ctaLabel: e.target.value })}
                    className={`w-full rounded-xl px-3 py-2 font-semibold ${inputSurface}`}
                  />
                </div>

                {isTplFormRewardEligible ? (
                  <>
                    <div>
                      <label className="font-bold block mb-1">ربط بمكافآت YT Coin (مهام الفيديو والروابط فقط)</label>
                      <select
                        value={tplForm.ytNetworkKey}
                        onChange={(e) => setTplForm({ ...tplForm, ytNetworkKey: e.target.value })}
                        className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                      >
                        <option value="">بدون مكافأة YT (عرض وتتبع فقط)</option>
                        {ytNetworks.map((net) => (
                          <option key={net.network_key} value={net.network_key}>
                            {net.display_name} ({net.network_key})
                          </option>
                        ))}
                      </select>
                    </div>

                    {tplForm.ytNetworkKey && (
                      <div>
                        <label className="font-bold block mb-1">نوع الحدث الموثق (S2S)</label>
                        <select
                          value={tplForm.rewardEventType}
                          onChange={(e) =>
                            setTplForm({ ...tplForm, rewardEventType: e.target.value as 'view' | 'click' })
                          }
                          className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                        >
                          <option value="view">مشاهدة إعلان (View)</option>
                          <option value="click">نقرة إعلانية (Click)</option>
                        </select>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="sm:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-300 flex items-center">
                    {isTplFormBannerOnly
                      ? 'إعلانات البانر وشبكات العرض (مثل ExoClick) للعرض الصامت فقط ولا ترتبط بمكافآت YT Coin أو نظام المهام.'
                      : 'المكافآت (YT Coin / S2S) مخصصة فقط لإعلانات الفيديو والروابط وما يشبهها — هذا النوع لا يمنح مكافآت.'}
                  </div>
                )}
              </div>

              {/* Per-Template Server Completion & Anti-Fraud Rule */}
              <div className={`rounded-2xl p-3.5 space-y-3 ${subSurface}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-amber-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>قواعد التحقق والإكمال الخادمي لهذا الإعلان</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tplForm.isDismissible}
                        onChange={(e) => setTplForm({ ...tplForm, isDismissible: e.target.checked })}
                      />
                      <span>قابل للإغلاق</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tplForm.trackingEnabled}
                        onChange={(e) => setTplForm({ ...tplForm, trackingEnabled: e.target.checked })}
                      />
                      <span>تفعيل التتبع</span>
                    </label>
                  </div>
                </div>

                {isTplFormBannerOnly && (
                  <p className="text-[11px] font-semibold text-amber-300 leading-relaxed">
                    إعلانات البانر تُتتبّع خادمياً (الظهور + بدء المشاهدة + 30 ثانية + منع التلاعب) مع بقائها مفصولة تماماً عن نظام مكافآت YT Coin والمحافظ المالية.
                  </p>
                )}

                {tplForm.trackingEnabled && (
                  <>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                        <div className="col-span-2">
                          <label className="font-bold block mb-1">نمط التحقق</label>
                          <select
                            value={tplForm.verificationMode}
                            onChange={(e) =>
                              setTplForm({ ...tplForm, verificationMode: e.target.value as AdVerificationMode })
                            }
                            className={`w-full rounded-xl px-2.5 py-2 font-bold ${inputSurface}`}
                          >
                            {(Object.keys(VERIFICATION_MODE_LABELS) as AdVerificationMode[])
                              .filter((m) => m !== 's2s_postback' || isTplFormRewardEligible)
                              .map((m) => (
                                <option key={m} value={m}>
                                  {VERIFICATION_MODE_LABELS[m]}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="font-bold block mb-1">المشاهدة (ث)</label>
                          <input
                            type="number"
                            min={0}
                            max={600}
                            value={tplForm.requiredWatchSec}
                            onChange={(e) => setTplForm({ ...tplForm, requiredWatchSec: e.target.value })}
                            className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                          />
                        </div>
                        <div>
                          <label className="font-bold block mb-1">حد يومي/مستخدم</label>
                          <input
                            type="number"
                            min={0}
                            max={500}
                            value={tplForm.maxDailyPerUser}
                            onChange={(e) => setTplForm({ ...tplForm, maxDailyPerUser: e.target.value })}
                            className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                          />
                        </div>
                        <div>
                          <label className="font-bold block mb-1">تهدئة (دقيقة)</label>
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={tplForm.frequencyCapMinutes}
                            onChange={(e) => setTplForm({ ...tplForm, frequencyCapMinutes: e.target.value })}
                            className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                          <input
                            type="checkbox"
                            checked={tplForm.requireActiveVisibility}
                            onChange={(e) => setTplForm({ ...tplForm, requireActiveVisibility: e.target.checked })}
                          />
                          <span>اشتراط بقاء التبويب نشطاً</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                          <input
                            type="checkbox"
                            checked={tplForm.requireLinkReturn}
                            onChange={(e) => setTplForm({ ...tplForm, requireLinkReturn: e.target.checked })}
                          />
                          <span>اشتراط فتح الرابط والعودة</span>
                        </label>
                        {isTplFormRewardEligible && (
                          <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                            <input
                              type="checkbox"
                              checked={tplForm.requireServerPostback}
                              onChange={(e) => setTplForm({ ...tplForm, requireServerPostback: e.target.checked })}
                            />
                            <span>اشتراط S2S للمكافأة</span>
                          </label>
                        )}
                      </div>

                      {tplForm.verificationMode === 'vast' && (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <span className="font-bold text-gray-300">أحداث VAST المطلوبة:</span>
                          {VAST_REQUIRED_OPTIONS.map((evt) => {
                            const checked = tplForm.requiredVastEvents.includes(evt);
                            return (
                              <label key={evt} className="inline-flex items-center gap-1 font-mono cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setTplForm((prev) => ({
                                      ...prev,
                                      requiredVastEvents: e.target.checked
                                        ? [...prev.requiredVastEvents, evt]
                                        : prev.requiredVastEvents.filter((x) => x !== evt),
                                    }));
                                  }}
                                />
                                <span>{evt}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </>
                )}
              </div>

              {/* Publish & Live Preview Controls */}
              <div className={`rounded-2xl p-3 space-y-2.5 ${subSurface}`}>
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tplForm.isActive}
                      onChange={(e) => setTplForm({ ...tplForm, isActive: e.target.checked })}
                    />
                    <span>تفعيل القالب ونشره فور الحفظ</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowInlinePreview((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/30 font-bold text-xs cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{showInlinePreview ? 'إخفاء المعاينة الحية' : 'معاينة قبل النشر'}</span>
                  </button>
                </div>

                {showInlinePreview && (
                  <div className="pt-2">
                    <MiningAdTemplateCard template={buildPreviewTemplateObject()} isPreview />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTplModalOpen(false)}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-bold cursor-pointer ${subSurface}`}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingTpl}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer disabled:opacity-60"
                >
                  {savingTpl && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{editingTpl ? 'حفظ التعديلات' : 'نشر وحفظ القالب'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== CREATE / EDIT PLACEMENT MODAL ==================== */}
      {plcModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className={`w-full max-w-lg rounded-3xl p-5 sm:p-6 space-y-4 ${cardSurface}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black flex items-center gap-2">
                <Layers className="w-5 h-5 text-sky-400" />
                <span>{plcForm.id ? 'تعديل المساحة الإعلانية' : 'إنشاء مساحة إعلانية قابلة للتوسعة'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPlcModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {plcError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-300 font-bold">
                {plcError}
              </div>
            )}

            <form onSubmit={(e) => void handleSavePlacement(e)} className="space-y-3 text-xs">
              <div>
                <label className="font-bold block mb-1">المعرف التقني للمساحة (English snake_case) *</label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  disabled={Boolean(plcForm.id)}
                  placeholder="مثال: mining_promo_custom_1"
                  value={plcForm.placementKey}
                  onChange={(e) => setPlcForm({ ...plcForm, placementKey: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-mono focus:outline-none disabled:opacity-60 ${inputSurface}`}
                />
              </div>

              <div>
                <label className="font-bold block mb-1">اسم المساحة بالعربية *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: مساحة توصيات الشركاء"
                  value={plcForm.titleAr}
                  onChange={(e) => setPlcForm({ ...plcForm, titleAr: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-semibold focus:outline-none ${inputSurface}`}
                />
              </div>

              <div>
                <label className="font-bold block mb-1">وصف مختصر</label>
                <input
                  type="text"
                  value={plcForm.descriptionAr}
                  onChange={(e) => setPlcForm({ ...plcForm, descriptionAr: e.target.value })}
                  className={`w-full rounded-xl px-3 py-2 font-semibold focus:outline-none ${inputSurface}`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold block mb-1">الصفحة المستهدفة (11 نطاقاً)</label>
                  <select
                    value={plcForm.pageScope}
                    onChange={(e) => setPlcForm({ ...plcForm, pageScope: e.target.value as MiningAdPageScope })}
                    className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                  >
                    {(Object.keys(PAGE_SCOPE_LABELS) as MiningAdPageScope[]).map((k) => (
                      <option key={k} value={k}>
                        {PAGE_SCOPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold block mb-1">نوع الوحدة الإعلانية (13 نوعاً)</label>
                  <select
                    value={plcForm.slotType}
                    onChange={(e) => setPlcForm({ ...plcForm, slotType: e.target.value as MiningAdSlotType })}
                    className={`w-full rounded-xl px-3 py-2 font-bold ${inputSurface}`}
                  >
                    {(Object.keys(SLOT_TYPE_LABELS) as MiningAdSlotType[]).map((k) => (
                      <option key={k} value={k}>
                        {SLOT_TYPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="font-bold block mb-1">العرض</label>
                  <input
                    type="number"
                    min={100}
                    max={1400}
                    value={plcForm.defaultWidth}
                    onChange={(e) => setPlcForm({ ...plcForm, defaultWidth: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">الارتفاع</label>
                  <input
                    type="number"
                    min={50}
                    max={900}
                    value={plcForm.defaultHeight}
                    onChange={(e) => setPlcForm({ ...plcForm, defaultHeight: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">أقصى عدد</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={plcForm.maxAds}
                    onChange={(e) => setPlcForm({ ...plcForm, maxAds: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">الترتيب</label>
                  <input
                    type="number"
                    value={plcForm.sortOrder}
                    onChange={(e) => setPlcForm({ ...plcForm, sortOrder: e.target.value })}
                    className={`w-full rounded-xl px-2.5 py-2 font-mono font-bold ${inputSurface}`}
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 font-bold cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={plcForm.isActive}
                  onChange={(e) => setPlcForm({ ...plcForm, isActive: e.target.checked })}
                />
                <span>تفعيل المساحة الإعلانية</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPlcModalOpen(false)}
                  className={`px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${subSurface}`}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingPlc}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer disabled:opacity-60"
                >
                  {savingPlc && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>حفظ المساحة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== STANDALONE SANDBOX PREVIEW MODAL ==================== */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-[#0F131C] border border-amber-500/35 p-5 space-y-4 text-white">
            <div className="flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-black flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>معاينة الإعلان المعزول: {previewTemplate.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <MiningAdTemplateCard template={previewTemplate} isPreview />
          </div>
        </div>
      )}
    </div>
  );
};
