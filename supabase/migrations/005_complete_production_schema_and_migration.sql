-- ==============================================================================
-- KASB YEMEN PLATFORM (كسب اليمن للمهام المصغرة)
-- Migration 005: Comprehensive Production Schema, Full RLS, Permissions & Data Migration
-- Safe & Idempotent: Can be run multiple times in Supabase SQL Editor
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant basic schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'under_review')),
    referral_code TEXT UNIQUE NOT NULL,
    referred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    city TEXT DEFAULT 'صنعاء',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure all columns exist in profiles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role') THEN
        ALTER TABLE public.profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status') THEN
        ALTER TABLE public.profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'under_review'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'city') THEN
        ALTER TABLE public.profiles ADD COLUMN city TEXT DEFAULT 'صنعاء';
    END IF;
END $$;

-- 3. USER ROLES TABLE
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    granted_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, role)
);

-- 4. WALLETS TABLE (Integer Minor Units in YER)
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    wallet_address TEXT UNIQUE,
    available_balance BIGINT NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    pending_balance BIGINT NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
    reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
    total_earned BIGINT NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_transferred BIGINT NOT NULL DEFAULT 0 CHECK (total_transferred >= 0),
    total_withdrawn BIGINT NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
    currency TEXT NOT NULL DEFAULT 'YER',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure all columns in wallets
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
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'status') THEN
        ALTER TABLE public.wallets ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
    END IF;
END $$;

-- 5. WALLET TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount BIGINT NOT NULL,
    previous_balance BIGINT NOT NULL CHECK (previous_balance >= 0),
    new_balance BIGINT NOT NULL CHECK (new_balance >= 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED')),
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. TASKS TABLE
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'app_testing',
        'surveys',
        'social_engagement',
        'content_writing',
        'data_entry',
        'review_ratings',
        'local_services'
    )),
    reward_yer BIGINT NOT NULL CHECK (reward_yer > 0),
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    proof_requirements JSONB NOT NULL DEFAULT '{"require_image": true, "require_text": true}'::jsonb,
    time_estimate_minutes INT NOT NULL DEFAULT 10,
    total_quantity INT NOT NULL CHECK (total_quantity > 0),
    completed_quantity INT NOT NULL DEFAULT 0 CHECK (completed_quantity >= 0),
    max_per_user INT NOT NULL DEFAULT 1,
    budget_yer BIGINT NOT NULL CHECK (budget_yer >= 0),
    budget_spent_yer BIGINT NOT NULL DEFAULT 0 CHECK (budget_spent_yer >= 0),
    deadline TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. TASK SUBMISSIONS TABLE
CREATE TABLE IF NOT EXISTS public.task_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    proof_text TEXT,
    proof_images TEXT[] DEFAULT ARRAY[]::TEXT[],
    proof_url TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES public.profiles(id),
    reviewed_at TIMESTAMPTZ,
    reward_transaction_id UUID REFERENCES public.wallet_transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. PAYOUT METHODS TABLE
CREATE TABLE IF NOT EXISTS public.payout_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE CHECK (code IN ('KURAIMI', 'NAJM', 'JAWALI', 'ONE_CASH')),
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    min_withdrawal BIGINT NOT NULL DEFAULT 1000,
    max_withdrawal BIGINT NOT NULL DEFAULT 500000,
    fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 1.50,
    fee_flat BIGINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    required_fields JSONB NOT NULL DEFAULT '["beneficiary_name", "phone_number"]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. WITHDRAWAL REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('KURAIMI', 'NAJM', 'JAWALI', 'ONE_CASH')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    fee BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
    net_amount BIGINT NOT NULL CHECK (net_amount > 0),
    beneficiary_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    account_number TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED')),
    rejection_reason TEXT,
    transfer_reference TEXT,
    receipt_url TEXT,
    admin_id UUID REFERENCES public.profiles(id),
    reservation_transaction_id UUID REFERENCES public.wallet_transactions(id),
    refund_transaction_id UUID REFERENCES public.wallet_transactions(id),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 10. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 11. PLATFORM SETTINGS TABLE (Ensuring id exists as UUID or text)
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_name TEXT NOT NULL DEFAULT 'كسب اليمن',
    currency TEXT NOT NULL DEFAULT 'YER',
    min_withdrawal BIGINT NOT NULL DEFAULT 1000,
    max_withdrawal BIGINT NOT NULL DEFAULT 500000,
    daily_withdrawal_limit BIGINT NOT NULL DEFAULT 1000000,
    default_fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 1.50,
    referral_bonus BIGINT NOT NULL DEFAULT 300,
    task_submission_limit INT NOT NULL DEFAULT 10,
    is_registration_open BOOLEAN NOT NULL DEFAULT true,
    maintenance_mode BOOLEAN NOT NULL DEFAULT false,
    contact_phone TEXT DEFAULT '+967 739 701 293',
    contact_email TEXT DEFAULT 'khalidalbuhiri@gmail.com',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure id column exists on platform_settings if table was previously created without it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'id') THEN
        ALTER TABLE public.platform_settings ADD COLUMN id UUID PRIMARY KEY DEFAULT uuid_generate_v4();
    END IF;
END $$;

-- 12. DOUBLE-ENTRY LEDGER TABLES
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL CHECK (account_type IN ('TREASURY', 'USER', 'REVENUE', 'LIABILITY', 'ESCROW')),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ledger_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_type TEXT NOT NULL,
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.wallet_accounts(id),
    debit_amount BIGINT NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount BIGINT NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

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

-- 13. SYSTEM ERROR LOGS TABLE
CREATE TABLE IF NOT EXISTS public.system_error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_code TEXT,
    error_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'MEDIUM',
    operation TEXT NOT NULL,
    source_table TEXT,
    source_function TEXT,
    api_route TEXT,
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    request_id TEXT,
    environment TEXT NOT NULL DEFAULT 'Production',
    execution_duration_ms INT,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolution_note TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ
);

-- 14. SUPPORT TICKETS & MESSAGES
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'admin')),
    message TEXT NOT NULL,
    attachment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 15. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task_user ON public.task_submissions(task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status ON public.task_submissions(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_occurred ON public.system_error_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_type ON public.system_error_logs(error_type);

-- 16. TABLE-LEVEL PERMISSIONS (CRITICAL TO PREVENT PERMISSION DENIED BEFORE RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.platform_settings TO anon;
GRANT SELECT ON public.payout_methods TO anon;
GRANT SELECT ON public.tasks TO anon;
GRANT INSERT ON public.system_error_logs TO anon, authenticated, service_role;
GRANT SELECT ON public.system_error_logs TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 17. HELPER FUNCTION: is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (
        COALESCE(auth.jwt() ->> 'email', '') IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com')
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 18. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- 19. RLS POLICIES

-- Profiles
DROP POLICY IF EXISTS "Profiles read policy" ON public.profiles;
CREATE POLICY "Profiles read policy" ON public.profiles FOR SELECT
USING (auth.uid() = id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles update policy" ON public.profiles FOR UPDATE
USING (auth.uid() = id OR public.is_admin() OR auth.role() = 'service_role');

-- Wallets
DROP POLICY IF EXISTS "Wallets read policy" ON public.wallets;
CREATE POLICY "Wallets read policy" ON public.wallets FOR SELECT
USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

-- Wallet Transactions
DROP POLICY IF EXISTS "Transactions read policy" ON public.wallet_transactions;
CREATE POLICY "Transactions read policy" ON public.wallet_transactions FOR SELECT
USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

-- Tasks
DROP POLICY IF EXISTS "Tasks read policy" ON public.tasks;
CREATE POLICY "Tasks read policy" ON public.tasks FOR SELECT
USING (status = 'ACTIVE' OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Tasks admin manage policy" ON public.tasks;
CREATE POLICY "Tasks admin manage policy" ON public.tasks FOR ALL
USING (public.is_admin() OR auth.role() = 'service_role');

-- Submissions
DROP POLICY IF EXISTS "Submissions read policy" ON public.task_submissions;
CREATE POLICY "Submissions read policy" ON public.task_submissions FOR SELECT
USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Submissions insert policy" ON public.task_submissions;
CREATE POLICY "Submissions insert policy" ON public.task_submissions FOR INSERT
WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Submissions update policy" ON public.task_submissions;
CREATE POLICY "Submissions update policy" ON public.task_submissions FOR UPDATE
USING (public.is_admin() OR auth.role() = 'service_role');

-- Payout Methods
DROP POLICY IF EXISTS "Payout methods public read" ON public.payout_methods;
CREATE POLICY "Payout methods public read" ON public.payout_methods FOR SELECT
USING (true);

-- Withdrawal Requests
DROP POLICY IF EXISTS "Withdrawals read policy" ON public.withdrawal_requests;
CREATE POLICY "Withdrawals read policy" ON public.withdrawal_requests FOR SELECT
USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Withdrawals insert policy" ON public.withdrawal_requests;
CREATE POLICY "Withdrawals insert policy" ON public.withdrawal_requests FOR INSERT
WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Withdrawals update policy" ON public.withdrawal_requests;
CREATE POLICY "Withdrawals update policy" ON public.withdrawal_requests FOR UPDATE
USING (public.is_admin() OR auth.role() = 'service_role');

-- Notifications
DROP POLICY IF EXISTS "Notifications user policy" ON public.notifications;
CREATE POLICY "Notifications user policy" ON public.notifications FOR ALL
USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Platform Settings
DROP POLICY IF EXISTS "Platform settings read policy" ON public.platform_settings;
CREATE POLICY "Platform settings read policy" ON public.platform_settings FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Platform settings admin update policy" ON public.platform_settings;
CREATE POLICY "Platform settings admin update policy" ON public.platform_settings FOR ALL
USING (public.is_admin() OR auth.role() = 'service_role');

-- System Error Logs
DROP POLICY IF EXISTS "System error logs insert policy" ON public.system_error_logs;
CREATE POLICY "System error logs insert policy" ON public.system_error_logs FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "System error logs admin view policy" ON public.system_error_logs;
CREATE POLICY "System error logs admin view policy" ON public.system_error_logs FOR SELECT
USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "System error logs admin update policy" ON public.system_error_logs;
CREATE POLICY "System error logs admin update policy" ON public.system_error_logs FOR UPDATE
USING (public.is_admin() OR auth.role() = 'service_role');

-- 20. ATOMIC FINANCIAL FUNCTIONS

-- Credit Task Reward
CREATE OR REPLACE FUNCTION public.credit_task_reward(
    p_submission_id UUID,
    p_admin_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_sub RECORD;
    v_task RECORD;
    v_wallet RECORD;
    v_new_bal BIGINT;
    v_tx_id UUID;
    v_idempotency_key TEXT;
BEGIN
    SELECT * INTO v_sub FROM public.task_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'إثبات المهمة غير موجود.';
    END IF;

    IF v_sub.status = 'APPROVED' THEN
        RAISE EXCEPTION 'تمت الموافقة على هذه المهمة وصرف المكافأة مسبقاً.';
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'المهمة الأصلية غير موجودة.';
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'محفظة المستخدم غير موجودة.';
    END IF;

    v_new_bal := v_wallet.available_balance + v_task.reward_yer;
    v_idempotency_key := 'TASK_APPROVAL_' || p_submission_id::text;

    INSERT INTO public.wallet_transactions (
        user_id,
        type,
        amount,
        previous_balance,
        new_balance,
        status,
        reference_id,
        idempotency_key,
        description,
        admin_id
    ) VALUES (
        v_sub.user_id,
        'TASK_REWARD',
        v_task.reward_yer,
        v_wallet.available_balance,
        v_new_bal,
        'COMPLETED',
        p_submission_id::text,
        v_idempotency_key,
        'مكافأة إنجاز مهمة: ' || v_task.title,
        p_admin_id
    ) RETURNING id INTO v_tx_id;

    UPDATE public.wallets
    SET available_balance = v_new_bal,
        total_earned = total_earned + v_task.reward_yer,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    UPDATE public.tasks
    SET completed_quantity = completed_quantity + 1,
        budget_spent_yer = budget_spent_yer + v_task.reward_yer,
        status = CASE WHEN completed_quantity + 1 >= total_quantity THEN 'COMPLETED' ELSE status END,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_task.id;

    UPDATE public.task_submissions
    SET status = 'APPROVED',
        reviewed_by = p_admin_id,
        reviewed_at = timezone('utc'::text, now()),
        reward_transaction_id = v_tx_id
    WHERE id = p_submission_id;

    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        link
    ) VALUES (
        v_sub.user_id,
        'تم قبول المهمة وإيداع المكافأة!',
        'تمت الموافقة على إثباتك لمهمة "' || v_task.title || '" وإيداع ' || v_task.reward_yer || ' ر.ي في محفظتك.',
        'TASK_APPROVED',
        '/dashboard/wallet'
    );

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_tx_id,
        'new_balance', v_new_bal,
        'reward_credited', v_task.reward_yer
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reserve Balance for Withdrawal
CREATE OR REPLACE FUNCTION public.reserve_withdrawal(
    p_user_id UUID,
    p_method TEXT,
    p_amount BIGINT,
    p_beneficiary_name TEXT,
    p_phone_number TEXT,
    p_account_number TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_wallet RECORD;
    v_method RECORD;
    v_fee BIGINT;
    v_net BIGINT;
    v_new_bal BIGINT;
    v_withdrawal_id UUID;
    v_tx_id UUID;
BEGIN
    SELECT * INTO v_method FROM public.payout_methods WHERE code = p_method AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طريقة الدفع غير صالحة أو غير مفعلة.';
    END IF;

    IF p_amount < v_method.min_withdrawal THEN
        RAISE EXCEPTION 'المبلغ أقل من الحد الأدنى للسحب (% ر.ي)', v_method.min_withdrawal;
    END IF;

    IF p_amount > v_method.max_withdrawal THEN
        RAISE EXCEPTION 'المبلغ يتجاوز الحد الأقصى للسحب (% ر.ي)', v_method.max_withdrawal;
    END IF;

    v_fee := ROUND((p_amount * v_method.fee_percentage) / 100) + v_method.fee_flat;
    v_net := p_amount - v_fee;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'محفظة المستخدم غير موجودة.';
    END IF;

    IF v_wallet.available_balance < p_amount THEN
        RAISE EXCEPTION 'رصيدك المتاح غير كافٍ لتنفيذ عملية السحب.';
    END IF;

    v_new_bal := v_wallet.available_balance - p_amount;

    INSERT INTO public.withdrawal_requests (
        user_id,
        method,
        amount,
        fee,
        net_amount,
        beneficiary_name,
        phone_number,
        account_number,
        status
    ) VALUES (
        p_user_id,
        p_method,
        p_amount,
        v_fee,
        v_net,
        p_beneficiary_name,
        p_phone_number,
        p_account_number,
        'PENDING'
    ) RETURNING id INTO v_withdrawal_id;

    INSERT INTO public.wallet_transactions (
        user_id,
        type,
        amount,
        previous_balance,
        new_balance,
        status,
        reference_id,
        idempotency_key,
        description
    ) VALUES (
        p_user_id,
        'WITHDRAWAL_REQUEST',
        -p_amount,
        v_wallet.available_balance,
        v_new_bal,
        'COMPLETED',
        v_withdrawal_id::text,
        'WITHDRAWAL_RESERVE_' || v_withdrawal_id::text,
        'حجز رصيد لطلب سحب عبر ' || v_method.name_ar
    ) RETURNING id INTO v_tx_id;

    UPDATE public.wallets
    SET available_balance = v_new_bal,
        pending_balance = pending_balance + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    UPDATE public.withdrawal_requests
    SET reservation_transaction_id = v_tx_id
    WHERE id = v_withdrawal_id;

    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        link
    ) VALUES (
        p_user_id,
        'تم استلام طلب السحب بنجاح',
        'طلب سحب بمبلغ ' || p_amount || ' ر.ي قيد المراجعة والمعالجة المالية.',
        'WITHDRAWAL_SUBMITTED',
        '/dashboard/withdrawals'
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'reserved_amount', p_amount,
        'fee', v_fee,
        'net_amount', v_net,
        'new_available_balance', v_new_bal
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 21. SEED DEFAULT PLATFORM DATA & DATA MIGRATION FROM LOCAL SYSTEM
-- Payout Methods
INSERT INTO public.payout_methods (code, name, name_ar, min_withdrawal, max_withdrawal, fee_percentage, fee_flat, is_active)
VALUES 
    ('KURAIMI', 'Al-Kuraimi Microfinance Bank', 'بنك الكريمي للتمويل الأصغر الإسلامي', 1000, 500000, 1.00, 0, true),
    ('NAJM', 'Al-Najm Financial Remittance', 'شبكة النجم للحوالات المالية الفورية', 1000, 500000, 1.50, 0, true),
    ('JAWALI', 'Jawali Wallet (CAC Bank)', 'محفظة جوالي كاك بنك', 1000, 250000, 1.00, 0, true),
    ('ONE_CASH', 'OneCash Wallet', 'محفظة ون كاش (OneCash)', 1000, 300000, 1.00, 0, true)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    name_ar = EXCLUDED.name_ar,
    min_withdrawal = EXCLUDED.min_withdrawal,
    max_withdrawal = EXCLUDED.max_withdrawal,
    fee_percentage = EXCLUDED.fee_percentage,
    is_active = EXCLUDED.is_active;

-- Platform Settings Initial Record
INSERT INTO public.platform_settings (
    platform_name,
    currency,
    min_withdrawal,
    max_withdrawal,
    daily_withdrawal_limit,
    default_fee_percentage,
    referral_bonus,
    task_submission_limit,
    is_registration_open,
    maintenance_mode,
    contact_phone,
    contact_email
) VALUES (
    'كسب اليمن',
    'YER',
    1000,
    500000,
    1000000,
    1.50,
    300,
    10,
    true,
    false,
    '+967 739 701 293',
    'khalidalbuhiri@gmail.com'
) ON CONFLICT DO NOTHING;

-- Double-Entry System Accounts
INSERT INTO public.wallet_accounts (name, account_type)
VALUES 
    ('SYSTEM_TREASURY_MAIN', 'TREASURY'),
    ('TASK_ESCROW_POOL', 'ESCROW')
ON CONFLICT (name) DO NOTHING;

-- Safe Migration of existing seed users and wallets from database.json
INSERT INTO public.profiles (id, full_name, phone, email, role, status, referral_code, city)
VALUES 
    ('00000000-0000-4000-8000-000000000001', 'مالك منصة كسب اليمن', '739701293', 'khalidalbuhiri@gmail.com', 'admin', 'active', 'OWNER01', 'صنعاء'),
    ('6489de36-2f42-482d-8601-37f2ddefdfd9', 'مستثمر اختبار', '770000000', 'investor@test.com', 'user', 'active', 'KY625408', 'صنعاء'),
    ('df1a477c-b703-46b2-9fe2-1a4bd0f9b52d', 'مستخدم تجريبي فحص', '771122334', 'testuser1@test.com', 'user', 'active', 'KY479476', 'صنعاء'),
    ('502a8069-ba76-4e9c-80c7-d2a5784b38c8', 'مستخدم فحص السيرفر', '7799887766', 'servertest@test.com', 'user', 'active', 'KY116252', 'صنعاء'),
    ('ffb25afa-0760-4c63-8039-f4a92413bc41', 'محمد أحمد علي', '771234567', 'user_test_regular@test.com', 'user', 'active', 'KY454139', 'صنعاء')
ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name;

-- Ensure Wallets for all migrated profiles
INSERT INTO public.wallets (user_id, available_balance, pending_balance, reserved_balance, total_earned, total_transferred, total_withdrawn, wallet_address, status)
VALUES
    ('00000000-0000-4000-8000-000000000001', 10000000, 0, 0, 0, 0, 0, 'KY-F1E59268AC6D', 'ACTIVE'),
    ('6489de36-2f42-482d-8601-37f2ddefdfd9', 0, 0, 0, 0, 0, 0, 'KY-9D5558F65AD7', 'ACTIVE'),
    ('df1a477c-b703-46b2-9fe2-1a4bd0f9b52d', 0, 0, 0, 0, 0, 0, 'KY-D134356CAE1D', 'ACTIVE'),
    ('502a8069-ba76-4e9c-80c7-d2a5784b38c8', 0, 0, 0, 0, 0, 0, 'KY-C5F612C1AE3A', 'ACTIVE'),
    ('ffb25afa-0760-4c63-8039-f4a92413bc41', 0, 0, 0, 0, 0, 0, 'KY-08BEFE785644', 'ACTIVE')
ON CONFLICT (user_id) DO UPDATE SET
    wallet_address = EXCLUDED.wallet_address;
