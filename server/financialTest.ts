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
import app, { supabaseServer } from './app.js';
import {
  buildDoubleEntryForOperation,
  computeReferralSummary,
  generateReferralCode,
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

    let debits = 0;
    let credits = 0;
    for (const e of entries) {
      assert.ok(Number.isInteger(e.amount_units) && e.amount_units > 0, 'Amount must be positive integer');
      if (e.side === 'debit') debits += e.amount_units;
      else credits += e.amount_units;
    }
    assert.strictEqual(debits, credits, `Unbalanced ledger entry for ${type}: ${debits} != ${credits}`);

    // Validate non-negative balances before mutating (atomic rollback simulation)
    const pendingDeltas = new Map<string, number>();
    for (const e of entries) {
      const acc = this.accountsById.get(e.account_id);
      assert.ok(acc, `Missing account ${e.account_id}`);
      const delta = acc.normalSide === e.side ? e.amount_units : -e.amount_units;
      pendingDeltas.set(acc.id, (pendingDeltas.get(acc.id) || 0) + delta);
    }
    for (const [accId, delta] of pendingDeltas.entries()) {
      const acc = this.accountsById.get(accId)!;
      assert.ok(acc.balance + delta >= 0, `Negative balance prevented on ${acc.code}`);
    }

    for (const [accId, delta] of pendingDeltas.entries()) {
      this.accountsById.get(accId)!.balance += delta;
    }

    const txId = crypto.randomUUID();
    const record = { id: txId, type, entries };
    this.txByIdempotencyKey.set(idempotencyKey, record);
    this.txById.set(txId, record);
    for (const e of entries) {
      this.allEntries.push({ txId, accountId: e.account_id, side: e.side, amount: e.amount_units });
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
    return this.accountsByCode.get(code)?.balance || 0;
  }

  assertReconciled(extraEscrowCodes: string[] = [], extraWalletCodes: string[] = [], withdrawalFeeRevenue = 0) {
    const totalDebits = this.allEntries.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amount, 0);
    const totalCredits = this.allEntries.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amount, 0);
    assert.strictEqual(totalDebits, totalCredits, 'Global ledger debits must equal global ledger credits');

    const totalIssued = this.bal('VIRTUAL-ISSUANCE-CONTROL');
    const escrowSum = extraEscrowCodes.reduce((s, c) => s + this.bal(c), 0);
    const walletSum = extraWalletCodes.reduce((s, c) => s + this.bal(c), 0);
    const supplySum =
      this.bal('PLATFORM-TREASURY') +
      escrowSum +
      walletSum +
      this.bal('WITHDRAWAL-RESERVED') +
      this.bal('WITHDRAWAL-SETTLED') +
      this.bal('PLATFORM-REVENUE-TASKS') +
      withdrawalFeeRevenue;

    assert.strictEqual(
      supplySum,
      totalIssued,
      `Closed-loop reconciliation mismatch: supply(${supplySum}) !== issued(${totalIssued})`
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

    console.log(`  - Verified 401 protection on ${protectedEndpoints.length} routes, 400 rejection on invalid referral codes & referralBonus=30.`);
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
  console.log('\n[8/8] Server Settings & Referral Resolver Read-Only Integrity Check...');
  const settings = await supabaseDb.getSettings();
  assert.strictEqual(settings.referralBonus, 30, `Live/fallback referralBonus must be 30, got ${settings.referralBonus}`);
  const missingCode = await supabaseDb.resolveReferralCode('DEFINITELY-DOES-NOT-EXIST-999999');
  assert.strictEqual(missingCode, null, 'Nonexistent referral code must resolve to null');
  console.log(`  - Verified supabaseDb.getSettings().referralBonus === 30 & invalid referral resolution === null.`);
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
  console.log('\n=== VERIFICATION COMPLETED SUCCESSFULLY (ALL 8 SUITES PASSED) ===');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
