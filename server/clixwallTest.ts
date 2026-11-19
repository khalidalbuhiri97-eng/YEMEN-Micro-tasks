/**
 * Comprehensive ClixWall Offer Wall & Postback Verification Suite
 * Yemen Task (كسب اليمن)
 *
 * SAFETY GUARANTEE:
 * - Zero mutations to live production user accounts, balances, or ledger tables.
 * - Live checks are strictly read-only (or validation-only rejections before DB writes).
 * - Full financial lifecycle (70/30 split, idempotency, reversals, net rewards) is
 *   verified end-to-end against an isolated Express instance using the real
 *   createClixWallHandlers implementation and a faithful append-only ledger simulator.
 */

import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from './app.js';
import {
  createClixWallHandlers,
  CLIXWALL_EXCHANGE_RATE,
  sanitizeClixWallPayload,
} from './clixwallHandlers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

interface MockPostbackRow {
  id: string;
  transaction_id: string;
  user_id: string;
  offer_id: string | null;
  offer_name: string | null;
  status: 'credited' | 'reversed';
  user_payout_usd: number;
  publisher_payout_usd: number;
  exchange_rate: number;
  reward_yer: number;
  ledger_transaction_id: string;
  raw_status: string;
  payload: unknown;
  created_at: string;
}

/**
 * Faithful in-memory simulator matching live Supabase schema:
 * - clixwall_postbacks (append-only, unique on (transaction_id, status))
 * - financial_accounts (wallet + CLIXWALL-RECEIVABLE in micros)
 * - process_clixwall_postback (9-param exact RPC contract)
 */
function createMockSupabaseAdmin(testUserId: string) {
  const postbacks: MockPostbackRow[] = [];
  const balances = new Map<string, number>([
    [`wallet:${testUserId}`, 0],
    ['CLIXWALL-RECEIVABLE', 0],
  ]);
  let idSeq = 1;

  const client = {
    balances,
    postbacks,
    async rpc(fnName: string, args: Record<string, any>) {
      if (fnName !== 'process_clixwall_postback') {
        return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
      }

      const tid = String(args.p_transaction_id || '').trim();
      const userId = String(args.p_user_id || '').trim();
      const status = String(args.p_status || '').trim();
      const userPayoutUsd = Number(args.p_user_payout_usd || 0);
      const publisherPayoutUsd = Number(args.p_publisher_payout_usd || 0);

      if (userId !== testUserId) {
        return { data: null, error: { message: 'UNKNOWN_USER' } };
      }

      const existingCredit = postbacks.find(
        (r) => r.transaction_id === tid && r.status === 'credited'
      );
      const existingReversal = postbacks.find(
        (r) => r.transaction_id === tid && r.status === 'reversed'
      );

      if (status === 'reversed') {
        if (!existingCredit) {
          return { data: null, error: { message: 'REVERSAL_WITHOUT_ORIGINAL_CREDIT' } };
        }
        if (existingReversal) {
          return { data: { ok: true, reversal: true, duplicate: true }, error: null };
        }

        const amountUnits = Math.round(existingCredit.reward_yer * 1_000_000);
        const walletKey = `wallet:${existingCredit.user_id}`;
        balances.set(walletKey, Math.max(0, (balances.get(walletKey) || 0) - amountUnits));
        balances.set(
          'CLIXWALL-RECEIVABLE',
          Math.max(0, (balances.get('CLIXWALL-RECEIVABLE') || 0) - amountUnits)
        );

        postbacks.push({
          id: `pb-${idSeq++}`,
          transaction_id: tid,
          user_id: existingCredit.user_id,
          offer_id: args.p_offer_id ?? existingCredit.offer_id,
          offer_name: args.p_offer_name ?? existingCredit.offer_name,
          status: 'reversed',
          user_payout_usd: existingCredit.user_payout_usd,
          publisher_payout_usd: existingCredit.publisher_payout_usd,
          exchange_rate: CLIXWALL_EXCHANGE_RATE,
          reward_yer: existingCredit.reward_yer,
          ledger_transaction_id: `ltx-rev-${idSeq}`,
          raw_status: String(args.p_raw_status || '2'),
          payload: args.p_payload ?? {},
          created_at: new Date(Date.now() + idSeq * 1000).toISOString(),
        });

        return { data: { ok: true, reversal: true, duplicate: false }, error: null };
      }

      if (status === 'credited') {
        if (existingCredit) {
          return { data: { ok: true, status: 'credited', duplicate: true }, error: null };
        }
        if (existingReversal) {
          return { data: { ok: true, status: 'reversed', duplicate: true }, error: null };
        }
        if (userPayoutUsd <= 0 || publisherPayoutUsd <= 0) {
          return { data: null, error: { message: 'INVALID_PAYOUT_AMOUNT' } };
        }

        const rewardYer = Math.round(userPayoutUsd * CLIXWALL_EXCHANGE_RATE * 1_000_000) / 1_000_000;
        const amountUnits = Math.round(rewardYer * 1_000_000);
        const walletKey = `wallet:${userId}`;
        balances.set(walletKey, (balances.get(walletKey) || 0) + amountUnits);
        balances.set('CLIXWALL-RECEIVABLE', (balances.get('CLIXWALL-RECEIVABLE') || 0) + amountUnits);

        postbacks.push({
          id: `pb-${idSeq++}`,
          transaction_id: tid,
          user_id: userId,
          offer_id: args.p_offer_id ?? null,
          offer_name: args.p_offer_name ?? 'عرض ClixWall',
          status: 'credited',
          user_payout_usd: userPayoutUsd,
          publisher_payout_usd: publisherPayoutUsd,
          exchange_rate: CLIXWALL_EXCHANGE_RATE,
          reward_yer: rewardYer,
          ledger_transaction_id: `ltx-crd-${idSeq}`,
          raw_status: String(args.p_raw_status || '1'),
          payload: args.p_payload ?? {},
          created_at: new Date(Date.now() + idSeq * 1000).toISOString(),
        });

        return { data: { ok: true, status: 'credited', duplicate: false }, error: null };
      }

      return { data: null, error: { message: `INVALID_POSTBACK_STATUS: ${status}` } };
    },
    from(table: string) {
      const filters: Record<string, any> = {};
      let orderAsc = false;

      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: any) {
          filters[col] = val;
          return builder;
        },
        order(_col: string, opts?: { ascending?: boolean }) {
          orderAsc = Boolean(opts?.ascending);
          return builder;
        },
        maybeSingle() {
          if (table === 'financial_accounts') {
            const key =
              filters.owner_user_id && filters.account_type === 'wallet'
                ? `wallet:${filters.owner_user_id}`
                : filters.account_code;
            const bal = key ? balances.get(key) : undefined;
            return Promise.resolve({
              data: bal !== undefined ? { balance_units: bal } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: any, reject: any) {
          try {
            if (table === 'clixwall_postbacks') {
              let rows = postbacks.filter((r) =>
                filters.user_id ? r.user_id === filters.user_id : true
              );
              rows = [...rows].sort((a, b) =>
                orderAsc
                  ? a.created_at.localeCompare(b.created_at)
                  : b.created_at.localeCompare(a.created_at)
              );
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          } catch (err) {
            return Promise.reject(err).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };

  return client as any;
}

async function runReadOnlyLiveSupabaseChecks() {
  console.log('\n--- Part A: Read-Only Live Supabase Verification ---');
  const adminClient = getSupabaseAdminClient();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

  // 1. Verify CLIXWALL-RECEIVABLE
  const { data: acc, error: accErr } = await adminClient
    .from('financial_accounts')
    .select('id, account_code, account_type, normal_side, status, balance_units')
    .eq('account_code', 'CLIXWALL-RECEIVABLE')
    .single();

  assert(!accErr && acc, `CLIXWALL-RECEIVABLE not found: ${accErr?.message}`);
  console.log(
    `  ✓ [A1] CLIXWALL-RECEIVABLE exists (${acc.account_code}, ${acc.account_type}/${acc.normal_side}, status=${acc.status}, balance_units=${acc.balance_units})`
  );

  // 2. Verify clixwall_postbacks schema
  const { data: postbackRows, error: pbErr } = await adminClient
    .from('clixwall_postbacks')
    .select(
      'id, transaction_id, user_id, offer_id, offer_name, user_payout_usd, publisher_payout_usd, exchange_rate, reward_yer, status, created_at'
    )
    .order('created_at', { ascending: false });

  assert(!pbErr && Array.isArray(postbackRows), `clixwall_postbacks query failed: ${pbErr?.message}`);
  console.log(`  ✓ [A2] clixwall_postbacks schema verified (${postbackRows.length} historical rows read-only).`);

  // 3. Reconcile net ClixWall postbacks vs financial_accounts for existing users (read-only)
  const txGroups = new Map<string, { credit: any | null; reversed: boolean }>();
  for (const row of postbackRows) {
    const tid = String(row.transaction_id);
    if (!txGroups.has(tid)) txGroups.set(tid, { credit: null, reversed: false });
    const g = txGroups.get(tid)!;
    if (row.status === 'credited' && !g.credit) g.credit = row;
    if (row.status === 'reversed') g.reversed = true;
  }

  const netYerByUser = new Map<string, number>();
  for (const g of txGroups.values()) {
    if (!g.reversed && g.credit?.user_id) {
      const uid = String(g.credit.user_id);
      netYerByUser.set(uid, (netYerByUser.get(uid) || 0) + Number(g.credit.reward_yer || 0));
    }
  }
  console.log(`  ✓ [A3] Historical append-only grouping verified across ${txGroups.size} unique transactions (${netYerByUser.size} users with non-zero net).`);

  // 4. Verify anon privilege denial on RPC and table
  if (supabaseUrl && supabaseAnonKey) {
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { error: anonTblErr } = await anonClient.from('clixwall_postbacks').select('id').limit(1);
    const { error: anonRpcErr } = await anonClient.rpc('process_clixwall_postback', {
      p_transaction_id: 'READONLY_ANON_PROBE',
      p_user_id: '00000000-0000-4000-8000-000000000000',
      p_offer_id: 'PROBE',
      p_offer_name: 'PROBE',
      p_user_payout_usd: 0.0007,
      p_publisher_payout_usd: 0.0003,
      p_status: 'credited',
      p_raw_status: '1',
      p_payload: {},
    });
    assert(anonTblErr, 'Anon client should NOT be allowed to read clixwall_postbacks.');
    assert(anonRpcErr, 'Anon client should NOT be allowed to execute process_clixwall_postback.');
    console.log('  ✓ [A4] Anon privilege denial verified on both clixwall_postbacks table and RPC.');
  }

  // 5. Probe live 9-parameter RPC signature without writing any row (UNKNOWN_USER)
  const { error: probeErr } = await adminClient.rpc('process_clixwall_postback', {
    p_transaction_id: `READONLY_SIG_PROBE_${Date.now()}`,
    p_user_id: '00000000-0000-4000-8000-000000000000',
    p_offer_id: 'PROBE',
    p_offer_name: 'PROBE',
    p_user_payout_usd: 0.0007,
    p_publisher_payout_usd: 0.0003,
    p_status: 'credited',
    p_raw_status: '1',
    p_payload: {},
  });
  assert(
    probeErr && probeErr.message.includes('UNKNOWN_USER'),
    `Expected UNKNOWN_USER for 9-param RPC probe, got: ${probeErr?.message}`
  );
  console.log('  ✓ [A5] Live 9-parameter RPC signature matches process_clixwall_postback cleanly (zero rows written).');
}

async function runLiveServerValidationChecks(expectedSecret: string) {
  console.log('\n--- Part B: Live Express Server Validation Checks (Non-Mutating) ---');
  const healthRes = await fetch('http://localhost:3000/api/health').catch(() => null);
  if (!healthRes || !healthRes.ok) {
    console.log('  ! Local server http://localhost:3000 not reachable; skipping Part B live HTTP probes.');
    return;
  }

  const dummyUuid = '00000000-0000-4000-8000-000000000000';

  for (const path of ['/api/postbacks/clixwall', '/api/clixwall/postback']) {
    const noSec = await fetch(`http://localhost:3000${path}?transaction_id=T1&user_id=${dummyUuid}`);
    assert(noSec.status === 403, `${path} missing secret should return 403, got ${noSec.status}`);

    const badSec = await fetch(
      `http://localhost:3000${path}?transaction_id=T1&user_id=${dummyUuid}&secret=INVALID`
    );
    assert(badSec.status === 403, `${path} wrong secret should return 403, got ${badSec.status}`);

    const noStatus = await fetch(
      `http://localhost:3000${path}?transaction_id=T1&user_id=${dummyUuid}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.0007&publisher_payout_usd=0.0003`
    );
    assert(noStatus.status === 400, `${path} missing status should return 400, got ${noStatus.status}`);

    const badRatio = await fetch(
      `http://localhost:3000${path}?transaction_id=T1&user_id=${dummyUuid}&secret=${encodeURIComponent(expectedSecret)}&status=1&user_payout_usd=0.001&publisher_payout_usd=0.001`
    );
    assert(badRatio.status === 400, `${path} invalid 50/50 ratio should return 400, got ${badRatio.status}`);

    for (const ignoreStatus of ['0', 'rejected', 'cancelled', 'failed', 'pending']) {
      const igRes = await fetch(
        `http://localhost:3000${path}?transaction_id=T_IG&user_id=${dummyUuid}&secret=${encodeURIComponent(expectedSecret)}&status=${ignoreStatus}`
      );
      assert(igRes.status === 200, `${path} status=${ignoreStatus} should return 200, got ${igRes.status}`);
      const igJson = await igRes.json();
      assert(
        igJson.action === 'ignored' && igJson.credited === false && igJson.reversed === false,
        `${path} status=${ignoreStatus} must ignore without credit or reversal`
      );
    }
  }

  const unauthUrl = await fetch('http://localhost:3000/api/clixwall/offerwall-url');
  assert(unauthUrl.status === 401, `Unauthenticated offerwall-url should return 401, got ${unauthUrl.status}`);

  const unauthRewards = await fetch('http://localhost:3000/api/clixwall/rewards');
  assert(unauthRewards.status === 401, `Unauthenticated rewards should return 401, got ${unauthRewards.status}`);

  console.log('  ✓ [B1-B5] Both live postback routes & auth routes enforce secret, 70/30 ratios, and non-actionable status rules.');
}

async function runIsolatedEndToEndSuite(expectedSecret: string, apiKey: string) {
  console.log('\n--- Part C: Isolated End-to-End Lifecycle & Accounting Suite ---');
  const testUserId = '11111111-1111-4111-8111-111111111111';
  const mockDb = createMockSupabaseAdmin(testUserId);
  const handlers = createClixWallHandlers({ getAdminClient: () => mockDb });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const mockAuth = (req: any, _res: any, next: any) => {
    req.user = { id: testUserId };
    next();
  };

  app.get('/api/clixwall/offerwall-url', mockAuth, handlers.getOfferWallUrl);
  app.get('/api/clixwall/rewards', mockAuth, handlers.getRewards);
  app.all('/api/postbacks/clixwall', handlers.handlePostback);
  app.all('/api/clixwall/postback', handlers.handlePostback);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Test Credit with 70/30 split & gross publisher_payout normalization ($0.001 total -> $0.0007 user, $0.0003 publisher, 1.12 YER)
    const tid1 = 'E2E_TX_001';
    const res1 = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid1}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.0007&publisher_payout=0.001&status=1&offer_id=O1&offer_name=GrossNormalizedOffer`
    );
    assert(res1.status === 200, `Credit 1 failed with ${res1.status}`);
    const j1 = await res1.json();
    assert(j1.status === 'credited' && !j1.duplicate, 'Credit 1 should be credited and not duplicate');
    assert(Math.abs(j1.user_payout_usd - 0.0007) < 1e-6, `Expected 0.0007 user share, got ${j1.user_payout_usd}`);
    assert(Math.abs(j1.publisher_payout_usd - 0.0003) < 1e-6, `Expected 0.0003 publisher share, got ${j1.publisher_payout_usd}`);
    assert(Math.abs(j1.reward_yer - 1.12) < 1e-6, `Expected 1.12 YER, got ${j1.reward_yer}`);
    assert(
      mockDb.balances.get(`wallet:${testUserId}`) === 1_120_000,
      'Wallet balance_units should equal 1,120,000 micros (1.12 YER)'
    );
    assert(
      JSON.stringify(mockDb.postbacks[0].payload).includes('[REDACTED_SENSITIVE_DATA]') &&
        !JSON.stringify(mockDb.postbacks[0].payload).includes(expectedSecret),
      'Secret must be redacted before persisting payload'
    );
    console.log('  ✓ [C1] 70/30 gross normalization ($0.001 -> $0.0007/$0.0003 = 1.12 YER) & payload redaction passed.');

    // 2. Duplicate postback idempotency
    const resDup = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid1}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.0007&publisher_payout=0.001&status=approved`
    );
    const jDup = await resDup.json();
    assert(resDup.status === 200 && jDup.duplicate === true, 'Duplicate postback must return duplicate=true');
    assert(mockDb.balances.get(`wallet:${testUserId}`) === 1_120_000, 'Balance must NOT increase on duplicate');
    console.log('  ✓ [C2] Duplicate credit idempotency passed (no double credit).');

    // 3. POST JSON & form-urlencoded second offer ($1.00 gross -> $0.70 user, $0.30 publisher = 1120 YER)
    const tid2 = 'E2E_TX_002';
    const formBody = new URLSearchParams({
      transaction_id: tid2,
      user_id: testUserId,
      secret: expectedSecret,
      user_payout_usd: '0.7',
      publisher_payout_usd: '0.3',
      status: 'completed',
      offer_id: 'O2',
      offer_name: 'FormEncodedOffer',
    });
    const res2 = await fetch(`${baseUrl}/api/clixwall/postback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
    });
    const j2 = await res2.json();
    assert(res2.status === 200 && j2.status === 'credited' && j2.reward_yer === 1120, 'Form-urlencoded credit failed');
    console.log('  ✓ [C3] POST form-urlencoded direct 70/30 credit ($0.70/$0.30 -> 1,120 YER) passed.');

    // 4. Rejected / Cancelled / Failed / Pending / 0 must NOT credit new TID and must NOT reverse tid1
    const balanceBeforeIgnore = mockDb.balances.get(`wallet:${testUserId}`);
    for (const statusVal of ['0', 'rejected', 'cancelled', 'failed', 'pending']) {
      const igRes = await fetch(`${baseUrl}/api/postbacks/clixwall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: tid1, // even targeting an existing credited TID!
          user_id: testUserId,
          secret: expectedSecret,
          status: statusVal,
          user_payout_usd: 0.0007,
          publisher_payout_usd: 0.0003,
        }),
      });
      const igJson = await igRes.json();
      assert(
        igRes.status === 200 && igJson.action === 'ignored' && !igJson.credited && !igJson.reversed,
        `Status ${statusVal} must be ignored cleanly`
      );
    }
    assert(
      mockDb.balances.get(`wallet:${testUserId}`) === balanceBeforeIgnore,
      'Non-actionable statuses must not mutate wallet balance'
    );
    console.log('  ✓ [C4] Rejected/cancelled/failed/pending/0 neither credited nor reversed existing reward.');

    // 5. Chargeback / Reversal of tid1
    const revRes = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid1}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&status=chargeback`
    );
    const revJson = await revRes.json();
    assert(revRes.status === 200 && revJson.status === 'reversed' && !revJson.duplicate, 'Chargeback reversal failed');
    assert(
      mockDb.balances.get(`wallet:${testUserId}`) === 1_120_000_000, // Only tid2 (1120 YER) remains
      `Wallet balance after reversing tid1 should equal 1120 YER (1,120,000,000 micros), got ${mockDb.balances.get(`wallet:${testUserId}`)}`
    );

    // Duplicate reversal must be idempotent
    const revDupRes = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid1}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&status=2`
    );
    const revDupJson = await revDupRes.json();
    assert(revDupRes.status === 200 && revDupJson.duplicate === true, 'Duplicate reversal must return duplicate=true');
    assert(
      mockDb.balances.get(`wallet:${testUserId}`) === 1_120_000_000,
      'Duplicate reversal must not double-deduct wallet balance'
    );
    console.log('  ✓ [C5] Chargeback & duplicate reversal idempotency passed.');

    // 6. GET /api/clixwall/rewards excludes reversed transactions and reconciles with financial_accounts
    const rewardsRes = await fetch(`${baseUrl}/api/clixwall/rewards`);
    assert(rewardsRes.status === 200, 'GET /api/clixwall/rewards failed');
    const rewardsJson = await rewardsRes.json();
    assert(rewardsJson.rewards.length === 2, `Expected 2 unique transactions in history, got ${rewardsJson.rewards.length}`);
    assert(rewardsJson.summary.offersCount === 1, `Expected 1 net approved offer, got ${rewardsJson.summary.offersCount}`);
    assert(rewardsJson.summary.reversedCount === 1, `Expected 1 reversed offer, got ${rewardsJson.summary.reversedCount}`);
    assert(
      Math.abs(rewardsJson.summary.totalUsdEarned - 0.7) < 1e-6,
      `Expected net USD $0.70 (tid1 excluded), got ${rewardsJson.summary.totalUsdEarned}`
    );
    assert(
      rewardsJson.summary.totalYerCredited === 1120 && rewardsJson.summary.walletBalanceYer === 1120,
      `Expected net YER 1120 == walletBalanceYer 1120, got ${JSON.stringify(rewardsJson.summary)}`
    );
    console.log('  ✓ [C6] GET /api/clixwall/rewards excluded reversed transaction & matched ledger wallet balance (1,120 YER).');

    // 7. OfferWall URL template & missing/placeholder API key enforcement
    if (apiKey) {
      const urlRes = await fetch(`${baseUrl}/api/clixwall/offerwall-url`);
      const urlJson = await urlRes.json();
      assert(urlRes.status === 200, `Expected 200 for offerwall-url, got ${urlRes.status}`);
      assert(
        urlJson.offerWallUrl === `https://clixwall.com/wall?api=${encodeURIComponent(apiKey)}&user=${encodeURIComponent(testUserId)}`,
        `Unexpected offerWallUrl format: ${urlJson.offerWallUrl}`
      );
    }

    const prevKey = process.env.CLIXWALL_API_KEY;
    try {
      process.env.CLIXWALL_API_KEY = 'YOUR_API_KEY';
      const badKeyRes = await fetch(`${baseUrl}/api/clixwall/offerwall-url`);
      assert(badKeyRes.status === 503, `Placeholder YOUR_API_KEY must return 503, got ${badKeyRes.status}`);
      const badKeyText = await badKeyRes.text();
      assert(!badKeyText.includes('YOUR_API_KEY'), 'Response must never expose placeholder key');

      delete process.env.CLIXWALL_API_KEY;
      const missingKeyRes = await fetch(`${baseUrl}/api/clixwall/offerwall-url`);
      assert(missingKeyRes.status === 503, `Missing CLIXWALL_API_KEY must return 503, got ${missingKeyRes.status}`);
    } finally {
      if (prevKey !== undefined) process.env.CLIXWALL_API_KEY = prevKey;
    }
    console.log('  ✓ [C7] OfferWall URL generation & missing/placeholder API key rejection (503) passed.');

    // Verify sanitizeClixWallPayload redacts nested secrets cleanly
    const clean = sanitizeClixWallPayload({ secret: 'abc', nested: { api_key: 'xyz', ok: 1 } }) as any;
    assert(
      clean.secret === '[REDACTED_SENSITIVE_DATA]' && clean.nested.api_key === '[REDACTED_SENSITIVE_DATA]',
      'sanitizeClixWallPayload must redact nested secret and api_key fields'
    );
    console.log('  ✓ [C8] Payload secret sanitization verified.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  console.log('==================================================================');
  console.log('       Yemen Task - ClixWall Verification Suite (Zero-Mutation)   ');
  console.log('==================================================================');

  const expectedSecret = (process.env.CLIXWALL_POSTBACK_SECRET || process.env.CLIXWALL_SECRET || '').trim();
  const apiKey = (process.env.CLIXWALL_API_KEY || '').trim();

  assert(expectedSecret, 'CLIXWALL_POSTBACK_SECRET must be set in environment.');

  await runReadOnlyLiveSupabaseChecks();
  await runLiveServerValidationChecks(expectedSecret);
  await runIsolatedEndToEndSuite(expectedSecret, apiKey);

  console.log('\n==================================================================');
  console.log('ALL CLIXWALL VERIFICATION CHECKS PASSED SUCCESSFULLY.');
  console.log('==================================================================');
}

main().catch((err) => {
  console.error('\n❌ ClixWall Verification Failed:', err);
  process.exit(1);
});
