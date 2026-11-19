/**
 * Real Integration & Accounting Verification Suite for Yemen Micro-tasks (كسب اليمن)
 * 1. Read-Only Live Supabase Schema & RPC Verification (no DDL/DML mutations)
 * 2. Real Server Module Verification (buildDoubleEntryForOperation from server/supabaseDb.ts)
 * 3. Express Route Auth Protection Verification on /api/admin/finance/* and /api/withdrawals/request
 * 4. Closed-Loop Double-Entry Reconciliation & Idempotency Verification (matching Migration 011 SQL rules)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Decimal from 'decimal.js';
import {
  addMoney,
  calcWalletTransferBreakdown,
  calculateCampaignFeePolicyCosts,
  calculateClixWallRevenueSplit,
  formatYer,
  parseMoneyStrict,
  roundYer6,
} from '../shared/money.js';
import app, { supabaseServer } from './app.js';
import {
  buildDoubleEntryForOperation,
  calculateCampaignFundingCosts,
  checkCampaignBalanceSufficiency,
  buildCampaignReserveEntries,
  buildCampaignFeeRecognitionEntries,
  buildCampaignSettlementRefundEntries,
  computeReferralSummary,
  generateReferralCode,
  sanitizeAdvertiserLogoUrl,
  resolvePublicTaskAdvertiserIdentity,
  normalizeReceiptReference,
  sanitizeDepositReceiptUrl,
  buildExternalDepositApprovalEntries,
  buildInternalAccountTransferEntries,
  buildReconciliationAdjustmentEntries,
  computeFundSegregationSummary,
  withAdvertiserLock,
  MIGRATION_011_CORE_ACCOUNTS,
  supabaseDb,
  type LedgerEntryDraft,
  type OwnerFinancialOpType,
} from './supabaseDb.js';

type NormalSide = 'debit' | 'credit';

interface SimAccount {
  id: string;
  code: string;
  type: string;
  normalSide: NormalSide;
  balance: number;
}

/**
 * Mirrors live PostgreSQL post_ledger_transaction + Migration 013 normal_side & balance >= 0 rules.
 */
class LedgerConsistencyVerifier {
  accountsByCode = new Map<string, SimAccount>();
  accountsById = new Map<string, SimAccount>();
  txByIdempotencyKey = new Map<string, { id: string; type: string; entries: LedgerEntryDraft[] }>();
  txById = new Map<string, { id: string; type: string; entries: LedgerEntryDraft[] }>();
  allEntries: Array<{ txId: string; accountId: string; side: 'debit' | 'credit'; amount: number }> = [];

  constructor() {
    const defs: Array<[string, string, NormalSide]> = [
      ['PLATFORM-TREASURY', 'treasury', 'credit'],
      ['VIRTUAL-ISSUANCE-CONTROL', 'issuance_control', 'debit'],
      ['PLATFORM-CASH-VAULT', 'asset', 'debit'],
      ['PLATFORM-REVENUE-TASKS', 'revenue', 'credit'],
      ['PLATFORM-REVENUE-ADS', 'revenue', 'credit'],
      ['PLATFORM-REVENUE-SUBSCRIPTIONS', 'revenue', 'credit'],
      ['PLATFORM-REVENUE-SERVICES', 'revenue', 'credit'],
      ['PLATFORM-EXPENSES', 'expense', 'debit'],
      ['PLATFORM-EXPENSE-CLEARING', 'liability', 'credit'],
      ['PAYMENT-PROVIDER-FEES', 'expense', 'debit'],
      ['OWNER-CAPITAL', 'equity', 'credit'],
      ['OWNER-CURRENT-ACCOUNT', 'equity', 'credit'],
      ['OWNER-WITHDRAWALS', 'equity', 'debit'],
      ['RETAINED-EARNINGS', 'equity', 'credit'],
      ['TAX-PAYABLE', 'liability', 'credit'],
      ['WITHDRAWAL-RESERVED', 'liability', 'credit'],
      ['WITHDRAWAL-SETTLED', 'liability', 'credit'],
      ['TASK-ESCROW-POOL', 'escrow', 'credit'],
    ];
    for (const [code, type, normalSide] of defs) {
      this.createAccount(code, type, normalSide);
    }
  }

  createAccount(code: string, type: string, normalSide: NormalSide): SimAccount {
    const acc: SimAccount = { id: crypto.randomUUID(), code, type, normalSide, balance: 0 };
    this.accountsByCode.set(code, acc);
    this.accountsById.set(acc.id, acc);
    return acc;
  }

  accountIdsMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [code, acc] of this.accountsByCode.entries()) {
      out[code] = acc.id;
    }
    return out;
  }

  post(type: string, idempotencyKey: string, entries: LedgerEntryDraft[]): { txId: string; idempotent: boolean } {
    const existing = this.txByIdempotencyKey.get(idempotencyKey);
    if (existing) {
      return { txId: existing.id, idempotent: true };
    }

    let debits = new Decimal(0);
    let credits = new Decimal(0);
    for (const e of entries) {
      const amtDec = new Decimal(String(e.amount_units));
      assert.ok(amtDec.isFinite() && amtDec.gt(0), 'Amount must be positive > 0');
      assert.ok(amtDec.equals(amtDec.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)), 'Max 6 decimal places allowed');
      if (e.side === 'debit') debits = debits.plus(amtDec);
      else credits = credits.plus(amtDec);
    }
    assert.ok(debits.equals(credits), `Unbalanced ledger entry for ${type}: ${debits.toFixed(6)} != ${credits.toFixed(6)}`);

    // Validate non-negative balances before mutating (atomic rollback simulation)
    const pendingDeltas = new Map<string, Decimal>();
    for (const e of entries) {
      const acc = this.accountsById.get(e.account_id);
      assert.ok(acc, `Missing account ${e.account_id}`);
      const amtDec = new Decimal(String(e.amount_units));
      const delta = acc.normalSide === e.side ? amtDec : amtDec.neg();
      pendingDeltas.set(acc.id, (pendingDeltas.get(acc.id) || new Decimal(0)).plus(delta));
    }
    for (const [accId, delta] of pendingDeltas.entries()) {
      const acc = this.accountsById.get(accId)!;
      assert.ok(new Decimal(String(acc.balance)).plus(delta).gte(0), `Negative balance prevented on ${acc.code}`);
    }

    for (const [accId, delta] of pendingDeltas.entries()) {
      const acc = this.accountsById.get(accId)!;
      acc.balance = new Decimal(String(acc.balance)).plus(delta).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
    }

    const txId = crypto.randomUUID();
    const record = { id: txId, type, entries };
    this.txByIdempotencyKey.set(idempotencyKey, record);
    this.txById.set(txId, record);
    for (const e of entries) {
      this.allEntries.push({ txId, accountId: e.account_id, side: e.side, amount: roundYer6(e.amount_units) });
    }
    return { txId, idempotent: false };
  }

  reverse(txId: string, reason: string): { txId: string; idempotent: boolean } {
    const orig = this.txById.get(txId);
    assert.ok(orig, 'Original transaction not found');
    const swapped: LedgerEntryDraft[] = orig.entries.map((e) => ({
      account_id: e.account_id,
      side: e.side === 'debit' ? 'credit' : 'debit',
      amount_units: e.amount_units,
      memo: `Reversal: ${reason}`,
    }));
    return this.post(`REVERSAL_${orig.type}`, `REVERSAL:${txId}`, swapped);
  }

  bal(code: string): number {
    return roundYer6(this.accountsByCode.get(code)?.balance || 0);
  }

  assertReconciled(extraEscrowCodes: string[] = [], extraWalletCodes: string[] = [], withdrawalFeeRevenue = 0) {
    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);
    for (const e of this.allEntries) {
      if (e.side === 'debit') totalDebits = totalDebits.plus(String(e.amount));
      else totalCredits = totalCredits.plus(String(e.amount));
    }
    assert.ok(totalDebits.equals(totalCredits), `Global ledger debits (${totalDebits.toFixed(6)}) must equal credits (${totalCredits.toFixed(6)})`);

    const totalIssued = new Decimal(String(this.bal('VIRTUAL-ISSUANCE-CONTROL')));
    let supplySum = new Decimal(String(this.bal('PLATFORM-TREASURY')))
      .plus(String(this.bal('WITHDRAWAL-RESERVED')))
      .plus(String(this.bal('WITHDRAWAL-SETTLED')))
      .plus(String(this.bal('PLATFORM-REVENUE-TASKS')))
      .plus(String(withdrawalFeeRevenue));

    for (const c of extraEscrowCodes) supplySum = supplySum.plus(String(this.bal(c)));
    for (const c of extraWalletCodes) supplySum = supplySum.plus(String(this.bal(c)));

    assert.ok(
      supplySum.equals(totalIssued),
      `Closed-loop reconciliation mismatch: supply(${supplySum.toFixed(6)}) !== issued(${totalIssued.toFixed(6)})`
    );
  }
}

async function runLiveReadOnlyProbe() {
  console.log('\n[1/8] Live Supabase Read-Only Schema & RPC Probe (Zero Mutations)...');
  const rpcs = [
    ['post_ledger_transaction', { p_transaction_type: 'X', p_idempotency_key: 'X', p_reference: 'X', p_metadata: {}, p_entries: [] }],
    ['create_funded_task', { p_title: 'X', p_description: 'X', p_reward_units: 1, p_slots: 1, p_creation_key: 'X', p_deadline_at: null }],
    ['review_task_submission', { p_submission_id: '00000000-0000-0000-0000-000000000000', p_decision: 'approve', p_review_note: null }],
    ['transfer_wallet_units', { p_recipient_wallet_address: 'X', p_amount_units: 1, p_idempotency_key: 'X', p_note: null }],
    ['release_task_escrow', { p_task_id: '00000000-0000-0000-0000-000000000000', p_reason: 'X' }],
    ['reserve_withdrawal_ledger', { p_method: 'KURAIMI', p_amount_units: 1000, p_beneficiary_name: 'X', p_phone_number: '777', p_account_number: null, p_idempotency_key: 'X' }],
    ['settle_withdrawal_ledger', { p_withdrawal_id: '00000000-0000-0000-0000-000000000000', p_decision: 'PAY', p_transfer_reference: 'X', p_receipt_url: null, p_reason: null, p_provider_fee_units: 0 }],
    ['post_owner_financial_operation', { p_operation_type: 'OWNER_CAPITAL_DEPOSIT', p_amount_units: 1, p_description: 'X', p_idempotency_key: 'X', p_credit_to_treasury: true, p_metadata: {} }],
    ['reverse_ledger_transaction', { p_transaction_id: '00000000-0000-0000-0000-000000000000', p_reason: 'X' }],
  ] as const;

  const liveStatus: Record<string, string> = {};
  for (const [fn, args] of rpcs) {
    const res = await supabaseServer.rpc(fn, args as any);
    const code = res.error?.code || 'OK';
    liveStatus[fn] = code === 'PGRST202' ? 'PENDING_MIGRATION_013_014' : `LIVE_EXISTS (${code})`;
    console.log(`  - RPC ${fn}: ${liveStatus[fn]}`);
  }

  assert.ok(liveStatus.post_ledger_transaction.startsWith('LIVE_EXISTS'), 'Live DB must have post_ledger_transaction');
  assert.ok(liveStatus.create_funded_task.startsWith('LIVE_EXISTS'), 'Live DB must have create_funded_task');
  assert.ok(liveStatus.review_task_submission.startsWith('LIVE_EXISTS'), 'Live DB must have review_task_submission');
  assert.ok(liveStatus.transfer_wallet_units.startsWith('LIVE_EXISTS'), 'Live DB must have transfer_wallet_units');

  // Read-only probe for Phase 2-5 tables & RPCs (Migrations 019-022) - strictly zero mutations
  const phase25Rpcs = [
    ['create_funded_campaign', { p_title: 'X', p_description: 'X', p_category: 'app_testing', p_reward_units: 1, p_slots: 1, p_creation_key: 'X' }],
    ['start_advertiser_campaign', { p_campaign_id: '00000000-0000-0000-0000-000000000000' }],
    ['settle_advertiser_campaign', { p_campaign_id: '00000000-0000-0000-0000-000000000000', p_target_status: 'cancelled' }],
    ['create_external_account', { p_account_name: 'X', p_owner_name: 'X', p_owner_role: 'owner', p_account_type: 'bank', p_fund_scope: 'advertiser' }],
    ['approve_external_deposit', { p_deposit_id: '00000000-0000-0000-0000-000000000000' }],
    ['execute_internal_account_transfer', { p_from_external_account_id: '00000000-0000-0000-0000-000000000000', p_to_fin_account_id: '00000000-0000-0000-0000-000000000000', p_amount_units: 1, p_reason: 'X', p_idempotency_key: 'X' }],
    ['reconcile_external_account', { p_external_account_id: '00000000-0000-0000-0000-000000000000', p_actual_balance_units: 0, p_reason: 'X' }],
  ] as const;

  for (const [fn, args] of phase25Rpcs) {
    const res = await supabaseServer.rpc(fn, args as any);
    const code = res.error?.code || 'OK';
    const status = code === 'PGRST202' ? 'PENDING_MIGRATION_020_022' : `LIVE_EXISTS (${code})`;
    console.log(`  - Phase2-5 RPC ${fn}: ${status}`);
  }

  const phaseTables: Array<[string, string, string]> = [
    ['profiles', 'company_name', 'Migration 019'],
    ['campaigns', 'id, fee_percentage', 'Migration 020'],
    ['campaigns', 'hide_advertiser_name', 'Migration 021'],
    ['external_accounts', 'id', 'Migration 022'],
    ['external_deposits', 'id, reference_number_normalized', 'Migration 022'],
  ];
  for (const [tbl, cols, label] of phaseTables) {
    const res = await supabaseServer.from(tbl).select(cols, { head: true, count: 'exact' });
    const code = res.error?.code || 'OK';
    const missing = code === '42P01' || code === 'PGRST205' || code === '42703';
    console.log(`  - ${label} (${tbl}.${cols}): ${missing ? `PENDING (${code})` : `LIVE_EXISTS (${code})`}`);
  }
}

async function runHttpRouteAuthAndReferralIntegrationTests() {
  console.log('\n[2/8] Real Express API Auth Protection & Referral Route Validation...');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const protectedEndpoints: Array<[string, string]> = [
      ['GET', '/api/referrals/my'],
      ['POST', '/api/withdrawals/request'],
      ['GET', '/api/admin/treasury'],
      ['POST', '/api/admin/treasury/issue'],
      ['GET', '/api/admin/ledger'],
      ['GET', '/api/admin/financial-report'],
      ['GET', '/api/admin/financial-report/export'],
      ['GET', '/api/admin/finance/accounts'],
      ['GET', '/api/admin/finance/treasury-movements'],
      ['GET', '/api/admin/finance/reports'],
      ['GET', '/api/admin/finance/audit-logs'],
      ['GET', '/api/admin/finance/taxes'],
      ['POST', '/api/admin/finance/taxes'],
      ['PUT', '/api/admin/finance/taxes/00000000-0000-0000-0000-000000000000'],
      ['POST', '/api/admin/finance/taxes/accrue'],
      ['POST', '/api/admin/finance/taxes/settle'],
      ['POST', '/api/admin/finance/capital'],
      ['POST', '/api/admin/finance/expense'],
      ['POST', '/api/admin/finance/owner-withdrawal'],
      ['POST', '/api/admin/finance/revenue'],
      ['POST', '/api/admin/finance/reverse'],
      ['POST', '/api/admin/tasks/00000000-0000-0000-0000-000000000000/release-escrow'],
      ['POST', '/api/admin/withdrawals/00000000-0000-0000-0000-000000000000/review'],
      ['GET', '/api/advertiser/campaigns'],
      ['POST', '/api/advertiser/campaigns'],
      ['POST', '/api/advertiser/campaigns/00000000-0000-0000-0000-000000000000/start'],
      ['POST', '/api/advertiser/campaigns/00000000-0000-0000-0000-000000000000/settle'],
      ['GET', '/api/admin/campaigns'],
      ['POST', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/start'],
      ['POST', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/settle'],
      ['GET', '/api/admin/finance/external-accounts'],
      ['POST', '/api/admin/finance/external-accounts'],
      ['POST', '/api/admin/finance/external-deposits/receipt-signed-url'],
      ['POST', '/api/admin/finance/external-deposits'],
      ['POST', '/api/admin/finance/external-deposits/00000000-0000-0000-0000-000000000000/approve'],
      ['POST', '/api/admin/finance/external-deposits/00000000-0000-0000-0000-000000000000/reject'],
      ['POST', '/api/admin/finance/external-transfers'],
      ['POST', '/api/admin/finance/external-accounts/00000000-0000-0000-0000-000000000000/reconcile'],
    ];

    for (const [method, routePath] of protectedEndpoints) {
      const resp = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' || method === 'PUT' ? JSON.stringify({}) : undefined,
      });
      assert.strictEqual(resp.status, 401, `Unauthenticated ${method} ${routePath} must return 401, got ${resp.status}`);
    }

    // Scenario 2 & 3 on real Express registration validation: nonexistent / malformed referralCode rejected cleanly with 400
    const badCodeResp = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'مستخدم اختبار الإحالة',
        phone: '779998877',
        password: 'password123',
        city: 'صنعاء',
        referralCode: 'NONEXISTENT-CODE-9999',
      }),
    });
    assert.strictEqual(badCodeResp.status, 400, `Nonexistent referralCode must return 400, got ${badCodeResp.status}`);
    const badCodeJson = await badCodeResp.json();
    assert.ok(String(badCodeJson.error || '').includes('كود الإحالة'), 'Must explain invalid referral code');

    const shortCodeResp = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'مستخدم اختبار قصير',
        phone: '779998878',
        password: 'password123',
        city: 'عدن',
        referralCode: 'AB',
      }),
    });
    assert.strictEqual(shortCodeResp.status, 400, 'Too-short referralCode must return 400');

    // Settings referralBonus fallback must strictly be 30 (never hardcoded 300)
    const settingsResp = await fetch(`${baseUrl}/api/settings`);
    assert.strictEqual(settingsResp.status, 200);
    const settingsJson = await settingsResp.json();
    const apiBonus = Number(settingsJson.settings?.referralBonus ?? settingsJson.referralBonus);
    assert.strictEqual(apiBonus, 30, `referralBonus must stay 30, got ${apiBonus}`);

    // Auth refresh endpoint rejects missing refreshToken with 401
    const refreshResp = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(refreshResp.status, 401, 'Missing refreshToken must return 401');

    console.log(`  - Verified 401 protection on ${protectedEndpoints.length} routes, /api/auth/refresh 401 guard, 400 rejection on invalid referral codes & referralBonus=30.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function runServerBuilderTests() {
  console.log('\n[3/8] Real Server Double-Entry Builder Verification (buildDoubleEntryForOperation)...');
  assert.strictEqual(MIGRATION_011_CORE_ACCOUNTS.length, 18);

  const verifier = new LedgerConsistencyVerifier();
  const ids = verifier.accountIdsMap();
  const ops: OwnerFinancialOpType[] = [
    'OWNER_CAPITAL_DEPOSIT',
    'AD_REVENUE',
    'SUBSCRIPTION_REVENUE',
    'SERVICE_REVENUE',
    'OPERATIONAL_EXPENSE',
    'OWNER_WITHDRAWAL',
  ];

  for (const op of ops) {
    const entries = buildDoubleEntryForOperation({
      operationType: op,
      amountUnits: 50000,
      description: `Test ${op}`,
      accountIds: ids,
    });
    const d = entries.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amount_units, 0);
    const c = entries.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amount_units, 0);
    assert.strictEqual(d, c, `${op} entries must balance`);
    assert.ok(d > 0);
  }

  assert.throws(() =>
    buildDoubleEntryForOperation({ operationType: 'OWNER_CAPITAL_DEPOSIT', amountUnits: 0, description: 'Bad', accountIds: ids })
  );
  assert.throws(() =>
    buildDoubleEntryForOperation({ operationType: 'OWNER_CAPITAL_DEPOSIT', amountUnits: 1000, description: 'Missing', accountIds: {} })
  );
  console.log('  - All 6 server double-entry builders validated with strict debit=credit & error checks.');
}

function runEndToEndAccountingFlowTests() {
  console.log('\n[4/8] End-to-End Operational Accounting & Idempotency Flow Verification...');
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  const taskEscrow = v.createAccount('TASK-ESCROW-T1', 'escrow', 'credit');
  const userWallet = v.createAccount('WALLET-U1', 'wallet', 'credit');

  // 1. Owner capital deposit (500,000)
  v.post(
    'OWNER_CAPITAL_DEPOSIT',
    'CAP-1',
    buildDoubleEntryForOperation({
      operationType: 'OWNER_CAPITAL_DEPOSIT',
      amountUnits: 500000,
      description: 'رأس مال تشغيلي أولي',
      accountIds: ids,
    })
  );
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 500000);
  assert.strictEqual(v.bal('OWNER-CAPITAL'), 500000);
  v.assertReconciled([taskEscrow.code], [userWallet.code]);

  // 2. Task funding (100,000 into TASK-ESCROW-T1)
  v.post('task_budget_reservation', 'TASK-FUNDING:T1', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 100000, memo: 'Fund Task T1' },
    { account_id: taskEscrow.id, side: 'credit', amount_units: 100000, memo: 'Fund Task T1' },
  ]);
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 400000);
  assert.strictEqual(v.bal('TASK-ESCROW-T1'), 100000);

  // 3. Task submission approval: 20,000 reward + 2,000 platform commission
  v.post('TASK_REWARD_PAYOUT', 'TASK_REWARD_PAYOUT:S1', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 20000, memo: 'Reward S1' },
    { account_id: userWallet.id, side: 'credit', amount_units: 20000, memo: 'Reward S1' },
  ]);
  v.post('TASK_COMMISSION_REVENUE', 'TASK-COMMISSION:S1', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 2000, memo: 'Commission S1' },
    { account_id: ids['PLATFORM-REVENUE-TASKS'], side: 'credit', amount_units: 2000, memo: 'Commission S1' },
  ]);
  assert.strictEqual(v.bal('WALLET-U1'), 20000);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 2000);
  assert.strictEqual(v.bal('TASK-ESCROW-T1'), 78000);

  // 4. Task cancellation -> release remaining 78,000 back to PLATFORM-TREASURY
  v.post('TASK_BUDGET_REFUND', 'TASK-ESCROW-RELEASE:T1', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 78000, memo: 'Release remaining T1' },
    { account_id: ids['PLATFORM-TREASURY'], side: 'credit', amount_units: 78000, memo: 'Release remaining T1' },
  ]);
  assert.strictEqual(v.bal('TASK-ESCROW-T1'), 0);
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 478000);
  v.assertReconciled([taskEscrow.code], [userWallet.code]);

  // 5. Withdrawal request #1 (10,000; fee 150, net 9,850) -> Paid
  v.post('WITHDRAWAL_REQUEST', 'WITHDRAWAL-RESERVE:W1', [
    { account_id: userWallet.id, side: 'debit', amount_units: 10000, memo: 'Reserve W1' },
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'credit', amount_units: 10000, memo: 'Reserve W1' },
  ]);
  v.post('WITHDRAWAL_PAYOUT', 'WITHDRAWAL-PAY:W1', [
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'debit', amount_units: 10000, memo: 'Settle W1' },
    { account_id: ids['WITHDRAWAL-SETTLED'], side: 'credit', amount_units: 9850, memo: 'Paid W1' },
    { account_id: ids['PLATFORM-REVENUE-SERVICES'], side: 'credit', amount_units: 150, memo: 'Fee W1' },
  ]);
  assert.strictEqual(v.bal('WITHDRAWAL-RESERVED'), 0);
  assert.strictEqual(v.bal('WITHDRAWAL-SETTLED'), 9850);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-SERVICES'), 150);
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  // 6. Withdrawal request #2 (5,000) -> Rejected & Refunded
  v.post('WITHDRAWAL_REQUEST', 'WITHDRAWAL-RESERVE:W2', [
    { account_id: userWallet.id, side: 'debit', amount_units: 5000, memo: 'Reserve W2' },
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'credit', amount_units: 5000, memo: 'Reserve W2' },
  ]);
  v.post('WITHDRAWAL_REFUND', 'WITHDRAWAL-REFUND:W2', [
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'debit', amount_units: 5000, memo: 'Refund W2' },
    { account_id: userWallet.id, side: 'credit', amount_units: 5000, memo: 'Refund W2' },
  ]);
  assert.strictEqual(v.bal('WALLET-U1'), 10000);
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  // 7. Ad revenue, Operational Expense, Owner Withdrawal & Reversal
  const adRes = v.post(
    'AD_REVENUE',
    'AD-1',
    buildDoubleEntryForOperation({ operationType: 'AD_REVENUE', amountUnits: 30000, description: 'إعلان شركة', accountIds: ids })
  );
  v.post(
    'OPERATIONAL_EXPENSE',
    'EXP-1',
    buildDoubleEntryForOperation({ operationType: 'OPERATIONAL_EXPENSE', amountUnits: 12000, description: 'خوادم', accountIds: ids })
  );
  v.post(
    'OWNER_WITHDRAWAL',
    'OWN-WD-1',
    buildDoubleEntryForOperation({ operationType: 'OWNER_WITHDRAWAL', amountUnits: 25000, description: 'سحب مالك', accountIds: ids })
  );
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  v.reverse(adRes.txId, 'إلغاء فاتورة إعلان');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0);
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  // 8. Explicit Tax Accrual & Tax Settlement
  v.post('TAX_ACCRUAL', 'TAX-ACCRUAL:T1', [
    { account_id: ids['PLATFORM-EXPENSES'], side: 'debit', amount_units: 1000, memo: 'استحقاق ضريبي صريح' },
    { account_id: ids['TAX-PAYABLE'], side: 'credit', amount_units: 1000, memo: 'ذمة ضرائب مستحقة' },
  ]);
  assert.strictEqual(v.bal('TAX-PAYABLE'), 1000);
  v.post('TAX_SETTLEMENT', 'TAX-SETTLE:T1', [
    { account_id: ids['TAX-PAYABLE'], side: 'debit', amount_units: 1000, memo: 'سداد التزام ضريبي' },
    { account_id: ids['PLATFORM-CASH-VAULT'], side: 'credit', amount_units: 1000, memo: 'صرف نقدي للضريبة من الخزينة' },
  ]);
  assert.strictEqual(v.bal('TAX-PAYABLE'), 0);
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  const dup = v.post('TASK_COMMISSION_REVENUE', 'TASK-COMMISSION:S1', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 2000, memo: 'Dup' },
    { account_id: ids['PLATFORM-REVENUE-TASKS'], side: 'credit', amount_units: 2000, memo: 'Dup' },
  ]);
  assert.strictEqual(dup.idempotent, true);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 2000);

  console.log('  - Full closed-loop reconciliation, reversals, tax accrual/settlement & idempotency passed.');
}

function runAtomicitySegregationAndCommissionTests() {
  console.log('\n[5/8] Atomicity, Zero-Partial-Deduction, Zero-Commission & Fund Segregation...');
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  const escrow = v.createAccount('TASK-ESCROW-T2', 'escrow', 'credit');
  const wallet = v.createAccount('WALLET-U2', 'wallet', 'credit');

  v.post(
    'OWNER_CAPITAL_DEPOSIT',
    'CAP-ATOM-1',
    buildDoubleEntryForOperation({
      operationType: 'OWNER_CAPITAL_DEPOSIT',
      amountUnits: 200000,
      description: 'رأس مال اختبار الذرية',
      accountIds: ids,
    })
  );
  v.post('task_budget_reservation', 'TASK-FUND-ATOM:T2', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 50000, memo: 'Fund T2' },
    { account_id: escrow.id, side: 'credit', amount_units: 50000, memo: 'Fund T2' },
  ]);

  const approveTaskAtomic = (rewardUnits: number, commissionUnits: number, revenueAccountId: string | undefined, key: string) => {
    if (commissionUnits > 0 && !revenueAccountId) {
      throw new Error('PLATFORM-REVENUE-TASKS missing — aborting without partial debit');
    }
    if (v.bal('TASK-ESCROW-T2') < rewardUnits + commissionUnits) {
      throw new Error('Insufficient escrow for reward + commission — aborting without partial debit');
    }
    const entries: LedgerEntryDraft[] = [
      { account_id: escrow.id, side: 'debit', amount_units: rewardUnits, memo: 'Reward' },
      { account_id: wallet.id, side: 'credit', amount_units: rewardUnits, memo: 'Reward' },
    ];
    if (commissionUnits > 0 && revenueAccountId) {
      entries.push(
        { account_id: escrow.id, side: 'debit', amount_units: commissionUnits, memo: 'Commission' },
        { account_id: revenueAccountId, side: 'credit', amount_units: commissionUnits, memo: 'Commission' }
      );
    }
    return v.post('TASK_REWARD_PAYOUT', key, entries);
  };

  // Scenario 8: Task approval with commission_units = 0 -> NEVER invents commission
  approveTaskAtomic(10000, 0, ids['PLATFORM-REVENUE-TASKS'], 'OK-APPROVE-NO-COMM');
  assert.strictEqual(v.bal('TASK-ESCROW-T2'), 40000);
  assert.strictEqual(v.bal('WALLET-U2'), 10000);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 0, 'Commission=0 must NOT invent platform commission');

  // Scenario 10a: Insufficient escrow balance -> zero partial deduction
  assert.throws(() => approveTaskAtomic(35000, 10000, ids['PLATFORM-REVENUE-TASKS'], 'FAIL-SHORT-ESCROW'));
  assert.strictEqual(v.bal('TASK-ESCROW-T2'), 40000, 'Escrow must remain untouched on insufficient balance');
  assert.strictEqual(v.bal('WALLET-U2'), 10000, 'Wallet must remain untouched when approval aborts');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 0, 'Revenue must remain 0');

  // Scenario 9: Task approval with commission_units > 0 -> atomic reward + commission
  approveTaskAtomic(20000, 2000, ids['PLATFORM-REVENUE-TASKS'], 'OK-APPROVE-WITH-COMM');
  assert.strictEqual(v.bal('TASK-ESCROW-T2'), 18000);
  assert.strictEqual(v.bal('WALLET-U2'), 30000);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 2000);

  // Fund segregation check
  assert.strictEqual(v.bal('PLATFORM-CASH-VAULT'), 200000, 'User rewards must not inflate cash vault');
  v.assertReconciled([escrow.code], [wallet.code], 0);
  console.log('  - Zero-commission, atomic reward+commission, zero-partial-deduction & fund segregation verified.');
}

function runReferralLifecycleTests() {
  console.log('\n[6/8] Referral Lifecycle & Atomic Ledger Reward Verification (10 Scenarios)...');

  const REFERRAL_BONUS = 30;
  const referrerId = crypto.randomUUID();
  const referredId = crypto.randomUUID();
  const pendingUserId = crypto.randomUUID();
  const insufficientTreasuryUserId = crypto.randomUUID();

  // Referral code deterministic generation check
  const refCode = generateReferralCode(referrerId);
  assert.ok(/^KY-[A-F0-9]{8}$/.test(refCode), `Generated referral code must match KY-XXXXXXXX format, got ${refCode}`);

  // Simulate DB + Ledger state matching Migration 014 rules
  interface SimProfile { id: string; full_name: string; referred_by: string | null; referral_code: string; created_at: string; }
  interface SimSub { id: string; user_id: string; task_id: string; status: string; reward_transaction_id: string | null; }
  interface SimReferralReward {
    id: string; referrer_id: string; referred_user_id: string; trigger_submission_id: string;
    reward_amount: number; status: 'pending' | 'approved' | 'paid' | 'rejected';
    ledger_transaction_id: string | null; paid_at: string | null; failure_reason?: string;
  }

  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  const referrerWallet = v.createAccount(`WALLET-${referrerId}`, 'wallet', 'credit');
  const referredWallet = v.createAccount(`WALLET-${referredId}`, 'wallet', 'credit');
  const taskEscrow = v.createAccount('TASK-ESCROW-REF', 'escrow', 'credit');

  // Seed treasury = 1,000 + escrow = 500
  v.post('OWNER_CAPITAL_DEPOSIT', 'REF-CAP', buildDoubleEntryForOperation({
    operationType: 'OWNER_CAPITAL_DEPOSIT', amountUnits: 1500, description: 'تمويل اختبار الإحالة', accountIds: ids,
  }));
  v.post('task_budget_reservation', 'REF-ESCROW', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 500, memo: 'Fund task' },
    { account_id: taskEscrow.id, side: 'credit', amount_units: 500, memo: 'Fund task' },
  ]);

  const profiles = new Map<string, SimProfile>([
    [referrerId, { id: referrerId, full_name: 'المُحيل', referred_by: null, referral_code: refCode, created_at: '2026-01-01T00:00:00Z' }],
  ]);
  const submissions: SimSub[] = [];
  const rewardsByReferredUser = new Map<string, SimReferralReward>();

  function registerWithReferral(newId: string, fullName: string, inputCode?: string): SimProfile {
    let referredBy: string | null = null;
    if (inputCode) {
      const match = Array.from(profiles.values()).find((p) => p.referral_code.toUpperCase() === inputCode.trim().toUpperCase());
      if (!match) throw new Error('كود الإحالة غير موجود');
      if (match.id === newId) throw new Error('لا يمكنك إحالة نفسك');
      referredBy = match.id;
    }
    const prof: SimProfile = {
      id: newId,
      full_name: fullName,
      referred_by: referredBy,
      referral_code: generateReferralCode(newId),
      created_at: new Date().toISOString(),
    };
    profiles.set(newId, prof);
    return prof;
  }

  function processReferralRewardOnApproval(sub: SimSub): SimReferralReward | null {
    if (sub.status !== 'approved' || !sub.reward_transaction_id) return null;
    const u = profiles.get(sub.user_id);
    if (!u || !u.referred_by || u.referred_by === u.id) return null;
    if (rewardsByReferredUser.has(u.id)) return rewardsByReferredUser.get(u.id)!; // UNIQUE(referred_user_id)

    const approvedCount = submissions.filter((s) => s.user_id === u.id && s.status === 'approved' && s.reward_transaction_id).length;
    if (approvedCount !== 1) return null; // ONLY first real approved task!

    if (v.bal('PLATFORM-TREASURY') < REFERRAL_BONUS) {
      const pendingRw: SimReferralReward = {
        id: crypto.randomUUID(),
        referrer_id: u.referred_by,
        referred_user_id: u.id,
        trigger_submission_id: sub.id,
        reward_amount: REFERRAL_BONUS,
        status: 'pending',
        ledger_transaction_id: null,
        paid_at: null,
        failure_reason: 'insufficient_treasury_balance',
      };
      rewardsByReferredUser.set(u.id, pendingRw);
      return pendingRw;
    }

    const res = v.post('REFERRAL_REWARD', `REFERRAL-REWARD:${u.id}`, [
      { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: REFERRAL_BONUS, memo: 'صرف مكافأة إحالة' },
      { account_id: referrerWallet.id, side: 'credit', amount_units: REFERRAL_BONUS, memo: 'مكافأة أول مهمة للمدعو' },
    ]);
    const paidRw: SimReferralReward = {
      id: crypto.randomUUID(),
      referrer_id: u.referred_by,
      referred_user_id: u.id,
      trigger_submission_id: sub.id,
      reward_amount: REFERRAL_BONUS,
      status: 'paid',
      ledger_transaction_id: res.txId,
      paid_at: new Date().toISOString(),
    };
    rewardsByReferredUser.set(u.id, paidRw);
    return paidRw;
  }

  // Scenario 1: Valid referral signup -> referred_by stored, ZERO reward created/paid
  const regOk = registerWithReferral(referredId, 'صديق مدعو', refCode);
  assert.strictEqual(regOk.referred_by, referrerId);
  assert.strictEqual(v.bal(referrerWallet.code), 0, 'Signup alone must credit 0 to referrer');
  assert.strictEqual(rewardsByReferredUser.size, 0, 'Signup alone must create 0 referral_rewards');

  // Scenario 2 & 3: Nonexistent code and Self-referral rejected
  assert.throws(() => registerWithReferral(crypto.randomUUID(), 'خطأ', 'INVALID-999'));
  assert.throws(() => registerWithReferral(referrerId, 'إحالة نفس', refCode));

  // Scenario 4: Pending submission (no approval) -> awaiting_first_task, 0 earned
  const pendingSub: SimSub = { id: crypto.randomUUID(), user_id: referredId, task_id: 'T-REF', status: 'pending', reward_transaction_id: null };
  submissions.push(pendingSub);
  const summaryBeforeApproval = computeReferralSummary({
    ownReferralCode: refCode,
    referralBonus: REFERRAL_BONUS,
    referredProfiles: [regOk],
    approvedSubmissions: submissions,
    referralRewards: Array.from(rewardsByReferredUser.values()),
  });
  assert.strictEqual(summaryBeforeApproval.totalReferred, 1);
  assert.strictEqual(summaryBeforeApproval.qualifiedReferralsCount, 0);
  assert.strictEqual(summaryBeforeApproval.paidRewardsCount, 0);
  assert.strictEqual(summaryBeforeApproval.totalEarnedYer, 0);
  assert.strictEqual(summaryBeforeApproval.referredUsers[0].rewardStatus, 'awaiting_first_task');

  // Scenario 5: First task approved -> single balanced REFERRAL_REWARD (30), status = 'paid'
  const taskPay1 = v.post('TASK_REWARD_PAYOUT', `TASK_REWARD_PAYOUT:${pendingSub.id}`, [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 100, memo: 'First task reward' },
    { account_id: referredWallet.id, side: 'credit', amount_units: 100, memo: 'First task reward' },
  ]);
  pendingSub.status = 'approved';
  pendingSub.reward_transaction_id = taskPay1.txId;
  const rw1 = processReferralRewardOnApproval(pendingSub);
  assert.ok(rw1 && rw1.status === 'paid' && rw1.reward_amount === 30);
  assert.strictEqual(v.bal(referrerWallet.code), 30);
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 970);

  // Scenario 6: Second task approved for same user -> NO second referral reward
  const secondSub: SimSub = { id: crypto.randomUUID(), user_id: referredId, task_id: 'T-REF-2', status: 'pending', reward_transaction_id: null };
  submissions.push(secondSub);
  const taskPay2 = v.post('TASK_REWARD_PAYOUT', `TASK_REWARD_PAYOUT:${secondSub.id}`, [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 100, memo: 'Second task reward' },
    { account_id: referredWallet.id, side: 'credit', amount_units: 100, memo: 'Second task reward' },
  ]);
  secondSub.status = 'approved';
  secondSub.reward_transaction_id = taskPay2.txId;
  processReferralRewardOnApproval(secondSub);
  assert.strictEqual(v.bal(referrerWallet.code), 30, 'Second task must NOT pay a second referral reward');

  // Scenario 7: Duplicate/race idempotency on first submission -> NO double pay
  processReferralRewardOnApproval(pendingSub);
  assert.strictEqual(v.bal(referrerWallet.code), 30, 'Duplicate processing must stay idempotent at 30');

  // Scenario 10b: Insufficient PLATFORM-TREASURY balance -> records pending, ZERO unbacked issuance
  const regLow = registerWithReferral(insufficientTreasuryUserId, 'مدعو عند فراغ الخزينة', refCode);
  const regPendingNoTask = registerWithReferral(pendingUserId, 'مدعو بلا مهام', refCode);
  // Drain treasury to 10 (< 30) via owner withdrawal
  v.post('OWNER_WITHDRAWAL', 'DRAIN-TREASURY', buildDoubleEntryForOperation({
    operationType: 'OWNER_WITHDRAWAL', amountUnits: 960, description: 'سحب متبقي لاختبار كفاية الخزينة', accountIds: ids,
  }));
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 10);

  const lowTreasurySub: SimSub = { id: crypto.randomUUID(), user_id: insufficientTreasuryUserId, task_id: 'T-REF-3', status: 'pending', reward_transaction_id: null };
  submissions.push(lowTreasurySub);
  const taskPay3 = v.post('TASK_REWARD_PAYOUT', `TASK_REWARD_PAYOUT:${lowTreasurySub.id}`, [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 50, memo: 'Task reward' },
    { account_id: referredWallet.id, side: 'credit', amount_units: 50, memo: 'Task reward' },
  ]);
  lowTreasurySub.status = 'approved';
  lowTreasurySub.reward_transaction_id = taskPay3.txId;
  const rwLow = processReferralRewardOnApproval(lowTreasurySub);
  assert.ok(rwLow && rwLow.status === 'pending' && rwLow.ledger_transaction_id === null, 'Insufficient treasury must record pending without unbacked issuance');
  assert.strictEqual(v.bal(referrerWallet.code), 30, 'Referrer wallet must remain 30 when treasury lacks balance');

  // Verify full computeReferralSummary across all 3 referred users (paid, pending treasury, awaiting_first_task)
  const finalSummary = computeReferralSummary({
    ownReferralCode: refCode,
    referralBonus: REFERRAL_BONUS,
    referredProfiles: [regOk, regLow, regPendingNoTask],
    approvedSubmissions: submissions,
    referralRewards: Array.from(rewardsByReferredUser.values()),
  });
  assert.strictEqual(finalSummary.totalReferred, 3);
  assert.strictEqual(finalSummary.qualifiedReferralsCount, 2);
  assert.strictEqual(finalSummary.paidRewardsCount, 1);
  assert.strictEqual(finalSummary.totalEarnedYer, 30);
  assert.strictEqual(finalSummary.referredUsers[0].rewardStatus, 'paid');
  assert.strictEqual(finalSummary.referredUsers[1].rewardStatus, 'pending');
  assert.strictEqual(finalSummary.referredUsers[2].rewardStatus, 'awaiting_first_task');

  v.assertReconciled([taskEscrow.code], [referrerWallet.code, referredWallet.code], 0);
  console.log('  - Verified signup=0, invalid/self-referral rejection, first-task reward=30, 2nd-task=0, idempotency & pending treasury safety.');
}

function runMigration013And014SecurityAuditTests() {
  console.log('\n[7/8] Migration 013 & 014 Compatibility, Security & Return-Type SQL Audit...');
  const sql013 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/013_financial_ledger_compatibility_and_task_accounting.sql'),
    'utf8'
  );
  const sql014 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/014_referral_system_and_atomic_rewards.sql'),
    'utf8'
  );

  // Migration 013 checks
  for (const code of MIGRATION_011_CORE_ACCOUNTS) {
    assert.ok(sql013.includes(`'${code}'`), `Migration 013 must verify/seed core account ${code}`);
  }
  assert.ok(sql013.includes("'issuance_control'"), 'Migration 013 must preserve live issuance_control account_type');
  assert.ok(sql013.includes('financial_accounts_structure'), 'Migration 013 must respect financial_accounts_structure');
  assert.ok(
    /CREATE OR REPLACE FUNCTION public\.review_task_submission\([\s\S]*?\)\s*RETURNS UUID/i.test(sql013),
    'Migration 013 must preserve review_task_submission(...) RETURNS UUID signature'
  );
  assert.ok(
    sql013.includes('GRANT SELECT ON public.financial_accounts TO authenticated') &&
      sql013.includes('GRANT SELECT ON public.ledger_transactions TO authenticated') &&
      sql013.includes('GRANT SELECT ON public.ledger_entries TO authenticated') &&
      !/GRANT INSERT[\s\S]*?ON public\.(financial_accounts|ledger_transactions|ledger_entries) TO authenticated/i.test(sql013),
    'Migration 013 must strictly restrict authenticated to SELECT ONLY on ledger & financial_accounts'
  );
  assert.ok(!/DROP\s+CONSTRAINT.*reservation_transaction_id/i.test(sql013), 'Must NOT drop legacy reservation_transaction_id FK');
  assert.ok(!/DROP\s+CONSTRAINT.*refund_transaction_id/i.test(sql013), 'Must NOT drop legacy refund_transaction_id FK');
  assert.ok(sql013.includes('trg_prevent_ledger_transactions_mutation'), 'Must enforce ledger immutability trigger');

  // Migration 014 checks
  assert.ok(sql014.includes('ADD COLUMN referred_by UUID REFERENCES public.profiles(id)'), 'Migration 014 must add profiles.referred_by FK');
  assert.ok(sql014.includes('profiles_no_self_referral'), 'Migration 014 must enforce profiles_no_self_referral CHECK');
  assert.ok(sql014.includes('trg_protect_profiles_referred_by'), 'Migration 014 must enforce referred_by immutability trigger');
  assert.ok(sql014.includes('referred_user_id UUID NOT NULL UNIQUE'), 'Migration 014 must enforce one reward per referred_user_id');
  assert.ok(sql014.includes('trigger_submission_id UUID NOT NULL UNIQUE'), 'Migration 014 must enforce unique trigger_submission_id');
  assert.ok(sql014.includes('ledger_transaction_id UUID UNIQUE'), 'Migration 014 must enforce unique ledger_transaction_id');
  assert.ok(sql014.includes('get_configured_referral_bonus'), 'Migration 014 must read dynamic referral_bonus from platform_settings');
  const sql014WithoutComments = sql014
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.ok(!/\b300\b/.test(sql014WithoutComments), 'Migration 014 SQL code must NEVER hardcode 300');
  assert.ok(
    sql014.includes('REVOKE ALL ON public.referral_rewards FROM PUBLIC, anon, authenticated') &&
      sql014.includes('GRANT SELECT ON public.referral_rewards TO authenticated'),
    'Migration 014 must restrict referral_rewards to SELECT ONLY for authenticated'
  );

  // Also check ReferralView & AuthModal have zero hardcoded 300 / AHMED26
  const refViewSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dashboard/ReferralView.tsx'), 'utf8');
  assert.ok(!refViewSrc.includes('AHMED26'), 'ReferralView must NOT contain hardcoded AHMED26');
  assert.ok(!refViewSrc.includes('300 ريال') && !refViewSrc.includes('300 ر.ي'), 'ReferralView must NOT hardcode 300');
  assert.ok(!refViewSrc.includes('setReferrals(res.referrals)'), 'ReferralView bug res.referrals must stay fixed');

  console.log('  - Migration 013, Migration 014 & frontend referral security/compatibility checks passed.');
}

async function runReadOnlyServerReferralProbe() {
  console.log('\n[8/9] Server Settings & Referral Resolver Read-Only Integrity Check...');
  const settings = await supabaseDb.getSettings();
  assert.strictEqual(settings.referralBonus, 30, `Live/fallback referralBonus must be 30, got ${settings.referralBonus}`);
  assert.strictEqual(
    settings.advertiserCampaignFeePercentage,
    20,
    `Default advertiserCampaignFeePercentage must be 20, got ${settings.advertiserCampaignFeePercentage}`
  );
  const missingCode = await supabaseDb.resolveReferralCode('DEFINITELY-DOES-NOT-EXIST-999999');
  assert.strictEqual(missingCode, null, 'Nonexistent referral code must resolve to null');
  console.log(`  - Verified referralBonus === 30, advertiserCampaignFeePercentage === 20 & invalid referral === null.`);
}

function runPhase3CampaignFundingAndAccountingTests() {
  console.log('\n[9/9] Phase 3 Advertiser Campaign Funding, Fee Escrow & Double-Entry Verification...');

  // 1. Exact formula verification: 100 tasks × 100 YER = 10,000 budget + 20% = 2,000 fee = 12,000 total
  const calc = calculateCampaignFundingCosts({ rewardUnits: 100, slots: 100, feePercentage: 20 });
  assert.strictEqual(calc.budgetUnits, 10000);
  assert.strictEqual(calc.feeUnits, 2000);
  assert.strictEqual(calc.totalUnits, 12000);

  // 2. Balance sufficiency & deficit verification
  const shortCheck = checkCampaignBalanceSufficiency(8500, calc.totalUnits);
  assert.strictEqual(shortCheck.sufficient, false);
  assert.strictEqual(shortCheck.deficitUnits, 3500);
  const okCheck = checkCampaignBalanceSufficiency(12000, calc.totalUnits);
  assert.strictEqual(okCheck.sufficient, true);
  assert.strictEqual(okCheck.deficitUnits, 0);

  // 3. Closed-loop double-entry simulation (Campaign A: started & partially completed & settled; Campaign B: cancelled before start)
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  v.post('TREASURY_ISSUANCE', 'ISS-CAMP-1', [
    { account_id: ids['VIRTUAL-ISSUANCE-CONTROL'], side: 'debit', amount_units: 50000, memo: 'Initial supply' },
    { account_id: ids['PLATFORM-TREASURY'], side: 'credit', amount_units: 50000, memo: 'Treasury funded' },
  ]);

  const advWallet = v.createAccount('WALLET-ADV-1', 'wallet', 'credit');
  const workerWallet = v.createAccount('WALLET-WORKER-1', 'wallet', 'credit');
  // Top up advertiser wallet 15,000 YER with ZERO deposit fee
  v.post('ADMIN_ADJUSTMENT', 'TOPUP-ADV-1', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 15000, memo: 'Zero-fee advertiser top-up' },
    { account_id: advWallet.id, side: 'credit', amount_units: 15000, memo: 'Advertiser wallet credit (0% top-up fee)' },
  ]);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0, 'Top-up must NOT charge any deposit fee');

  // Campaign A creation: 100 * 100 = 10,000 budget + 2,000 fee = 12,000 reserved
  const campABudgetEscrow = v.createAccount('CAMPAIGN-ESCROW-A', 'escrow', 'credit');
  const campAFeeEscrow = v.createAccount('CAMPAIGN-FEE-ESCROW-A', 'escrow', 'credit');
  v.post(
    'CAMPAIGN_FUNDING_RESERVE',
    'CAMP-RESERVE-A',
    buildCampaignReserveEntries({
      title: 'حملة أ',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campABudgetEscrow.id,
      feeEscrowAccountId: campAFeeEscrow.id,
      budgetUnits: calc.budgetUnits,
      feeUnits: calc.feeUnits,
      feePercentage: 20,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 3000, 'Advertiser balance after Campaign A reserve must be 3,000');
  assert.strictEqual(v.bal(campABudgetEscrow.code), 10000);
  assert.strictEqual(v.bal(campAFeeEscrow.code), 2000);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0, 'CRITICAL: Platform fee MUST NOT be recognized before campaign starts');

  // Concurrent second campaign attempt for another 12,000 must fail (balance is only 3,000 -> prevents double-spend)
  assert.throws(() => {
    const campBBudgetEscrow = v.createAccount('CAMPAIGN-ESCROW-B-FAIL', 'escrow', 'credit');
    const campBFeeEscrow = v.createAccount('CAMPAIGN-FEE-ESCROW-B-FAIL', 'escrow', 'credit');
    v.post(
      'CAMPAIGN_FUNDING_RESERVE',
      'CAMP-RESERVE-B-FAIL',
      buildCampaignReserveEntries({
        title: 'حملة مزدوجة مرفوضة',
        walletAccountId: advWallet.id,
        budgetEscrowAccountId: campBBudgetEscrow.id,
        feeEscrowAccountId: campBFeeEscrow.id,
        budgetUnits: 10000,
        feeUnits: 2000,
        feePercentage: 20,
      })
    );
  }, /Negative balance prevented/);
  assert.strictEqual(v.bal(advWallet.code), 3000);

  // Campaign A starts -> moves held fee into PLATFORM-REVENUE-ADS ONCE ONLY
  const feeRecEntries = buildCampaignFeeRecognitionEntries({
    title: 'حملة أ',
    feeEscrowAccountId: campAFeeEscrow.id,
    adsRevenueAccountId: ids['PLATFORM-REVENUE-ADS'],
    feeUnits: 2000,
  });
  const firstStart = v.post('AD_REVENUE', 'CAMPAIGN-FEE-REVENUE:A', feeRecEntries);
  const dupStart = v.post('AD_REVENUE', 'CAMPAIGN-FEE-REVENUE:A', feeRecEntries);
  assert.strictEqual(firstStart.idempotent, false);
  assert.strictEqual(dupStart.idempotent, true);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 2000, 'Fee recognized into PLATFORM-REVENUE-ADS strictly once');
  assert.strictEqual(v.bal(campAFeeEscrow.code), 0);

  // Worker completes 40 tasks (40 * 100 = 4,000 paid from Campaign A escrow, commission_units = 0)
  v.post('TASK_REWARD_PAYOUT', 'PAY-CAMP-A-40', [
    { account_id: campABudgetEscrow.id, side: 'debit', amount_units: 4000, memo: '40 approved submissions' },
    { account_id: workerWallet.id, side: 'credit', amount_units: 4000, memo: 'Worker earnings from campaign' },
  ]);
  assert.strictEqual(v.bal(campABudgetEscrow.code), 6000);
  assert.strictEqual(v.bal(workerWallet.code), 4000);

  // Settle/Cancel Campaign A -> returns unused 6,000 budget (started fee stays with platform)
  v.post(
    'CAMPAIGN_ESCROW_REFUND',
    'CAMPAIGN-REFUND:A',
    buildCampaignSettlementRefundEntries({
      title: 'حملة أ',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campABudgetEscrow.id,
      feeEscrowAccountId: campAFeeEscrow.id,
      refundBudgetUnits: 6000,
      refundFeeUnits: 0,
    })
  );
  assert.strictEqual(v.bal(campABudgetEscrow.code), 0);
  assert.strictEqual(v.bal(advWallet.code), 9000);

  // Campaign C (fee snapshot 10%, 100 * 10 = 1,000 budget + 100 fee = 1,100) cancelled BEFORE starting -> refunds BOTH budget + fee!
  const calcC = calculateCampaignFundingCosts({ rewardUnits: 100, slots: 10, feePercentage: 10 });
  assert.strictEqual(calcC.totalUnits, 1100);
  const campCBudgetEscrow = v.createAccount('CAMPAIGN-ESCROW-C', 'escrow', 'credit');
  const campCFeeEscrow = v.createAccount('CAMPAIGN-FEE-ESCROW-C', 'escrow', 'credit');
  v.post(
    'CAMPAIGN_FUNDING_RESERVE',
    'CAMP-RESERVE-C',
    buildCampaignReserveEntries({
      title: 'حملة ج غير مبدوءة',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campCBudgetEscrow.id,
      feeEscrowAccountId: campCFeeEscrow.id,
      budgetUnits: calcC.budgetUnits,
      feeUnits: calcC.feeUnits,
      feePercentage: 10,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 7900);
  v.post(
    'CAMPAIGN_ESCROW_REFUND',
    'CAMPAIGN-REFUND:C',
    buildCampaignSettlementRefundEntries({
      title: 'حملة ج غير مبدوءة',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campCBudgetEscrow.id,
      feeEscrowAccountId: campCFeeEscrow.id,
      refundBudgetUnits: 1000,
      refundFeeUnits: 100,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 9000, 'Cancelling unstarted campaign refunds BOTH budget and reserved fee');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 2000, 'Historical fee snapshot & revenue untouched by unstarted cancellation');

  // Assert closed-loop accounting integrity including PLATFORM-REVENUE-ADS from supply loop
  v.assertReconciled(
    [campABudgetEscrow.code, campAFeeEscrow.code, campCBudgetEscrow.code, campCFeeEscrow.code],
    [advWallet.code, workerWallet.code],
    v.bal('PLATFORM-REVENUE-ADS')
  );

  // 4. Audit Migration 020 SQL invariants
  const sql020 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/020_advertiser_campaigns_and_fee_escrow.sql'),
    'utf8'
  );
  assert.ok(sql020.includes('CREATE TABLE IF NOT EXISTS public.campaigns'), 'Migration 020 must define campaigns');
  assert.ok(sql020.includes('fee_percentage NUMERIC(5,2) NOT NULL'), 'Migration 020 must snapshot fee_percentage');
  assert.ok(sql020.includes('PLATFORM-REVENUE-ADS'), 'Migration 020 must route recognized fee to PLATFORM-REVENUE-ADS');
  assert.ok(sql020.includes('pg_advisory_xact_lock'), 'Migration 020 must use advisory locks');
  assert.ok(sql020.includes('FOR UPDATE'), 'Migration 020 must use row-level locking');
  assert.ok(!sql020.includes('create_funded_task'), 'Migration 020 must NOT invoke admin treasury create_funded_task');

  console.log('  - Verified Phase 3 calculator, deficit checks, deferred fee escrow, once-only revenue recognition, refunds & Migration 020 SQL invariants.');
}

function runPhase4AdvertiserIdentityAndUiTests() {
  console.log('\n[10/10] Phase 4 Advertiser Identity Privacy, Fee Inclusions & Migration 021 Audit...');

  // 1. sanitizeAdvertiserLogoUrl checks
  assert.strictEqual(
    sanitizeAdvertiserLogoUrl('https://cdn.example.com/logo.png'),
    'https://cdn.example.com/logo.png'
  );
  assert.strictEqual(
    sanitizeAdvertiserLogoUrl('advertiser-logos/user-1/logo.webp'),
    'advertiser-logos/user-1/logo.webp'
  );
  assert.ok(
    sanitizeAdvertiserLogoUrl('data:image/png;base64,iVBORw0KGgo='),
    'Raster PNG base64 logo must be allowed'
  );
  assert.strictEqual(
    sanitizeAdvertiserLogoUrl('data:image/svg+xml;base64,PHN2Zz4='),
    undefined,
    'SVG data URLs must be rejected for XSS safety'
  );
  assert.strictEqual(
    sanitizeAdvertiserLogoUrl('javascript:alert(1)'),
    undefined,
    'javascript: URLs must be rejected'
  );
  assert.strictEqual(
    sanitizeAdvertiserLogoUrl('advertiser-logos/../secret/file.png'),
    undefined,
    'Path traversal must be rejected'
  );

  // 2. resolvePublicTaskAdvertiserIdentity: hidden identity masked to workers, preserved for admin
  const hiddenCampaignTask = {
    campaign_id: '11111111-1111-1111-1111-111111111111',
    created_by: 'adv-secret-uuid',
    hide_advertiser_name: true,
    advertiser_display_name: 'شركة النور السرية',
    advertiser_logo_url: 'https://cdn.example.com/secret-logo.png',
  };

  const workerMasked = resolvePublicTaskAdvertiserIdentity(hiddenCampaignTask, { maskHiddenIdentity: true });
  assert.strictEqual(workerMasked.isExternalCampaign, true);
  assert.strictEqual(workerMasked.hideAdvertiserName, true);
  assert.strictEqual(workerMasked.advertiserDisplayName, 'معلن عبر يمن تاسك');
  assert.strictEqual(workerMasked.advertiserLogoUrl, undefined, 'Logo MUST be hidden when hideAdvertiserName=true');
  assert.strictEqual(workerMasked.exposeCreatedBy, false, 'Real advertiser UUID MUST NOT leak on masked tasks');

  const adminUnmasked = resolvePublicTaskAdvertiserIdentity(hiddenCampaignTask, { maskHiddenIdentity: false });
  assert.strictEqual(adminUnmasked.isExternalCampaign, true);
  assert.strictEqual(adminUnmasked.hideAdvertiserName, true);
  assert.strictEqual(adminUnmasked.advertiserDisplayName, 'شركة النور السرية');
  assert.strictEqual(adminUnmasked.advertiserLogoUrl, 'https://cdn.example.com/secret-logo.png');
  assert.strictEqual(adminUnmasked.exposeCreatedBy, true);

  // 3. Visible external campaign via _campaignMeta fallback (pre-021 DB schema support)
  const visibleCampaignMetaTask = {
    campaign_id: '22222222-2222-2222-2222-222222222222',
    created_by: 'adv-public-uuid',
    proof_requirements: {
      requireImage: true,
      requireText: true,
      _campaignMeta: {
        isExternalCampaign: true,
        hideAdvertiserName: false,
        advertiserDisplayName: 'متجر سبأ الإلكتروني',
        advertiserLogoUrl: 'advertiser-logos/adv-public-uuid/saba.png',
      },
    },
  };
  const visibleResolved = resolvePublicTaskAdvertiserIdentity(visibleCampaignMetaTask, { maskHiddenIdentity: true });
  assert.strictEqual(visibleResolved.isExternalCampaign, true);
  assert.strictEqual(visibleResolved.hideAdvertiserName, false);
  assert.strictEqual(visibleResolved.advertiserDisplayName, 'متجر سبأ الإلكتروني');
  assert.strictEqual(visibleResolved.advertiserLogoUrl, 'advertiser-logos/adv-public-uuid/saba.png');

  // 4. Platform-funded direct task (NOT external campaign)
  const platformTask = {
    campaign_id: null,
    created_by: 'admin-uuid',
    proof_requirements: { requireImage: true, requireText: true },
  };
  const platformResolved = resolvePublicTaskAdvertiserIdentity(platformTask, { maskHiddenIdentity: true });
  assert.strictEqual(platformResolved.isExternalCampaign, false);
  assert.strictEqual(platformResolved.hideAdvertiserName, false);
  assert.strictEqual(platformResolved.advertiserDisplayName, undefined);

  // 5. Verify exact Phase 4 Fee Inclusion heading & 7 points in CampaignServiceFeeDetails.tsx
  const feeCompSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/advertiser/CampaignServiceFeeDetails.tsx'),
    'utf8'
  );
  assert.ok(feeCompSrc.includes('ماذا تشمل رسوم خدمة يمن تاسك؟'), 'Missing exact Phase 4 heading');
  const requiredPoints = [
    'مقابل توفير الجمهور المناسب للحملة.',
    'تشغيل المنصة والبنية التقنية والصيانة والتطوير وأرباح المنصة.',
    'تدقيق ومراجعة المهمات.',
    'تتبع المهمات ومراقبة الأداء.',
    'التحقق من الإنجازات واعتمادها.',
    'منع التلاعب والتكرار والإنجازات الوهمية.',
    'حماية ميزانية المعلن ومراقبة تنفيذ الحملة.',
  ];
  for (const pt of requiredPoints) {
    assert.ok(feeCompSrc.includes(pt), `Missing exact Phase 4 fee point: ${pt}`);
  }
  assert.ok(
    feeCompSrc.includes('هذه النقاط توضيحية ضمن رسوم إجمالية واحدة') && feeCompSrc.includes('وليست رسوماً مستقلة.'),
    'Missing Phase 4 single-fee clarification note'
  );

  // 6. Verify all 4 required UI surfaces include CampaignServiceFeeDetails or CampaignModals
  for (const relPath of [
    'src/components/advertiser/AdvertiserPortal.tsx',
    'src/components/advertiser/CampaignModals.tsx',
    'src/components/dashboard/WalletView.tsx',
    'src/components/admin/finance/LedgerAuditView.tsx',
  ]) {
    const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
    assert.ok(
      content.includes('CampaignServiceFeeDetails') || content.includes('CampaignLedgerTxModal'),
      `${relPath} must wire Phase 4 fee details UI`
    );
  }

  // 7. Audit Migration 021 SQL invariants
  const sql021 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/021_campaign_advertiser_identity.sql'),
    'utf8'
  );
  assert.ok(sql021.includes('hide_advertiser_name'), 'Migration 021 must add hide_advertiser_name');
  assert.ok(sql021.includes('advertiser_display_name'), 'Migration 021 must add advertiser_display_name');
  assert.ok(sql021.includes('advertiser_logo_url'), 'Migration 021 must add advertiser_logo_url');
  assert.ok(sql021.includes('is_external_campaign'), 'Migration 021 must add is_external_campaign');

  console.log('  - Verified Phase 4 identity masking, URL/XSS sanitization, exact 7 fee inclusions, all 4 UI surfaces & Migration 021 invariants.');
}

function runPhase5ExternalAccountsAndSegregationTests() {
  console.log('\n[11/11] Phase 5 External Accounts, Receipt-Backed Advertiser Custody, Internal Transfers, Reconciliation & Segregation...');

  // 1. Receipt reference normalization & duplicate prevention logic
  assert.strictEqual(normalizeReceiptReference(' kur-00912 a '), 'KUR00912A');
  assert.strictEqual(normalizeReceiptReference('KUR00912A'), normalizeReceiptReference('kur - 00912a'));
  assert.strictEqual(normalizeReceiptReference('   '), '');

  // 2. Receipt image URL / XSS sanitization
  assert.strictEqual(
    sanitizeDepositReceiptUrl('external-receipts/admin-1/receipt_1.png'),
    'external-receipts/admin-1/receipt_1.png'
  );
  assert.ok(
    sanitizeDepositReceiptUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='),
    'Raster JPEG data URL must be allowed'
  );
  assert.strictEqual(sanitizeDepositReceiptUrl('data:image/svg+xml;base64,PHN2Zz4='), '', 'SVG receipt must be rejected');
  assert.strictEqual(sanitizeDepositReceiptUrl('javascript:alert(1)'), '', 'javascript: receipt must be rejected');
  assert.strictEqual(sanitizeDepositReceiptUrl('external-receipts/../secret.png'), '', 'Path traversal must be rejected');

  // 3. Closed-loop double-entry simulation for external accounts & advertiser liabilities
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  v.post('TREASURY_ISSUANCE', 'ISS-EXT-1', [
    { account_id: ids['VIRTUAL-ISSUANCE-CONTROL'], side: 'debit', amount_units: 10000, memo: 'Initial platform supply' },
    { account_id: ids['PLATFORM-TREASURY'], side: 'credit', amount_units: 10000, memo: 'Treasury initial funds' },
  ]);
  const treasuryBeforeDeposit = v.bal('PLATFORM-TREASURY');

  // Create two external accounts (asset, normal_side=debit) + advertiser & worker wallets
  const extKuraimi = v.createAccount('EXT-ACC-KURAIMI', 'asset', 'debit');
  const extJeeb = v.createAccount('EXT-ACC-JEEB', 'asset', 'debit');
  const advWallet = v.createAccount('WALLET-ADV-EXT', 'wallet', 'credit');
  const workerWallet = v.createAccount('WALLET-WRK-EXT', 'wallet', 'credit');

  // Approve advertiser deposit (12,000 YER) backed by receipt -> Debit EXT-ACC-KURAIMI, Credit WALLET-ADV-EXT
  const depositEntries = buildExternalDepositApprovalEntries({
    externalFinAccountId: extKuraimi.id,
    targetFinAccountId: advWallet.id,
    amountUnits: 12000,
    externalAccountName: 'الكريمي - حساب المالك',
    referenceNumber: 'KUR-2025-881',
    depositPurpose: 'advertiser_wallet',
  });
  const depPost1 = v.post('EXTERNAL_ADVERTISER_DEPOSIT', 'EXT-DEP:dep-1', depositEntries);
  const depPostDup = v.post('EXTERNAL_ADVERTISER_DEPOSIT', 'EXT-DEP:dep-1', depositEntries);
  assert.strictEqual(depPost1.idempotent, false);
  assert.strictEqual(depPostDup.idempotent, true, 'Duplicate approval idempotency key must NOT double-credit');

  assert.strictEqual(v.bal(extKuraimi.code), 12000, 'External account debit asset must equal 12,000');
  assert.strictEqual(v.bal(advWallet.code), 12000, 'Advertiser wallet liability must equal 12,000');
  assert.strictEqual(
    v.bal('PLATFORM-TREASURY'),
    treasuryBeforeDeposit,
    'CRITICAL: Approving external advertiser deposit MUST NOT increase PLATFORM-TREASURY'
  );
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0, 'CRITICAL: Advertiser deposit is a LIABILITY, not revenue');

  // Invalid inputs on builders throw cleanly
  assert.throws(
    () =>
      buildExternalDepositApprovalEntries({
        externalFinAccountId: extKuraimi.id,
        targetFinAccountId: advWallet.id,
        amountUnits: 0,
        externalAccountName: 'x',
        referenceNumber: 'R1',
        depositPurpose: 'advertiser_wallet',
      }),
    /عدداً صحيحاً موجباً/
  );
  assert.throws(
    () =>
      buildExternalDepositApprovalEntries({
        externalFinAccountId: extKuraimi.id,
        targetFinAccountId: advWallet.id,
        amountUnits: 500,
        externalAccountName: 'x',
        referenceNumber: '   ',
        depositPurpose: 'advertiser_wallet',
      }),
    /الرقم المرجعي/
  );

  // 4. Internal transfer between owner/admin external accounts (Asset -> Asset)
  const transferEntries = buildInternalAccountTransferEntries({
    fromFinAccountId: extKuraimi.id,
    toFinAccountId: extJeeb.id,
    fromAccountCode: extKuraimi.code,
    toAccountCode: extJeeb.code,
    amountUnits: 5000,
    reason: 'نقل سيولة مالك من الكريمي إلى محفظة جيب',
  });
  v.post('INTERNAL_ACCOUNT_TRANSFER', 'INT-TRF:1', transferEntries);
  assert.strictEqual(v.bal(extKuraimi.code), 7000);
  assert.strictEqual(v.bal(extJeeb.code), 5000);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0, 'Internal transfer must NOT create revenue');
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), treasuryBeforeDeposit, 'Internal transfer must NOT alter treasury');

  assert.throws(
    () =>
      buildInternalAccountTransferEntries({
        fromFinAccountId: extKuraimi.id,
        toFinAccountId: extKuraimi.id,
        fromAccountCode: extKuraimi.code,
        toAccountCode: extKuraimi.code,
        amountUnits: 100,
        reason: 'نفس الحساب',
      }),
    /حسابين مختلفين/
  );

  // 5. Campaign starts, completes 9 tasks (with 1 unused budget slot remainder) -> revenue recognized & dust refunded
  const campBudget = v.createAccount('CAMPAIGN-ESCROW-EXT', 'escrow', 'credit');
  const campFee = v.createAccount('CAMPAIGN-FEE-ESCROW-EXT', 'escrow', 'credit');
  v.post(
    'CAMPAIGN_FUNDING_RESERVE',
    'CAMP-RES-EXT',
    buildCampaignReserveEntries({
      title: 'حملة ممولة خارجياً',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campBudget.id,
      feeEscrowAccountId: campFee.id,
      budgetUnits: 10000,
      feeUnits: 2000,
      feePercentage: 20,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 0);

  v.post(
    'AD_REVENUE',
    'CAMP-START-EXT',
    buildCampaignFeeRecognitionEntries({
      title: 'حملة ممولة خارجياً',
      feeEscrowAccountId: campFee.id,
      adsRevenueAccountId: ids['PLATFORM-REVENUE-ADS'],
      feeUnits: 2000,
    })
  );
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 2000);

  // Payout 9 tasks * 1,000 = 9,000 to worker
  v.post('TASK_REWARD_PAYOUT', 'CAMP-PAY-EXT-9', [
    { account_id: campBudget.id, side: 'debit', amount_units: 9000, memo: '9 completed submissions' },
    { account_id: workerWallet.id, side: 'credit', amount_units: 9000, memo: 'Worker earnings' },
  ]);

  // Auto-complete / settle remaining 1,000 unused budget dust back to advertiser wallet
  v.post(
    'CAMPAIGN_ESCROW_REFUND',
    'CAMP-COMPLETE-DUST-EXT',
    buildCampaignSettlementRefundEntries({
      title: 'حملة ممولة خارجياً',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campBudget.id,
      feeEscrowAccountId: campFee.id,
      refundBudgetUnits: 1000,
      refundFeeUnits: 0,
    })
  );
  assert.strictEqual(v.bal(campBudget.code), 0);
  assert.strictEqual(v.bal(advWallet.code), 1000);
  assert.strictEqual(v.bal(workerWallet.code), 9000);

  // Verify ledger reconciliation across the entire system (virtual treasury + external deposits custody = liabilities + revenues)
  const reconciledLiabilitiesAndRevenues =
    v.bal('PLATFORM-TREASURY') +
    v.bal(advWallet.code) +
    v.bal(workerWallet.code) +
    v.bal(campBudget.code) +
    v.bal(campFee.code) +
    v.bal('PLATFORM-REVENUE-ADS');
  const totalBacking = v.bal('VIRTUAL-ISSUANCE-CONTROL') + v.bal(extKuraimi.code) + v.bal(extJeeb.code);
  assert.strictEqual(
    reconciledLiabilitiesAndRevenues,
    totalBacking,
    `Balanced double-entry equation violated: liabilities+rev=${reconciledLiabilitiesAndRevenues} vs virtual+extAssets=${totalBacking}`
  );

  // 6. Reconciliation adjustment builders (no discrepancy, surplus, shortage)
  const zeroAdj = buildReconciliationAdjustmentEntries({
    externalFinAccountId: extKuraimi.id,
    contraFinAccountId: ids['OWNER-CAPITAL'],
    accountingBalance: 7000,
    actualBalance: 7000,
    reason: 'مطابقة سليمة',
    accountName: 'الكريمي',
  });
  assert.strictEqual(zeroAdj.discrepancy, 0);
  assert.strictEqual(zeroAdj.entries.length, 0);

  const surplusAdj = buildReconciliationAdjustmentEntries({
    externalFinAccountId: extKuraimi.id,
    contraFinAccountId: ids['OWNER-CAPITAL'],
    accountingBalance: 7000,
    actualBalance: 7500,
    reason: 'فارق زيادة مطابقة بنكية',
    accountName: 'الكريمي',
  });
  assert.strictEqual(surplusAdj.discrepancy, 500);
  v.post('EXTERNAL_RECONCILIATION_ADJUSTMENT', 'REC-SURPLUS-1', surplusAdj.entries);
  assert.strictEqual(v.bal(extKuraimi.code), 7500);

  const shortageAdj = buildReconciliationAdjustmentEntries({
    externalFinAccountId: extJeeb.id,
    contraFinAccountId: ids['PLATFORM-EXPENSES'],
    accountingBalance: 5000,
    actualBalance: 4800,
    reason: 'عمولة تحويل بنكي خصمت خارجياً',
    accountName: 'جيب',
  });
  assert.strictEqual(shortageAdj.discrepancy, -200);
  v.post('EXTERNAL_RECONCILIATION_ADJUSTMENT', 'REC-SHORTAGE-1', shortageAdj.entries);
  assert.strictEqual(v.bal(extJeeb.code), 4800);
  assert.strictEqual(v.bal('PLATFORM-EXPENSES'), 200);

  // 7. Three-way Fund Segregation mathematical consistency
  const seg = computeFundSegregationSummary({
    cashVaultTotal: 1000,
    externalPlatformBalance: 4800,
    externalAccountsTotal: 12300,
    externalActualTotal: 12300,
    activeExternalCount: 2,
    realizedRevenuesTotal: 2000,
    operationalExpensesTotal: 200,
    ownerCapitalTotal: 5000,
    ownerWithdrawalsTotal: 300,
    virtualTreasuryAvailable: 10000,
    advertiserWalletsTotal: 1000,
    campaignBudgetEscrow: 4000,
    campaignFeeEscrow: 800,
    pendingExternalDepositsCount: 1,
    pendingExternalDepositsAmount: 2500,
    approvedExternalDepositsTotal: 12000,
    workerWalletsTotal: 9000,
    withdrawalReservedTotal: 1500,
    adminTaskEscrowTotal: 2000,
  });
  assert.strictEqual(seg.platformFunds.netOwnerEquity, 5000 + (2000 - 200) - 300);
  assert.strictEqual(seg.advertiserFunds.totalAdvertiserLiabilities, 1000 + 4000 + 800);
  assert.strictEqual(seg.userFunds.totalUserLiabilities, 9000 + 1500 + 2000);
  assert.strictEqual(seg.externalAccountsSummary.totalDiscrepancy, 0);

  // 8. Migration 022 SQL security & structure audit
  const sql022 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/022_external_accounts_and_advertiser_custody.sql'),
    'utf8'
  );
  assert.ok(sql022.includes('CREATE TABLE IF NOT EXISTS public.external_accounts'), 'Migration 022 must define external_accounts');
  assert.ok(sql022.includes('CREATE TABLE IF NOT EXISTS public.external_deposits'), 'Migration 022 must define external_deposits');
  assert.ok(sql022.includes('CREATE TABLE IF NOT EXISTS public.external_account_transfers'), 'Migration 022 must define external_account_transfers');
  assert.ok(sql022.includes('CREATE TABLE IF NOT EXISTS public.external_account_reconciliations'), 'Migration 022 must define external_account_reconciliations');
  assert.ok(sql022.includes('idx_external_deposits_unique_active_ref'), 'Migration 022 must enforce unique non-rejected receipt reference');
  assert.ok(sql022.includes('approve_external_deposit'), 'Migration 022 must define atomic approve_external_deposit RPC');
  assert.ok(sql022.includes('execute_internal_account_transfer'), 'Migration 022 must define execute_internal_account_transfer RPC');
  assert.ok(sql022.includes('reconcile_external_account'), 'Migration 022 must define reconcile_external_account RPC');
  assert.ok(sql022.includes('REVOKE ALL ON public.external_accounts FROM PUBLIC, anon'), 'Migration 022 must revoke anon access');
  assert.ok(sql022.includes('REVOKE ALL ON public.external_deposits FROM PUBLIC, anon'), 'Migration 022 must revoke anon access on deposits');
  assert.ok(!sql022.includes('PLATFORM-REVENUE-ADS'), 'Deposit approval RPC in 022 MUST NOT route deposits into revenue');

  console.log('  - Verified Phase 5 receipt deduplication, XSS receipt guard, liability-only custody deposits, internal transfers, reconciliation & 3-way segregation.');
}

async function runPhase6SecurityAndIntegrationTests() {
  console.log('\n[12/12] Phase 6 End-to-End Financial & Security Integration Suite (All 17 Scenarios + RBAC + RLS + Auth UI)...');

  // --- PART A: Scenarios 1-12, 15, 16, 17 in Closed-Loop Double-Entry Accounting Simulation ---
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();

  // Seed virtual treasury supply (25,000) to also test legacy direct tasks/referrals alongside advertiser external custody
  v.post('TREASURY_ISSUANCE', 'P6-TREASURY-INIT', [
    { account_id: ids['VIRTUAL-ISSUANCE-CONTROL'], side: 'debit', amount_units: 25000, memo: 'Initial virtual treasury supply' },
    { account_id: ids['PLATFORM-TREASURY'], side: 'credit', amount_units: 25000, memo: 'Virtual treasury balance' },
  ]);
  const initialTreasury = v.bal('PLATFORM-TREASURY');
  assert.strictEqual(initialTreasury, 25000);

  const extKuraimi = v.createAccount('EXT-ACC-P6-KURAIMI', 'asset', 'debit');
  const advWallet = v.createAccount('WALLET-ADV-P6', 'wallet', 'credit');
  const workerWallet = v.createAccount('WALLET-WRK-P6', 'wallet', 'credit');
  const referrerWallet = v.createAccount('WALLET-REF-P6', 'wallet', 'credit');
  const seenNormalizedRefs = new Set<string>();

  // Helper simulating external deposit approval with normalized-ref deduplication
  const approveExternalDepositSim = (depId: string, rawRef: string, amountUnits: number) => {
    const norm = normalizeReceiptReference(rawRef);
    if (!norm) throw new Error('الرقم المرجعي إلزامي.');
    if (seenNormalizedRefs.has(norm)) {
      throw new Error(`الرقم المرجعي (${rawRef}) مستخدم ومعتمد مسبقاً.`);
    }
    const entries = buildExternalDepositApprovalEntries({
      externalFinAccountId: extKuraimi.id,
      targetFinAccountId: advWallet.id,
      amountUnits,
      externalAccountName: 'الكريمي - عهدة المعلنين',
      referenceNumber: rawRef,
      depositPurpose: 'advertiser_wallet',
    });
    const res = v.post('EXTERNAL_ADVERTISER_DEPOSIT', `EXT-DEP:${depId}`, entries);
    seenNormalizedRefs.add(norm);
    return res;
  };

  // Scenario 1 & 16: Advertiser deposits 100,000 YER -> wallet = 100,000, Treasury UNCHANGED (25,000), Revenue = 0
  approveExternalDepositSim('dep-p6-1', 'KUR-100K-001', 100000);
  assert.strictEqual(v.bal(advWallet.code), 100000, 'Scenario 1: Advertiser wallet must equal 100,000 YER');
  assert.strictEqual(v.bal(extKuraimi.code), 100000, 'External custody asset must equal 100,000 YER');
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), initialTreasury, 'Scenario 16: PLATFORM-TREASURY MUST NOT increase on external wallet top-up');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0, 'External advertiser deposit MUST NOT count as revenue');

  // Scenario 12: Duplicate receipt attempt (same normalized ref or same idempotency key) MUST be rejected
  assert.throws(
    () => approveExternalDepositSim('dep-p6-2', ' kur 100k - 001 ', 100000),
    /مستخدم ومعتمد مسبقاً/,
    'Scenario 12: Duplicate normalized receipt reference must throw'
  );
  const dupKeyRes = v.post(
    'EXTERNAL_ADVERTISER_DEPOSIT',
    'EXT-DEP:dep-p6-1',
    buildExternalDepositApprovalEntries({
      externalFinAccountId: extKuraimi.id,
      targetFinAccountId: advWallet.id,
      amountUnits: 100000,
      externalAccountName: 'الكريمي',
      referenceNumber: 'KUR-100K-001',
      depositPurpose: 'advertiser_wallet',
    })
  );
  assert.strictEqual(dupKeyRes.idempotent, true, 'Scenario 12: Idempotency key prevents second credit');
  assert.strictEqual(v.bal(advWallet.code), 100000, 'Scenario 12: Wallet remains 100,000 after duplicate approval attempt');

  // Scenario 2 & 3: Create campaign budget 10,000 + fee 2,000 (100 * 100 @ 20%) -> remaining = 88,000
  const camp1Costs = calculateCampaignFundingCosts({ rewardUnits: 100, slots: 100, feePercentage: 20 });
  assert.strictEqual(camp1Costs.budgetUnits, 10000);
  assert.strictEqual(camp1Costs.feeUnits, 2000);
  assert.strictEqual(camp1Costs.totalUnits, 12000);

  const camp1Budget = v.createAccount('CAMP-BUDGET-P6-1', 'escrow', 'credit');
  const camp1Fee = v.createAccount('CAMP-FEE-P6-1', 'escrow', 'credit');
  v.post(
    'CAMPAIGN_FUNDING_RESERVE',
    'CAMP-RES-P6-1',
    buildCampaignReserveEntries({
      title: 'حملة 1 - تجربة تطبيق',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: camp1Budget.id,
      feeEscrowAccountId: camp1Fee.id,
      budgetUnits: camp1Costs.budgetUnits,
      feeUnits: camp1Costs.feeUnits,
      feePercentage: 20,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 88000, 'Scenario 3: Remaining advertiser balance must be exactly 88,000 YER');
  assert.strictEqual(v.bal(camp1Budget.code), 10000);
  assert.strictEqual(v.bal(camp1Fee.code), 2000);

  // Scenario 4 & 5: Over-budget campaign (96,000 > 88,000) rejected with ZERO partial ledger entries
  const txCountBeforeOver = v.txById.size;
  const entryCountBeforeOver = v.allEntries.length;
  const overCosts = calculateCampaignFundingCosts({ rewardUnits: 800, slots: 100, feePercentage: 20 });
  assert.strictEqual(overCosts.totalUnits, 96000);
  const overCheck = checkCampaignBalanceSufficiency(v.bal(advWallet.code), overCosts.totalUnits);
  assert.strictEqual(overCheck.sufficient, false);
  assert.strictEqual(overCheck.deficitUnits, 8000);

  const overBudgetEscrow = v.createAccount('CAMP-BUDGET-P6-OVER', 'escrow', 'credit');
  const overFeeEscrow = v.createAccount('CAMP-FEE-P6-OVER', 'escrow', 'credit');
  assert.throws(() => {
    v.post(
      'CAMPAIGN_FUNDING_RESERVE',
      'CAMP-RES-P6-OVER',
      buildCampaignReserveEntries({
        title: 'حملة تتجاوز الرصيد',
        walletAccountId: advWallet.id,
        budgetEscrowAccountId: overBudgetEscrow.id,
        feeEscrowAccountId: overFeeEscrow.id,
        budgetUnits: overCosts.budgetUnits,
        feeUnits: overCosts.feeUnits,
        feePercentage: 20,
      })
    );
  }, /Negative balance prevented/);
  assert.strictEqual(v.bal(advWallet.code), 88000, 'Scenario 5: Balance remains 88,000');
  assert.strictEqual(v.bal(overBudgetEscrow.code), 0, 'Scenario 5: Zero partial escrow credit');
  assert.strictEqual(v.txById.size, txCountBeforeOver, 'Scenario 5: Zero partial transactions recorded');
  assert.strictEqual(v.allEntries.length, entryCountBeforeOver, 'Scenario 5: Zero partial entries recorded');

  // Scenario 6 & 7: Two concurrent campaign creations trying to use the same 88,000 balance (each costs 60,000)
  const concurrentCampA_Budget = v.createAccount('CAMP-BUDGET-P6-CONC-A', 'escrow', 'credit');
  const concurrentCampA_Fee = v.createAccount('CAMP-FEE-P6-CONC-A', 'escrow', 'credit');
  const concurrentCampB_Budget = v.createAccount('CAMP-BUDGET-P6-CONC-B', 'escrow', 'credit');
  const concurrentCampB_Fee = v.createAccount('CAMP-FEE-P6-CONC-B', 'escrow', 'credit');

  const attemptConcurrentCampaign = (key: string, bAcc: SimAccount, fAcc: SimAccount) =>
    withAdvertiserLock('adv-p6-mutex', async () => {
      await new Promise((r) => setTimeout(r, 15));
      const c = calculateCampaignFundingCosts({ rewardUnits: 500, slots: 100, feePercentage: 20 }); // 50k + 10k = 60k
      const avail = v.bal(advWallet.code);
      const check = checkCampaignBalanceSufficiency(avail, c.totalUnits);
      if (!check.sufficient) {
        throw new Error(`INSUFFICIENT_FUNDS: رصيد محفظتك (${avail}) لا يكفي (${c.totalUnits})`);
      }
      v.post(
        'CAMPAIGN_FUNDING_RESERVE',
        key,
        buildCampaignReserveEntries({
          title: `حملة متزامنة ${key}`,
          walletAccountId: advWallet.id,
          budgetEscrowAccountId: bAcc.id,
          feeEscrowAccountId: fAcc.id,
          budgetUnits: c.budgetUnits,
          feeUnits: c.feeUnits,
          feePercentage: 20,
        })
      );
      return key;
    });

  const concResults = await Promise.allSettled([
    attemptConcurrentCampaign('CONC-A', concurrentCampA_Budget, concurrentCampA_Fee),
    attemptConcurrentCampaign('CONC-B', concurrentCampB_Budget, concurrentCampB_Fee),
  ]);
  const fulfilledCount = concResults.filter((r) => r.status === 'fulfilled').length;
  const rejectedCount = concResults.filter((r) => r.status === 'rejected').length;
  assert.strictEqual(fulfilledCount, 1, 'Scenario 7: Exactly 1 concurrent campaign must succeed');
  assert.strictEqual(rejectedCount, 1, 'Scenario 7: Exactly 1 concurrent campaign must be rejected to prevent double-spend');
  assert.strictEqual(v.bal(advWallet.code), 28000, 'Scenario 7: Wallet after 1 concurrent 60k campaign must be 28,000');

  // Scenario 9: Cancel unstarted concurrent winner campaign (60,000 = 50,000 budget + 10,000 fee) BEFORE start -> full refund!
  const winnerWasA = concResults[0].status === 'fulfilled';
  const winBudget = winnerWasA ? concurrentCampA_Budget : concurrentCampB_Budget;
  const winFee = winnerWasA ? concurrentCampA_Fee : concurrentCampB_Fee;
  v.post(
    'CAMPAIGN_ESCROW_REFUND',
    'CAMP-CANCEL-BEFORE-START-P6',
    buildCampaignSettlementRefundEntries({
      title: 'إلغاء حملة قبل البدء',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: winBudget.id,
      feeEscrowAccountId: winFee.id,
      refundBudgetUnits: 50000,
      refundFeeUnits: 10000,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 88000, 'Scenario 9: Full 60,000 (budget + fee) refunded before start -> wallet back to 88,000');
  assert.strictEqual(v.bal(winBudget.code), 0);
  assert.strictEqual(v.bal(winFee.code), 0);

  // Scenario 8: Start Campaign 1 -> recognize 2,000 fee ONCE only
  const startEntries = buildCampaignFeeRecognitionEntries({
    title: 'حملة 1 - تجربة تطبيق',
    feeEscrowAccountId: camp1Fee.id,
    adsRevenueAccountId: ids['PLATFORM-REVENUE-ADS'],
    feeUnits: 2000,
  });
  const start1 = v.post('AD_REVENUE', 'CAMP-START-P6-1', startEntries);
  const startDup = v.post('AD_REVENUE', 'CAMP-START-P6-1', startEntries);
  assert.strictEqual(start1.idempotent, false);
  assert.strictEqual(startDup.idempotent, true, 'Scenario 8: Duplicate start cannot recognize fee twice');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 2000, 'Scenario 8: Platform ad revenue = 2,000 once only');
  assert.strictEqual(v.bal(camp1Fee.code), 0);

  // Worker completes 40 tasks from Campaign 1 (40 * 100 = 4,000 YER)
  v.post('TASK_REWARD_PAYOUT', 'CAMP-P6-PAYOUT-40', [
    { account_id: camp1Budget.id, side: 'debit', amount_units: 4000, memo: '40 approved campaign submissions' },
    { account_id: workerWallet.id, side: 'credit', amount_units: 4000, memo: 'Worker earnings from Campaign 1' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 4000);
  assert.strictEqual(v.bal(camp1Budget.code), 6000);

  // Scenario 10 & 11: Cancel Campaign 1 AFTER start -> fee stays in PLATFORM-REVENUE-ADS, unused 6,000 returned to wallet!
  v.post(
    'CAMPAIGN_ESCROW_REFUND',
    'CAMP-CANCEL-AFTER-START-P6-1',
    buildCampaignSettlementRefundEntries({
      title: 'حملة 1 - تسوية بعد البدء',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: camp1Budget.id,
      feeEscrowAccountId: camp1Fee.id,
      refundBudgetUnits: 6000,
      refundFeeUnits: 0,
    })
  );
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 2000, 'Scenario 10: Earned fee remains with platform');
  assert.strictEqual(v.bal(camp1Budget.code), 0, 'Scenario 10: Campaign escrow zeroed out');
  assert.strictEqual(v.bal(advWallet.code), 94000, 'Scenario 11: Unused 6,000 budget returned -> 88,000 + 6,000 = 94,000');

  // Scenario 17: Legacy tasks + referral reward (30 YER) + P2P transfer + withdrawal reserve & settle coexist cleanly
  const legacyEscrow = v.createAccount('LEGACY-TASK-ESCROW-P6', 'escrow', 'credit');
  v.post('TASK_FUNDING_ESCROW', 'LEGACY-FUND-P6', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 5000, memo: 'Legacy task escrow reserve' },
    { account_id: legacyEscrow.id, side: 'credit', amount_units: 5000, memo: 'Legacy task 10 slots x 500' },
  ]);
  v.post('TASK_REWARD_PAYOUT', 'LEGACY-PAY-P6', [
    { account_id: legacyEscrow.id, side: 'debit', amount_units: 500, memo: 'Legacy task completion' },
    { account_id: workerWallet.id, side: 'credit', amount_units: 500, memo: 'Legacy worker reward' },
  ]);
  v.post('REFERRAL_REWARD', 'LEGACY-REF-P6', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 30, memo: 'Referral reward 30 YER' },
    { account_id: referrerWallet.id, side: 'credit', amount_units: 30, memo: 'Referrer bonus on first task' },
  ]);
  v.post('WALLET_TRANSFER', 'LEGACY-P2P-P6', [
    { account_id: workerWallet.id, side: 'debit', amount_units: 500, memo: 'P2P transfer out' },
    { account_id: referrerWallet.id, side: 'credit', amount_units: 500, memo: 'P2P transfer in' },
  ]);
  v.post('WITHDRAWAL_RESERVE', 'LEGACY-WD-RES-P6', [
    { account_id: workerWallet.id, side: 'debit', amount_units: 1000, memo: 'Reserve withdrawal' },
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'credit', amount_units: 1000, memo: 'Pending payout pool' },
  ]);
  v.post('WITHDRAWAL_SETTLE', 'LEGACY-WD-SET-P6', [
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'debit', amount_units: 1000, memo: 'Settle withdrawal' },
    { account_id: ids['WITHDRAWAL-SETTLED'], side: 'credit', amount_units: 1000, memo: 'Settled payout' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 3000);
  assert.strictEqual(v.bal(referrerWallet.code), 530);

  // Scenario 15: Global balance check (Debits === Credits AND Backing === Liabilities + Revenues)
  const totalDebits = v.allEntries.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amount, 0);
  const totalCredits = v.allEntries.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amount, 0);
  assert.strictEqual(totalDebits, totalCredits, 'Scenario 15: Every ledger transaction balanced (debits === credits)');

  const totalBacking = v.bal('VIRTUAL-ISSUANCE-CONTROL') + v.bal(extKuraimi.code);
  const totalUses =
    v.bal('PLATFORM-TREASURY') +
    v.bal(advWallet.code) +
    v.bal(workerWallet.code) +
    v.bal(referrerWallet.code) +
    v.bal(legacyEscrow.code) +
    v.bal(camp1Budget.code) +
    v.bal(camp1Fee.code) +
    v.bal('WITHDRAWAL-RESERVED') +
    v.bal('WITHDRAWAL-SETTLED') +
    v.bal('PLATFORM-REVENUE-ADS');
  assert.strictEqual(totalUses, totalBacking, `Scenario 15: Closed-loop balance mismatch: ${totalUses} vs ${totalBacking}`);
  assert.strictEqual(v.bal('PLATFORM-TREASURY'), 19970, 'Scenario 16: Treasury unaffected by 100k advertiser custody (25,000 - 5,000 - 30)');

  // --- PART B: Scenarios 13 & 14 (Real Express HTTP RBAC Enforcement via ephemeral server) ---
  const origGetUser = supabaseServer.auth.getUser.bind(supabaseServer.auth);
  const origFindUser = supabaseDb.findUserById.bind(supabaseDb);
  const testUsers: Record<string, any> = {
    'tok-adv-active': {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'adv-active@test.local',
      role: 'advertiser',
      status: 'active',
      fullName: 'معلن معتمد',
      phone: '771111111',
    },
    'tok-adv-pending': {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'adv-pending@test.local',
      role: 'advertiser',
      status: 'pending',
      fullName: 'معلن قيد المراجعة',
      phone: '772222222',
    },
    'tok-worker-active': {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'worker@test.local',
      role: 'user',
      status: 'active',
      fullName: 'مستخدم منفذ',
      phone: '773333333',
    },
  };

  (supabaseServer.auth as any).getUser = async (token: string) => {
    const u = testUsers[token];
    if (!u) return { data: { user: null }, error: { message: 'invalid token' } };
    return {
      data: {
        user: {
          id: u.id,
          email: u.email,
          created_at: new Date().toISOString(),
          user_metadata: { full_name: u.fullName, phone: u.phone, role: u.role },
        },
      },
      error: null,
    };
  };
  (supabaseDb as any).findUserById = async (id: string) => {
    return Object.values(testUsers).find((u) => u.id === id) || null;
  };

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Scenario 13: Active Advertiser & Worker blocked (403) from ALL admin endpoints
    const adminRoutesForRbac: Array<[string, string]> = [
      ['GET', '/api/admin/treasury'],
      ['GET', '/api/admin/finance/external-accounts'],
      ['POST', '/api/admin/finance/external-accounts'],
      ['POST', '/api/admin/finance/external-deposits/00000000-0000-0000-0000-000000000000/approve'],
      ['GET', '/api/admin/campaigns'],
      ['POST', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/start'],
    ];
    for (const tok of ['tok-adv-active', 'tok-adv-pending', 'tok-worker-active']) {
      for (const [method, routePath] of adminRoutesForRbac) {
        const resp = await fetch(`${baseUrl}${routePath}`, {
          method,
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({}) : undefined,
        });
        assert.strictEqual(
          resp.status,
          403,
          `Scenario 13: ${tok} calling ${method} ${routePath} must return 403, got ${resp.status}`
        );
      }
    }

    // Scenario 14: Unapproved (pending) advertiser & worker blocked (403) from creating/starting/settling campaigns
    const advertiserWriteRoutes: Array<[string, string]> = [
      ['POST', '/api/advertiser/campaigns'],
      ['POST', '/api/advertiser/campaigns/00000000-0000-0000-0000-000000000000/start'],
      ['POST', '/api/advertiser/campaigns/00000000-0000-0000-0000-000000000000/settle'],
      ['POST', '/api/advertiser/logo/signed-url'],
    ];
    for (const tok of ['tok-adv-pending', 'tok-worker-active']) {
      for (const [method, routePath] of advertiserWriteRoutes) {
        const resp = await fetch(`${baseUrl}${routePath}`, {
          method,
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.strictEqual(
          resp.status,
          403,
          `Scenario 14: ${tok} calling ${method} ${routePath} must return 403, got ${resp.status}`
        );
      }
    }

    // Also verify createAdvertiserCampaign server method rejects pending advertiser before touching DB
    let pendingErr = '';
    try {
      await supabaseDb.createAdvertiserCampaign({
        advertiserId: testUsers['tok-adv-pending'].id,
        title: 'حملة غير معتمد',
        description: 'محاولة إنشاء قبل الاعتماد',
        rewardUnits: 100,
        slots: 10,
      });
    } catch (e: any) {
      pendingErr = String(e?.message || '');
    }
    assert.ok(pendingErr.includes('قيد المراجعة'), `Scenario 14 server check must reject pending advertiser, got: ${pendingErr}`);

    // Verify receipt image access restriction: advertiser/worker cannot read external-receipts/* signed URLs (403)
    const receiptResp = await fetch(`${baseUrl}/api/storage/signed-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-adv-active', 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: 'external-receipts/admin/test.png' }),
    });
    assert.strictEqual(receiptResp.status, 403, 'Advertiser must get 403 on admin external-receipts/* signed-url');
  } finally {
    (supabaseServer.auth as any).getUser = origGetUser;
    (supabaseDb as any).findUserById = origFindUser;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // --- PART C: RLS, SECURITY DEFINER RPC & Auth UI Routing Audit ---
  const sqlFiles = ['013_financial_ledger_compatibility_and_task_accounting.sql', '014_referral_system_and_atomic_rewards.sql', '020_advertiser_campaigns_and_fee_escrow.sql', '022_external_accounts_and_advertiser_custody.sql'];
  for (const f of sqlFiles) {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf8');
    assert.ok(content.includes('ROW LEVEL SECURITY'), `${f} must enforce ROW LEVEL SECURITY`);
    assert.ok(content.includes('SECURITY DEFINER'), `${f} must mark atomic RPCs SECURITY DEFINER`);
    assert.ok(content.includes('search_path'), `${f} must pin search_path on SECURITY DEFINER functions`);
    assert.ok(content.includes('REVOKE ALL'), `${f} must revoke public/anon privileges`);
  }

  // Verify AuthModal hides account-type switcher in login mode & keeps it strictly in register mode
  const authModalSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/auth/AuthModal.tsx'), 'utf8');
  assert.ok(authModalSrc.includes("mode === 'register' && (") && !authModalSrc.includes("mode !== 'owner' && (\n          <div className=\"grid grid-cols-2"), 'AuthModal must show user/advertiser switcher ONLY in register mode');
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('kasb:auth_success') && appSrc.includes("loggedUser.role === 'advertiser'"), 'App.tsx must auto-redirect user to their role workspace upon login');

  console.log('  - Verified all 17 Phase 6 financial & security scenarios, Express 403 RBAC guards, SQL RLS/RPC permissions & AuthModal/App role routing.');
}

function runDirectYerUnificationAndMigration032Tests() {
  console.log('\n[13/13] Direct YER Unification (Zero Micro-Unit Scaling, 6-Decimal Precision & Migration 032 Audit)...');

  // Scenario 9: Exact 6-decimal formatting, parsing, and ultra-micro ClixWall USD split
  assert.strictEqual(formatYer(25), '25');
  assert.strictEqual(formatYer(0.224), '0.224');
  assert.strictEqual(formatYer(0.096), '0.096');
  assert.strictEqual(formatYer(14.448), '14.448');
  assert.strictEqual(formatYer(0.000001), '0.000001');
  assert.strictEqual(formatYer(10000), '10,000');
  assert.strictEqual(parseMoneyStrict('0.000001'), 0.000001);
  assert.throws(() => parseMoneyStrict('0.0000001'), /6 منازل عشرية/);

  const clixTiny = calculateClixWallRevenueSplit({ totalUsd: '0.000001' });
  assert.strictEqual(clixTiny.totalYer, 0.0016);
  assert.strictEqual(clixTiny.userYer, 0.00112);
  assert.strictEqual(clixTiny.publisherYer, 0.00048);
  assert.strictEqual(addMoney(clixTiny.userYer, clixTiny.publisherYer), clixTiny.totalYer);

  // Scenario 2: ClixWall $0.00020 offer -> 0.320 YER total = 0.224 YER user (70%) + 0.096 YER publisher (30%)
  const clixOffer = calculateClixWallRevenueSplit({ totalUsd: '0.00020' });
  assert.strictEqual(clixOffer.totalYer, 0.32);
  assert.strictEqual(clixOffer.userYer, 0.224);
  assert.strictEqual(clixOffer.publisherYer, 0.096);

  // Scenario 3: 15 YER P2P transfer -> exact 3% = 0.45 fee + 14.55 net (no 1-YER floor)
  const trf15 = calcWalletTransferBreakdown(15);
  assert.strictEqual(trf15.amount, 15);
  assert.strictEqual(trf15.fee, 0.45);
  assert.strictEqual(trf15.net, 14.55);

  // Closed-loop simulation of direct-YER Scenarios 1, 2, 3, 4, 5, 6, 10
  const v = new LedgerConsistencyVerifier();
  const ids = v.accountIdsMap();
  const clixRecv = v.createAccount('CLIXWALL-RECEIVABLE', 'asset', 'debit');
  const clixPubRev = v.createAccount('PLATFORM-REVENUE-CLIXWALL', 'revenue', 'credit');
  const extKuraimi = v.createAccount('EXT-KURAIMI-YER', 'asset', 'debit');
  const taskEscrow = v.createAccount('TASK-ESCROW-25', 'escrow', 'credit');
  const workerWallet = v.createAccount('WALLET-WORKER-YER', 'wallet', 'credit');
  const friendWallet = v.createAccount('WALLET-FRIEND-YER', 'wallet', 'credit');
  const advWallet = v.createAccount('WALLET-ADV-YER', 'wallet', 'credit');
  const campBudget = v.createAccount('CAMP-BUDGET-50', 'escrow', 'credit');
  const campFee = v.createAccount('CAMP-FEE-10', 'escrow', 'credit');

  // Seed 100 YER treasury
  v.post('TREASURY_ISSUANCE', 'YER-INIT', [
    { account_id: ids['VIRTUAL-ISSUANCE-CONTROL'], side: 'debit', amount_units: 100, memo: 'Treasury issuance' },
    { account_id: ids['PLATFORM-TREASURY'], side: 'credit', amount_units: 100, memo: 'Treasury balance' },
  ]);

  // Scenario 1: Task reward 25 YER directly (never 25,000,000)
  v.post('task_budget_reservation', 'YER-FUND-25', [
    { account_id: ids['PLATFORM-TREASURY'], side: 'debit', amount_units: 25, memo: 'Reserve 25 YER' },
    { account_id: taskEscrow.id, side: 'credit', amount_units: 25, memo: 'Escrow 25 YER' },
  ]);
  v.post('TASK_REWARD_PAYOUT', 'YER-PAY-25', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 25, memo: 'Task payout 25 YER' },
    { account_id: workerWallet.id, side: 'credit', amount_units: 25, memo: 'Worker earned 25 YER' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 25);

  // Scenario 2: ClixWall $0.00020 -> 0.224 user + 0.096 PLATFORM-REVENUE-CLIXWALL
  v.post('CLIXWALL_REWARD', 'YER-CLIX-1', [
    { account_id: clixRecv.id, side: 'debit', amount_units: clixOffer.totalYer, memo: 'ClixWall receivable 0.32 YER' },
    { account_id: workerWallet.id, side: 'credit', amount_units: clixOffer.userYer, memo: 'ClixWall 70% user 0.224 YER' },
    { account_id: clixPubRev.id, side: 'credit', amount_units: clixOffer.publisherYer, memo: 'ClixWall 30% publisher 0.096 YER' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 25.224);
  assert.strictEqual(v.bal(clixPubRev.code), 0.096);
  assert.strictEqual(v.bal(clixRecv.code), 0.32);

  // Scenario 3: 15 YER transfer -> 0.45 fee + 14.55 net
  v.post('WALLET_TRANSFER', 'YER-TRF-15', [
    { account_id: workerWallet.id, side: 'debit', amount_units: trf15.amount, memo: 'Transfer 15 YER' },
    { account_id: friendWallet.id, side: 'credit', amount_units: trf15.net, memo: 'Net 14.55 YER' },
    { account_id: ids['PLATFORM-REVENUE-SERVICES'], side: 'credit', amount_units: trf15.fee, memo: '3% fee 0.45 YER' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 10.224);
  assert.strictEqual(v.bal(friendWallet.code), 14.55);

  // Scenario 4: 10.224 YER withdrawal (fractional direct YER reserve & settle)
  v.post('WITHDRAWAL_REQUEST', 'YER-WD-RES', [
    { account_id: workerWallet.id, side: 'debit', amount_units: 10.224, memo: 'Reserve 10.224 YER withdrawal' },
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'credit', amount_units: 10.224, memo: 'Hold 10.224 YER' },
  ]);
  v.post('WITHDRAWAL_PAYOUT', 'YER-WD-PAY', [
    { account_id: ids['WITHDRAWAL-RESERVED'], side: 'debit', amount_units: 10.224, memo: 'Settle withdrawal' },
    { account_id: ids['WITHDRAWAL-SETTLED'], side: 'credit', amount_units: 10.224, memo: 'Paid 10.224 YER' },
  ]);
  assert.strictEqual(v.bal(workerWallet.code), 0);

  // Scenario 5: 100 YER advertiser external deposit
  v.post(
    'EXTERNAL_ADVERTISER_DEPOSIT',
    'YER-DEP-100',
    buildExternalDepositApprovalEntries({
      externalFinAccountId: extKuraimi.id,
      targetFinAccountId: advWallet.id,
      amountUnits: 100,
      externalAccountName: 'الكريمي',
      referenceNumber: 'YER-DEP-REF-100',
      depositPurpose: 'advertiser_wallet',
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 100);
  assert.strictEqual(v.bal(extKuraimi.code), 100);

  // Scenario 6: 50 YER campaign reserve + 20% fee (10 YER)
  const campCost = calculateCampaignFeePolicyCosts({ rewardUnits: 5, slots: 10, fallbackFeePercentage: 20 });
  assert.strictEqual(campCost.budgetUnits, 50);
  assert.strictEqual(campCost.feeUnits, 10);
  assert.strictEqual(campCost.totalUnits, 60);

  v.post(
    'CAMPAIGN_FUNDING_RESERVE',
    'YER-CAMP-RES-50',
    buildCampaignReserveEntries({
      title: 'حملة 50 ريال',
      walletAccountId: advWallet.id,
      budgetEscrowAccountId: campBudget.id,
      feeEscrowAccountId: campFee.id,
      budgetUnits: campCost.budgetUnits,
      feeUnits: campCost.feeUnits,
      feePercentage: 20,
    })
  );
  assert.strictEqual(v.bal(advWallet.code), 40);
  assert.strictEqual(v.bal(campBudget.code), 50);
  assert.strictEqual(v.bal(campFee.code), 10);

  // Scenario 10: Verify Migration 032 SQL invariants & global trial balance
  let totalDebits = new Decimal(0);
  let totalCredits = new Decimal(0);
  for (const e of v.allEntries) {
    if (e.side === 'debit') totalDebits = totalDebits.plus(String(e.amount));
    else totalCredits = totalCredits.plus(String(e.amount));
  }
  assert.ok(totalDebits.equals(totalCredits), `Trial balance must match: ${totalDebits.toFixed(6)} != ${totalCredits.toFixed(6)}`);

  const sql032 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/032_unify_yer_currency_and_historical_clixwall_reconciliation.sql'),
    'utf8'
  );
  assert.ok(sql032.includes('PLATFORM-REVENUE-CLIXWALL'), 'Migration 032 must seed PLATFORM-REVENUE-CLIXWALL');
  assert.ok(sql032.includes('financial_migration_032_backup'), 'Migration 032 must snapshot backup table');
  assert.ok(sql032.includes('ROLLBACK SQL'), 'Migration 032 must document rollback SQL');
  assert.ok(sql032.includes('14.448000') && sql032.includes('0.640000') && sql032.includes('0.192000'), 'Migration 032 must reconcile exact ClixWall historical balances');
  assert.ok(sql032.includes('REVOKE ALL ON FUNCTION public.process_clixwall_postback') && sql032.includes('TO service_role'), 'Migration 032 must restrict process_clixwall_postback strictly to service_role');
  assert.ok(!sql032.includes('1000000'), 'Migration 032 must not contain * 1000000 scaling');

  console.log('  - All direct-YER scenarios (25 YER task, 0.224/0.096 ClixWall, 15 YER 3% transfer, 100 YER deposit, 50+10 YER campaign, 0.000001 precision) & Migration 032 audit passed.');
}

async function main() {
  console.log('=== YEMEN MICRO-TASKS FINANCIAL & REFERRAL VERIFICATION SUITE ===');
  await runLiveReadOnlyProbe();
  await runHttpRouteAuthAndReferralIntegrationTests();
  runServerBuilderTests();
  runEndToEndAccountingFlowTests();
  runAtomicitySegregationAndCommissionTests();
  runReferralLifecycleTests();
  runMigration013And014SecurityAuditTests();
  await runReadOnlyServerReferralProbe();
  runPhase3CampaignFundingAndAccountingTests();
  runPhase4AdvertiserIdentityAndUiTests();
  runPhase5ExternalAccountsAndSegregationTests();
  await runPhase6SecurityAndIntegrationTests();
  runDirectYerUnificationAndMigration032Tests();
  console.log('\n=== VERIFICATION COMPLETED SUCCESSFULLY (ALL 13 SUITES PASSED) ===');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
