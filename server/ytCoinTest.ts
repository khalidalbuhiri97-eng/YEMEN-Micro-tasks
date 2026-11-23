/**
 * Automated Verification Suite for YT Coin Balanced Double-Entry Economy
 * 1. Shared Integer Sub-Unit Math & Validation (1 YT = 1,000 parts, BIGINT, max 3 decimals)
 * 2. DB-Faithful Double-Entry Journal Verifier & Atomic Rollback Check (500, 10, P2P, Admin)
 * 3. Historical Single-Sided / Unbalanced Repair Idempotency Check (No Double Rewards)
 * 4. Real Express API & S2S Anti-Fraud Route Guards
 * 5. Static Isolation Check (Zero edits to wallets / financial_accounts / ledger_transactions / ledger_entries)
 * 6. Optional Read-Only Live Supabase Diagnostic (if .env credentials are present)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import app, { supabaseServer } from './app.js';
import {
  YT_MAX_SUPPLY_UNITS,
  YT_MAX_SUPPLY_YT,
  YT_SUBUNITS_PER_YT,
  YT_TOKENOMICS_ALLOCATIONS,
  assertBalancedYtJournalEntries,
  formatPartsLabel,
  formatYt,
  formatYtUnits,
  unitsToYt,
  ytToIntegerParts,
  ytToUnitsStrict,
  type YtJournalEntryDraft,
} from '../shared/ytCoin.js';

interface SimJournalTx {
  id: string;
  txType: string;
  reference: string;
  idempotencyKey: string | null;
  status: 'posted' | 'voided' | 'reversed';
  totalDebitUnits: number;
  totalCreditUnits: number;
}

interface SimJournalEntry {
  id: string;
  journalTxId: string;
  accountScope: 'treasury' | 'user' | 'control';
  accountKey: string;
  side: 'debit' | 'credit';
  amountUnits: number;
}

interface SimLedgerRow {
  id: string;
  userId: string;
  eventType: string;
  amountUnits: number;
  balanceAfterUnits: number | null;
  journalTxId: string | null;
  reference: string;
  createdAt: number;
}

/**
 * Mirrors 20261125000000_yt_coin_balanced_journal_and_repair.sql rules:
 * - Every YT Coin operation posts a balanced double-entry journal (SUM(debit) = SUM(credit) > 0)
 * - Transactional rollback on any validation/imbalance failure (zero partial mutation)
 */
class YtCoinJournalVerifier {
  config = {
    unitScale: 1000,
    maxSupplyUnits: YT_MAX_SUPPLY_UNITS, // 100M YT = 100B parts
    miningEnabled: true,
    baseRewardUnits: 500, // 0.5 YT
    tapRewardUnits: 10, // 0.01 YT
    adClickRewardUnits: 10, // 0.01 YT
    adViewRewardUnits: 10, // 0.01 YT
    dailyTapLimit: 1000,
    dailyAdLimit: 20,
    dailyCapUnits: 1_000_000, // 1,000 YT/day initial cap
  };

  treasuries = new Map<
    string,
    { allocatedUnits: number; balanceUnits: number; distributedUnits: number; isLocked: boolean; approved: boolean }
  >();
  accounts = new Map<
    string,
    { userId: string; walletAddress: string; balanceUnits: number; lifetimeEarnedUnits: number; adEarnedUnits: number }
  >();
  dailyClaimed = new Set<string>(); // `${userId}:${date}`
  dailyTaps = new Map<string, number>();
  dailyAds = new Map<string, number>();
  adEvents = new Set<string>(); // `${networkKey}:${externalEventId}`
  dailyGlobalPaidUnits = new Map<string, number>();

  journalTransactions: SimJournalTx[] = [];
  journalEntries: SimJournalEntry[] = [];
  ledger: SimLedgerRow[] = [];

  constructor() {
    for (const spec of YT_TOKENOMICS_ALLOCATIONS) {
      this.treasuries.set(spec.key, {
        allocatedUnits: spec.allocationUnits,
        balanceUnits: spec.allocationUnits,
        distributedUnits: 0,
        isLocked: spec.locked,
        approved: spec.key === 'YT-USER-REWARDS',
      });
    }
  }

  private snapshot() {
    return JSON.stringify({
      treasuries: Array.from(this.treasuries.entries()),
      accounts: Array.from(this.accounts.entries()),
      dailyClaimed: Array.from(this.dailyClaimed),
      dailyTaps: Array.from(this.dailyTaps.entries()),
      dailyAds: Array.from(this.dailyAds.entries()),
      adEvents: Array.from(this.adEvents),
      dailyGlobalPaidUnits: Array.from(this.dailyGlobalPaidUnits.entries()),
      journalTransactions: this.journalTransactions,
      journalEntries: this.journalEntries,
      ledger: this.ledger,
    });
  }

  private restore(snap: string) {
    const parsed = JSON.parse(snap);
    this.treasuries = new Map(parsed.treasuries);
    this.accounts = new Map(parsed.accounts);
    this.dailyClaimed = new Set(parsed.dailyClaimed);
    this.dailyTaps = new Map(parsed.dailyTaps);
    this.dailyAds = new Map(parsed.dailyAds);
    this.adEvents = new Set(parsed.adEvents);
    this.dailyGlobalPaidUnits = new Map(parsed.dailyGlobalPaidUnits);
    this.journalTransactions = parsed.journalTransactions;
    this.journalEntries = parsed.journalEntries;
    this.ledger = parsed.ledger;
  }

  ensureAccount(userId: string) {
    let acc = this.accounts.get(userId);
    if (!acc) {
      acc = {
        userId,
        walletAddress: `yt1${userId.replace(/-/g, '')}`,
        balanceUnits: 0,
        lifetimeEarnedUnits: 0,
        adEarnedUnits: 0,
      };
      this.accounts.set(userId, acc);
    }
    return acc;
  }

  postJournalTransaction(
    txType: string,
    reference: string,
    idempotencyKey: string | null,
    entries: YtJournalEntryDraft[]
  ): string {
    if (idempotencyKey) {
      const existing = this.journalTransactions.find(
        (t) => t.idempotencyKey === idempotencyKey && t.status === 'posted'
      );
      if (existing) return existing.id;
    }

    const snap = this.snapshot();
    try {
      const check = assertBalancedYtJournalEntries(entries);
      const txId = crypto.randomUUID();
      this.journalTransactions.push({
        id: txId,
        txType,
        reference,
        idempotencyKey,
        status: 'posted',
        totalDebitUnits: check.totalDebitUnits,
        totalCreditUnits: check.totalCreditUnits,
      });
      for (const e of entries) {
        this.journalEntries.push({
          id: crypto.randomUUID(),
          journalTxId: txId,
          accountScope: e.accountScope,
          accountKey: e.accountKey,
          side: e.side,
          amountUnits: e.amountUnits,
        });
      }
      this.assertAllPostedBalanced();
      return txId;
    } catch (err) {
      // Full atomic rollback
      this.restore(snap);
      throw err;
    }
  }

  claimDailyMining(userId: string, date = '2026-11-22'): { journalTxId: string; amountUnits: number } {
    const snap = this.snapshot();
    try {
      const key = `${userId}:${date}`;
      if (this.dailyClaimed.has(key)) {
        throw new Error('already_claimed');
      }
      const reward = this.config.baseRewardUnits; // 500 parts
      const treasury = this.treasuries.get('YT-USER-REWARDS')!;
      if (treasury.isLocked || !treasury.approved || treasury.balanceUnits < reward) {
        throw new Error('treasury_insufficient');
      }
      const paidToday = this.dailyGlobalPaidUnits.get(date) ?? 0;
      if (paidToday + reward > this.config.dailyCapUnits) {
        throw new Error('daily_cap_reached');
      }

      const acc = this.ensureAccount(userId);
      treasury.balanceUnits -= reward;
      treasury.distributedUnits += reward;
      acc.balanceUnits += reward;
      acc.lifetimeEarnedUnits += reward;
      this.dailyClaimed.add(key);
      this.dailyGlobalPaidUnits.set(date, paidToday + reward);

      const ref = `YT-DAILY:${userId}:${date}`;
      const jtxId = this.postJournalTransaction('daily_mining_reward', ref, ref, [
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: reward },
        { accountScope: 'user', accountKey: userId, userId, side: 'credit', amountUnits: reward },
      ]);

      this.ledger.push({
        id: crypto.randomUUID(),
        userId,
        eventType: 'daily_mining_reward',
        amountUnits: reward,
        balanceAfterUnits: acc.balanceUnits,
        journalTxId: jtxId,
        reference: ref,
        createdAt: Date.now(),
      });

      return { journalTxId: jtxId, amountUnits: reward };
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }

  claimTapMining(userId: string, taps = 1, date = '2026-11-22'): { journalTxId: string; amountUnits: number } {
    const snap = this.snapshot();
    try {
      if (!Number.isInteger(taps) || taps < 1 || taps > 200) throw new Error('invalid_taps');
      const tapKey = `${userId}:${date}`;
      const usedTaps = this.dailyTaps.get(tapKey) ?? 0;
      if (usedTaps >= this.config.dailyTapLimit) throw new Error('daily_tap_limit_reached');
      const effectiveTaps = Math.min(taps, this.config.dailyTapLimit - usedTaps);
      const reward = effectiveTaps * this.config.tapRewardUnits; // 10 parts * taps

      const treasury = this.treasuries.get('YT-USER-REWARDS')!;
      if (treasury.balanceUnits < reward) throw new Error('treasury_insufficient');

      const acc = this.ensureAccount(userId);
      treasury.balanceUnits -= reward;
      treasury.distributedUnits += reward;
      acc.balanceUnits += reward;
      acc.lifetimeEarnedUnits += reward;
      this.dailyTaps.set(tapKey, usedTaps + effectiveTaps);

      const ref = `YT-TAP:${userId}:${crypto.randomUUID()}`;
      const jtxId = this.postJournalTransaction('tap_mining_reward', ref, ref, [
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: reward },
        { accountScope: 'user', accountKey: userId, userId, side: 'credit', amountUnits: reward },
      ]);

      this.ledger.push({
        id: crypto.randomUUID(),
        userId,
        eventType: 'tap_mining_reward',
        amountUnits: reward,
        balanceAfterUnits: acc.balanceUnits,
        journalTxId: jtxId,
        reference: ref,
        createdAt: Date.now(),
      });

      return { journalTxId: jtxId, amountUnits: reward };
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }

  processVerifiedAdEvent(
    networkKey: string,
    externalEventId: string,
    userId: string,
    eventType: 'click' | 'view',
    date = '2026-11-22'
  ): { status: 'credited' | 'duplicate'; journalTxId?: string; amountUnits: number } {
    const dedupKey = `${networkKey}:${externalEventId}`;
    if (this.adEvents.has(dedupKey)) {
      return { status: 'duplicate', amountUnits: 0 };
    }

    const snap = this.snapshot();
    try {
      const adKey = `${userId}:${date}`;
      const adsToday = this.dailyAds.get(adKey) ?? 0;
      if (adsToday >= this.config.dailyAdLimit) throw new Error('daily_ad_limit_reached');

      const reward = eventType === 'click' ? this.config.adClickRewardUnits : this.config.adViewRewardUnits; // 10 parts
      const treasury = this.treasuries.get('YT-USER-REWARDS')!;
      if (treasury.balanceUnits < reward) throw new Error('treasury_insufficient');

      const acc = this.ensureAccount(userId);
      treasury.balanceUnits -= reward;
      treasury.distributedUnits += reward;
      acc.balanceUnits += reward;
      acc.lifetimeEarnedUnits += reward;
      acc.adEarnedUnits += reward;
      this.dailyAds.set(adKey, adsToday + 1);
      this.adEvents.add(dedupKey);

      const ref = `YT-AD:${networkKey}:${externalEventId}`;
      const txType = eventType === 'click' ? 'ad_click_reward' : 'ad_view_reward';
      const jtxId = this.postJournalTransaction(txType, ref, ref, [
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: reward },
        { accountScope: 'user', accountKey: userId, userId, side: 'credit', amountUnits: reward },
      ]);

      this.ledger.push({
        id: crypto.randomUUID(),
        userId,
        eventType: txType,
        amountUnits: reward,
        balanceAfterUnits: acc.balanceUnits,
        journalTxId: jtxId,
        reference: ref,
        createdAt: Date.now(),
      });

      return { status: 'credited', journalTxId: jtxId, amountUnits: reward };
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }

  transferP2P(senderId: string, recipientId: string, amountUnits: number): { journalTxId: string } {
    const snap = this.snapshot();
    try {
      if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) throw new Error('invalid_amount');
      if (senderId === recipientId) throw new Error('self_transfer');
      const sender = this.ensureAccount(senderId);
      const recipient = this.ensureAccount(recipientId);
      if (sender.balanceUnits < amountUnits) throw new Error('insufficient_balance');

      sender.balanceUnits -= amountUnits;
      recipient.balanceUnits += amountUnits;

      const ref = `YT-XFER:${crypto.randomUUID()}`;
      const jtxId = this.postJournalTransaction('p2p_transfer', ref, ref, [
        { accountScope: 'user', accountKey: senderId, userId: senderId, side: 'debit', amountUnits },
        { accountScope: 'user', accountKey: recipientId, userId: recipientId, side: 'credit', amountUnits },
      ]);

      this.ledger.push(
        {
          id: crypto.randomUUID(),
          userId: senderId,
          eventType: 'transfer_sent',
          amountUnits: -amountUnits,
          balanceAfterUnits: sender.balanceUnits,
          journalTxId: jtxId,
          reference: `${ref}:OUT`,
          createdAt: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          userId: recipientId,
          eventType: 'transfer_received',
          amountUnits: amountUnits,
          balanceAfterUnits: recipient.balanceUnits,
          journalTxId: jtxId,
          reference: `${ref}:IN`,
          createdAt: Date.now(),
        }
      );

      return { journalTxId: jtxId };
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }

  adminAdjustWallet(userId: string, newBalanceUnits: number): { journalTxId: string | null; deltaUnits: number } {
    const snap = this.snapshot();
    try {
      if (!Number.isSafeInteger(newBalanceUnits) || newBalanceUnits < 0) throw new Error('invalid_balance');
      const acc = this.ensureAccount(userId);
      const oldBalance = acc.balanceUnits;
      const delta = newBalanceUnits - oldBalance;
      if (delta === 0) return { journalTxId: null, deltaUnits: 0 };

      const absDelta = Math.abs(delta);
      const treasury = this.treasuries.get('YT-USER-REWARDS')!;
      if (delta > 0) {
        if (treasury.balanceUnits < absDelta) throw new Error('treasury_insufficient');
        treasury.balanceUnits -= absDelta;
        treasury.distributedUnits += absDelta;
        acc.lifetimeEarnedUnits += absDelta;
      } else {
        treasury.balanceUnits = Math.min(treasury.allocatedUnits, treasury.balanceUnits + absDelta);
        treasury.distributedUnits = Math.max(0, treasury.distributedUnits - absDelta);
      }
      acc.balanceUnits = newBalanceUnits;

      const ref = `YT-ADMIN-ADJ:${userId}:${crypto.randomUUID()}`;
      const jtxId = this.postJournalTransaction(
        delta > 0 ? 'admin_wallet_credit' : 'admin_wallet_debit',
        ref,
        ref,
        delta > 0
          ? [
              { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: absDelta },
              { accountScope: 'user', accountKey: userId, userId, side: 'credit', amountUnits: absDelta },
            ]
          : [
              { accountScope: 'user', accountKey: userId, userId, side: 'debit', amountUnits: absDelta },
              { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'credit', amountUnits: absDelta },
            ]
      );

      this.ledger.push({
        id: crypto.randomUUID(),
        userId,
        eventType: 'admin_adjustment',
        amountUnits: delta,
        balanceAfterUnits: acc.balanceUnits,
        journalTxId: jtxId,
        reference: ref,
        createdAt: Date.now(),
      });

      return { journalTxId: jtxId, deltaUnits: delta };
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }

  auditAndRepairUnbalancedJournals(): { unbalancedVoided: number; legacyRowsPaired: number } {
    let unbalancedVoided = 0;
    let legacyRowsPaired = 0;

    for (const tx of this.journalTransactions) {
      if (tx.status !== 'posted') continue;
      const lines = this.journalEntries.filter((e) => e.journalTxId === tx.id);
      const debits = lines.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amountUnits, 0);
      const credits = lines.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amountUnits, 0);
      if (lines.length < 2 || debits <= 0 || debits !== credits) {
        tx.status = 'voided';
        unbalancedVoided += 1;
      }
    }

    for (const row of this.ledger) {
      if (row.journalTxId !== null || row.amountUnits === 0) continue;

      if (row.eventType === 'transfer_sent' && row.amountUnits < 0) {
        const counter = this.ledger.find(
          (c) =>
            c.journalTxId === null &&
            c.eventType === 'transfer_received' &&
            c.amountUnits === Math.abs(row.amountUnits) &&
            c.reference === row.reference.replace(':OUT', ':IN')
        );
        if (counter) {
          const jtxId = this.postJournalTransaction(
            'legacy_p2p_transfer_reconcile',
            row.reference,
            `REPAIR-XFER:${row.id}`,
            [
              { accountScope: 'user', accountKey: row.userId, userId: row.userId, side: 'debit', amountUnits: Math.abs(row.amountUnits) },
              { accountScope: 'user', accountKey: counter.userId, userId: counter.userId, side: 'credit', amountUnits: counter.amountUnits },
            ]
          );
          row.journalTxId = jtxId;
          counter.journalTxId = jtxId;
          legacyRowsPaired += 2;
        }
      } else if (row.amountUnits > 0 && row.eventType !== 'transfer_received') {
        const jtxId = this.postJournalTransaction(
          'legacy_reward_reconcile',
          row.reference,
          `REPAIR-LEDGER:${row.id}`,
          [
            { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', treasuryKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: row.amountUnits },
            { accountScope: 'user', accountKey: row.userId, userId: row.userId, side: 'credit', amountUnits: row.amountUnits },
          ]
        );
        row.journalTxId = jtxId;
        legacyRowsPaired += 1;
      }
    }

    return { unbalancedVoided, legacyRowsPaired };
  }

  assertAllPostedBalanced() {
    let totalDebits = 0;
    let totalCredits = 0;
    for (const tx of this.journalTransactions) {
      if (tx.status !== 'posted') continue;
      const lines = this.journalEntries.filter((e) => e.journalTxId === tx.id);
      assert.ok(lines.length >= 2, `Journal ${tx.id} must have >= 2 entries`);
      const d = lines.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amountUnits, 0);
      const c = lines.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amountUnits, 0);
      assert.ok(d > 0 && d === c && tx.totalDebitUnits === d && tx.totalCreditUnits === c, `Journal ${tx.id} unbalanced`);
      totalDebits += d;
      totalCredits += c;
    }
    assert.strictEqual(totalDebits, totalCredits, 'Global YT Coin SUM(debit) must equal SUM(credit)');
  }
}

async function runTests() {
  console.log('=== YT Coin Balanced Double-Entry Verification Suite ===\n');

  // 1. Canonical 1 YT = 1,000 parts & Strict Validation
  assert.strictEqual(YT_SUBUNITS_PER_YT, 1000, '1 YT must equal 1000 sub-units');
  assert.strictEqual(YT_MAX_SUPPLY_YT, 100_000_000, 'Final supply cap must be 100,000,000 YT');
  assert.strictEqual(YT_MAX_SUPPLY_UNITS, 100_000_000_000, 'Supply cap in sub-units must be 100,000,000,000');

  assert.strictEqual(unitsToYt(500), 0.5);
  assert.strictEqual(unitsToYt(10), 0.01);
  assert.strictEqual(unitsToYt(1), 0.001);
  assert.strictEqual(unitsToYt(1000), 1);

  assert.strictEqual(ytToUnitsStrict('0.5'), 500);
  assert.strictEqual(ytToUnitsStrict('0.01'), 10);
  assert.strictEqual(ytToUnitsStrict('0.001'), 1);
  assert.strictEqual(ytToUnitsStrict('100000000'), 100_000_000_000);
  assert.throws(() => ytToUnitsStrict('0'), /أكبر من صفر/);
  assert.throws(() => ytToUnitsStrict('-0.01'), /سالبة/);
  assert.throws(() => ytToUnitsStrict('0.0001'), /3 خانات عشرية/);

  assert.strictEqual(formatYt(0.5), '0.5');
  assert.strictEqual(formatYt('0.500'), '0.5');
  assert.strictEqual(formatYt(0.01), '0.01');
  assert.strictEqual(formatYtUnits(1), '0.001');
  assert.strictEqual(formatYtUnits(10_000), '10');
  assert.strictEqual(ytToIntegerParts(0.5), 500);
  assert.strictEqual(ytToIntegerParts(0.01), 10);
  assert.strictEqual(formatPartsLabel(500), '500 جزء');
  assert.strictEqual(formatPartsLabel(10), '10 أجزاء');

  assert.throws(
    () =>
      assertBalancedYtJournalEntries([
        { accountScope: 'user', accountKey: 'u1', side: 'credit', amountUnits: 500 },
      ]),
    /YT Coin journal transaction is not balanced/
  );
  assert.throws(
    () =>
      assertBalancedYtJournalEntries([
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: 500 },
        { accountScope: 'user', accountKey: 'u1', side: 'credit', amountUnits: 499 },
      ]),
    /YT Coin journal transaction is not balanced/
  );
  console.log('✓ 1. Shared 1 YT = 1,000 sub-unit math, parts formatting & strict imbalance checks passed.');

  // 2. DB-Faithful Double-Entry Journal Operations & Rollback Guarantees
  const verifier = new YtCoinJournalVerifier();
  const aliceId = crypto.randomUUID();
  const bobId = crypto.randomUUID();

  // 2A. Daily Login Reward (500 parts = 0.5 YT)
  const dailyRes = verifier.claimDailyMining(aliceId);
  assert.strictEqual(dailyRes.amountUnits, 500);
  assert.strictEqual(verifier.ensureAccount(aliceId).balanceUnits, 500);
  assert.throws(() => verifier.claimDailyMining(aliceId), /already_claimed/);
  assert.strictEqual(verifier.ensureAccount(aliceId).balanceUnits, 500, 'Duplicate claim must not mutate balance');

  // 2B. Tap Mining Reward (10 parts + 50 parts batch)
  const singleTap = verifier.claimTapMining(aliceId, 1);
  assert.strictEqual(singleTap.amountUnits, 10);
  const batchTap = verifier.claimTapMining(aliceId, 5);
  assert.strictEqual(batchTap.amountUnits, 50);
  assert.strictEqual(verifier.ensureAccount(aliceId).balanceUnits, 560);

  // 2C. Verified Ad Click (10 parts) & Ad View (10 parts) + Duplicate Protection
  const adClick = verifier.processVerifiedAdEvent('ad_net_1', 'evt-click-001', aliceId, 'click');
  assert.strictEqual(adClick.status, 'credited');
  assert.strictEqual(adClick.amountUnits, 10);
  const adView = verifier.processVerifiedAdEvent('ad_net_1', 'evt-view-001', aliceId, 'view');
  assert.strictEqual(adView.status, 'credited');
  assert.strictEqual(adView.amountUnits, 10);
  const adDup = verifier.processVerifiedAdEvent('ad_net_1', 'evt-view-001', aliceId, 'view');
  assert.strictEqual(adDup.status, 'duplicate');
  assert.strictEqual(verifier.ensureAccount(aliceId).balanceUnits, 580);

  // 2D. P2P Transfer (250 parts = 0.25 YT) + Guards
  verifier.transferP2P(aliceId, bobId, 250);
  assert.strictEqual(verifier.ensureAccount(aliceId).balanceUnits, 330);
  assert.strictEqual(verifier.ensureAccount(bobId).balanceUnits, 250);
  assert.throws(() => verifier.transferP2P(aliceId, aliceId, 10), /self_transfer/);
  assert.throws(() => verifier.transferP2P(bobId, aliceId, 500), /insufficient_balance/);
  assert.strictEqual(verifier.ensureAccount(bobId).balanceUnits, 250);

  // 2E. Admin Direct Wallet Adjustment (+1000 parts credit, then -200 parts debit)
  verifier.adminAdjustWallet(bobId, 1250);
  assert.strictEqual(verifier.ensureAccount(bobId).balanceUnits, 1250);
  verifier.adminAdjustWallet(bobId, 1050);
  assert.strictEqual(verifier.ensureAccount(bobId).balanceUnits, 1050);

  // 2F. Imbalance Rollback Guarantee (500 single-sided, 10 single-sided, 500 vs 499)
  const snapBeforeInvalid = JSON.stringify({
    txCount: verifier.journalTransactions.length,
    entryCount: verifier.journalEntries.length,
    alice: verifier.ensureAccount(aliceId).balanceUnits,
    treasury: verifier.treasuries.get('YT-USER-REWARDS')!.balanceUnits,
  });
  assert.throws(
    () =>
      verifier.postJournalTransaction('broken_500', 'BAD-500', 'BAD-500', [
        { accountScope: 'user', accountKey: aliceId, side: 'credit', amountUnits: 500 },
      ]),
    /YT Coin journal transaction is not balanced/
  );
  assert.throws(
    () =>
      verifier.postJournalTransaction('broken_10', 'BAD-10', 'BAD-10', [
        { accountScope: 'user', accountKey: aliceId, side: 'credit', amountUnits: 10 },
      ]),
    /YT Coin journal transaction is not balanced/
  );
  assert.throws(
    () =>
      verifier.postJournalTransaction('broken_mismatch', 'BAD-MM', 'BAD-MM', [
        { accountScope: 'treasury', accountKey: 'YT-USER-REWARDS', side: 'debit', amountUnits: 500 },
        { accountScope: 'user', accountKey: aliceId, side: 'credit', amountUnits: 499 },
      ]),
    /YT Coin journal transaction is not balanced/
  );
  const snapAfterInvalid = JSON.stringify({
    txCount: verifier.journalTransactions.length,
    entryCount: verifier.journalEntries.length,
    alice: verifier.ensureAccount(aliceId).balanceUnits,
    treasury: verifier.treasuries.get('YT-USER-REWARDS')!.balanceUnits,
  });
  assert.strictEqual(snapAfterInvalid, snapBeforeInvalid, 'Unbalanced tx must roll back cleanly with zero side effects');
  verifier.assertAllPostedBalanced();
  console.log('✓ 2. All YT Coin operations (500 daily, 10 tap, 10 ad, P2P, admin adjust) balanced + full rollback verified.');

  // 3. Historical Unbalanced / Single-Sided Repair Idempotency (No Double Rewards)
  const legacyUser = crypto.randomUUID();
  const legacyRecipient = crypto.randomUUID();
  verifier.ensureAccount(legacyUser).balanceUnits = 410; // already received 500 + 10 - 100 before migration
  verifier.ensureAccount(legacyRecipient).balanceUnits = 100;
  // Inject historical broken draft + unpaired ledger rows
  verifier.journalTransactions.push({
    id: 'bad-historical-tx',
    txType: 'legacy_unbalanced',
    reference: 'LEGACY-BAD-500',
    idempotencyKey: null,
    status: 'posted',
    totalDebitUnits: 0,
    totalCreditUnits: 500,
  });
  verifier.journalEntries.push({
    id: crypto.randomUUID(),
    journalTxId: 'bad-historical-tx',
    accountScope: 'user',
    accountKey: legacyUser,
    side: 'credit',
    amountUnits: 500,
  });
  const xferRef = `YT-XFER:legacy-1`;
  verifier.ledger.push(
    {
      id: 'leg-daily-500',
      userId: legacyUser,
      eventType: 'daily_mining_reward',
      amountUnits: 500,
      balanceAfterUnits: 500,
      journalTxId: null,
      reference: `YT-DAILY:${legacyUser}:2026-11-20`,
      createdAt: 1000,
    },
    {
      id: 'leg-tap-10',
      userId: legacyUser,
      eventType: 'tap_mining_reward',
      amountUnits: 10,
      balanceAfterUnits: 510,
      journalTxId: null,
      reference: `YT-TAP:${legacyUser}:1`,
      createdAt: 2000,
    },
    {
      id: 'leg-xfer-out',
      userId: legacyUser,
      eventType: 'transfer_sent',
      amountUnits: -100,
      balanceAfterUnits: 410,
      journalTxId: null,
      reference: `${xferRef}:OUT`,
      createdAt: 3000,
    },
    {
      id: 'leg-xfer-in',
      userId: legacyRecipient,
      eventType: 'transfer_received',
      amountUnits: 100,
      balanceAfterUnits: 100,
      journalTxId: null,
      reference: `${xferRef}:IN`,
      createdAt: 3000,
    }
  );

  const repairPass1 = verifier.auditAndRepairUnbalancedJournals();
  assert.strictEqual(repairPass1.unbalancedVoided, 1, 'Should void 1 broken historical draft');
  assert.strictEqual(repairPass1.legacyRowsPaired, 4, 'Should pair all 4 legacy ledger rows');
  assert.strictEqual(verifier.ensureAccount(legacyUser).balanceUnits, 410, 'Repair must NOT duplicate user balance');
  assert.strictEqual(verifier.ensureAccount(legacyRecipient).balanceUnits, 100, 'Repair must NOT double recipient balance');
  verifier.assertAllPostedBalanced();

  const repairPass2 = verifier.auditAndRepairUnbalancedJournals();
  assert.strictEqual(repairPass2.unbalancedVoided, 0, '2nd repair pass must be idempotent');
  assert.strictEqual(repairPass2.legacyRowsPaired, 0, '2nd repair pass must not duplicate pairing');
  console.log('✓ 3. Historical repair voided broken draft & paired legacy rows idempotently without doubling balances.');

  // 4. Static Migration Isolation Check
  const migPath = path.resolve(process.cwd(), 'supabase/migrations/20261125000000_yt_coin_balanced_journal_and_repair.sql');
  const migSql = fs.readFileSync(migPath, 'utf8');
  for (const forbidden of ['public.wallets', 'public.financial_accounts', 'public.ledger_transactions', 'public.ledger_entries']) {
    const nonCommentLines = migSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.includes(forbidden));
    assert.strictEqual(nonCommentLines.length, 0, `Migration must NOT reference or modify ${forbidden}`);
  }
  assert.ok(migSql.includes('yt_coin.post_journal_transaction'), 'Migration must route through post_journal_transaction');
  assert.ok(migSql.includes('trg_yt_coin_journal_entries_balanced'), 'Migration must attach deferrable balance trigger');
  console.log('✓ 4. Static SQL check confirmed strict isolation (zero edits to YER wallets/financial ledgers).');

  // 5. Real Express Route Auth & Anti-Fraud Protection Checks
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const checks = [
      { method: 'GET', path: '/api/yt-coin/summary', expected: 401 },
      { method: 'POST', path: '/api/yt-coin/claim', expected: 401 },
      { method: 'POST', path: '/api/yt-coin/tap', expected: 401 },
      { method: 'POST', path: '/api/yt-coin/transfer', expected: 401 },
      { method: 'POST', path: '/api/yt-coin/watch-ad', expected: 401 },
      { method: 'POST', path: '/api/yt-coin/swap', expected: 401 },
      { method: 'GET', path: '/api/yt-coin/ads', expected: 401 },
      { method: 'GET', path: '/api/admin/yt-coin/integrity', expected: 401 },
      { method: 'GET', path: '/api/admin/yt-coin/summary', expected: 401 },
      { method: 'POST', path: '/api/postbacks/yt-coin-ads/INVALID*KEY', expected: 400 },
      { method: 'POST', path: '/api/postbacks/yt-coin-ads/test_net', expected: 400 }, // missing valid user_id / event_id
    ];

    for (const c of checks) {
      const resp = await fetch(`${baseUrl}${c.path}`, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        ...(c.method !== 'GET' ? { body: JSON.stringify({}) } : {}),
      });
      assert.strictEqual(resp.status, c.expected, `${c.method} ${c.path} expected HTTP ${c.expected}, got ${resp.status}`);
    }
    console.log('✓ 5. Real Express YT Coin routes enforce 401 auth, S2S payload validation, and admin guards.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }

  // 6. Optional Read-Only Live Supabase Diagnostic (non-mutating)
  if (supabaseServer) {
    try {
      const { error: intErr } = await supabaseServer.rpc('admin_verify_yt_coin_ledger_integrity');
      if (intErr) {
        if (String(intErr.message || '').includes('Could not find the function') || intErr.code === 'PGRST202') {
          console.log('ℹ 6. Live Supabase check: 20261125000000 not yet applied in Supabase SQL Editor (pending deployment).');
        } else if (String(intErr.message || '').includes('Admin privileges required')) {
          console.log('✓ 6. Live Supabase check: admin_verify_yt_coin_ledger_integrity is deployed and strictly admin-guarded.');
        } else {
          console.log(`ℹ 6. Live Supabase RPC check status: ${intErr.message}`);
        }
      }
    } catch (err: any) {
      console.log(`ℹ 6. Live Supabase diagnostic skipped: ${err?.message || err}`);
    }
  } else {
    console.log('ℹ 6. Live Supabase diagnostic skipped (no service client configured).');
  }

  console.log('\nALL YT COIN BALANCED JOURNAL TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('YT COIN TEST FAILED:', err);
  process.exit(1);
});
