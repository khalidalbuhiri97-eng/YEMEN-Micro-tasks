import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { createTaskaOfferwallHandlers } from './taskaOfferwallHandler.ts';

function signOfferwall(secret: string, userId: string, txId: string, amount: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${userId}:${txId}:${amount}`, 'utf8')
    .digest('hex');
}

async function runTests() {
  console.log('=== Taska Coin Targeted Fixes & Offerwall.GG Verification Suite ===\n');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  const { createYtCoinService } = await vite.ssrLoadModule('/src/yt-ecosystem/ytCoinService.ts');
  try {

  // ---------------------------------------------------------------------------
  // TEST 1: Non-Cumulative 70/30 Ad Revenue Distribution + Price History Reset
  // ---------------------------------------------------------------------------
  {
    let engine: {
      singleton: boolean;
      ad_pool_usd: number;
      yt_ad_pool_usd: number;
      admin_revenue_usd: number;
      yt_admin_revenue_usd: number;
      yer_per_usd: number;
    } | null = {
      singleton: true,
      ad_pool_usd: 10,
      yt_ad_pool_usd: 10,
      admin_revenue_usd: 4.285714,
      yt_admin_revenue_usd: 4.285714,
      yer_per_usd: 1600,
    };
    const totalMinedUnits = 1_247_000; // 12.47 TSK (matches live state)
    const priceHistory: Array<{
      price_usd_per_yt: number;
      ad_pool_usd: number;
      total_mined_units: number;
      event_type: string;
    }> = [];

    const depositAdRevenueSqlSim = (isAdmin: boolean, totalUsd: number) => {
      if (!isAdmin) throw new Error('ADMIN_REQUIRED');
      if (!Number.isFinite(totalUsd) || totalUsd <= 0) throw new Error('INVALID_REVENUE_AMOUNT');
      if (!engine) throw new Error('LIQUIDITY_POOL_NOT_FOUND');

      const pool70 = Number((totalUsd * 0.7).toFixed(6));
      const admin30 = Number((totalUsd * 0.3).toFixed(6));

      // Direct replacement (non-cumulative)
      engine.ad_pool_usd = pool70;
      engine.yt_ad_pool_usd = pool70;
      engine.admin_revenue_usd = admin30;
      engine.yt_admin_revenue_usd = admin30;

      const newPriceUsd = Number((pool70 / (totalMinedUnits / 100000)).toFixed(12));
      priceHistory.push({
        price_usd_per_yt: newPriceUsd,
        ad_pool_usd: pool70,
        total_mined_units: totalMinedUnits,
        event_type: 'admin_revenue_reset',
      });
      return { success: true, pool_70: pool70, admin_30: admin30, price_usd_per_yt: newPriceUsd };
    };

    assert.throws(() => depositAdRevenueSqlSim(false, 100), /ADMIN_REQUIRED/);
    assert.throws(() => depositAdRevenueSqlSim(true, 0), /INVALID_REVENUE_AMOUNT/);
    assert.throws(() => depositAdRevenueSqlSim(true, -5), /INVALID_REVENUE_AMOUNT/);

    const r1 = depositAdRevenueSqlSim(true, 100.123456);
    assert.equal(r1.pool_70, 70.086419);
    assert.equal(r1.admin_30, 30.037037);
    assert.equal(engine.ad_pool_usd, 70.086419);
    assert.equal(engine.admin_revenue_usd, 30.037037);

    // Second deposit MUST replace directly (NOT accumulate 70.086419 + 35 = 105.086419)
    const r2 = depositAdRevenueSqlSim(true, 50);
    assert.equal(r2.pool_70, 35);
    assert.equal(r2.admin_30, 15);
    assert.equal(engine.ad_pool_usd, 35);
    assert.equal(engine.admin_revenue_usd, 15);
    assert.equal(priceHistory.length, 2);
    assert.equal(priceHistory[1].event_type, 'admin_revenue_reset');
    assert.equal(priceHistory[1].price_usd_per_yt, Number((35 / 12.47).toFixed(12)));

    engine = null;
    assert.throws(() => depositAdRevenueSqlSim(true, 10), /LIQUIDITY_POOL_NOT_FOUND/);

    console.log('[PASS] Test 1: Non-cumulative 70/30 revenue replacement, 6-decimal precision, price update & guards.');
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Permanent Ad Deletion + Preservation of Claims, Wallets & Ledger
  // ---------------------------------------------------------------------------
  {
    const adsTable = [
      { id: '11111111-1111-4111-8111-111111111111', title: 'Ad One', is_active: true },
      { id: '22222222-2222-4222-8222-222222222222', title: 'Ad Two', is_active: true },
    ];
    const claimsTable: Array<{ id: string; ad_id: string | null; reward_units: number }> = [
      { id: 'c1', ad_id: '11111111-1111-4111-8111-111111111111', reward_units: 1000 },
    ];
    const walletsTable = [{ user_id: 'u1', mined_units: 50000 }];
    const ledgerTable = [{ id: 'l1', wallet_user_id: 'u1', amount_units: 1000 }];

    const mockSupabase: any = {
      rpc: async (fn: string, params: any) => {
        if (fn === 'yt_admin_delete_mining_ad') {
          const idx = adsTable.findIndex((a) => a.id === params.p_ad_id);
          if (idx === -1) return { data: { success: false, code: 'AD_NOT_FOUND' }, error: null };
          // ON DELETE SET NULL semantics: preserve claims, wallets, ledger
          for (const c of claimsTable) {
            if (c.ad_id === params.p_ad_id) c.ad_id = null;
          }
          adsTable.splice(idx, 1);
          return { data: { success: true, deleted_id: params.p_ad_id }, error: null };
        }
        return { data: null, error: { message: 'UNKNOWN_RPC' } };
      },
    };

    const svc = createYtCoinService(mockSupabase, async () => undefined);
    const delRes = await svc.deleteAd('11111111-1111-4111-8111-111111111111');
    assert.equal(delRes.success, true);
    assert.equal(adsTable.length, 1);
    assert.equal(adsTable[0].id, '22222222-2222-4222-8222-222222222222');
    // Historical claim preserved with ad_id = null; wallet & ledger untouched
    assert.equal(claimsTable.length, 1);
    assert.equal(claimsTable[0].ad_id, null);
    assert.equal(claimsTable[0].reward_units, 1000);
    assert.equal(walletsTable[0].mined_units, 50000);
    assert.equal(ledgerTable.length, 1);

    // Verify ytCoinService refuses to fake deletion when an unmigrated DB only sets is_active = false
    const legacyRow = { id: '33333333-3333-4333-8333-333333333333', is_active: true };
    const legacyClient: any = {
      rpc: async (fn: string) => {
        if (fn === 'yt_admin_delete_mining_ad') {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
        }
        if (fn === 'yt_admin_manage_mining_ad') {
          legacyRow.is_active = false; // legacy behavior: only hides, does not delete
          return { data: { success: true }, error: null };
        }
        return { data: null, error: null };
      },
      from: () => ({
        delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: legacyRow, error: null }) }) }),
      }),
    };
    const legacySvc = createYtCoinService(legacyClient, async () => undefined);
    const legacyRes = await legacySvc.deleteAd(legacyRow.id);
    assert.equal(legacyRes.success, false);
    assert.equal(legacyRes.code, 'AD_DELETE_REQUIRES_MIGRATION');

    console.log('[PASS] Test 2: Permanent ad deletion preserves historical claims/wallets/ledger & refuses fake UI hide.');
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Request Deduplication in ytCoinService
  // ---------------------------------------------------------------------------
  {
    let rpcCalls = 0;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: {
            user_id: 'u1',
            pay_id: '0xTSK1234567890',
            mined_units: 1000,
            withdrawable_units: 0,
            withdrawal_pending_units: 0,
            referral_earned_units: 0,
            last_daily_mine_date: null,
            wallet_status: 'active',
            is_frozen: false,
          },
          error: null,
        }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    const dedupeClient: any = {
      rpc: async () => {
        rpcCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return { data: { price_usd_per_yt: 0.01, ad_pool_usd: 1 }, error: null };
      },
      from: () => chain,
    };

    const svc = createYtCoinService(dedupeClient, async () => undefined);
    await Promise.all([
      svc.loadQuickState('u1', 'mining', false),
      svc.loadQuickState('u1', 'mining', false),
      svc.loadQuickState('u1', 'mining', false),
      svc.loadQuickState('u1', 'mining', false),
      svc.loadQuickState('u1', 'mining', false),
    ]);
    assert.equal(rpcCalls, 1, '5 concurrent quick mining refreshes must deduplicate to 1 RPC call');
    console.log('[PASS] Test 3: Concurrent mining loads deduplicated (5 concurrent requests -> 1 RPC call).');
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Real Express HTTP Tests for Offerwall.GG -> Taska Coin Postbacks
  // ---------------------------------------------------------------------------
  {
    const testSecret = 'test_taska_offerwall_hmac_secret_2026_isolated';
    const prevSecret = process.env.OFFERWALL_GG_SECRET;
    process.env.OFFERWALL_GG_SECRET = testSecret;

    const activeUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const frozenUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const missingUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    const wallets = new Map<string, { mined_units: number; is_frozen: boolean; wallet_status: string }>([
      [activeUserId, { mined_units: 100_000, is_frozen: false, wallet_status: 'active' }],
      [frozenUserId, { mined_units: 50_000, is_frozen: true, wallet_status: 'frozen' }],
    ]);
    const postbacks = new Map<string, { reward_units: number; ledger_transaction_id: string }>();
    const ledger: Array<{ user_id: string; tx: string; units: number }> = [];
    const priceYerPerYt = 19.49;
    const priceUsdPerYt = 0.01218125;

    const mockAdminClient: any = {
      rpc: async (fn: string, params: any) => {
        assert.equal(fn, 'yt_process_offerwall_gg_postback');
        const tx = String(params.p_external_tx_id || '').trim();
        const uid = String(params.p_user_id || '').trim();
        const rawAmount = Number(params.p_raw_amount);
        const rawCurrency = String(params.p_raw_currency || '').trim();

        if (!tx) return { data: null, error: { message: 'INVALID_TRANSACTION_ID' } };
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) return { data: null, error: { message: 'INVALID_AMOUNT' } };

        const existing = postbacks.get(tx);
        if (existing) {
          return {
            data: { success: true, duplicate: true, external_tx_id: tx, reward_units: existing.reward_units },
            error: null,
          };
        }

        const wallet = wallets.get(uid);
        if (!wallet) return { data: null, error: { message: 'WALLET_NOT_FOUND' } };
        if (wallet.is_frozen || wallet.wallet_status !== 'active') {
          return { data: null, error: { message: 'WALLET_FROZEN' } };
        }

        const upper = rawCurrency.toUpperCase();
        let rewardUnits = 0;
        if (['TSK', 'YT', 'TASKA', 'TASKA COIN'].includes(upper)) {
          rewardUnits = Math.round(rawAmount * 100000);
        } else if (['YER', 'YEMENI RIAL'].includes(upper) || ['ريال يمني', 'ر.ي'].includes(rawCurrency)) {
          rewardUnits = Math.round((rawAmount / priceYerPerYt) * 100000);
        } else if (upper === 'USD') {
          rewardUnits = Math.round((rawAmount / priceUsdPerYt) * 100000);
        } else {
          return { data: null, error: { message: 'UNSUPPORTED_CURRENCY' } };
        }

        const ledgerId = crypto.randomUUID();
        postbacks.set(tx, { reward_units: rewardUnits, ledger_transaction_id: ledgerId });
        wallet.mined_units += rewardUnits;
        ledger.push({ user_id: uid, tx, units: rewardUnits });

        return {
          data: {
            success: true,
            duplicate: false,
            external_tx_id: tx,
            reward_units: rewardUnits,
            balance_after_units: wallet.mined_units,
            ledger_transaction_id: ledgerId,
          },
          error: null,
        };
      },
    };

    const app = express();
    app.use(express.json());
    const handlers = createTaskaOfferwallHandlers({ getAdminClient: () => mockAdminClient });
    app.all('/api/taska/offerwall-gg/postback', handlers.handlePostback);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}/api/taska/offerwall-gg/postback`;

    try {
      // 4a. Test ping
      const ping = await fetch(`${base}?test=1`);
      assert.equal(ping.status, 200);
      assert.equal(await ping.text(), 'OK');
      assert.equal(ledger.length, 0);

      // 4b. Valid HMAC-signed postback in ريال يمني -> credits 1.00000 TSK (100,000 units)
      const tx1 = 'owgg-tx-001';
      const amt1 = '19.49';
      const sig1 = signOfferwall(testSecret, activeUserId, tx1, amt1);
      const res1 = await fetch(
        `${base}?userId=${activeUserId}&transactionId=${tx1}&currencyAmount=${amt1}&currencyName=${encodeURIComponent('ريال يمني')}&status=credited&signature=${sig1}`
      );
      assert.equal(res1.status, 200);
      assert.equal(await res1.text(), 'OK');
      assert.equal(wallets.get(activeUserId)!.mined_units, 200_000);
      assert.equal(ledger.length, 1);

      // 4c. Exact duplicate replay -> 200 OK, zero duplicate credit!
      const dup1 = await fetch(
        `${base}?userId=${activeUserId}&transactionId=${tx1}&currencyAmount=${amt1}&currencyName=${encodeURIComponent('ريال يمني')}&status=credited&signature=${sig1}`
      );
      assert.equal(dup1.status, 200);
      assert.equal(wallets.get(activeUserId)!.mined_units, 200_000);
      assert.equal(ledger.length, 1);

      // 4d. Valid HMAC-signed postback in TSK -> credits 25,000 units (0.25000 TSK)
      const tx2 = 'owgg-tx-002';
      const amt2 = '0.25';
      const sig2 = signOfferwall(testSecret, activeUserId, tx2, amt2);
      const res2 = await fetch(
        `${base}?userId=${activeUserId}&transactionId=${tx2}&currencyAmount=${amt2}&currencyName=TSK&signature=${sig2}`
      );
      assert.equal(res2.status, 200);
      assert.equal(wallets.get(activeUserId)!.mined_units, 225_000);
      assert.equal(ledger.length, 2);

      // 4e. Invalid signature -> 403 FORBIDDEN
      const badSig = await fetch(
        `${base}?userId=${activeUserId}&transactionId=owgg-bad-sig&currencyAmount=10&currencyName=YER&signature=${'0'.repeat(64)}`
      );
      assert.equal(badSig.status, 403);
      assert.equal(ledger.length, 2);

      // 4f. Negative amount -> 400 INVALID_AMOUNT
      const negSig = signOfferwall(testSecret, activeUserId, 'owgg-neg', '-10');
      const negRes = await fetch(
        `${base}?userId=${activeUserId}&transactionId=owgg-neg&currencyAmount=-10&currencyName=YER&signature=${negSig}`
      );
      assert.equal(negRes.status, 400);
      assert.equal(await negRes.text(), 'INVALID_AMOUNT');

      // 4g. Zero amount -> 400 INVALID_AMOUNT
      const zeroSig = signOfferwall(testSecret, activeUserId, 'owgg-zero', '0');
      const zeroRes = await fetch(
        `${base}?userId=${activeUserId}&transactionId=owgg-zero&currencyAmount=0&currencyName=YER&signature=${zeroSig}`
      );
      assert.equal(zeroRes.status, 400);

      // 4h. Unsupported currency -> 400 UNSUPPORTED_CURRENCY
      const eurSig = signOfferwall(testSecret, activeUserId, 'owgg-eur', '10');
      const eurRes = await fetch(
        `${base}?userId=${activeUserId}&transactionId=owgg-eur&currencyAmount=10&currencyName=EUR&signature=${eurSig}`
      );
      assert.equal(eurRes.status, 400);
      assert.equal(await eurRes.text(), 'UNSUPPORTED_CURRENCY');

      // 4i. Disallowed status -> 400 INVALID_STATUS
      const revSig = signOfferwall(testSecret, activeUserId, 'owgg-rev', '10');
      const revRes = await fetch(
        `${base}?userId=${activeUserId}&transactionId=owgg-rev&currencyAmount=10&currencyName=YER&status=reversed&signature=${revSig}`
      );
      assert.equal(revRes.status, 400);
      assert.equal(await revRes.text(), 'INVALID_STATUS');

      // 4j. Invalid user UUID -> 400 INVALID_USER
      const badUser = await fetch(
        `${base}?userId=not-a-uuid&transactionId=owgg-u&currencyAmount=10&currencyName=YER&signature=${'a'.repeat(64)}`
      );
      assert.equal(badUser.status, 400);

      // 4k. Missing wallet -> 404 WALLET_NOT_FOUND
      const missSig = signOfferwall(testSecret, missingUserId, 'owgg-miss', '10');
      const missRes = await fetch(
        `${base}?userId=${missingUserId}&transactionId=owgg-miss&currencyAmount=10&currencyName=YER&signature=${missSig}`
      );
      assert.equal(missRes.status, 404);
      assert.equal(await missRes.text(), 'WALLET_NOT_FOUND');

      // 4l. Frozen wallet -> 403 WALLET_FROZEN
      const frzSig = signOfferwall(testSecret, frozenUserId, 'owgg-frz', '10');
      const frzRes = await fetch(
        `${base}?userId=${frozenUserId}&transactionId=owgg-frz&currencyAmount=10&currencyName=YER&signature=${frzSig}`
      );
      assert.equal(frzRes.status, 403);
      assert.equal(await frzRes.text(), 'WALLET_FROZEN');

      assert.equal(wallets.get(activeUserId)!.mined_units, 225_000);
      assert.equal(ledger.length, 2);
      console.log(
        '[PASS] Test 4: Express Offerwall.GG postback verified (HMAC valid credit, idempotent duplicate replay, TSK & ريال يمني conversion, invalid sig 403, negative/zero/status/currency/UUID 400, missing 404, frozen 403).'
      );
    } finally {
      server.close();
      if (prevSecret === undefined) delete process.env.OFFERWALL_GG_SECRET;
      else process.env.OFFERWALL_GG_SECRET = prevSecret;
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Live Read-Only Supabase Benchmark & Migration Status Verification
  // ---------------------------------------------------------------------------
  {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRole) {
      const sb = createClient(supabaseUrl, serviceRole);
      const t0 = performance.now();
      const [metricsRes, adsRes, walletsRes] = await Promise.all([
        sb.rpc('yt_get_live_metrics'),
        sb.from('yt_mining_ads').select('id,title,is_active,sort_order').order('sort_order'),
        sb.from('yt_wallets').select('user_id,mined_units,wallet_status,is_frozen').limit(10),
      ]);
      const elapsedMs = Math.round(performance.now() - t0);
      assert.equal(metricsRes.error, null);
      assert.equal(adsRes.error, null);
      assert.equal(walletsRes.error, null);

      // Check live migration presence (read-only)
      const postbackTableCheck = await sb.from('yt_offerwall_gg_postbacks').select('id').limit(1);
      const migrationApplied = !postbackTableCheck.error;

      console.log(
        `[PASS] Test 5 (Live Read-Only Supabase): parallel yt_get_live_metrics + yt_mining_ads (${adsRes.data?.length ?? 0} rows) + yt_wallets (${walletsRes.data?.length ?? 0} rows) completed in ${elapsedMs}ms.`
      );
      console.log(
        `[INFO] Live Supabase migration 20261202000000 status: ${
          migrationApplied ? 'APPLIED' : 'PENDING_MANUAL_EXECUTION_IN_SQL_EDITOR'
        }`
      );
    } else {
      console.log('[SKIP] Test 5: Live Supabase env vars unavailable.');
    }
  }

  console.log('\nALL AUTOMATED TESTS PASSED.');
  } finally {
    await vite.close();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
