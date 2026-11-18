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
    reward_usd NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    exchange_rate NUMERIC(30,6) NOT NULL DEFAULT 1600.000000,
    reward_yer NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    publisher_payout_usd NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
    status TEXT NOT NULL DEFAULT 'completed', -- 'completed', 'reversed', 'chargeback'
    raw_payload JSONB,
    ledger_transaction_id UUID REFERENCES public.ledger_transactions(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create indexes for high performance
CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_user_id ON public.clixwall_postbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_clixwall_postbacks_status ON public.clixwall_postbacks(status);

-- 4. Create secure RPC function to process ClixWall postback atomically
CREATE OR REPLACE FUNCTION public.process_clixwall_postback(
    p_transaction_id TEXT,
    p_user_id UUID,
    p_offer_id TEXT,
    p_offer_name TEXT,
    p_user_payout_usd NUMERIC,
    p_publisher_payout_usd NUMERIC,
    p_status TEXT DEFAULT 'completed',
    p_raw_status TEXT DEFAULT '1',
    p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_exchange_rate NUMERIC := 1600.000000;
    v_reward_yer NUMERIC;
    v_user_wallet_acc_id UUID;
    v_clixwall_acc_id UUID;
    v_ledger_tx_id UUID;
    v_postback_id UUID;
    v_wallet_id UUID;
    v_memo TEXT;
BEGIN
    -- Validate user exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'معرف المستخدم غير موجود: %', p_user_id;
    END IF;

    -- Calculate reward in YER at fixed rate 1 USD = 1600 YER using user_payout_usd
    v_reward_yer := ROUND(COALESCE(p_user_payout_usd, 0) * v_exchange_rate, 6);

    -- Check if transaction already exists (Idempotency)
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.clixwall_postbacks
    WHERE transaction_id = p_transaction_id;

    IF v_existing_id IS NOT NULL THEN
        -- If status changed to reversed/chargeback and currently completed
        IF v_existing_status = 'completed' AND p_status IN ('reversed', 'chargeback') THEN
            -- Get wallet account for user
            SELECT financial_account_id, id INTO v_clixwall_acc_id, v_wallet_id
            FROM public.wallets
            WHERE user_id = p_user_id;

            SELECT id INTO v_clixwall_acc_id
            FROM public.financial_accounts
            WHERE account_code = 'CLIXWALL-RECEIVABLE';

            SELECT id INTO v_user_wallet_acc_id
            FROM public.financial_accounts
            WHERE owner_id = p_user_id AND account_type = 'wallet';

            IF v_user_wallet_acc_id IS NULL OR v_clixwall_acc_id IS NULL THEN
                RAISE EXCEPTION 'حسابات دفتر الأستاذ غير متوفرة لعملية العكس.';
            END IF;

            v_memo := format('عكس مكافأة عرض ClixWall رقم %s (استرجاع)', p_transaction_id);

            -- Post reversal double entry
            INSERT INTO public.ledger_transactions (id, transaction_type, description, status, metadata)
            VALUES (gen_random_uuid(), 'CLIXWALL_REVERSAL', v_memo, 'posted', json_build_object('transaction_id', p_transaction_id))
            RETURNING id INTO v_ledger_tx_id;

            -- Debit user wallet (decrease balance) & Credit CLIXWALL-RECEIVABLE
            INSERT INTO public.ledger_entries (id, ledger_transaction_id, account_id, entry_side, amount_units, memo)
            VALUES
                (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'debit', v_reward_yer, v_memo),
                (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'credit', v_reward_yer, v_memo);

            -- Update user wallet balance
            UPDATE public.wallets
            SET balance_units = GREATEST(0.000000, balance_units - v_reward_yer),
                updated_at = NOW()
            WHERE user_id = p_user_id;

            -- Update postback record status
            UPDATE public.clixwall_postbacks
            SET status = p_status,
                ledger_transaction_id = v_ledger_tx_id,
                updated_at = NOW()
            WHERE id = v_existing_id;

            RETURN v_existing_id;
        END IF;

        -- Return existing ID if already processed identically
        RETURN v_existing_id;
    END IF;

    -- If new transaction and status is completed
    IF p_status = 'completed' AND v_reward_yer > 0 THEN
        -- Get financial accounts
        SELECT id INTO v_clixwall_acc_id
        FROM public.financial_accounts
        WHERE account_code = 'CLIXWALL-RECEIVABLE';

        SELECT id INTO v_user_wallet_acc_id
        FROM public.financial_accounts
        WHERE owner_id = p_user_id AND account_type = 'wallet';

        -- If user wallet financial account doesn't exist yet, create it
        IF v_user_wallet_acc_id IS NULL THEN
            INSERT INTO public.financial_accounts (
                id, account_code, account_name, account_type, normal_side, balance_units, currency, fund_scope, owner_id, status
            )
            VALUES (
                gen_random_uuid(),
                'WALLET-' || substring(p_user_id::text, 1, 8),
                'محفظة المستخدم',
                'wallet',
                'credit',
                0.000000,
                'YER',
                'platform',
                p_user_id,
                'active'
            )
            RETURNING id INTO v_user_wallet_acc_id;
        END IF;

        IF v_clixwall_acc_id IS NULL THEN
            RAISE EXCEPTION 'حساب CLIXWALL-RECEIVABLE غير موجود في دفتر الأستاذ.';
        END IF;

        v_memo := format('مكافأة إتمام عرض ClixWall: %s (USD %s)', COALESCE(p_offer_name, p_offer_id), p_user_payout_usd);

        -- Create ledger transaction
        INSERT INTO public.ledger_transactions (id, transaction_type, description, status, metadata)
        VALUES (gen_random_uuid(), 'CLIXWALL_REWARD', v_memo, 'posted', p_payload)
        RETURNING id INTO v_ledger_tx_id;

        -- Post double entry: Debit CLIXWALL-RECEIVABLE, Credit User Wallet
        INSERT INTO public.ledger_entries (id, ledger_transaction_id, account_id, entry_side, amount_units, memo)
        VALUES
            (gen_random_uuid(), v_ledger_tx_id, v_clixwall_acc_id, 'debit', v_reward_yer, v_memo),
            (gen_random_uuid(), v_ledger_tx_id, v_user_wallet_acc_id, 'credit', v_reward_yer, v_memo);

        -- Ensure user wallet row exists in wallets table
        INSERT INTO public.wallets (id, user_id, balance_units, currency, status)
        VALUES (gen_random_uuid(), p_user_id, v_reward_yer, 'YER', 'active')
        ON CONFLICT (user_id) DO UPDATE
        SET balance_units = wallets.balance_units + v_reward_yer,
            updated_at = NOW();
    END IF;

    -- Insert record into clixwall_postbacks
    INSERT INTO public.clixwall_postbacks (
        id,
        transaction_id,
        user_id,
        offer_id,
        offer_name,
        reward_usd,
        exchange_rate,
        reward_yer,
        publisher_payout_usd,
        status,
        raw_payload,
        ledger_transaction_id
    ) VALUES (
        gen_random_uuid(),
        p_transaction_id,
        p_user_id,
        p_offer_id,
        p_offer_name,
        COALESCE(p_user_payout_usd, 0),
        v_exchange_rate,
        v_reward_yer,
        COALESCE(p_publisher_payout_usd, 0),
        p_status,
        p_payload,
        v_ledger_tx_id
    )
    RETURNING id INTO v_postback_id;

    RETURN v_postback_id;
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
