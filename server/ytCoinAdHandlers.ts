import type { Response } from 'express';
import crypto from 'node:crypto';
import { getSupabaseAdminClient, getSupabaseUserClient } from './supabaseClient.js';
import type { AuthenticatedRequest } from './app.js';
import { unitsToYt, ytToUnitsStrict } from '../shared/ytCoin.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NETWORK_KEY_REGEX = /^[a-z0-9_-]{2,48}$/;

function timingSafeEqualsUtf8(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isEnvSecretConfigured(envKey: unknown): boolean {
  if (typeof envKey !== 'string') return false;
  const trimmed = envKey.trim();
  if (!/^[A-Z0-9_]{3,80}$/.test(trimmed)) return false;
  const val = process.env[trimmed];
  return typeof val === 'string' && val.trim().length >= 8;
}

function resolveEnvSecret(envKey: unknown): string {
  if (typeof envKey !== 'string') return '';
  const trimmed = envKey.trim();
  if (!/^[A-Z0-9_]{3,80}$/.test(trimmed)) return '';
  return (process.env[trimmed] || '').trim();
}

function buildSessionPlacementUrl(
  rawTemplate: string | null | undefined,
  params: { userId: string; sessionId: string; eventType: string }
): string | null {
  if (!rawTemplate || typeof rawTemplate !== 'string') return null;
  const trimmed = rawTemplate.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed
    .replace(/\{user_id\}|\{userid\}|\{subid\}/gi, encodeURIComponent(params.userId))
    .replace(/\{session_id\}|\{click_id\}|\{sessionid\}/gi, encodeURIComponent(params.sessionId))
    .replace(/\{event_type\}/gi, encodeURIComponent(params.eventType));
}

export async function getYtCoinAdCenter(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
    const userClient = getSupabaseUserClient(req.authToken);
    const { data, error } = await userClient.rpc('get_yt_coin_ad_center');
    if (error) throw error;

    const raw = (data && typeof data === 'object' ? data : {}) as Record<string, any>;
    const dbNetworks = Array.isArray(raw.networks) ? raw.networks : [];

    const enrichedNetworks = dbNetworks.map((net: any) => {
      const secretConfigured = isEnvSecretConfigured(net?.secretEnvKey);
      const hasUrl = typeof net?.placementUrl === 'string' && /^https?:\/\//i.test(net.placementUrl.trim());
      const isConnected = Boolean(net?.isActive) && secretConfigured && hasUrl;
      return {
        id: net.id,
        networkKey: net.networkKey,
        displayName: net.displayName,
        description: net.description || null,
        adType: net.adType || 'both',
        rewardClickUnits: Number(net.rewardClickUnits ?? 10),
        rewardClickYt: Number(net.rewardClickYt ?? unitsToYt(net.rewardClickUnits ?? 10)),
        rewardViewUnits: Number(net.rewardViewUnits ?? 10),
        rewardViewYt: Number(net.rewardViewYt ?? unitsToYt(net.rewardViewUnits ?? 10)),
        dailyUserLimit: Number(net.dailyUserLimit ?? 20),
        isActive: Boolean(net.isActive),
        isConnected,
      };
    });

    const connectedNetworks = enrichedNetworks.filter((n) => n.isConnected);

    const adClickRewardUnits = Math.max(1, Math.floor(Number(raw.adClickRewardUnits ?? 10) || 10));
    const adViewRewardUnits = Math.max(1, Math.floor(Number(raw.adViewRewardUnits ?? 10) || 10));
    const totalAdEarnedUnits = Math.max(0, Math.floor(Number(raw.totalAdEarnedUnits ?? 0) || 0));

    return res.json({
      adCenter: {
        unitScale: Number(raw.unitScale ?? raw.partsPerYt ?? 1000) || 1000,
        adClickRewardUnits,
        adClickRewardYt: unitsToYt(adClickRewardUnits),
        adViewRewardUnits,
        adViewRewardYt: unitsToYt(adViewRewardUnits),
        dailyAdLimit: Number(raw.dailyAdLimit ?? 20),
        adsToday: Number(raw.adsToday ?? 0),
        totalAdEarnedUnits,
        totalAdEarnedYt: unitsToYt(totalAdEarnedUnits),
        availableAdsCount: connectedNetworks.length,
        hasConnectedNetwork: connectedNetworks.length > 0,
        connectedNetworks,
        recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents : [],
      },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'تعذر تحميل مركز مكافآت الإعلانات.' });
  }
}

export async function createYtCoinAdSession(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.authToken || !req.user?.id) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const networkKey = String(body.networkKey || '').trim().toLowerCase();
    const eventType = String(body.eventType || 'view').trim().toLowerCase();

    if (!NETWORK_KEY_REGEX.test(networkKey)) {
      return res.status(400).json({ error: 'معرف الشبكة الإعلانية غير صالح.' });
    }
    if (eventType !== 'click' && eventType !== 'view') {
      return res.status(400).json({ error: 'نوع الحدث الإعلاني غير صالح.' });
    }

    // Verify network has an active server-side verification secret before issuing session
    const adminClient = getSupabaseAdminClient();
    const { data: netMeta, error: netErr } = await adminClient.rpc('service_get_yt_coin_ad_network', {
      p_network_key: networkKey,
    });
    if (netErr) throw netErr;
    const netRec = (netMeta && typeof netMeta === 'object' ? netMeta : {}) as Record<string, any>;
    if (!netRec.found || !netRec.isActive || !isEnvSecretConfigured(netRec.secretEnvKey)) {
      return res.status(400).json({ error: 'هذه الشبكة الإعلانية غير متصلة أو غير مهيأة للتحقق الموثوق حالياً.' });
    }

    const userClient = getSupabaseUserClient(req.authToken);
    const { data, error } = await userClient.rpc('create_yt_coin_ad_session', {
      p_network_key: networkKey,
      p_event_type: eventType,
    });
    if (error) throw error;

    const sessionRes = (data && typeof data === 'object' ? data : {}) as Record<string, any>;
    if (!sessionRes.success) {
      return res.status(400).json({ error: sessionRes.message || 'تعذر بدء جلسة الإعلان.' });
    }

    const targetUrl = buildSessionPlacementUrl(sessionRes.placementUrl, {
      userId: req.user.id,
      sessionId: String(sessionRes.sessionId || ''),
      eventType,
    });

    if (!targetUrl) {
      return res.status(400).json({ error: 'رابط العرض الإعلاني للشبكة غير مهيأ.' });
    }

    return res.json({
      session: {
        sessionId: sessionRes.sessionId,
        networkKey: sessionRes.networkKey,
        eventType: sessionRes.eventType,
        targetUrl,
        rewardGrantedOnOpen: false,
      },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'تعذر بدء جلسة الإعلان الموثقة.' });
  }
}

export async function handleVerifiedYtCoinAdPostback(req: AuthenticatedRequest, res: Response) {
  try {
    const networkKey = String(req.params.networkKey || '').trim().toLowerCase();
    if (!NETWORK_KEY_REGEX.test(networkKey)) {
      return res.status(400).json({ error: 'Invalid network key.' });
    }

    const payload: Record<string, unknown> = {
      ...(req.query || {}),
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
    };

    const userId = String(payload.user_id || payload.userid || payload.subid || '').trim();
    const externalEventId = String(
      payload.event_id || payload.transaction_id || payload.tx_id || payload.reference || ''
    ).trim();
    const eventType = String(payload.event_type || payload.type || 'view').trim().toLowerCase();
    const rawSessionId = String(payload.session_id || payload.click_id || '').trim();
    const sessionId = UUID_REGEX.test(rawSessionId) ? rawSessionId : null;

    if (!UUID_REGEX.test(userId)) {
      return res.status(400).json({ error: 'Invalid or missing user_id.' });
    }
    if (!externalEventId || externalEventId.length > 128) {
      return res.status(400).json({ error: 'Invalid or missing unique event_id.' });
    }
    if (eventType !== 'click' && eventType !== 'view') {
      return res.status(400).json({ error: 'Invalid event_type (expected click or view).' });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: netMeta, error: netErr } = await adminClient.rpc('service_get_yt_coin_ad_network', {
      p_network_key: networkKey,
    });
    if (netErr) throw netErr;
    const netRec = (netMeta && typeof netMeta === 'object' ? netMeta : {}) as Record<string, any>;

    if (!netRec.found || !netRec.isActive) {
      return res.status(404).json({ error: 'Ad network not found or inactive.' });
    }

    const expectedSecret = resolveEnvSecret(netRec.secretEnvKey);
    if (!expectedSecret) {
      return res.status(503).json({ error: 'Verification secret not configured on server.' });
    }

    const authMode = String(netRec.authMode || 'hmac_sha256');
    if (authMode === 'shared_secret') {
      const providedSecret = String(
        req.headers['x-postback-secret'] || payload.secret || payload.token || ''
      ).trim();
      if (!timingSafeEqualsUtf8(expectedSecret, providedSecret)) {
        return res.status(401).json({ error: 'Unauthorized postback secret.' });
      }
    } else {
      const providedSig = String(
        req.headers['x-ad-signature'] || payload.signature || payload.sig || payload.hash || ''
      )
        .trim()
        .toLowerCase();
      const canonicalFull = crypto
        .createHmac('sha256', expectedSecret)
        .update(`${userId}:${externalEventId}:${eventType}`)
        .digest('hex')
        .toLowerCase();
      const canonicalShort = crypto
        .createHmac('sha256', expectedSecret)
        .update(`${userId}:${externalEventId}`)
        .digest('hex')
        .toLowerCase();

      const validSig =
        timingSafeEqualsUtf8(canonicalFull, providedSig) ||
        timingSafeEqualsUtf8(canonicalShort, providedSig);
      if (!validSig) {
        return res.status(401).json({ error: 'Invalid postback HMAC signature.' });
      }
    }

    // Strip secrets from stored metadata
    const sanitizedMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (!/secret|token|signature|sig|hash/i.test(k)) {
        sanitizedMeta[k] = v;
      }
    }

    const { data: creditRes, error: creditErr } = await adminClient.rpc('service_credit_yt_coin_verified_ad', {
      p_network_key: networkKey,
      p_external_event_id: externalEventId,
      p_user_id: userId,
      p_event_type: eventType,
      p_session_id: sessionId,
      p_verification_source: `${networkKey}:${authMode}`,
      p_raw_metadata: sanitizedMeta,
    });
    if (creditErr) throw creditErr;

    const result = (creditRes && typeof creditRes === 'object' ? creditRes : {}) as Record<string, any>;

    // Non-blocking audit linkage to ad_provider_postbacks & ad_tracking_sessions
    const rawTrackingId = String(payload.tracking_session_id || payload.subid2 || '').trim();
    const trackingSessionId = UUID_REGEX.test(rawTrackingId) ? rawTrackingId : null;
    try {
      const { adTrackingEngine } = await import('./adTrackingService.js');
      await adTrackingEngine.recordVerifiedPostbackLinkage({
        networkKey,
        providerEventId: externalEventId,
        trackingSessionId,
        ytAdSessionId: sessionId,
        ytRewardClaimId: typeof result.claimId === 'string' && UUID_REGEX.test(result.claimId) ? result.claimId : null,
        userId,
        signatureValid: true,
        sanitizedPayload: sanitizedMeta,
      });
    } catch {
      // Do not interrupt verified YT Coin credit if tracking migration 20261127000000 is pending approval
    }

    if (!result.success) {
      return res.status(422).json({
        success: false,
        status: result.status || 'rejected',
        error: result.message || 'Ad reward rejected.',
      });
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to process verified ad postback.' });
  }
}

export async function adminUpsertYtCoinAdNetwork(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الإدارة مطلوبة.' });
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    const id = typeof body.id === 'string' && UUID_REGEX.test(body.id.trim()) ? body.id.trim() : null;
    const networkKey = String(body.networkKey || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const authMode = body.authMode === 'shared_secret' ? 'shared_secret' : 'hmac_sha256';
    const secretEnvKey =
      typeof body.secretEnvKey === 'string' && /^[A-Z0-9_]{3,80}$/.test(body.secretEnvKey.trim())
        ? body.secretEnvKey.trim()
        : 'YT_COIN_AD_POSTBACK_SECRET';
    const placementUrl = typeof body.placementUrl === 'string' ? body.placementUrl.trim() : null;
    const adType = body.adType === 'click' || body.adType === 'view' ? body.adType : 'both';

    if (!NETWORK_KEY_REGEX.test(networkKey)) {
      return res.status(400).json({ error: 'مفتاح الشبكة يجب أن يتكون من أحرف إنجليزية صغيرة أو أرقام أو -/_ (2-48 حرفاً).' });
    }
    if (!displayName) {
      return res.status(400).json({ error: 'اسم الشبكة الإعلانية مطلوب.' });
    }
    if (placementUrl && !/^https?:\/\//i.test(placementUrl)) {
      return res.status(400).json({ error: 'رابط العرض يجب أن يبدأ بـ https:// أو http://.' });
    }

    const rewardClickUnits = ytToUnitsStrict(body.rewardClickYt ?? 0.01, {
      fieldLabel: 'مكافأة النقرة الإعلانية',
      minUnits: 1,
    });
    const rewardViewUnits = ytToUnitsStrict(body.rewardViewYt ?? 0.01, {
      fieldLabel: 'مكافأة مشاهدة الإعلان',
      minUnits: 1,
    });
    const dailyUserLimit = Math.max(0, Math.floor(Number(body.dailyUserLimit ?? 20) || 0));
    const isActive = Boolean(body.isActive);

    const { data, error } = await getSupabaseUserClient(req.authToken).rpc('admin_manage_yt_coin_ad_network', {
      p_action: 'upsert',
      p_id: id,
      p_network_key: networkKey,
      p_display_name: displayName,
      p_description: description,
      p_auth_mode: authMode,
      p_secret_env_key: secretEnvKey,
      p_placement_url: placementUrl,
      p_ad_type: adType,
      p_reward_click_units: rewardClickUnits,
      p_reward_view_units: rewardViewUnits,
      p_daily_user_limit: dailyUserLimit,
      p_is_active: isActive,
    });
    if (error) throw error;

    return res.json({
      network: data,
      secretConfigured: isEnvSecretConfigured(secretEnvKey),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'تعذر حفظ بيانات الشبكة الإعلانية.' });
  }
}

export async function adminDeleteYtCoinAdNetwork(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الإدارة مطلوبة.' });
    const id = String(req.params.id || '').trim();
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'معرف الشبكة الإعلانية غير صالح.' });
    }

    const { data, error } = await getSupabaseUserClient(req.authToken).rpc('admin_manage_yt_coin_ad_network', {
      p_action: 'delete',
      p_id: id,
    });
    if (error) throw error;
    return res.json({ result: data });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'تعذر حذف الشبكة الإعلانية.' });
  }
}
