import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type AuthRequest = Request & { user?: { id: string } };

const PUBLIC_KEY = 'c33a7161c7e43aec50cab631c21a5112';
const SECRET_ENV = 'OFFERWALL_GG_SECRET';

function safeEqualHex(expected: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Offerwall.GG supports canonical field names and common callback aliases.
// Accept both so a placement configured with the documented short macros
// (user/amount/tx/sig) is processed exactly like the canonical form.
function readAliasedField(req: Request, keys: string[]): string {
  for (const key of keys) {
    const value = (req.body && req.body[key] !== undefined) ? req.body[key] : req.query[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized !== '') return normalized;
    }
  }
  return '';
}

function decimalAmount(value: string): boolean {
  return /^-?\d{1,18}(?:\.\d{1,6})?$/.test(value) && Number.isFinite(Number(value));
}

function cleanPayload(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  for (const key of Object.keys(copy)) {
    if (/signature|secret|token|authorization|hash/i.test(key)) copy[key] = '[REDACTED]';
  }
  return copy;
}

export function createOfferwallGgHandlers(deps: {
  getAdminClient: () => SupabaseClient;
  onRewardCredited?: (info: { userId: string; amountYer: string; offerName: string }) => Promise<void>;
  onPostbackError?: (info: { reason: string; transactionId?: string; userId?: string }) => Promise<void>;
}) {
  const getOfferWallUrl = async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const secret = process.env[SECRET_ENV] || 'offerwall_gg_production_secret_2026_yementask';
      if (!userId) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });

      const params: Record<string, string> = { appId: PUBLIC_KEY, userId };
      const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
      const signature = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
      const url = new URL(`https://offerwall.gg/wall/${PUBLIC_KEY}`);
      url.searchParams.set('userId', userId);
      url.searchParams.set('signature', signature);
      console.log(`[OFFERWALL_GG] Generated secure wall URL for user: ${userId}`);
      return res.json({ offerWallUrl: url.toString(), userId });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط Offerwall.GG.' });
    }
  };

  const getRewards = async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
      const client = deps.getAdminClient();
      const { data, error } = await client.from('offerwall_gg_postbacks')
        .select('id,transaction_id,status,offer_id,offer_name,goal_id,currency_name,currency_amount,ledger_transaction_id,created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      const rows = data || [];
      const total = rows.reduce((sum: number, row: any) =>
        sum + (row.status === 'credited' ? Number(row.currency_amount) : row.status === 'reversed' ? Number(row.currency_amount) : 0), 0);
      return res.json({
        rewards: rows,
        summary: {
          totalYerCredited: total,
          offersCount: rows.filter((row: any) => row.status === 'credited').length,
          reversedCount: rows.filter((row: any) => row.status === 'reversed').length,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'تعذر تحميل سجل Offerwall.GG.' });
    }
  };

  const handlePostback = async (req: Request, res: Response) => {
    let transactionId = '';
    let userId = '';
    try {
      const secret = process.env[SECRET_ENV];
      if (!secret) return res.status(503).send('CONFIGURATION_ERROR');

      userId = readAliasedField(req, ['userId', 'user_id', 'subid', 'user']);
      transactionId = readAliasedField(req, ['transactionId', 'transaction_id', 'txid', 'trans_id', 'tx']);
      const amount = readAliasedField(req, ['currencyAmount', 'currency_amount', 'amount', 'points', 'reward']);
      const signature = readAliasedField(req, ['signature', 'sig', 'hash']);
      const status = readAliasedField(req, ['status']).toLowerCase();
      const test = readAliasedField(req, ['test']);

      if (test === '1' || test.toLowerCase() === 'true') return res.status(200).send('OK');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return res.status(400).send('INVALID_USER');
      }
      if (!transactionId || transactionId.length > 200 || !decimalAmount(amount) ||
        !['credited', 'reversed'].includes(status)) {
        return res.status(400).send('INVALID_POSTBACK');
      }
      if ((status === 'credited' && Number(amount) <= 0) || (status === 'reversed' && Number(amount) >= 0)) {
        return res.status(400).send('INVALID_AMOUNT_SIGN');
      }

      const expected = crypto.createHmac('sha256', secret)
        .update(`${userId}:${transactionId}:${amount}`, 'utf8').digest('hex');
      if (!safeEqualHex(expected, signature)) return res.status(403).send('FORBIDDEN');

      const currencyName = readAliasedField(req, ['currencyName', 'currency_name']).toUpperCase();
      if (currencyName !== 'YER') return res.status(400).send('UNSUPPORTED_CURRENCY');

      const payoutUsdRaw = readAliasedField(req, ['payoutUsd', 'payout_usd', 'payout']);
      const payoutUsd = decimalAmount(payoutUsdRaw) ? Number(payoutUsdRaw) : null;
      const payload = cleanPayload({
        userId, transactionId, offerId: readAliasedField(req, ['offerId', 'offer_id', 'oid']),
        offerName: readAliasedField(req, ['offerName', 'offer_name', 'name']), goalId: readAliasedField(req, ['goalId', 'goal_id']),
        currencyAmount: amount, currencyName, payoutUsd: payoutUsdRaw,
        status, test, timestamp: readAliasedField(req, ['timestamp', 'ts']),
      });

      const client = deps.getAdminClient();
      const { data, error } = await client.rpc('process_offerwall_gg_postback', {
        p_transaction_id: transactionId,
        p_user_id: userId,
        p_status: status,
        p_currency_amount: amount,
        p_currency_name: currencyName,
        p_offer_id: readAliasedField(req, ['offerId', 'offer_id', 'oid']) || null,
        p_offer_name: readAliasedField(req, ['offerName', 'offer_name', 'name']) || null,
        p_goal_id: readAliasedField(req, ['goalId', 'goal_id']) || null,
        p_payout_usd: payoutUsd,
        p_payload: payload,
      });
      if (error) throw error;

      if (status === 'credited' && data?.duplicate !== true && deps.onRewardCredited) {
        try {
          await deps.onRewardCredited({
            userId,
            amountYer: String(data.amount_yer ?? amount),
            offerName: readAliasedField(req, ['offerName', 'offer_name', 'name']) || 'عرض Offerwall.GG',
          });
        } catch { /* Notification failure must not trigger a provider retry or duplicate a ledger credit. */ }
      }
      return res.status(200).send('OK');
    } catch (error: any) {
      if (deps.onPostbackError) {
        try { await deps.onPostbackError({ reason: error?.message || 'POSTBACK_ERROR', transactionId, userId }); } catch {}
      }
      return res.status(500).send('PROCESSING_ERROR');
    }
  };

  return { getOfferWallUrl, getRewards, handlePostback };
}
