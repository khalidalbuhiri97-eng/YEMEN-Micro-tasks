-- ==============================================================================
-- KASB YEMEN PLATFORM (كسب اليمن للمهام المصغرة)
-- Comprehensive Database Schema, RLS Policies & Atomic Financial Functions
-- Migration: 001_initial_schema.sql
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- 2. USER ROLES TABLE (Explicit Role Mapping)
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    granted_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, role)
);

-- 3. WALLETS TABLE (Integer Minor Units in Yemeni Riyals - YER)
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    available_balance BIGINT NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    pending_balance BIGINT NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
    total_earned BIGINT NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_withdrawn BIGINT NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
    currency TEXT NOT NULL DEFAULT 'YER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. WALLET TRANSACTIONS TABLE (Immutable Financial Ledger)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'TASK_REWARD',
        'WITHDRAWAL_REQUEST',
        'WITHDRAWAL_REFUND',
        'REFERRAL_REWARD',
        'ADMIN_ADJUSTMENT',
        'PROMOTIONAL_BONUS'
    )),
    amount BIGINT NOT NULL, -- Positive for credits, negative for debits
    previous_balance BIGINT NOT NULL CHECK (previous_balance >= 0),
    new_balance BIGINT NOT NULL CHECK (new_balance >= 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED')),
    reference_id TEXT, -- e.g. task_submission_id or withdrawal_id
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. TASKS TABLE
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

-- 6. TASK ALLOCATIONS TABLE
CREATE TABLE IF NOT EXISTS public.task_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(task_id, user_id)
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

-- 8. PAYOUT METHODS TABLE (Yemeni Payment Services)
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
    type TEXT NOT NULL CHECK (type IN (
        'TASK_APPROVED',
        'TASK_REJECTED',
        'REWARD_CREDITED',
        'WITHDRAWAL_SUBMITTED',
        'WITHDRAWAL_PROCESSING',
        'WITHDRAWAL_COMPLETED',
        'WITHDRAWAL_REJECTED',
        'SYSTEM_ANNOUNCEMENT'
    )),
    link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 11. REFERRALS TABLE
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    referred_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUALIFIED', 'REWARDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 12. REFERRAL REWARDS TABLE
CREATE TABLE IF NOT EXISTS public.referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_id UUID NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'PENDING')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 13. PLATFORM SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_name TEXT NOT NULL DEFAULT 'كسب اليمن',
    currency TEXT NOT NULL DEFAULT 'YER',
    min_withdrawal BIGINT NOT NULL DEFAULT 1000,
    max_withdrawal BIGINT NOT NULL DEFAULT 500000,
    daily_withdrawal_limit BIGINT NOT NULL DEFAULT 1000000,
    default_fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 1.50,
    referral_bonus BIGINT NOT NULL DEFAULT 250,
    task_submission_limit INT NOT NULL DEFAULT 10,
    is_registration_open BOOLEAN NOT NULL DEFAULT true,
    maintenance_mode BOOLEAN NOT NULL DEFAULT false,
    contact_phone TEXT DEFAULT '+967770000000',
    contact_email TEXT DEFAULT 'support@kasbyemen.com',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 14. ADMIN AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 15. FRAUD REPORTS TABLE
CREATE TABLE IF NOT EXISTS public.fraud_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    risk_score INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
    reviewed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 16. SUPPORT TICKETS TABLE
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 17. SUPPORT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'admin')),
    message TEXT NOT NULL,
    attachment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task_user ON public.task_submissions(task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status ON public.task_submissions(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles: Users can view their own profile, Admins can view all
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can update non-critical profile fields"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- Wallets: Users can ONLY read their own wallet, NEVER update directly
CREATE POLICY "Users can view own wallet"
    ON public.wallets FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

-- Wallet Transactions: Read-only for users and admins
CREATE POLICY "Users can view own wallet transactions"
    ON public.wallet_transactions FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

-- Tasks: Publicly visible if ACTIVE, Admins have full access
CREATE POLICY "Anyone can view active tasks"
    ON public.tasks FOR SELECT
    USING (status = 'ACTIVE' OR public.is_admin());

CREATE POLICY "Admins can manage tasks"
    ON public.tasks FOR ALL
    USING (public.is_admin());

-- Submissions: Users view/insert own, Admin reviews
CREATE POLICY "Users can view own submissions"
    ON public.task_submissions FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users can insert own submissions"
    ON public.task_submissions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update submissions"
    ON public.task_submissions FOR UPDATE
    USING (public.is_admin());

-- Withdrawals: Users can create and view own requests
CREATE POLICY "Users can view own withdrawals"
    ON public.withdrawal_requests FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

-- Notifications: Users can view and mark own read
CREATE POLICY "Users can manage own notifications"
    ON public.notifications FOR ALL
    USING (auth.uid() = user_id);

-- ==============================================================================
-- ATOMIC POSTGRESQL FINANCIAL FUNCTIONS (ACID TRANSACTIONS)
-- ==============================================================================

-- 1. Function: Credit Task Reward (Atomic execution, prevents duplicate credit)
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
    -- Verify caller is admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not an administrator.';
    END IF;

    -- Select submission with row lock
    SELECT * INTO v_sub FROM public.task_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found.';
    END IF;

    IF v_sub.status = 'APPROVED' THEN
        RAISE EXCEPTION 'Submission has already been approved and credited.';
    END IF;

    -- Select task
    SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found.';
    END IF;

    -- Select user wallet with row lock
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User wallet not found.';
    END IF;

    v_new_bal := v_wallet.available_balance + v_task.reward_yer;
    v_idempotency_key := 'TASK_APPROVAL_' || p_submission_id::text;

    -- Insert financial ledger entry
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

    -- Update wallet balances atomically
    UPDATE public.wallets
    SET available_balance = v_new_bal,
        total_earned = total_earned + v_task.reward_yer,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    -- Update task counters
    UPDATE public.tasks
    SET completed_quantity = completed_quantity + 1,
        budget_spent_yer = budget_spent_yer + v_task.reward_yer,
        status = CASE 
            WHEN completed_quantity + 1 >= total_quantity THEN 'COMPLETED'
            ELSE status
        END,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_task.id;

    -- Update submission status
    UPDATE public.task_submissions
    SET status = 'APPROVED',
        reviewed_by = p_admin_id,
        reviewed_at = timezone('utc'::text, now()),
        reward_transaction_id = v_tx_id
    WHERE id = p_submission_id;

    -- Send notification to user
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

-- 2. Function: Reserve Balance for Withdrawal (Atomic execution, prevents overdraft)
CREATE OR REPLACE FUNCTION public.reserve_withdrawal(
    p_user_id UUID,
    p_method TEXT,
    p_amount BIGINT,
    p_beneficiary_name TEXT,
    p_phone_number TEXT,
    p_account_number TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_wallet RECORD;
    v_settings RECORD;
    v_method RECORD;
    v_fee BIGINT;
    v_net BIGINT;
    v_new_bal BIGINT;
    v_withdrawal_id UUID;
    v_tx_id UUID;
BEGIN
    -- Validate payout method
    SELECT * INTO v_method FROM public.payout_methods WHERE code = p_method AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طريقة الدفع غير صالحة أو غير مفعلة.';
    END IF;

    -- Validate limits
    IF p_amount < v_method.min_withdrawal THEN
        RAISE EXCEPTION 'المبلغ أقل من الحد الأدنى للسحب (% ر.ي)', v_method.min_withdrawal;
    END IF;

    IF p_amount > v_method.max_withdrawal THEN
        RAISE EXCEPTION 'المبلغ يتجاوز الحد الأقصى للسحب (% ر.ي)', v_method.max_withdrawal;
    END IF;

    -- Calculate fee
    v_fee := ROUND((p_amount * v_method.fee_percentage) / 100) + v_method.fee_flat;
    v_net := p_amount - v_fee;

    -- Lock wallet row
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'محفظة المستخدم غير موجودة.';
    END IF;

    IF v_wallet.available_balance < p_amount THEN
        RAISE EXCEPTION 'رصيدك المتاح غير كافٍ لتنفيذ عملية السحب.';
    END IF;

    v_new_bal := v_wallet.available_balance - p_amount;

    -- Create withdrawal request
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

    -- Record atomic withdrawal transaction in ledger
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

    -- Update wallet (move from available to pending balance)
    UPDATE public.wallets
    SET available_balance = v_new_bal,
        pending_balance = pending_balance + p_amount,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    -- Link transaction to withdrawal
    UPDATE public.withdrawal_requests
    SET reservation_transaction_id = v_tx_id
    WHERE id = v_withdrawal_id;

    -- Create notification
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

-- 3. Function: Confirm Withdrawal Payment (Admin action, completes payout)
CREATE OR REPLACE FUNCTION public.confirm_withdrawal_payout(
    p_withdrawal_id UUID,
    p_admin_id UUID,
    p_transfer_reference TEXT,
    p_receipt_url TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_with RECORD;
    v_wallet RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'غير مصرح: يجب أن يكون القائم بالعملية مديراً للنظام.';
    END IF;

    SELECT * INTO v_with FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طلب السحب غير موجود.';
    END IF;

    IF v_with.status = 'PAID' THEN
        RAISE EXCEPTION 'تم دفع هذا الطلب وتأكيده مسبقاً.';
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_with.user_id FOR UPDATE;

    -- Deduct from pending balance and increment total withdrawn
    UPDATE public.wallets
    SET pending_balance = pending_balance - v_with.amount,
        total_withdrawn = total_withdrawn + v_with.amount,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    -- Update withdrawal request status
    UPDATE public.withdrawal_requests
    SET status = 'PAID',
        admin_id = p_admin_id,
        transfer_reference = p_transfer_reference,
        receipt_url = p_receipt_url,
        processed_at = timezone('utc'::text, now())
    WHERE id = p_withdrawal_id;

    -- Notify user
    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        link
    ) VALUES (
        v_with.user_id,
        'تم تحويل مبلغ السحب بنجاح!',
        'تم إرسال ' || v_with.net_amount || ' ر.ي بنجاح برقم الحوالة: ' || p_transfer_reference,
        'WITHDRAWAL_COMPLETED',
        '/dashboard/withdrawals'
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'PAID',
        'transfer_reference', p_transfer_reference
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Function: Refund Rejected Withdrawal (Returns reserved funds to available balance)
CREATE OR REPLACE FUNCTION public.refund_withdrawal(
    p_withdrawal_id UUID,
    p_admin_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_with RECORD;
    v_wallet RECORD;
    v_new_bal BIGINT;
    v_tx_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'غير مصرح: العملية خاصة بمدراء النظام.';
    END IF;

    SELECT * INTO v_with FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طلب السحب غير موجود.';
    END IF;

    IF v_with.status IN ('PAID', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'لا يمكن إعادة هذا الطلب لأنه مكتمل أو مرفوض مسبقاً.';
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_with.user_id FOR UPDATE;

    v_new_bal := v_wallet.available_balance + v_with.amount;

    -- Record refund in immutable ledger
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
        v_with.user_id,
        'WITHDRAWAL_REFUND',
        v_with.amount,
        v_wallet.available_balance,
        v_new_bal,
        'COMPLETED',
        p_withdrawal_id::text,
        'WITHDRAWAL_REFUND_' || p_withdrawal_id::text,
        'استرجاع رصيد لطلب سحب مرفوض: ' || p_rejection_reason,
        p_admin_id
    ) RETURNING id INTO v_tx_id;

    -- Restore balances
    UPDATE public.wallets
    SET available_balance = v_new_bal,
        pending_balance = pending_balance - v_with.amount,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_wallet.id;

    -- Update withdrawal status
    UPDATE public.withdrawal_requests
    SET status = 'REJECTED',
        rejection_reason = p_rejection_reason,
        admin_id = p_admin_id,
        refund_transaction_id = v_tx_id,
        processed_at = timezone('utc'::text, now())
    WHERE id = p_withdrawal_id;

    -- Notify user
    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        link
    ) VALUES (
        v_with.user_id,
        'تم رفض طلب السحب واستعادة الرصيد',
        'تم استرجاع مبلغ ' || v_with.amount || ' ر.ي إلى محفظتك. السبب: ' || p_rejection_reason,
        'WITHDRAWAL_REJECTED',
        '/dashboard/wallet'
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'refunded_amount', v_with.amount,
        'new_available_balance', v_new_bal
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 18. AUTH TRIGGER: AUTO-CREATE PROFILE & WALLET FOR NEW USERS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_ref_code TEXT;
    v_role TEXT := 'user';
    v_phone TEXT;
    v_full_name TEXT;
BEGIN
    -- Check if this is the authorized owner administrator
    IF LOWER(NEW.email) = 'khalidalbuhiri@gmail.com' THEN
        v_role := 'admin';
    END IF;

    -- Generate random 8-character referral code
    v_ref_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    v_phone := COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, '739701293');
    v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'مستخدم جديد');

    -- Insert Profile
    INSERT INTO public.profiles (
        id,
        full_name,
        phone,
        email,
        role,
        status,
        referral_code,
        city
    ) VALUES (
        NEW.id,
        v_full_name,
        v_phone,
        NEW.email,
        v_role,
        'active',
        v_ref_code,
        COALESCE(NEW.raw_user_meta_data->>'city', 'صنعاء')
    ) ON CONFLICT (id) DO NOTHING;

    -- Insert Initial Empty Wallet (0 YER)
    INSERT INTO public.wallets (
        user_id,
        available_balance,
        pending_balance,
        total_earned,
        total_withdrawn,
        currency
    ) VALUES (
        NEW.id,
        0,
        0,
        0,
        0,
        'YER'
    ) ON CONFLICT (user_id) DO NOTHING;

    -- Insert User Role
    INSERT INTO public.user_roles (
        user_id,
        role
    ) VALUES (
        NEW.id,
        v_role
    ) ON CONFLICT (user_id, role) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 19. SEED DEFAULT PLATFORM SETTINGS & PAYOUT METHODS
-- ==============================================================================
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

INSERT INTO public.payout_methods (code, name, name_ar, min_withdrawal, max_withdrawal, fee_percentage, fee_flat, is_active, required_fields)
VALUES 
    ('KURAIMI', 'Al-Kuraimi Microfinance Bank', 'بنك الكريمي للتمويل الأصغر الإسلامي', 1000, 500000, 1.00, 0, true, '["beneficiary_name", "phone_number", "account_number"]'::jsonb),
    ('NAJM', 'Al-Najm Financial Remittance', 'شبكة النجم للحوالات المالية الفورية', 1000, 500000, 1.50, 0, true, '["beneficiary_name", "phone_number"]'::jsonb),
    ('JAWALI', 'Jawali Wallet (CAC Bank)', 'محفظة جوالي كاك بنك', 1000, 250000, 1.00, 0, true, '["beneficiary_name", "phone_number"]'::jsonb),
    ('ONE_CASH', 'OneCash Wallet', 'محفظة ون كاش (OneCash)', 1000, 300000, 1.00, 0, true, '["beneficiary_name", "phone_number"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ==============================================================================
-- 20. STORAGE BUCKETS SETUP & STORAGE RLS POLICIES
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('task-proofs', 'task-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
    ('withdrawal-receipts', 'withdrawal-receipts', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]),
    ('user-avatars', 'user-avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
    ('support-attachments', 'support-attachments', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET 
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage Policies for task-proofs
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can upload task proofs') THEN
        CREATE POLICY "Users can upload task proofs"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'task-proofs');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users and admins can view task proofs') THEN
        CREATE POLICY "Users and admins can view task proofs"
        ON storage.objects FOR SELECT
        TO authenticated
        USING (bucket_id = 'task-proofs');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Only admins can upload withdrawal receipts') THEN
        CREATE POLICY "Only admins can upload withdrawal receipts"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'withdrawal-receipts' AND public.is_admin());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users and admins can view withdrawal receipts') THEN
        CREATE POLICY "Users and admins can view withdrawal receipts"
        ON storage.objects FOR SELECT
        TO authenticated
        USING (bucket_id = 'withdrawal-receipts');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view avatars') THEN
        CREATE POLICY "Anyone can view avatars"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'user-avatars');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can upload own avatar') THEN
        CREATE POLICY "Users can upload own avatar"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'user-avatars');
    END IF;
END $$;

