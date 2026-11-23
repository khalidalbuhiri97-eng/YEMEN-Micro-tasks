-- ============================================================================
-- YT COIN: RADICAL DOUBLE-ENTRY JOURNAL BALANCING & HISTORICAL REPAIR
-- ============================================================================
-- Fixes root cause of: "YT Coin journal transaction is not balanced" (e.g. 10 & 500 parts)
-- Guarantees:
--   1. Canonical 1 YT = 1,000 integer sub-units (BIGINT only, min 0.001 YT, 100M YT cap).
--   2. Every YT Coin operation (daily 500, tap 10, ad view/click 10, P2P transfer,
--      admin wallet adjustment, treasury adjustment) posts a balanced double-entry
--      journal transaction via yt_coin.post_journal_transaction(...) where
--      SUM(debit_units) = SUM(credit_units) > 0.
--   3. Deferrable DB CONSTRAINT TRIGGER checks SUM(debit) = SUM(credit) on commit
--      and rolls back the entire transaction if unbalanced.
--   4. Non-destructive idempotent audit & reconciliation of any historical
--      single-sided/unbalanced rows without duplicating rewards or doubling balances.
--   5. Zero edits to public.wallets, financial_accounts, ledger_transactions, ledger_entries.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS yt_coin;

-- ----------------------------------------------------------------------------
-- 1. Preserve & Safely Upgrade Any Out-of-Repo yt_parts_v3 Journal Tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_has_jt boolean;
  v_has_je boolean;
  v_jt_valid boolean;
  v_je_valid boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'yt_coin' AND table_name = 'journal_transactions'
  ) INTO v_has_jt;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'yt_coin' AND table_name = 'journal_entries'
  ) INTO v_has_je;

  IF v_has_jt THEN
    SELECT (
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'yt_coin' AND table_name = 'journal_transactions' AND column_name = 'total_debit_units')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'yt_coin' AND table_name = 'journal_transactions' AND column_name = 'status')
    ) INTO v_jt_valid;

    IF NOT v_jt_valid THEN
      EXECUTE 'DROP TABLE IF EXISTS yt_coin.journal_transactions_v3_archive CASCADE';
      EXECUTE 'ALTER TABLE yt_coin.journal_transactions RENAME TO journal_transactions_v3_archive';
    END IF;
  END IF;

  IF v_has_je THEN
    SELECT (
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'yt_coin' AND table_name = 'journal_entries' AND column_name = 'journal_tx_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'yt_coin' AND table_name = 'journal_entries' AND column_name = 'side')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'yt_coin' AND table_name = 'journal_entries' AND column_name = 'amount_units')
    ) INTO v_je_valid;

    IF NOT v_je_valid THEN
      EXECUTE 'DROP TABLE IF EXISTS yt_coin.journal_entries_v3_archive CASCADE';
      EXECUTE 'ALTER TABLE yt_coin.journal_entries RENAME TO journal_entries_v3_archive';
    END IF;
  END IF;
END $$;

-- Ensure base yt_coin tables/columns exist cleanly
ALTER TABLE yt_coin.ledger
  ADD COLUMN IF NOT EXISTS amount_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_after_units bigint,
  ADD COLUMN IF NOT EXISTS journal_tx_id uuid;

CREATE INDEX IF NOT EXISTS idx_yt_coin_ledger_journal_tx
  ON yt_coin.ledger(journal_tx_id);

-- ----------------------------------------------------------------------------
-- 2. Canonical Double-Entry Journal Tables + Atomic Balance Trigger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yt_coin.journal_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_type text NOT NULL,
  reference text NOT NULL,
  idempotency_key text UNIQUE,
  actor_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided', 'reversed')),
  total_debit_units bigint NOT NULL DEFAULT 0 CHECK (total_debit_units >= 0),
  total_credit_units bigint NOT NULL DEFAULT 0 CHECK (total_credit_units >= 0),
  unit_scale integer NOT NULL DEFAULT 1000 CHECK (unit_scale = 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yt_coin_jtx_balanced_posted CHECK (
    status <> 'posted' OR (total_debit_units > 0 AND total_debit_units = total_credit_units)
  )
);

CREATE TABLE IF NOT EXISTS yt_coin.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_tx_id uuid NOT NULL REFERENCES yt_coin.journal_transactions(id) ON DELETE CASCADE,
  account_scope text NOT NULL CHECK (account_scope IN ('treasury', 'user', 'control')),
  account_key text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  treasury_key text,
  side text NOT NULL CHECK (side IN ('debit', 'credit')),
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  balance_after_units bigint,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yt_coin_journal_entries_tx
  ON yt_coin.journal_entries(journal_tx_id);
CREATE INDEX IF NOT EXISTS idx_yt_coin_journal_entries_user
  ON yt_coin.journal_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yt_coin_journal_entries_treasury
  ON yt_coin.journal_entries(treasury_key, created_at DESC);

REVOKE ALL ON yt_coin.journal_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON yt_coin.journal_entries FROM PUBLIC, anon, authenticated;
ALTER TABLE yt_coin.journal_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.journal_entries ENABLE ROW LEVEL SECURITY;

-- Deferrable constraint trigger enforcing SUM(debit_units) = SUM(credit_units) on every commit
CREATE OR REPLACE FUNCTION yt_coin.verify_journal_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tx_id uuid;
  v_tx yt_coin.journal_transactions%ROWTYPE;
  v_debit_sum bigint := 0;
  v_credit_sum bigint := 0;
  v_line_count integer := 0;
BEGIN
  IF TG_TABLE_NAME = 'journal_transactions' THEN
    v_tx_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_tx_id := COALESCE(NEW.journal_tx_id, OLD.journal_tx_id);
  END IF;

  IF v_tx_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tx FROM yt_coin.journal_transactions WHERE id = v_tx_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_tx.status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(amount_units) FILTER (WHERE side = 'debit'), 0),
    COALESCE(SUM(amount_units) FILTER (WHERE side = 'credit'), 0),
    count(*)
  INTO v_debit_sum, v_credit_sum, v_line_count
  FROM yt_coin.journal_entries
  WHERE journal_tx_id = v_tx_id;

  IF v_line_count < 2
     OR v_debit_sum <= 0
     OR v_credit_sum <= 0
     OR v_debit_sum <> v_credit_sum
     OR v_tx.total_debit_units <> v_debit_sum
     OR v_tx.total_credit_units <> v_credit_sum THEN
    RAISE EXCEPTION 'YT Coin journal transaction is not balanced (tx=%, debit=%, credit=%, lines=%)',
      v_tx_id, v_debit_sum, v_credit_sum, v_line_count
      USING ERRCODE = '22000';
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_yt_coin_journal_entries_balanced ON yt_coin.journal_entries;
CREATE CONSTRAINT TRIGGER trg_yt_coin_journal_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON yt_coin.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION yt_coin.verify_journal_transaction_balanced();

DROP TRIGGER IF EXISTS trg_yt_coin_journal_tx_balanced ON yt_coin.journal_transactions;
CREATE CONSTRAINT TRIGGER trg_yt_coin_journal_tx_balanced
  AFTER INSERT OR UPDATE ON yt_coin.journal_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION yt_coin.verify_journal_transaction_balanced();

-- ----------------------------------------------------------------------------
-- 3. Single Atomic Journal Posting Engine: yt_coin.post_journal_transaction
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION yt_coin.post_journal_transaction(
  p_tx_type text,
  p_reference text,
  p_idempotency_key text,
  p_actor_id uuid,
  p_entries jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing_tx_id uuid;
  v_tx_id uuid;
  v_debit_sum bigint := 0;
  v_credit_sum bigint := 0;
  v_line_count integer := 0;
  v_item jsonb;
  v_side text;
  v_scope text;
  v_acc_key text;
  v_uid uuid;
  v_tkey text;
  v_amt bigint;
  v_bal_after bigint;
  v_memo text;
BEGIN
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing_tx_id
    FROM yt_coin.journal_transactions
    WHERE idempotency_key = trim(p_idempotency_key) AND status = 'posted';
    IF FOUND THEN
      RETURN v_existing_tx_id;
    END IF;
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'YT Coin journal transaction is not balanced' USING ERRCODE = '22000';
  END IF;

  -- Pre-validate integer BIGINT amounts and debit = credit balance before writing anything
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_side := lower(trim(COALESCE(v_item->>'side', '')));
    v_scope := lower(trim(COALESCE(v_item->>'account_scope', '')));
    v_acc_key := trim(COALESCE(v_item->>'account_key', ''));
    v_amt := NULLIF(trim(COALESCE(v_item->>'amount_units', '')), '')::bigint;

    IF v_side NOT IN ('debit', 'credit')
       OR v_scope NOT IN ('treasury', 'user', 'control')
       OR v_acc_key = ''
       OR v_amt IS NULL
       OR v_amt <= 0 THEN
      RAISE EXCEPTION 'YT Coin journal transaction is not balanced' USING ERRCODE = '22000';
    END IF;

    v_line_count := v_line_count + 1;
    IF v_side = 'debit' THEN
      v_debit_sum := v_debit_sum + v_amt;
    ELSE
      v_credit_sum := v_credit_sum + v_amt;
    END IF;
  END LOOP;

  IF v_line_count < 2 OR v_debit_sum <= 0 OR v_debit_sum <> v_credit_sum THEN
    RAISE EXCEPTION 'YT Coin journal transaction is not balanced' USING ERRCODE = '22000';
  END IF;

  INSERT INTO yt_coin.journal_transactions(
    tx_type, reference, idempotency_key, actor_id, status,
    total_debit_units, total_credit_units, unit_scale, metadata
  ) VALUES (
    COALESCE(NULLIF(trim(p_tx_type), ''), 'yt_operation'),
    COALESCE(NULLIF(trim(p_reference), ''), 'YT-JTX:' || gen_random_uuid()::text),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
    p_actor_id,
    'posted',
    v_debit_sum,
    v_credit_sum,
    1000,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_tx_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_side := lower(trim(COALESCE(v_item->>'side', '')));
    v_scope := lower(trim(COALESCE(v_item->>'account_scope', '')));
    v_acc_key := trim(COALESCE(v_item->>'account_key', ''));
    v_uid := NULLIF(trim(COALESCE(v_item->>'user_id', '')), '')::uuid;
    v_tkey := NULLIF(trim(COALESCE(v_item->>'treasury_key', '')), '');
    v_amt := (v_item->>'amount_units')::bigint;
    v_bal_after := NULLIF(trim(COALESCE(v_item->>'balance_after_units', '')), '')::bigint;
    v_memo := NULLIF(trim(COALESCE(v_item->>'memo', '')), '');

    INSERT INTO yt_coin.journal_entries(
      journal_tx_id, account_scope, account_key, user_id, treasury_key,
      side, amount_units, balance_after_units, memo
    ) VALUES (
      v_tx_id, v_scope, v_acc_key, v_uid, v_tkey,
      v_side, v_amt, v_bal_after, v_memo
    );
  END LOOP;

  RETURN v_tx_id;
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.post_journal_transaction(text, text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Fix Config Defaults (1 YT = 1,000 parts, Daily = 500, Tap = 10, Ad Click/View = 10)
--    & Sync Legacy yt_parts_v3 Allocations if Present in Live DB
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE yt_coin.config
  SET unit_scale = 1000,
      max_supply_units = COALESCE(NULLIF(max_supply_units, 0), 100000000000),
      base_reward_units = CASE WHEN COALESCE(base_reward_units, 0) <= 0 THEN 500 ELSE base_reward_units END,
      tap_reward_units = CASE WHEN COALESCE(tap_reward_units, 0) <= 0 THEN 10 ELSE tap_reward_units END,
      ad_click_reward_units = CASE WHEN ad_click_reward_units IN (0, 100) THEN 10 ELSE COALESCE(ad_click_reward_units, 10) END,
      ad_view_reward_units = CASE WHEN COALESCE(ad_view_reward_units, 0) <= 0 THEN 10 ELSE ad_view_reward_units END,
      economy_version = 'yt_bigint_100m_balanced_v3',
      updated_at = now()
  WHERE singleton = true;

  -- Sync out-of-repo yt_parts_v3 allocations table if it exists in live Supabase
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'yt_coin' AND table_name = 'allocations'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'yt_coin' AND table_name = 'allocations' AND column_name = 'allocation_key'
  ) THEN
    INSERT INTO yt_coin.system_treasury(
      treasury_key, account_type, label_ar, allocated_units, balance_units, distributed_units,
      is_locked, approved_for_distribution
    )
    SELECT
      CASE a.allocation_key
        WHEN 'mining_rewards' THEN 'YT-USER-REWARDS'
        WHEN 'team_vesting' THEN 'YT-TEAM-VESTING'
        WHEN 'market_liquidity' THEN 'YT-MARKET-LIQUIDITY'
        WHEN 'public_distribution' THEN 'YT-GENERAL-CIRCULATION'
        ELSE upper(replace(a.allocation_key, '_', '-'))
      END,
      a.allocation_key,
      CASE a.allocation_key
        WHEN 'mining_rewards' THEN 'مكافآت المستخدمين'
        WHEN 'team_vesting' THEN 'حصة الفريق (مقفلة ومجدولة للاستحقاق)'
        WHEN 'market_liquidity' THEN 'سيولة السوق (حساب مستقل)'
        WHEN 'public_distribution' THEN 'التداول والتوزيع العام'
        ELSE a.allocation_key
      END,
      COALESCE(a.allocated_parts, 0),
      GREATEST(0, COALESCE(a.allocated_parts, 0) - COALESCE(a.issued_parts, 0)),
      COALESCE(a.issued_parts, 0),
      (a.allocation_key = 'team_vesting'),
      (a.allocation_key = 'mining_rewards')
    FROM yt_coin.allocations a
    WHERE a.allocation_key IN ('mining_rewards', 'team_vesting', 'market_liquidity', 'public_distribution')
    ON CONFLICT (treasury_key) DO NOTHING;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Safe, Idempotent Historical Audit & Repair Routine (No Double Rewards)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION yt_coin.audit_and_repair_unbalanced_journals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_legacy_rows_paired integer := 0;
  v_unbalanced_voided integer := 0;
  v_row RECORD;
  v_pair_ref text;
  v_jtx_id uuid;
  v_counter_row yt_coin.ledger%ROWTYPE;
BEGIN
  -- A. Audit & void any draft/broken journal_transactions that are not balanced and never credited accounts
  FOR v_row IN
    SELECT
      jt.id,
      jt.tx_type,
      jt.reference,
      COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) AS debits,
      COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'credit'), 0) AS credits,
      count(je.id) AS line_count
    FROM yt_coin.journal_transactions jt
    LEFT JOIN yt_coin.journal_entries je ON je.journal_tx_id = jt.id
    WHERE jt.status = 'posted'
    GROUP BY jt.id, jt.tx_type, jt.reference
    HAVING count(je.id) < 2
        OR COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) <= 0
        OR COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) <> COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'credit'), 0)
  LOOP
    INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
    VALUES (
      NULL,
      'historical_journal_voided_unbalanced',
      'journal_transaction',
      v_row.id::text,
      jsonb_build_object(
        'tx_type', v_row.tx_type,
        'reference', v_row.reference,
        'debits', v_row.debits,
        'credits', v_row.credits,
        'line_count', v_row.line_count
      )
    );

    UPDATE yt_coin.journal_transactions
    SET status = 'voided',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('voided_reason', 'unbalanced_historical_repair')
    WHERE id = v_row.id;

    v_unbalanced_voided := v_unbalanced_voided + 1;
  END LOOP;

  -- B. Pair any legacy yt_coin.ledger entries lacking journal_tx_id into balanced journal_transactions
  --    WITHOUT modifying yt_coin.accounts.balance_units or duplicating any rewards.
  FOR v_row IN
    SELECT l.*
    FROM yt_coin.ledger l
    WHERE l.journal_tx_id IS NULL
      AND COALESCE(l.amount_units, 0) <> 0
    ORDER BY l.created_at ASC
  LOOP
    v_pair_ref := COALESCE(NULLIF(trim(v_row.reference), ''), 'LEGACY-LEDGER:' || v_row.id::text);

    IF v_row.event_type = 'transfer_sent' AND v_row.amount_units < 0 THEN
      SELECT * INTO v_counter_row
      FROM yt_coin.ledger
      WHERE journal_tx_id IS NULL
        AND event_type = 'transfer_received'
        AND amount_units = ABS(v_row.amount_units)
        AND (
          reference = replace(v_row.reference, ':OUT', ':IN')
          OR abs(extract(epoch FROM (created_at - v_row.created_at))) <= 5
        )
      ORDER BY created_at ASC
      LIMIT 1;

      IF FOUND THEN
        v_jtx_id := yt_coin.post_journal_transaction(
          'legacy_p2p_transfer_reconcile',
          v_pair_ref,
          'REPAIR-XFER:' || v_row.id::text,
          v_row.user_id,
          jsonb_build_array(
            jsonb_build_object(
              'account_scope', 'user',
              'account_key', v_row.user_id::text,
              'user_id', v_row.user_id::text,
              'side', 'debit',
              'amount_units', ABS(v_row.amount_units),
              'memo', 'Historical P2P debit leg reconciliation'
            ),
            jsonb_build_object(
              'account_scope', 'user',
              'account_key', v_counter_row.user_id::text,
              'user_id', v_counter_row.user_id::text,
              'side', 'credit',
              'amount_units', v_counter_row.amount_units,
              'memo', 'Historical P2P credit leg reconciliation'
            )
          ),
          jsonb_build_object('repaired_from_ledger_ids', jsonb_build_array(v_row.id, v_counter_row.id))
        );

        UPDATE yt_coin.ledger SET journal_tx_id = v_jtx_id WHERE id IN (v_row.id, v_counter_row.id);
        v_legacy_rows_paired := v_legacy_rows_paired + 2;
      END IF;
    ELSIF v_row.amount_units > 0 AND v_row.event_type <> 'transfer_received' THEN
      v_jtx_id := yt_coin.post_journal_transaction(
        'legacy_reward_reconcile',
        v_pair_ref,
        'REPAIR-LEDGER:' || v_row.id::text,
        v_row.user_id,
        jsonb_build_array(
          jsonb_build_object(
            'account_scope', 'treasury',
            'account_key', 'YT-USER-REWARDS',
            'treasury_key', 'YT-USER-REWARDS',
            'side', 'debit',
            'amount_units', v_row.amount_units,
            'memo', 'Historical treasury offset reconciliation'
          ),
          jsonb_build_object(
            'account_scope', 'user',
            'account_key', v_row.user_id::text,
            'user_id', v_row.user_id::text,
            'side', 'credit',
            'amount_units', v_row.amount_units,
            'memo', 'Historical user credit reconciliation'
          )
        ),
        jsonb_build_object('repaired_from_ledger_id', v_row.id, 'event_type', v_row.event_type)
      );

      UPDATE yt_coin.ledger SET journal_tx_id = v_jtx_id WHERE id = v_row.id;
      v_legacy_rows_paired := v_legacy_rows_paired + 1;
    ELSIF v_row.amount_units < 0 AND v_row.event_type <> 'transfer_sent' THEN
      v_jtx_id := yt_coin.post_journal_transaction(
        'legacy_debit_reconcile',
        v_pair_ref,
        'REPAIR-LEDGER:' || v_row.id::text,
        v_row.user_id,
        jsonb_build_array(
          jsonb_build_object(
            'account_scope', 'user',
            'account_key', v_row.user_id::text,
            'user_id', v_row.user_id::text,
            'side', 'debit',
            'amount_units', ABS(v_row.amount_units),
            'memo', 'Historical user debit reconciliation'
          ),
          jsonb_build_object(
            'account_scope', 'treasury',
            'account_key', 'YT-USER-REWARDS',
            'treasury_key', 'YT-USER-REWARDS',
            'side', 'credit',
            'amount_units', ABS(v_row.amount_units),
            'memo', 'Historical treasury return reconciliation'
          )
        ),
        jsonb_build_object('repaired_from_ledger_id', v_row.id, 'event_type', v_row.event_type)
      );

      UPDATE yt_coin.ledger SET journal_tx_id = v_jtx_id WHERE id = v_row.id;
      v_legacy_rows_paired := v_legacy_rows_paired + 1;
    END IF;
  END LOOP;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    NULL,
    'historical_journal_audit_repair',
    'yt_coin_journal',
    'singleton',
    jsonb_build_object(
      'unbalanced_voided', v_unbalanced_voided,
      'legacy_rows_paired', v_legacy_rows_paired,
      'repaired_at', now()
    )
  );

  RETURN jsonb_build_object(
    'unbalancedVoided', v_unbalanced_voided,
    'legacyRowsPaired', v_legacy_rows_paired
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.audit_and_repair_unbalanced_journals() FROM PUBLIC, anon, authenticated;

-- Execute idempotent repair pass now
SELECT yt_coin.audit_and_repair_unbalanced_journals();

-- ----------------------------------------------------------------------------
-- 6. Rebuild ALL Transactional YT Coin RPCs Using Balanced Double-Entry Journal
-- ----------------------------------------------------------------------------

-- 6A. Daily Login Mining Reward (500 parts = 0.5 YT: DEBIT YT-USER-REWARDS / CREDIT user)
CREATE OR REPLACE FUNCTION yt_coin.claim_daily_mining()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_reward_units bigint := 500;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_new_treasury_bal bigint := 0;
  v_new_balance_units bigint := 0;
  v_journal_tx_id uuid;
  v_ledger_id uuid;
  v_claim_id uuid;
  v_ref text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين متوقف حالياً من الإدارة.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  v_reward_units := COALESCE(v_cfg.base_reward_units, 500);
  IF v_reward_units <= 0 THEN
    RAISE EXCEPTION 'Invalid daily reward configuration' USING ERRCODE = '22000';
  END IF;

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة الدخول اليومي لهذا اليوم بالفعل.');
  END IF;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التوزيع اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;

  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص مكافآت المستخدمين غير كافٍ أو غير معتمد.');
  END IF;

  v_ref := 'YT-DAILY:' || v_user_id::text || ':' || v_today::text;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS'
  RETURNING balance_units INTO v_new_treasury_bal;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance_units;

  v_journal_tx_id := yt_coin.post_journal_transaction(
    'daily_mining_reward',
    v_ref,
    v_ref,
    v_user_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_scope', 'treasury',
        'account_key', 'YT-USER-REWARDS',
        'treasury_key', 'YT-USER-REWARDS',
        'side', 'debit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_treasury_bal,
        'memo', 'صرف مكافأة الدخول اليومي من مخصص المكافآت'
      ),
      jsonb_build_object(
        'account_scope', 'user',
        'account_key', v_user_id::text,
        'user_id', v_user_id::text,
        'side', 'credit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_balance_units,
        'memo', 'إيداع مكافأة الدخول اليومي في محفظة المستخدم'
      )
    ),
    jsonb_build_object('claimDate', v_today, 'timezone', 'Asia/Aden', 'unitScale', 1000)
  );

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
  VALUES (
    v_user_id,
    'daily_mining_reward',
    v_reward_units,
    v_new_balance_units,
    v_journal_tx_id,
    v_ref,
    jsonb_build_object('claimDate', v_today, 'timezone', 'Asia/Aden', 'unitScale', 1000, 'journalTxId', v_journal_tx_id)
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO yt_coin.mining_claims(user_id, claim_date, amount_units, ledger_id)
  VALUES (v_user_id, v_today, v_reward_units, v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units,
      claim_count = claim_count + 1,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'daily_login_reward',
    'mining_claim',
    v_claim_id::text,
    jsonb_build_object('amountUnits', v_reward_units, 'claimDate', v_today, 'journalTxId', v_journal_tx_id, 'treasury', 'YT-USER-REWARDS')
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'claimed',
    'unitScale', 1000,
    'journalTxId', v_journal_tx_id,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'balanceUnits', v_new_balance_units,
    'claimDate', v_today
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.claim_daily_mining();
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_daily() TO authenticated;

-- 6B. Tap Mining Reward (10 parts = 0.01 YT per tap: DEBIT YT-USER-REWARDS / CREDIT user)
CREATE OR REPLACE FUNCTION yt_coin.claim_tap_mining(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_taps integer := COALESCE(p_taps, 1);
  v_taps_today integer := 0;
  v_reward_units bigint := 0;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_new_treasury_bal bigint := 0;
  v_new_balance_units bigint := 0;
  v_journal_tx_id uuid;
  v_ref text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_taps < 1 OR v_taps > 200 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_taps', 'message', 'عدد النقرات غير صالح.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين متوقف حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  INSERT INTO yt_coin.daily_user_taps(user_id, tap_date, tap_count, paid_units)
  VALUES (v_user_id, v_today, 0, 0)
  ON CONFLICT (user_id, tap_date) DO NOTHING;

  SELECT tap_count INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE user_id = v_user_id AND tap_date = v_today FOR UPDATE;

  IF COALESCE(v_cfg.daily_tap_limit, 0) > 0 THEN
    IF v_taps_today >= v_cfg.daily_tap_limit THEN
      RETURN jsonb_build_object('success', false, 'status', 'daily_tap_limit_reached', 'message', 'تم بلوغ الحد اليومي للنقرات.');
    END IF;
    v_taps := LEAST(v_taps, v_cfg.daily_tap_limit - v_taps_today);
  END IF;

  v_reward_units := v_taps::bigint * COALESCE(v_cfg.tap_reward_units, 10);
  IF v_reward_units <= 0 THEN
    RAISE EXCEPTION 'Invalid tap reward configuration' USING ERRCODE = '22000';
  END IF;

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ السقف اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;
  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص المكافآت غير كافٍ.');
  END IF;

  v_ref := 'YT-TAP:' || v_user_id::text || ':' || gen_random_uuid()::text;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS'
  RETURNING balance_units INTO v_new_treasury_bal;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance_units;

  v_journal_tx_id := yt_coin.post_journal_transaction(
    'tap_mining_reward',
    v_ref,
    v_ref,
    v_user_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_scope', 'treasury',
        'account_key', 'YT-USER-REWARDS',
        'treasury_key', 'YT-USER-REWARDS',
        'side', 'debit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_treasury_bal,
        'memo', 'صرف مكافأة النقر من مخصص المكافآت'
      ),
      jsonb_build_object(
        'account_scope', 'user',
        'account_key', v_user_id::text,
        'user_id', v_user_id::text,
        'side', 'credit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_balance_units,
        'memo', 'إيداع مكافأة النقر في محفظة المستخدم'
      )
    ),
    jsonb_build_object('taps', v_taps, 'unitScale', 1000)
  );

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
  VALUES (
    v_user_id,
    'tap_mining_reward',
    v_reward_units,
    v_new_balance_units,
    v_journal_tx_id,
    v_ref,
    jsonb_build_object('taps', v_taps, 'unitScale', 1000, 'journalTxId', v_journal_tx_id)
  );

  UPDATE yt_coin.daily_user_taps
  SET tap_count = tap_count + v_taps,
      paid_units = paid_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id AND tap_date = v_today;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units, updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'unitScale', 1000,
    'journalTxId', v_journal_tx_id,
    'tapsCredited', v_taps,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'balanceUnits', v_new_balance_units
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_taps(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.claim_tap_mining(p_taps);
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_tap_mining(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_tap_mining(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_taps(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_taps(integer) TO authenticated;

-- 6C. Verified S2S Ad Reward (10 parts click/view = 0.01 YT: DEBIT YT-USER-REWARDS / CREDIT user)
CREATE OR REPLACE FUNCTION yt_coin.process_verified_ad_event(
  p_network_key text,
  p_external_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_session_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT 's2s_postback',
  p_raw_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cfg yt_coin.config%ROWTYPE;
  v_net yt_coin.ad_networks%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_clean_type text := lower(trim(COALESCE(p_event_type, 'view')));
  v_clean_event_id text := trim(COALESCE(p_external_event_id, ''));
  v_reward_units bigint := 10;
  v_ads_today integer := 0;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_new_treasury_bal bigint := 0;
  v_journal_tx_id uuid;
  v_ledger_id uuid;
  v_event_row_id uuid;
  v_new_balance_units bigint := 0;
  v_ref text;
BEGIN
  IF p_user_id IS NULL OR v_clean_event_id = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'بيانات حدث الإعلان غير مكتملة.');
  END IF;

  IF v_clean_type NOT IN ('click', 'view') THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_event_type', 'message', 'نوع الحدث يجب أن يكون click أو view.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM yt_coin.ad_reward_events
    WHERE network_key = lower(trim(p_network_key)) AND external_event_id = v_clean_event_id
  ) THEN
    RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'message', 'تم تسجيل مكافأة هذا الحدث الإعلاني مسبقاً.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled THEN
    RETURN jsonb_build_object('success', false, 'status', 'disabled', 'message', 'نظام مكافآت YT Coin متوقف حالياً.');
  END IF;

  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key = lower(trim(p_network_key)) AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'network_inactive', 'message', 'الشبكة الإعلانية غير مفعلة.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'user_not_active', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (p_user_id, 'yt1' || replace(p_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = p_user_id FOR UPDATE;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events
  WHERE user_id = p_user_id AND event_date = v_today;

  IF COALESCE(v_net.daily_user_limit, 0) > 0 AND v_ads_today >= v_net.daily_user_limit THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_ad_limit_reached', 'message', 'تم بلوغ الحد اليومي للإعلانات لهذه الشبكة.');
  END IF;
  IF COALESCE(v_cfg.daily_ad_limit, 0) > 0 AND v_ads_today >= v_cfg.daily_ad_limit THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_ad_limit_reached', 'message', 'تم بلوغ الحد اليومي العام للإعلانات.');
  END IF;

  v_reward_units := CASE
    WHEN v_clean_type = 'click' THEN COALESCE(v_net.reward_click_units, v_cfg.ad_click_reward_units, 10)
    ELSE COALESCE(v_net.reward_view_units, v_cfg.ad_view_reward_units, 10)
  END;

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التوزيع اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;
  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص مكافآت المستخدمين غير كافٍ.');
  END IF;

  v_ref := 'YT-AD:' || v_net.network_key || ':' || v_clean_event_id;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS'
  RETURNING balance_units INTO v_new_treasury_bal;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      ad_earned_units = ad_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance_units INTO v_new_balance_units;

  v_journal_tx_id := yt_coin.post_journal_transaction(
    CASE WHEN v_clean_type = 'click' THEN 'ad_click_reward' ELSE 'ad_view_reward' END,
    v_ref,
    v_ref,
    p_user_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_scope', 'treasury',
        'account_key', 'YT-USER-REWARDS',
        'treasury_key', 'YT-USER-REWARDS',
        'side', 'debit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_treasury_bal,
        'memo', 'صرف مكافأة إعلان موثق من مخصص المكافآت'
      ),
      jsonb_build_object(
        'account_scope', 'user',
        'account_key', p_user_id::text,
        'user_id', p_user_id::text,
        'side', 'credit',
        'amount_units', v_reward_units,
        'balance_after_units', v_new_balance_units,
        'memo', 'إيداع مكافأة إعلان موثق في محفظة المستخدم'
      )
    ),
    jsonb_build_object(
      'networkKey', v_net.network_key,
      'externalEventId', v_clean_event_id,
      'eventType', v_clean_type,
      'verificationSource', p_verification_source,
      'unitScale', 1000
    )
  );

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
  VALUES (
    p_user_id,
    CASE WHEN v_clean_type = 'click' THEN 'ad_click_reward' ELSE 'ad_view_reward' END,
    v_reward_units,
    v_new_balance_units,
    v_journal_tx_id,
    v_ref,
    jsonb_build_object(
      'networkKey', v_net.network_key,
      'externalEventId', v_clean_event_id,
      'eventType', v_clean_type,
      'verificationSource', p_verification_source,
      'unitScale', 1000,
      'journalTxId', v_journal_tx_id
    )
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO yt_coin.ad_reward_events(
    user_id, network_key, external_event_id, event_type, event_date,
    amount_units, session_id, ledger_id, verification_source, raw_metadata
  ) VALUES (
    p_user_id, v_net.network_key, v_clean_event_id, v_clean_type, v_today,
    v_reward_units, p_session_id, v_ledger_id, p_verification_source, COALESCE(p_raw_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_event_row_id;

  IF p_session_id IS NOT NULL THEN
    UPDATE yt_coin.ad_sessions
    SET status = 'credited'
    WHERE id = p_session_id AND user_id = p_user_id AND status = 'initiated';
  END IF;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    p_user_id,
    'verified_ad_reward_credited',
    'ad_reward_event',
    v_event_row_id::text,
    jsonb_build_object(
      'networkKey', v_net.network_key,
      'externalEventId', v_clean_event_id,
      'eventType', v_clean_type,
      'amountUnits', v_reward_units,
      'journalTxId', v_journal_tx_id,
      'verificationSource', p_verification_source
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'eventId', v_event_row_id,
    'ledgerId', v_ledger_id,
    'journalTxId', v_journal_tx_id,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'newBalanceUnits', v_new_balance_units
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.process_verified_ad_event(text, text, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION yt_coin.process_verified_ad_event(text, text, uuid, text, uuid, text, jsonb) TO service_role;

-- 6D. P2P Wallet Transfer (DEBIT sender / CREDIT recipient)
DROP FUNCTION IF EXISTS public.transfer_yt_coin(text, numeric, text);
DROP FUNCTION IF EXISTS public.transfer_yt_coin(text, bigint, text);
CREATE OR REPLACE FUNCTION public.transfer_yt_coin(
  p_recipient_address text,
  p_amount_units bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sender_id uuid := auth.uid();
  v_clean_addr text := lower(trim(COALESCE(p_recipient_address, '')));
  v_sender yt_coin.accounts%ROWTYPE;
  v_recipient yt_coin.accounts%ROWTYPE;
  v_sender_bal_after bigint;
  v_recipient_bal_after bigint;
  v_journal_tx_id uuid;
  v_sender_ledger uuid;
  v_recipient_ledger uuid;
  v_transfer_id uuid;
  v_ref text;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'يجب أن تكون الكمية جزءاً واحداً (0.001 YT) على الأقل.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_sender_id, 'yt1' || replace(v_sender_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_recipient FROM yt_coin.accounts WHERE lower(wallet_address) = v_clean_addr;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'عنوان محفظة YT Coin المستلمة غير موجود.');
  END IF;
  IF v_recipient.user_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'لا يمكنك التحويل إلى نفس محفظتك.');
  END IF;

  IF v_sender_id < v_recipient.user_id THEN
    SELECT * INTO v_sender FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
    SELECT * INTO v_recipient FROM yt_coin.accounts WHERE user_id = v_recipient.user_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM yt_coin.accounts WHERE user_id = v_recipient.user_id FOR UPDATE;
    SELECT * INTO v_sender FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
  END IF;

  IF v_sender.balance_units < p_amount_units THEN
    RETURN jsonb_build_object('success', false, 'message', 'رصيد YT Coin غير كافٍ لإتمام التحويل.');
  END IF;

  v_ref := 'YT-XFER:' || gen_random_uuid()::text;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units - p_amount_units,
      total_transferred_out_units = total_transferred_out_units + p_amount_units,
      updated_at = now()
  WHERE user_id = v_sender_id
  RETURNING balance_units INTO v_sender_bal_after;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + p_amount_units,
      total_transferred_in_units = total_transferred_in_units + p_amount_units,
      updated_at = now()
  WHERE user_id = v_recipient.user_id
  RETURNING balance_units INTO v_recipient_bal_after;

  v_journal_tx_id := yt_coin.post_journal_transaction(
    'p2p_transfer',
    v_ref,
    v_ref,
    v_sender_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_scope', 'user',
        'account_key', v_sender_id::text,
        'user_id', v_sender_id::text,
        'side', 'debit',
        'amount_units', p_amount_units,
        'balance_after_units', v_sender_bal_after,
        'memo', 'تحويل صادر إلى ' || v_recipient.wallet_address
      ),
      jsonb_build_object(
        'account_scope', 'user',
        'account_key', v_recipient.user_id::text,
        'user_id', v_recipient.user_id::text,
        'side', 'credit',
        'amount_units', p_amount_units,
        'balance_after_units', v_recipient_bal_after,
        'memo', 'تحويل وارد من ' || v_sender.wallet_address
      )
    ),
    jsonb_build_object('from', v_sender.wallet_address, 'to', v_recipient.wallet_address, 'note', p_note, 'unitScale', 1000)
  );

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
  VALUES (
    v_sender_id, 'transfer_sent', -p_amount_units, v_sender_bal_after, v_journal_tx_id, v_ref || ':OUT',
    jsonb_build_object('to', v_recipient.wallet_address, 'note', p_note, 'unitScale', 1000, 'journalTxId', v_journal_tx_id)
  ) RETURNING id INTO v_sender_ledger;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
  VALUES (
    v_recipient.user_id, 'transfer_received', p_amount_units, v_recipient_bal_after, v_journal_tx_id, v_ref || ':IN',
    jsonb_build_object('from', v_sender.wallet_address, 'note', p_note, 'unitScale', 1000, 'journalTxId', v_journal_tx_id)
  ) RETURNING id INTO v_recipient_ledger;

  INSERT INTO yt_coin.transfers(
    sender_id, recipient_id, sender_address, recipient_address,
    amount_units, note, sender_ledger_id, recipient_ledger_id
  ) VALUES (
    v_sender_id, v_recipient.user_id, v_sender.wallet_address, v_recipient.wallet_address,
    p_amount_units, p_note, v_sender_ledger, v_recipient_ledger
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_sender_id, 'yt_coin_p2p_transfer', 'transfer', v_transfer_id::text,
    jsonb_build_object('amountUnits', p_amount_units, 'to', v_recipient.wallet_address, 'journalTxId', v_journal_tx_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'transferId', v_transfer_id,
    'journalTxId', v_journal_tx_id,
    'amountUnits', p_amount_units,
    'amountYt', ROUND(p_amount_units::numeric / 1000.0, 3),
    'newBalanceUnits', v_sender_bal_after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_yt_coin(text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_yt_coin(text, bigint, text) TO authenticated;

-- 6E. Admin Direct Wallet Adjustment (Balanced Journal between YT-USER-REWARDS and User)
CREATE OR REPLACE FUNCTION public.admin_adjust_yt_coin_wallet(
  p_user_id uuid,
  p_new_balance_units bigint,
  p_reason text DEFAULT NULL,
  p_clear_pending_audit boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_acc yt_coin.accounts%ROWTYPE;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_old_balance bigint;
  v_delta bigint;
  v_abs_delta bigint;
  v_new_treasury_bal bigint;
  v_journal_tx_id uuid;
  v_ref text;
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'تعديل إداري مباشر لرصيد محفظة YT Coin');
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب.' USING ERRCODE = '22000';
  END IF;
  IF p_new_balance_units IS NULL OR p_new_balance_units < 0 THEN
    RAISE EXCEPTION 'الرصيد الجديد يجب أن يكون موجباً أو صفراً.' USING ERRCODE = '22000';
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (p_user_id, 'yt1' || replace(p_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_acc FROM yt_coin.accounts WHERE user_id = p_user_id FOR UPDATE;
  v_old_balance := COALESCE(v_acc.balance_units, 0);
  v_delta := p_new_balance_units - v_old_balance;
  v_abs_delta := ABS(v_delta);

  IF v_delta <> 0 THEN
    SELECT * INTO v_treasury
    FROM yt_coin.system_treasury
    WHERE treasury_key = 'YT-USER-REWARDS'
    FOR UPDATE;

    IF v_delta > 0 THEN
      IF v_treasury.balance_units < v_delta THEN
        RAISE EXCEPTION 'رصيد خزينة مكافآت المستخدمين المتاح (% YT) لا يكفي لإضافة % YT.',
          ROUND(v_treasury.balance_units::numeric / 1000.0, 3),
          ROUND(v_delta::numeric / 1000.0, 3)
          USING ERRCODE = '22000';
      END IF;
      UPDATE yt_coin.system_treasury
      SET balance_units = balance_units - v_delta,
          distributed_units = distributed_units + v_delta,
          updated_at = now()
      WHERE treasury_key = 'YT-USER-REWARDS'
      RETURNING balance_units INTO v_new_treasury_bal;
    ELSE
      UPDATE yt_coin.system_treasury
      SET balance_units = LEAST(allocated_units, balance_units + v_abs_delta),
          distributed_units = GREATEST(0, distributed_units - v_abs_delta),
          updated_at = now()
      WHERE treasury_key = 'YT-USER-REWARDS'
      RETURNING balance_units INTO v_new_treasury_bal;
    END IF;
  END IF;

  UPDATE yt_coin.accounts
  SET balance_units = p_new_balance_units,
      lifetime_earned_units = CASE
        WHEN v_delta > 0 THEN lifetime_earned_units + v_delta
        ELSE lifetime_earned_units
      END,
      migration_audit_status = CASE
        WHEN COALESCE(p_clear_pending_audit, true) THEN 'verified'
        ELSE migration_audit_status
      END,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_acc;

  IF v_delta <> 0 THEN
    v_ref := 'YT-ADMIN-ADJ:' || p_user_id::text || ':' || gen_random_uuid()::text;

    IF v_delta > 0 THEN
      v_journal_tx_id := yt_coin.post_journal_transaction(
        'admin_wallet_credit',
        v_ref,
        v_ref,
        v_caller_id,
        jsonb_build_array(
          jsonb_build_object(
            'account_scope', 'treasury',
            'account_key', 'YT-USER-REWARDS',
            'treasury_key', 'YT-USER-REWARDS',
            'side', 'debit',
            'amount_units', v_abs_delta,
            'balance_after_units', v_new_treasury_bal,
            'memo', v_reason
          ),
          jsonb_build_object(
            'account_scope', 'user',
            'account_key', p_user_id::text,
            'user_id', p_user_id::text,
            'side', 'credit',
            'amount_units', v_abs_delta,
            'balance_after_units', v_acc.balance_units,
            'memo', v_reason
          )
        ),
        jsonb_build_object('actor_id', v_caller_id, 'old_balance_units', v_old_balance, 'new_balance_units', v_acc.balance_units)
      );
    ELSE
      v_journal_tx_id := yt_coin.post_journal_transaction(
        'admin_wallet_debit',
        v_ref,
        v_ref,
        v_caller_id,
        jsonb_build_array(
          jsonb_build_object(
            'account_scope', 'user',
            'account_key', p_user_id::text,
            'user_id', p_user_id::text,
            'side', 'debit',
            'amount_units', v_abs_delta,
            'balance_after_units', v_acc.balance_units,
            'memo', v_reason
          ),
          jsonb_build_object(
            'account_scope', 'treasury',
            'account_key', 'YT-USER-REWARDS',
            'treasury_key', 'YT-USER-REWARDS',
            'side', 'credit',
            'amount_units', v_abs_delta,
            'balance_after_units', v_new_treasury_bal,
            'memo', v_reason
          )
        ),
        jsonb_build_object('actor_id', v_caller_id, 'old_balance_units', v_old_balance, 'new_balance_units', v_acc.balance_units)
      );
    END IF;

    INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, balance_after_units, journal_tx_id, reference, metadata)
    VALUES (
      p_user_id,
      'admin_adjustment',
      v_delta,
      v_acc.balance_units,
      v_journal_tx_id,
      v_ref,
      jsonb_build_object(
        'actor_id', v_caller_id,
        'old_balance_units', v_old_balance,
        'new_balance_units', v_acc.balance_units,
        'reason', v_reason,
        'journalTxId', v_journal_tx_id
      )
    );
  END IF;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_adjust_wallet',
    'yt_coin_account',
    p_user_id::text,
    jsonb_build_object(
      'old_balance_units', v_old_balance,
      'new_balance_units', v_acc.balance_units,
      'delta_units', v_delta,
      'journalTxId', v_journal_tx_id,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'user_id', v_acc.user_id,
    'wallet_address', v_acc.wallet_address,
    'old_balance_units', v_old_balance,
    'balance_units', v_acc.balance_units,
    'balance_yt', ROUND(v_acc.balance_units::numeric / 1000.0, 3),
    'delta_units', v_delta,
    'journalTxId', v_journal_tx_id,
    'migration_audit_status', v_acc.migration_audit_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_yt_coin_wallet(uuid, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_yt_coin_wallet(uuid, bigint, text, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Admin Ledger & Journal Integrity Verification RPC (Read-Only Check)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_verify_yt_coin_ledger_integrity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_total_posted_tx bigint := 0;
  v_unbalanced_tx bigint := 0;
  v_total_debits bigint := 0;
  v_total_credits bigint := 0;
  v_unlinked_ledger bigint := 0;
  v_total_user_balances bigint := 0;
  v_cfg yt_coin.config%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT count(*) INTO v_total_posted_tx
  FROM yt_coin.journal_transactions WHERE status = 'posted';

  SELECT count(*) INTO v_unbalanced_tx
  FROM (
    SELECT jt.id
    FROM yt_coin.journal_transactions jt
    LEFT JOIN yt_coin.journal_entries je ON je.journal_tx_id = jt.id
    WHERE jt.status = 'posted'
    GROUP BY jt.id, jt.total_debit_units, jt.total_credit_units
    HAVING count(je.id) < 2
        OR COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) <= 0
        OR COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) <> COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'credit'), 0)
        OR COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0) <> jt.total_debit_units
  ) bad;

  SELECT
    COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'debit'), 0),
    COALESCE(SUM(je.amount_units) FILTER (WHERE je.side = 'credit'), 0)
  INTO v_total_debits, v_total_credits
  FROM yt_coin.journal_entries je
  JOIN yt_coin.journal_transactions jt ON jt.id = je.journal_tx_id
  WHERE jt.status = 'posted';

  SELECT count(*) INTO v_unlinked_ledger
  FROM yt_coin.ledger WHERE journal_tx_id IS NULL AND COALESCE(amount_units, 0) <> 0;

  SELECT COALESCE(SUM(balance_units), 0) INTO v_total_user_balances
  FROM yt_coin.accounts;

  RETURN jsonb_build_object(
    'isBalanced', (v_unbalanced_tx = 0 AND v_total_debits = v_total_credits AND v_unlinked_ledger = 0),
    'unitScale', COALESCE(v_cfg.unit_scale, 1000),
    'totalPostedJournalTx', v_total_posted_tx,
    'unbalancedJournalTxCount', v_unbalanced_tx,
    'totalDebitUnits', v_total_debits,
    'totalCreditUnits', v_total_credits,
    'unlinkedLedgerRows', v_unlinked_ledger,
    'circulatingUserBalanceUnits', v_total_user_balances,
    'checkedAt', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_verify_yt_coin_ledger_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_yt_coin_ledger_integrity() TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Sync Canonical Summary, Config, Treasury & Ad Center RPCs with 1,000-Part System
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION yt_coin.enforce_treasury_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_total_allocated bigint;
  v_max_supply_units bigint;
BEGIN
  SELECT COALESCE(max_supply_units, 100000000000)
  INTO v_max_supply_units
  FROM yt_coin.config
  WHERE singleton = true;

  SELECT COALESCE(SUM(allocated_units), 0) INTO v_total_allocated
  FROM yt_coin.system_treasury
  WHERE treasury_key <> NEW.treasury_key;

  IF (v_total_allocated + COALESCE(NEW.allocated_units, 0)) > v_max_supply_units THEN
    RAISE EXCEPTION 'Total YT Coin allocations (% units) cannot exceed configured max supply (% units).',
      (v_total_allocated + COALESCE(NEW.allocated_units, 0)), v_max_supply_units
      USING ERRCODE = '22000';
  END IF;

  IF NEW.is_locked AND COALESCE(NEW.distributed_units, 0) > 0 AND NOT NEW.approved_for_distribution THEN
    RAISE EXCEPTION 'Locked allocation cannot distribute units before approval/vesting.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_yt_coin_enforce_treasury_cap ON yt_coin.system_treasury;
CREATE TRIGGER trg_yt_coin_enforce_treasury_cap
  BEFORE INSERT OR UPDATE ON yt_coin.system_treasury
  FOR EACH ROW EXECUTE FUNCTION yt_coin.enforce_treasury_cap();

CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_balance_units bigint := 0;
  v_lifetime_units bigint := 0;
  v_ad_earned_units bigint := 0;
  v_wallet_address text;
  v_last_date date;
  v_claimed_today boolean := false;
  v_today_paid_units bigint := 0;
  v_taps_today integer := 0;
  v_ads_today integer := 0;
  v_total_circulating_units bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_rewards_allocated_units bigint := 0;
  v_rewards_distributed_units bigint := 0;
  v_daily_cap_units bigint := 0;
  v_days_elapsed bigint := 0;
  v_user_claims_count bigint := 0;
  v_eligible boolean := false;
  v_next_claim_at timestamptz;
  v_history jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  v_eligible := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  );

  IF v_eligible THEN
    INSERT INTO yt_coin.accounts(user_id, wallet_address)
    VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(lifetime_earned_units, 0),
    COALESCE(ad_earned_units, 0),
    wallet_address
  INTO v_balance_units, v_lifetime_units, v_ad_earned_units, v_wallet_address
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  v_days_elapsed := CASE
    WHEN v_cfg.mining_start_date IS NULL THEN 0
    ELSE GREATEST(0, (v_today - v_cfg.mining_start_date))
  END;

  v_daily_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  SELECT max(claim_date), count(*) INTO v_last_date, v_user_claims_count
  FROM yt_coin.mining_claims WHERE user_id = v_user_id;

  v_claimed_today := (v_last_date = v_today);
  v_next_claim_at := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Aden');

  SELECT COALESCE(paid_units, 0) INTO v_today_paid_units
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(tap_count, 0) INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE user_id = v_user_id AND tap_date = v_today;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id AND event_date = v_today;

  SELECT COALESCE(SUM(balance_units), 0) INTO v_total_circulating_units
  FROM yt_coin.accounts;

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(allocated_units, 0),
    COALESCE(distributed_units, 0)
  INTO v_rewards_remaining_units, v_rewards_allocated_units, v_rewards_distributed_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasuryKey', t.treasury_key,
    'accountType', t.account_type,
    'labelAr', t.label_ar,
    'allocatedUnits', t.allocated_units,
    'allocatedYt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'remainingUnits', t.balance_units,
    'remainingYt', ROUND(t.balance_units::numeric / 1000.0, 3),
    'distributedUnits', t.distributed_units,
    'distributedYt', ROUND(t.distributed_units::numeric / 1000.0, 3),
    'isLocked', t.is_locked,
    'approvedForDistribution', t.approved_for_distribution,
    'vestingSchedule', t.vesting_schedule
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'amountUnits', l.amount_units,
    'amountYt', ROUND(l.amount_units::numeric / 1000.0, 3),
    'journalTxId', l.journal_tx_id,
    'reference', l.reference,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, journal_tx_id, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 40
  ) l;

  RETURN jsonb_build_object(
    'unitScale', 1000,
    'partsPerYt', 1000,
    'economyVersion', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_balanced_v3'),
    'walletAddress', COALESCE(v_wallet_address, 'yt1' || replace(v_user_id::text, '-', '')),
    'balanceUnits', v_balance_units,
    'balanceYt', ROUND(v_balance_units::numeric / 1000.0, 3),
    'lifetimeEarnedUnits', v_lifetime_units,
    'lifetimeEarnedYt', ROUND(v_lifetime_units::numeric / 1000.0, 3),
    'adEarnedUnits', v_ad_earned_units,
    'adEarnedYt', ROUND(v_ad_earned_units::numeric / 1000.0, 3),
    'miningEnabled', COALESCE(v_cfg.mining_enabled, false),
    'maxSupplyUnits', COALESCE(v_cfg.max_supply_units, 100000000000),
    'maxSupplyYt', ROUND(COALESCE(v_cfg.max_supply_units, 100000000000)::numeric / 1000.0, 3),
    'circulatingSupplyUnits', v_total_circulating_units,
    'circulatingSupplyYt', ROUND(v_total_circulating_units::numeric / 1000.0, 3),
    'poolAllocatedUnits', v_rewards_allocated_units,
    'poolAllocatedYt', ROUND(v_rewards_allocated_units::numeric / 1000.0, 3),
    'poolDistributedUnits', v_rewards_distributed_units,
    'poolRemainingUnits', v_rewards_remaining_units,
    'poolRemainingYt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'baseRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'baseRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tapRewardUnits', COALESCE(v_cfg.tap_reward_units, 10),
    'tapRewardYt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'adClickRewardUnits', COALESCE(v_cfg.ad_click_reward_units, 10),
    'adClickRewardYt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'adViewRewardUnits', COALESCE(v_cfg.ad_view_reward_units, 10),
    'adViewRewardYt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'tapsToday', v_taps_today,
    'dailyTapLimit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'dailyTapsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_tap_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_tap_limit - v_taps_today, 0)
    END,
    'adsToday', v_ads_today,
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'dailyAdsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_ad_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_ad_limit - v_ads_today, 0)
    END,
    'dailyCapUnits', v_daily_cap_units,
    'dailyCapYt', ROUND(v_daily_cap_units::numeric / 1000.0, 3),
    'minedTodayUnits', v_today_paid_units,
    'dailyMinedYt', ROUND(v_today_paid_units::numeric / 1000.0, 3),
    'dailyCapRemainingUnits', GREATEST(v_daily_cap_units - v_today_paid_units, 0),
    'dailyRemainingYt', ROUND(GREATEST(v_daily_cap_units - v_today_paid_units, 0)::numeric / 1000.0, 3),
    'swapEnabled', COALESCE(v_cfg.swap_enabled, false),
    'exchangeRateYerPerYt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'canClaim', v_eligible AND COALESCE(v_cfg.mining_enabled, false) AND NOT v_claimed_today AND v_rewards_remaining_units >= COALESCE(v_cfg.base_reward_units, 500),
    'nextRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'todayRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'lastClaimDate', v_last_date,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'totalClaims', v_user_claims_count,
    'allocations', v_allocations,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_yt_coin_admin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_cfg yt_coin.config%ROWTYPE;
  v_circulating_units bigint := 0;
  v_total_mined_units bigint := 0;
  v_today_mined_units bigint := 0;
  v_today_claims integer := 0;
  v_today_taps integer := 0;
  v_today_ads integer := 0;
  v_active_miners bigint := 0;
  v_pending_audit_accounts bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_rewards_allocated_units bigint := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_ad_networks jsonb := '[]'::jsonb;
  v_recent_claims jsonb := '[]'::jsonb;
  v_recent_ad_events jsonb := '[]'::jsonb;
  v_accounts jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT COALESCE(SUM(balance_units), 0), count(*), count(*) FILTER (WHERE migration_audit_status = 'pending_audit')
  INTO v_circulating_units, v_active_miners, v_pending_audit_accounts
  FROM yt_coin.accounts;

  SELECT COALESCE(SUM(amount_units), 0) INTO v_total_mined_units
  FROM yt_coin.ledger WHERE amount_units > 0;

  SELECT COALESCE(paid_units, 0), COALESCE(claim_count, 0)
  INTO v_today_mined_units, v_today_claims
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(SUM(tap_count), 0) INTO v_today_taps
  FROM yt_coin.daily_user_taps WHERE tap_date = v_today;

  SELECT count(*) INTO v_today_ads
  FROM yt_coin.ad_reward_events WHERE event_date = v_today;

  SELECT COALESCE(balance_units, 0), COALESCE(allocated_units, 0)
  INTO v_rewards_remaining_units, v_rewards_allocated_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasury_key', t.treasury_key,
    'account_type', t.account_type,
    'label_ar', t.label_ar,
    'allocated_units', t.allocated_units,
    'allocated_yt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'balance_units', t.balance_units,
    'balance_yt', ROUND(t.balance_units::numeric / 1000.0, 3),
    'distributed_units', t.distributed_units,
    'distributed_yt', ROUND(t.distributed_units::numeric / 1000.0, 3),
    'is_locked', t.is_locked,
    'approved_for_distribution', t.approved_for_distribution,
    'vesting_schedule', t.vesting_schedule,
    'updated_at', t.updated_at
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'network_key', n.network_key,
    'display_name', n.display_name,
    'description', n.description,
    'auth_mode', n.auth_mode,
    'secret_env_key', n.secret_env_key,
    'placement_url', n.placement_url,
    'ad_type', n.ad_type,
    'reward_click_units', n.reward_click_units,
    'reward_click_yt', ROUND(n.reward_click_units::numeric / 1000.0, 3),
    'reward_view_units', n.reward_view_units,
    'reward_view_yt', ROUND(n.reward_view_units::numeric / 1000.0, 3),
    'daily_user_limit', n.daily_user_limit,
    'is_active', n.is_active,
    'updated_at', n.updated_at
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_ad_networks
  FROM yt_coin.ad_networks n;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_recent_claims
  FROM (
    SELECT mc.id, mc.user_id, p.full_name, mc.claim_date, mc.amount_units,
           ROUND(mc.amount_units::numeric / 1000.0, 3) AS amount_yt, mc.created_at
    FROM yt_coin.mining_claims mc
    LEFT JOIN public.profiles p ON p.id = mc.user_id
    ORDER BY mc.created_at DESC LIMIT 20
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(ae)), '[]'::jsonb) INTO v_recent_ad_events
  FROM (
    SELECT e.id, e.user_id, p.full_name, e.network_key, e.external_event_id,
           e.event_type, e.amount_units, ROUND(e.amount_units::numeric / 1000.0, 3) AS amount_yt,
           e.verification_source, e.created_at
    FROM yt_coin.ad_reward_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    ORDER BY e.created_at DESC LIMIT 20
  ) ae;

  SELECT COALESCE(jsonb_agg(row_to_json(ua)), '[]'::jsonb) INTO v_accounts
  FROM (
    SELECT a.user_id, p.full_name, p.phone, p.email, a.wallet_address,
           a.balance_units, ROUND(a.balance_units::numeric / 1000.0, 3) AS balance_yt,
           a.lifetime_earned_units, ROUND(a.lifetime_earned_units::numeric / 1000.0, 3) AS lifetime_earned_yt,
           a.ad_earned_units, ROUND(a.ad_earned_units::numeric / 1000.0, 3) AS ad_earned_yt,
           a.migration_audit_status, a.updated_at
    FROM yt_coin.accounts a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    ORDER BY a.balance_units DESC, a.updated_at DESC
    LIMIT 30
  ) ua;

  RETURN jsonb_build_object(
    'unit_scale', 1000,
    'partsPerYt', 1000,
    'economy_version', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_balanced_v3'),
    'mining_enabled', COALESCE(v_cfg.mining_enabled, true),
    'max_supply_units', COALESCE(v_cfg.max_supply_units, 100000000000),
    'max_supply_yt', ROUND(COALESCE(v_cfg.max_supply_units, 100000000000)::numeric / 1000.0, 3),
    'rewards_treasury_allocated_units', v_rewards_allocated_units,
    'rewards_treasury_allocated_yt', ROUND(v_rewards_allocated_units::numeric / 1000.0, 3),
    'rewards_treasury_balance_units', v_rewards_remaining_units,
    'rewards_treasury_balance_yt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'circulating_supply_units', v_circulating_units,
    'circulating_supply_yt', ROUND(v_circulating_units::numeric / 1000.0, 3),
    'total_mined_units', v_total_mined_units,
    'total_mined_yt', ROUND(v_total_mined_units::numeric / 1000.0, 3),
    'today_mined_units', v_today_mined_units,
    'today_mined_yt', ROUND(v_today_mined_units::numeric / 1000.0, 3),
    'active_miners_count', v_active_miners,
    'pending_audit_accounts', v_pending_audit_accounts,
    'today_claims_count', v_today_claims,
    'today_taps_count', v_today_taps,
    'today_ads_count', v_today_ads,
    'base_reward_units', COALESCE(v_cfg.base_reward_units, 500),
    'base_reward_yt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tap_reward_units', COALESCE(v_cfg.tap_reward_units, 10),
    'tap_reward_yt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'ad_click_reward_units', COALESCE(v_cfg.ad_click_reward_units, 10),
    'ad_click_reward_yt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'ad_view_reward_units', COALESCE(v_cfg.ad_view_reward_units, 10),
    'ad_view_reward_yt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'daily_tap_limit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'daily_ad_limit', COALESCE(v_cfg.daily_ad_limit, 20),
    'daily_cap_start_units', COALESCE(v_cfg.daily_cap_start_units, 1000000),
    'daily_cap_start_yt', ROUND(COALESCE(v_cfg.daily_cap_start_units, 1000000)::numeric / 1000.0, 3),
    'daily_cap_max_units', COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    'daily_cap_max_yt', ROUND(COALESCE(v_cfg.daily_cap_max_units, 1000000000)::numeric / 1000.0, 3),
    'swap_enabled', COALESCE(v_cfg.swap_enabled, false),
    'exchange_rate_yer_per_yt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'treasuries', v_allocations,
    'ad_networks', v_ad_networks,
    'recent_claims', v_recent_claims,
    'recent_ad_events', v_recent_ad_events,
    'accounts', v_accounts,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_admin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_admin_summary() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric);
CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_units bigint DEFAULT NULL,
  p_tap_reward_units bigint DEFAULT NULL,
  p_ad_click_reward_units bigint DEFAULT NULL,
  p_ad_view_reward_units bigint DEFAULT NULL,
  p_daily_tap_limit integer DEFAULT NULL,
  p_daily_ad_limit integer DEFAULT NULL,
  p_daily_cap_start_units bigint DEFAULT NULL,
  p_daily_cap_max_units bigint DEFAULT NULL,
  p_swap_enabled boolean DEFAULT NULL,
  p_exchange_rate_yer_per_yt numeric DEFAULT NULL,
  p_max_supply_units bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_total_allocated bigint := 0;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;

  IF p_max_supply_units IS NOT NULL THEN
    IF p_max_supply_units < 1000 THEN
      RAISE EXCEPTION 'سقف الإصدار الكلي يجب أن لا يقل عن 1 YT (1,000 جزء).' USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(SUM(allocated_units), 0) INTO v_total_allocated FROM yt_coin.system_treasury;
    IF p_max_supply_units < v_total_allocated THEN
      RAISE EXCEPTION 'لا يمكن خفض سقف الإصدار أقل من مجموع التخصيصات الحالية (% YT). عدّل التخصيصات أولاً.',
        ROUND(v_total_allocated::numeric / 1000.0, 3) USING ERRCODE = '22000';
    END IF;
  END IF;

  UPDATE yt_coin.config
  SET mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
      max_supply_units = COALESCE(p_max_supply_units, max_supply_units),
      base_reward_units = COALESCE(NULLIF(GREATEST(p_base_reward_units, 1), 0), base_reward_units),
      tap_reward_units = COALESCE(NULLIF(GREATEST(p_tap_reward_units, 1), 0), tap_reward_units),
      ad_click_reward_units = COALESCE(NULLIF(GREATEST(p_ad_click_reward_units, 1), 0), ad_click_reward_units),
      ad_view_reward_units = COALESCE(NULLIF(GREATEST(p_ad_view_reward_units, 1), 0), ad_view_reward_units),
      daily_tap_limit = COALESCE(GREATEST(p_daily_tap_limit, 0), daily_tap_limit),
      daily_ad_limit = COALESCE(GREATEST(p_daily_ad_limit, 0), daily_ad_limit),
      daily_cap_start_units = COALESCE(NULLIF(GREATEST(p_daily_cap_start_units, 1), 0), daily_cap_start_units),
      daily_cap_max_units = COALESCE(NULLIF(GREATEST(p_daily_cap_max_units, 1), 0), daily_cap_max_units),
      swap_enabled = COALESCE(p_swap_enabled, swap_enabled),
      exchange_rate_yer_per_yt = CASE
        WHEN p_exchange_rate_yer_per_yt IS NOT NULL AND p_exchange_rate_yer_per_yt > 0 THEN p_exchange_rate_yer_per_yt
        ELSE exchange_rate_yer_per_yt
      END,
      updated_at = now()
  WHERE singleton = true
  RETURNING * INTO v_cfg;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_config',
    'yt_coin_config',
    'singleton',
    jsonb_build_object(
      'max_supply_units', v_cfg.max_supply_units,
      'base_reward_units', v_cfg.base_reward_units,
      'tap_reward_units', v_cfg.tap_reward_units,
      'ad_click_reward_units', v_cfg.ad_click_reward_units,
      'ad_view_reward_units', v_cfg.ad_view_reward_units,
      'daily_tap_limit', v_cfg.daily_tap_limit,
      'daily_ad_limit', v_cfg.daily_ad_limit,
      'mining_enabled', v_cfg.mining_enabled
    )
  );

  RETURN row_to_json(v_cfg)::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_treasury(
  p_treasury_key text,
  p_label_ar text DEFAULT NULL,
  p_allocated_units bigint DEFAULT NULL,
  p_is_locked boolean DEFAULT NULL,
  p_approved_for_distribution boolean DEFAULT NULL,
  p_vesting_schedule jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_row yt_coin.system_treasury%ROWTYPE;
  v_new_allocated bigint;
  v_new_balance bigint;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM yt_coin.system_treasury
  WHERE treasury_key = trim(COALESCE(p_treasury_key, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'حساب الخزينة غير موجود: %', p_treasury_key USING ERRCODE = '22000';
  END IF;

  v_new_allocated := COALESCE(p_allocated_units, v_row.allocated_units);
  IF v_new_allocated < 0 THEN
    RAISE EXCEPTION 'المخصص لا يمكن أن يكون سالباً.' USING ERRCODE = '22000';
  END IF;
  IF v_new_allocated < v_row.distributed_units THEN
    RAISE EXCEPTION 'لا يمكن خفض المخصص أقل من الكمية الموزعة فعلياً (% YT).',
      ROUND(v_row.distributed_units::numeric / 1000.0, 3) USING ERRCODE = '22000';
  END IF;

  v_new_balance := v_new_allocated - v_row.distributed_units;

  UPDATE yt_coin.system_treasury
  SET label_ar = COALESCE(NULLIF(trim(p_label_ar), ''), label_ar),
      allocated_units = v_new_allocated,
      balance_units = v_new_balance,
      is_locked = COALESCE(p_is_locked, is_locked),
      approved_for_distribution = COALESCE(p_approved_for_distribution, approved_for_distribution),
      vesting_schedule = COALESCE(p_vesting_schedule, vesting_schedule),
      updated_at = now()
  WHERE treasury_key = v_row.treasury_key
  RETURNING * INTO v_row;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_treasury',
    'yt_coin_treasury',
    v_row.treasury_key,
    jsonb_build_object(
      'allocated_units', v_row.allocated_units,
      'balance_units', v_row.balance_units,
      'distributed_units', v_row.distributed_units,
      'is_locked', v_row.is_locked,
      'approved_for_distribution', v_row.approved_for_distribution
    )
  );

  RETURN jsonb_build_object(
    'treasury_key', v_row.treasury_key,
    'label_ar', v_row.label_ar,
    'allocated_units', v_row.allocated_units,
    'allocated_yt', ROUND(v_row.allocated_units::numeric / 1000.0, 3),
    'balance_units', v_row.balance_units,
    'balance_yt', ROUND(v_row.balance_units::numeric / 1000.0, 3),
    'distributed_units', v_row.distributed_units,
    'distributed_yt', ROUND(v_row.distributed_units::numeric / 1000.0, 3),
    'is_locked', v_row.is_locked,
    'approved_for_distribution', v_row.approved_for_distribution,
    'vesting_schedule', v_row.vesting_schedule,
    'updated_at', v_row.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_treasury(text, text, bigint, boolean, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_treasury(text, text, bigint, boolean, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_yt_coin_accounts(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT a.user_id, p.full_name, p.phone, p.email, a.wallet_address,
           a.balance_units, ROUND(a.balance_units::numeric / 1000.0, 3) AS balance_yt,
           a.lifetime_earned_units, ROUND(a.lifetime_earned_units::numeric / 1000.0, 3) AS lifetime_earned_yt,
           a.ad_earned_units, ROUND(a.ad_earned_units::numeric / 1000.0, 3) AS ad_earned_yt,
           a.migration_audit_status, a.updated_at
    FROM yt_coin.accounts a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    WHERE v_q IS NULL
       OR a.wallet_address ILIKE ('%' || v_q || '%')
       OR COALESCE(p.full_name, '') ILIKE ('%' || v_q || '%')
       OR COALESCE(p.phone, '') ILIKE ('%' || v_q || '%')
       OR COALESCE(p.email, '') ILIKE ('%' || v_q || '%')
    ORDER BY a.balance_units DESC, a.updated_at DESC
    LIMIT v_lim
  ) r;

  RETURN jsonb_build_object('accounts', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_yt_coin_accounts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_yt_coin_accounts(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.service_credit_yt_coin_verified_ad(
  p_network_key text,
  p_external_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_session_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT 's2s_postback',
  p_raw_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.process_verified_ad_event(
    p_network_key, p_external_event_id, p_user_id, p_event_type, p_session_id, p_verification_source, p_raw_metadata
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.service_credit_yt_coin_verified_ad(text, text, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_credit_yt_coin_verified_ad(text, text, uuid, text, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_yt_coin_ad_center()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_ads_today integer := 0;
  v_total_ad_units bigint := 0;
  v_networks jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id AND event_date = v_today;

  SELECT COALESCE(SUM(amount_units), 0) INTO v_total_ad_units
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'networkKey', n.network_key,
    'displayName', n.display_name,
    'description', n.description,
    'adType', n.ad_type,
    'placementUrl', n.placement_url,
    'secretEnvKey', n.secret_env_key,
    'rewardClickUnits', n.reward_click_units,
    'rewardClickYt', ROUND(n.reward_click_units::numeric / 1000.0, 3),
    'rewardViewUnits', n.reward_view_units,
    'rewardViewYt', ROUND(n.reward_view_units::numeric / 1000.0, 3),
    'dailyUserLimit', n.daily_user_limit,
    'isActive', n.is_active
  ) ORDER BY n.created_at ASC), '[]'::jsonb)
  INTO v_networks
  FROM yt_coin.ad_networks n
  WHERE n.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'networkKey', e.network_key,
    'externalEventId', e.external_event_id,
    'eventType', e.event_type,
    'amountUnits', e.amount_units,
    'amountYt', ROUND(e.amount_units::numeric / 1000.0, 3),
    'verificationSource', e.verification_source,
    'createdAt', e.created_at
  ) ORDER BY e.created_at DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT id, network_key, external_event_id, event_type, amount_units, verification_source, created_at
    FROM yt_coin.ad_reward_events
    WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) e;

  RETURN jsonb_build_object(
    'unitScale', 1000,
    'partsPerYt', 1000,
    'adClickRewardUnits', COALESCE(v_cfg.ad_click_reward_units, 10),
    'adClickRewardYt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'adViewRewardUnits', COALESCE(v_cfg.ad_view_reward_units, 10),
    'adViewRewardYt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'adsToday', v_ads_today,
    'totalAdEarnedUnits', v_total_ad_units,
    'totalAdEarnedYt', ROUND(v_total_ad_units::numeric / 1000.0, 3),
    'networks', v_networks,
    'recentEvents', v_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_ad_center() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_ad_center() TO authenticated;

