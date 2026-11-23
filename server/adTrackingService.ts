import crypto from 'node:crypto';
import { getSupabaseAdminClient, getSupabaseUserClient } from './supabaseClient.js';
import {
  DEFAULT_COMFORT_SETTINGS,
  MigrationRequiredError,
  isMissingTableOrColumnError,
  mapComfortRow,
  mapRuleRow,
} from './miningAdsService.js';
import type {
  AdCenterComfortSettings,
  AdCompletionRule,
  AdTrackingEventName,
  AdTrackingRiskFlag,
  AdTrackingSessionRecord,
  AdVerificationMode,
  AdminAdTrackingReport,
  MiningAdFormat,
  PushAdPreference,
} from '../src/types/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_EVENTS = new Set<AdTrackingEventName>([
  'impression',
  'view_start',
  'heartbeat',
  'visibility_hidden',
  'visibility_visible',
  'vast_impression',
  'vast_start',
  'vast_firstQuartile',
  'vast_midpoint',
  'vast_thirdQuartile',
  'vast_complete',
  'vast_clickThrough',
  'vast_error',
  'click',
  'external_open',
  'external_return',
  'dismiss',
  'complete_attempt',
  'complete_verified',
  'complete_rejected',
  'reward_approved',
  'reward_rejected',
  'error',
]);

// Required logical progression of VAST milestones (vast_error or impression allowed anytime)
const VAST_STAGE_ORDER: Record<string, number> = {
  impression: 0,
  start: 1,
  firstQuartile: 2,
  midpoint: 3,
  thirdQuartile: 4,
  complete: 5,
};

export interface AdTemplateLookupRecord {
  id: string;
  title: string;
  placementKey: string;
  adFormat: MiningAdFormat;
  ytNetworkKey: string | null;
  targetUrl: string | null;
  isActive: boolean;
  trackingEnabled: boolean;
}

export interface StoredTrackingSession extends AdTrackingSessionRecord {
  sessionTokenHash: string;
  clientFingerprintHash: string | null;
  requireActiveVisibility: boolean;
  requiredVastEvents: string[];
  requireLinkReturn: boolean;
  requireServerPostback: boolean;
}

export interface AdTrackingEventInsert {
  sessionId: string;
  userId: string | null;
  templateId: string | null;
  networkKey: string | null;
  adFormat: string;
  eventName: AdTrackingEventName;
  clientElapsedSec: number;
  serverDeltaSec: number;
  isVisible: boolean;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface AdTrackingStore {
  getComfortSettings(): Promise<AdCenterComfortSettings>;
  getTemplateById(templateId: string): Promise<AdTemplateLookupRecord | null>;
  getCompletionRule(templateId: string | null, adFormat: MiningAdFormat): Promise<AdCompletionRule>;
  countUserDailySessions(userId: string, templateId: string, sinceIso: string): Promise<number>;
  getLastUserTemplateSession(userId: string, templateId: string): Promise<StoredTrackingSession | null>;
  insertSession(session: StoredTrackingSession): Promise<void>;
  getSessionById(sessionId: string): Promise<StoredTrackingSession | null>;
  updateSession(sessionId: string, patch: Partial<StoredTrackingSession>): Promise<StoredTrackingSession>;
  insertEvent(event: AdTrackingEventInsert): Promise<void>;
  insertRiskFlag(flag: Omit<AdTrackingRiskFlag, 'id'>): Promise<void>;
  getPostbackByExternalId(networkKey: string, providerEventId: string): Promise<{ id: string } | null>;
  insertPostbackAudit(entry: {
    networkKey: string;
    providerEventId: string;
    trackingSessionId: string | null;
    ytAdSessionId: string | null;
    userId: string | null;
    signatureValid: boolean;
    processingStatus: 'received' | 'credited' | 'duplicate' | 'rejected';
    rejectionReason: string | null;
    sanitizedPayload: Record<string, any>;
    receivedAt: string;
  }): Promise<void>;
  hasSessionYtRewardClaim(claimId: string): Promise<boolean>;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function defaultRuleForFormat(adFormat: MiningAdFormat, settings: AdCenterComfortSettings): AdCompletionRule {
  const isVideo = ['instream_video', 'invideo_banner', 'video_slider', 'outstream_video', 'vertical_video'].includes(adFormat);
  const isLink = adFormat === 'external_link';
  return {
    adFormat,
    trackingEnabled: settings.trackingEnabledByFormat[adFormat] !== false,
    verificationMode: isVideo ? 'vast' : isLink ? 'link_return' : 'dwell',
    requiredWatchSec: isVideo ? 15 : isLink ? 0 : 15,
    requireActiveVisibility: true,
    requiredVastEvents: isVideo ? ['start', 'complete'] : [],
    requireLinkReturn: isLink,
    requireServerPostback: isLink,
    sessionTtlSec: settings.defaultSessionTtlSec || 900,
    maxDailyPerUser: settings.defaultMaxDailyPerUser || 25,
    frequencyCapMinutes: 0,
  };
}

// Per-user / IP sliding window rate limiter for tracking endpoints
const rateLimitBuckets = new Map<string, number[]>();

export function checkTrackingRateLimit(key: string, maxRequests = 40, windowMs = 60_000, nowMs = Date.now()): boolean {
  const cutoff = nowMs - windowMs;
  const arr = (rateLimitBuckets.get(key) || []).filter((t) => t > cutoff);
  if (arr.length >= maxRequests) {
    rateLimitBuckets.set(key, arr);
    return false;
  }
  arr.push(nowMs);
  rateLimitBuckets.set(key, arr);
  return true;
}

/**
 * Pure, Deterministic Server-Side Tracking & Anti-Fraud Engine.
 * Zero dependency on client timers; uses server wall clock (`now()`).
 */
export class AdTrackingEngine {
  constructor(
    private readonly store: AdTrackingStore,
    private readonly now: () => number = () => Date.now()
  ) {}

  async startSession(input: {
    userId: string;
    templateId: string;
    deviceType?: 'desktop' | 'mobile';
    clientFingerprint?: string;
    ytAdSessionId?: string | null;
  }): Promise<{
    session: AdTrackingSessionRecord;
    sessionToken: string;
    trackingEnabled: boolean;
  }> {
    if (!input.userId || !UUID_REGEX.test(input.userId)) {
      throw new Error('جلسة المستخدم مطلوبة لبدء التتبع.');
    }
    if (!input.templateId || !UUID_REGEX.test(input.templateId)) {
      await this.store.insertRiskFlag({
        sessionId: null,
        userId: input.userId,
        templateId: null,
        flagType: 'forged_template_id',
        severity: 'high',
        details: { providedTemplateId: String(input.templateId || '') },
        createdAt: new Date(this.now()).toISOString(),
      });
      throw new Error('معرّف الإعلان غير صالح.');
    }

    const template = await this.store.getTemplateById(input.templateId);
    if (!template || !template.isActive) {
      await this.store.insertRiskFlag({
        sessionId: null,
        userId: input.userId,
        templateId: null,
        flagType: 'forged_template_id',
        severity: 'high',
        details: { providedTemplateId: input.templateId, reason: 'not_found_or_inactive' },
        createdAt: new Date(this.now()).toISOString(),
      });
      throw new Error('هذا الإعلان غير موجود أو متوقف حالياً.');
    }

    const settings = await this.store.getComfortSettings();
    if (settings.popunderAutoDisabled && template.adFormat === 'popunder') {
      throw new Error('إعلانات Popunder معطّلة تلقائياً وفق سياسة راحة المستخدم.');
    }
    if (template.adFormat === 'push_notification' && !settings.pushAdsEnabled) {
      throw new Error('إعلانات الإشعارات الاختيارية معطّلة حالياً من إعدادات المركز.');
    }

    const rule = await this.store.getCompletionRule(template.id, template.adFormat);
    const formatTrackingAllowed = settings.trackingEnabledByFormat?.[template.adFormat] !== false;
    const trackingEnabled = formatTrackingAllowed && template.trackingEnabled && rule.trackingEnabled;
    if (!trackingEnabled) {
      throw new Error('التتبع معطّل حالياً لهذا النوع الإعلاني من لوحة الإدارة.');
    }

    const nowMs = this.now();
    const dayStartIso = new Date(nowMs);
    dayStartIso.setUTCHours(0, 0, 0, 0);

    if (rule.maxDailyPerUser > 0) {
      const todayCount = await this.store.countUserDailySessions(input.userId, template.id, dayStartIso.toISOString());
      if (todayCount >= rule.maxDailyPerUser) {
        await this.store.insertRiskFlag({
          sessionId: null,
          userId: input.userId,
          templateId: template.id,
          flagType: 'velocity_anomaly',
          severity: 'medium',
          details: { todayCount, maxDailyPerUser: rule.maxDailyPerUser },
          createdAt: new Date(nowMs).toISOString(),
        });
        throw new Error(`تم بلوغ الحد اليومي لهذا الإعلان (${rule.maxDailyPerUser} مرة يومياً).`);
      }
    }

    if (rule.frequencyCapMinutes > 0) {
      const last = await this.store.getLastUserTemplateSession(input.userId, template.id);
      if (last) {
        const lastMs = new Date(last.startedAt).getTime();
        const elapsedMin = (nowMs - lastMs) / 60_000;
        if (elapsedMin < rule.frequencyCapMinutes) {
          const waitMin = Math.ceil(rule.frequencyCapMinutes - elapsedMin);
          throw new Error(`يرجى الانتظار ${waitMin} دقيقة قبل إعادة تشغيل هذا الإعلان.`);
        }
      }
    }

    const sessionId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const startedIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + rule.sessionTtlSec * 1000).toISOString();
    const deviceType: 'desktop' | 'mobile' = input.deviceType === 'desktop' ? 'desktop' : 'mobile';

    const session: StoredTrackingSession = {
      id: sessionId,
      sessionTokenHash: hashToken(rawToken),
      userId: input.userId,
      templateId: template.id,
      templateTitle: template.title,
      placementKey: template.placementKey,
      networkKey: template.ytNetworkKey,
      adFormat: template.adFormat,
      deviceType,
      verificationMode: rule.verificationMode,
      requiredWatchSec: rule.requiredWatchSec,
      startedAt: startedIso,
      lastActivityAt: startedIso,
      activeDurationSec: 0,
      exitAt: null,
      returnAt: null,
      vastMilestones: [],
      sessionStatus: 'started',
      verificationStatus: 'pending',
      eligibilityResult: 'pending',
      rejectionReason: null,
      ytAdSessionId: input.ytAdSessionId ?? null,
      ytRewardClaimId: null,
      expiresAt: expiresIso,
      completedAt: null,
      createdAt: startedIso,
      clientFingerprintHash: input.clientFingerprint ? hashToken(input.clientFingerprint) : null,
      requireActiveVisibility: rule.requireActiveVisibility,
      requiredVastEvents: rule.requiredVastEvents,
      requireLinkReturn: rule.requireLinkReturn,
      requireServerPostback: rule.requireServerPostback,
    };

    await this.store.insertSession(session);
    await this.store.insertEvent({
      sessionId,
      userId: input.userId,
      templateId: template.id,
      networkKey: template.ytNetworkKey,
      adFormat: template.adFormat,
      eventName: 'view_start',
      clientElapsedSec: 0,
      serverDeltaSec: 0,
      isVisible: true,
      metadata: { deviceType, verificationMode: rule.verificationMode },
      createdAt: startedIso,
    });

    return {
      session: this.toPublicSession(session),
      sessionToken: rawToken,
      trackingEnabled: true,
    };
  }

  private async verifyAuthorizedSession(params: {
    sessionId: string;
    userId: string;
    sessionToken?: string;
  }): Promise<StoredTrackingSession> {
    if (!UUID_REGEX.test(params.sessionId)) {
      throw new Error('معرّف جلسة التتبع غير صالح.');
    }
    const session = await this.store.getSessionById(params.sessionId);
    if (!session || session.userId !== params.userId) {
      throw new Error('جلسة التتبع غير موجودة أو لا تنتمي لحسابك.');
    }
    if (params.sessionToken && session.sessionTokenHash !== hashToken(params.sessionToken)) {
      throw new Error('رمز تحقق جلسة التتبع غير صالح.');
    }
    return session;
  }

  private async checkExpiration(session: StoredTrackingSession, nowMs: number): Promise<boolean> {
    const expMs = new Date(session.expiresAt).getTime();
    if (nowMs > expMs) {
      await this.store.updateSession(session.id, {
        sessionStatus: 'expired',
        verificationStatus: 'failed',
        eligibilityResult: 'rejected',
        rejectionReason: 'انتهت صلاحية جلسة التتبع.',
      });
      await this.store.insertRiskFlag({
        sessionId: session.id,
        userId: session.userId,
        templateId: session.templateId,
        flagType: 'expired_session',
        severity: 'low',
        details: { expiresAt: session.expiresAt, attemptedAt: new Date(nowMs).toISOString() },
        createdAt: new Date(nowMs).toISOString(),
      });
      return true;
    }
    return false;
  }

  async recordHeartbeat(input: {
    sessionId: string;
    userId: string;
    sessionToken?: string;
    isVisible: boolean;
    clientElapsedSec?: number;
  }): Promise<AdTrackingSessionRecord> {
    const session = await this.verifyAuthorizedSession(input);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();

    if (session.sessionStatus === 'completed' || session.sessionStatus === 'rejected' || session.sessionStatus === 'expired') {
      return this.toPublicSession(session);
    }

    if (await this.checkExpiration(session, nowMs)) {
      throw new Error('انتهت صلاحية جلسة الإعلان.');
    }

    const lastMs = new Date(session.lastActivityAt).getTime();
    const rawDeltaSec = Math.max(0, (nowMs - lastMs) / 1000);
    // Cap each single heartbeat step to at most 15s of real wall-clock time to defeat sleep/forge spoofing
    const boundedDeltaSec = Math.min(rawDeltaSec, 15);
    const totalWallSec = Math.max(0, (nowMs - new Date(session.startedAt).getTime()) / 1000);

    let addedActiveSec = 0;
    if (input.isVisible) {
      addedActiveSec = boundedDeltaSec;
    } else if (!session.requireActiveVisibility) {
      addedActiveSec = boundedDeltaSec;
    }

    // Detect forged client elapsed claim way ahead of real server wall clock
    const reportedClient = Number(input.clientElapsedSec ?? 0);
    if (Number.isFinite(reportedClient) && reportedClient > totalWallSec + 5) {
      await this.store.insertRiskFlag({
        sessionId: session.id,
        userId: session.userId,
        templateId: session.templateId,
        flagType: 'visibility_bypass',
        severity: 'high',
        details: { reportedClientElapsedSec: reportedClient, actualServerWallSec: totalWallSec },
        createdAt: nowIso,
      });
    }

    const nextActiveDuration = Math.min(totalWallSec, Number(session.activeDurationSec || 0) + addedActiveSec);

    const updated = await this.store.updateSession(session.id, {
      lastActivityAt: nowIso,
      activeDurationSec: Number(nextActiveDuration.toFixed(2)),
      sessionStatus: session.sessionStatus === 'started' ? 'active' : session.sessionStatus,
    });

    await this.store.insertEvent({
      sessionId: session.id,
      userId: session.userId,
      templateId: session.templateId,
      networkKey: session.networkKey,
      adFormat: session.adFormat,
      eventName: input.isVisible ? 'heartbeat' : 'visibility_hidden',
      clientElapsedSec: Number.isFinite(reportedClient) ? Math.max(0, reportedClient) : 0,
      serverDeltaSec: Number(addedActiveSec.toFixed(2)),
      isVisible: Boolean(input.isVisible),
      metadata: { boundedDeltaSec },
      createdAt: nowIso,
    });

    return this.toPublicSession(updated);
  }

  async recordEvent(input: {
    sessionId: string;
    userId: string;
    sessionToken?: string;
    eventName: AdTrackingEventName;
    isVisible?: boolean;
    clientElapsedSec?: number;
    metadata?: Record<string, any>;
  }): Promise<AdTrackingSessionRecord> {
    if (!VALID_EVENTS.has(input.eventName)) {
      throw new Error('نوع حدث التتبع غير صالح.');
    }

    const session = await this.verifyAuthorizedSession(input);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();

    if (await this.checkExpiration(session, nowMs)) {
      throw new Error('انتهت صلاحية جلسة الإعلان.');
    }

    if (session.sessionStatus === 'completed' || session.sessionStatus === 'rejected') {
      return this.toPublicSession(session);
    }

    const patch: Partial<StoredTrackingSession> = {
      lastActivityAt: nowIso,
    };

    // Handle VAST strict sequence validation
    if (input.eventName.startsWith('vast_') && input.eventName !== 'vast_error' && input.eventName !== 'vast_clickThrough') {
      const stage = input.eventName.replace(/^vast_/, '');
      const stageIdx = VAST_STAGE_ORDER[stage];
      const existingStages = session.vastMilestones || [];

      if (stageIdx !== undefined) {
        // Cannot report complete/midpoint/quartiles without 'start' first (except impression/start)
        if (stageIdx > 1 && !existingStages.includes('start')) {
          await this.store.insertRiskFlag({
            sessionId: session.id,
            userId: session.userId,
            templateId: session.templateId,
            flagType: 'invalid_vast_sequence',
            severity: 'high',
            details: { attemptedStage: stage, existingStages },
            createdAt: nowIso,
          });
          throw new Error('تسلسل أحداث الفيديو (VAST) غير صالح: لم يبدأ التشغيل بعد.');
        }

        const highestExisting = existingStages.reduce((max, s) => Math.max(max, VAST_STAGE_ORDER[s] ?? -1), -1);
        if (stageIdx < highestExisting && stage !== 'impression') {
          await this.store.insertRiskFlag({
            sessionId: session.id,
            userId: session.userId,
            templateId: session.templateId,
            flagType: 'invalid_vast_sequence',
            severity: 'medium',
            details: { attemptedStage: stage, existingStages },
            createdAt: nowIso,
          });
          throw new Error('تم رصد تكرار أو عكس ترتيب أحداث الفيديو (VAST).');
        }

        if (!existingStages.includes(stage)) {
          patch.vastMilestones = [...existingStages, stage];
        }
      }
      if (session.sessionStatus === 'started') {
        patch.sessionStatus = 'active';
      }
    }

    // Handle External Link Exit / Return timestamps safely
    if (input.eventName === 'external_open') {
      patch.exitAt = session.exitAt || nowIso;
      patch.sessionStatus = 'left_to_external';
    } else if (input.eventName === 'external_return') {
      if (!session.exitAt) {
        throw new Error('لا يمكن تسجيل العودة قبل تسجيل فتح الرابط الخارجي.');
      }
      patch.returnAt = nowIso;
      patch.sessionStatus = 'returned';
      // External time is not counted as visible dwell; only a verified provider postback can qualify the reward.
    }

    // Credit active time on non-paused heartbeat-like visible events
    if (input.isVisible !== false && (input.eventName === 'vast_complete' || input.eventName === 'vast_midpoint')) {
      const lastMs = new Date(session.lastActivityAt).getTime();
      const delta = Math.min(Math.max(0, (nowMs - lastMs) / 1000), 60);
      const totalWall = Math.max(0, (nowMs - new Date(session.startedAt).getTime()) / 1000);
      patch.activeDurationSec = Number(Math.min(totalWall, (session.activeDurationSec || 0) + delta).toFixed(2));
    }

    const updated = await this.store.updateSession(session.id, patch);

    await this.store.insertEvent({
      sessionId: session.id,
      userId: session.userId,
      templateId: session.templateId,
      networkKey: session.networkKey,
      adFormat: session.adFormat,
      eventName: input.eventName,
      clientElapsedSec: Number(input.clientElapsedSec ?? 0) || 0,
      serverDeltaSec: 0,
      isVisible: input.isVisible !== false,
      metadata: input.metadata || {},
      createdAt: nowIso,
    });

    return this.toPublicSession(updated);
  }

  async attemptComplete(input: {
    sessionId: string;
    userId: string;
    sessionToken?: string;
    isVisible?: boolean;
  }): Promise<{
    completed: boolean;
    session: AdTrackingSessionRecord;
    message: string;
  }> {
    const session = await this.verifyAuthorizedSession(input);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();

    await this.store.insertEvent({
      sessionId: session.id,
      userId: session.userId,
      templateId: session.templateId,
      networkKey: session.networkKey,
      adFormat: session.adFormat,
      eventName: 'complete_attempt',
      clientElapsedSec: 0,
      serverDeltaSec: 0,
      isVisible: input.isVisible !== false,
      metadata: {},
      createdAt: nowIso,
    });

    // Reject duplicate completion attempts strictly
    if (session.sessionStatus === 'completed') {
      await this.store.insertRiskFlag({
        sessionId: session.id,
        userId: session.userId,
        templateId: session.templateId,
        flagType: 'duplicate_complete',
        severity: 'medium',
        details: { completedAt: session.completedAt },
        createdAt: nowIso,
      });
      return {
        completed: false,
        session: this.toPublicSession(session),
        message: 'تم إكمال هذه الجلسة والتحقق منها مسبقاً (ممنوع التكرار).',
      };
    }

    if (session.sessionStatus === 'rejected') {
      return {
        completed: false,
        session: this.toPublicSession(session),
        message: session.rejectionReason || 'الجلسة مرفوضة مسبقاً.',
      };
    }

    if (await this.checkExpiration(session, nowMs)) {
      return {
        completed: false,
        session: {
          ...this.toPublicSession(session),
          sessionStatus: 'expired',
          verificationStatus: 'failed',
          eligibilityResult: 'rejected',
        },
        message: 'انتهت صلاحية جلسة الإعلان قبل الإكمال.',
      };
    }

    // Calculate honest server active duration (only credit final tail if page is currently visible)
    const totalWallSec = Math.max(0, (nowMs - new Date(session.startedAt).getTime()) / 1000);
    const lastMs = new Date(session.lastActivityAt).getTime();
    const finalTail =
      input.isVisible !== false || !session.requireActiveVisibility
        ? Math.min(Math.max(0, (nowMs - lastMs) / 1000), 15)
        : 0;
    const effectiveActiveSec = Math.min(totalWallSec, Number(session.activeDurationSec || 0) + finalTail);

    // 1. Validate VAST milestones if mode is vast
    if (session.verificationMode === 'vast' && session.requiredVastEvents.length > 0) {
      const missingVast = session.requiredVastEvents.filter((m) => !session.vastMilestones.includes(m));
      if (missingVast.length > 0) {
        await this.store.insertRiskFlag({
          sessionId: session.id,
          userId: session.userId,
          templateId: session.templateId,
          flagType: 'invalid_vast_sequence',
          severity: 'high',
          details: { missingVast, recorded: session.vastMilestones },
          createdAt: nowIso,
        });
        const rej = await this.store.updateSession(session.id, {
          activeDurationSec: Number(effectiveActiveSec.toFixed(2)),
          verificationStatus: 'failed',
          rejectionReason: `لم تكتمل أحداث الفيديو المطلوبة (${missingVast.join(', ')}).`,
        });
        await this.store.insertEvent({
          sessionId: session.id,
          userId: session.userId,
          templateId: session.templateId,
          networkKey: session.networkKey,
          adFormat: session.adFormat,
          eventName: 'complete_rejected',
          clientElapsedSec: 0,
          serverDeltaSec: 0,
          isVisible: input.isVisible !== false,
          metadata: { reason: 'missing_vast_events', missingVast },
          createdAt: nowIso,
        });
        return {
          completed: false,
          session: this.toPublicSession(rej),
          message: `لم تكتمل مراحل مشاهدة الفيديو المطلوبة (${missingVast.join(', ')}).`,
        };
      }
    }

    // 2. Validate Link Exit & Return if required
    if (session.verificationMode === 'link_return' || session.requireLinkReturn) {
      if (!session.exitAt || !session.returnAt) {
        const rej = await this.store.updateSession(session.id, {
          verificationStatus: 'failed',
          rejectionReason: 'يجب فتح الرابط الخارجي ثم العودة عبر مسار العودة لتسجيل الزيارة.',
        });
        await this.store.insertEvent({
          sessionId: session.id,
          userId: session.userId,
          templateId: session.templateId,
          networkKey: session.networkKey,
          adFormat: session.adFormat,
          eventName: 'complete_rejected',
          clientElapsedSec: 0,
          serverDeltaSec: 0,
          isVisible: input.isVisible !== false,
          metadata: { reason: 'missing_exit_or_return' },
          createdAt: nowIso,
        });
        return {
          completed: false,
          session: this.toPublicSession(rej),
          message: 'يجب فتح الرابط الخارجي أولاً ثم العودة للتحقق من الفاصل الزمني.',
        };
      }
    }

    // 3. Validate Dwell Duration strictly via server time
    if (session.requiredWatchSec > 0 && effectiveActiveSec + 0.5 < session.requiredWatchSec) {
      await this.store.insertRiskFlag({
        sessionId: session.id,
        userId: session.userId,
        templateId: session.templateId,
        flagType: 'premature_complete',
        severity: 'high',
        details: {
          requiredWatchSec: session.requiredWatchSec,
          effectiveActiveSec: Number(effectiveActiveSec.toFixed(2)),
          totalWallSec: Number(totalWallSec.toFixed(2)),
        },
        createdAt: nowIso,
      });

      const failed = await this.store.updateSession(session.id, {
        activeDurationSec: Number(effectiveActiveSec.toFixed(2)),
        verificationStatus: 'failed',
        rejectionReason: `المدة النشطة المحتسبة (${Math.floor(effectiveActiveSec)}ث) أقل من المطلوب (${session.requiredWatchSec}ث).`,
      });
      await this.store.insertEvent({
        sessionId: session.id,
        userId: session.userId,
        templateId: session.templateId,
        networkKey: session.networkKey,
        adFormat: session.adFormat,
        eventName: 'complete_rejected',
        clientElapsedSec: 0,
        serverDeltaSec: 0,
        isVisible: input.isVisible !== false,
        metadata: { requiredWatchSec: session.requiredWatchSec, effectiveActiveSec },
        createdAt: nowIso,
      });
      return {
        completed: false,
        session: this.toPublicSession(failed),
        message: `لم يكتمل وقت البقاء النشط المطلوب (${Math.floor(effectiveActiveSec)} / ${session.requiredWatchSec} ثانية).`,
      };
    }

    // 4. Mark session completed atomically (YT Coin still NEVER granted by browser completion alone if S2S required!)
    const requiresS2s = session.requireServerPostback || Boolean(session.networkKey);
    const eligibilityResult: AdTrackingSessionRecord['eligibilityResult'] = requiresS2s
      ? 'eligible_for_yt_reward'
      : 'eligible_tracking_only';

    const completed = await this.store.updateSession(session.id, {
      lastActivityAt: nowIso,
      activeDurationSec: Number(effectiveActiveSec.toFixed(2)),
      sessionStatus: 'completed',
      verificationStatus: 'verified',
      eligibilityResult,
      rejectionReason: null,
      completedAt: nowIso,
    });

    await this.store.insertEvent({
      sessionId: session.id,
      userId: session.userId,
      templateId: session.templateId,
      networkKey: session.networkKey,
      adFormat: session.adFormat,
      eventName: 'complete_verified',
      clientElapsedSec: 0,
      serverDeltaSec: Number(effectiveActiveSec.toFixed(2)),
      isVisible: input.isVisible !== false,
      metadata: {
        eligibilityResult,
        requiresS2s,
        note:
          session.verificationMode === 'link_return'
            ? 'Recorded external exit/return window only; external content stay requires S2S postback.'
            : 'Verified via server dwell & visibility telemetry.',
      },
      createdAt: nowIso,
    });

    return {
      completed: true,
      session: this.toPublicSession(completed),
      message: requiresS2s
        ? 'تم توثيق إكمال الإعلان على الخادم وبانتظار إشعار S2S لإضافة مكافأة YT Coin.'
        : 'تم توثيق إكمال مشاهدة الإعلان بنجاح.',
    };
  }

  /**
   * Called after HMAC/secret validation on server-to-server postbacks to enforce
   * replay-free audit & 1-to-1 YT Coin reward claim linkage.
   */
  async recordVerifiedPostbackLinkage(input: {
    networkKey: string;
    providerEventId: string;
    trackingSessionId: string | null;
    ytAdSessionId: string | null;
    ytRewardClaimId: string | null;
    userId: string;
    signatureValid: boolean;
    sanitizedPayload: Record<string, any>;
  }): Promise<{ accepted: boolean; reason?: string }> {
    const nowIso = new Date(this.now()).toISOString();
    const duplicate = await this.store.getPostbackByExternalId(input.networkKey, input.providerEventId);
    if (duplicate) {
      await this.store.insertRiskFlag({
        sessionId: input.trackingSessionId,
        userId: input.userId,
        templateId: null,
        flagType: 'duplicate_postback',
        severity: 'high',
        details: { networkKey: input.networkKey, providerEventId: input.providerEventId },
        createdAt: nowIso,
      });
      return { accepted: false, reason: 'duplicate_postback' };
    }

    if (!input.signatureValid) {
      await this.store.insertPostbackAudit({
        networkKey: input.networkKey,
        providerEventId: input.providerEventId,
        trackingSessionId: input.trackingSessionId,
        ytAdSessionId: input.ytAdSessionId,
        userId: input.userId,
        signatureValid: false,
        processingStatus: 'rejected',
        rejectionReason: 'invalid_signature',
        sanitizedPayload: input.sanitizedPayload,
        receivedAt: nowIso,
      });
      return { accepted: false, reason: 'invalid_signature' };
    }

    if (input.ytRewardClaimId && (await this.store.hasSessionYtRewardClaim(input.ytRewardClaimId))) {
      await this.store.insertRiskFlag({
        sessionId: input.trackingSessionId,
        userId: input.userId,
        templateId: null,
        flagType: 'duplicate_postback',
        severity: 'high',
        details: { ytRewardClaimId: input.ytRewardClaimId },
        createdAt: nowIso,
      });
      return { accepted: false, reason: 'duplicate_yt_reward_claim' };
    }

    await this.store.insertPostbackAudit({
      networkKey: input.networkKey,
      providerEventId: input.providerEventId,
      trackingSessionId: input.trackingSessionId,
      ytAdSessionId: input.ytAdSessionId,
      userId: input.userId,
      signatureValid: true,
      processingStatus: 'credited',
      rejectionReason: null,
      sanitizedPayload: input.sanitizedPayload,
      receivedAt: nowIso,
    });

    if (input.trackingSessionId && UUID_REGEX.test(input.trackingSessionId)) {
      const existing = await this.store.getSessionById(input.trackingSessionId);
      if (existing && !existing.ytRewardClaimId) {
        await this.store.updateSession(existing.id, {
          eligibilityResult: 'credited',
          verificationStatus: 'verified',
          sessionStatus: existing.sessionStatus === 'started' ? 'completed' : existing.sessionStatus,
          ytAdSessionId: input.ytAdSessionId || existing.ytAdSessionId,
          ytRewardClaimId: input.ytRewardClaimId,
          completedAt: existing.completedAt || nowIso,
        });
        await this.store.insertEvent({
          sessionId: existing.id,
          userId: existing.userId,
          templateId: existing.templateId,
          networkKey: input.networkKey,
          adFormat: existing.adFormat,
          eventName: 'reward_approved',
          clientElapsedSec: 0,
          serverDeltaSec: 0,
          isVisible: true,
          metadata: { providerEventId: input.providerEventId, ytRewardClaimId: input.ytRewardClaimId },
          createdAt: nowIso,
        });
      }
    }

    return { accepted: true };
  }

  private toPublicSession(s: StoredTrackingSession): AdTrackingSessionRecord {
    return {
      id: s.id,
      userId: s.userId,
      templateId: s.templateId,
      templateTitle: s.templateTitle,
      placementKey: s.placementKey,
      networkKey: s.networkKey,
      adFormat: s.adFormat,
      deviceType: s.deviceType,
      verificationMode: s.verificationMode,
      requiredWatchSec: s.requiredWatchSec,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      activeDurationSec: s.activeDurationSec,
      exitAt: s.exitAt,
      returnAt: s.returnAt,
      vastMilestones: s.vastMilestones,
      sessionStatus: s.sessionStatus,
      verificationStatus: s.verificationStatus,
      eligibilityResult: s.eligibilityResult,
      rejectionReason: s.rejectionReason,
      ytAdSessionId: s.ytAdSessionId,
      ytRewardClaimId: s.ytRewardClaimId,
      expiresAt: s.expiresAt,
      completedAt: s.completedAt,
      createdAt: s.createdAt,
    };
  }
}

function mapSessionRow(row: any): StoredTrackingSession {
  return {
    id: String(row.id),
    sessionTokenHash: String(row.session_token_hash || ''),
    userId: row.user_id ? String(row.user_id) : null,
    templateId: row.template_id ? String(row.template_id) : null,
    placementKey: String(row.placement_key || ''),
    networkKey: row.network_key ?? null,
    adFormat: String(row.ad_format || 'banner'),
    deviceType: row.device_type === 'desktop' ? 'desktop' : 'mobile',
    verificationMode: (row.verification_mode || 'dwell') as AdVerificationMode,
    requiredWatchSec: Number(row.required_watch_sec ?? 15),
    startedAt: String(row.started_at),
    lastActivityAt: String(row.last_activity_at),
    activeDurationSec: Number(row.active_duration_sec ?? 0),
    exitAt: row.exit_at ?? null,
    returnAt: row.return_at ?? null,
    vastMilestones: Array.isArray(row.vast_milestones) ? row.vast_milestones.map(String) : [],
    sessionStatus: row.session_status,
    verificationStatus: row.verification_status,
    eligibilityResult: row.eligibility_result,
    rejectionReason: row.rejection_reason ?? null,
    ytAdSessionId: row.yt_ad_session_id ?? null,
    ytRewardClaimId: row.yt_reward_claim_id ?? null,
    expiresAt: String(row.expires_at),
    completedAt: row.completed_at ?? null,
    createdAt: String(row.created_at),
    clientFingerprintHash: row.client_fingerprint_hash ?? null,
    requireActiveVisibility: true,
    requiredVastEvents: [],
    requireLinkReturn: false,
    requireServerPostback: false,
  };
}

class SupabaseAdTrackingStore implements AdTrackingStore {
  private get db() {
    return getSupabaseAdminClient();
  }

  async getComfortSettings(): Promise<AdCenterComfortSettings> {
    const { data, error } = await this.db.from('ad_center_settings').select('*').eq('id', 1).maybeSingle();
    if (error) {
      if (isMissingTableOrColumnError(error)) return { ...DEFAULT_COMFORT_SETTINGS };
      throw new Error(error.message);
    }
    return mapComfortRow(data);
  }

  async getTemplateById(templateId: string): Promise<AdTemplateLookupRecord | null> {
    const { data, error } = await this.db
      .from('mining_ad_templates')
      .select('id,title,placement_key,ad_format,yt_network_key,target_url,is_active,tracking_enabled')
      .eq('id', templateId)
      .maybeSingle();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        throw new MigrationRequiredError(
          'جداول تتبع الإعلانات غير مفعّلة بعد في Supabase (ملفات 20261126000000 و 20261127000000).'
        );
      }
      throw new Error(error.message);
    }
    if (!data) return null;
    return {
      id: String(data.id),
      title: String(data.title || ''),
      placementKey: String(data.placement_key || ''),
      adFormat: String(data.ad_format || 'banner') as MiningAdFormat,
      ytNetworkKey: data.yt_network_key ?? null,
      targetUrl: data.target_url ?? null,
      isActive: Boolean(data.is_active),
      trackingEnabled: data.tracking_enabled === undefined ? true : Boolean(data.tracking_enabled),
    };
  }

  async getCompletionRule(templateId: string | null, adFormat: MiningAdFormat): Promise<AdCompletionRule> {
    const settings = await this.getComfortSettings();
    if (templateId) {
      const { data: tplRule } = await this.db
        .from('ad_completion_rules')
        .select('*')
        .eq('template_id', templateId)
        .maybeSingle();
      if (tplRule) return mapRuleRow(tplRule);
    }
    const { data: fmtRule } = await this.db
      .from('ad_completion_rules')
      .select('*')
      .is('template_id', null)
      .eq('ad_format', adFormat)
      .maybeSingle();
    if (fmtRule) return mapRuleRow(fmtRule);
    return defaultRuleForFormat(adFormat, settings);
  }

  async countUserDailySessions(userId: string, templateId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.db
      .from('ad_tracking_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('template_id', templateId)
      .gte('created_at', sinceIso);
    if (error) return 0;
    return Number(count || 0);
  }

  async getLastUserTemplateSession(userId: string, templateId: string): Promise<StoredTrackingSession | null> {
    const { data, error } = await this.db
      .from('ad_tracking_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapSessionRow(data);
  }

  async insertSession(s: StoredTrackingSession): Promise<void> {
    const { error } = await this.db.from('ad_tracking_sessions').insert({
      id: s.id,
      session_token_hash: s.sessionTokenHash,
      user_id: s.userId,
      template_id: s.templateId,
      placement_key: s.placementKey,
      network_key: s.networkKey,
      ad_format: s.adFormat,
      device_type: s.deviceType,
      verification_mode: s.verificationMode,
      required_watch_sec: s.requiredWatchSec,
      started_at: s.startedAt,
      last_activity_at: s.lastActivityAt,
      active_duration_sec: s.activeDurationSec,
      exit_at: s.exitAt,
      return_at: s.returnAt,
      vast_milestones: s.vastMilestones,
      session_status: s.sessionStatus,
      verification_status: s.verificationStatus,
      eligibility_result: s.eligibilityResult,
      rejection_reason: s.rejectionReason,
      yt_ad_session_id: s.ytAdSessionId,
      yt_reward_claim_id: s.ytRewardClaimId,
      expires_at: s.expiresAt,
      completed_at: s.completedAt,
      client_fingerprint_hash: s.clientFingerprintHash,
      created_at: s.createdAt,
    });
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        throw new MigrationRequiredError(
          'جدول ad_tracking_sessions غير مفعّل بعد في Supabase (ملف 20261127000000).'
        );
      }
      throw new Error(error.message);
    }
  }

  async getSessionById(sessionId: string): Promise<StoredTrackingSession | null> {
    const { data, error } = await this.db
      .from('ad_tracking_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return null;
    const mapped = mapSessionRow(data);
    const rule = await this.getCompletionRule(mapped.templateId, mapped.adFormat as MiningAdFormat);
    mapped.requireActiveVisibility = rule.requireActiveVisibility;
    mapped.requiredVastEvents = rule.requiredVastEvents;
    mapped.requireLinkReturn = rule.requireLinkReturn;
    mapped.requireServerPostback = rule.requireServerPostback;
    return mapped;
  }

  async updateSession(sessionId: string, patch: Partial<StoredTrackingSession>): Promise<StoredTrackingSession> {
    const dbPatch: Record<string, any> = {};
    if (patch.lastActivityAt !== undefined) dbPatch.last_activity_at = patch.lastActivityAt;
    if (patch.activeDurationSec !== undefined) dbPatch.active_duration_sec = patch.activeDurationSec;
    if (patch.exitAt !== undefined) dbPatch.exit_at = patch.exitAt;
    if (patch.returnAt !== undefined) dbPatch.return_at = patch.returnAt;
    if (patch.vastMilestones !== undefined) dbPatch.vast_milestones = patch.vastMilestones;
    if (patch.sessionStatus !== undefined) dbPatch.session_status = patch.sessionStatus;
    if (patch.verificationStatus !== undefined) dbPatch.verification_status = patch.verificationStatus;
    if (patch.eligibilityResult !== undefined) dbPatch.eligibility_result = patch.eligibilityResult;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.ytAdSessionId !== undefined) dbPatch.yt_ad_session_id = patch.ytAdSessionId;
    if (patch.ytRewardClaimId !== undefined) dbPatch.yt_reward_claim_id = patch.ytRewardClaimId;
    if (patch.completedAt !== undefined) dbPatch.completed_at = patch.completedAt;

    const { data, error } = await this.db
      .from('ad_tracking_sessions')
      .update(dbPatch)
      .eq('id', sessionId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapSessionRow(data);
  }

  async insertEvent(event: AdTrackingEventInsert): Promise<void> {
    const { error } = await this.db.from('ad_tracking_events').insert({
      session_id: event.sessionId,
      user_id: event.userId,
      template_id: event.templateId,
      network_key: event.networkKey,
      ad_format: event.adFormat,
      event_name: event.eventName,
      client_elapsed_sec: event.clientElapsedSec,
      server_delta_sec: event.serverDeltaSec,
      is_visible: event.isVisible,
      metadata: event.metadata,
      created_at: event.createdAt,
    });
    if (error && !isMissingTableOrColumnError(error)) {
      throw new Error(error.message);
    }
  }

  async insertRiskFlag(flag: Omit<AdTrackingRiskFlag, 'id'>): Promise<void> {
    await this.db.from('ad_tracking_risk_flags').insert({
      session_id: flag.sessionId,
      user_id: flag.userId,
      template_id: flag.templateId,
      flag_type: flag.flagType,
      severity: flag.severity,
      details: flag.details,
      created_at: flag.createdAt,
    });
  }

  async getPostbackByExternalId(networkKey: string, providerEventId: string): Promise<{ id: string } | null> {
    const { data } = await this.db
      .from('ad_provider_postbacks')
      .select('id')
      .eq('network_key', networkKey)
      .eq('provider_event_id', providerEventId)
      .maybeSingle();
    return data ? { id: String(data.id) } : null;
  }

  async insertPostbackAudit(entry: {
    networkKey: string;
    providerEventId: string;
    trackingSessionId: string | null;
    ytAdSessionId: string | null;
    userId: string | null;
    signatureValid: boolean;
    processingStatus: 'received' | 'credited' | 'duplicate' | 'rejected';
    rejectionReason: string | null;
    sanitizedPayload: Record<string, any>;
    receivedAt: string;
  }): Promise<void> {
    await this.db.from('ad_provider_postbacks').insert({
      network_key: entry.networkKey,
      provider_event_id: entry.providerEventId,
      tracking_session_id: entry.trackingSessionId,
      yt_ad_session_id: entry.ytAdSessionId,
      user_id: entry.userId,
      signature_valid: entry.signatureValid,
      processing_status: entry.processingStatus,
      rejection_reason: entry.rejectionReason,
      sanitized_payload: entry.sanitizedPayload,
      received_at: entry.receivedAt,
    });
  }

  async hasSessionYtRewardClaim(claimId: string): Promise<boolean> {
    const { data } = await this.db
      .from('ad_tracking_sessions')
      .select('id')
      .eq('yt_reward_claim_id', claimId)
      .maybeSingle();
    return Boolean(data?.id);
  }
}

export const adTrackingEngine = new AdTrackingEngine(new SupabaseAdTrackingStore());

export const adTrackingService = {
  engine: adTrackingEngine,

  async getUserHistory(userId: string) {
    if (!UUID_REGEX.test(userId)) return { sessions: [] as AdTrackingSessionRecord[], storageMode: 'supabase' as const };
    const db = getSupabaseAdminClient();
    const { data, error } = await db
      .from('ad_tracking_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { sessions: [] as AdTrackingSessionRecord[], storageMode: 'unmigrated' as const };
      }
      throw new Error(error.message);
    }

    return {
      sessions: (data || []).map(mapSessionRow),
      storageMode: 'supabase' as const,
    };
  },

  async getPushAdPreference(userId: string, authToken?: string): Promise<{ preference: PushAdPreference; storageMode: 'supabase' | 'unmigrated' }> {
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY || !authToken ? getSupabaseAdminClient() : getSupabaseUserClient(authToken);
    const { data, error } = await db
      .from('push_ad_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { preference: { optedIn: false, frequencyPerDay: 2 }, storageMode: 'unmigrated' };
      }
      throw new Error(error.message);
    }
    return {
      preference: {
        optedIn: Boolean(data?.opted_in),
        frequencyPerDay: Number(data?.frequency_per_day ?? 2),
        optedInAt: data?.opted_in_at ?? null,
        optedOutAt: data?.opted_out_at ?? null,
      },
      storageMode: 'supabase',
    };
  },

  async updatePushAdPreference(
    userId: string,
    payload: { optedIn: boolean; frequencyPerDay?: number },
    authToken?: string
  ): Promise<{ preference: PushAdPreference; storageMode: 'supabase' }> {
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY || !authToken ? getSupabaseAdminClient() : getSupabaseUserClient(authToken);
    const now = new Date().toISOString();
    const freq = Math.max(0, Math.min(10, Math.round(Number(payload.frequencyPerDay ?? 2) || 2)));
    const { data, error } = await db
      .from('push_ad_preferences')
      .upsert(
        {
          user_id: userId,
          opted_in: Boolean(payload.optedIn),
          frequency_per_day: freq,
          ...(payload.optedIn ? { opted_in_at: now } : { opted_out_at: now }),
          updated_at: now,
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        throw new MigrationRequiredError(
          'جدول push_ad_preferences غير مفعّل بعد في Supabase (ملف 20261127000000) — لم يتم الحفظ.'
        );
      }
      throw new Error(error.message);
    }

    return {
      preference: {
        optedIn: Boolean(data.opted_in),
        frequencyPerDay: Number(data.frequency_per_day ?? 2),
        optedInAt: data.opted_in_at ?? null,
        optedOutAt: data.opted_out_at ?? null,
      },
      storageMode: 'supabase',
    };
  },

  /**
   * Real Supabase Analytics Query (0 mock or fabricated numbers).
   */
  async getAdminReports(filters: {
    dateFrom?: string;
    dateTo?: string;
    networkKey?: string;
    adFormat?: string;
    userId?: string;
  }): Promise<AdminAdTrackingReport> {
    const emptyReport = (storageMode: 'supabase' | 'unmigrated'): AdminAdTrackingReport => ({
      storageMode,
      totals: {
        impressions: 0,
        viewStarts: 0,
        completedViews: 0,
        incompleteViews: 0,
        clicks: 0,
        externalOpens: 0,
        externalReturns: 0,
        rejectedSessions: 0,
        expiredSessions: 0,
        approvedRewards: 0,
        rejectedRewards: 0,
        riskFlagsCount: 0,
        completionRatePct: 0,
        conversionRatePct: 0,
      },
      byNetwork: [],
      byTemplate: [],
      recentSessions: [],
      recentRiskFlags: [],
    });

    try {
      const db = getSupabaseAdminClient();
      let sessQ = db.from('ad_tracking_sessions').select('*').order('created_at', { ascending: false }).limit(500);
      let evtQ = db.from('ad_tracking_events').select('event_name,ad_format,network_key,template_id,created_at').order('created_at', { ascending: false }).limit(2000);
      let flagQ = db.from('ad_tracking_risk_flags').select('*').order('created_at', { ascending: false }).limit(100);
      const tplQ = db.from('mining_ad_templates').select('id,title,ad_format,impressions_count');

      if (filters.dateFrom) {
        sessQ = sessQ.gte('created_at', filters.dateFrom);
        evtQ = evtQ.gte('created_at', filters.dateFrom);
        flagQ = flagQ.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        sessQ = sessQ.lte('created_at', filters.dateTo);
        evtQ = evtQ.lte('created_at', filters.dateTo);
        flagQ = flagQ.lte('created_at', filters.dateTo);
      }
      if (filters.networkKey) {
        sessQ = sessQ.eq('network_key', filters.networkKey);
        evtQ = evtQ.eq('network_key', filters.networkKey);
      }
      if (filters.adFormat) {
        sessQ = sessQ.eq('ad_format', filters.adFormat);
        evtQ = evtQ.eq('ad_format', filters.adFormat);
      }
      if (filters.userId && UUID_REGEX.test(filters.userId)) {
        sessQ = sessQ.eq('user_id', filters.userId);
        flagQ = flagQ.eq('user_id', filters.userId);
      }

      const [sessRes, evtRes, flagRes, tplRes] = await Promise.all([sessQ, evtQ, flagQ, tplQ]);

      if (sessRes.error || evtRes.error) {
        const err = sessRes.error || evtRes.error;
        if (isMissingTableOrColumnError(err)) return emptyReport('unmigrated');
        throw new Error(err?.message || 'تعذر تحميل تقارير الإعلانات.');
      }

      const sessions = (sessRes.data || []).map(mapSessionRow);
      const events = evtRes.data || [];
      const flags: AdTrackingRiskFlag[] = (flagRes.data || []).map((f: any) => ({
        id: String(f.id),
        sessionId: f.session_id ?? null,
        userId: f.user_id ?? null,
        templateId: f.template_id ?? null,
        flagType: f.flag_type,
        severity: f.severity,
        details: f.details || {},
        createdAt: String(f.created_at),
      }));
      const templates = tplRes.data || [];
      const tplMap = new Map<string, { title: string; adFormat: string; impressions: number }>();
      let totalTemplateImpressions = 0;
      for (const t of templates) {
        const imp = Number(t.impressions_count || 0);
        totalTemplateImpressions += imp;
        tplMap.set(String(t.id), {
          title: String(t.title || ''),
          adFormat: String(t.ad_format || 'banner'),
          impressions: imp,
        });
      }

      let clicks = 0;
      let externalOpens = 0;
      let externalReturns = 0;
      let eventImpressions = 0;
      let viewStarts = 0;

      for (const ev of events) {
        const name = String(ev.event_name || '');
        if (name === 'click' || name === 'vast_clickThrough') clicks++;
        else if (name === 'external_open') externalOpens++;
        else if (name === 'external_return') externalReturns++;
        else if (name === 'impression' || name === 'vast_impression') eventImpressions++;
        else if (name === 'view_start') viewStarts++;
      }

      const completedViews = sessions.filter((s) => s.sessionStatus === 'completed').length;
      const rejectedSessions = sessions.filter((s) => s.sessionStatus === 'rejected').length;
      const expiredSessions = sessions.filter((s) => s.sessionStatus === 'expired').length;
      const incompleteViews = sessions.filter((s) => ['started', 'active', 'left_to_external', 'returned'].includes(s.sessionStatus)).length;
      const approvedRewards = sessions.filter((s) => s.eligibilityResult === 'credited').length;
      const rejectedRewards = sessions.filter((s) => s.eligibilityResult === 'rejected').length;

      const totalSessions = sessions.length;
      const impressions = Math.max(totalTemplateImpressions, eventImpressions);
      const completionRatePct = totalSessions > 0 ? Number(((completedViews / totalSessions) * 100).toFixed(1)) : 0;
      const conversionRatePct = totalSessions > 0 ? Number(((approvedRewards / totalSessions) * 100).toFixed(1)) : 0;

      // Group by Network
      const netAgg = new Map<string, { networkKey: string; sessions: number; completed: number; rejected: number; approvedRewards: number; clicks: number }>();
      for (const s of sessions) {
        const nk = s.networkKey || 'مباشر / بدون شبكة مكافآت';
        const row = netAgg.get(nk) || { networkKey: nk, sessions: 0, completed: 0, rejected: 0, approvedRewards: 0, clicks: 0 };
        row.sessions++;
        if (s.sessionStatus === 'completed') row.completed++;
        if (s.sessionStatus === 'rejected' || s.sessionStatus === 'expired') row.rejected++;
        if (s.eligibilityResult === 'credited') row.approvedRewards++;
        netAgg.set(nk, row);
      }

      // Group by Template
      const tplAgg = new Map<string, { templateId: string; title: string; adFormat: string; impressions: number; starts: number; completed: number; rejected: number; completionRatePct: number }>();
      for (const s of sessions) {
        if (!s.templateId) continue;
        const meta = tplMap.get(s.templateId);
        const row = tplAgg.get(s.templateId) || {
          templateId: s.templateId,
          title: meta?.title || s.templateId,
          adFormat: meta?.adFormat || s.adFormat,
          impressions: meta?.impressions || 0,
          starts: 0,
          completed: 0,
          rejected: 0,
          completionRatePct: 0,
        };
        row.starts++;
        if (s.sessionStatus === 'completed') row.completed++;
        if (s.sessionStatus === 'rejected' || s.sessionStatus === 'expired') row.rejected++;
        row.completionRatePct = row.starts > 0 ? Number(((row.completed / row.starts) * 100).toFixed(1)) : 0;
        tplAgg.set(s.templateId, row);
      }

      return {
        storageMode: 'supabase',
        totals: {
          impressions,
          viewStarts: Math.max(viewStarts, totalSessions),
          completedViews,
          incompleteViews,
          clicks,
          externalOpens,
          externalReturns,
          rejectedSessions,
          expiredSessions,
          approvedRewards,
          rejectedRewards,
          riskFlagsCount: flags.length,
          completionRatePct,
          conversionRatePct,
        },
        byNetwork: Array.from(netAgg.values()),
        byTemplate: Array.from(tplAgg.values()),
        recentSessions: sessions.slice(0, 40).map((s) => ({
          ...s,
          templateTitle: s.templateId ? tplMap.get(s.templateId)?.title || null : null,
        })),
        recentRiskFlags: flags,
      };
    } catch (err: any) {
      if (isMissingTableOrColumnError(err)) return emptyReport('unmigrated');
      throw err;
    }
  },
};
