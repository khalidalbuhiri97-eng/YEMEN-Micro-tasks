-- ==============================================================================
-- Migration 032: Unify Financial System Directly on Yemeni Rial (YER, 6 Decimals),
--                Eliminate All Legacy Micro-Unit Scaling (* 1,000,000),
--                Upgrade Remaining BIGINT RPCs to NUMERIC(30,6),
--                Enforce 70/30 ClixWall Split (User + PLATFORM-REVENUE-CLIXWALL),
--                and Reconcile Historical ClixWall Balances Non-Destructively
-- Platform: Yemen Micro-tasks (كسب اليمن)
--
-- ROLLBACK SQL (If ever needed after applying Migration 032):
--   -- Do NOT delete ledger_transactions/ledger_entries (append-only).
--   -- Instead, inspect public.financial_migration_032_backup and reverse any
--   -- transactions whose idempotency_key starts with 'MIGRATION-032:' or
--   -- 'CLIXWALL:T-TEST%REVERSAL' via new offsetting ledger entries, then remove
--   -- the appended reversal rows in clixwall_postbacks after disabling
--   -- trg_prevent_clixwall_postbacks_mutation, and re-enable the trigger.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. BACKUP SNAPSHOT & AUDIT TRAIL TABLES (IDEMPOTENT)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_migration_032_backup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('financial_accounts', 'clixwall_postbacks')),
    record_id UUID NOT NULL,
    payload JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fin_mig_032_backup UNIQUE (snapshot_type, record_id)
);

CREATE TABLE IF NOT EXISTS public.financial_migration_032_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.financial_migration_032_backup FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_migration_032_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.financial_migration_032_backup TO service_role;
GRANT ALL ON public.financial_migration_032_audit TO service_role;

ALTER TABLE public.financial_migration_032_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_migration_032_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_only_mig_032_backup" ON public.financial_migration_032_backup;
CREATE POLICY "service_only_mig_032_backup" ON public.financial_migration_032_backup
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_only_mig_032_audit" ON public.financial_migration_032_audit;
CREATE POLICY "service_only_mig_032_audit" ON public.financial_migration_032_audit
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Capture pre-migration snapshot ONCE ONLY so repeated runs preserve original state
INSERT INTO public.financial_migration_032_backup (snapshot_type, record_id, payload)
SELECT 'financial_accounts', fa.id, to_jsonb(fa)
FROM public.financial_accounts fa
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_migration_032_backup b
    WHERE b.snapshot_type = 'financial_accounts'
);

INSERT INTO public.financial_migration_032_backup (snapshot_type, record_id, payload)
SELECT 'clixwall_postbacks', cp.id, to_jsonb(cp)
FROM public.clixwall_postbacks cp
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_migration_032_backup b
    WHERE b.snapshot_type = 'clixwall_postbacks'
);

-- ------------------------------------------------------------------------------
-- 2. ENSURE CLIXWALL CHART OF ACCOUNTS & 6-DECIMAL PRECISION COLUMNS
-- ------------------------------------------------------------------------------
INSERT INTO public.financial_accounts (
    id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
)
SELECT
    gen_random_uuid(), 'CLIXWALL-RECEIVABLE', 'asset', NULL, NULL, 'debit', 0.000000, 'active', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_accounts WHERE account_code = 'CLIXWALL-RECEIVABLE'
);

INSERT INTO public.financial_accounts (
    id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
)
SELECT
    gen_random_uuid(), 'PLATFORM-REVENUE-CLIXWALL', 'revenue', NULL, NULL, 'credit', 0.000000, 'active', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-CLIXWALL'
);

ALTER TABLE public.clixwall_postbacks
    ADD COLUMN IF NOT EXISTS publisher_reward_yer NUMERIC(30,6) NOT NULL DEFAULT 0.000000;

DO $$
BEGIN
    IF to_regclass('public.referral_rewards') IS NOT NULL THEN
        ALTER TABLE public.referral_rewards
            ALTER COLUMN reward_amount TYPE NUMERIC(30,6) USING ROUND(COALESCE(reward_amount, 0)::numeric, 6);
    END IF;
    IF to_regclass('public.tasks') IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'commission_units'
    ) THEN
        ALTER TABLE public.tasks
            ALTER COLUMN commission_units TYPE NUMERIC(30,6) USING ROUND(COALESCE(commission_units, 0)::numeric, 6);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. HARDEN post_ledger_transaction (GUARD OPTIONAL wallets BALANCE COLUMNS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_ledger_transaction(
    p_transaction_type TEXT,
    p_idempotency_key TEXT,
    p_reference TEXT,
    p_metadata JSONB,
    p_entries JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tx_id UUID;
    v_existing_tx_id UUID;
    v_entry JSONB;
    v_account_id UUID;
    v_side TEXT;
    v_amount_text TEXT;
    v_amount NUMERIC(30,6);
    v_memo TEXT;
    v_total_debit NUMERIC(30,6) := 0;
    v_total_credit NUMERIC(30,6) := 0;
    v_acc RECORD;
    v_new_balance NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
    v_sorted_ids UUID[];
    v_lock_id UUID;
    v_wallets_has_avail BOOLEAN := false;
    v_wallets_has_bal BOOLEAN := false;
    v_wallets_has_updated BOOLEAN := false;
BEGIN
    IF p_transaction_type IS NULL OR TRIM(p_transaction_type) = '' THEN
        RAISE EXCEPTION 'transaction_type is required';
    END IF;

    IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
        RAISE EXCEPTION 'post_ledger_transaction requires at least 2 entries';
    END IF;

    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        SELECT id INTO v_existing_tx_id
        FROM public.ledger_transactions
        WHERE idempotency_key = TRIM(p_idempotency_key)
        LIMIT 1;
        IF FOUND THEN
            RETURN v_existing_tx_id;
        END IF;
    END IF;

    v_sorted_ids := ARRAY[]::UUID[];
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_account_id := NULLIF(TRIM(COALESCE(v_entry->>'account_id', '')), '')::UUID;
        v_side := LOWER(TRIM(COALESCE(v_entry->>'side', v_entry->>'entry_side', '')));
        v_amount_text := NULLIF(TRIM(COALESCE(v_entry->>'amount_units', '')), '');

        IF v_account_id IS NULL THEN
            RAISE EXCEPTION 'Every ledger entry requires account_id';
        END IF;
        IF v_side NOT IN ('debit', 'credit') THEN
            RAISE EXCEPTION 'Entry side must be debit or credit, got: %', v_side;
        END IF;
        IF v_amount_text IS NULL OR v_amount_text !~ '^\d+(?:\.\d{1,6})?$' THEN
            RAISE EXCEPTION 'Invalid monetary amount_units format (max 6 decimals allowed): %', COALESCE(v_amount_text, 'NULL');
        END IF;

        v_amount := v_amount_text::NUMERIC(30,6);
        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'Ledger entry amount_units must be > 0, got: %', v_amount;
        END IF;

        IF v_side = 'debit' THEN
            v_total_debit := v_total_debit + v_amount;
        ELSE
            v_total_credit := v_total_credit + v_amount;
        END IF;

        IF NOT (v_account_id = ANY(v_sorted_ids)) THEN
            v_sorted_ids := array_append(v_sorted_ids, v_account_id);
        END IF;
    END LOOP;

    IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Unbalanced ledger transaction: debits (%) <> credits (%)', v_total_debit, v_total_credit;
    END IF;

    FOR v_lock_id IN SELECT unnest(v_sorted_ids) AS aid ORDER BY 1
    LOOP
        PERFORM id FROM public.financial_accounts WHERE id = v_lock_id FOR UPDATE;
    END LOOP;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'available_balance'
    ) INTO v_wallets_has_avail;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balance'
    ) INTO v_wallets_has_bal;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'updated_at'
    ) INTO v_wallets_has_updated;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        TRIM(p_transaction_type),
        NULLIF(TRIM(COALESCE(p_reference, '')), ''),
        NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''),
        'posted',
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('currency', 'YER', 'unit_scale', 1),
        auth.uid(),
        v_now
    )
    RETURNING id INTO v_tx_id;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_account_id := (v_entry->>'account_id')::UUID;
        v_side := LOWER(TRIM(COALESCE(v_entry->>'side', v_entry->>'entry_side')));
        v_amount := (v_entry->>'amount_units')::NUMERIC(30,6);
        v_memo := NULLIF(TRIM(COALESCE(v_entry->>'memo', '')), '');

        SELECT * INTO v_acc FROM public.financial_accounts WHERE id = v_account_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial account not found: %', v_account_id;
        END IF;
        IF LOWER(COALESCE(v_acc.status, 'active')) <> 'active' THEN
            RAISE EXCEPTION 'Financial account % is not active', v_acc.account_code;
        END IF;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES (v_tx_id, v_account_id, v_side, v_amount, v_memo, v_now);

        v_new_balance := ROUND(
            COALESCE(v_acc.balance_units, 0)::NUMERIC(30,6)
            + CASE WHEN LOWER(v_acc.normal_side) = v_side THEN v_amount ELSE -v_amount END,
            6
        );

        IF v_new_balance < 0 THEN
            RAISE EXCEPTION 'Insufficient balance on account % (available %, delta resulted in %)',
                v_acc.account_code, v_acc.balance_units, v_new_balance;
        END IF;

        UPDATE public.financial_accounts SET balance_units = v_new_balance WHERE id = v_account_id;

        IF v_acc.wallet_id IS NOT NULL AND LOWER(COALESCE(v_acc.account_type, '')) = 'wallet' THEN
            IF v_wallets_has_avail AND v_wallets_has_bal THEN
                IF v_wallets_has_updated THEN
                    UPDATE public.wallets SET available_balance = v_new_balance, balance = v_new_balance, updated_at = v_now WHERE id = v_acc.wallet_id;
                ELSE
                    UPDATE public.wallets SET available_balance = v_new_balance, balance = v_new_balance WHERE id = v_acc.wallet_id;
                END IF;
            ELSIF v_wallets_has_avail THEN
                UPDATE public.wallets SET available_balance = v_new_balance WHERE id = v_acc.wallet_id;
            ELSIF v_wallets_has_bal THEN
                UPDATE public.wallets SET balance = v_new_balance WHERE id = v_acc.wallet_id;
            END IF;
        END IF;
    END LOOP;

    RETURN v_tx_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. UPGRADE process_clixwall_postback TO EXACT DIRECT-YER 70/30 DOUBLE ENTRY
--    - Keeps exact 9-parameter signature expected by server/clixwallHandlers.ts
--    - Credit:
--        total_yer     = ROUND((user_payout_usd + publisher_payout_usd) * 1600, 6)
--        user_yer      = ROUND(total_yer * 0.70, 6)  -> Credit WALLET-*
--        publisher_yer = total_yer - user_yer        -> Credit PLATFORM-REVENUE-CLIXWALL
--        Debit CLIXWALL-RECEIVABLE by total_yer (100% balanced!)
--    - Reversal:
--        Debits WALLET-* (user_yer) & PLATFORM-REVENUE-CLIXWALL (publisher_yer),
--        Credits CLIXWALL-RECEIVABLE (total_yer).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_clixwall_postback(
    p_transaction_id TEXT,
    p_user_id UUID,
    p_offer_id TEXT,
    p_offer_name TEXT,
    p_user_payout_usd NUMERIC,
    p_publisher_payout_usd NUMERIC,
    p_status TEXT DEFAULT 'credited',
    p_raw_status TEXT DEFAULT '1',
    p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_credit_row RECORD;
    v_reversal_exists BOOLEAN := FALSE;
    v_exchange_rate NUMERIC(30,6) := 1600.000000;
    v_total_usd NUMERIC(30,8);
    v_total_yer NUMERIC(30,6);
    v_user_yer NUMERIC(30,6);
    v_publisher_yer NUMERIC(30,6);
    v_wallet_id UUID;
    v_user_wallet_acc RECORD;
    v_clixwall_acc RECORD;
    v_pub_rev_acc RECORD;
    v_ledger_tx_id UUID;
    v_postback_id UUID;
    v_lock_ids UUID[];
    v_clean_tid TEXT := btrim(COALESCE(p_transaction_id, ''));
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
       AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
        RAISE EXCEPTION 'FORBIDDEN_FINANCIAL_RPC';
    END IF;

    IF v_clean_tid = '' THEN
        RAISE EXCEPTION 'MISSING_TRANSACTION_ID';
    END IF;

    IF p_status NOT IN ('credited', 'reversed') THEN
        RAISE EXCEPTION 'INVALID_POSTBACK_STATUS';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('clixwall:' || v_clean_tid));

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'UNKNOWN_USER';
    END IF;

    SELECT id, user_id, reward_yer, publisher_reward_yer, user_payout_usd, publisher_payout_usd, offer_id, offer_name
      INTO v_credit_row
      FROM public.clixwall_postbacks
     WHERE transaction_id = v_clean_tid
       AND status = 'credited'
     LIMIT 1;

    SELECT EXISTS (
        SELECT 1
          FROM public.clixwall_postbacks
         WHERE transaction_id = v_clean_tid
           AND status = 'reversed'
    ) INTO v_reversal_exists;

    -- -------------------------------------------------------------------------
    -- A. Reversal Event (Append-Only, Exact Original User + Publisher Shares)
    -- -------------------------------------------------------------------------
    IF p_status = 'reversed' THEN
        IF v_credit_row.id IS NULL THEN
            RAISE EXCEPTION 'REVERSAL_WITHOUT_ORIGINAL_CREDIT';
        END IF;

        IF v_reversal_exists THEN
            RETURN jsonb_build_object('ok', true, 'reversal', true, 'duplicate', true);
        END IF;

        v_user_yer := ROUND(COALESCE(v_credit_row.reward_yer, COALESCE(v_credit_row.user_payout_usd, 0) * v_exchange_rate), 6);
        v_publisher_yer := ROUND(COALESCE(v_credit_row.publisher_reward_yer, 0), 6);
        v_total_yer := ROUND(v_user_yer + v_publisher_yer, 6);

        IF v_user_yer <= 0 OR v_total_yer <= 0 THEN
            RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT';
        END IF;

        SELECT id INTO v_wallet_id
          FROM public.wallets
         WHERE user_id = v_credit_row.user_id
         ORDER BY created_at ASC
         LIMIT 1;

        SELECT * INTO v_user_wallet_acc
          FROM public.financial_accounts
         WHERE account_type = 'wallet'
           AND (
               (v_wallet_id IS NOT NULL AND wallet_id = v_wallet_id)
               OR owner_user_id = v_credit_row.user_id
           )
         ORDER BY created_at ASC
         LIMIT 1;

        SELECT * INTO v_clixwall_acc
          FROM public.financial_accounts
         WHERE account_code = 'CLIXWALL-RECEIVABLE'
         LIMIT 1;

        SELECT * INTO v_pub_rev_acc
          FROM public.financial_accounts
         WHERE account_code = 'PLATFORM-REVENUE-CLIXWALL'
         LIMIT 1;

        IF v_user_wallet_acc.id IS NULL OR v_clixwall_acc.id IS NULL THEN
            RAISE EXCEPTION 'FINANCIAL_ACCOUNTS_UNAVAILABLE';
        END IF;

        v_lock_ids := ARRAY[v_user_wallet_acc.id, v_clixwall_acc.id];
        IF v_publisher_yer > 0 AND v_pub_rev_acc.id IS NOT NULL THEN
            v_lock_ids := array_append(v_lock_ids, v_pub_rev_acc.id);
        END IF;

        PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

        SELECT * INTO v_user_wallet_acc FROM public.financial_accounts WHERE id = v_user_wallet_acc.id;
        SELECT * INTO v_clixwall_acc FROM public.financial_accounts WHERE id = v_clixwall_acc.id;

        IF v_user_wallet_acc.balance_units < v_user_yer THEN
            RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE_FOR_REVERSAL';
        END IF;
        IF v_clixwall_acc.balance_units < v_total_yer THEN
            RAISE EXCEPTION 'INSUFFICIENT_RECEIVABLE_BALANCE_FOR_REVERSAL';
        END IF;

        IF v_publisher_yer > 0 THEN
            IF v_pub_rev_acc.id IS NULL THEN
                RAISE EXCEPTION 'FINANCIAL_ACCOUNTS_UNAVAILABLE';
            END IF;
            SELECT * INTO v_pub_rev_acc FROM public.financial_accounts WHERE id = v_pub_rev_acc.id;
            IF v_pub_rev_acc.balance_units < v_publisher_yer THEN
                RAISE EXCEPTION 'INSUFFICIENT_PUBLISHER_REVENUE_FOR_REVERSAL';
            END IF;
        END IF;

        INSERT INTO public.ledger_transactions (
            id, transaction_type, reference, idempotency_key, status, metadata, created_at
        ) VALUES (
            gen_random_uuid(),
            'CLIXWALL_REVERSAL',
            'CLIXWALL:' || v_clean_tid,
            'CLIXWALL:' || v_clean_tid || ':REVERSAL',
            'posted',
            jsonb_build_object(
                'provider', 'ClixWall',
                'currency', 'YER',
                'unit_scale', 1,
                'original_transaction_id', v_clean_tid,
                'user_id', v_credit_row.user_id,
                'user_payout_usd', v_credit_row.user_payout_usd,
                'publisher_payout_usd', v_credit_row.publisher_payout_usd,
                'total_yer', v_total_yer,
                'reward_yer', v_user_yer,
                'publisher_reward_yer', v_publisher_yer,
                'exchange_rate', v_exchange_rate
            ),
            v_now
        )
        RETURNING id INTO v_ledger_tx_id;

        INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc.id, 'debit', v_user_yer, 'استرجاع حصة المستخدم من مكافأة ClixWall (70%)', v_now),
            (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc.id, 'credit', v_total_yer, 'عكس ذمم عرض ClixWall المسترد', v_now);

        IF v_publisher_yer > 0 THEN
            INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES (gen_random_uuid(), v_ledger_tx_id, v_pub_rev_acc.id, 'debit', v_publisher_yer, 'استرجاع حصة المنصة/الناشر من عرض ClixWall (30%)', v_now);

            UPDATE public.financial_accounts
               SET balance_units = ROUND(balance_units - v_publisher_yer, 6)
             WHERE id = v_pub_rev_acc.id;
        END IF;

        UPDATE public.financial_accounts
           SET balance_units = ROUND(balance_units - v_user_yer, 6)
         WHERE id = v_user_wallet_acc.id;

        UPDATE public.financial_accounts
           SET balance_units = ROUND(balance_units - v_total_yer, 6)
         WHERE id = v_clixwall_acc.id;

        INSERT INTO public.clixwall_postbacks (
            id, transaction_id, user_id, offer_id, offer_name, status,
            user_payout_usd, publisher_payout_usd, exchange_rate,
            reward_yer, publisher_reward_yer, ledger_transaction_id, raw_status, payload, created_at
        ) VALUES (
            gen_random_uuid(),
            v_clean_tid,
            v_credit_row.user_id,
            COALESCE(p_offer_id, v_credit_row.offer_id),
            COALESCE(p_offer_name, v_credit_row.offer_name),
            'reversed',
            v_credit_row.user_payout_usd,
            v_credit_row.publisher_payout_usd,
            v_exchange_rate,
            v_user_yer,
            v_publisher_yer,
            v_ledger_tx_id,
            p_raw_status,
            COALESCE(p_payload, '{}'::jsonb),
            v_now
        )
        RETURNING id INTO v_postback_id;

        RETURN jsonb_build_object(
            'ok', true,
            'reversal', true,
            'duplicate', false,
            'postback_id', v_postback_id,
            'total_yer', v_total_yer,
            'reward_yer', v_user_yer,
            'publisher_reward_yer', v_publisher_yer
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- B. Credit Event (Idempotent 70/30 Split Directly in YER)
    -- -------------------------------------------------------------------------
    IF v_credit_row.id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'status', 'credited', 'duplicate', true);
    END IF;

    IF v_reversal_exists THEN
        RETURN jsonb_build_object('ok', true, 'status', 'reversed', 'duplicate', true);
    END IF;

    IF COALESCE(p_user_payout_usd, 0) <= 0 OR COALESCE(p_publisher_payout_usd, 0) <= 0 THEN
        RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT';
    END IF;

    v_total_usd := COALESCE(p_user_payout_usd, 0) + COALESCE(p_publisher_payout_usd, 0);
    v_total_yer := ROUND(v_total_usd * v_exchange_rate, 6);
    v_user_yer := ROUND(v_total_yer * 0.70, 6);
    v_publisher_yer := ROUND(v_total_yer - v_user_yer, 6);

    IF v_total_yer <= 0 OR v_user_yer <= 0 OR v_publisher_yer <= 0 THEN
        RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT';
    END IF;

    SELECT * INTO v_clixwall_acc
      FROM public.financial_accounts
     WHERE account_code = 'CLIXWALL-RECEIVABLE'
     LIMIT 1;

    IF v_clixwall_acc.id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'CLIXWALL-RECEIVABLE', 'asset', NULL, NULL, 'debit', 0.000000, 'active', v_now
        )
        RETURNING * INTO v_clixwall_acc;
    END IF;

    SELECT * INTO v_pub_rev_acc
      FROM public.financial_accounts
     WHERE account_code = 'PLATFORM-REVENUE-CLIXWALL'
     LIMIT 1;

    IF v_pub_rev_acc.id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'PLATFORM-REVENUE-CLIXWALL', 'revenue', NULL, NULL, 'credit', 0.000000, 'active', v_now
        )
        RETURNING * INTO v_pub_rev_acc;
    END IF;

    INSERT INTO public.wallets (id, user_id, wallet_address, status)
    VALUES (
        gen_random_uuid(),
        p_user_id,
        'KY-' || upper(substring(md5(p_user_id::text || '_kasb_wallet_salt_yemen_v1'), 1, 12)),
        'active'
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO v_wallet_id
      FROM public.wallets
     WHERE user_id = p_user_id
     ORDER BY created_at ASC
     LIMIT 1;

    SELECT * INTO v_user_wallet_acc
      FROM public.financial_accounts
     WHERE account_type = 'wallet'
       AND (
           (v_wallet_id IS NOT NULL AND wallet_id = v_wallet_id)
           OR owner_user_id = p_user_id
       )
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_user_wallet_acc.id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, normal_side, balance_units, owner_user_id, wallet_id, status, created_at
        ) VALUES (
            gen_random_uuid(),
            'WALLET-' || COALESCE(v_wallet_id::text, substring(p_user_id::text, 1, 8)),
            'wallet',
            'credit',
            0.000000,
            p_user_id,
            v_wallet_id,
            'active',
            v_now
        )
        RETURNING * INTO v_user_wallet_acc;
    END IF;

    PERFORM id
      FROM public.financial_accounts
     WHERE id IN (v_clixwall_acc.id, v_user_wallet_acc.id, v_pub_rev_acc.id)
     ORDER BY id ASC
     FOR UPDATE;

    INSERT INTO public.ledger_transactions (
        id, transaction_type, reference, idempotency_key, status, metadata, created_at
    ) VALUES (
        gen_random_uuid(),
        'CLIXWALL_REWARD',
        'CLIXWALL:' || v_clean_tid,
        'CLIXWALL:' || v_clean_tid || ':CREDIT',
        'posted',
        jsonb_build_object(
            'provider', 'ClixWall',
            'currency', 'YER',
            'unit_scale', 1,
            'transaction_id', v_clean_tid,
            'user_id', p_user_id,
            'offer_id', p_offer_id,
            'offer_name', p_offer_name,
            'total_usd', v_total_usd,
            'user_payout_usd', p_user_payout_usd,
            'publisher_payout_usd', p_publisher_payout_usd,
            'exchange_rate', v_exchange_rate,
            'total_yer', v_total_yer,
            'reward_yer', v_user_yer,
            'publisher_reward_yer', v_publisher_yer
        ),
        v_now
    )
    RETURNING id INTO v_ledger_tx_id;

    -- Balanced 3-leg Double Entry:
    -- DEBIT CLIXWALL-RECEIVABLE (100% total_yer) = CREDIT User Wallet (70% user_yer) + CREDIT PLATFORM-REVENUE-CLIXWALL (30% publisher_yer)
    INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc.id, 'debit', v_total_yer, 'ذمم عرض ClixWall الإجمالية (100%)', v_now),
        (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc.id, 'credit', v_user_yer, 'مكافأة المستخدم من عرض ClixWall (70%)', v_now),
        (gen_random_uuid(), v_ledger_tx_id, v_pub_rev_acc.id, 'credit', v_publisher_yer, 'إيراد الناشر/المنصة من عرض ClixWall (30%)', v_now);

    UPDATE public.financial_accounts
       SET balance_units = ROUND(balance_units + v_total_yer, 6)
     WHERE id = v_clixwall_acc.id;

    UPDATE public.financial_accounts
       SET balance_units = ROUND(balance_units + v_user_yer, 6)
     WHERE id = v_user_wallet_acc.id;

    UPDATE public.financial_accounts
       SET balance_units = ROUND(balance_units + v_publisher_yer, 6)
     WHERE id = v_pub_rev_acc.id;

    INSERT INTO public.clixwall_postbacks (
        id, transaction_id, user_id, offer_id, offer_name, status,
        user_payout_usd, publisher_payout_usd, exchange_rate,
        reward_yer, publisher_reward_yer, ledger_transaction_id, raw_status, payload, created_at
    ) VALUES (
        gen_random_uuid(),
        v_clean_tid,
        p_user_id,
        p_offer_id,
        p_offer_name,
        'credited',
        p_user_payout_usd,
        p_publisher_payout_usd,
        v_exchange_rate,
        v_user_yer,
        v_publisher_yer,
        v_ledger_tx_id,
        p_raw_status,
        COALESCE(p_payload, '{}'::jsonb),
        v_now
    )
    RETURNING id INTO v_postback_id;

    RETURN jsonb_build_object(
        'ok', true,
        'status', 'credited',
        'duplicate', false,
        'postback_id', v_postback_id,
        'total_yer', v_total_yer,
        'reward_yer', v_user_yer,
        'publisher_reward_yer', v_publisher_yer
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_clixwall_postback(
    TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_clixwall_postback(
    TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, JSONB
) TO service_role;

-- ------------------------------------------------------------------------------
-- 5. UPGRADE REMAINING LEGACY BIGINT FINANCIAL RPCS TO NUMERIC(30,6) YER
-- ------------------------------------------------------------------------------

-- 5a. review_task_submission(UUID, TEXT, TEXT) RETURNS UUID
CREATE OR REPLACE FUNCTION public.review_task_submission(
    p_submission_id UUID,
    p_decision TEXT,
    p_review_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_decision TEXT := LOWER(TRIM(COALESCE(p_decision, '')));
    v_clean_note TEXT := NULLIF(TRIM(COALESCE(p_review_note, '')), '');
    v_now TIMESTAMPTZ := NOW();
    v_sub RECORD;
    v_task RECORD;
    v_wallet RECORD;
    v_escrow_acc RECORD;
    v_wallet_acc RECORD;
    v_rev_tasks_acc RECORD;
    v_rev_tasks_acc_id UUID := NULL;
    v_existing_tx RECORD;
    v_tx_id UUID;
    v_comm_tx_id UUID := NULL;
    v_idempotency_key TEXT;
    v_legacy_idempotency_key TEXT;
    v_comm_idempotency_key TEXT;
    v_reward_units NUMERIC(30,6);
    v_commission_units NUMERIC(30,6) := 0;
    v_total_escrow_debit NUMERIC(30,6);
    v_escrow_new_bal NUMERIC(30,6);
    v_wallet_new_bal NUMERIC(30,6);
    v_rev_new_bal NUMERIC(30,6);
    v_rows_affected INT := 0;
    v_lock_ids UUID[];
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF p_submission_id IS NULL THEN
        RAISE EXCEPTION 'Submission ID is required';
    END IF;

    IF v_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Decision must be approve or reject';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('review_task_submission_' || p_submission_id::text));

    SELECT * INTO v_sub FROM public.task_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found';
    END IF;

    v_idempotency_key := 'TASK_REWARD_PAYOUT:' || p_submission_id::text;
    v_legacy_idempotency_key := 'TASK-REWARD:' || p_submission_id::text;
    v_comm_idempotency_key := 'TASK-COMMISSION:' || p_submission_id::text;

    IF LOWER(v_sub.status) = 'approved' THEN
        IF v_decision = 'reject' THEN
            RAISE EXCEPTION 'Cannot reject an already approved submission';
        END IF;
        RETURN v_sub.reward_transaction_id;
    END IF;

    IF LOWER(v_sub.status) = 'rejected' THEN
        IF v_decision = 'approve' THEN
            RAISE EXCEPTION 'Cannot approve an already rejected submission';
        END IF;
        RETURN NULL::uuid;
    END IF;

    IF v_decision = 'reject' THEN
        UPDATE public.task_submissions
        SET status = 'rejected',
            review_note = v_clean_note,
            reviewed_by = v_admin_id,
            reviewed_at = v_now
        WHERE id = p_submission_id;

        INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
        VALUES (
            v_admin_id, 'REJECT_SUBMISSION', 'task_submission', p_submission_id,
            jsonb_build_object('task_id', v_sub.task_id, 'user_id', v_sub.user_id, 'review_note', v_clean_note),
            v_now
        );

        RETURN NULL::uuid;
    END IF;

    SELECT id INTO v_existing_tx
    FROM public.ledger_transactions
    WHERE idempotency_key IN (v_idempotency_key, v_legacy_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
        UPDATE public.task_submissions
        SET status = 'approved',
            reward_transaction_id = COALESCE(reward_transaction_id, v_existing_tx.id),
            reviewed_by = COALESCE(reviewed_by, v_admin_id),
            reviewed_at = COALESCE(reviewed_at, v_now)
        WHERE id = p_submission_id;

        RETURN v_existing_tx.id;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
    v_reward_units := ROUND(COALESCE(v_task.reward_units, 0)::numeric, 6);
    IF v_reward_units <= 0 THEN RAISE EXCEPTION 'Invalid task reward units'; END IF;
    IF v_task.approved_count >= v_task.slots THEN RAISE EXCEPTION 'Task slots have already been filled'; END IF;
    IF v_task.escrow_account_id IS NULL THEN RAISE EXCEPTION 'Task ESCROW account is not configured or funded'; END IF;

    v_commission_units := ROUND(GREATEST(0, COALESCE(v_task.commission_units, 0)::numeric), 6);

    IF v_commission_units > 0 THEN
        SELECT * INTO v_rev_tasks_acc
        FROM public.financial_accounts
        WHERE account_code = 'PLATFORM-REVENUE-TASKS'
        LIMIT 1;

        IF NOT FOUND OR LOWER(v_rev_tasks_acc.status) <> 'active' THEN
            RAISE EXCEPTION 'حساب إيرادات المهام (PLATFORM-REVENUE-TASKS) غير موجود أو غير مفعل؛ تم إيقاف اعتماد المهمة دون أي خصم جزئي.';
        END IF;
        v_rev_tasks_acc_id := v_rev_tasks_acc.id;
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_sub.user_id LIMIT 1;
    IF NOT FOUND OR LOWER(v_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'Performer wallet not found or inactive';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Performer financial account not found or inactive'; END IF;

    IF v_task.escrow_account_id = v_wallet_acc.id THEN
        RAISE EXCEPTION 'Escrow account cannot equal performer wallet account';
    END IF;

    v_lock_ids := ARRAY[v_task.escrow_account_id, v_wallet_acc.id];
    IF v_rev_tasks_acc_id IS NOT NULL THEN
        v_lock_ids := array_append(v_lock_ids, v_rev_tasks_acc_id);
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    SELECT * INTO v_escrow_acc FROM public.financial_accounts WHERE id = v_task.escrow_account_id;
    IF NOT FOUND OR LOWER(v_escrow_acc.status) <> 'active' THEN
        RAISE EXCEPTION 'Task ESCROW account not found or inactive';
    END IF;

    v_total_escrow_debit := ROUND(v_reward_units + v_commission_units, 6);
    IF v_escrow_acc.balance_units < v_total_escrow_debit THEN
        RAISE EXCEPTION 'رصيد ضمان المهمة غير كافٍ لتغطية المكافأة والعمولة (المتاح %، المطلوب %)',
            v_escrow_acc.balance_units, v_total_escrow_debit;
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'TASK_REWARD_PAYOUT',
        'TASK-SUBMISSION:' || p_submission_id::text,
        v_idempotency_key,
        'posted',
        jsonb_build_object(
            'task_id', v_task.id,
            'task_title', v_task.title,
            'submission_id', p_submission_id,
            'performer_user_id', v_sub.user_id,
            'wallet_id', v_wallet.id,
            'reward_units', v_reward_units,
            'commission_units', v_commission_units,
            'currency', 'YER',
            'unit_scale', 1
        ),
        v_admin_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_escrow_acc.id, 'debit', v_reward_units, 'صرف مكافأة مهمة من الضمان: ' || v_task.title, v_now),
        (v_tx_id, v_wallet_acc.id, 'credit', v_reward_units, 'مكافأة إنجاز مهمة: ' || v_task.title, v_now);

    IF v_commission_units > 0 THEN
        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'TASK_COMMISSION_REVENUE',
            'TASK-SUBMISSION:' || p_submission_id::text,
            v_comm_idempotency_key,
            'posted',
            jsonb_build_object(
                'task_id', v_task.id,
                'submission_id', p_submission_id,
                'commission_units', v_commission_units,
                'currency', 'YER',
                'unit_scale', 1,
                'description', 'عمولة المنصة من المهمة: ' || v_task.title
            ),
            v_admin_id,
            v_now
        )
        RETURNING id INTO v_comm_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_comm_tx_id, v_escrow_acc.id, 'debit', v_commission_units, 'خصم عمولة المنصة من ضمان المهمة: ' || v_task.title, v_now),
            (v_comm_tx_id, v_rev_tasks_acc_id, 'credit', v_commission_units, 'إيراد عمولة مهمة: ' || v_task.title, v_now);

        UPDATE public.financial_accounts
        SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_commission_units ELSE -v_commission_units END, 6)
        WHERE id = v_rev_tasks_acc_id
        RETURNING balance_units INTO v_rev_new_bal;

        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected <> 1 OR v_rev_new_bal < 0 THEN
            RAISE EXCEPTION 'Failed to update PLATFORM-REVENUE-TASKS balance safely';
        END IF;
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_total_escrow_debit ELSE -v_total_escrow_debit END, 6)
    WHERE id = v_escrow_acc.id
    RETURNING balance_units INTO v_escrow_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_escrow_new_bal < 0 THEN
        RAISE EXCEPTION 'Failed to update ESCROW balance safely';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_reward_units ELSE -v_reward_units END, 6)
    WHERE id = v_wallet_acc.id
    RETURNING balance_units INTO v_wallet_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_wallet_new_bal < 0 THEN
        RAISE EXCEPTION 'Failed to update performer wallet balance safely';
    END IF;

    UPDATE public.task_submissions
    SET status = 'approved',
        review_note = v_clean_note,
        reviewed_by = v_admin_id,
        reviewed_at = v_now,
        reward_transaction_id = v_tx_id
    WHERE id = p_submission_id;

    UPDATE public.tasks
    SET approved_count = approved_count + 1,
        budget_spent_yer = ROUND(COALESCE(budget_spent_yer, 0)::numeric + v_total_escrow_debit, 6),
        status = CASE WHEN approved_count + 1 >= slots THEN 'completed' ELSE status END
    WHERE id = v_task.id;

    INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
        v_admin_id, 'APPROVE_SUBMISSION_PAYOUT', 'task_submission', p_submission_id,
        jsonb_build_object(
            'task_id', v_task.id, 'performer_user_id', v_sub.user_id,
            'reward_units', v_reward_units, 'commission_units', v_commission_units,
            'transaction_id', v_tx_id, 'commission_transaction_id', v_comm_tx_id,
            'escrow_new_balance', v_escrow_new_bal, 'wallet_new_balance', v_wallet_new_bal
        ),
        v_now
    );

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'TASK_SUBMISSION_APPROVED',
        v_admin_id,
        v_tx_id,
        jsonb_build_object(
            'submission_id', p_submission_id,
            'task_id', v_task.id,
            'reward_units', v_reward_units,
            'commission_units', v_commission_units,
            'commission_transaction_id', v_comm_tx_id
        ),
        v_now
    );

    IF to_regprocedure('public.process_referral_reward_for_submission(uuid)') IS NOT NULL THEN
        PERFORM public.process_referral_reward_for_submission(p_submission_id);
    END IF;

    RETURN v_tx_id;
END;
$$;

-- 5b. post_owner_financial_operation (Drop BIGINT overload, recreate with NUMERIC(30,6))
DROP FUNCTION IF EXISTS public.post_owner_financial_operation(TEXT, BIGINT, TEXT, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.post_owner_financial_operation(TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB);

CREATE OR REPLACE FUNCTION public.post_owner_financial_operation(
    p_operation_type TEXT,
    p_amount_units NUMERIC,
    p_description TEXT,
    p_idempotency_key TEXT DEFAULT NULL,
    p_credit_to_treasury BOOLEAN DEFAULT true,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_op TEXT := UPPER(TRIM(COALESCE(p_operation_type, '')));
    v_key TEXT := COALESCE(NULLIF(TRIM(p_idempotency_key), ''), v_op || ':' || gen_random_uuid()::text);
    v_amount NUMERIC(30,6);
    v_existing RECORD;
    v_tx_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_treasury RECORD;
    v_issuance RECORD;
    v_cash_vault RECORD;
    v_owner_cap RECORD;
    v_owner_wd RECORD;
    v_expenses RECORD;
    v_exp_clear RECORD;
    v_rev_acc RECORD;
    v_target_rev_code TEXT;
    v_new_bal NUMERIC(30,6);
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;
    IF p_amount_units IS NULL OR p_amount_units <= 0 OR p_amount_units <> ROUND(p_amount_units, 6) THEN
        RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر وبحد أقصى 6 منازل عشرية.';
    END IF;
    v_amount := ROUND(p_amount_units, 6);

    IF TRIM(COALESCE(p_description, '')) = '' THEN
        RAISE EXCEPTION 'البيان المحاسبي مطلوب.';
    END IF;
    IF v_op NOT IN ('OWNER_CAPITAL_DEPOSIT', 'OPERATIONAL_EXPENSE', 'OWNER_WITHDRAWAL', 'AD_REVENUE', 'SUBSCRIPTION_REVENUE', 'SERVICE_REVENUE') THEN
        RAISE EXCEPTION 'نوع العملية المالية غير مدعوم: %', v_op;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('owner_fin_op_' || v_key));

    SELECT id INTO v_existing FROM public.ledger_transactions WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'transactionId', v_existing.id, 'operationType', v_op);
    END IF;

    PERFORM id FROM public.financial_accounts
    WHERE account_code IN (
        'OWNER-CAPITAL', 'OWNER-WITHDRAWALS', 'PLATFORM-CASH-VAULT',
        'PLATFORM-EXPENSE-CLEARING', 'PLATFORM-EXPENSES', 'PLATFORM-TREASURY',
        'PLATFORM-REVENUE-ADS', 'PLATFORM-REVENUE-SERVICES', 'PLATFORM-REVENUE-SUBSCRIPTIONS',
        'VIRTUAL-ISSUANCE-CONTROL'
    )
    ORDER BY id ASC
    FOR UPDATE;

    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY';
    SELECT * INTO v_issuance FROM public.financial_accounts WHERE account_code = 'VIRTUAL-ISSUANCE-CONTROL';
    SELECT * INTO v_cash_vault FROM public.financial_accounts WHERE account_code = 'PLATFORM-CASH-VAULT';
    SELECT * INTO v_owner_cap FROM public.financial_accounts WHERE account_code = 'OWNER-CAPITAL';
    SELECT * INTO v_owner_wd FROM public.financial_accounts WHERE account_code = 'OWNER-WITHDRAWALS';
    SELECT * INTO v_expenses FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSES';
    SELECT * INTO v_exp_clear FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSE-CLEARING';

    IF v_treasury.id IS NULL OR v_issuance.id IS NULL OR v_cash_vault.id IS NULL
       OR v_owner_cap.id IS NULL OR v_owner_wd.id IS NULL OR v_expenses.id IS NULL OR v_exp_clear.id IS NULL THEN
        RAISE EXCEPTION 'الحسابات الأساسية للخزينة غير مكتملة في public.financial_accounts.';
    END IF;

    IF v_op IN ('OPERATIONAL_EXPENSE', 'OWNER_WITHDRAWAL') THEN
        IF v_treasury.balance_units < v_amount OR v_issuance.balance_units < v_amount THEN
            RAISE EXCEPTION 'رصيد الخزينة المتاح غير كافٍ لتنفيذ العملية.';
        END IF;
    END IF;

    IF v_op IN ('AD_REVENUE', 'SUBSCRIPTION_REVENUE', 'SERVICE_REVENUE') THEN
        v_target_rev_code := CASE
            WHEN v_op = 'AD_REVENUE' THEN 'PLATFORM-REVENUE-ADS'
            WHEN v_op = 'SUBSCRIPTION_REVENUE' THEN 'PLATFORM-REVENUE-SUBSCRIPTIONS'
            ELSE 'PLATFORM-REVENUE-SERVICES'
        END;
        SELECT * INTO v_rev_acc FROM public.financial_accounts WHERE account_code = v_target_rev_code;
        IF NOT FOUND OR LOWER(v_rev_acc.status) <> 'active' THEN
            RAISE EXCEPTION 'حساب الإيراد المطلوب (%) غير موجود أو غير مفعل.', v_target_rev_code;
        END IF;
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        v_op, v_op, v_key, 'posted',
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('description', TRIM(p_description), 'amount_units', v_amount, 'actor_id', v_admin_id, 'currency', 'YER', 'unit_scale', 1),
        v_admin_id, v_now
    ) RETURNING id INTO v_tx_id;

    IF v_op = 'OWNER_CAPITAL_DEPOSIT' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_cash_vault.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_owner_cap.id, 'credit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'debit', v_amount, 'تغطية إصدار خزينة برأس مال المالك', v_now),
            (v_tx_id, v_treasury.id, 'credit', v_amount, 'إيداع رأس مال المالك في الخزينة التشغيلية', v_now);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_cash_vault.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-CASH-VAULT'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_owner_cap.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on OWNER-CAPITAL'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
    ELSIF v_op = 'OPERATIONAL_EXPENSE' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_treasury.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', v_amount, 'سحب وحدات من الخزينة لمصروف تشغيلي', v_now),
            (v_tx_id, v_expenses.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', v_amount, 'مقابل تسوية المصروف التشغيلي', v_now);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_expenses.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSES'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_exp_clear.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSE-CLEARING'; END IF;
    ELSIF v_op = 'OWNER_WITHDRAWAL' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_treasury.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', v_amount, 'سحب شخصي للمالك من الخزينة', v_now),
            (v_tx_id, v_owner_wd.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', v_amount, 'تسوية سحب المالك الشخصي', v_now);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_owner_wd.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on OWNER-WITHDRAWALS'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_exp_clear.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSE-CLEARING'; END IF;
    ELSE
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_cash_vault.id, 'debit', v_amount, TRIM(p_description), v_now),
            (v_tx_id, v_rev_acc.id, 'credit', v_amount, TRIM(p_description), v_now);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_cash_vault.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-CASH-VAULT'; END IF;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_rev_acc.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on revenue account'; END IF;

        IF COALESCE(p_credit_to_treasury, true) THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
                (v_tx_id, v_issuance.id, 'debit', v_amount, 'تغطية خزينة من إيراد: ' || v_op, v_now),
                (v_tx_id, v_treasury.id, 'credit', v_amount, 'إضافة إيراد إلى الخزينة التشغيلية', v_now);

            UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
            UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        END IF;
    END IF;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (v_op, v_admin_id, v_tx_id, jsonb_build_object('amount_units', v_amount, 'description', TRIM(p_description), 'credit_to_treasury', p_credit_to_treasury), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'transactionId', v_tx_id, 'operationType', v_op, 'amountUnits', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.post_owner_financial_operation(TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_owner_financial_operation(TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated, service_role;

-- 5c. release_task_escrow(UUID, TEXT)
CREATE OR REPLACE FUNCTION public.release_task_escrow(
    p_task_id UUID,
    p_reason TEXT DEFAULT 'إلغاء المهمة وتحرير المتبقي من الضمان للخزينة'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_task RECORD;
    v_escrow RECORD;
    v_treasury RECORD;
    v_tx_id UUID;
    v_remaining NUMERIC(30,6);
    v_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
    v_key TEXT;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('release_task_escrow_' || p_task_id::text));

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة.'; END IF;

    v_key := 'TASK-ESCROW-RELEASE:' || p_task_id::text;
    SELECT id INTO v_tx_id FROM public.ledger_transactions WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'released_units', 0, 'transaction_id', v_tx_id);
    END IF;

    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' LIMIT 1;
    SELECT * INTO v_escrow FROM public.financial_accounts WHERE id = v_task.escrow_account_id LIMIT 1;
    IF v_escrow.id IS NULL THEN
        SELECT * INTO v_escrow FROM public.financial_accounts WHERE account_code = 'TASK-ESCROW-' || p_task_id::text LIMIT 1;
    END IF;

    IF v_escrow.id IS NULL OR v_treasury.id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'idempotent', false, 'released_units', 0, 'transaction_id', NULL);
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id IN (v_escrow.id, v_treasury.id) ORDER BY id ASC FOR UPDATE;
    SELECT ROUND(COALESCE(balance_units, 0)::numeric, 6) INTO v_remaining FROM public.financial_accounts WHERE id = v_escrow.id;

    IF COALESCE(v_remaining, 0) <= 0 THEN
        RETURN jsonb_build_object('success', true, 'idempotent', false, 'released_units', 0, 'transaction_id', NULL);
    END IF;

    INSERT INTO public.ledger_transactions (transaction_type, reference, idempotency_key, status, metadata, created_by, created_at)
    VALUES ('TASK_BUDGET_REFUND', 'TASK:' || p_task_id::text, v_key, 'posted', jsonb_build_object('task_id', p_task_id, 'released_units', v_remaining, 'reason', TRIM(COALESCE(p_reason, '')), 'currency', 'YER', 'unit_scale', 1, 'description', 'تحرير المتبقي من ضمان المهمة للخزينة'), v_admin_id, v_now)
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
        (v_tx_id, v_escrow.id, 'debit', v_remaining, TRIM(COALESCE(p_reason, 'تحرير ضمان المهمة')), v_now),
        (v_tx_id, v_treasury.id, 'credit', v_remaining, 'استرجاع رصيد ضمان المهمة إلى الخزينة', v_now);

    UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_remaining ELSE -v_remaining END, 6) WHERE id = v_escrow.id RETURNING balance_units INTO v_new_bal;
    IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on task escrow'; END IF;

    UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_remaining ELSE -v_remaining END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
    IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on treasury'; END IF;

    UPDATE public.tasks SET status = 'cancelled' WHERE id = p_task_id;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES ('TASK_ESCROW_RELEASE', v_admin_id, v_tx_id, jsonb_build_object('task_id', p_task_id, 'released_units', v_remaining, 'reason', p_reason), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'released_units', v_remaining, 'transaction_id', v_tx_id);
END;
$$;

-- 5d. reverse_ledger_transaction(UUID, TEXT)
CREATE OR REPLACE FUNCTION public.reverse_ledger_transaction(
    p_transaction_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_orig RECORD;
    v_existing_rev RECORD;
    v_rev_id UUID;
    v_rev_key TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_entry RECORD;
    v_swapped_side TEXT;
    v_acc RECORD;
    v_delta NUMERIC(30,6);
    v_new_bal NUMERIC(30,6);
    v_lock_ids UUID[];
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'سبب القيد العكسي مطلوب.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('reverse_tx_' || p_transaction_id::text));

    v_rev_key := 'REVERSAL:' || p_transaction_id::text;
    SELECT id INTO v_existing_rev FROM public.ledger_transactions WHERE idempotency_key = v_rev_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'original_transaction_id', p_transaction_id, 'reversal_transaction_id', v_existing_rev.id);
    END IF;

    SELECT * INTO v_orig FROM public.ledger_transactions WHERE id = p_transaction_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة الأصلية غير موجودة.'; END IF;
    IF UPPER(v_orig.transaction_type) LIKE 'REVERSAL\_%' THEN
        RAISE EXCEPTION 'لا يمكن عكس قيد عكسي.';
    END IF;

    SELECT ARRAY_AGG(DISTINCT account_id ORDER BY account_id ASC)
    INTO v_lock_ids
    FROM public.ledger_entries
    WHERE transaction_id = p_transaction_id;

    IF v_lock_ids IS NULL OR array_length(v_lock_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'لا توجد قيود فرعية للمعاملة المطلوب عكسها.';
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REVERSAL_' || v_orig.transaction_type,
        'REVERSAL:' || p_transaction_id::text,
        v_rev_key,
        'posted',
        jsonb_build_object('original_transaction_id', p_transaction_id, 'original_type', v_orig.transaction_type, 'reason', TRIM(p_reason), 'currency', 'YER', 'unit_scale', 1, 'description', 'قيد عكسي للمعاملة #' || p_transaction_id::text || ': ' || TRIM(p_reason)),
        v_admin_id,
        v_now
    ) RETURNING id INTO v_rev_id;

    FOR v_entry IN SELECT * FROM public.ledger_entries WHERE transaction_id = p_transaction_id ORDER BY id ASC LOOP
        v_swapped_side := CASE WHEN LOWER(v_entry.entry_side) = 'debit' THEN 'credit' ELSE 'debit' END;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES (v_rev_id, v_entry.account_id, v_swapped_side, ROUND(v_entry.amount_units::numeric, 6), 'قيد عكسي: ' || TRIM(p_reason), v_now);

        SELECT * INTO v_acc FROM public.financial_accounts WHERE id = v_entry.account_id;
        v_delta := ROUND(CASE WHEN LOWER(v_acc.normal_side) = v_swapped_side THEN v_entry.amount_units ELSE -v_entry.amount_units END::numeric, 6);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + v_delta, 6) WHERE id = v_acc.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN
            RAISE EXCEPTION 'لا يمكن تنفيذ القيد العكسي لأن الرصيد الحالي للحساب (%) غير كافٍ.', v_acc.account_code;
        END IF;
    END LOOP;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES ('REVERSE_TRANSACTION', v_admin_id, v_rev_id, jsonb_build_object('original_transaction_id', p_transaction_id, 'reason', TRIM(p_reason)), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'original_transaction_id', p_transaction_id, 'reversal_transaction_id', v_rev_id);
END;
$$;

-- 5e. process_referral_reward_for_submission(UUID) & settle_pending_referral_reward(UUID)
CREATE OR REPLACE FUNCTION public.process_referral_reward_for_submission(p_submission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_user RECORD;
    v_referrer RECORD;
    v_existing RECORD;
    v_approved_count INT := 0;
    v_bonus NUMERIC(30,6) := 0;
    v_ref_wallet RECORD;
    v_ref_wallet_acc RECORD;
    v_treasury RECORD;
    v_tx_id UUID;
    v_reward_id UUID;
    v_idem_key TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_new_treasury_bal NUMERIC(30,6);
    v_new_wallet_bal NUMERIC(30,6);
    v_rows INT := 0;
BEGIN
    IF p_submission_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'missing_submission_id');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('referral_sub_' || p_submission_id::text));

    SELECT * INTO v_sub FROM public.task_submissions WHERE id = p_submission_id;
    IF NOT FOUND OR LOWER(v_sub.status) <> 'approved' OR v_sub.reward_transaction_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'submission_not_approved_with_ledger');
    END IF;

    SELECT * INTO v_user FROM public.profiles WHERE id = v_sub.user_id;
    IF NOT FOUND OR v_user.referred_by IS NULL OR v_user.referred_by = v_user.id THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'no_valid_referrer');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('referral_user_' || v_user.id::text));

    SELECT * INTO v_existing FROM public.referral_rewards WHERE referred_user_id = v_user.id LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'eligible', false, 'idempotent', true, 'reason', 'already_recorded',
            'referral_reward_id', v_existing.id, 'status', v_existing.status
        );
    END IF;

    SELECT COUNT(*) INTO v_approved_count
    FROM public.task_submissions
    WHERE user_id = v_sub.user_id AND LOWER(status) = 'approved' AND reward_transaction_id IS NOT NULL;

    IF v_approved_count <> 1 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_first_approved_task', 'approved_count', v_approved_count);
    END IF;

    v_bonus := ROUND(COALESCE(public.get_configured_referral_bonus(), 0)::numeric, 6);
    IF v_bonus <= 0 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'referral_bonus_disabled_or_zero');
    END IF;

    v_idem_key := 'REFERRAL-REWARD:' || v_sub.user_id::text;

    SELECT * INTO v_referrer FROM public.profiles WHERE id = v_user.referred_by;
    IF NOT FOUND OR LOWER(COALESCE(v_referrer.account_status, 'active')) <> 'active' THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'rejected', v_idem_key, 'حساب المُحيل غير نشط أو غير موجود', v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', false, 'paid', false, 'status', 'rejected', 'referral_reward_id', v_reward_id);
    END IF;

    SELECT * INTO v_ref_wallet FROM public.wallets WHERE user_id = v_user.referred_by ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND OR LOWER(v_ref_wallet.status) <> 'active' THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'محفظة المُحيل غير مهيأة أو غير نشطة', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'referral_reward_id', v_reward_id);
    END IF;

    SELECT * INTO v_ref_wallet_acc FROM public.financial_accounts WHERE wallet_id = v_ref_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active' LIMIT 1;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' AND LOWER(status) = 'active' LIMIT 1;

    IF v_ref_wallet_acc.id IS NULL OR v_treasury.id IS NULL THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'حساب الخزينة أو الحساب المالي للمُحيل غير متوفر', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'referral_reward_id', v_reward_id);
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id IN (v_treasury.id, v_ref_wallet_acc.id) ORDER BY id ASC FOR UPDATE;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE id = v_treasury.id;
    SELECT * INTO v_ref_wallet_acc FROM public.financial_accounts WHERE id = v_ref_wallet_acc.id;

    IF v_treasury.balance_units < v_bonus THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'رصيد خزينة المنصة (PLATFORM-TREASURY) غير كافٍ لصرف المكافأة تلقائياً', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'reason', 'insufficient_treasury_balance', 'referral_reward_id', v_reward_id);
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REFERRAL_REWARD', 'REFERRAL:' || v_sub.user_id::text, v_idem_key, 'posted',
        jsonb_build_object('referrer_id', v_user.referred_by, 'referred_user_id', v_sub.user_id, 'submission_id', p_submission_id, 'task_id', v_sub.task_id, 'reward_units', v_bonus, 'currency', 'YER', 'unit_scale', 1, 'description', 'مكافأة إحالة بعد اعتماد أول مهمة للمدعو'),
        v_sub.reviewed_by, v_now
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_treasury.id, 'debit', v_bonus, 'صرف مكافأة إحالة من خزينة المنصة', v_now),
        (v_tx_id, v_ref_wallet_acc.id, 'credit', v_bonus, 'مكافأة دعوة صديق بعد إنجاز أول مهمة معتمدة', v_now);

    UPDATE public.financial_accounts
    SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_bonus ELSE -v_bonus END, 6)
    WHERE id = v_treasury.id RETURNING balance_units INTO v_new_treasury_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_treasury_bal < 0 THEN RAISE EXCEPTION 'Failed to debit PLATFORM-TREASURY safely for referral reward'; END IF;

    UPDATE public.financial_accounts
    SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_bonus ELSE -v_bonus END, 6)
    WHERE id = v_ref_wallet_acc.id RETURNING balance_units INTO v_new_wallet_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_wallet_bal < 0 THEN RAISE EXCEPTION 'Failed to credit referrer wallet safely for referral reward'; END IF;

    INSERT INTO public.referral_rewards (
        referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
        status, ledger_transaction_id, idempotency_key, approved_at, paid_at, created_at, updated_at
    ) VALUES (
        v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
        'paid', v_tx_id, v_idem_key, v_now, v_now, v_now, v_now
    ) RETURNING id INTO v_reward_id;

    IF to_regclass('public.notifications') IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
        VALUES (v_user.referred_by, 'تم إضافة مكافأة إحالة إلى محفظتك!', 'أكمل صديقك مهمته الأولى المعتمدة وتم إضافة ' || v_bonus::text || ' ر.ي إلى محفظتك.', 'REFERRAL_REWARD', '/dashboard/referrals', v_now);
    END IF;

    IF to_regclass('public.financial_audit_logs') IS NOT NULL THEN
        INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
        VALUES ('REFERRAL_REWARD_PAID', v_sub.reviewed_by, v_tx_id, jsonb_build_object('referral_reward_id', v_reward_id, 'referrer_id', v_user.referred_by, 'referred_user_id', v_sub.user_id, 'submission_id', p_submission_id, 'reward_amount', v_bonus), v_now);
    END IF;

    RETURN jsonb_build_object('eligible', true, 'paid', true, 'status', 'paid', 'referral_reward_id', v_reward_id, 'transaction_id', v_tx_id, 'reward_amount', v_bonus);
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral_reward_for_submission(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward_for_submission(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_pending_referral_reward(p_referral_reward_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_rr RECORD;
    v_ref_wallet RECORD;
    v_ref_wallet_acc RECORD;
    v_treasury RECORD;
    v_tx_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_reward_amt NUMERIC(30,6);
    v_new_bal NUMERIC(30,6);
    v_rows INT := 0;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_referral_' || p_referral_reward_id::text));

    SELECT * INTO v_rr FROM public.referral_rewards WHERE id = p_referral_reward_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'سجل مكافأة الإحالة غير موجود.'; END IF;
    IF v_rr.status = 'paid' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', 'paid', 'transaction_id', v_rr.ledger_transaction_id);
    END IF;
    IF v_rr.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'لا يمكن صرف مكافأة إحالة بحالة (%).', v_rr.status;
    END IF;

    v_reward_amt := ROUND(COALESCE(v_rr.reward_amount, 0)::numeric, 6);

    SELECT * INTO v_ref_wallet FROM public.wallets WHERE user_id = v_rr.referrer_id ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND OR LOWER(v_ref_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'محفظة المُحيل غير نشطة أو غير موجودة.';
    END IF;

    SELECT * INTO v_ref_wallet_acc FROM public.financial_accounts WHERE wallet_id = v_ref_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active' LIMIT 1;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' AND LOWER(status) = 'active' LIMIT 1;
    IF v_ref_wallet_acc.id IS NULL OR v_treasury.id IS NULL THEN
        RAISE EXCEPTION 'الحسابات المالية المطلوبة لصرف مكافأة الإحالة غير مكتملة.';
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id IN (v_treasury.id, v_ref_wallet_acc.id) ORDER BY id ASC FOR UPDATE;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE id = v_treasury.id;
    IF v_treasury.balance_units < v_reward_amt THEN
        RAISE EXCEPTION 'رصيد خزينة المنصة (%) غير كافٍ لصرف مكافأة الإحالة (%).', v_treasury.balance_units, v_reward_amt;
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REFERRAL_REWARD', 'REFERRAL:' || v_rr.referred_user_id::text, v_rr.idempotency_key, 'posted',
        jsonb_build_object('referrer_id', v_rr.referrer_id, 'referred_user_id', v_rr.referred_user_id, 'submission_id', v_rr.trigger_submission_id, 'reward_units', v_reward_amt, 'currency', 'YER', 'unit_scale', 1, 'description', 'تسوية مكافأة إحالة معلقة'),
        v_admin_id, v_now
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_treasury.id, 'debit', v_reward_amt, 'صرف مكافأة إحالة من خزينة المنصة', v_now),
        (v_tx_id, v_ref_wallet_acc.id, 'credit', v_reward_amt, 'مكافأة دعوة صديق بعد إنجاز أول مهمة معتمدة', v_now);

    UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_reward_amt ELSE -v_reward_amt END, 6) WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_bal < 0 THEN RAISE EXCEPTION 'Failed to debit PLATFORM-TREASURY safely'; END IF;

    UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_reward_amt ELSE -v_reward_amt END, 6) WHERE id = v_ref_wallet_acc.id RETURNING balance_units INTO v_new_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_bal < 0 THEN RAISE EXCEPTION 'Failed to credit referrer wallet safely'; END IF;

    UPDATE public.referral_rewards
    SET status = 'paid', ledger_transaction_id = v_tx_id, failure_reason = NULL, paid_at = v_now, updated_at = v_now
    WHERE id = v_rr.id;

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'paid', 'transaction_id', v_tx_id);
END;
$$;

-- 5f. approve_external_deposit(UUID, UUID)
CREATE OR REPLACE FUNCTION public.approve_external_deposit(
    p_deposit_id UUID,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_actor_id UUID := COALESCE(v_caller_id, p_actor_id);
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_dep RECORD;
    v_ext_acc RECORD;
    v_ext_fin_acc RECORD;
    v_credit_fin_acc RECORD;
    v_wallet RECORD;
    v_dup_count INT := 0;
    v_lock_ids UUID[];
    v_tx_id UUID;
    v_tx_type TEXT;
    v_idem_key TEXT;
    v_amount NUMERIC(30,6);
    v_ext_new_bal NUMERIC(30,6);
    v_credit_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة لاعتماد التحصيل اليدوي.' USING ERRCODE = '42501';
    END IF;

    IF p_deposit_id IS NULL THEN
        RAISE EXCEPTION 'معرف الإيداع مطلوب.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('approve_ext_deposit_' || p_deposit_id::text));

    SELECT * INTO v_dep FROM public.external_deposits WHERE id = p_deposit_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'سجل الإيداع غير موجود.'; END IF;

    IF v_dep.status = 'approved' AND v_dep.ledger_transaction_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true, 'idempotent', true, 'depositId', v_dep.id,
            'status', 'approved', 'transactionId', v_dep.ledger_transaction_id
        );
    END IF;

    IF v_dep.status <> 'pending' THEN
        RAISE EXCEPTION 'لا يمكن اعتماد إيداع حالته الحالية (%)', v_dep.status;
    END IF;

    v_amount := ROUND(COALESCE(v_dep.amount_units, 0)::numeric, 6);
    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'مبلغ الإيداع يجب أن يكون أكبر من صفر.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('ext_dep_ref_' || v_dep.reference_number_normalized));

    SELECT COUNT(*) INTO v_dup_count
    FROM public.external_deposits
    WHERE reference_number_normalized = v_dep.reference_number_normalized
      AND status = 'approved'
      AND id <> v_dep.id;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'الرقم المرجعي للإيصال (%) معتمد مسبقاً لإيداع آخر ولا يمكن اعتماده مرتين.', v_dep.reference_number;
    END IF;

    SELECT * INTO v_ext_acc FROM public.external_accounts WHERE id = v_dep.external_account_id;
    IF NOT FOUND OR v_ext_acc.status <> 'active' THEN
        RAISE EXCEPTION 'الحساب الخارجي غير موجود أو مجمد.';
    END IF;

    IF v_dep.deposit_purpose = 'advertiser_wallet' THEN
        SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_dep.advertiser_id ORDER BY created_at ASC LIMIT 1;
        IF NOT FOUND THEN
            INSERT INTO public.wallets (id, user_id, wallet_address, status, created_at)
            VALUES (
                gen_random_uuid(), v_dep.advertiser_id,
                'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(v_dep.advertiser_id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
                'active', v_now
            ) RETURNING * INTO v_wallet;
        END IF;

        SELECT * INTO v_credit_fin_acc FROM public.financial_accounts WHERE wallet_id = v_wallet.id AND account_type = 'wallet' LIMIT 1;
        IF NOT FOUND THEN
            INSERT INTO public.financial_accounts (
                id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
            ) VALUES (
                gen_random_uuid(), 'WALLET-' || v_wallet.id::text, 'wallet', v_dep.advertiser_id, v_wallet.id, 'credit', 0.000000, 'active', v_now
            ) RETURNING * INTO v_credit_fin_acc;
        END IF;
        v_tx_type := 'EXTERNAL_ADVERTISER_DEPOSIT';
    ELSE
        SELECT * INTO v_credit_fin_acc FROM public.financial_accounts WHERE account_code = 'OWNER-CAPITAL' LIMIT 1;
        IF NOT FOUND THEN RAISE EXCEPTION 'حساب رأس مال المالك OWNER-CAPITAL غير موجود.'; END IF;
        v_tx_type := 'EXTERNAL_CAPITAL_DEPOSIT';
    END IF;

    SELECT array_agg(x ORDER BY x) INTO v_lock_ids
    FROM unnest(ARRAY[v_ext_acc.financial_account_id, v_credit_fin_acc.id]) AS x;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    SELECT * INTO v_ext_fin_acc FROM public.financial_accounts WHERE id = v_ext_acc.financial_account_id;
    SELECT * INTO v_credit_fin_acc FROM public.financial_accounts WHERE id = v_credit_fin_acc.id;

    v_idem_key := 'EXT-DEP-APPROVE:' || v_dep.id::text;

    SELECT id INTO v_tx_id FROM public.ledger_transactions WHERE idempotency_key = v_idem_key LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            v_tx_type, v_dep.reference_number, v_idem_key, 'posted',
            jsonb_build_object(
                'deposit_id', v_dep.id, 'external_account_id', v_ext_acc.id, 'external_account_name', v_ext_acc.account_name,
                'advertiser_id', v_dep.advertiser_id, 'deposit_purpose', v_dep.deposit_purpose,
                'reference_number', v_dep.reference_number, 'receipt_url', v_dep.receipt_url,
                'currency', 'YER', 'unit_scale', 1,
                'accounting_classification', CASE WHEN v_dep.deposit_purpose = 'advertiser_wallet' THEN 'ADVERTISER_LIABILITY' ELSE 'OWNER_EQUITY' END,
                'description', CASE
                    WHEN v_dep.deposit_purpose = 'advertiser_wallet'
                        THEN 'اعتماد تحصيل وشحن محفظة معلن (التزام للغير) عبر ' || v_ext_acc.account_name || ' - مرجع: ' || v_dep.reference_number
                    ELSE 'اعتماد إيداع رأسمالي بالحساب الخارجي ' || v_ext_acc.account_name || ' - مرجع: ' || v_dep.reference_number
                END
            ),
            v_actor_id, v_now
        ) RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_ext_fin_acc.id, 'debit', v_amount, 'تحصيل نقدي في الحساب الخارجي: ' || v_ext_acc.account_name || ' (' || v_dep.reference_number || ')', v_now),
            (v_tx_id, v_credit_fin_acc.id, 'credit', v_amount,
                CASE WHEN v_dep.deposit_purpose = 'advertiser_wallet'
                    THEN 'شحن محفظة المعلن (التزام غير مُستحق كإيراد) - مرجع: ' || v_dep.reference_number
                    ELSE 'إثبات رأس مال مضاف بالحساب الخارجي - مرجع: ' || v_dep.reference_number
                END,
                v_now);

        UPDATE public.financial_accounts
        SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_amount ELSE -v_amount END, 6)
        WHERE id = v_ext_fin_acc.id RETURNING balance_units INTO v_ext_new_bal;
        IF v_ext_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث رصيد الحساب الخارجي.'; END IF;

        UPDATE public.financial_accounts
        SET balance_units = ROUND(balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_amount ELSE -v_amount END, 6)
        WHERE id = v_credit_fin_acc.id RETURNING balance_units INTO v_credit_new_bal;
        IF v_credit_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث الرصيد الدائن.'; END IF;
    END IF;

    UPDATE public.external_deposits
    SET status = 'approved', reviewed_by = v_actor_id, reviewed_at = v_now,
        ledger_transaction_id = v_tx_id, idempotency_key = v_idem_key, updated_at = v_now
    WHERE id = v_dep.id;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        v_tx_type, v_actor_id, v_tx_id,
        jsonb_build_object('deposit_id', v_dep.id, 'external_account_id', v_ext_acc.id, 'advertiser_id', v_dep.advertiser_id, 'amount_units', v_amount, 'reference_number', v_dep.reference_number),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true, 'idempotent', false, 'depositId', v_dep.id, 'status', 'approved',
        'transactionId', v_tx_id, 'externalAccountBalance', v_ext_new_bal, 'targetAccountBalance', v_credit_new_bal
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. HISTORICAL CLIXWALL RECONCILIATION (NON-DESTRUCTIVE, IDEMPOTENT, BALANCED)
--    - Reconciles ONLY contaminated ClixWall accounts without touching intact
--      user wallets, escrows, or treasury:
--      * Khalid 1 (b643e5d1-... / WALLET-9dc94f10-...): 448014 -> 14.448000 YER
--      * Khalid 1 30% Publisher Share (T-CD38070348 & T-CD38070421): 0.192000 YER
--      * Khalid 2 (a6d10676-... / WALLET-bd9e3bf4-...): 2240000 -> 0.000000 YER
--      * CLIXWALL-RECEIVABLE: 2688000 -> 0.640000 YER
--      * PLATFORM-REVENUE-CLIXWALL: 0 -> 0.192000 YER
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_khalid1_wallet_id UUID;
    v_khalid2_wallet_id UUID;
    v_recv_id UUID;
    v_pub_rev_id UUID;
    v_k1_bal NUMERIC(30,6);
    v_k2_bal NUMERIC(30,6);
    v_recv_bal NUMERIC(30,6);
    v_tx_id UUID;
    v_rev_tx1_id UUID;
    v_rev_tx2_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT id INTO v_khalid1_wallet_id FROM public.financial_accounts WHERE account_code = 'WALLET-9dc94f10-3a79-420f-855e-27f9fe15efd0' LIMIT 1;
    SELECT id INTO v_khalid2_wallet_id FROM public.financial_accounts WHERE account_code = 'WALLET-bd9e3bf4-6e48-48a3-95f0-720647df985f' LIMIT 1;
    SELECT id INTO v_recv_id FROM public.financial_accounts WHERE account_code = 'CLIXWALL-RECEIVABLE' LIMIT 1;
    SELECT id INTO v_pub_rev_id FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-CLIXWALL' LIMIT 1;

    IF v_recv_id IS NULL OR v_pub_rev_id IS NULL THEN
        RAISE EXCEPTION 'MIGRATION_032_ERROR: Missing CLIXWALL-RECEIVABLE or PLATFORM-REVENUE-CLIXWALL';
    END IF;

    -- 6a. Reconcile Khalid 1 scale excess (448,000 -> 0.448000 YER, adjustment = 447,999.552000)
    IF v_khalid1_wallet_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.ledger_transactions WHERE idempotency_key = 'MIGRATION-032:RECONCILE-KHALID1-SCALE') THEN
        SELECT ROUND(balance_units::numeric, 6) INTO v_k1_bal FROM public.financial_accounts WHERE id = v_khalid1_wallet_id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_recv_id FOR UPDATE;

        -- Only apply if wallet is contaminated by the 448,000 historical micro-unit scale error (448,014 -> 14.448000)
        IF v_k1_bal >= 447999.552000 THEN
            INSERT INTO public.ledger_transactions (
                transaction_type, reference, idempotency_key, status, metadata, created_at
            ) VALUES (
                'CLIXWALL_SCALE_RECONCILIATION',
                'MIGRATION-032:KHALID1',
                'MIGRATION-032:RECONCILE-KHALID1-SCALE',
                'posted',
                jsonb_build_object(
                    'migration', '032',
                    'user_id', 'b643e5d1-85e8-44d3-bdee-40ff56670e10',
                    'reason', 'تصحيح فرق مقياس ClixWall التاريخي (448,000 وحدة -> 0.448000 ريال يمني مع بقاء رصيد المهام 14 ر.ي)',
                    'adjustment_yer', 447999.552000,
                    'expected_final_wallet_yer', 14.448000
                ),
                v_now
            ) RETURNING id INTO v_tx_id;

            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_tx_id, v_khalid1_wallet_id, 'debit', 447999.552000, 'تسوية تضخم مقياس ClixWall التاريخي على محفظة خالد 1', v_now),
                (v_tx_id, v_recv_id, 'credit', 447999.552000, 'تسوية تضخم مقياس ذمم ClixWall التاريخي لخالد 1', v_now);

            UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 447999.552000, 6) WHERE id = v_khalid1_wallet_id;
            UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 447999.552000, 6) WHERE id = v_recv_id;
        END IF;
    END IF;

    -- 6b. Record missing 30% publisher share for Khalid 1 real offers (T-CD38070348 & T-CD38070421: 2 * 0.096 = 0.192000 YER)
    IF NOT EXISTS (SELECT 1 FROM public.ledger_transactions WHERE idempotency_key = 'MIGRATION-032:RECOGNIZE-KHALID1-PUBLISHER-30') THEN
        PERFORM id FROM public.financial_accounts WHERE id IN (v_recv_id, v_pub_rev_id) ORDER BY id ASC FOR UPDATE;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_at
        ) VALUES (
            'CLIXWALL_PUBLISHER_REVENUE_RECOGNITION',
            'MIGRATION-032:PUBLISHER-30',
            'MIGRATION-032:RECOGNIZE-KHALID1-PUBLISHER-30',
            'posted',
            jsonb_build_object(
                'migration', '032',
                'transactions', jsonb_build_array('T-CD38070348', 'T-CD38070421'),
                'publisher_payout_usd_total', 0.000120,
                'exchange_rate', 1600,
                'publisher_reward_yer', 0.192000
            ),
            v_now
        ) RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_recv_id, 'debit', 0.192000, 'إثبات ذمم حصة الناشر 30% لعروض ClixWall الحقيقية السابقة', v_now),
            (v_tx_id, v_pub_rev_id, 'credit', 0.192000, 'إيراد المنصة 30% من عروض ClixWall الحقيقية السابقة', v_now);

        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + 0.192000, 6) WHERE id = v_recv_id;
        UPDATE public.financial_accounts SET balance_units = ROUND(balance_units + 0.192000, 6) WHERE id = v_pub_rev_id;
    END IF;

    -- 6c. Reverse Khalid 2 two unreversed test transactions (T-TEST1795018919443 & T-TEST1795018925960, 1,120,000 each)
    IF v_khalid2_wallet_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.ledger_transactions WHERE idempotency_key = 'CLIXWALL:T-TEST1795018919443:REVERSAL') THEN
            SELECT ROUND(balance_units::numeric, 6) INTO v_k2_bal FROM public.financial_accounts WHERE id = v_khalid2_wallet_id FOR UPDATE;
            IF v_k2_bal >= 1120000.000000 THEN
                INSERT INTO public.ledger_transactions (
                    transaction_type, reference, idempotency_key, status, metadata, created_at
                ) VALUES (
                    'CLIXWALL_REVERSAL',
                    'CLIXWALL:T-TEST1795018919443',
                    'CLIXWALL:T-TEST1795018919443:REVERSAL',
                    'posted',
                    jsonb_build_object('migration', '032', 'reason', 'عكس معاملة ClixWall تجريبية غير معكوسة (T-TEST1795018919443)', 'reward_yer', 1120000.000000),
                    v_now
                ) RETURNING id INTO v_rev_tx1_id;

                INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
                VALUES
                    (v_rev_tx1_id, v_khalid2_wallet_id, 'debit', 1120000.000000, 'عكس قيد اختبار T-TEST1795018919443', v_now),
                    (v_rev_tx1_id, v_recv_id, 'credit', 1120000.000000, 'عكس ذمة اختبار T-TEST1795018919443', v_now);

                UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 1120000.000000, 6) WHERE id = v_khalid2_wallet_id;
                UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 1120000.000000, 6) WHERE id = v_recv_id;
            END IF;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.ledger_transactions WHERE idempotency_key = 'CLIXWALL:T-TEST1795018925960:REVERSAL') THEN
            SELECT ROUND(balance_units::numeric, 6) INTO v_k2_bal FROM public.financial_accounts WHERE id = v_khalid2_wallet_id FOR UPDATE;
            IF v_k2_bal >= 1120000.000000 THEN
                INSERT INTO public.ledger_transactions (
                    transaction_type, reference, idempotency_key, status, metadata, created_at
                ) VALUES (
                    'CLIXWALL_REVERSAL',
                    'CLIXWALL:T-TEST1795018925960',
                    'CLIXWALL:T-TEST1795018925960:REVERSAL',
                    'posted',
                    jsonb_build_object('migration', '032', 'reason', 'عكس معاملة ClixWall تجريبية غير معكوسة (T-TEST1795018925960)', 'reward_yer', 1120000.000000),
                    v_now
                ) RETURNING id INTO v_rev_tx2_id;

                INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
                VALUES
                    (v_rev_tx2_id, v_khalid2_wallet_id, 'debit', 1120000.000000, 'عكس قيد اختبار T-TEST1795018925960', v_now),
                    (v_rev_tx2_id, v_recv_id, 'credit', 1120000.000000, 'عكس ذمة اختبار T-TEST1795018925960', v_now);

                UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 1120000.000000, 6) WHERE id = v_khalid2_wallet_id;
                UPDATE public.financial_accounts SET balance_units = ROUND(balance_units - 1120000.000000, 6) WHERE id = v_recv_id;
            END IF;
        END IF;
    END IF;

    -- 6d. Backfill publisher_reward_yer on T-CD38070348 & T-CD38070421 and append reversed rows for Khalid 2 test rows
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'clixwall_postbacks' AND t.tgname = 'trg_prevent_clixwall_postbacks_mutation'
    ) THEN
        ALTER TABLE public.clixwall_postbacks DISABLE TRIGGER trg_prevent_clixwall_postbacks_mutation;
    END IF;

    UPDATE public.clixwall_postbacks
    SET publisher_reward_yer = 0.096000
    WHERE transaction_id IN ('T-CD38070348', 'T-CD38070421')
      AND status = 'credited'
      AND COALESCE(publisher_reward_yer, 0) = 0;

    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'clixwall_postbacks' AND t.tgname = 'trg_prevent_clixwall_postbacks_mutation'
    ) THEN
        ALTER TABLE public.clixwall_postbacks ENABLE TRIGGER trg_prevent_clixwall_postbacks_mutation;
    END IF;

    SELECT id INTO v_rev_tx1_id FROM public.ledger_transactions WHERE idempotency_key = 'CLIXWALL:T-TEST1795018919443:REVERSAL' LIMIT 1;
    SELECT id INTO v_rev_tx2_id FROM public.ledger_transactions WHERE idempotency_key = 'CLIXWALL:T-TEST1795018925960:REVERSAL' LIMIT 1;

    IF v_rev_tx1_id IS NOT NULL THEN
        INSERT INTO public.clixwall_postbacks (
            transaction_id, user_id, offer_id, offer_name, status,
            user_payout_usd, publisher_payout_usd, exchange_rate,
            reward_yer, publisher_reward_yer, ledger_transaction_id, raw_status, payload, created_at
        )
        SELECT
            cp.transaction_id, cp.user_id, cp.offer_id, cp.offer_name, 'reversed',
            cp.user_payout_usd, cp.publisher_payout_usd, cp.exchange_rate,
            cp.reward_yer, 0.000000, v_rev_tx1_id, '2',
            jsonb_build_object('migration_032_reversal', true, 'reason', 'test_cleanup'), v_now
        FROM public.clixwall_postbacks cp
        WHERE cp.transaction_id = 'T-TEST1795018919443' AND cp.status = 'credited'
        ON CONFLICT (transaction_id, status) DO NOTHING;
    END IF;

    IF v_rev_tx2_id IS NOT NULL THEN
        INSERT INTO public.clixwall_postbacks (
            transaction_id, user_id, offer_id, offer_name, status,
            user_payout_usd, publisher_payout_usd, exchange_rate,
            reward_yer, publisher_reward_yer, ledger_transaction_id, raw_status, payload, created_at
        )
        SELECT
            cp.transaction_id, cp.user_id, cp.offer_id, cp.offer_name, 'reversed',
            cp.user_payout_usd, cp.publisher_payout_usd, cp.exchange_rate,
            cp.reward_yer, 0.000000, v_rev_tx2_id, '2',
            jsonb_build_object('migration_032_reversal', true, 'reason', 'test_cleanup'), v_now
        FROM public.clixwall_postbacks cp
        WHERE cp.transaction_id = 'T-TEST1795018925960' AND cp.status = 'credited'
        ON CONFLICT (transaction_id, status) DO NOTHING;
    END IF;

    INSERT INTO public.financial_migration_032_audit (step_code, description, details)
    VALUES (
        'HISTORICAL_CLIXWALL_RECONCILIATION',
        'Reconciled Khalid 1 (14.448000 YER), Khalid 2 (0.000000 YER), CLIXWALL-RECEIVABLE (0.640000 YER), and PLATFORM-REVENUE-CLIXWALL (0.192000 YER)',
        jsonb_build_object(
            'khalid1_wallet_id', v_khalid1_wallet_id,
            'khalid2_wallet_id', v_khalid2_wallet_id,
            'receivable_id', v_recv_id,
            'publisher_revenue_id', v_pub_rev_id
        )
    )
    ON CONFLICT (step_code) DO NOTHING;
END $$;

-- ------------------------------------------------------------------------------
-- 7. POST-MIGRATION STRICT DOUBLE-ENTRY & UNAFFECTED-WALLET INVARIANT CHECK
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_total_debit NUMERIC(30,6);
    v_total_credit NUMERIC(30,6);
    v_drift_count INT := 0;
    v_untouched_drift_count INT := 0;
    v_k1 NUMERIC(30,6);
    v_k2 NUMERIC(30,6);
    v_recv NUMERIC(30,6);
    v_pub_rev NUMERIC(30,6);
BEGIN
    SELECT
        ROUND(COALESCE(SUM(amount_units) FILTER (WHERE LOWER(entry_side) = 'debit'), 0)::numeric, 6),
        ROUND(COALESCE(SUM(amount_units) FILTER (WHERE LOWER(entry_side) = 'credit'), 0)::numeric, 6)
    INTO v_total_debit, v_total_credit
    FROM public.ledger_entries;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: Trial balance mismatch debits(%) <> credits(%)', v_total_debit, v_total_credit;
    END IF;

    SELECT COUNT(*) INTO v_drift_count
    FROM (
        SELECT
            fa.id,
            fa.account_code,
            ROUND(COALESCE(fa.balance_units, 0)::numeric, 6) AS bal,
            ROUND(COALESCE(
                CASE
                    WHEN LOWER(fa.normal_side) = 'debit' THEN SUM(CASE WHEN LOWER(le.entry_side) = 'debit' THEN le.amount_units ELSE -le.amount_units END)
                    ELSE SUM(CASE WHEN LOWER(le.entry_side) = 'credit' THEN le.amount_units ELSE -le.amount_units END)
                END,
                0
            )::numeric, 6) AS ledger_net
        FROM public.financial_accounts fa
        LEFT JOIN public.ledger_entries le ON le.account_id = fa.id
        GROUP BY fa.id, fa.account_code, fa.normal_side, fa.balance_units
    ) s
    WHERE s.bal <> s.ledger_net;

    IF v_drift_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: % financial_accounts drifted from ledger_entries net', v_drift_count;
    END IF;

    -- Verify exact target balances on reconciled ClixWall accounts (when present)
    SELECT balance_units INTO v_k1 FROM public.financial_accounts WHERE account_code = 'WALLET-9dc94f10-3a79-420f-855e-27f9fe15efd0';
    IF FOUND AND v_k1 <> 14.448000 THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: Khalid 1 expected 14.448000, got %', v_k1;
    END IF;

    SELECT balance_units INTO v_k2 FROM public.financial_accounts WHERE account_code = 'WALLET-bd9e3bf4-6e48-48a3-95f0-720647df985f';
    IF FOUND AND v_k2 <> 0.000000 THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: Khalid 2 expected 0.000000, got %', v_k2;
    END IF;

    SELECT balance_units INTO v_recv FROM public.financial_accounts WHERE account_code = 'CLIXWALL-RECEIVABLE';
    SELECT balance_units INTO v_pub_rev FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-CLIXWALL';

    IF v_k1 IS NOT NULL AND (v_recv <> 0.640000 OR v_pub_rev <> 0.192000) THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: ClixWall receivable(%) expected 0.640000 / revenue(%) expected 0.192000', v_recv, v_pub_rev;
    END IF;

    -- Verify ALL unaffected accounts remained 100% identical to pre-migration snapshot
    SELECT COUNT(*) INTO v_untouched_drift_count
    FROM public.financial_migration_032_backup b
    JOIN public.financial_accounts fa ON fa.id = b.record_id
    WHERE b.snapshot_type = 'financial_accounts'
      AND fa.account_code NOT IN (
          'WALLET-9dc94f10-3a79-420f-855e-27f9fe15efd0',
          'WALLET-bd9e3bf4-6e48-48a3-95f0-720647df985f',
          'CLIXWALL-RECEIVABLE',
          'PLATFORM-REVENUE-CLIXWALL'
      )
      AND ROUND(COALESCE(fa.balance_units, 0)::numeric, 6) <> ROUND(COALESCE((b.payload->>'balance_units')::numeric, 0), 6);

    IF v_untouched_drift_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION_032_INVARIANT_FAILED: % unaffected accounts changed unexpectedly!', v_untouched_drift_count;
    END IF;
END $$;

COMMIT;
