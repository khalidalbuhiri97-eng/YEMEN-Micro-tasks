-- ==============================================================================
-- Migration 023: 6-Decimal Fractional Monetary Precision (NUMERIC(30,6))
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Scope:
--   1. Safely save & drop dependent views referencing altered monetary tables.
--   2. Migrate ALL monetary columns (never counts/slots/IDs/timestamps) to NUMERIC(30,6)
--      without mutating historical ledger values.
--   3. Restore saved views cleanly.
--   4. Upgrade post_ledger_transaction (both named canonical and legacy positional
--      signatures if present) to NUMERIC(30,6) exact scale validation.
--   5. Upgrade transfer_wallet_units to NUMERIC(30,6) with exact 3% fee
--      (ROUND(amount * 0.03, 6), zero minimum 1-unit floor).
--   6. Ensure 022 external account RPCs accept NUMERIC(30,6).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Capture & drop any views in public referencing target monetary tables
-- ------------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _saved_views_023 (
    view_name TEXT PRIMARY KEY,
    view_def TEXT NOT NULL
);
TRUNCATE TABLE _saved_views_023;

DO $$
DECLARE
    v_rec RECORD;
    v_target_tables TEXT[] := ARRAY[
        'financial_accounts',
        'ledger_entries',
        'wallets',
        'wallet_transactions',
        'tasks',
        'withdrawal_requests',
        'payout_methods',
        'referral_rewards',
        'referral_task_rewards',
        'tax_definitions',
        'tax_settlements',
        'platform_settings',
        'campaigns',
        'external_accounts',
        'external_deposits',
        'external_account_transfers',
        'external_account_reconciliations'
    ];
BEGIN
    FOR v_rec IN
        SELECT DISTINCT
            vc.relname AS view_name,
            pg_get_viewdef(vc.oid, true) AS view_def
        FROM pg_class vc
        JOIN pg_namespace vn ON vn.oid = vc.relnamespace AND vn.nspname = 'public'
        JOIN pg_rewrite rw ON rw.ev_class = vc.oid
        JOIN pg_depend dp ON dp.objid = rw.oid
        JOIN pg_class tc ON tc.oid = dp.refobjid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace AND tn.nspname = 'public'
        WHERE vc.relkind = 'v'
          AND tc.relname = ANY(v_target_tables)
    LOOP
        INSERT INTO _saved_views_023 (view_name, view_def)
        VALUES (v_rec.view_name, v_rec.view_def)
        ON CONFLICT (view_name) DO NOTHING;
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', v_rec.view_name);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Alter ONLY exact monetary columns to NUMERIC(30,6)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_col RECORD;
    v_targets CONSTANT TEXT[][] := ARRAY[
        ['financial_accounts', 'balance_units'],
        ['ledger_entries', 'amount_units'],
        ['ledger_entries', 'debit_amount'],
        ['ledger_entries', 'credit_amount'],
        ['wallets', 'available_balance'],
        ['wallets', 'pending_balance'],
        ['wallets', 'balance'],
        ['wallets', 'reserved_balance'],
        ['wallets', 'total_earned'],
        ['wallets', 'total_withdrawn'],
        ['wallets', 'total_transferred'],
        ['wallet_transactions', 'amount'],
        ['wallet_transactions', 'previous_balance'],
        ['wallet_transactions', 'new_balance'],
        ['tasks', 'reward_units'],
        ['tasks', 'reward_yer'],
        ['tasks', 'total_budget_units'],
        ['tasks', 'budget_yer'],
        ['tasks', 'budget_spent_yer'],
        ['tasks', 'commission_units'],
        ['withdrawal_requests', 'amount'],
        ['withdrawal_requests', 'fee'],
        ['withdrawal_requests', 'net_amount'],
        ['withdrawal_requests', 'amount_units'],
        ['withdrawal_requests', 'fee_units'],
        ['withdrawal_requests', 'net_units'],
        ['payout_methods', 'min_withdrawal'],
        ['payout_methods', 'max_withdrawal'],
        ['payout_methods', 'fee_flat'],
        ['referral_rewards', 'reward_units'],
        ['referral_task_rewards', 'reward_units'],
        ['tax_definitions', 'flat_amount'],
        ['tax_settlements', 'taxable_amount'],
        ['tax_settlements', 'tax_amount'],
        ['platform_settings', 'min_withdrawal'],
        ['platform_settings', 'max_withdrawal'],
        ['platform_settings', 'daily_withdrawal_limit'],
        ['platform_settings', 'referral_bonus'],
        ['campaigns', 'reward_units'],
        ['campaigns', 'budget_units'],
        ['campaigns', 'fee_units'],
        ['campaigns', 'total_units'],
        ['campaigns', 'refunded_units'],
        ['external_accounts', 'actual_balance_units'],
        ['external_deposits', 'amount_units'],
        ['external_account_transfers', 'amount_units'],
        ['external_account_reconciliations', 'accounting_balance_units'],
        ['external_account_reconciliations', 'actual_balance_units'],
        ['external_account_reconciliations', 'discrepancy_units']
    ];
    i INT;
    v_tbl TEXT;
    v_colname TEXT;
    v_data_type TEXT;
    v_prec INT;
    v_scale INT;
BEGIN
    -- Temporarily drop tasks.total_budget_units generated column check if generated, else alter directly
    FOR i IN 1 .. array_length(v_targets, 1) LOOP
        v_tbl := v_targets[i][1];
        v_colname := v_targets[i][2];

        SELECT c.data_type, c.numeric_precision, c.numeric_scale
        INTO v_data_type, v_prec, v_scale
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = v_tbl
          AND c.column_name = v_colname;

        IF FOUND THEN
            IF NOT (v_data_type = 'numeric' AND v_prec = 30 AND v_scale = 6) THEN
                -- Skip generated expression columns if PostgreSQL marks them as ALWAYS GENERATED
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = v_colname
                      AND is_generated = 'ALWAYS'
                ) THEN
                    RAISE NOTICE 'Skipping generated column %.%', v_tbl, v_colname;
                ELSE
                    EXECUTE format(
                        'ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(30,6) USING ROUND(COALESCE(%I, 0)::numeric, 6)',
                        v_tbl, v_colname, v_colname
                    );
                END IF;
            END IF;
        END IF;
    END LOOP;
END $$;

-- Ensure ledger_entries CHECK allows positive fractional values > 0
DO $$
DECLARE
    v_chk RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_entries') THEN
        FOR v_chk IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'public.ledger_entries'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ~* 'amount_units'
        LOOP
            EXECUTE format('ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS %I', v_chk.conname);
        END LOOP;
        ALTER TABLE public.ledger_entries
            ADD CONSTRAINT ledger_entries_amount_units_positive_chk CHECK (amount_units > 0);
    END IF;
END $$;

-- Ensure financial_accounts non-negative balance constraint
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_accounts') THEN
        ALTER TABLE public.financial_accounts
            DROP CONSTRAINT IF EXISTS financial_accounts_balance_non_negative_chk;
        ALTER TABLE public.financial_accounts
            ADD CONSTRAINT financial_accounts_balance_non_negative_chk CHECK (balance_units >= 0);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Restore any saved dependent views
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_view RECORD;
BEGIN
    FOR v_view IN SELECT view_name, view_def FROM _saved_views_023 LOOP
        EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v_view.view_name, v_view.view_def);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Upgrade post_ledger_transaction (Canonical 5-arg named signature) to NUMERIC(30,6)
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
BEGIN
    IF p_transaction_type IS NULL OR TRIM(p_transaction_type) = '' THEN
        RAISE EXCEPTION 'transaction_type is required';
    END IF;

    IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
        RAISE EXCEPTION 'post_ledger_transaction requires at least 2 entries';
    END IF;

    -- Idempotency guard
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        SELECT id INTO v_existing_tx_id
        FROM public.ledger_transactions
        WHERE idempotency_key = TRIM(p_idempotency_key)
        LIMIT 1;
        IF FOUND THEN
            RETURN v_existing_tx_id;
        END IF;
    END IF;

    -- Validate every entry & collect deterministic lock list
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

    -- Deterministic sorted row lock on all touched accounts
    FOR v_lock_id IN
        SELECT unnest(v_sorted_ids) AS aid ORDER BY 1
    LOOP
        PERFORM id FROM public.financial_accounts WHERE id = v_lock_id FOR UPDATE;
    END LOOP;

    -- Create transaction header
    INSERT INTO public.ledger_transactions (
        transaction_type,
        reference,
        idempotency_key,
        status,
        metadata,
        created_by,
        created_at
    ) VALUES (
        TRIM(p_transaction_type),
        NULLIF(TRIM(COALESCE(p_reference, '')), ''),
        NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''),
        'posted',
        COALESCE(p_metadata, '{}'::jsonb),
        auth.uid(),
        v_now
    )
    RETURNING id INTO v_tx_id;

    -- Post entries and update financial_accounts strictly respecting normal_side
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_account_id := (v_entry->>'account_id')::UUID;
        v_side := LOWER(TRIM(COALESCE(v_entry->>'side', v_entry->>'entry_side')));
        v_amount := (v_entry->>'amount_units')::NUMERIC(30,6);
        v_memo := NULLIF(TRIM(COALESCE(v_entry->>'memo', '')), '');

        SELECT * INTO v_acc
        FROM public.financial_accounts
        WHERE id = v_account_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial account not found: %', v_account_id;
        END IF;

        IF LOWER(COALESCE(v_acc.status, 'active')) <> 'active' THEN
            RAISE EXCEPTION 'Financial account % is not active', v_acc.account_code;
        END IF;

        INSERT INTO public.ledger_entries (
            transaction_id, account_id, entry_side, amount_units, memo, created_at
        ) VALUES (
            v_tx_id, v_account_id, v_side, v_amount, v_memo, v_now
        );

        v_new_balance := ROUND(
            COALESCE(v_acc.balance_units, 0)::NUMERIC(30,6)
            + CASE
                WHEN LOWER(v_acc.normal_side) = v_side THEN v_amount
                ELSE -v_amount
              END,
            6
        );

        IF v_new_balance < 0 THEN
            RAISE EXCEPTION 'Insufficient balance on account % (available %, delta resulted in %)',
                v_acc.account_code, v_acc.balance_units, v_new_balance;
        END IF;

        UPDATE public.financial_accounts
        SET balance_units = v_new_balance
        WHERE id = v_account_id;

        -- Sync mirror wallets row if this financial account is linked to a user wallet
        IF v_acc.wallet_id IS NOT NULL AND LOWER(COALESCE(v_acc.account_type, '')) = 'wallet' THEN
            UPDATE public.wallets
            SET available_balance = v_new_balance,
                balance = v_new_balance,
                updated_at = v_now
            WHERE id = v_acc.wallet_id;
        END IF;
    END LOOP;

    RETURN v_tx_id;
END;
$$;

-- Also upgrade legacy positional 5-arg overload (TEXT, TEXT, JSONB, TEXT, JSONB) if it exists in live DB
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
        WHERE p.proname = 'post_ledger_transaction'
          AND pg_get_function_identity_arguments(p.oid) = 'p_transaction_type text, p_idempotency_key text, p_entries jsonb, p_description text, p_metadata jsonb'
    ) THEN
        EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.post_ledger_transaction(
            p_transaction_type TEXT,
            p_idempotency_key TEXT,
            p_entries JSONB,
            p_description TEXT DEFAULT NULL,
            p_metadata JSONB DEFAULT '{}'::jsonb
        )
        RETURNS UUID
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $inner$
        DECLARE
            v_meta JSONB := COALESCE(p_metadata, '{}'::jsonb);
        BEGIN
            IF p_description IS NOT NULL AND NOT (v_meta ? 'description') THEN
                v_meta := v_meta || jsonb_build_object('description', p_description);
            END IF;
            RETURN public.post_ledger_transaction(
                p_transaction_type := p_transaction_type,
                p_idempotency_key := p_idempotency_key,
                p_reference := COALESCE(v_meta->>'reference', p_transaction_type),
                p_metadata := v_meta,
                p_entries := p_entries
            );
        END;
        $inner$;
        $fn$;
    END IF;
END $$;

REVOKE ALL ON FUNCTION public.post_ledger_transaction(TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_ledger_transaction(TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. Upgrade transfer_wallet_units to NUMERIC(30,6) & exact 3% fee (NO min floor)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transfer_wallet_units(TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.transfer_wallet_units(TEXT, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_wallet_units(
    p_recipient_wallet_address TEXT,
    p_amount_units NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sender_id UUID := auth.uid();
    v_recipient_id UUID;
    v_sender_wallet RECORD;
    v_recipient_wallet RECORD;
    v_sender_acc RECORD;
    v_recipient_acc RECORD;
    v_fee_acc RECORD;
    v_clean_addr TEXT := UPPER(TRIM(COALESCE(p_recipient_wallet_address, '')));
    v_clean_key TEXT := NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '');
    v_amount NUMERIC(30,6);
    v_fee NUMERIC(30,6);
    v_net NUMERIC(30,6);
    v_entries JSONB;
    v_tx_id UUID;
    v_existing_tx RECORD;
    v_sender_new_bal NUMERIC(30,6);
    v_recipient_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
        RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر.';
    END IF;

    IF p_amount_units <> ROUND(p_amount_units, 6) THEN
        RAISE EXCEPTION 'مبلغ التحويل يقبل بحد أقصى 6 منازل عشرية.';
    END IF;

    v_amount := ROUND(p_amount_units, 6);

    IF v_clean_addr = '' THEN
        RAISE EXCEPTION 'عنوان محفظة المستلم مطلوب.';
    END IF;

    -- Idempotency check before acquiring locks
    IF v_clean_key IS NOT NULL THEN
        SELECT id, metadata INTO v_existing_tx
        FROM public.ledger_transactions
        WHERE idempotency_key = 'WALLET-TRANSFER:' || v_sender_id::text || ':' || v_clean_key
           OR idempotency_key = v_clean_key
        LIMIT 1;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'idempotent', true,
                'transferId', v_existing_tx.id,
                'amount', v_amount
            );
        END IF;
    END IF;

    -- Resolve sender & recipient wallets
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE user_id = v_sender_id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'محفظة المرسل غير موجودة.';
    END IF;

    SELECT * INTO v_recipient_wallet
    FROM public.wallets
    WHERE UPPER(wallet_address) = v_clean_addr
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'عنوان محفظة المستلم غير مسجل في النظام.';
    END IF;

    v_recipient_id := v_recipient_wallet.user_id;
    IF v_recipient_id = v_sender_id THEN
        RAISE EXCEPTION 'لا يمكنك التحويل إلى محفظتك الشخصية.';
    END IF;

    SELECT * INTO v_sender_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_sender_wallet.id AND account_type = 'wallet' AND status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب المالي للمرسل غير موجود أو غير نشط.';
    END IF;

    SELECT * INTO v_recipient_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_recipient_wallet.id AND account_type = 'wallet' AND status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب المالي للمستلم غير موجود أو غير نشط.';
    END IF;

    SELECT * INTO v_fee_acc
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-REVENUE-SERVICES' AND status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'حساب إيرادات الخدمات (PLATFORM-REVENUE-SERVICES) غير متوفر.';
    END IF;

    -- Exact 3% fee with NO minimum 1-unit floor (15 -> 0.450000, 0.01 -> 0.000300)
    v_fee := ROUND(v_amount * 0.03, 6);
    v_net := v_amount - v_fee;

    IF v_net <= 0 THEN
        RAISE EXCEPTION 'صافي المبلغ المحول بعد الرسوم يجب أن يكون أكبر من صفر.';
    END IF;

    -- Build balanced entries
    v_entries := jsonb_build_array(
        jsonb_build_object(
            'account_id', v_sender_acc.id,
            'side', 'debit',
            'amount_units', v_amount,
            'memo', COALESCE(NULLIF(TRIM(p_note), ''), 'تحويل إلى ' || v_clean_addr)
        ),
        jsonb_build_object(
            'account_id', v_recipient_acc.id,
            'side', 'credit',
            'amount_units', v_net,
            'memo', COALESCE(NULLIF(TRIM(p_note), ''), 'استلام تحويل من ' || COALESCE(v_sender_wallet.wallet_address, v_sender_id::text))
        )
    );

    IF v_fee > 0 THEN
        v_entries := v_entries || jsonb_build_array(
            jsonb_build_object(
                'account_id', v_fee_acc.id,
                'side', 'credit',
                'amount_units', v_fee,
                'memo', 'رسوم تحويل داخلي (3%)'
            )
        );
    END IF;

    v_tx_id := public.post_ledger_transaction(
        p_transaction_type := 'WALLET_TRANSFER',
        p_idempotency_key := COALESCE('WALLET-TRANSFER:' || v_sender_id::text || ':' || v_clean_key, 'WALLET-TRANSFER:' || gen_random_uuid()::text),
        p_reference := 'TRANSFER:' || v_sender_id::text || '->' || v_recipient_id::text,
        p_metadata := jsonb_build_object(
            'sender_id', v_sender_id,
            'recipient_id', v_recipient_id,
            'recipient_wallet_address', v_clean_addr,
            'amount_units', v_amount,
            'fee_units', v_fee,
            'net_units', v_net,
            'note', p_note
        ),
        p_entries := v_entries
    );

    SELECT balance_units INTO v_sender_new_bal FROM public.financial_accounts WHERE id = v_sender_acc.id;
    SELECT balance_units INTO v_recipient_new_bal FROM public.financial_accounts WHERE id = v_recipient_acc.id;

    -- Record legacy mirror wallet_transactions if table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_transactions') THEN
        INSERT INTO public.wallet_transactions (
            user_id, type, amount, previous_balance, new_balance, status, reference_id, description, created_at
        ) VALUES
        (
            v_sender_id, 'WALLET_TRANSFER_SENT', -v_amount, v_sender_acc.balance_units, v_sender_new_bal,
            'COMPLETED', v_tx_id::text, COALESCE(NULLIF(TRIM(p_note), ''), 'تحويل إلى ' || v_clean_addr), v_now
        ),
        (
            v_recipient_id, 'WALLET_TRANSFER_RECEIVED', v_net, v_recipient_acc.balance_units, v_recipient_new_bal,
            'COMPLETED', v_tx_id::text, COALESCE(NULLIF(TRIM(p_note), ''), 'استلام تحويل (بعد رسوم 3%)'), v_now
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'transferId', v_tx_id,
        'amount', v_amount,
        'fee', v_fee,
        'netReceived', v_net,
        'senderNewBalance', v_sender_new_bal,
        'recipientNewBalance', v_recipient_new_bal
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_wallet_units(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_wallet_units(TEXT, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
