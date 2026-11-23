import crypto from 'node:crypto';
import { getSupabaseAdminClient, getSupabaseUserClient } from './supabaseClient.js';
import type {
  AdCenterComfortSettings,
  AdCompletionRule,
  MiningAdDeviceTarget,
  MiningAdFormat,
  MiningAdPageScope,
  MiningAdPlacement,
  MiningAdSlotType,
  MiningAdTemplate,
  MiningAdTemplateType,
} from '../src/types/index.js';

export type {
  MiningAdTemplateType,
  MiningAdFormat,
  MiningAdDeviceTarget,
  MiningAdSlotType,
  MiningAdPageScope,
};

export const VALID_TEMPLATE_TYPES = new Set<MiningAdTemplateType>([
  'html',
  'javascript',
  'external_link',
  'video_player',
  'vast_url',
  'image_banner',
  'recommendation_widget',
  'network_code',
  'multi_format',
  'push_notification',
  'mixed',
]);

export const VALID_AD_FORMATS = new Set<MiningAdFormat>([
  'banner',
  'popunder',
  'instant_message',
  'sticky_banner',
  'desktop_interstitial',
  'mobile_banner',
  'mobile_sticky_banner',
  'mobile_interstitial',
  'instream_video',
  'invideo_banner',
  'video_slider',
  'outstream_video',
  'vertical_video',
  'recommendation_widget',
  'native_cards',
  'push_notification',
  'multi_format',
  'external_link',
]);

export const VALID_DEVICE_TARGETS = new Set<MiningAdDeviceTarget>(['all', 'desktop', 'mobile']);

import {
  DISPLAY_BANNER_FORMATS,
  NON_REWARDABLE_TEMPLATE_TYPES,
  REWARD_ELIGIBLE_AD_FORMATS,
  REWARD_ELIGIBLE_TEMPLATE_TYPES,
  extractAdZoneKey,
  isDisplayBannerTemplate,
  isRewardEligibleTemplate,
} from '../shared/miningAdBannerUtils.js';

export {
  DISPLAY_BANNER_FORMATS,
  NON_REWARDABLE_TEMPLATE_TYPES,
  REWARD_ELIGIBLE_AD_FORMATS,
  REWARD_ELIGIBLE_TEMPLATE_TYPES,
};

export function isDisplayBannerAd(params: {
  adFormat?: MiningAdFormat | string | null;
  sourceName?: string | null;
  codeContent?: string | null;
}): boolean {
  const fmt = String(params.adFormat || '').trim() as MiningAdFormat;
  return isDisplayBannerTemplate({
    adFormat: fmt,
    sourceName: params.sourceName ?? '',
    codeContent: params.codeContent ?? '',
  });
}

export function isRewardEligibleAd(params: {
  adFormat?: MiningAdFormat | string | null;
  templateType?: MiningAdTemplateType | string | null;
  sourceName?: string | null;
  codeContent?: string | null;
}): boolean {
  return isRewardEligibleTemplate(params);
}

export function extractAdZoneSignature(codeContent?: string | null, sourceName?: string | null): string | null {
  return extractAdZoneKey({
    codeContent: codeContent ?? '',
    sourceName: sourceName ?? '',
  });
}

export const VALID_SLOT_TYPES = new Set<MiningAdSlotType>([
  'banner',
  'between_tasks',
  'horizontal_strip',
  'video',
  'image',
  'link',
  'mixed',
  'recommendation',
  'sticky',
  'native',
  'push',
  'popunder',
  'extensible',
]);

export const VALID_PAGE_SCOPES = new Set<MiningAdPageScope>([
  'all',
  'mining_home',
  'mining_tasks',
  'banner_ads',
  'recommendation_ads',
  'video_ads',
  'link_ads',
  'mixed_ads',
  'push_notifications',
  'ad_templates',
  'ads_history',
]);

export const DEFAULT_COMFORT_SETTINGS: AdCenterComfortSettings = {
  popunderAutoDisabled: true,
  maxStickyAds: 1,
  maxAnimatedAdsInView: 1,
  cooldownAfterDismissSec: 120,
  minSpacingPx: 16,
  pushAdsEnabled: true,
  defaultSessionTtlSec: 900,
  defaultMaxDailyPerUser: 25,
  trackingEnabledByFormat: {
    banner: true,
    popunder: false,
    instant_message: true,
    sticky_banner: true,
    desktop_interstitial: true,
    mobile_banner: true,
    mobile_sticky_banner: true,
    mobile_interstitial: true,
    instream_video: true,
    invideo_banner: true,
    video_slider: true,
    outstream_video: true,
    vertical_video: true,
    recommendation_widget: true,
    native_cards: true,
    push_notification: true,
    multi_format: true,
    external_link: true,
  },
};

const PLACEMENT_KEY_REGEX = /^[a-z0-9_]{3,64}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MigrationRequiredError extends Error {
  migrationRequired = true;
  constructor(message: string) {
    super(message);
    this.name = 'MigrationRequiredError';
  }
}

export function defaultPlacementsSeed(): MiningAdPlacement[] {
  const now = new Date().toISOString();
  const defs: Array<Omit<MiningAdPlacement, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      placementKey: 'mining_top_banner',
      titleAr: 'بانر أعلى صفحة التعدين',
      descriptionAr: 'بانر أفقي مدمج أعلى منطقة منجم YT Coin بدون إعاقة النقر',
      pageScope: 'mining_home',
      slotType: 'banner',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 2,
      sortOrder: 10,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_recommendation_intro',
      titleAr: 'توصيات إعلانية أسفل المقدمة (Recommendation Widget)',
      descriptionAr: 'وحدة توصيات أصلية خفيفة أسفل مقدمة التعدين',
      pageScope: 'mining_home',
      slotType: 'recommendation',
      defaultWidth: 728,
      defaultHeight: 180,
      maxAds: 2,
      sortOrder: 15,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_arena_below',
      titleAr: 'مساحة وسط الصفحة (تحت منجم التعدين)',
      descriptionAr: 'مساحة متوسطة الأبعاد بين لوحة التعدين وإحصائيات المنصة',
      pageScope: 'mining_home',
      slotType: 'mixed',
      defaultWidth: 320,
      defaultHeight: 120,
      maxAds: 2,
      sortOrder: 20,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_between_cards_strip',
      titleAr: 'شريط إعلاني أفقي بين البطاقات',
      descriptionAr: 'شريط إعلاني مرن يظهر بين بطاقات المعدلات والسقف اليومي',
      pageScope: 'all',
      slotType: 'horizontal_strip',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 3,
      sortOrder: 30,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_between_tasks_1',
      titleAr: 'نافذة إعلانية بين مهمات التعدين (1)',
      descriptionAr: 'وحدة إعلانية تظهر بين صفوف مهمات التعدين اليومية',
      pageScope: 'mining_tasks',
      slotType: 'between_tasks',
      defaultWidth: 320,
      defaultHeight: 120,
      maxAds: 2,
      sortOrder: 40,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_between_tasks_2',
      titleAr: 'نافذة إعلانية بين مهمات التعدين (2)',
      descriptionAr: 'وحدة إعلانية ثانوية أسفل قائمة المهمات',
      pageScope: 'mining_tasks',
      slotType: 'between_tasks',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 2,
      sortOrder: 50,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_video_primary',
      titleAr: 'مساحة إعلانات الفيديو الرئيسية (VAST / Video)',
      descriptionAr: 'مشغل إعلانات الفيديو (In-Stream / Outstream) مع تتبع أحداث VAST',
      pageScope: 'video_ads',
      slotType: 'video',
      defaultWidth: 640,
      defaultHeight: 360,
      maxAds: 4,
      sortOrder: 60,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_video_mid',
      titleAr: 'مساحة فيديو وسط الصفحة (Video Slider)',
      descriptionAr: 'مساحة متجاوبة لمقاطع الفيديو الإعلانية الجانبية والمتوسطة',
      pageScope: 'video_ads',
      slotType: 'video',
      defaultWidth: 480,
      defaultHeight: 270,
      maxAds: 3,
      sortOrder: 65,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_video_secondary',
      titleAr: 'مساحة إعلانات الفيديو الإضافية',
      descriptionAr: 'وحدات فيديو ثانوية أو إعلانات مرافقة لقسم الفيديو',
      pageScope: 'video_ads',
      slotType: 'video',
      defaultWidth: 320,
      defaultHeight: 240,
      maxAds: 4,
      sortOrder: 70,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_mobile_vertical',
      titleAr: 'مساحة عمودية مخصصة للهواتف (Vertical / Mobile)',
      descriptionAr: 'وحدة عمودية متوافقة مع شاشات الجوال فقط',
      pageScope: 'all',
      slotType: 'sticky',
      defaultWidth: 320,
      defaultHeight: 480,
      maxAds: 2,
      sortOrder: 75,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_links_featured',
      titleAr: 'مساحة إعلانات الروابط المميزة',
      descriptionAr: 'إعلانات الروابط الخارجية والزيارات الموثقة',
      pageScope: 'link_ads',
      slotType: 'link',
      defaultWidth: 728,
      defaultHeight: 110,
      maxAds: 6,
      sortOrder: 80,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_banner_gallery',
      titleAr: 'معرض البانرات (Web & Mobile Banners)',
      descriptionAr: 'عرض منظم لإعلانات البانر الثابتة والمخصصة حسب نوع الجهاز',
      pageScope: 'banner_ads',
      slotType: 'banner',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 6,
      sortOrder: 85,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_image_gallery',
      titleAr: 'مساحات الإعلانات المصورة والبانرات',
      descriptionAr: 'شبكة بانرات وصور إعلانية متجاوبة مع الهواتف',
      pageScope: 'mixed_ads',
      slotType: 'image',
      defaultWidth: 320,
      defaultHeight: 250,
      maxAds: 6,
      sortOrder: 90,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_mixed_grid',
      titleAr: 'مساحة الإعلانات المختلطة (Multi Format)',
      descriptionAr: 'أكواد HTML وJavaScript وشبكات Multi Format المتكيفة',
      pageScope: 'mixed_ads',
      slotType: 'mixed',
      defaultWidth: 320,
      defaultHeight: 250,
      maxAds: 6,
      sortOrder: 100,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_mid_banner',
      titleAr: 'بانر وسط الصفحات الفرعية',
      descriptionAr: 'بانر متوسط الصفحة داخل أقسام مركز الإعلانات',
      pageScope: 'all',
      slotType: 'banner',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 3,
      sortOrder: 110,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_sticky_bottom',
      titleAr: 'بانر لاصق صغير قابل للإغلاق (Sticky Banner)',
      descriptionAr: 'شريط إعلاني صغير قابل للإغلاق باحترام التبريد دون إعاقة الأزرار',
      pageScope: 'all',
      slotType: 'sticky',
      defaultWidth: 320,
      defaultHeight: 60,
      maxAds: 1,
      sortOrder: 115,
      isActive: true,
      isSystem: true,
    },
    {
      placementKey: 'mining_bottom_banner',
      titleAr: 'مساحة إعلانية أسفل مركز التعدين',
      descriptionAr: 'بانر ختامي أسفل الصفحة متوافق مع شاشات الجوال',
      pageScope: 'all',
      slotType: 'extensible',
      defaultWidth: 728,
      defaultHeight: 90,
      maxAds: 3,
      sortOrder: 120,
      isActive: true,
      isSystem: true,
    },
  ];

  return defs.map((d) => ({
    ...d,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
}

export function isMissingTableOrColumnError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    code === 'PGRST202' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  );
}

function getActorClient(authToken?: string) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return getSupabaseAdminClient();
  }
  if (authToken) {
    return getSupabaseUserClient(authToken);
  }
  return getSupabaseAdminClient();
}

function inferAdFormat(tplType: MiningAdTemplateType, rawFormat: unknown): MiningAdFormat {
  const str = String(rawFormat || '').trim() as MiningAdFormat;
  if (VALID_AD_FORMATS.has(str)) return str;
  switch (tplType) {
    case 'vast_url':
    case 'video_player':
      return 'instream_video';
    case 'external_link':
      return 'external_link';
    case 'recommendation_widget':
      return 'recommendation_widget';
    case 'multi_format':
      return 'multi_format';
    case 'push_notification':
      return 'push_notification';
    default:
      return 'banner';
  }
}

function mapPlacementRow(row: any): MiningAdPlacement {
  const slotTypeRaw = String(row.slot_type ?? row.slotType ?? 'banner') as MiningAdSlotType;
  const pageScopeRaw = String(row.page_scope ?? row.pageScope ?? 'all') as MiningAdPageScope;
  return {
    id: String(row.id),
    placementKey: String(row.placement_key ?? row.placementKey ?? ''),
    titleAr: String(row.title_ar ?? row.titleAr ?? ''),
    descriptionAr: row.description_ar ?? row.descriptionAr ?? null,
    pageScope: VALID_PAGE_SCOPES.has(pageScopeRaw) ? pageScopeRaw : 'all',
    slotType: VALID_SLOT_TYPES.has(slotTypeRaw) ? slotTypeRaw : 'banner',
    defaultWidth: Math.min(1400, Math.max(100, Number(row.default_width ?? row.defaultWidth ?? 728))),
    defaultHeight: Math.min(900, Math.max(50, Number(row.default_height ?? row.defaultHeight ?? 90))),
    maxAds: Math.min(20, Math.max(1, Number(row.max_ads ?? row.maxAds ?? 3))),
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    isActive: Boolean(row.is_active ?? row.isActive ?? true),
    isSystem: Boolean(row.is_system ?? row.isSystem ?? false),
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? new Date().toISOString()),
  };
}

export function mapRuleRow(row: any): AdCompletionRule {
  return {
    id: row.id ? String(row.id) : undefined,
    templateId: row.template_id ?? row.templateId ?? null,
    adFormat: (row.ad_format ?? row.adFormat ?? null) as MiningAdFormat | null,
    trackingEnabled: Boolean(row.tracking_enabled ?? row.trackingEnabled ?? true),
    verificationMode: (row.verification_mode ?? row.verificationMode ?? 'dwell') as AdCompletionRule['verificationMode'],
    requiredWatchSec: Math.max(0, Math.min(600, Number(row.required_watch_sec ?? row.requiredWatchSec ?? 15))),
    requireActiveVisibility: Boolean(row.require_active_visibility ?? row.requireActiveVisibility ?? true),
    requiredVastEvents: Array.isArray(row.required_vast_events ?? row.requiredVastEvents)
      ? (row.required_vast_events ?? row.requiredVastEvents).map(String)
      : ['start', 'complete'],
    requireLinkReturn: Boolean(row.require_link_return ?? row.requireLinkReturn ?? false),
    requireServerPostback: Boolean(row.require_server_postback ?? row.requireServerPostback ?? false),
    sessionTtlSec: Math.max(60, Math.min(7200, Number(row.session_ttl_sec ?? row.sessionTtlSec ?? 900))),
    maxDailyPerUser: Math.max(0, Math.min(500, Number(row.max_daily_per_user ?? row.maxDailyPerUser ?? 20))),
    frequencyCapMinutes: Math.max(0, Math.min(1440, Number(row.frequency_cap_minutes ?? row.frequencyCapMinutes ?? 0))),
  };
}

export function mapComfortRow(row: any): AdCenterComfortSettings {
  if (!row || typeof row !== 'object') return { ...DEFAULT_COMFORT_SETTINGS };
  return {
    popunderAutoDisabled: Boolean(row.popunder_auto_disabled ?? row.popunderAutoDisabled ?? true),
    maxStickyAds: Math.max(0, Math.min(2, Number(row.max_sticky_ads ?? row.maxStickyAds ?? 1))),
    maxAnimatedAdsInView: Math.max(0, Math.min(3, Number(row.max_animated_ads_in_view ?? row.maxAnimatedAdsInView ?? 1))),
    cooldownAfterDismissSec: Math.max(0, Math.min(86400, Number(row.cooldown_after_dismiss_sec ?? row.cooldownAfterDismissSec ?? 120))),
    minSpacingPx: Math.max(8, Math.min(96, Number(row.min_spacing_px ?? row.minSpacingPx ?? 16))),
    pushAdsEnabled: Boolean(row.push_ads_enabled ?? row.pushAdsEnabled ?? true),
    defaultSessionTtlSec: Math.max(60, Math.min(7200, Number(row.default_session_ttl_sec ?? row.defaultSessionTtlSec ?? 900))),
    defaultMaxDailyPerUser: Math.max(0, Math.min(500, Number(row.default_max_daily_per_user ?? row.defaultMaxDailyPerUser ?? 25))),
    trackingEnabledByFormat:
      (row.tracking_enabled_by_format ?? row.trackingEnabledByFormat) &&
      typeof (row.tracking_enabled_by_format ?? row.trackingEnabledByFormat) === 'object'
        ? {
            ...DEFAULT_COMFORT_SETTINGS.trackingEnabledByFormat,
            ...(row.tracking_enabled_by_format ?? row.trackingEnabledByFormat),
          }
        : { ...DEFAULT_COMFORT_SETTINGS.trackingEnabledByFormat },
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapTemplateRow(row: any, rulesByTemplateId?: Map<string, AdCompletionRule>): MiningAdTemplate {
  const tplRaw = String(row.template_type ?? row.templateType ?? 'html') as MiningAdTemplateType;
  const templateType = VALID_TEMPLATE_TYPES.has(tplRaw) ? tplRaw : 'html';
  const evRaw = row.reward_event_type ?? row.rewardEventType ?? null;
  const deviceRaw = String(row.device_target ?? row.deviceTarget ?? 'all') as MiningAdDeviceTarget;
  const id = String(row.id);

  const adFormat = inferAdFormat(templateType, row.ad_format ?? row.adFormat);
  const sourceName = String(row.source_name ?? row.sourceName ?? '');
  const codeContent = String(row.code_content ?? row.codeContent ?? '');
  const isBanner = isDisplayBannerAd({ adFormat, sourceName, codeContent });
  const isRewardEligible = isRewardEligibleAd({ adFormat, templateType, sourceName, codeContent });
  const rawTrackingEnabled = row.tracking_enabled === undefined ? true : Boolean(row.tracking_enabled);

  return {
    id,
    title: String(row.title ?? ''),
    placementKey: String(row.placement_key ?? row.placementKey ?? ''),
    templateType,
    adFormat,
    deviceTarget: VALID_DEVICE_TARGETS.has(deviceRaw) ? deviceRaw : 'all',
    sourceName,
    codeContent,
    targetUrl: row.target_url ?? row.targetUrl ?? null,
    mediaUrl: row.media_url ?? row.mediaUrl ?? null,
    vastUrl: row.vast_url ?? row.vastUrl ?? null,
    ctaLabel: row.cta_label ?? row.ctaLabel ?? null,
    width: Math.min(1400, Math.max(100, Number(row.width ?? 320))),
    height: Math.min(900, Math.max(50, Number(row.height ?? 250))),
    priority: Number(row.priority ?? 10),
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    maxImpressions: Math.max(0, Number(row.max_impressions ?? row.maxImpressions ?? 0)),
    impressionsCount: Math.max(0, Number(row.impressions_count ?? row.impressionsCount ?? 0)),
    ytNetworkKey: isRewardEligible ? (row.yt_network_key ?? row.ytNetworkKey ?? null) : null,
    rewardEventType: isRewardEligible && (evRaw === 'click' || evRaw === 'view') ? evRaw : null,
    isDismissible: row.is_dismissible === undefined ? true : Boolean(row.is_dismissible),
    trackingEnabled: isBanner ? false : rawTrackingEnabled,
    isActive: Boolean(row.is_active ?? row.isActive ?? true),
    completionRule: rulesByTemplateId?.get(id) ?? null,
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? new Date().toISOString()),
  };
}

function validateSafeHttpUrl(raw: unknown, fieldLabel: string): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const val = String(raw).trim();
  if (val.length > 2000) throw new Error(`${fieldLabel} يتجاوز الطول المسموح (2000 حرف).`);
  if (!/^https?:\/\//i.test(val)) {
    throw new Error(`${fieldLabel} يجب أن يبدأ بـ https:// أو http://.`);
  }
  const lower = val.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:text/html')) {
    throw new Error(`${fieldLabel} يحتوي على بروتوكول غير مسموح.`);
  }
  return val;
}

export function validateCodeContent(
  rawCode: unknown,
  templateType: MiningAdTemplateType,
  adFormat?: MiningAdFormat
): string {
  const code = String(rawCode ?? '').trim();
  if (
    ['html', 'javascript', 'network_code', 'mixed', 'recommendation_widget', 'multi_format'].includes(templateType) &&
    !code
  ) {
    throw new Error('كود القالب الإعلاني مطلوب لهذا النوع.');
  }
  if (code.length > 64000) {
    throw new Error('حجم كود القالب يتجاوز الحد الأقصى (64 كيلوبايت).');
  }
  const lower = code.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:text/html')) {
    throw new Error('الكود يحتوي على بروتوكول غير آمن مرفوض.');
  }
  if (
    adFormat !== 'popunder' &&
    (/top\.location\s*=|window\.top\.location\s*=|parent\.location\s*=/i.test(code) ||
      /\bpopunder\b/i.test(code))
  ) {
    throw new Error('يُمنع استخدام أكواد Popunder أو إعادة التوجيه القسري حفاظاً على تجربة المستخدم.');
  }
  return code;
}

function assertHonestFormatCompatibility(params: {
  templateType: MiningAdTemplateType;
  adFormat: MiningAdFormat;
  targetUrl: string | null;
  mediaUrl: string | null;
  vastUrl: string | null;
  codeContent: string;
}) {
  if (params.templateType === 'external_link' && !params.targetUrl) {
    throw new Error('يرجى إدخال رابط خارجي صالح (HTTPS/HTTP) لإعلانات الروابط.');
  }
  if (params.templateType === 'vast_url' && !params.vastUrl && !params.mediaUrl) {
    throw new Error('يرجى إدخال رابط VAST XML صالح (HTTPS/HTTP) لهذا النوع.');
  }
  if (params.templateType === 'image_banner' && !params.mediaUrl && !params.codeContent) {
    throw new Error('يرجى إدخال رابط الصورة أو كود البانر.');
  }
  if (params.templateType === 'video_player' && !params.mediaUrl && !params.vastUrl && !params.codeContent) {
    throw new Error('يرجى إدخال رابط الفيديو المباشر أو رابط VAST أو كود مشغل الفيديو.');
  }
  if (params.templateType === 'recommendation_widget' && !params.codeContent && !params.targetUrl) {
    throw new Error('يرجى إدخال كود Recommendation Widget أو رابط التوصية المعتمد.');
  }
  if (params.templateType === 'multi_format' && !params.codeContent) {
    throw new Error('يرجى إدخال كود شبكة Multi Format الفعلي قبل التفعيل.');
  }
  if (
    ['instream_video', 'invideo_banner', 'video_slider', 'outstream_video', 'vertical_video'].includes(params.adFormat) &&
    !params.vastUrl &&
    !params.mediaUrl &&
    !params.codeContent
  ) {
    throw new Error('وحدات الفيديو وVAST تتطلب رابط VAST XML أو ملف فيديو أو كود مشغل فعلي (لا يدعم التوافق الوهمي).');
  }
}

function migrationMissingError(): MigrationRequiredError {
  return new MigrationRequiredError(
    'جداول مركز الإعلانات والتتبع غير مهيأة بعد في Supabase. يرجى مراجعة وتطبيق ملفات الترحيل: 20261126000000 و 20261127000000 أولاً — لم يتم حفظ التعديلات.'
  );
}

export const miningAdsService = {
  async getPublicData(filters?: {
    placementKey?: string;
    pageScope?: string;
    templateType?: string;
    deviceType?: string;
  }) {
    const reqDevice: 'desktop' | 'mobile' | null =
      filters?.deviceType === 'desktop' || filters?.deviceType === 'mobile' ? filters.deviceType : null;

    const filterEligible = (
      placements: MiningAdPlacement[],
      templates: MiningAdTemplate[],
      comfortSettings: AdCenterComfortSettings
    ) => {
      const activePlacements = placements
        .filter((p) => p.isActive)
        .filter((p) => !filters?.placementKey || p.placementKey === filters.placementKey)
        .filter((p) => !filters?.pageScope || p.pageScope === 'all' || p.pageScope === filters.pageScope)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const activeKeySet = new Set(activePlacements.map((p) => p.placementKey));

      const rawActiveTemplates = templates
        .filter((t) => t.isActive && activeKeySet.has(t.placementKey))
        // Enforce mandatory comfort policy: automatically block popunder when enabled
        .filter((t) => !(comfortSettings.popunderAutoDisabled && t.adFormat === 'popunder'))
        .filter((t) => !reqDevice || t.deviceTarget === 'all' || t.deviceTarget === reqDevice)
        .filter((t) => t.maxImpressions === 0 || t.impressionsCount < t.maxImpressions)
        .filter((t) => !filters?.placementKey || t.placementKey === filters.placementKey)
        .filter((t) => !filters?.templateType || t.templateType === filters.templateType)
        .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority);

      const seenZones = new Set<string>();
      const activeTemplates = rawActiveTemplates.filter((t) => {
        const zoneSig = extractAdZoneSignature(t.codeContent, t.sourceName);
        if (!zoneSig) return true;
        if (seenZones.has(zoneSig)) return false;
        seenZones.add(zoneSig);
        return true;
      });

      return { placements: activePlacements, templates: activeTemplates, comfortSettings };
    };

    try {
      const db = getSupabaseAdminClient();
      const [pRes, tRes, settingsRes, rulesRes] = await Promise.all([
        db
          .from('mining_ad_placements')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        db
          .from('mining_ad_templates')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('priority', { ascending: false }),
        db.from('ad_center_settings').select('*').eq('id', 1).maybeSingle(),
        db.from('ad_completion_rules').select('*'),
      ]);

      if (pRes.error || tRes.error) {
        const err = pRes.error || tRes.error;
        if (isMissingTableOrColumnError(err)) {
          return {
            ...filterEligible(defaultPlacementsSeed(), [], { ...DEFAULT_COMFORT_SETTINGS }),
            storageMode: 'unmigrated' as const,
          };
        }
        throw new Error(err?.message || 'تعذر جلب مساحات وقوالب الإعلانات.');
      }

      const comfortSettings = settingsRes.error
        ? { ...DEFAULT_COMFORT_SETTINGS }
        : mapComfortRow(settingsRes.data);

      const rulesByTpl = new Map<string, AdCompletionRule>();
      if (!rulesRes.error && Array.isArray(rulesRes.data)) {
        for (const r of rulesRes.data) {
          if (r.template_id) rulesByTpl.set(String(r.template_id), mapRuleRow(r));
        }
      }

      const placements = (pRes.data || []).map(mapPlacementRow);
      const templates = (tRes.data || []).map((row) => mapTemplateRow(row, rulesByTpl));
      return {
        ...filterEligible(placements, templates, comfortSettings),
        storageMode: 'supabase' as const,
      };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) {
        return {
          ...filterEligible(defaultPlacementsSeed(), [], { ...DEFAULT_COMFORT_SETTINGS }),
          storageMode: 'unmigrated' as const,
        };
      }
      throw err;
    }
  },

  async getAdminData(authToken?: string) {
    try {
      const db = getActorClient(authToken);
      const [pRes, tRes, settingsRes, rulesRes] = await Promise.all([
        db
          .from('mining_ad_placements')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        db
          .from('mining_ad_templates')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false }),
        db.from('ad_center_settings').select('*').eq('id', 1).maybeSingle(),
        db.from('ad_completion_rules').select('*'),
      ]);

      if (pRes.error || tRes.error) {
        const err = pRes.error || tRes.error;
        if (isMissingTableOrColumnError(err)) {
          return {
            placements: defaultPlacementsSeed(),
            templates: [] as MiningAdTemplate[],
            comfortSettings: { ...DEFAULT_COMFORT_SETTINGS },
            completionRules: [] as AdCompletionRule[],
            storageMode: 'unmigrated' as const,
          };
        }
        throw new Error(err?.message || 'تعذر جلب بيانات إدارة الإعلانات.');
      }

      const comfortSettings = settingsRes.error
        ? { ...DEFAULT_COMFORT_SETTINGS }
        : mapComfortRow(settingsRes.data);
      const completionRules =
        !rulesRes.error && Array.isArray(rulesRes.data) ? rulesRes.data.map(mapRuleRow) : [];
      const rulesByTpl = new Map<string, AdCompletionRule>();
      for (const r of completionRules) {
        if (r.templateId) rulesByTpl.set(r.templateId, r);
      }

      return {
        placements: (pRes.data || []).map(mapPlacementRow),
        templates: (tRes.data || []).map((row) => mapTemplateRow(row, rulesByTpl)),
        comfortSettings,
        completionRules,
        storageMode:
          settingsRes.error && isMissingTableOrColumnError(settingsRes.error)
            ? ('unmigrated' as const)
            : ('supabase' as const),
      };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) {
        return {
          placements: defaultPlacementsSeed(),
          templates: [] as MiningAdTemplate[],
          comfortSettings: { ...DEFAULT_COMFORT_SETTINGS },
          completionRules: [] as AdCompletionRule[],
          storageMode: 'unmigrated' as const,
        };
      }
      throw err;
    }
  },

  async upsertPlacement(
    params: {
      id?: string;
      placementKey: string;
      titleAr: string;
      descriptionAr?: string | null;
      pageScope: MiningAdPageScope;
      slotType: MiningAdSlotType;
      defaultWidth?: number;
      defaultHeight?: number;
      maxAds?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
    authToken?: string
  ) {
    const placementKey = String(params.placementKey || '').trim().toLowerCase();
    if (!PLACEMENT_KEY_REGEX.test(placementKey)) {
      throw new Error('معرف المساحة يجب أن يتكون من أحرف إنجليزية صغيرة وأرقام و(_) بطول 3–64 حرفاً.');
    }
    const titleAr = String(params.titleAr || '').trim();
    if (!titleAr || titleAr.length > 140) {
      throw new Error('عنوان المساحة مطلوب (بحد أقصى 140 حرفاً).');
    }
    const pageScope = VALID_PAGE_SCOPES.has(params.pageScope) ? params.pageScope : 'all';
    const slotType = VALID_SLOT_TYPES.has(params.slotType) ? params.slotType : 'extensible';
    const defaultWidth = Math.min(1400, Math.max(100, Math.round(Number(params.defaultWidth ?? 728) || 728)));
    const defaultHeight = Math.min(900, Math.max(50, Math.round(Number(params.defaultHeight ?? 90) || 90)));
    const maxAds = Math.min(20, Math.max(1, Math.round(Number(params.maxAds ?? 3) || 3)));
    const sortOrder = Math.round(Number(params.sortOrder ?? 0) || 0);
    const isActive = params.isActive !== false;
    const descriptionAr = params.descriptionAr ? String(params.descriptionAr).trim().slice(0, 300) : null;
    const now = new Date().toISOString();

    const db = getActorClient(authToken);
    const id = params.id && UUID_REGEX.test(params.id) ? params.id : undefined;

    try {
      if (id) {
        const { data, error } = await db
          .from('mining_ad_placements')
          .update({
            title_ar: titleAr,
            description_ar: descriptionAr,
            page_scope: pageScope,
            slot_type: slotType,
            default_width: defaultWidth,
            default_height: defaultHeight,
            max_ads: maxAds,
            sort_order: sortOrder,
            is_active: isActive,
            updated_at: now,
          })
          .eq('id', id)
          .select('*')
          .single();

        if (error) throw error;
        return { placement: mapPlacementRow(data), storageMode: 'supabase' as const };
      }

      const { data, error } = await db
        .from('mining_ad_placements')
        .upsert(
          {
            id: crypto.randomUUID(),
            placement_key: placementKey,
            title_ar: titleAr,
            description_ar: descriptionAr,
            page_scope: pageScope,
            slot_type: slotType,
            default_width: defaultWidth,
            default_height: defaultHeight,
            max_ads: maxAds,
            sort_order: sortOrder,
            is_active: isActive,
            is_system: false,
            created_at: now,
            updated_at: now,
          },
          { onConflict: 'placement_key' }
        )
        .select('*')
        .single();

      if (error) throw error;
      return { placement: mapPlacementRow(data), storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حفظ المساحة الإعلانية.');
    }
  },

  async deletePlacement(id: string, authToken?: string) {
    if (!UUID_REGEX.test(id)) throw new Error('معرف المساحة غير صالح.');
    const db = getActorClient(authToken);
    try {
      const { data: existing, error: fetchErr } = await db
        .from('mining_ad_placements')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (existing?.is_system) {
        throw new Error('لا يمكن حذف المساحات الأساسية؛ يمكنك تعطيلها مؤقتاً فقط.');
      }
      const { error } = await db.from('mining_ad_placements').delete().eq('id', id);
      if (error) throw error;
      return { success: true, storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حذف المساحة الإعلانية.');
    }
  },

  async createTemplate(
    params: {
      title: string;
      placementKey: string;
      templateType: MiningAdTemplateType;
      adFormat?: MiningAdFormat;
      deviceTarget?: MiningAdDeviceTarget;
      sourceName?: string;
      codeContent?: string;
      targetUrl?: string | null;
      mediaUrl?: string | null;
      vastUrl?: string | null;
      ctaLabel?: string | null;
      width?: number;
      height?: number;
      priority?: number;
      sortOrder?: number;
      maxImpressions?: number;
      ytNetworkKey?: string | null;
      rewardEventType?: 'view' | 'click' | null;
      isDismissible?: boolean;
      trackingEnabled?: boolean;
      isActive?: boolean;
      completionRule?: Partial<AdCompletionRule> | null;
      actorId: string;
    },
    authToken?: string
  ) {
    const title = String(params.title || '').trim();
    if (!title || title.length > 140) throw new Error('عنوان القالب الإعلاني مطلوب (بحد أقصى 140 حرفاً).');
    const placementKey = String(params.placementKey || '').trim().toLowerCase();
    if (!PLACEMENT_KEY_REGEX.test(placementKey)) throw new Error('مساحة العرض المختارة غير صالحة.');
    if (!VALID_TEMPLATE_TYPES.has(params.templateType)) throw new Error('نوع القالب الإعلاني غير صالح.');

    const adFormat = inferAdFormat(params.templateType, params.adFormat);
    const deviceTarget: MiningAdDeviceTarget =
      params.deviceTarget && VALID_DEVICE_TARGETS.has(params.deviceTarget) ? params.deviceTarget : 'all';

    const targetUrl = validateSafeHttpUrl(params.targetUrl, 'الرابط الخارجي');
    const mediaUrl = validateSafeHttpUrl(params.mediaUrl, 'رابط الوسائط (صورة/فيديو)');
    const vastUrl = validateSafeHttpUrl(params.vastUrl, 'رابط VAST XML');
    const codeContent = validateCodeContent(params.codeContent, params.templateType, adFormat);

    assertHonestFormatCompatibility({
      templateType: params.templateType,
      adFormat,
      targetUrl,
      mediaUrl,
      vastUrl,
      codeContent,
    });

    const width = Math.min(1400, Math.max(100, Math.round(Number(params.width ?? 320) || 320)));
    const height = Math.min(900, Math.max(50, Math.round(Number(params.height ?? 250) || 250)));
    const priority = Math.round(Number(params.priority ?? 10) || 10);
    const sortOrder = Math.round(Number(params.sortOrder ?? 0) || 0);
    const maxImpressions = Math.max(0, Math.round(Number(params.maxImpressions ?? 0) || 0));
    const sourceName = String(params.sourceName || '').trim().slice(0, 120);
    const ctaLabel = params.ctaLabel ? String(params.ctaLabel).trim().slice(0, 80) : null;

    const isBanner = isDisplayBannerAd({ adFormat, sourceName, codeContent });
    const isRewardEligible = isRewardEligibleAd({
      adFormat,
      templateType: params.templateType,
      sourceName,
      codeContent,
    });
    const requestedYtKey = params.ytNetworkKey ? String(params.ytNetworkKey).trim().toLowerCase() : null;
    if (isBanner && (requestedYtKey || params.completionRule?.requireServerPostback)) {
      throw new Error('إعلانات البانر للعرض فقط ومفصولة تماماً عن نظام المهام ومكافآت YT Coin (لا يمكن ربطها بشبكات المكافآت).');
    }
    if (!isRewardEligible && (requestedYtKey || params.completionRule?.requireServerPostback)) {
      throw new Error('مكافآت YT Coin وربط S2S مخصصة فقط لإعلانات الفيديو والروابط وما يشبهها (غير متاحة للبانرات والودجات والعروض الترويجية).');
    }

    const ytNetworkKey = isRewardEligible ? requestedYtKey : null;
    const rewardEventType =
      isRewardEligible && ytNetworkKey && (params.rewardEventType === 'click' || params.rewardEventType === 'view')
        ? params.rewardEventType
        : isRewardEligible && ytNetworkKey
          ? 'view'
          : null;
    const isDismissible = params.isDismissible !== false;
    const trackingEnabled = isBanner ? false : params.trackingEnabled !== false;
    const isActive = params.isActive !== false;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const db = getActorClient(authToken);
    try {
      const zoneSig = extractAdZoneSignature(codeContent, sourceName);
      if (zoneSig) {
        const zoneNum = zoneSig.replace(/^exoclick:zone:/, '');
        const { data: existingZoneRows } = await db
          .from('mining_ad_templates')
          .select('id, title, code_content, source_name')
          .limit(50);
        const dup = (existingZoneRows || []).find(
          (row: any) => extractAdZoneSignature(row.code_content, row.source_name) === zoneSig
        );
        if (dup) {
          throw new Error(`يوجد قالب مضاف مسبقاً لنفس المنطقة الإعلانية (${zoneNum} - ${dup.title}). يرجى تعديله أو نقله بدلاً من تكراره.`);
        }
      }

      const { data, error } = await db
        .from('mining_ad_templates')
        .insert({
          id,
          title,
          placement_key: placementKey,
          template_type: params.templateType,
          ad_format: adFormat,
          device_target: deviceTarget,
          source_name: sourceName,
          code_content: codeContent,
          target_url: targetUrl,
          media_url: mediaUrl,
          vast_url: vastUrl,
          cta_label: ctaLabel,
          width,
          height,
          priority,
          sort_order: sortOrder,
          max_impressions: maxImpressions,
          impressions_count: 0,
          yt_network_key: ytNetworkKey,
          reward_event_type: rewardEventType,
          is_dismissible: isDismissible,
          tracking_enabled: trackingEnabled,
          is_active: isActive,
          created_by: params.actorId,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();

      if (error) throw error;

      let ruleRecord: AdCompletionRule | null = null;
      if (params.completionRule) {
        const cr = params.completionRule;
        const requestedMode = isBanner
          ? 'impression_only'
          : cr.verificationMode || (adFormat === 'external_link' ? 'link_return' : 'dwell');
        const safeMode = !isRewardEligible && requestedMode === 's2s_postback' ? 'dwell' : requestedMode;
        const { data: ruleData, error: ruleErr } = await db
          .from('ad_completion_rules')
          .upsert(
            {
              template_id: id,
              ad_format: adFormat,
              tracking_enabled: isBanner ? false : (cr.trackingEnabled ?? trackingEnabled),
              verification_mode: safeMode,
              required_watch_sec: isBanner ? 0 : Math.max(0, Math.min(600, Math.round(Number(cr.requiredWatchSec ?? 15) || 0))),
              require_active_visibility: isBanner ? false : cr.requireActiveVisibility !== false,
              required_vast_events: Array.isArray(cr.requiredVastEvents) && cr.requiredVastEvents.length > 0
                ? cr.requiredVastEvents
                : ['start', 'complete'],
              require_link_return: isBanner ? false : Boolean(cr.requireLinkReturn),
              require_server_postback: isRewardEligible ? Boolean(cr.requireServerPostback) : false,
              session_ttl_sec: Math.max(60, Math.min(7200, Math.round(Number(cr.sessionTtlSec ?? 900) || 900))),
              max_daily_per_user: Math.max(0, Math.min(500, Math.round(Number(cr.maxDailyPerUser ?? 20) || 20))),
              frequency_cap_minutes: Math.max(0, Math.min(1440, Math.round(Number(cr.frequencyCapMinutes ?? 0) || 0))),
              updated_at: now,
            },
            { onConflict: 'template_id' }
          )
          .select('*')
          .single();
        if (ruleErr && !isMissingTableOrColumnError(ruleErr)) throw ruleErr;
        if (ruleData) ruleRecord = mapRuleRow(ruleData);
      }

      const map = new Map<string, AdCompletionRule>();
      if (ruleRecord) map.set(id, ruleRecord);
      return { template: mapTemplateRow(data, map), storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حفظ القالب الإعلاني.');
    }
  },

  async updateTemplate(
    id: string,
    params: Partial<{
      title: string;
      placementKey: string;
      templateType: MiningAdTemplateType;
      adFormat: MiningAdFormat;
      deviceTarget: MiningAdDeviceTarget;
      sourceName: string;
      codeContent: string;
      targetUrl: string | null;
      mediaUrl: string | null;
      vastUrl: string | null;
      ctaLabel: string | null;
      width: number;
      height: number;
      priority: number;
      sortOrder: number;
      maxImpressions: number;
      ytNetworkKey: string | null;
      rewardEventType: 'view' | 'click' | null;
      isDismissible: boolean;
      trackingEnabled: boolean;
      isActive: boolean;
      completionRule: Partial<AdCompletionRule> | null;
    }>,
    authToken?: string
  ) {
    if (!UUID_REGEX.test(id)) throw new Error('معرف القالب غير صالح.');
    const now = new Date().toISOString();
    const updates: Record<string, any> = { updated_at: now };

    if (params.title !== undefined) {
      const t = String(params.title).trim();
      if (!t || t.length > 140) throw new Error('عنوان القالب غير صالح.');
      updates.title = t;
    }
    if (params.placementKey !== undefined) {
      const pk = String(params.placementKey).trim().toLowerCase();
      if (!PLACEMENT_KEY_REGEX.test(pk)) throw new Error('معرف مساحة العرض غير صالح.');
      updates.placement_key = pk;
    }
    if (params.templateType !== undefined) {
      if (!VALID_TEMPLATE_TYPES.has(params.templateType)) throw new Error('نوع القالب غير صالح.');
      updates.template_type = params.templateType;
    }
    if (params.adFormat !== undefined) {
      if (!VALID_AD_FORMATS.has(params.adFormat)) throw new Error('تنسيق الإعلان غير صالح.');
      updates.ad_format = params.adFormat;
    }
    if (params.deviceTarget !== undefined) {
      if (!VALID_DEVICE_TARGETS.has(params.deviceTarget)) throw new Error('استهداف الجهاز غير صالح.');
      updates.device_target = params.deviceTarget;
    }
    if (params.sourceName !== undefined) {
      updates.source_name = String(params.sourceName).trim().slice(0, 120);
    }
    if (params.targetUrl !== undefined) {
      updates.target_url = validateSafeHttpUrl(params.targetUrl, 'الرابط الخارجي');
    }
    if (params.mediaUrl !== undefined) {
      updates.media_url = validateSafeHttpUrl(params.mediaUrl, 'رابط الوسائط');
    }
    if (params.vastUrl !== undefined) {
      updates.vast_url = validateSafeHttpUrl(params.vastUrl, 'رابط VAST XML');
    }
    if (params.ctaLabel !== undefined) {
      updates.cta_label = params.ctaLabel ? String(params.ctaLabel).trim().slice(0, 80) : null;
    }
    if (params.codeContent !== undefined) {
      updates.code_content = validateCodeContent(params.codeContent, params.templateType || 'html');
    }
    if (params.width !== undefined) {
      updates.width = Math.min(1400, Math.max(100, Math.round(Number(params.width) || 320)));
    }
    if (params.height !== undefined) {
      updates.height = Math.min(900, Math.max(50, Math.round(Number(params.height) || 250)));
    }
    if (params.priority !== undefined) {
      updates.priority = Math.round(Number(params.priority) || 0);
    }
    if (params.sortOrder !== undefined) {
      updates.sort_order = Math.round(Number(params.sortOrder) || 0);
    }
    if (params.maxImpressions !== undefined) {
      updates.max_impressions = Math.max(0, Math.round(Number(params.maxImpressions) || 0));
    }
    if (params.ytNetworkKey !== undefined) {
      updates.yt_network_key = params.ytNetworkKey ? String(params.ytNetworkKey).trim().toLowerCase() : null;
    }
    if (params.rewardEventType !== undefined) {
      updates.reward_event_type =
        params.rewardEventType === 'click' || params.rewardEventType === 'view' ? params.rewardEventType : null;
    }
    if (params.isDismissible !== undefined) {
      updates.is_dismissible = Boolean(params.isDismissible);
    }
    if (params.trackingEnabled !== undefined) {
      updates.tracking_enabled = Boolean(params.trackingEnabled);
    }
    if (params.isActive !== undefined) {
      updates.is_active = Boolean(params.isActive);
    }

    const db = getActorClient(authToken);
    try {
      const { data: existingTpl, error: existingErr } = await db
        .from('mining_ad_templates')
        .select('*')
        .eq('id', id)
        .single();
      if (existingErr) throw existingErr;

      const effTemplateType = (updates.template_type ?? existingTpl.template_type) as MiningAdTemplateType;
      const effFormat = (updates.ad_format ?? existingTpl.ad_format) as MiningAdFormat;
      const effSource = String(updates.source_name ?? existingTpl.source_name ?? '');
      const effCode =
        updates.code_content !== undefined
          ? validateCodeContent(updates.code_content, effTemplateType, effFormat)
          : String(existingTpl.code_content ?? '');
      if (updates.code_content !== undefined) {
        updates.code_content = effCode;
      }

      const effIsBanner = isDisplayBannerAd({ adFormat: effFormat, sourceName: effSource, codeContent: effCode });
      const effRewardEligible = isRewardEligibleAd({
        adFormat: effFormat,
        templateType: effTemplateType,
        sourceName: effSource,
        codeContent: effCode,
      });
      const reqYtKey = updates.yt_network_key !== undefined ? updates.yt_network_key : null;
      if (effIsBanner && (reqYtKey || params.completionRule?.requireServerPostback)) {
        throw new Error('إعلانات البانر للعرض فقط ومفصولة تماماً عن نظام المهام ومكافآت YT Coin.');
      }
      if (!effRewardEligible && (reqYtKey || params.completionRule?.requireServerPostback)) {
        throw new Error('مكافآت YT Coin وربط S2S مخصصة فقط لإعلانات الفيديو والروابط وما يشبهها.');
      }

      const effZoneSig = extractAdZoneSignature(effCode, effSource);
      if (effZoneSig && updates.code_content !== undefined) {
        const { data: allRows } = await db
          .from('mining_ad_templates')
          .select('id, title, code_content, source_name')
          .neq('id', id)
          .limit(50);
        const dup = (allRows || []).find(
          (row: any) => extractAdZoneSignature(row.code_content, row.source_name) === effZoneSig
        );
        if (dup) {
          throw new Error(`يوجد قالب آخر لنفس المنطقة الإعلانية (${dup.title}).`);
        }
      }

      if (effIsBanner) {
        updates.yt_network_key = null;
        updates.reward_event_type = null;
        updates.tracking_enabled = false;
      } else if (!effRewardEligible) {
        updates.yt_network_key = null;
        updates.reward_event_type = null;
      }

      const { data, error } = await db
        .from('mining_ad_templates')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;

      let ruleRecord: AdCompletionRule | null = null;
      if (params.completionRule) {
        const cr = params.completionRule;
        const requestedMode = effIsBanner ? 'impression_only' : (cr.verificationMode || 'dwell');
        const safeMode = !effRewardEligible && requestedMode === 's2s_postback' ? 'dwell' : requestedMode;
        const { data: ruleData, error: ruleErr } = await db
          .from('ad_completion_rules')
          .upsert(
            {
              template_id: id,
              ad_format: data.ad_format,
              tracking_enabled: effIsBanner ? false : (cr.trackingEnabled ?? Boolean(data.tracking_enabled)),
              verification_mode: safeMode,
              required_watch_sec: effIsBanner ? 0 : Math.max(0, Math.min(600, Math.round(Number(cr.requiredWatchSec ?? 15) || 0))),
              require_active_visibility: effIsBanner ? false : cr.requireActiveVisibility !== false,
              required_vast_events: Array.isArray(cr.requiredVastEvents) && cr.requiredVastEvents.length > 0
                ? cr.requiredVastEvents
                : ['start', 'complete'],
              require_link_return: effIsBanner ? false : Boolean(cr.requireLinkReturn),
              require_server_postback: effRewardEligible ? Boolean(cr.requireServerPostback) : false,
              session_ttl_sec: Math.max(60, Math.min(7200, Math.round(Number(cr.sessionTtlSec ?? 900) || 900))),
              max_daily_per_user: Math.max(0, Math.min(500, Math.round(Number(cr.maxDailyPerUser ?? 20) || 20))),
              frequency_cap_minutes: Math.max(0, Math.min(1440, Math.round(Number(cr.frequencyCapMinutes ?? 0) || 0))),
              updated_at: now,
            },
            { onConflict: 'template_id' }
          )
          .select('*')
          .single();
        if (ruleErr && !isMissingTableOrColumnError(ruleErr)) throw ruleErr;
        if (ruleData) ruleRecord = mapRuleRow(ruleData);
      }

      const map = new Map<string, AdCompletionRule>();
      if (ruleRecord) map.set(id, ruleRecord);
      return { template: mapTemplateRow(data, map), storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر تحديث القالب الإعلاني.');
    }
  },

  async deleteTemplate(id: string, authToken?: string) {
    if (!UUID_REGEX.test(id)) throw new Error('معرف القالب غير صالح.');
    const db = getActorClient(authToken);
    try {
      const { error } = await db.from('mining_ad_templates').delete().eq('id', id);
      if (error) throw error;
      return { success: true, storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حذف القالب الإعلاني.');
    }
  },

  async saveComfortSettings(
    params: Partial<AdCenterComfortSettings> & { actorId?: string },
    authToken?: string
  ) {
    const now = new Date().toISOString();
    const cleanSettings: Record<string, any> = {
      id: 1,
      updated_at: now,
      ...(params.actorId && UUID_REGEX.test(params.actorId) ? { updated_by: params.actorId } : {}),
    };
    if (params.popunderAutoDisabled !== undefined) cleanSettings.popunder_auto_disabled = Boolean(params.popunderAutoDisabled);
    if (params.maxStickyAds !== undefined) cleanSettings.max_sticky_ads = Math.max(0, Math.min(2, Math.round(Number(params.maxStickyAds) || 0)));
    if (params.maxAnimatedAdsInView !== undefined) {
      cleanSettings.max_animated_ads_in_view = Math.max(0, Math.min(3, Math.round(Number(params.maxAnimatedAdsInView) || 0)));
    }
    if (params.cooldownAfterDismissSec !== undefined) {
      cleanSettings.cooldown_after_dismiss_sec = Math.max(0, Math.min(86400, Math.round(Number(params.cooldownAfterDismissSec) || 0)));
    }
    if (params.minSpacingPx !== undefined) {
      cleanSettings.min_spacing_px = Math.max(8, Math.min(96, Math.round(Number(params.minSpacingPx) || 16)));
    }
    if (params.pushAdsEnabled !== undefined) cleanSettings.push_ads_enabled = Boolean(params.pushAdsEnabled);
    if (params.defaultSessionTtlSec !== undefined) {
      cleanSettings.default_session_ttl_sec = Math.max(60, Math.min(7200, Math.round(Number(params.defaultSessionTtlSec) || 900)));
    }
    if (params.defaultMaxDailyPerUser !== undefined) {
      cleanSettings.default_max_daily_per_user = Math.max(0, Math.min(500, Math.round(Number(params.defaultMaxDailyPerUser) || 25)));
    }
    if (params.trackingEnabledByFormat && typeof params.trackingEnabledByFormat === 'object') {
      cleanSettings.tracking_enabled_by_format = params.trackingEnabledByFormat;
    }

    const db = getActorClient(authToken);
    try {
      const { data, error } = await db
        .from('ad_center_settings')
        .upsert(cleanSettings, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw error;
      return { comfortSettings: mapComfortRow(data), storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حفظ إعدادات الراحة والتتبع في قاعدة البيانات.');
    }
  },

  async saveFormatDefaultRule(rule: Partial<AdCompletionRule> & { adFormat: MiningAdFormat }, authToken?: string) {
    if (!VALID_AD_FORMATS.has(rule.adFormat)) {
      throw new Error('نوع الإعلان المحدد للقاعدة غير صالح.');
    }
    const isBannerFmt = DISPLAY_BANNER_FORMATS.has(rule.adFormat);
    const isRewardEligibleFmt = REWARD_ELIGIBLE_AD_FORMATS.has(rule.adFormat);
    if (isBannerFmt && rule.requireServerPostback) {
      throw new Error('إعلانات البانر للعرض فقط ومفصولة عن مكافآت YT Coin (S2S).');
    }
    if (!isRewardEligibleFmt && (rule.requireServerPostback || rule.verificationMode === 's2s_postback')) {
      throw new Error('مكافآت YT Coin (S2S) مخصصة فقط لإعلانات الفيديو والروابط وما يشبهها.');
    }

    const db = getActorClient(authToken);
    const now = new Date().toISOString();
    try {
      // Check existing default rule for this format
      const { data: existing } = await db
        .from('ad_completion_rules')
        .select('id')
        .is('template_id', null)
        .eq('ad_format', rule.adFormat)
        .maybeSingle();

      const safeMode = isBannerFmt
        ? 'impression_only'
        : !isRewardEligibleFmt && rule.verificationMode === 's2s_postback'
          ? 'dwell'
          : (rule.verificationMode || 'dwell');

      const payload = {
        template_id: null,
        ad_format: rule.adFormat,
        tracking_enabled: isBannerFmt ? false : rule.trackingEnabled !== false,
        verification_mode: safeMode,
        required_watch_sec: isBannerFmt ? 0 : Math.max(0, Math.min(600, Math.round(Number(rule.requiredWatchSec ?? 15) || 0))),
        require_active_visibility: isBannerFmt ? false : rule.requireActiveVisibility !== false,
        required_vast_events:
          Array.isArray(rule.requiredVastEvents) && rule.requiredVastEvents.length > 0
            ? rule.requiredVastEvents
            : ['start', 'complete'],
        require_link_return: isBannerFmt ? false : Boolean(rule.requireLinkReturn),
        require_server_postback: isRewardEligibleFmt ? Boolean(rule.requireServerPostback) : false,
        session_ttl_sec: Math.max(60, Math.min(7200, Math.round(Number(rule.sessionTtlSec ?? 900) || 900))),
        max_daily_per_user: Math.max(0, Math.min(500, Math.round(Number(rule.maxDailyPerUser ?? 20) || 20))),
        frequency_cap_minutes: Math.max(0, Math.min(1440, Math.round(Number(rule.frequencyCapMinutes ?? 0) || 0))),
        updated_at: now,
      };

      const query = existing?.id
        ? db.from('ad_completion_rules').update(payload).eq('id', existing.id).select('*').single()
        : db.from('ad_completion_rules').insert(payload).select('*').single();

      const { data, error } = await query;
      if (error) throw error;
      return { rule: mapRuleRow(data), storageMode: 'supabase' as const };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) throw migrationMissingError();
      throw new Error(err?.message || 'تعذر حفظ شروط التحقق الافتراضية للنوع.');
    }
  },

  async trackImpression(templateId: string) {
    if (!UUID_REGEX.test(templateId)) return { tracked: false, impressionsCount: 0 };
    try {
      const db = getSupabaseAdminClient();
      const { data, error } = await db.rpc('increment_mining_ad_impression', {
        p_template_id: templateId,
      });
      if (error) {
        return { tracked: false, impressionsCount: 0 };
      }
      return { tracked: Number(data || 0) > 0, impressionsCount: Number(data || 0) };
    } catch {
      return { tracked: false, impressionsCount: 0 };
    }
  },
};
