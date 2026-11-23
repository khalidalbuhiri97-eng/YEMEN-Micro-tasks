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
import { DEFAULT_COMFORT_SETTINGS, MigrationRequiredError } from './miningAdsService.js';
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
  console.log('=== Yemen Task Smart Ad Tracking & Anti-Fraud Test Suite (15 Scenarios) ===');

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const TPL_BANNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TPL_VIDEO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const TPL_LINK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const TPL_POPUNDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const TPL_CAP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  const makeStoreAndEngine = (startMs = 1_760_000_000_000) => {
    let clockMs = startMs;
    const store = new InMemoryAdTrackingStore();
    store.templates.set(TPL_BANNER, {
      id: TPL_BANNER,
      title: 'Web Banner S2S',
      placementKey: 'mining_top_banner',
      adFormat: 'banner',
      ytNetworkKey: 'adsterra',
      targetUrl: 'https://example.com/offer',
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_BANNER, {
      adFormat: 'banner',
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
      adFormat: 'instream_video',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: true,
    });

    store.templates.set(TPL_LINK, {
      id: TPL_LINK,
      title: 'External Link Visit',
      placementKey: 'mining_links_primary',
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
      title: 'Frequency Capped Banner',
      placementKey: 'mining_top_banner',
      adFormat: 'banner',
      ytNetworkKey: null,
      targetUrl: null,
      isActive: true,
      trackingEnabled: true,
    });
    store.rulesByTemplate.set(TPL_CAP, {
      adFormat: 'banner',
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
    console.log('✓ [1/15] Session start issues server token & logs initial view_start event');
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
    console.log('✓ [2/15] Valid 30s server-clock dwell completes and marks S2S eligibility without self-crediting');
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
    console.log('✓ [3/15] Premature completion (<30s) rejected with high-severity risk flag');
  }

  // [Test 4] Hidden tab visibility pause & visibility_bypass spoofing detection
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(10);
    await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true, clientElapsedSec: 10 });
    // Tab hidden for 12s while user tries to spoof clientElapsedSec = 45
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
    console.log('✓ [4/15] Hidden tab pauses server timer & flags spoofed clientElapsedSec');
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
    console.log('✓ [5/15] External link exit/return window validated & logged before S2S reward');
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
    console.log('✓ [6/15] Duplicate completion attempt rejected cleanly with risk flag');
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
    console.log('✓ [7/15] S2S postback invalid signature rejected & replay blocked cleanly');
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
    console.log('✓ [8/15] Expired tracking session blocked past server TTL with expired_session flag');
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

    // Even if user leaves tab open for 120s without heartbeats, one heartbeat adds max 15s!
    const { session, sessionToken } = await engine.startSession({ userId: USER_A, templateId: TPL_BANNER });
    advanceSec(120);
    const hb = await engine.recordHeartbeat({ sessionId: session.id, userId: USER_A, sessionToken, isVisible: true });
    assert.strictEqual(hb.activeDurationSec, 15, 'Single heartbeat increment must be capped at 15s');
    console.log('✓ [9/15] Forged template IDs flagged & single-heartbeat idle jump capped at 15s');
  }

  // [Test 10] VAST milestone sequence enforcement (invalid vs valid progression)
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    const { session: badSess, sessionToken: badTok } = await engine.startSession({
      userId: USER_A,
      templateId: TPL_VIDEO,
    });
    // Reject vast_complete before vast_start
    await assert.rejects(
      () => engine.recordEvent({ sessionId: badSess.id, userId: USER_A, sessionToken: badTok, eventName: 'vast_complete' }),
      /تسلسل أحداث الفيديو/
    );
    assert.ok(store.riskFlags.some((f) => f.flagType === 'invalid_vast_sequence'));

    // Valid VAST sequence
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
    // Reject regression after midpoint/complete
    await assert.rejects(
      () => engine.recordEvent({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, eventName: 'vast_firstQuartile' }),
      /عكس ترتيب أحداث الفيديو/
    );
    const completed = await engine.attemptComplete({ sessionId: okSess.id, userId: USER_A, sessionToken: okTok, isVisible: true });
    assert.strictEqual(completed.completed, true);
    assert.strictEqual(completed.session.eligibilityResult, 'eligible_tracking_only');
    console.log('✓ [10/15] VAST milestone order strictly enforced (invalid sequence blocked, valid completes)');
  }

  // [Test 11] 1-to-1 YT Reward Claim Lock (prevents duplicate claim reuse across different postback IDs)
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
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
    console.log('✓ [11/15] Unique YT reward claim lock blocks reuse across different provider event IDs');
  }

  // [Test 12] Rate limit, Frequency Cap & Daily User Cap enforcement
  {
    const { store, engine, advanceSec } = makeStoreAndEngine();
    // Frequency cap = 10 min
    await engine.startSession({ userId: USER_A, templateId: TPL_CAP });
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_CAP }),
      /يرجى الانتظار 10 دقيقة/
    );
    advanceSec(11 * 60);
    await engine.startSession({ userId: USER_A, templateId: TPL_CAP });
    advanceSec(11 * 60);
    // Max daily per user = 2
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_CAP }),
      /تم بلوغ الحد اليومي/
    );
    assert.ok(store.riskFlags.some((f) => f.flagType === 'velocity_anomaly'));

    // Sliding window rate limiter
    const bucket = `rate-test-${Date.now()}`;
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1000), true);
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1001), true);
    assert.strictEqual(checkTrackingRateLimit(bucket, 2, 60_000, 1002), false);
    console.log('✓ [12/15] Frequency cap, daily cap (velocity_anomaly), and sliding rate limiter enforced');
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
    console.log('✓ [13/15] Real Express HTTP routes enforce Auth/Admin RBAC & Comfort public filtering');
  }

  // [Test 14] Popunder block, disabled tracking block, and honest MigrationRequiredError contract
  {
    const { store, engine } = makeStoreAndEngine();
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_POPUNDER }),
      /Popunder معطّلة تلقائياً/
    );
    store.comfortSettings.trackingEnabledByFormat['banner'] = false;
    await assert.rejects(
      () => engine.startSession({ userId: USER_A, templateId: TPL_BANNER }),
      /التتبع معطّل حالياً/
    );
    const migErr = new MigrationRequiredError('DB tables not migrated');
    assert.strictEqual(migErr.migrationRequired, true);
    assert.ok(migErr instanceof Error);
    console.log('✓ [14/15] Popunder policy, disabled-format guard & honest MigrationRequiredError verified');
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
    console.log('✓ [15/15] YT Coin 1000-subunit math, double-entry balance & YER financial ledger isolation intact');
  }

  console.log('\nALL 15 SMART AD TRACKING & ANTI-FRAUD TESTS PASSED.');
}

void runTests().catch((err) => {
  console.error('❌ Ad Tracking Test Suite Failed:', err);
  process.exit(1);
});
