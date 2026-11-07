-- ==============================================================================
-- KASB YEMEN PLATFORM (كسب اليمن للمهام المصغرة)
-- Versioned Migration: 002_financial_ledger_system.sql
-- Closed-Loop Virtual Wallet, Double-Entry Ledger & Treasury Architecture
-- ==============================================================================

-- 1. Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Add wallet_address and reserved_balance columns to wallets if not present
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'wallet_address') THEN
        ALTER TABLE public.wallets ADD COLUMN wallet_address TEXT UNIQUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'reserved_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'total_transferred') THEN
        ALTER TABLE public.wallets ADD COLUMN total_transferred BIGINT NOT NULL DEFAULT 0 CHECK (total_transferred >= 0);
    END IF;
END $$;

-- 3. Function to generate unique Yemeni wallet address format KY-XXXXXXXXXXXX
CREATE OR REPLACE FUNCTION public.generate_wallet_address(user_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    hash_str TEXT;
    result_addr TEXT;
BEGIN
    hash_str := upper(substring(encode(digest(user_uuid::text, 'sha256'), 'hex'), 1, 12));
    result_addr := 'KY-' || hash_str;
    RETURN result_addr;
END;
$$ LANGUAGE plpgsql;

-- 4. Backfill wallet addresses for existing wallets
UPDATE public.wallets
SET wallet_address = public.generate_wallet_address(user_id)
WHERE wallet_address IS NULL;

-- 5. Create wallet_accounts table for double-entry accounting
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL CHECK (account_type IN ('TREASURY', 'USER', 'REVENUE', 'LIABILITY', 'ESCROW')),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. Create ledger_transactions (Header)
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_type TEXT NOT NULL,
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. Create ledger_entries (Double-Entry Debit & Credit lines)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.wallet_accounts(id),
    debit_amount BIGINT NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount BIGINT NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. Create wallet_transfers table
CREATE TABLE IF NOT EXISTS public.wallet_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_wallet_address TEXT NOT NULL,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_wallet_address TEXT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. Initialize System Treasury Account if missing
INSERT INTO public.wallet_accounts (name, account_type)
VALUES ('SYSTEM_TREASURY_MAIN', 'TREASURY')
ON CONFLICT (name) DO NOTHING;

-- 10. Enable Row Level Security (RLS) on new ledger tables
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies for Admin and Users
DROP POLICY IF EXISTS "Admin can view ledger and accounts" ON public.wallet_accounts;
CREATE POLICY "Admin can view ledger and accounts" ON public.wallet_accounts
    FOR ALL USING (
        auth.jwt() ->> 'email' IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com')
        OR EXISTS (
            SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admin can view ledger transactions" ON public.ledger_transactions;
CREATE POLICY "Admin can view ledger transactions" ON public.ledger_transactions
    FOR ALL USING (
        auth.jwt() ->> 'email' IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com')
        OR EXISTS (
            SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admin can view ledger entries" ON public.ledger_entries;
CREATE POLICY "Admin can view ledger entries" ON public.ledger_entries
    FOR ALL USING (
        auth.jwt() ->> 'email' IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com')
        OR EXISTS (
            SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Users can view their wallet transfers" ON public.wallet_transfers;
CREATE POLICY "Users can view their wallet transfers" ON public.wallet_transfers
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can insert wallet transfers" ON public.wallet_transfers;
CREATE POLICY "Users can insert wallet transfers" ON public.wallet_transfers
    FOR INSERT WITH CHECK (auth.uid() = sender_id);
