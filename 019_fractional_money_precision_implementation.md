# Yemen Tasks — Fractional Money Precision (6 decimals)

**Status: implementation specification only — NOT an executable database migration.**

This document records the required implementation for fractional monetary values in Yemen Tasks. Do not paste this file into the Supabase SQL Editor and do not mark the migration as applied.

## Objective

Use exact decimal arithmetic with up to 6 fractional places for all money-like values. Example: a 3% fee on a transfer of 15 units must be `0.450000`, not rounded up to `1`.

Use PostgreSQL `NUMERIC(30,6)` for stored monetary values and decimal-string transport between the browser, server, and PostgreSQL. Do not use JavaScript `Number`, `Math.round`, `Math.ceil`, or `Math.floor` for money calculations.

## Verified production findings

The production database currently has integer (`BIGINT`) monetary columns in at least these locations:

- `financial_accounts.balance_units`
- `ledger_entries.amount_units`
- `referral_rewards.amount_units`
- `referral_task_rewards.amount_units`
- `tasks.reward_units`
- `tasks.total_budget_units`
- `tasks.refunded_units`
- `tax_settlements.taxable_base_units`
- `tax_settlements.tax_amount_units`
- `withdrawal_requests.amount_units`
- `withdrawal_requests.fee_units`

The production transfer RPC currently accepts `p_amount_units BIGINT`. Its fee calculation applies a 3% rate, then rounds upward and enforces a minimum fee of one whole unit. This is why a 15-unit transfer is charged a 1-unit fee instead of 0.45.

The referral task-share trigger currently calculates 5% using `floor(...)`, which discards fractional amounts. The ledger posting function also uses integer-oriented variables and JSON amount parsing.

## Required implementation scope

This change must be delivered as a coordinated database + server + UI update. Do not deploy only the SQL or only the application code.

### Database

1. Inventory every money-related column, including all columns ending in `_units`, and classify each one as money, count, identifier, or non-money quantity.
2. Inventory all triggers, views, constraints, indexes, RPCs, and functions that read or write those columns.
3. Move monetary columns to `NUMERIC(30,6)` while preserving all existing values exactly.
4. Update `post_ledger_transaction` to parse JSON amounts as `NUMERIC(30,6)`, maintain exact account balances, and reject unbalanced transactions.
5. Update `transfer_wallet_units` to accept a numeric amount and calculate the fee as `round(amount * 0.03, 6)` with no artificial minimum.
6. Update referral reward processing to calculate 5% at six decimal places. Preserve the independent fixed referral reward of 30 units.
7. Preserve the separate referral funding account. Never use the general treasury as a substitute.
8. Update task funding, approval, cancellation/refund, withdrawal reservation/settlement, and tax functions to use decimal values end-to-end.
9. Rebuild dependent triggers safely when PostgreSQL requires it for column type changes.
10. Preserve all existing records and ledger history. Do not retroactively recalculate, rewrite, or repay old transactions.

### Server and client

1. Accept decimal values as validated decimal strings.
2. Use a decimal arithmetic library or exact integer micro-units for calculations; do not calculate money with binary floating-point.
3. Remove money-related `Math.round`, `Math.ceil`, `Math.floor`, and `Number(...)` conversions.
4. Keep API responses and UI formatting consistent at up to six decimal places.
5. Update generated Supabase types and all RPC parameter types.
6. Reject values with more than six decimal places and reject non-finite, negative, or malformed amounts where not allowed.

## Mandatory tests before deployment

- Transfer amount `15` at 3% fee -> fee `0.450000`, recipient receives `15.000000`, sender debit `15.450000`.
- Small transfer amount `0.01` at 3% -> fee `0.000300`.
- A fee below one unit must not be raised to one.
- Referral share on an approved task reward of `15` -> `0.750000`.
- Referral share remains pending if the referral fund cannot cover it.
- Fixed referral reward of 30 remains independent and unchanged.
- Ledger debits equal ledger credits exactly.
- Existing integer balances and ledger entries remain numerically identical after conversion.
- Idempotent retries do not duplicate transfers or referral payouts.
- Withdrawal fees, task budgets, task refunds, and tax calculations preserve six decimal places.
- No existing historical transaction is modified.

## Deployment safety rules

- Implement on a dedicated Git branch and open a pull request.
- Back up production before applying the migration.
- Run schema and data preflight checks first.
- Apply database changes only after server compatibility is ready.
- Verify ledger balance mismatches are zero before and after deployment.
- Do not alter the historical transfer that already charged one whole unit; any correction requires a separate, explicitly approved reversing ledger transaction.
- Do not mark this implementation complete until database, server, client, and tests all pass.

## Current blocker

GitHub repository metadata reports push permission, but the connected GitHub integration returned HTTP 403 when attempting to create a branch. The database migration has not been applied. This document is provided as a safe specification so it can be uploaded to the repository without accidentally executing an incomplete migration.
