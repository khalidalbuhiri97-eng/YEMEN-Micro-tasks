import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CLIXWALL_EXCHANGE_RATE = 1600;
export const CLIXWALL_USER_SHARE_RATIO = 0.7;
export const CLIXWALL_PUBLISHER_SHARE_RATIO = 0.3;
const RATIO_TOLERANCE = 0.025; // Allows 2.5% rounding drift on micro-payouts

export interface AuthenticatedClixWallRequest extends Request {
  user?: { id: string; [key: string]: any };
}

export type ClixWallStatusClassification =
  | { kind: 'credit'; dbStatus: 'credited'; rawStatus: string }
  | { kind: 'reversal'; dbStatus: 'reversed'; rawStatus: string }
  | { kind: 'ignore'; normalizedStatus: string; rawStatus: string }
  | { kind: 'invalid'; error: string };

export type ClixWallPayoutValidation =
  | {
      valid: true;
      userShareUsd: number;
      publisherShareUsd: number;
      rewardYer: number;
    }
  | {
      valid: false;
      error: string;
    };

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function timingSafeSecretEquals(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function sanitizeClixWallPayload(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeClixWallPayload);

  const clean: Record<string, unknown> = {};
  const SENSITIVE_KEYS = [
    'secret',
    'hash',
    'signature',
    'token',
    'apikey',
    'api_key',
    'authorization',
    'password',
  ];

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      clean[key] = '[REDACTED_SENSITIVE_DATA]';
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizeClixWallPayload(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export function classifyClixWallStatus(rawInput: unknown): ClixWallStatusClassification {
  if (rawInput === undefined || rawInput === null || String(rawInput).trim() === '') {
    return {
      kind: 'invalid',
      error: 'حالة العملية مفقودة من ClixWall (status required).',
    };
  }

  const rawStatus = String(rawInput).trim();
  const lower = rawStatus.toLowerCase();

  if (lower === '1' || lower === 'approved' || lower === 'completed' || lower === 'success') {
    return { kind: 'credit', dbStatus: 'credited', rawStatus };
  }

  if (lower === '2' || lower === 'chargeback' || lower === 'reversed') {
    return { kind: 'reversal', dbStatus: 'reversed', rawStatus };
  }

  if (
    lower === '0' ||
    lower === 'rejected' ||
    lower === 'cancelled' ||
    lower === 'canceled' ||
    lower === 'failed' ||
    lower === 'pending'
  ) {
    return { kind: 'ignore', normalizedStatus: lower, rawStatus };
  }

  return {
    kind: 'invalid',
    error: `حالة العملية غير مدعومة أو غير صالحة من ClixWall (${rawStatus}).`,
  };
}

export function validateAndComputeClixWallPayout(
  data: Record<string, any>,
  kind: 'credit' | 'reversal'
): ClixWallPayoutValidation {
  const hasUserPayoutUsd =
    data.user_payout_usd !== undefined && data.user_payout_usd !== null && String(data.user_payout_usd).trim() !== '';

  const hasPublisherPayoutUsd =
    data.publisher_payout_usd !== undefined &&
    data.publisher_payout_usd !== null &&
    String(data.publisher_payout_usd).trim() !== '';

  const hasPublisherPayout =
    data.publisher_payout !== undefined &&
    data.publisher_payout !== null &&
    String(data.publisher_payout).trim() !== '';

  const userUsdRaw = hasUserPayoutUsd ? Number(data.user_payout_usd) : NaN;
  const pubRaw = hasPublisherPayoutUsd
    ? Number(data.publisher_payout_usd)
    : hasPublisherPayout
    ? Number(data.publisher_payout)
    : NaN;

  if (kind === 'reversal') {
    const userShareUsd = hasUserPayoutUsd ? userUsdRaw : 0;
    const pubCandidate = hasPublisherPayoutUsd || hasPublisherPayout ? pubRaw : 0;

    if (!Number.isFinite(userShareUsd) || userShareUsd < 0) {
      return { valid: false, error: 'قيمة user_payout_usd غير صالحة في طلب الاسترجاع.' };
    }
    if (!Number.isFinite(pubCandidate) || pubCandidate < 0) {
      return { valid: false, error: 'قيمة publisher_payout_usd غير صالحة في طلب الاسترجاع.' };
    }

    let publisherShareUsd = pubCandidate;
    if (
      userShareUsd > 0 &&
      pubCandidate > userShareUsd &&
      Math.abs(userShareUsd / pubCandidate - CLIXWALL_USER_SHARE_RATIO) <= RATIO_TOLERANCE
    ) {
      // Normalized from gross publisher_payout into 30% net publisher share
      publisherShareUsd = pubCandidate - userShareUsd;
    }

    return {
      valid: true,
      userShareUsd: round6(userShareUsd),
      publisherShareUsd: round6(publisherShareUsd),
      rewardYer: round6(userShareUsd * CLIXWALL_EXCHANGE_RATE),
    };
  }

  // Strict financial validation for 'credit'
  if (!hasUserPayoutUsd || !Number.isFinite(userUsdRaw) || userUsdRaw <= 0) {
    return {
      valid: false,
      error: 'البيانات المالية غير صالحة: يجب إرسال user_payout_usd بقيمة موجبة أكبر من صفر.',
    };
  }

  if ((!hasPublisherPayoutUsd && !hasPublisherPayout) || !Number.isFinite(pubRaw) || pubRaw <= 0) {
    return {
      valid: false,
      error: 'البيانات المالية غير صالحة: يجب إرسال حصة الناشر للتحقق من نسبة 70% / 30%.',
    };
  }

  // Case A: Caller passed 70% user_payout_usd and 30% publisher_payout_usd directly
  const combinedTotal = userUsdRaw + pubRaw;
  const netUserRatio = userUsdRaw / combinedTotal;
  const netPubRatio = pubRaw / combinedTotal;

  let userShareUsd: number;
  let publisherShareUsd: number;

  if (
    Math.abs(netUserRatio - CLIXWALL_USER_SHARE_RATIO) <= RATIO_TOLERANCE &&
    Math.abs(netPubRatio - CLIXWALL_PUBLISHER_SHARE_RATIO) <= RATIO_TOLERANCE
  ) {
    userShareUsd = round6(userUsdRaw);
    publisherShareUsd = round6(pubRaw);
  } else if (
    // Case B: ClixWall macro sent gross payout in publisher_payout (e.g. 0.001) & 70% in user_payout_usd (0.0007)
    pubRaw > userUsdRaw &&
    Math.abs(userUsdRaw / pubRaw - CLIXWALL_USER_SHARE_RATIO) <= RATIO_TOLERANCE
  ) {
    userShareUsd = round6(userUsdRaw);
    publisherShareUsd = round6(pubRaw - userUsdRaw);
  } else {
    return {
      valid: false,
      error: 'نسب توزيع الأرباح غير صالحة: يجب أن تطابق 70% للمستخدم و30% للناشر.',
    };
  }

  const rewardYer = round6(userShareUsd * CLIXWALL_EXCHANGE_RATE);
  if (!Number.isFinite(rewardYer) || rewardYer <= 0 || !Number.isFinite(publisherShareUsd) || publisherShareUsd <= 0) {
    return {
      valid: false,
      error: 'بيانات المكافأة المحسوبة غير صالحة.',
    };
  }

  return {
    valid: true,
    userShareUsd,
    publisherShareUsd,
    rewardYer,
  };
}

export function isValidClixWallApiKey(apiKey: string): boolean {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'your_api_key' || lower === 'your-clixwall-api-key' || lower === 'demo') {
    return false;
  }
  return true;
}

export interface ClixWallHandlersDeps {
  getAdminClient: () => SupabaseClient<any, any, any>;
}

export function createClixWallHandlers({ getAdminClient }: ClixWallHandlersDeps) {
  const getOfferWallUrl = async (req: AuthenticatedClixWallRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        console.warn('[CLIXWALL] Rejecting offerwall URL request: Unauthenticated user.');
        return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى حائط العروض.' });
      }

      const apiKey = (process.env.CLIXWALL_API_KEY || '').trim();
      if (!isValidClixWallApiKey(apiKey)) {
        console.error('[CLIXWALL] Configuration error: CLIXWALL_API_KEY is missing or placeholder.');
        return res.status(503).json({
          error: 'إعدادات حائط العروض غير مكتملة على الخادم (CLIXWALL_API_KEY مفقود).',
        });
      }

      let rawBaseUrl = (process.env.CLIXWALL_OFFERWALL_URL || 'https://clixwall.com/wall').trim();
      if (rawBaseUrl.includes('?')) {
        rawBaseUrl = rawBaseUrl.split('?')[0];
      }
      const baseUrl = rawBaseUrl.replace(/\/+$/, '') || 'https://clixwall.com/wall';
      const offerWallUrl = `${baseUrl}?api=${encodeURIComponent(apiKey)}&user=${encodeURIComponent(user.id)}`;

      console.log(`[CLIXWALL] Generated OfferWall URL for user: ${user.id}`);

      return res.json({ offerWallUrl, userId: user.id });
    } catch (err: any) {
      console.error('[CLIXWALL] Error generating offerwall URL:', err?.message || err);
      return res.status(500).json({ error: 'فشل في إنشاء رابط حائط العروض، يرجى المحاولة لاحقاً.' });
    }
  };

  const getRewards = async (req: AuthenticatedClixWallRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'غير مصرح.' });

      const adminClient = getAdminClient();
      const [postbacksRes, walletAccRes] = await Promise.all([
        adminClient
          .from('clixwall_postbacks')
          .select('id, transaction_id, user_id, offer_id, offer_name, status, user_payout_usd, publisher_payout_usd, exchange_rate, reward_yer, ledger_transaction_id, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        adminClient
          .from('financial_accounts')
          .select('balance_units')
          .eq('owner_user_id', user.id)
          .eq('account_type', 'wallet')
          .maybeSingle(),
      ]);

      if (postbacksRes.error) {
        if (postbacksRes.error.code === '42P01') {
          return res.json({
            rewards: [],
            summary: {
              totalUsdEarned: 0,
              totalYerCredited: 0,
              offersCount: 0,
              reversedCount: 0,
              walletBalanceYer: 0,
            },
          });
        }
        throw new Error(postbacksRes.error.message);
      }

      const rawRows = postbacksRes.data || [];

      // Group append-only rows by transaction_id so each transaction is counted at most once
      // and any transaction with a reversal event is excluded from net rewards.
      const txGroups = new Map<
        string,
        {
          creditRow: any | null;
          reversalRow: any | null;
        }
      >();

      for (const row of rawRows) {
        const tid = String(row.transaction_id || '');
        if (!tid) continue;
        if (!txGroups.has(tid)) {
          txGroups.set(tid, { creditRow: null, reversalRow: null });
        }
        const group = txGroups.get(tid)!;
        if (row.status === 'credited' && !group.creditRow) {
          group.creditRow = row;
        } else if (row.status === 'reversed' && !group.reversalRow) {
          group.reversalRow = row;
        }
      }

      let totalUsdEarned = 0;
      let totalYerCredited = 0;
      let offersCount = 0;
      let reversedCount = 0;

      const consolidatedRewards: Array<{
        id: string;
        transaction_id: string;
        offer_id: string | null;
        offer_name: string;
        user_payout_usd: number;
        reward_usd: number;
        publisher_payout_usd: number;
        exchange_rate: number;
        reward_yer: number;
        status: 'credited' | 'reversed';
        created_at: string;
      }> = [];

      for (const [tid, group] of txGroups.entries()) {
        const isReversed = Boolean(group.reversalRow);
        const primary = group.reversalRow || group.creditRow;
        if (!primary) continue;

        const baseAmountRow = group.creditRow || primary;
        const userPayoutUsd = Number(baseAmountRow.user_payout_usd ?? 0);
        const publisherPayoutUsd = Number(baseAmountRow.publisher_payout_usd ?? 0);
        const exchangeRate = Number(baseAmountRow.exchange_rate || CLIXWALL_EXCHANGE_RATE);
        const rewardYer = Number(baseAmountRow.reward_yer ?? 0);

        if (isReversed) {
          reversedCount += 1;
        } else if (group.creditRow) {
          totalUsdEarned += userPayoutUsd;
          totalYerCredited += rewardYer;
          offersCount += 1;
        }

        consolidatedRewards.push({
          id: primary.id,
          transaction_id: tid,
          offer_id: primary.offer_id || null,
          offer_name: primary.offer_name || 'عرض ClixWall',
          user_payout_usd: userPayoutUsd,
          reward_usd: userPayoutUsd,
          publisher_payout_usd: publisherPayoutUsd,
          exchange_rate: exchangeRate,
          reward_yer: rewardYer,
          status: isReversed ? 'reversed' : 'credited',
          created_at: primary.created_at,
        });
      }

      // Sort newest first
      consolidatedRewards.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const walletBalanceYer =
        walletAccRes.data && walletAccRes.data.balance_units !== undefined
          ? round6(Number(walletAccRes.data.balance_units) / 1_000_000)
          : 0;

      return res.json({
        rewards: consolidatedRewards,
        summary: {
          totalUsdEarned: round6(totalUsdEarned),
          totalYerCredited: round6(totalYerCredited),
          offersCount,
          reversedCount,
          walletBalanceYer,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'فشل جلب مكافآت ClixWall.' });
    }
  };

  const handlePostback = async (req: Request, res: Response) => {
    try {
      const data = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
      const transactionId = String(data.transaction_id || data.tid || data.trans_id || '').trim();
      const userId = String(data.user_id || data.subid || data.user || '').trim();
      const offerId = String(data.offer_id || data.oid || '').trim();
      const offerName = String(data.offer_name || data.oname || data.name || '').trim();

      // 1. Secret verification: Strictly enforce CLIXWALL_POSTBACK_SECRET using constant-time compare
      const expectedSecret = (process.env.CLIXWALL_POSTBACK_SECRET || process.env.CLIXWALL_SECRET || '').trim();
      const secretParam = String(data.secret || data.hash || data.signature || '').trim();

      if (!expectedSecret || !timingSafeSecretEquals(expectedSecret, secretParam)) {
        console.warn('[CLIXWALL_POSTBACK] Postback secret verification failed (secret mismatch or missing).');
        return res.status(403).json({ error: 'مفتاح الأمان (Secret) غير صالح أو مفقود.' });
      }

      if (!transactionId || !userId) {
        return res.status(400).json({ error: 'معاملات Postback ناقصة (transaction_id أو user_id مفقود).' });
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        return res.status(400).json({ error: 'صيغة معرّف المستخدم (user_id) غير صالحة، يجب أن تكون UUID صالحة.' });
      }

      // 2. Explicit Status Classification
      const statusClassification = classifyClixWallStatus(data.status);
      if (statusClassification.kind === 'invalid') {
        console.warn('[CLIXWALL_POSTBACK] Rejected postback: Invalid or missing status.');
        return res.status(400).json({ error: statusClassification.error });
      }

      // 3. Non-actionable statuses (0, rejected, cancelled, failed, pending):
      // NEVER grant a reward AND NEVER reverse any prior reward.
      if (statusClassification.kind === 'ignore') {
        console.log(
          `[CLIXWALL_POSTBACK] Ignored non-actionable status '${statusClassification.normalizedStatus}' for TID: ${transactionId} (User: ${userId})`
        );
        return res.status(200).json({
          result: 1,
          success: true,
          action: 'ignored',
          credited: false,
          reversed: false,
          status: statusClassification.normalizedStatus,
          transaction_id: transactionId,
        });
      }

      // 4. Validate 70/30 financial split & conversion rate before touching the ledger
      const payoutValidation = validateAndComputeClixWallPayout(data, statusClassification.kind);
      if (payoutValidation.valid === false) {
        console.warn(`[CLIXWALL_POSTBACK] Rejected invalid payout for TID ${transactionId}: ${payoutValidation.error}`);
        return res.status(400).json({ error: payoutValidation.error });
      }

      // 5. Execute atomic ledger RPC strictly via Service Role client
      const dbClient = getAdminClient();
      const sanitizedPayload = sanitizeClixWallPayload(data);

      const { data: rpcResult, error: rpcError } = await dbClient.rpc('process_clixwall_postback', {
        p_transaction_id: transactionId,
        p_user_id: userId,
        p_offer_id: offerId || null,
        p_offer_name: offerName || 'عرض ClixWall',
        p_user_payout_usd: payoutValidation.userShareUsd,
        p_publisher_payout_usd: payoutValidation.publisherShareUsd,
        p_status: statusClassification.dbStatus,
        p_raw_status: statusClassification.rawStatus,
        p_payload: sanitizedPayload,
      });

      if (rpcError) {
        console.error('[CLIXWALL_POSTBACK] RPC execution error:', rpcError.message);
        if (rpcError.message.includes('UNKNOWN_USER')) {
          return res.status(404).json({ error: 'حساب المستخدم غير موجود في النظام.' });
        }
        if (rpcError.message.includes('REVERSAL_WITHOUT_ORIGINAL_CREDIT')) {
          return res.status(400).json({ error: 'لا يمكن استرجاع معاملة لم يتم قيدها مسبقاً.' });
        }
        if (rpcError.message.includes('INVALID_PAYOUT_AMOUNT')) {
          return res.status(400).json({ error: 'قيمة المكافأة غير صالحة.' });
        }
        return res.status(500).json({ error: rpcError.message });
      }

      const isDuplicate = !!(rpcResult && typeof rpcResult === 'object' && (rpcResult as any).duplicate);

      console.log(
        `[CLIXWALL_POSTBACK] Processed TID: ${transactionId} (User: ${userId}, Status: ${statusClassification.dbStatus}, UserUSD: ${payoutValidation.userShareUsd}, PubUSD: ${payoutValidation.publisherShareUsd}, YER: ${payoutValidation.rewardYer}, Duplicate: ${isDuplicate})`
      );

      return res.status(200).json({
        result: 1,
        success: true,
        data: rpcResult,
        transaction_id: transactionId,
        status: statusClassification.dbStatus,
        user_payout_usd: payoutValidation.userShareUsd,
        publisher_payout_usd: payoutValidation.publisherShareUsd,
        reward_yer: payoutValidation.rewardYer,
        duplicate: isDuplicate,
      });
    } catch (err: any) {
      console.error('[CLIXWALL_POSTBACK] Unhandled exception:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'خطأ داخلي في معالجة Postback.' });
    }
  };

  return {
    getOfferWallUrl,
    getRewards,
    handlePostback,
  };
}
