-- ==============================================================================
-- Migration 030: ClixWall Offer Wall Integration & Double-Entry Accounting
-- Yemen Task (كسب اليمن)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ensure CLIXWALL-RECEIVABLE financial account exists in financial_accounts
INSERT INTO public.financial_accounts (
    id,
    account_code,
    account_name,
    account_type,
    normal_side,
    balance_units,
    currency,
    fund_scope,
    status,
    notes
)
SELECT
    gen_random_uuid(),
    'CLIXWALL-RECEIVABLE',
    'ذمم عروض ClixWall',
    'asset',
    'debit',
    0.000000,
    'YER',
    'platform',
    'active',
    'حساب مقابل أرباح عروض ClixWall ومستحقات الناشر'
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_accounts WHERE account_code = 'CLIXWALL-RECEIVABLE'
);

-- 2. Create clixwall_postbacks table
CREATE TABLE IF NOT EXISTS public.clixwall_postbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    offer_id TEXT,
    offer_name TEXT,
    status TEXT NOT NULL DEFAULT 'credited', -- 'credited', 'reversed'
    user_payout_usd NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    publisher_payout_usd NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    exchange_rate NUMERIC(30,6) NOT NULL DEFAULT 1600.000000,
    reward_yer NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    ledger_transaction_id UUID REFERENCES public.ledger_transactions(id),
    raw_status TEXT DEFAULT '1',
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create indexes for high performance
CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_user_id ON public.clixwall_postbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_status ON public.clixwall_postbacks(status);
CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_tx_id ON public.clixwall_postbacks(transaction_id);

-- 4. Create secure RPC function to process ClixWall postback atomically
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
    v_existing_id UUID;
    v_existing_status TEXT;
    v_exchange_rate NUMERIC := 1600.000000;
    v_reward_yer NUMERIC;
    v_amount_units BIGINT;
    v_user_wallet_acc_id UUID;
    v_clixwall_acc_id UUID;
    v_ledger_tx_id UUID;
    v_postback_id UUID;
    v_memo TEXT;
BEGIN
    -- 1. Validate user exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'UNKNOWN_USER';
    END IF;

    -- 2. Fixed conversion: 1 USD = 1,600 YER (precision 6 decimals, micros for ledger)
    v_reward_yer := ROUND(COALESCE(p_user_payout_usd, 0) * v_exchange_rate, 6);
    v_amount_units := ROUND(v_reward_yer * 1000000)::BIGINT;

    -- 3. Check existing postback record (Idempotency check)
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.clixwall_postbacks
    WHERE transaction_id = p_transaction_id;

    -- 4. Handle Reversal Signal
    IF p_status = 'reversed' THEN
        -- Reversal requires prior credited record
        IF v_existing_id IS NULL THEN
            RAISE EXCEPTION 'REVERSAL_WITHOUT_ORIGINAL_CREDIT';
        END IF;

        -- Idempotent reversal: already reversed
        IF v_existing_status = 'reversed' THEN
            RETURN jsonb_build_object('ok', true, 'reversal', true, 'duplicate', true);
        END IF;

        -- Resolve ledger accounts
        SELECT id INTO v_clixwall_acc_id
        FROM public.financial_accounts
        WHERE account_code = 'CLIXWALL-RECEIVABLE'
        LIMIT 1;

        SELECT id INTO v_user_wallet_acc_id
        FROM public.financial_accounts
        WHERE owner_user_id = p_user_id AND account_type = 'wallet'
        LIMIT 1;

        IF v_user_wallet_acc_id IS NULL OR v_clixwall_acc_id IS NULL THEN
            RAISE EXCEPTION 'FINANCIAL_ACCOUNTS_UNAVAILABLE';
        END IF;

        v_memo := format('عكس مكافأة عرض ClixWall رقم %s (استرجاع)', p_transaction_id);

        -- Insert ledger transaction
        INSERT INTO public.ledger_transactions (
            id, transaction_type, reference, idempotency_key, status, metadata
        ) VALUES (
            gen_random_uuid(),
            'CLIXWALL_REVERSAL',
            'CLIXWALL:' || p_transaction_id,
            'CLIXWALL:' || p_transaction_id || ':REVERSAL',
            'posted',
            jsonb_build_object(
                'provider', 'ClixWall',
                'original_transaction_id', p_transaction_id,
                'user_id', p_user_id,
                'reward_yer', v_reward_yer,
                'exchange_rate', v_exchange_rate
            )
        )
        RETURNING id INTO v_ledger_tx_id;

        -- Double-entry reversal: Debit User Wallet (decrease liability), Credit CLIXWALL-RECEIVABLE (decrease asset)
        INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo)
        VALUES
            (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'debit', v_amount_units, 'ClixWall reward reversal'),
            (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'credit', v_amount_units, 'ClixWall receivable reversal');

        -- Update balance_units in financial_accounts (never wallets table)
        UPDATE public.financial_accounts
        SET balance_units = GREATEST(0, balance_units - v_amount_units),
            updated_at = NOW()
        WHERE id = v_user_wallet_acc_id;

        UPDATE public.financial_accounts
        SET balance_units = GREATEST(0, balance_units - v_amount_units),
            updated_at = NOW()
        WHERE id = v_clixwall_acc_id;

        -- Update postback record to reversed
        UPDATE public.clixwall_postbacks
        SET status = 'reversed',
            raw_status = p_raw_status,
            payload = p_payload,
            ledger_transaction_id = v_ledger_tx_id,
            updated_at = NOW()
        WHERE id = v_existing_id;

        RETURN jsonb_build_object('ok', true, 'reversal', true, 'duplicate', false);
    END IF;

    -- 5. Handle Credit Signal: Idempotent Credit check
    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'status', 'credited', 'duplicate', true);
    END IF;

    -- 6. First-Time Credit Execution
    -- Resolve or create CLIXWALL-RECEIVABLE account
    SELECT id INTO v_clixwall_acc_id
    FROM public.financial_accounts
    WHERE account_code = 'CLIXWALL-RECEIVABLE'
    LIMIT 1;

    IF v_clixwall_acc_id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_name, account_type, normal_side, balance_units, currency, fund_scope, status
        ) VALUES (
            gen_random_uuid(), 'CLIXWALL-RECEIVABLE', 'ذمم عروض ClixWall', 'asset', 'debit', 0, 'YER', 'platform', 'active'
        )
        RETURNING id INTO v_clixwall_acc_id;
    END IF;

    -- Resolve user wallet financial account
    SELECT id INTO v_user_wallet_acc_id
    FROM public.financial_accounts
    WHERE owner_user_id = p_user_id AND account_type = 'wallet'
    LIMIT 1;

    IF v_user_wallet_acc_id IS NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_name, account_type, normal_side, balance_units, currency, fund_scope, owner_user_id, status
        ) VALUES (
            gen_random_uuid(),
            'WALLET-' || substring(p_user_id::text, 1, 8),
            'محفظة المستخدم',
            'wallet',
            'credit',
            0,
            'YER',
            'platform',
            p_user_id,
            'active'
        )
        RETURNING id INTO v_user_wallet_acc_id;
    END IF;

    -- Ensure row exists in wallets table without referencing balance_units
    INSERT INTO public.wallets (id, user_id, wallet_address, status)
    VALUES (gen_random_uuid(), p_user_id, 'KY-' || upper(substring(md5(p_user_id::text || now()::text), 1, 12)), 'active')
    ON CONFLICT (user_id) DO NOTHING;

    v_memo := format('مكافأة إتمام عرض ClixWall: %s (USD %s)', COALESCE(p_offer_name, p_offer_id), p_user_payout_usd);

    -- Post double-entry transaction
    INSERT INTO public.ledger_transactions (
        id, transaction_type, reference, idempotency_key, status, metadata
    ) VALUES (
        gen_random_uuid(),
        'CLIXWALL_REWARD',
        'CLIXWALL:' || p_transaction_id,
        'CLIXWALL:' || p_transaction_id || ':CREDIT',
        'posted',
        jsonb_build_object(
            'provider', 'ClixWall',
            'transaction_id', p_transaction_id,
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

    -- Post entries: Debit CLIXWALL-RECEIVABLE (asset), Credit User Wallet (liability)
    INSERT INTO public.ledger_entries (id, transaction_id, account_id, entry_side, amount_units, memo)
    VALUES
        (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'debit', v_amount_units, 'ClixWall publisher receivable'),
        (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'credit', v_amount_units, 'ClixWall user reward');

    -- Update balance_units in financial_accounts
    UPDATE public.financial_accounts
    SET balance_units = balance_units + v_amount_units,
        updated_at = NOW()
    WHERE id = v_user_wallet_acc_id;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + v_amount_units,
        updated_at = NOW()
    WHERE id = v_clixwall_acc_id;

    -- Insert into clixwall_postbacks table
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
        p_transaction_id,
        p_user_id,
        p_offer_id,
        p_offer_name,
        'credited',
        COALESCE(p_user_payout_usd, 0),
        COALESCE(p_publisher_payout_usd, 0),
        v_exchange_rate,
        v_reward_yer,
        v_ledger_tx_id,
        p_raw_status,
        p_payload
    )
    RETURNING id INTO v_postback_id;

    RETURN jsonb_build_object('ok', true, 'status', 'credited', 'duplicate', false);
END;
$$;

-- 5. Permissions and RLS Configuration
GRANT EXECUTE ON FUNCTION public.process_clixwall_postback TO service_role;
GRANT EXECUTE ON FUNCTION public.process_clixwall_postback TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_clixwall_postback TO anon;

GRANT ALL ON TABLE public.clixwall_postbacks TO service_role;
GRANT SELECT ON TABLE public.clixwall_postbacks TO authenticated;

ALTER TABLE public.clixwall_postbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own clixwall postbacks" ON public.clixwall_postbacks;
CREATE POLICY "Users can view their own clixwall postbacks"
ON public.clixwall_postbacks
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

