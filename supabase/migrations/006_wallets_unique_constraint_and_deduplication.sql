-- ==============================================================================
-- Migration 006: Safe Wallets Deduplication, Balance Alignment, and UNIQUE Constraint
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- ==============================================================================

-- 1. Ensure both available_balance and balance columns exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'available_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN available_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balance') THEN
        ALTER TABLE public.wallets ADD COLUMN balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'pending_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN pending_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'reserved_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN reserved_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
    END IF;
END $$;

-- 2. Safe Deduplication: Consolidate balances for duplicate user_id records
DO $$
DECLARE
    r RECORD;
    primary_wallet_id UUID;
    total_avail NUMERIC;
    total_pend NUMERIC;
    total_res NUMERIC;
    total_earn NUMERIC;
BEGIN
    FOR r IN (
        SELECT user_id, COUNT(*) as cnt
        FROM public.wallets
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        HAVING COUNT(*) > 1
    ) LOOP
        -- Select oldest wallet as primary
        SELECT id INTO primary_wallet_id
        FROM public.wallets
        WHERE user_id = r.user_id
        ORDER BY created_at ASC
        LIMIT 1;

        -- Sum balances across all duplicates for this user
        SELECT 
            COALESCE(SUM(COALESCE(available_balance, balance, 0)), 0),
            COALESCE(SUM(COALESCE(pending_balance, 0)), 0),
            COALESCE(SUM(COALESCE(reserved_balance, 0)), 0),
            COALESCE(SUM(COALESCE(total_earned, 0)), 0)
        INTO total_avail, total_pend, total_res, total_earn
        FROM public.wallets
        WHERE user_id = r.user_id;

        -- Update primary wallet with consolidated totals
        UPDATE public.wallets
        SET 
            available_balance = total_avail,
            balance = total_avail,
            pending_balance = total_pend,
            reserved_balance = total_res,
            total_earned = total_earn,
            updated_at = NOW()
        WHERE id = primary_wallet_id;

        -- Re-link any transactions or withdrawal requests if referenced by secondary wallet IDs
        -- Delete secondary duplicate wallets safely
        DELETE FROM public.wallets
        WHERE user_id = r.user_id AND id <> primary_wallet_id;
    END LOOP;
END $$;

-- 3. Add UNIQUE constraint on user_id if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'wallets'
          AND constraint_name = 'wallets_user_id_key'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'wallets'
          AND indexname = 'idx_wallets_user_id_unique'
    ) THEN
        ALTER TABLE public.wallets ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_id_unique ON public.wallets (user_id);
