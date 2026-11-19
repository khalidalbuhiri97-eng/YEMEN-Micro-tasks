-- ==============================================================================
-- Migration 031: Harden ClixWall Postbacks, Append-Only Ledger & Strict RPC Auth
-- Yemen Task (كسب اليمن)
--
-- Notes:
-- - Does NOT modify or alter any historical balances or transactions.
-- - Preserves the existing 9-parameter signature of public.process_clixwall_postback.
-- - Enforces append-only event storage in public.clixwall_postbacks keyed by
--   (transaction_id, status), blocking UPDATE/DELETE mutations.
-- - Restricts EXECUTE on public.process_clixwall_postback strictly to service_role.
-- ==============================================================================

-- 1. Ensure CLIXWALL-RECEIVABLE exists (no balance modifications if already present)
INSERT INTO public.financial_accounts (
    id,
    account_code,
    account_type,
    normal_side,
    balance_units,
    status
)
SELECT
    gen_random_uuid(),
    'CLIXWALL-RECEIVABLE',
    'asset',
    'debit',
    0,
    'active'
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_accounts WHERE account_code = 'CLIXWALL-RECEIVABLE'
);

-- 2. Replace any single-column UNIQUE constraint on clixwall_postbacks(transaction_id)
--    with composite uniqueness on (transaction_id, status) to support append-only
--    'credited' and 'reversed' event records safely without destroying history.
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT c.conname INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'clixwall_postbacks'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = t.oid
            AND a.attnum = c.conkey[1]
            AND a.attname = 'transaction_id'
      )
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.clixwall_postbacks DROP CONSTRAINT %I', v_constraint_name);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clixwall_postbacks_tx_status
    ON public.clixwall_postbacks (transaction_id, status);

CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_user_created
    ON public.clixwall_postbacks (user_id, created_at DESC);

-- 3. Enforce append-only immutability on clixwall_postbacks
CREATE OR REPLACE FUNCTION public.prevent_clixwall_postbacks_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'clixwall_postbacks is append-only; UPDATE and DELETE operations are prohibited.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_clixwall_postbacks_mutation ON public.clixwall_postbacks;
CREATE TRIGGER trg_prevent_clixwall_postbacks_mutation
    BEFORE UPDATE OR DELETE ON public.clixwall_postbacks
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_clixwall_postbacks_mutation();

-- 4. Harden process_clixwall_postback (exact 9-param signature, advisory lock, append-only)
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
    v_exchange_rate NUMERIC := 1600.000000;
    v_reward_yer NUMERIC;
    v_amount_units BIGINT;
    v_user_wallet_acc_id UUID;
    v_clixwall_acc_id UUID;
    v_ledger_tx_id UUID;
    v_postback_id UUID;
BEGIN
    -- Defense-in-depth: only service_role may execute financial RPCs
    IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
       AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
        RAISE EXCEPTION 'FORBIDDEN_FINANCIAL_RPC';
    END IF;

    IF p_transaction_id IS NULL OR btrim(p_transaction_id) = '' THEN
        RAISE EXCEPTION 'MISSING_TRANSACTION_ID';
    END IF;

    IF p_status NOT IN ('credited', 'reversed') THEN
        RAISE EXCEPTION 'INVALID_POSTBACK_STATUS';
    END IF;

    -- Concurrency lock per ClixWall transaction_id
    PERFORM pg_advisory_xact_lock(hashtext('clixwall:' || btrim(p_transaction_id)));

    -- Validate target user exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'UNKNOWN_USER';
    END IF;

    -- Check append-only state for this transaction_id
    SELECT id, user_id, reward_yer, user_payout_usd, publisher_payout_usd, offer_id, offer_name
      INTO v_credit_row
      FROM public.clixwall_postbacks
     WHERE transaction_id = btrim(p_transaction_id)
       AND status = 'credited'
     LIMIT 1;

    SELECT EXISTS (
        SELECT 1
          FROM public.clixwall_postbacks
         WHERE transaction_id = btrim(p_transaction_id)
           AND status = 'reversed'
    ) INTO v_reversal_exists;

    -- -------------------------------------------------------------------------
    -- A. Handle Reversal Event (append-only, requires original credited row)
    -- -------------------------------------------------------------------------
    IF p_status = 'reversed' THEN
        IF v_credit_row.id IS NULL THEN
            RAISE EXCEPTION 'REVERSAL_WITHOUT_ORIGINAL_CREDIT';
        END IF;

        IF v_reversal_exists THEN
            RETURN jsonb_build_object('ok', true, 'reversal', true, 'duplicate', true);
        END IF;

        -- Always reverse the exact original credited reward amount
        v_reward_yer := ROUND(COALESCE(v_credit_row.reward_yer, COALESCE(v_credit_row.user_payout_usd, 0) * v_exchange_rate), 6);
        v_amount_units := ROUND(v_reward_yer * 1000000)::BIGINT;

        IF v_amount_units <= 0 THEN
            RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT';
        END IF;

        SELECT id INTO v_clixwall_acc_id
          FROM public.financial_accounts
         WHERE account_code = 'CLIXWALL-RECEIVABLE'
         LIMIT 1;

        SELECT id INTO v_user_wallet_acc_id
          FROM public.financial_accounts
         WHERE owner_user_id = v_credit_row.user_id
           AND account_type = 'wallet'
         LIMIT 1;

        IF v_user_wallet_acc_id IS NULL OR v_clixwall_acc_id IS NULL THEN
            RAISE EXCEPTION 'FINANCIAL_ACCOUNTS_UNAVAILABLE';
        END IF;

        INSERT INTO public.ledger_transactions (
            id, transaction_type, reference, idempotency_key, status, metadata
        ) VALUES (
            gen_random_uuid(),
            'CLIXWALL_REVERSAL',
            'CLIXWALL:' || btrim(p_transaction_id),
            'CLIXWALL:' || btrim(p_transaction_id) || ':REVERSAL',
            'posted',
            jsonb_build_object(
                'provider', 'ClixWall',
                'original_transaction_id', btrim(p_transaction_id),
                'user_id', v_credit_row.user_id,
                'user_payout_usd', v_credit_row.user_payout_usd,
                'publisher_payout_usd', v_credit_row.publisher_payout_usd,
                'reward_yer', v_reward_yer,
                'exchange_rate', v_exchange_rate,
                'unit_scale', 1000000
            )
        )
        RETURNING id INTO v_ledger_tx_id;

        INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo)
        VALUES
            (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'debit', v_amount_units, 'ClixWall reward reversal'),
            (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'credit', v_amount_units, 'ClixWall receivable reversal');

        UPDATE public.financial_accounts
           SET balance_units = GREATEST(0, balance_units - v_amount_units)
         WHERE id = v_user_wallet_acc_id;

        UPDATE public.financial_accounts
           SET balance_units = GREATEST(0, balance_units - v_amount_units)
         WHERE id = v_clixwall_acc_id;

        INSERT INTO public.clixwall_postbacks (
            id,
            transaction_id,
            user_id,
            offer_id,
            offer_name,
            status,
            user_payout_usd,
            publisher_payout_usd,
            exchange_rate,
            reward_yer,
            ledger_transaction_id,
            raw_status,
            payload
        ) VALUES (
            gen_random_uuid(),
            btrim(p_transaction_id),
            v_credit_row.user_id,
            COALESCE(p_offer_id, v_credit_row.offer_id),
            COALESCE(p_offer_name, v_credit_row.offer_name),
            'reversed',
            v_credit_row.user_payout_usd,
            v_credit_row.publisher_payout_usd,
            v_exchange_rate,
            v_reward_yer,
            v_ledger_tx_id,
            p_raw_status,
            COALESCE(p_payload, '{}'::jsonb)
        )
        RETURNING id INTO v_postback_id;

        RETURN jsonb_build_object('ok', true, 'reversal', true, 'duplicate', false, 'postback_id', v_postback_id);
    END IF;

    -- -------------------------------------------------------------------------
    -- B. Handle Credit Event (idempotent, requires positive 70/30 payouts)
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

    v_reward_yer := ROUND(p_user_payout_usd * v_exchange_rate, 6);
    v_amount_units := ROUND(v_reward_yer * 1000000)::BIGINT;

    IF v_amount_units <= 0 THEN
        RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT';
    END IF;

    SELECT id INTO v_clixwall_acc_id
      FROM public.financial_accounts
     WHERE account_code = 'CLIXWALL-RECEIVABLE'
     LIMIT 1;

    IF v_clixwall_acc_id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, normal_side, balance_units, status
        ) VALUES (
            gen_random_uuid(), 'CLIXWALL-RECEIVABLE', 'asset', 'debit', 0, 'active'
        )
        RETURNING id INTO v_clixwall_acc_id;
    END IF;

    SELECT id INTO v_user_wallet_acc_id
      FROM public.financial_accounts
     WHERE owner_user_id = p_user_id
       AND account_type = 'wallet'
     LIMIT 1;

    IF v_user_wallet_acc_id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, normal_side, balance_units, owner_user_id, status
        ) VALUES (
            gen_random_uuid(),
            'WALLET-' || substring(p_user_id::text, 1, 8),
            'wallet',
            'credit',
            0,
            p_user_id,
            'active'
        )
        RETURNING id INTO v_user_wallet_acc_id;
    END IF;

    INSERT INTO public.wallets (id, user_id, wallet_address, status)
    VALUES (
        gen_random_uuid(),
        p_user_id,
        'KY-' || upper(substring(md5(p_user_id::text || now()::text), 1, 12)),
        'active'
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.ledger_transactions (
        id, transaction_type, reference, idempotency_key, status, metadata
    ) VALUES (
        gen_random_uuid(),
        'CLIXWALL_REWARD',
        'CLIXWALL:' || btrim(p_transaction_id),
        'CLIXWALL:' || btrim(p_transaction_id) || ':CREDIT',
        'posted',
        jsonb_build_object(
            'provider', 'ClixWall',
            'transaction_id', btrim(p_transaction_id),
            'user_id', p_user_id,
            'offer_id', p_offer_id,
            'offer_name', p_offer_name,
            'user_payout_usd', p_user_payout_usd,
            'publisher_payout_usd', p_publisher_payout_usd,
            'exchange_rate', v_exchange_rate,
            'reward_yer', v_reward_yer,
            'unit_scale', 1000000
        )
    )
    RETURNING id INTO v_ledger_tx_id;

    INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo)
    VALUES
        (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'debit', v_amount_units, 'ClixWall publisher receivable'),
        (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'credit', v_amount_units, 'ClixWall user reward');

    UPDATE public.financial_accounts
       SET balance_units = balance_units + v_amount_units
     WHERE id = v_user_wallet_acc_id;

    UPDATE public.financial_accounts
       SET balance_units = balance_units + v_amount_units
     WHERE id = v_clixwall_acc_id;

    INSERT INTO public.clixwall_postbacks (
        id,
        transaction_id,
        user_id,
        offer_id,
        offer_name,
        status,
        user_payout_usd,
        publisher_payout_usd,
        exchange_rate,
        reward_yer,
        ledger_transaction_id,
        raw_status,
        payload
    ) VALUES (
        gen_random_uuid(),
        btrim(p_transaction_id),
        p_user_id,
        p_offer_id,
        p_offer_name,
        'credited',
        p_user_payout_usd,
        p_publisher_payout_usd,
        v_exchange_rate,
        v_reward_yer,
        v_ledger_tx_id,
        p_raw_status,
        COALESCE(p_payload, '{}'::jsonb)
    )
    RETURNING id INTO v_postback_id;

    RETURN jsonb_build_object('ok', true, 'status', 'credited', 'duplicate', false, 'postback_id', v_postback_id);
END;
$$;

-- 5. Strict Least-Privilege RPC & Table Permissions
REVOKE ALL ON FUNCTION public.process_clixwall_postback(
    TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_clixwall_postback(
    TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.prevent_clixwall_postbacks_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_clixwall_postbacks_mutation() TO service_role;

REVOKE ALL ON TABLE public.clixwall_postbacks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.clixwall_postbacks TO service_role;
GRANT SELECT ON TABLE public.clixwall_postbacks TO authenticated;

ALTER TABLE public.clixwall_postbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own clixwall postbacks" ON public.clixwall_postbacks;
CREATE POLICY "Users can view their own clixwall postbacks"
ON public.clixwall_postbacks
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());
