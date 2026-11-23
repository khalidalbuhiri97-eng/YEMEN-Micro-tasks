/**
 * Automated Verification Suite for Yemen Task Smart Ad Tracking, VAST, Anti-Fraud & Comfort Policy
 * Covers all 15 deterministic scenarios + real Express HTTP route guards + YT Coin / Financial ledger isolation checks.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import app from './app.js';
import {
  AdTrackingEngine,
  type AdTemplateLookupRecord,
  type AdTrackingEventInsert,
  type AdTrackingStore,
  type StoredTrackingSession,
  checkTrackingRateLimit,
} from './adTrackingService.js';
import {
  DEFAULT_COMFORT_SETTINGS,
  MigrationRequiredError,
  REWARD_ELIGIBLE_AD_FORMATS,
  extractAdZoneSignature,
  isDisplayBannerAd,
  isRewardEligibleAd,
  validateCodeContent,
} from './miningAdsService.js';
import {
  buildMiningAdSrcDoc,
  extractAdZoneKey,
  isExoClickCode,
  isRewardEligibleTemplate,
} from '../shared/miningAdBannerUtils.js';
import {
  YT_MAX_SUPPLY_YT,
  YT_SUBUNITS_PER_YT,
  assertBalancedYtJournalEntries,
  ytToUnitsStrict,
} from '../shared/ytCoin.js';
import type {
  AdCenterComfortSettings,
  AdCompletionRule,
  AdTrackingRiskFlag,
  MiningAdFormat,
} from '../src/types/index.js';

class InMemoryAdTrackingStore implements AdTrackingStore {
  comfortSettings: AdCenterComfortSettings = {
    ...DEFAULT_COMFORT_SETTINGS,
    trackingEnabledByFormat: { ...DEFAULT_COMFORT_SETTINGS.trackingEnabledByFormat },
  };
  templates = new Map<string, AdTemplateLookupRecord>();
  rulesByTemplate = new Map<string, AdCompletionRule>();
  rulesByFormat = new Map<MiningAdFormat, AdCompletionRule>();
  sessions = new Map<string, StoredTrackingSession>();
  events: AdTrackingEventInsert[] = [];
  riskFlags: Array<Omit<AdTrackingRiskFlag, 'id'>> = [];
  postbacks = new Map<string, { id: string; ytRewardClaimId: string | null }>();
  claimIds = new Set<string>();

  async getComfortSettings(): Promise<AdCenterComfortSettings> {
    return this.comfortSettings;
  }

  async getTemplateById(templateId: string): Promise<AdTemplateLookupRecord | null> {
    return this.templates.get(templateId) || null;
  }

  async getCompletionRule(templateId: string | null, adFormat: MiningAdFormat): Promise<AdCompletionRule> {
    if (templateId && this.rulesByTemplate.has(templateId)) {
      return this.rulesByTemplate.get(templateId)!;
    }
    if (this.rulesByFormat.has(adFormat)) {
      return this.rulesByFormat.get(adFormat)!;
    }
    const isVideo = ['instream_video', 'invideo_banner', 'video_slider', 'outstream_video', 'vertical_video'].includes(adFormat);
    const isLink = adFormat === 'external_link';
    return {
      adFormat,
      trackingEnabled: this.comfortSettings.trackingEnabledByFormat[adFormat] !== false,
      verificationMode: isVideo ? 'vast' : isLink ? 'link_return' : 'dwell',
      requiredWatchSec: isVideo ? 15 : isLink ? 10 : 30,
      requireActiveVisibility: true,
      requiredVastEvents: isVideo ? ['start', 'firstQuartile', 'midpoint', 'thirdQuartile', 'complete'] : [],
      requireLinkReturn: isLink,
      requireServerPostback: false,
      sessionTtlSec: 900,
      maxDailyPerUser: 25,
      frequencyCapMinutes: 0,
    };
  }

  async countUserDailySessions(userId: string, templateId: string, sinceIso: string): Promise<number> {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.templateId === templateId && s.createdAt >= sinceIso) {
        count += 1;
      }
    }
    return count;
  }

  async getLastUserTemplateSession(userId: string, templateId: string): Promise<StoredTrackingSession | null> {
    let latest: StoredTrackingSession | null = null;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.templateId === templateId) {
        if (!latest || s.startedAt > latest.startedAt) latest = s;
      }
    }
    return latest;
  }

  async insertSession(session: StoredTrackingSession): Promise<void> {
    this.sessions.set(session.id, { ...session, vastMilestones: [...session.vastMilestones] });
  }

  async getSessionById(sessionId: string): Promise<StoredTrackingSession | null> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s, vastMilestones: [...s.vastMilestones] } : null;
  }

  async updateSession(sessionId: string, patch: Partial<StoredTrackingSession>): Promise<StoredTrackingSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error('Session not found in store');
    const updated: StoredTrackingSession = { ...existing, ...patch };
    this.sessions.set(sessionId, updated);
    if (patch.ytRewardClaimId) {
      this.claimIds.add(patch.ytRewardClaimId);
    }
    return { ...updated, vastMilestones: [...updated.vastMilestones] };
  }

  async insertEvent(event: AdTrackingEventInsert): Promise<void> {
    this.events.push(event);
  }

  async insertRiskFlag(flag: Omit<AdTrackingRiskFlag, 'id'>): Promise<void> {
    this.riskFlags.push(flag);
  }

  async getPostbackByExternalId(networkKey: string, providerEventId: string): Promise<{ id: string } | null> {
    const item = this.postbacks.get(`${networkKey}:${providerEventId}`);
    return item ? { id: item.id } : null;
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
    this.postbacks.set(`${entry.networkKey}:${entry.providerEventId}`, {
      id: crypto.randomUUID(),
      ytRewardClaimId: null,
    });
  }

  async hasSessionYtRewardClaim(claimId: string): Promise<boolean> {
    return this.claimIds.has(claimId);
  }
}

async function runTests() {
  console.log('=== Yemen Task Smart Ad Tracking & Anti-Fraud Test Suite (18 Scenarios) ===');

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const TPL_BANNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TPL_VIDEO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const TPL_LINK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const TPL_POPUNDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const TPL_CAP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const TPL_EXOCLICK = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const TPL_DISPLAY_BANNER = '12121212-1212-4121-8121-121212121212';
  const TPL_WIDGET = '13131313-1313-4131-8131-131313131313';

  const makeStoreAndEngine = (startMs = 1_760_000_000_000) => {
    let clockMs = startMs;
    const store = new InMemoryAdTrackingStore();
    store.templates.set(TPL_BANNER, {
      id: TPL_BANNER,
      title: 'Outstream Video Task S2S',
      placementKey: 'mining_video_primary',
      templateType: 'video_player',
      adFormat: 'outstream_video',
      ytNetworkKey: 'adsterra',
      targetUrl: 'https://example.com/offer',
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_BANNER, {
      adFormat: 'outstream_video',
      trackingEnabled: true,
      verificationMode: 'dwell',
      requiredWatchSec: 30,
      requireActiveVisibility: true,
      requiredVastEvents: [],
      requireLinkReturn: false,
      requireServerPostback: true,
      sessionTtlSec: 900,
      maxDailyPerUser: 25,
      frequencyCapMinutes: 0,
    });

    store.templates.set(TPL_VIDEO, {
      id: TPL_VIDEO,
      title: 'InStream VAST Video',
      placementKey: 'mining_video_primary',
      templateType: 'vast_url',
      adFormat: 'instream_video',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: true,
    });

    store.templates.set(TPL_LINK, {
      id: TPL_LINK,
      title: 'External Link Visit',
      placementKey: 'mining_links_featured',
      templateType: 'external_link',
      adFormat: 'external_link',
      ytNetworkKey: 'monetag',
      targetUrl: 'https://example.com/landing',
      isActive: true,
      trackingEnabled: true,
    });

    store.templates.set(TPL_POPUNDER, {
      id: TPL_POPUNDER,
      title: 'Blocked Popunder Ad',
      placementKey: 'mining_top_banner',
      adFormat: 'popunder',
      ytNetworkKey: null,
      targetUrl: 'https://example.com/pop',
      isActive: true,
      trackingEnabled: true,
    });

    store.templates.set(TPL_CAP, {
      id: TPL_CAP,
      title: 'Frequency Capped Video Slider',
      placementKey: 'mining_video_mid',
      templateType: 'video_player',
      adFormat: 'video_slider',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_CAP, {
      adFormat: 'video_slider',
      trackingEnabled: true,
      verificationMode: 'dwell',
      requiredWatchSec: 5,
      requireActiveVisibility: true,
      requiredVastEvents: [],
      requireLinkReturn: false,
      requireServerPostback: false,
      sessionTtlSec: 600,
      maxDailyPerUser: 2,
      frequencyCapMinutes: 10,
    });

    store.templates.set(TPL_EXOCLICK, {
      id: TPL_EXOCLICK,
      title: 'YemenTask_Website_Banner',
      placementKey: 'mining_banner_gallery',
      templateType: 'network_code',
      adFormat: 'banner',
      sourceName: 'ExoClick',
      codeContent:
        '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>\n' +
        '<ins class="eas6a97888e2" data-zoneid="6104102"></ins>\n' +
        '<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_EXOCLICK, {
      adFormat: 'banner',
      trackingEnabled: true,
      verificationMode: 'dwell',
      requiredWatchSec: 30,
      requireActiveVisibility: true,
      requiredVastEvents: [],
      requireLinkReturn: false,
      requireServerPostback: false,
      sessionTtlSec: 900,
      maxDailyPerUser: 25,
      frequencyCapMinutes: 5,
    });

    store.templates.set(TPL_DISPLAY_BANNER, {
      id: TPL_DISPLAY_BANNER,
      title: 'Mobile Display Banner (Untracked)',
      placementKey: 'mining_banner_gallery',
      templateType: 'html',
      adFormat: 'mobile_banner',
      sourceName: 'DirectBanner',
      codeContent: '<div>Banner</div>',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: false,
    });

    store.templates.set(TPL_WIDGET, {
      id: TPL_WIDGET,
      title: 'Recommendation Widget (Non-Rewardable)',
      placementKey: 'mining_recommendation_intro',
      templateType: 'recommendation_widget',
      adFormat: 'recommendation_widget',
      sourceName: 'WidgetNetwork',
      codeContent: '<div>Recommended</div>',
      ytNetworkKey: 'adsterra',
      targetUrl: 'https://example.com/rec',
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_WIDGET, {
      adFormat: 'recommendation_widget',
      trackingEnabled: true,
      verificationMode: 's2s_postback',
      requiredWatchSec: 10,
      requireActiveVisibility: true,
      requiredVastEvents: [],
      requireLinkReturn: false,
      requireServerPostback: true,
      sessionTtlSec: 600,
      maxDailyPerUser: 25,
      frequencyCapMinutes: 0,
    });

    const engine = new AdTrackingEngine(store, () => clockMs);
    return {
      store,
      engine,
      advanceSec: (sec: number) => {
        clockMs += sec * 1000;
      },
      getNowMs: () => clockMs,
    };
  };

  // [Test 1] Start tracking session & verify crypto token + view_start log
  {
    const { store, engine } = makeStoreAndEngine();
    const res = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER, deviceType: 'mobile' });
    assert.strictEqual(res.trackingEnabled, true);
    assert.ok(res.sessionToken.length === 64, 'Expected 64-char hex session token');
    assert.strictEqual(res.session.sessionStatus, 'started');
    assert.strictEqual(res.session.activeDurationSec, 0);
    assert.strictEqual(store.events.filter((e) => e.eventName === 'view_start').length, 1);
    console.log('✓ [1/18] Session start issues server token & logs initial view_start event');
  }

  // [Test 2] Valid 30s server dwell completion (eligible_for_yt_reward until S2S)
  {
    const { engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    for (let i = 1; i <= 6; i++) {
      advanceSec(5);
      const hb = await engine.recordHeartbeat({
        sessionId: session.id,
        userId: USER_A,
        sessionToken,
        isVisible: true,
        clientElapsedSec: i * 5,
      });
      assert.strictEqual(hb.activeDurationSec, i * 5);
    }
    const done = await engine.attemptComplete({
      sessionId: session.id,
      userId: USER_A,
      sessionToken,
      isVisible: true,
    });
    assert.strictEqual(done.completed, true);
    assert.strictEqual(done.session.sessionStatus, 'completed');
    assert.strictEqual(done.session.verificationStatus, 'verified');
    assert.strictEqual(done.session.eligibilityResult, 'eligible_for_yt_reward');
    console.log('✓ [2/18] Valid 30s server-clock dwell completes and marks S2S eligibility without self-crediting');
  }

  // [Test 3] Premature completion rejection & premature_complete risk flag
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(8);
    await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true, clientElapsedSec: 8 });
    const done = await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(done.completed, false);
    assert.strictEqual(done.session.verificationStatus, 'failed');
    assert.ok(store.riskFlags.some((f) => f.flagType === 'premature_complete'), 'Expected premature_complete risk flag');
    assert.ok(store.events.some((e) => e.eventName === 'complete_rejected'));
    console.log('✓ [3/18] Premature completion (<30s) rejected with high-severity risk flag');
  }

  // [Test 4] Hidden tab visibility pause & visibility_bypass spoofing detection
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(10);
    await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true, clientElapsedSec: 10 });
    advanceSec(12);
    const hiddenHb = await engine.recordHeartbeat({
      sessionId: session.id,
      userId: USER_A,
      sessionToken,
      isVisible: false,
      clientElapsedSec: 45,
    });
    assert.strictEqual(hiddenHb.activeDurationSec, 10, 'Hidden duration must NOT increment activeDurationSec');
    assert.ok(store.riskFlags.some((f) => f.flagType === 'visibility_bypass'), 'Expected visibility_bypass risk flag');
    const done = await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: false });
    assert.strictEqual(done.completed, false);
    console.log('✓ [4/18] Hidden tab pauses server timer & flags spoofed clientElapsedSec');
  }

  // [Test 5] External link exit -> return ordering & time gap capture
  {
    const { engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_LINK });
    await assert.rejects(
      () => engine.recordEvent({ sessionId: session.id, userId: USER_A, sessionToken, eventName: 'external_return' }),
      /قبل تسجيل فتح الرابط الخارجي/
    );
    await engine.recordEvent({ sessionId: session.id, userId: USER_A, sessionToken, eventName: 'external_open' });
    advanceSec(12);
    const returned = await engine.recordEvent({ sessionId: session.id, userId: USER_A, sessionToken, eventName: 'external_return' });
    assert.strictEqual(returned.sessionStatus, 'returned');
    assert.ok(returned.exitAt && returned.returnAt);
    const done = await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(done.completed, true);
    assert.strictEqual(done.session.eligibilityResult, 'eligible_for_yt_reward');
    console.log('✓ [5/18] External link exit/return window validated & logged before S2S reward');
  }

  // [Test 6] Duplicate completion rejection
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    for (let i = 0; i < 3; i++) {
      advanceSec(10);
      await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true, clientElapsedSec: (i + 1) * 10 });
    }
    const first = await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(first.completed, true);
    const second = await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(second.completed, false);
    assert.ok(store.riskFlags.some((f) => f.flagType === 'duplicate_complete'), 'Expected duplicate_complete risk flag');
    console.log('✓ [6/18] Duplicate completion attempt rejected cleanly with risk flag');
  }

  // [Test 7] Replay-protected S2S postback linkage & invalid signature audit
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    for (let i = 0; i < 3; i++) {
      advanceSec(10);
      await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    }
    await engine.attemptComplete({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });

    const invalidSig = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-bad-sig',
      trackingSessionId: session.id,
      ytAdSessionId: null,
      ytRewardClaimId: null,
      userId: USER_A,
      signatureValid: false,
      sanitizedPayload: { amount: 0.01 },
    });
    assert.strictEqual(invalidSig.accepted, false);
    assert.strictEqual(invalidSig.reason, 'invalid_signature');

    const okLink = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-unique-001',
      trackingSessionId: session.id,
      ytAdSessionId: '44444444-4444-4444-8444-444444444444',
      ytRewardClaimId: '55555555-5555-4555-8555-555555555555',
      userId: USER_A,
      signatureValid: true,
      sanitizedPayload: { event: 'view', reward: 10 },
    });
    assert.strictEqual(okLink.accepted, true);
    const updated = await store.getSessionById(session.id);
    assert.strictEqual(updated?.eligibilityResult, 'credited');

    const replay = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-unique-001',
      trackingSessionId: session.id,
      ytAdSessionId: '44444444-4444-4444-8444-444444444444',
      ytRewardClaimId: '55555555-5555-4555-8555-555555555555',
      userId: USER_A,
      signatureValid: true,
      sanitizedPayload: { event: 'view', reward: 10 },
    });
    assert.strictEqual(replay.accepted, false);
    assert.strictEqual(replay.reason, 'duplicate_postback');
    assert.ok(store.riskFlags.some((f) => f.flagType === 'duplicate_postback'));
    console.log('✓ [7/18] S2S postback invalid signature rejected & replay blocked cleanly');
  }

  // [Test 8] Expired session rejection (after server TTL)
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(905); // TTL = 900s
    await assert.rejects(
      () => engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true }),
      /انتهت صلاحية/
    );
    const expiredSess = await store.getSessionById(session.id);
    assert.strictEqual(expiredSess?.sessionStatus, 'expired');
    assert.ok(store.riskFlags.some((f) => f.flagType === 'expired_session'));
    console.log('✓ [8/18] Expired tracking session blocked past server TTL with expired_session flag');
  }

  // [Test 9] Forged template ID & bounded heartbeat step (max 15s per beat)
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: 'not-a-uuid' }),
      /غير صالح/
    );
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: '99999999-9999-4999-8999-999999999999' }),
      /غير موجود/
    );
    assert.strictEqual(store.riskFlags.filter((f) => f.flagType === 'forged_template_id').length, 2);

    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(120);
    const hb = await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(hb.activeDurationSec, 15, 'Single heartbeat increment must be capped at 15s');
    console.log('✓ [9/18] Forged template IDs flagged & single-heartbeat idle jump capped at 15s');
  }

  // [Test 10] VAST milestone sequence enforcement (invalid vs valid progression)
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session: badSess, sessionToken: badTok } = await engine.startSession({
      userId: USER_A,
      templateId: TPL_VIDEO,
    });
    await assert.rejects(
      () => engine.recordEvent({ sessionId: badSess.id, userId: USER_A, sessionToken: badTok, eventName: 'vast_complete' }),
      /تسلسل أحداث الفيديو/
    );
    assert.ok(store.riskFlags.some((f) => f.flagType === 'invalid_vast_sequence'));

    const { session: okSess, sessionToken: okTok } = await engine.startSession({
      userId: USER_A,
      templateId: TPL_VIDEO,
    });
    const stages = ['vast_impression', 'vast_start', 'vast_firstQuartile', 'vast_midpoint', 'vast_thirdQuartile', 'vast_complete'] as const;
    for (const evt of stages) {
      advanceSec(4);
      await engine.recordHeartbeat({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, isVisible: true });
      await engine.recordEvent({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, eventName: evt, isVisible: true });
    }
    await assert.rejects(
      () => engine.recordEvent({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, eventName: 'vast_firstQuartile' }),
      /عكس ترتيب أحداث الفيديو/
    );
    const completed = await engine.attemptComplete({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, isVisible: true });
    assert.strictEqual(completed.completed, true);
    assert.strictEqual(completed.session.eligibilityResult, 'eligible_tracking_only');
    console.log('✓ [10/18] VAST milestone order strictly enforced (invalid sequence blocked, valid completes)');
  }

  // [Test 11] 1-to-1 YT Reward Claim Lock (prevents duplicate claim reuse across different postback IDs)
  {
    const { engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_B, templateId: TPL_BANNER });
    for (let i = 0; i < 3; i++) {
      advanceSec(10);
      await engine.recordHeartbeat({ sessionId: session.id, userId: USER_B, sessionToken, isVisible: true });
    }
    await engine.attemptComplete({ sessionId: session.id, userId: USER_B, sessionToken, isVisible: true });
    const sharedClaimId = '77777777-7777-4777-8777-777777777777';
    const r1 = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-claim-1',
      trackingSessionId: session.id,
      ytAdSessionId: null,
      ytRewardClaimId: sharedClaimId,
      userId: USER_B,
      signatureValid: true,
      sanitizedPayload: {},
    });
    assert.strictEqual(r1.accepted, true);
    const r2 = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-claim-2-different-id',
      trackingSessionId: session.id,
      ytAdSessionId: null,
      ytRewardClaimId: sharedClaimId,
      userId: USER_B,
      signatureValid: true,
      sanitizedPayload: {},
    });
    assert.strictEqual(r2.accepted, false);
    assert.strictEqual(r2.reason, 'duplicate_yt_reward_claim');
    console.log('✓ [11/18] Unique YT reward claim lock blocks reuse across different provider event IDs');
  }

  // [Test 12] Rate limit, Frequency Cap & Daily User Cap enforcement
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    await engine.startSession({ userId: USER_A, templateId: TPL_CAP });
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_CAP }),
      /يرجى الانتظار 10 دقيقة/
    );
    advanceSec(11 * 60);
    await engine.startSession({ userId: USER_A, templateId: TPL_CAP });
    advanceSec(11 * 60);
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_CAP }),
      /تم بلوغ الحد اليومي/
    );
    assert.ok(store.riskFlags.some((f) => f.flagType === 'velocity_anomaly'));

    const bucket = `rate-test-${Date.now()}`;
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1000), true);
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1001), true);
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1002), false);
    console.log('✓ [12/18] Frequency cap, daily cap (velocity_anomaly), and sliding rate limiter enforced');
  }

  // [Test 13] Real Express HTTP API RBAC & Route Guards (401/403/400/200)
  {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const publicRes = await fetch(`${baseUrl}/api/mining-ads/public?deviceType=mobile`);
      assert.strictEqual(publicRes.status, 200);
      const publicBody = (await publicRes.json()) as any;
      assert.strictEqual(publicBody.comfortSettings?.popunderAutoDisabled, true);
      assert.ok(
        !(publicBody.templates || []).some((t: any) => t.adFormat === 'popunder'),
        'Popunder must not be served publicly when popunderAutoDisabled=true'
      );

      const unauthStart = await fetch(`${baseUrl}/api/ad-tracking/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: TPL_BANNER }),
      });
      assert.ok(unauthStart.status === 401 || unauthStart.status === 403);

      const unauthAdminReports = await fetch(`${baseUrl}/api/admin/mining-ads/reports`);
      assert.ok(unauthAdminReports.status === 401 || unauthAdminReports.status === 403);

      const unauthAdminComfort = await fetch(`${baseUrl}/api/admin/mining-ads/comfort-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ popunderAutoDisabled: false }),
      });
      assert.ok(unauthAdminComfort.status === 401 || unauthAdminComfort.status === 403);

      const badPostback = await fetch(`${baseUrl}/api/postbacks/yt-coin-ads/adsterra`);
      assert.strictEqual(badPostback.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    console.log('✓ [13/18] Real Express HTTP routes enforce Auth/Admin RBAC & Comfort public filtering');
  }

  // [Test 14] Popunder block, disabled tracking block, and honest MigrationRequiredError contract
  {
    const { store, engine } = makeStoreAndEngine();
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_POPUNDER }),
      /Popunder معطّلة تلقائياً/
    );
    store.comfortSettings.trackingEnabledByFormat['outstream_video'] = false;
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_BANNER }),
      /التتبع معطّل حالياً/
    );
    const migErr = new MigrationRequiredError('DB tables not migrated');
    assert.strictEqual(migErr.migrationRequired, true);
    assert.ok(migErr instanceof Error);
    console.log('✓ [14/18] Popunder policy, disabled-format guard & honest MigrationRequiredError verified');
  }

  // [Test 15] YT Coin 1000-subunit & Double-Entry / Financial Ledger Isolation Check
  {
    assert.strictEqual(YT_SUBUNITS_PER_YT, 1000);
    assert.strictEqual(YT_MAX_SUPPLY_YT, 100_000_000);
    assert.strictEqual(ytToUnitsStrict(0.01), 10);
    assert.strictEqual(ytToUnitsStrict(0.5), 500);
    assertBalancedYtJournalEntries([
      { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: 10 },
      { accountScope: 'user', accountKey: USER_A, side: 'credit', amountUnits: 10 },
    ]);
    assert.throws(() =>
      assertBalancedYtJournalEntries([
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: 10 },
        { accountScope: 'user', accountKey: USER_A, side: 'credit', amountUnits: 500 },
      ])
    );

    const trackingSrc = fs.readFileSync(path.resolve(process.cwd(), 'server/adTrackingService.ts'), 'utf8');
    const miningAdsSrc = fs.readFileSync(path.resolve(process.cwd(), 'server/miningAdsService.ts'), 'utf8');
    for (const forbidden of ['financial_accounts', 'ledger_transactions', 'ledger_entries', 'wallets']) {
      assert.ok(
        !trackingSrc.includes(forbidden) && !miningAdsSrc.includes(forbidden),
        `Forbidden financial ledger table reference found: ${forbidden}`
      );
    }
    console.log('✓ [15/18] YT Coin 1000-subunit math, double-entry balance & YER financial ledger isolation intact');
  }

  // [Test 16] Strict Video/Link Allowlist vs Display Banners, Widgets, Multi-Format & ExoClick Separation
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    assert.strictEqual(isDisplayBannerAd({ adFormat: 'banner', sourceName: 'ExoClick' }), true);
    assert.strictEqual(isDisplayBannerAd({ adFormat: 'mobile_banner' }), true);
    assert.strictEqual(isDisplayBannerAd({ adFormat: 'instream_video', sourceName: 'VAST' }), false);

    // Positive allowlist: ONLY Video & Link task formats may grant rewards
    for (const allowedFmt of REWARD_ELIGIBLE_AD_FORMATS) {
      assert.strictEqual(isRewardEligibleAd({ adFormat: allowedFmt }), true);
      assert.strictEqual(isRewardEligibleTemplate({ adFormat: allowedFmt }), true);
    }
    // Negative check: Banners, Interstitials, Sticky, Popunder, Widgets, Native Cards, Multi-Format, Push & ExoClick
    for (const nonRewardFmt of [
      'banner',
      'mobile_banner',
      'sticky_banner',
      'mobile_sticky_banner',
      'desktop_interstitial',
      'mobile_interstitial',
      'instant_message',
      'popunder',
      'recommendation_widget',
      'native_cards',
      'push_notification',
      'multi_format',
    ] as const) {
      assert.strictEqual(
        isRewardEligibleAd({ adFormat: nonRewardFmt }),
        false,
        `Non-rewardable format must NOT qualify for YT Coin rewards: ${nonRewardFmt}`
      );
      assert.strictEqual(
        isRewardEligibleTemplate({ adFormat: nonRewardFmt }),
        false,
        `Shared helper must reject non-rewardable format: ${nonRewardFmt}`
      );
    }
    // Even if mis-tagged as video_player/outstream_video, ExoClick banner script & image_banner must remain excluded
    assert.strictEqual(
      isRewardEligibleAd({
        adFormat: 'outstream_video',
        sourceName: 'ExoClick',
        codeContent: '<ins class="eas6a97888e2" data-zoneid="6104102"></ins>',
      }),
      false
    );
    assert.strictEqual(
      isRewardEligibleAd({ adFormat: 'outstream_video', templateType: 'image_banner' }),
      false
    );

    // ExoClick Zone 6104102 supports full 30s server tracking (impression + view_start + dwell + anti-tampering)
    // WITHOUT ever minting YT Coin or inheriting S2S reward status
    const exoStart = await engine.startSession({ userId: USER_A, templateId: TPL_EXOCLICK, deviceType: 'mobile' });
    assert.strictEqual(exoStart.session.networkKey, null);
    assert.strictEqual(exoStart.session.requiredWatchSec, 30);
    await engine.recordEvent({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      eventName: 'impression',
      isVisible: true,
    });

    // Reject premature completion before 30 seconds
    advanceSec(10);
    await engine.recordHeartbeat({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      isVisible: true,
      clientElapsedSec: 10,
    });
    const exoPremature = await engine.attemptComplete({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      isVisible: true,
    });
    assert.strictEqual(exoPremature.completed, false);
    assert.ok(store.riskFlags.some((f) => f.flagType === 'premature_complete'));

    // Hidden tab pauses timer on Zone 6104102
    advanceSec(15);
    const exoHiddenHb = await engine.recordHeartbeat({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      isVisible: false,
      clientElapsedSec: 35,
    });
    assert.strictEqual(exoHiddenHb.activeDurationSec, 10, 'Hidden tab must pause Zone 6104102 active timer');
    assert.ok(store.riskFlags.some((f) => f.flagType === 'visibility_bypass'));

    // Finish remaining 20 active seconds -> reaches 30s total active duration
    for (let i = 0; i < 4; i++) {
      advanceSec(5);
      await engine.recordHeartbeat({
        sessionId: exoStart.session.id,
        userId: USER_A,
        sessionToken: exoStart.sessionToken,
        isVisible: true,
        clientElapsedSec: 10 + (i + 1) * 5,
      });
    }
    const exoDone = await engine.attemptComplete({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      isVisible: true,
    });
    assert.strictEqual(exoDone.completed, true);
    assert.strictEqual(exoDone.session.eligibilityResult, 'eligible_tracking_only');

    // Duplicate completion attempt on Zone 6104102 must fail
    const exoDup = await engine.attemptComplete({
      sessionId: exoStart.session.id,
      userId: USER_A,
      sessionToken: exoStart.sessionToken,
      isVisible: true,
    });
    assert.strictEqual(exoDup.completed, false);
    assert.ok(store.riskFlags.some((f) => f.flagType === 'duplicate_complete'));

    // Frequency cap blocks rapid re-start of Zone 6104102 within 5 minutes
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_EXOCLICK }),
      /يرجى الانتظار 5 دقيقة/
    );

    // Untracked banner with trackingEnabled=false still blocks session start
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_DISPLAY_BANNER }),
      /التتبع معطّل حالياً/
    );

    // Recommendation Widget / Native Cards / Multi-Format never inherit networkKey or S2S YT rewards
    const widgetStart = await engine.startSession({ userId: USER_A, templateId: TPL_WIDGET });
    assert.strictEqual(widgetStart.session.networkKey, null);
    advanceSec(11);
    const widgetDone = await engine.attemptComplete({
      sessionId: widgetStart.session.id,
      userId: USER_A,
      sessionToken: widgetStart.sessionToken,
      isVisible: true,
    });
    assert.strictEqual(widgetDone.completed, true);
    assert.strictEqual(widgetDone.session.eligibilityResult, 'eligible_tracking_only');

    const blockedWidgetPostback = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-widget-blocked',
      trackingSessionId: widgetStart.session.id,
      ytAdSessionId: '44444444-4444-4444-8444-444444444444',
      ytRewardClaimId: '66666666-6666-4666-8666-666666666666',
      userId: USER_A,
      signatureValid: true,
      sanitizedPayload: {},
    });
    assert.strictEqual(blockedWidgetPostback.accepted, false);
    assert.strictEqual(blockedWidgetPostback.reason, 'non_rewardable_ad_format');

    // Postback linkage targeting Zone 6104102 session MUST strictly reject YT Coin crediting
    const blockedBannerPostback = await engine.recordVerifiedPostbackLinkage({
      networkKey: 'adsterra',
      providerEventId: 'evt-banner-blocked',
      trackingSessionId: exoStart.session.id,
      ytAdSessionId: '44444444-4444-4444-8444-444444444444',
      ytRewardClaimId: '55555555-5555-4555-8555-555555555555',
      userId: USER_A,
      signatureValid: true,
      sanitizedPayload: {},
    });
    assert.strictEqual(blockedBannerPostback.accepted, false);
    assert.strictEqual(blockedBannerPostback.reason, 'display_banner_non_rewardable');

    // Code validator accepts clean ExoClick Zone 6104102 but rejects popunder / forced redirect in banners
    const exoCode =
      '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>\n' +
      '<ins class="eas6a97888e2" data-zoneid="6104102"></ins>\n' +
      '<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>';
    assert.strictEqual(validateCodeContent(exoCode, 'network_code', 'banner'), exoCode);
    assert.throws(
      () => validateCodeContent('<script>window.top.location="https://evil.com"</script>', 'network_code', 'banner'),
      /إعادة التوجيه القسري/
    );
    assert.throws(
      () => validateCodeContent('<script src="https://cdn.example/popunder.js"></script>', 'network_code', 'banner'),
      /Popunder/
    );

    // ExoClick Video VAST (Zone 6104150) IS a Video ad, NOT a Display Banner, even with sourceName='ExoClick'
    assert.strictEqual(
      isDisplayBannerAd({ adFormat: 'instream_video', sourceName: 'ExoClick', codeContent: '' }),
      false
    );
    assert.strictEqual(
      isRewardEligibleAd({
        adFormat: 'instream_video',
        templateType: 'vast_url',
        sourceName: 'ExoClick',
        codeContent: '',
      }),
      true
    );
    console.log('✓ [16/18] Video/Link reward allowlist & Display Banner/Widget/ExoClick separation enforced');
  }

  // [Test 17] ExoClick Sandbox srcDoc single-script guard, MutationObserver & duplicate zone detection
  {
    const exoCode =
      '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>\n' +
      '<ins class="eas6a97888e2" data-zoneid="6104102"></ins>\n' +
      '<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>';
    assert.strictEqual(isExoClickCode(exoCode, 'ExoClick'), true);
    assert.strictEqual(extractAdZoneKey({ codeContent: exoCode, sourceName: 'ExoClick' }), 'exoclick:zone:6104102');
    assert.strictEqual(extractAdZoneSignature(exoCode, 'ExoClick'), 'exoclick:zone:6104102');

    const srcDoc = buildMiningAdSrcDoc({
      id: TPL_EXOCLICK,
      sourceName: 'ExoClick',
      templateType: 'network_code',
      codeContent: exoCode,
      width: 300,
      height: 250,
    });
    assert.ok(srcDoc.includes('data-zoneid="6104102"'), 'Expected Zone 6104102 inside sandbox srcDoc');
    assert.ok(srcDoc.includes('__ytExoAdProviderInit'), 'Expected single-init guard');
    assert.ok(srcDoc.includes('__ytExoPushCalled'), 'Expected single AdProvider.push guard');
    assert.ok(srcDoc.includes('data-yt-exoclick'), 'Expected single script tag attribute check');
    assert.ok(srcDoc.includes('MutationObserver'), 'Expected fill detection MutationObserver');
    assert.ok(srcDoc.includes('obs.observe(document.body'), 'Expected body observer for sibling <div> injection');
    assert.ok(srcDoc.includes('__memCookieJar'), 'Expected safe sandbox cookie jar shim for ExoClick c_uvt');
    assert.ok(srcDoc.includes('yt_mining_ad_status'), 'Expected postMessage status handshake');
    assert.ok(!srcDoc.includes('allow-same-origin'), 'Must never include allow-same-origin in srcDoc');
    assert.ok(
      srcDoc.includes('http-equiv="Delegate-CH"') && srcDoc.includes('https://s.magsrv.com'),
      'Expected ExoClick Delegate-CH Client Hints tag inside ExoClick srcDoc'
    );

    const indexHtmlPath = path.resolve(process.cwd(), 'index.html');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    assert.ok(indexHtml.includes('6a97888e-site-verification'), 'Expected ExoClick verification tag in index.html');
    console.log('✓ [17/18] ExoClick sandbox srcDoc enforces Delegate-CH, single script load, MutationObserver & zone dedup');
  }

  // [Test 18] ExoClick SQL migrations contract & financial/ClixWall/Offerwall preservation check
  {
    const migPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261128000000_seed_exoclick_yementask_banner.sql'
    );
    assert.ok(fs.existsSync(migPath), 'Prepared ExoClick migration file must exist');
    const sql = fs.readFileSync(migPath, 'utf8');
    assert.ok(sql.includes('YemenTask_Website_Banner'));
    assert.ok(sql.includes('6104102'));
    assert.ok(sql.includes("'ExoClick'"));
    assert.ok(sql.includes('300'));
    assert.ok(sql.includes('250'));
    assert.ok(sql.includes('NOT EXISTS'), 'Migration must guard against duplicate zone inserts');
    for (const untouched of ['yt_coin.', 'financial_accounts', 'ledger_transactions', 'wallets', 'ad_partners', 'clixwall', 'offerwall']) {
      assert.ok(!sql.toLowerCase().includes(untouched), `Prepared migration must not touch ${untouched}`);
    }

    const videoMigPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261129000000_seed_exoclick_video_vast_6104150.sql'
    );
    assert.ok(fs.existsSync(videoMigPath), 'Prepared ExoClick Video VAST migration file must exist');
    const videoSql = fs.readFileSync(videoMigPath, 'utf8');
    assert.ok(videoSql.includes('YemenTask_Video_VAST_6104150'));
    assert.ok(videoSql.includes('https://s.magsrv.com/v1/vast.php?idz=6104150'));
    assert.ok(videoSql.includes('NOT EXISTS'), 'Video VAST migration must guard against duplicate inserts');
    for (const untouched of ['yt_coin.', 'financial_accounts', 'ledger_transactions', 'wallets', 'ad_partners', 'clixwall', 'offerwall']) {
      assert.ok(!videoSql.toLowerCase().includes(untouched), `Video VAST migration must not touch ${untouched}`);
    }

    const activateMigPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261130000000_activate_exoclick_zone_6104102_30s_tracking.sql'
    );
    assert.ok(fs.existsSync(activateMigPath), 'Activation ExoClick Zone 6104102 migration must exist');
    const actSql = fs.readFileSync(activateMigPath, 'utf8');
    assert.ok(actSql.includes('6104102'));
    assert.ok(actSql.includes('30'));
    assert.ok(actSql.includes('tracking_enabled = true'));
    assert.ok(actSql.includes('is_active = true'));
    assert.ok(actSql.includes('require_server_postback = false'));
    for (const untouched of ['yt_coin.', 'financial_accounts', 'ledger_transactions', 'wallets', 'ad_partners', 'clixwall', 'offerwall']) {
      assert.ok(!actSql.toLowerCase().includes(untouched), `Activation migration must not touch ${untouched}`);
    }
    console.log('✓ [18/18] ExoClick banner, video VAST, and 6104102 30s tracking migrations are idempotent & isolated from ledgers');
  }

  console.log('\nALL 18 SMART AD TRACKING, EXOCLICK & ANTI-FRAUD TESTS PASSED.');
}

void runTests().catch((err) => {
  console.error('❌ Ad Tracking Test Suite Failed:', err);
  process.exit(1);
});
