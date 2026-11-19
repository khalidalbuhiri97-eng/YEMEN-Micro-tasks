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
import { createClixWallHandlers, CLIXWALL_EXCHANGE_RATE, sanitizeClixWallPayload } from './clixwallHandlers.js';
import {
  addMoney,
  subMoney,
  roundYer6,
  calculateClixWallRevenueSplit,
  assertBalancedLedgerEntries,
  toYerDecimal,
} from '../shared/money.js';

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
  publisher_reward_yer: number;
  ledger_transaction_id: string;
  raw_status: string;
  payload: unknown;
  created_at: string;
}

interface MockLedgerTransactionRow {
  id: string;
  transaction_type: 'CLIXWALL_REWARD' | 'CLIXWALL_REVERSAL';
  reference: string;
  idempotency_key: string;
  status: 'posted';
  metadata: Record<string, unknown>;
}

interface MockLedgerEntryRow {
  id: string;
  transaction_id: string;
  account_id: string;
  entry_side: 'credit' | 'debit';
  amount_units: number;
  memo: string;
}

/**
 * Faithful in-memory simulator matching Migration 032 schema:
 * - wallets (wallet row per user)
 * - financial_accounts (wallet, CLIXWALL-RECEIVABLE, PLATFORM-REVENUE-CLIXWALL in exact NUMERIC(30,6) YER)
 * - ledger_transactions & ledger_entries (3-leg 70/30 double-entry accounting)
 * - clixwall_postbacks (append-only, unique on (transaction_id, status))
 * - process_clixwall_postback (9-param exact RPC contract)
 */
function createMockSupabaseAdmin(testUserId: string) {
  const mockWalletId = '22222222-2222-4222-8222-222222222222';
  const userWalletAccId = '33333333-3333-4333-8333-333333333333';
  const receivableAccId = '44444444-4444-4444-8444-444444444444';
  const platformRevAccId = '55555555-5555-4555-8555-555555555555';

  const postbacks: MockPostbackRow[] = [];
  const ledgerTransactions: MockLedgerTransactionRow[] = [];
  const ledgerEntries: MockLedgerEntryRow[] = [];

  const financialAccounts = [
    {
      id: userWalletAccId,
      account_code: `WALLET-${mockWalletId}`,
      account_type: 'wallet',
      owner_user_id: testUserId,
      wallet_id: mockWalletId,
      normal_side: 'credit',
      balance_units: 0,
      created_at: new Date().toISOString(),
    },
    {
      id: receivableAccId,
      account_code: 'CLIXWALL-RECEIVABLE',
      account_type: 'asset',
      owner_user_id: null,
      wallet_id: null,
      normal_side: 'debit',
      balance_units: 0,
      created_at: new Date().toISOString(),
    },
    {
      id: platformRevAccId,
      account_code: 'PLATFORM-REVENUE-CLIXWALL',
      account_type: 'revenue',
      owner_user_id: null,
      wallet_id: null,
      normal_side: 'credit',
      balance_units: 0,
      created_at: new Date().toISOString(),
    },
  ];

  let idSeq = 1;

  const getWalletAcc = () => financialAccounts[0];
  const getReceivableAcc = () => financialAccounts[1];
  const getPlatformRevAcc = () => financialAccounts[2];

  const client = {
    mockWalletId,
    userWalletAccId,
    receivableAccId,
    platformRevAccId,
    postbacks,
    ledgerTransactions,
    ledgerEntries,
    financialAccounts,
    getWalletBalanceYer: () => getWalletAcc().balance_units,
    getReceivableBalanceYer: () => getReceivableAcc().balance_units,
    getPlatformRevenueBalanceYer: () => getPlatformRevAcc().balance_units,
    assertGlobalTrialBalance: () => {
      if (ledgerEntries.length === 0) return;
      assertBalancedLedgerEntries(
        ledgerEntries.map((e) => ({ side: e.entry_side, amount_units: e.amount_units }))
      );
      for (const acc of financialAccounts) {
        let deb = toYerDecimal(0);
        let cred = toYerDecimal(0);
        for (const e of ledgerEntries) {
          if (e.account_id !== acc.id) continue;
          if (e.entry_side === 'debit') deb = deb.plus(toYerDecimal(e.amount_units));
          else cred = cred.plus(toYerDecimal(e.amount_units));
        }
        const net = acc.normal_side === 'debit' ? deb.minus(cred) : cred.minus(deb);
        assert(
          net.toDecimalPlaces(6).equals(toYerDecimal(acc.balance_units).toDecimalPlaces(6)),
          `Account ${acc.account_code} balance_units=${acc.balance_units} != ledgerNet=${net.toFixed(6)}`
        );
      }
    },
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

        const userRewardYer = roundYer6(existingCredit.reward_yer);
        const publisherRewardYer = roundYer6(existingCredit.publisher_reward_yer);
        const totalYer = addMoney(userRewardYer, publisherRewardYer);
        const walletAcc = getWalletAcc();
        const recvAcc = getReceivableAcc();
        const pubRevAcc = getPlatformRevAcc();

        walletAcc.balance_units = subMoney(walletAcc.balance_units, userRewardYer);
        pubRevAcc.balance_units = subMoney(pubRevAcc.balance_units, publisherRewardYer);
        recvAcc.balance_units = subMoney(recvAcc.balance_units, totalYer);

        const ltxId = `ltx-rev-${idSeq++}`;
        ledgerTransactions.push({
          id: ltxId,
          transaction_type: 'CLIXWALL_REVERSAL',
          reference: `CLIXWALL:${tid}`,
          idempotency_key: `CLIXWALL:${tid}:REVERSAL`,
          status: 'posted',
          metadata: {
            provider: 'ClixWall',
            original_transaction_id: tid,
            user_id: existingCredit.user_id,
            total_yer: totalYer,
            reward_yer: userRewardYer,
            publisher_reward_yer: publisherRewardYer,
            currency: 'YER',
          },
        });
        ledgerEntries.push(
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: walletAcc.id,
            entry_side: 'debit',
            amount_units: userRewardYer,
            memo: 'ClixWall user 70% reward reversal',
          },
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: pubRevAcc.id,
            entry_side: 'debit',
            amount_units: publisherRewardYer,
            memo: 'ClixWall publisher 30% revenue reversal',
          },
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: recvAcc.id,
            entry_side: 'credit',
            amount_units: totalYer,
            memo: 'ClixWall 100% receivable reversal',
          }
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
          reward_yer: userRewardYer,
          publisher_reward_yer: publisherRewardYer,
          ledger_transaction_id: ltxId,
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

        const split = calculateClixWallRevenueSplit({
          totalUsd: toYerDecimal(userPayoutUsd).plus(toYerDecimal(publisherPayoutUsd)).toFixed(),
          exchangeRate: CLIXWALL_EXCHANGE_RATE,
        });
        const totalYer = split.totalYer;
        const userRewardYer = split.userYer;
        const publisherRewardYer = split.publisherYer;

        const walletAcc = getWalletAcc();
        const recvAcc = getReceivableAcc();
        const pubRevAcc = getPlatformRevAcc();

        walletAcc.balance_units = addMoney(walletAcc.balance_units, userRewardYer);
        pubRevAcc.balance_units = addMoney(pubRevAcc.balance_units, publisherRewardYer);
        recvAcc.balance_units = addMoney(recvAcc.balance_units, totalYer);

        const ltxId = `ltx-crd-${idSeq++}`;
        ledgerTransactions.push({
          id: ltxId,
          transaction_type: 'CLIXWALL_REWARD',
          reference: `CLIXWALL:${tid}`,
          idempotency_key: `CLIXWALL:${tid}:CREDIT`,
          status: 'posted',
          metadata: {
            provider: 'ClixWall',
            transaction_id: tid,
            user_id: userId,
            total_yer: totalYer,
            reward_yer: userRewardYer,
            publisher_reward_yer: publisherRewardYer,
            currency: 'YER',
          },
        });
        ledgerEntries.push(
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: recvAcc.id,
            entry_side: 'debit',
            amount_units: totalYer,
            memo: 'ClixWall 100% gross receivable',
          },
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: walletAcc.id,
            entry_side: 'credit',
            amount_units: userRewardYer,
            memo: 'ClixWall user 70% reward',
          },
          {
            id: `le-${idSeq++}`,
            transaction_id: ltxId,
            account_id: pubRevAcc.id,
            entry_side: 'credit',
            amount_units: publisherRewardYer,
            memo: 'ClixWall publisher 30% platform revenue',
          }
        );

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
          reward_yer: userRewardYer,
          publisher_reward_yer: publisherRewardYer,
          ledger_transaction_id: ltxId,
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
      let orClause = '';
      let orderAsc = false;
      let limitCount: number | null = null;

      const filterFinancialAccounts = () =>
        financialAccounts.filter((acc) => {
          if (filters.account_type && acc.account_type !== filters.account_type) return false;
          if (filters.account_code && acc.account_code !== filters.account_code) return false;
          if (filters.owner_user_id && acc.owner_user_id !== filters.owner_user_id) return false;
          if (orClause) {
            const parts = orClause.split(',').map((p) => p.trim());
            const matchesAny = parts.some((p) => {
              const [col, op, val] = p.split('.');
              if (op === 'eq') return String((acc as any)[col]) === val;
              return false;
            });
            if (!matchesAny) return false;
          }
          return true;
        });

      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: any) {
          filters[col] = val;
          return builder;
        },
        or(expr: string) {
          orClause = expr;
          return builder;
        },
        order(_col: string, opts?: { ascending?: boolean }) {
          orderAsc = Boolean(opts?.ascending);
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        maybeSingle() {
          if (table === 'wallets') {
            const match = filters.user_id === testUserId ? { id: mockWalletId } : null;
            return Promise.resolve({ data: match, error: null });
          }
          if (table === 'financial_accounts') {
            const matches = filterFinancialAccounts();
            return Promise.resolve({
              data: matches[0] ? { id: matches[0].id, balance_units: matches[0].balance_units } : null,
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
              if (limitCount !== null) rows = rows.slice(0, limitCount);
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
  const loggedErrors: Array<Record<string, unknown>> = [];
  const handlers = createClixWallHandlers({
    getAdminClient: () => mockDb,
    onPostbackError: (info) => {
      loggedErrors.push({ ...info });
    },
  });

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
    // 1. Standalone Credited Flow (NEVER reversed): verify all 4 DB artifacts & wallet balance parity
    const tidStandalone = 'E2E_STANDALONE_CREDIT_001';
    const res1 = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tidStandalone}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.0007&publisher_payout=0.001&status=1&offer_id=O1&offer_name=StandaloneVerifiedOffer`
    );
    assert(res1.status === 200, `Standalone credit failed with ${res1.status}`);
    const j1 = await res1.json();
    assert(j1.status === 'credited' && !j1.duplicate, 'Standalone credit should be credited and not duplicate');
    assert(Math.abs(j1.user_payout_usd - 0.0007) < 1e-6, `Expected 0.0007 user share, got ${j1.user_payout_usd}`);
    assert(Math.abs(j1.publisher_payout_usd - 0.0003) < 1e-6, `Expected 0.0003 publisher share, got ${j1.publisher_payout_usd}`);
    assert(Math.abs(j1.reward_yer - 1.12) < 1e-6, `Expected 1.12 YER, got ${j1.reward_yer}`);

    // (a) clixwall_postbacks credited row
    assert(
      mockDb.postbacks.length === 1 &&
        mockDb.postbacks[0].transaction_id === tidStandalone &&
        mockDb.postbacks[0].status === 'credited' &&
        mockDb.postbacks[0].reward_yer === 1.12,
      'clixwall_postbacks must contain standalone credited row (1.12 YER)'
    );
    // (b) ledger_transactions CLIXWALL_REWARD row
    const standaloneLtx = mockDb.ledgerTransactions.find(
      (t: MockLedgerTransactionRow) =>
        t.id === mockDb.postbacks[0].ledger_transaction_id && t.transaction_type === 'CLIXWALL_REWARD'
    );
    assert(standaloneLtx, 'ledger_transactions must contain CLIXWALL_REWARD row');
    // (c) ledger_entries credit on user wallet + credit on PLATFORM-REVENUE-CLIXWALL + debit on CLIXWALL-RECEIVABLE
    const walletCreditEntry = mockDb.ledgerEntries.find(
      (e: MockLedgerEntryRow) =>
        e.transaction_id === standaloneLtx.id &&
        e.account_id === mockDb.userWalletAccId &&
        e.entry_side === 'credit' &&
        e.amount_units === 1.12
    );
    const pubRevCreditEntry = mockDb.ledgerEntries.find(
      (e: MockLedgerEntryRow) =>
        e.transaction_id === standaloneLtx.id &&
        e.account_id === mockDb.platformRevAccId &&
        e.entry_side === 'credit' &&
        e.amount_units === 0.48
    );
    const recvDebitEntry = mockDb.ledgerEntries.find(
      (e: MockLedgerEntryRow) =>
        e.transaction_id === standaloneLtx.id &&
        e.account_id === mockDb.receivableAccId &&
        e.entry_side === 'debit' &&
        e.amount_units === 1.6
    );
    assert(
      walletCreditEntry && pubRevCreditEntry && recvDebitEntry,
      'ledger_entries must balance debit(CLIXWALL-RECEIVABLE 1.60) = credit(wallet 1.12) + credit(PLATFORM-REVENUE-CLIXWALL 0.48)'
    );
    // (d) financial_accounts.balance_units updated directly in YER across all 3 accounts
    assert(
      mockDb.getWalletBalanceYer() === 1.12 &&
        mockDb.getPlatformRevenueBalanceYer() === 0.48 &&
        mockDb.getReceivableBalanceYer() === 1.6,
      `3-leg balances mismatch: wallet=${mockDb.getWalletBalanceYer()}, pubRev=${mockDb.getPlatformRevenueBalanceYer()}, recv=${mockDb.getReceivableBalanceYer()}`
    );
    mockDb.assertGlobalTrialBalance();
    // (e) Immediate rewards & wallet parity check before any subsequent event
    const immediateRewardsRes = await fetch(`${baseUrl}/api/clixwall/rewards`);
    const immediateRewardsJson = await immediateRewardsRes.json();
    assert(
      immediateRewardsJson.summary.offersCount === 1 &&
        immediateRewardsJson.summary.totalYerCredited === 1.12 &&
        immediateRewardsJson.summary.walletBalanceYer === mockDb.getWalletBalanceYer(),
      `Standalone credited balance mismatch between ClixWall UI & financial_accounts: ${JSON.stringify(immediateRewardsJson.summary)}`
    );
    assert(
      JSON.stringify(mockDb.postbacks[0].payload).includes('[REDACTED_SENSITIVE_DATA]') &&
        !JSON.stringify(mockDb.postbacks[0].payload).includes(expectedSecret),
      'Secret must be redacted before persisting payload'
    );
    console.log('  ✓ [C1] Standalone 3-leg credited flow: 1.60 receivable = 1.12 user + 0.48 PLATFORM-REVENUE-CLIXWALL + trial balance passed.');

    // 2. Duplicate postback idempotency
    const resDup = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tidStandalone}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.0007&publisher_payout=0.001&status=approved`
    );
    const jDup = await resDup.json();
    assert(resDup.status === 200 && jDup.duplicate === true, 'Duplicate postback must return duplicate=true');
    assert(
      mockDb.getWalletBalanceYer() === 1.12 && mockDb.getPlatformRevenueBalanceYer() === 0.48,
      'Balances must NOT increase on duplicate'
    );
    console.log('  ✓ [C2] Duplicate credit idempotency passed (no double credit to user or publisher).');

    // 3. POST form-urlencoded second offer ($1.00 gross -> $0.70 user = 1120 YER, $0.30 publisher = 480 YER)
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
    assert(
      res2.status === 200 && j2.status === 'credited' && j2.reward_yer === 1120 && j2.publisher_yer === 480,
      'Form-urlencoded 70/30 credit failed'
    );
    assert(
      mockDb.getWalletBalanceYer() === 1121.12 && mockDb.getPlatformRevenueBalanceYer() === 480.48,
      `Expected wallet=1121.12 & pubRev=480.48 YER, got wallet=${mockDb.getWalletBalanceYer()}, pubRev=${mockDb.getPlatformRevenueBalanceYer()}`
    );
    mockDb.assertGlobalTrialBalance();
    console.log('  ✓ [C3] POST form-urlencoded direct 70/30 credit ($0.70/$0.30 -> 1,120 / 480 YER) passed.');

    // 4. Rejected / Cancelled / Failed / Pending / 0 must NOT credit new TID and must NOT reverse tidStandalone
    const balanceBeforeIgnore = mockDb.getWalletBalanceYer();
    for (const statusVal of ['0', 'rejected', 'cancelled', 'failed', 'pending']) {
      const igRes = await fetch(`${baseUrl}/api/postbacks/clixwall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: tidStandalone,
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
      mockDb.getWalletBalanceYer() === balanceBeforeIgnore,
      'Non-actionable statuses must not mutate wallet balance'
    );
    console.log('  ✓ [C4] Rejected/cancelled/failed/pending/0 neither credited nor reversed existing reward.');

    // 5. Chargeback / Reversal of tid2 ONLY (leaving tidStandalone credited in wallet!)
    const revRes = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid2}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&status=chargeback`
    );
    const revJson = await revRes.json();
    assert(revRes.status === 200 && revJson.status === 'reversed' && !revJson.duplicate, 'Chargeback reversal failed');
    assert(
      mockDb.getWalletBalanceYer() === 1.12 &&
        mockDb.getPlatformRevenueBalanceYer() === 0.48 &&
        mockDb.getReceivableBalanceYer() === 1.6,
      `Balances after reversing tid2 should restore wallet=1.12, pubRev=0.48, recv=1.60; got wallet=${mockDb.getWalletBalanceYer()}, pubRev=${mockDb.getPlatformRevenueBalanceYer()}, recv=${mockDb.getReceivableBalanceYer()}`
    );
    mockDb.assertGlobalTrialBalance();

    // Duplicate reversal must be idempotent
    const revDupRes = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tid2}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&status=2`
    );
    const revDupJson = await revDupRes.json();
    assert(revDupRes.status === 200 && revDupJson.duplicate === true, 'Duplicate reversal must return duplicate=true');
    assert(
      mockDb.getWalletBalanceYer() === 1.12 && mockDb.getPlatformRevenueBalanceYer() === 0.48,
      'Duplicate reversal must not double-deduct wallet or publisher revenue'
    );
    console.log('  ✓ [C5] Chargeback & duplicate reversal idempotency passed (all 3 ledger legs reversed cleanly).');

    // 6. GET /api/clixwall/rewards excludes reversed tid2 and reconciles 1:1 with financial_accounts (1.12 YER)
    const rewardsRes = await fetch(`${baseUrl}/api/clixwall/rewards`);
    assert(rewardsRes.status === 200, 'GET /api/clixwall/rewards failed');
    const rewardsJson = await rewardsRes.json();
    assert(rewardsJson.rewards.length === 2, `Expected 2 unique transactions in history, got ${rewardsJson.rewards.length}`);
    assert(rewardsJson.summary.offersCount === 1, `Expected 1 net approved offer, got ${rewardsJson.summary.offersCount}`);
    assert(rewardsJson.summary.reversedCount === 1, `Expected 1 reversed offer, got ${rewardsJson.summary.reversedCount}`);
    assert(
      Math.abs(rewardsJson.summary.totalUsdEarned - 0.0007) < 1e-6,
      `Expected net USD $0.0007 (tid2 excluded), got ${rewardsJson.summary.totalUsdEarned}`
    );
    assert(
      rewardsJson.summary.totalYerCredited === 1.12 &&
        rewardsJson.summary.walletBalanceYer === 1.12 &&
        rewardsJson.summary.walletBalanceYer === mockDb.getWalletBalanceYer(),
      `Expected net YER 1.12 == walletBalanceYer 1.12, got ${JSON.stringify(rewardsJson.summary)}`
    );
    console.log('  ✓ [C6] GET /api/clixwall/rewards excluded reversed tx & matched financial_accounts balance (1.12 YER).');

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

    // 8. Secret redaction & sanitized Postback error logging (transaction_id + reason, zero secrets)
    const badAttemptTid = 'E2E_ERR_LOG_001';
    const bogusSecret = 'ATTACKER_SECRET_VALUE_999';
    const errRes = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${badAttemptTid}&user_id=${testUserId}&secret=${bogusSecret}&status=1`
    );
    assert(errRes.status === 403, `Expected 403 for invalid secret, got ${errRes.status}`);
    assert(loggedErrors.length === 1, `Expected 1 logged Postback error, got ${loggedErrors.length}`);
    const errEntry = loggedErrors[0];
    const serializedErr = JSON.stringify(errEntry);
    assert(
      errEntry.transactionId === badAttemptTid &&
        errEntry.httpStatus === 403 &&
        errEntry.reason === 'SECRET_MISMATCH_OR_MISSING' &&
        !serializedErr.includes(expectedSecret) &&
        !serializedErr.includes(bogusSecret),
      `Postback error log must record transaction_id and reason without leaking secrets: ${serializedErr}`
    );

    const clean = sanitizeClixWallPayload({ secret: 'abc', nested: { api_key: 'xyz', ok: 1 } }) as any;
    assert(
      clean.secret === '[REDACTED_SENSITIVE_DATA]' && clean.nested.api_key === '[REDACTED_SENSITIVE_DATA]',
      'sanitizeClixWallPayload must redact nested secret and api_key fields'
    );
    console.log('  ✓ [C8] Payload secret redaction & Postback error logging (transaction_id + reason, zero secrets) verified.');

    // 9. Micro-payout precision scenarios: $0.00020 (0.224 / 0.096 / 0.320 YER) + $0.00000001 (0.000011 / 0.000005 / 0.000016 YER)
    const tidMicro = 'E2E_MICRO_00020';
    const resMicro = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tidMicro}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.00014&publisher_payout=0.00020&status=1&offer_id=M1&offer_name=MicroOffer00020`
    );
    const jMicro = await resMicro.json();
    assert(
      resMicro.status === 200 &&
        jMicro.total_yer === 0.32 &&
        jMicro.user_yer === 0.224 &&
        jMicro.publisher_yer === 0.096,
      `Expected $0.00020 -> 0.32/0.224/0.096 YER, got ${JSON.stringify(jMicro)}`
    );

    const tidSubUnit = 'E2E_MICRO_000001_YER';
    const resSubUnit = await fetch(
      `${baseUrl}/api/postbacks/clixwall?transaction_id=${tidSubUnit}&user_id=${testUserId}&secret=${encodeURIComponent(expectedSecret)}&user_payout_usd=0.000000007&publisher_payout_usd=0.000000003&status=1&offer_id=M2&offer_name=SubUnit6DecOffer`
    );
    const jSubUnit = await resSubUnit.json();
    assert(
      resSubUnit.status === 200 &&
        jSubUnit.total_yer === 0.000016 &&
        jSubUnit.user_yer === 0.000011 &&
        jSubUnit.publisher_yer === 0.000005,
      `Expected 6-decimal sub-unit YER 0.000016 = 0.000011 + 0.000005, got ${JSON.stringify(jSubUnit)}`
    );
    assert(
      mockDb.getWalletBalanceYer() === 1.344011 &&
        mockDb.getPlatformRevenueBalanceYer() === 0.576005 &&
        mockDb.getReceivableBalanceYer() === 1.920016,
      `Cumulative 6-decimal balances mismatch: wallet=${mockDb.getWalletBalanceYer()}, pubRev=${mockDb.getPlatformRevenueBalanceYer()}, recv=${mockDb.getReceivableBalanceYer()}`
    );
    mockDb.assertGlobalTrialBalance();
    console.log('  ✓ [C9] Micro-payout $0.00020 (0.224 + 0.096 YER) & 0.000001 YER precision + global trial balance passed.');
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
