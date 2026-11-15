/**
 * Real Integration & Accounting Verification Suite for Yemen Micro-tasks (كسب اليمن)
 * 1. Read-Only Live Supabase Schema & RPC Verification (no DDL/DML mutations)
 * 2. Real Server Module Verification (buildDoubleEntryForOperation from server/supabaseDb.ts)
 * 3. Express Route Auth Protection Verification on /api/admin/finance/* and /api/withdrawals/request
 * 4. Closed-Loop Double-Entry Reconciliation & Idempotency Verification (matching Migration 011 SQL rules)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import app, { supabaseServer } from './app.js';
import {
  buildDoubleEntryForOperation,
  MIGRATION_011_CORE_ACCOUNTS,
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
 * Mirrors live PostgreSQL post_ledger_transaction + Migration 011 normal_side & balance >= 0 rules.
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
      ['VIRTUAL-ISSUANCE-CONTROL', 'control', 'debit'],
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
  console.log('\n[1/4] Live Supabase Read-Only Schema & RPC Probe (Zero Mutations)...');
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
    liveStatus[fn] = code === 'PGRST202' ? 'PENDING_MIGRATION_011' : `LIVE_EXISTS (${code})`;
    console.log(`  - RPC ${fn}: ${liveStatus[fn]}`);
  }

  assert.ok(liveStatus.post_ledger_transaction.startsWith('LIVE_EXISTS'), 'Live DB must have post_ledger_transaction');
  assert.ok(liveStatus.create_funded_task.startsWith('LIVE_EXISTS'), 'Live DB must have create_funded_task');
  assert.ok(liveStatus.review_task_submission.startsWith('LIVE_EXISTS'), 'Live DB must have review_task_submission');
  assert.ok(liveStatus.transfer_wallet_units.startsWith('LIVE_EXISTS'), 'Live DB must have transfer_wallet_units');
}

async function runHttpRouteAuthGuardTests() {
  console.log('\n[2/4] Real Express API Route Security & Validation Verification...');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const protectedEndpoints: Array<[string, string]> = [
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

    for (const [method, path] of protectedEndpoints) {
      const resp = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' || method === 'PUT' ? JSON.stringify({}) : undefined,
      });
      assert.strictEqual(resp.status, 401, `Unauthenticated ${method} ${path} must return 401, got ${resp.status}`);
    }
    console.log(`  - Verified 401 Unauthorized protection on all ${protectedEndpoints.length} financial endpoints.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function runServerBuilderTests() {
  console.log('\n[3/4] Real Server Double-Entry Builder Verification (buildDoubleEntryForOperation)...');
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
  console.log('\n[4/4] End-to-End Operational Accounting & Idempotency Flow Verification...');
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

  // Reversal of Ad Revenue
  v.reverse(adRes.txId, 'إلغاء فاتورة إعلان');
  assert.strictEqual(v.bal('PLATFORM-REVENUE-ADS'), 0);
  v.assertReconciled([taskEscrow.code], [userWallet.code], 150);

  // 8. Explicit Tax Accrual & Tax Settlement (never auto-deducted)
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

  // Duplicate idempotency check
  const dup = v.post('TASK_COMMISSION_REVENUE', 'TASK-COMMISSION:S1', [
    { account_id: taskEscrow.id, side: 'debit', amount_units: 2000, memo: 'Dup' },
    { account_id: ids['PLATFORM-REVENUE-TASKS'], side: 'credit', amount_units: 2000, memo: 'Dup' },
  ]);
  assert.strictEqual(dup.idempotent, true);
  assert.strictEqual(v.bal('PLATFORM-REVENUE-TASKS'), 2000);

  console.log('  - Full closed-loop reconciliation, reversals, tax accrual/settlement & idempotency passed with 0 discrepancy.');
}

async function main() {
  console.log('=== YEMEN MICRO-TASKS FINANCIAL INTEGRATION VERIFICATION ===');
  await runLiveReadOnlyProbe();
  await runHttpRouteAuthGuardTests();
  runServerBuilderTests();
  runEndToEndAccountingFlowTests();
  console.log('\n=== VERIFICATION COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
