-- ==============================================================================
-- KASB YEMEN — LIVE PREFLIGHT AUDIT & ROLLBACK TEMPLATES (Migrations 023-027)
-- Instructions:
--   1. Run Section A (Read-Only Preflight) FIRST in Supabase SQL Editor and inspect results.
--   2. Only proceed with 023 -> 024 -> 025 -> 026 -> 027 after confirming clean ledger parity.
--   3. Keep Section B handy if an emergency rollback of schema/functions is ever required.
-- ==============================================================================

-- ==============================================================================
-- SECTION A: READ-ONLY PREFLIGHT DIAGNOSTICS
-- ==============================================================================

-- A1. Check applied migrations
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version ASC;

-- A2. Inspect current data types of all monetary columns across public schema
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'financial_accounts' AND column_name IN ('balance_units'))
    OR (table_name = 'ledger_entries' AND column_name IN ('amount_units', 'debit_amount', 'credit_amount'))
    OR (table_name = 'wallets' AND column_name IN ('available_balance', 'pending_balance', 'balance', 'reserved_balance', 'total_earned', 'total_withdrawn', 'total_transferred'))
    OR (table_name = 'wallet_transactions' AND column_name IN ('amount', 'previous_balance', 'new_balance'))
    OR (table_name = 'tasks' AND column_name IN ('reward_units', 'reward_yer', 'total_budget_units', 'budget_yer', 'budget_spent_yer', 'commission_units'))
    OR (table_name = 'withdrawal_requests' AND column_name IN ('amount', 'fee', 'net_amount', 'amount_units', 'fee_units', 'net_units'))
    OR (table_name = 'payout_methods' AND column_name IN ('min_withdrawal', 'max_withdrawal', 'fee_flat'))
    OR (table_name = 'referral_rewards' AND column_name IN ('reward_units'))
    OR (table_name = 'referral_task_rewards' AND column_name IN ('reward_units', 'platform_net_profit_units'))
    OR (table_name = 'tax_definitions' AND column_name IN ('flat_amount'))
    OR (table_name = 'tax_settlements' AND column_name IN ('taxable_amount', 'tax_amount'))
    OR (table_name = 'platform_settings' AND column_name IN ('min_withdrawal', 'max_withdrawal', 'daily_withdrawal_limit', 'referral_bonus'))
    OR (table_name = 'campaigns' AND column_name IN ('reward_units', 'budget_units', 'fee_units', 'total_units', 'refunded_units'))
    OR (table_name = 'external_accounts' AND column_name IN ('actual_balance_units'))
    OR (table_name = 'external_deposits' AND column_name IN ('amount_units'))
    OR (table_name = 'external_account_transfers' AND column_name IN ('amount_units'))
    OR (table_name = 'external_account_reconciliations' AND column_name IN ('accounting_balance_units', 'actual_balance_units', 'discrepancy_units'))
  )
ORDER BY table_name, column_name;

-- A3. Check views that depend on monetary tables (023 saves & restores these automatically)
SELECT DISTINCT v.table_schema, v.table_name, d.refobjid::regclass AS referenced_table
FROM information_schema.views v
JOIN pg_class vc ON vc.relname = v.table_name
JOIN pg_namespace vn ON vn.oid = vc.relnamespace AND vn.nspname = v.table_schema
JOIN pg_depend d ON d.objid = vc.oid OR d.refobjid = vc.oid
WHERE v.table_schema = 'public';

-- A4. Double-entry ledger balance parity check BEFORE 023 migration
SELECT
  lt.id AS transaction_id,
  lt.transaction_type,
  SUM(CASE WHEN le.entry_side = 'debit' THEN le.amount_units ELSE 0 END) AS total_debits,
  SUM(CASE WHEN le.entry_side = 'credit' THEN le.amount_units ELSE 0 END) AS total_credits
FROM public.ledger_transactions lt
JOIN public.ledger_entries le ON le.transaction_id = lt.id
GROUP BY lt.id, lt.transaction_type
HAVING SUM(CASE WHEN le.entry_side = 'debit' THEN le.amount_units ELSE 0 END)
    <> SUM(CASE WHEN le.entry_side = 'credit' THEN le.amount_units ELSE 0 END);

-- A5. Inspect existing function signatures & search_path hardening
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS is_security_definer,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'post_ledger_transaction',
    'transfer_wallet_units',
    'create_funded_task',
    'cancel_funded_task',
    'review_task_submission',
    'submit_task_proof',
    'is_admin',
    'reserve_withdrawal_ledger',
    'settle_withdrawal_ledger',
    'create_funded_campaign',
    'approve_advertiser_campaign',
    'start_advertiser_campaign',
    'settle_advertiser_campaign',
    'process_referral_task_share',
    'get_my_referral_summary'
  )
ORDER BY p.proname;

-- ==============================================================================
-- SECTION B: ROLLBACK TEMPLATES (MANUAL USE ONLY IF ROLLING BACK MIGRATIONS)
-- WARNING: Do NOT downgrade NUMERIC(30,6) to BIGINT if fractional amounts
-- have already been persisted in production without explicitly checking rows!
-- ==============================================================================
/*
-- Rollback 027 RLS/Function hardening (re-apply prior policies from 011/014/020/022 if needed)
-- Rollback 024 campaign approval gate columns:
ALTER TABLE public.campaigns
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS rejected_at,
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS min_fee_applied,
  DROP COLUMN IF EXISTS fee_policy_snapshot;

ALTER TABLE public.platform_settings
  DROP COLUMN IF EXISTS campaign_fee_policy;

-- Verify no fractional remainders exist before any integer downgrade:
SELECT COUNT(*) AS fractional_ledger_entries
FROM public.ledger_entries
WHERE amount_units <> TRUNC(amount_units);
*/
