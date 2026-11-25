import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type AuthRequest = Request & { user?: { id: string } };

const DEFAULT_PUBLIC_KEY = 'c33a7161c7e43aec50cab631c21a5112';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL_REGEX = /^\d{1,18}(?:\.\d{1,6})?$/;

const ALLOWED_TASKA_CURRENCIES = new Set([
  'TSK',
  'YT',
  'TASKA',
  'TASKA COIN',
  'YER',
  'YEMENI RIAL',
  'REAL YEMENI',
  'REAL YEMENI-ريال يمني',
  'REAL YEMENI-الريال اليمني',
  'USD',
]);

const ALLOWED_ARABIC_YER = new Set([
  'ريال يمني',
  'الريال اليمني',
  'ريال',
  'ر.ي',
  'ر.ي.',
]);

function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function readAliasedField(req: Request, keys: string[]): string {
  for (const key of keys) {
    const value = req.body && req.body[key] !== undefined ? req.body[key] : req.query[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized !== '') return normalized;
    }
  }
  return '';
}

function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (/signature|secret|token|authorization|hash|sig/i.test(k)) {
      clean[k] = '[REDACTED]';
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function isSupportedTaskaCurrency(rawCurrency: string): boolean {
  const clean = rawCurrency.replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, '-').trim();
  if (!clean) return false;
  return ALLOWED_TASKA_CURRENCIES.has(clean.toUpperCase()) || ALLOWED_ARABIC_YER.has(clean);
}

export function createTaskaOfferwallHandlers(deps: {
  getAdminClient: () => SupabaseClient;
  onPostbackError?: (info: { reason: string; transactionId?: string; userId?: string }) => Promise<void>;
}) {
  const getSecret = () => (process.env.OFFERWALL_GG_SECRET || '').trim();
  const getPublicKey = () => (process.env.OFFERWALL_GG_PUBLIC_KEY || DEFAULT_PUBLIC_KEY).trim();

  // Generates signed Offerwall.GG URL strictly on the server for authenticated Taska users
  const getOfferWallUrl = async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const secret = getSecret();
      if (!userId) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
      if (!secret) {
        return res.status(503).json({
          error: 'تكامل Offerwall.GG غير مكتمل: متغير OFFERWALL_GG_SECRET غير مضبوط على الخادم.',
        });
      }

      const publicKey = getPublicKey();
      const params: Record<string, string> = { appId: publicKey, userId };
      const canonical = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
      const signature = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

      const url = new URL(`https://offerwall.gg/wall/${publicKey}`);
      url.searchParams.set('userId', userId);
      url.searchParams.set('signature', signature);

      return res.json({ offerWallUrl: url.toString(), userId });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط Offerwall.GG.' });
    }
  };

  // Server-side Postback/Webhook receiver: verifies HMAC-SHA256 & credits Taska yt_wallets atomically
  const handlePostback = async (req: Request, res: Response) => {
    let transactionId = '';
    let userId = '';

    try {
      const secret = getSecret();
      if (!secret) {
        return res.status(503).send('CONFIGURATION_ERROR');
      }

      userId = readAliasedField(req, ['userId', 'user_id', 'subid', 'user']);
      transactionId = readAliasedField(req, ['transactionId', 'transaction_id', 'txid', 'trans_id', 'tx']);
      const amountRaw = readAliasedField(req, ['currencyAmount', 'currency_amount', 'amount', 'points', 'reward']);
      const signature = readAliasedField(req, ['signature', 'sig', 'hash']);
      const statusRaw = readAliasedField(req, ['status']).toLowerCase();
      const test = readAliasedField(req, ['test']).toLowerCase();

      // Official Offerwall.GG connectivity test ping
      if (test === '1' || test === 'true') {
        return res.status(200).send('OK');
      }

      if (!UUID_REGEX.test(userId)) {
        return res.status(400).send('INVALID_USER');
      }

      if (!transactionId || transactionId.length > 200) {
        return res.status(400).send('INVALID_TRANSACTION_ID');
      }

      // Strictly reject negative, zero, or malformed amounts
      if (!POSITIVE_DECIMAL_REGEX.test(amountRaw) || !Number.isFinite(Number(amountRaw)) || Number(amountRaw) <= 0) {
        return res.status(400).send('INVALID_AMOUNT');
      }

      // Reject non-credit statuses (no negative credits or unrecognized status values)
      if (statusRaw && !['credited', 'credit', 'completed', 'complete', 'approved', '1'].includes(statusRaw)) {
        return res.status(400).send('INVALID_STATUS');
      }

      // Verify official Offerwall.GG HMAC-SHA256 signature over `${userId}:${transactionId}:${amountRaw}`
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${userId}:${transactionId}:${amountRaw}`, 'utf8')
        .digest('hex');

      if (!safeEqualHex(expectedSignature, signature)) {
        return res.status(403).send('FORBIDDEN');
      }

      // Read currency name; default to YER only when omitted by short macro URLs
      const rawCurrencyField = readAliasedField(req, ['currencyName', 'currency_name', 'currency']);
      const currencyForRpc = rawCurrencyField ? rawCurrencyField.replace(/\s+/g, ' ').trim() : 'YER';

      if (!isSupportedTaskaCurrency(currencyForRpc)) {
        console.warn(
          `[TASKA_OFFERWALL_GG] Rejected UNSUPPORTED_CURRENCY for tx=${transactionId}: "${currencyForRpc}"`
        );
        return res.status(400).send('UNSUPPORTED_CURRENCY');
      }

      const payoutUsdRaw = readAliasedField(req, ['payoutUsd', 'payout_usd', 'payout']);
      const payoutUsd =
        POSITIVE_DECIMAL_REGEX.test(payoutUsdRaw) && Number.isFinite(Number(payoutUsdRaw))
          ? Number(payoutUsdRaw)
          : null;

      const offerId = readAliasedField(req, ['offerId', 'offer_id', 'oid']) || null;
      const offerName = readAliasedField(req, ['offerName', 'offer_name', 'name']) || null;
      const goalId = readAliasedField(req, ['goalId', 'goal_id']) || null;

      const payload = sanitizePayload({
        userId,
        transactionId,
        offerId,
        offerName,
        goalId,
        currencyAmount: amountRaw,
        currencyName: currencyForRpc,
        payoutUsd: payoutUsdRaw || null,
        status: statusRaw || 'credited',
        timestamp: readAliasedField(req, ['timestamp', 'ts']) || null,
      });

      const client = deps.getAdminClient();
      const { data, error } = await client.rpc('yt_process_offerwall_gg_postback', {
        p_external_tx_id: transactionId,
        p_user_id: userId,
        p_raw_amount: Number(amountRaw),
        p_raw_currency: currencyForRpc,
        p_payout_usd: payoutUsd,
        p_offer_id: offerId,
        p_offer_name: offerName,
        p_goal_id: goalId,
        p_payload: payload,
      });

      if (error) {
        const msg = String(error.message || '');
        if (msg.includes('WALLET_NOT_FOUND')) return res.status(404).send('WALLET_NOT_FOUND');
        if (msg.includes('WALLET_FROZEN')) return res.status(403).send('WALLET_FROZEN');
        if (msg.includes('UNSUPPORTED_CURRENCY')) return res.status(400).send('UNSUPPORTED_CURRENCY');
        if (msg.includes('INVALID_AMOUNT') || msg.includes('INVALID_REWARD_UNITS')) {
          return res.status(400).send('INVALID_AMOUNT');
        }
        if (msg.includes('INVALID_USER')) return res.status(400).send('INVALID_USER');
        if (msg.includes('INVALID_TRANSACTION_ID')) return res.status(400).send('INVALID_TRANSACTION_ID');
        if (msg.includes('PRICE_NOT_AVAILABLE') || msg.includes('MINING_ALLOCATION_EXHAUSTED')) {
          return res.status(409).send(msg.includes('PRICE_NOT_AVAILABLE') ? 'PRICE_NOT_AVAILABLE' : 'MINING_ALLOCATION_EXHAUSTED');
        }
        throw error;
      }

      if (!data?.success) {
        return res.status(500).send('PROCESSING_ERROR');
      }

      if (data.duplicate === true) {
        return res.status(200).send('OK');
      }

      return res.status(200).send('OK');
    } catch (error: any) {
      console.error('[TASKA_OFFERWALL_GG] Postback error:', error?.message || error);
      if (deps.onPostbackError) {
        try {
          await deps.onPostbackError({
            reason: error?.message || 'TASKA_OFFERWALL_POSTBACK_ERROR',
            transactionId,
            userId,
          });
        } catch {
          // Do not mask the primary error response
        }
      }
      return res.status(500).send('PROCESSING_ERROR');
    }
  };

  return { getOfferWallUrl, handlePostback };
}
