-- ==============================================================================
-- Migration 011: Comprehensive Single-Owner Financial & Accounting System
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Aligned 100% with Live Schema:
--   public.financial_accounts, public.ledger_transactions, public.ledger_entries,
--   public.wallets, public.tasks, public.task_submissions, public.admin_logs,
--   public.user_roles, public.is_admin(), public.post_ledger_transaction
-- NOTE: Prepared for deployment; NOT executed automatically on live Supabase.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Expand financial_accounts.account_type Constraint Safely
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_constraint RECORD;
BEGIN
    FOR v_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.financial_accounts'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%account_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.financial_accounts DROP CONSTRAINT IF EXISTS %I', v_constraint.conname);
    END LOOP;
END $$;

ALTER TABLE public.financial_accounts
ADD CONSTRAINT financial_accounts_account_type_check
CHECK (LOWER(account_type) IN (
    'treasury', 'wallet', 'control', 'escrow', 'revenue', 'expense', 'liability', 'equity', 'asset'
));

-- ------------------------------------------------------------------------------
-- 2. Seed Single-Owner Chart of Accounts in public.financial_accounts
--    Preserves existing PLATFORM-TREASURY, VIRTUAL-ISSUANCE-CONTROL, WALLET-*, TASK-ESCROW-*
-- ------------------------------------------------------------------------------
INSERT INTO public.financial_accounts (
    account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
) VALUES
    ('PLATFORM-TREASURY', 'treasury', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('VIRTUAL-ISSUANCE-CONTROL', 'control', NULL, NULL, 'debit', 0, 'active', NOW()),
    ('PLATFORM-CASH-VAULT', 'asset', NULL, NULL, 'debit', 0, 'active', NOW()),
    ('PLATFORM-REVENUE-TASKS', 'revenue', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('PLATFORM-REVENUE-ADS', 'revenue', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('PLATFORM-REVENUE-SUBSCRIPTIONS', 'revenue', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('PLATFORM-REVENUE-SERVICES', 'revenue', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('PLATFORM-EXPENSES', 'expense', NULL, NULL, 'debit', 0, 'active', NOW()),
    ('PLATFORM-EXPENSE-CLEARING', 'liability', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('PAYMENT-PROVIDER-FEES', 'expense', NULL, NULL, 'debit', 0, 'active', NOW()),
    ('OWNER-CAPITAL', 'equity', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('OWNER-CURRENT-ACCOUNT', 'equity', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('OWNER-WITHDRAWALS', 'equity', NULL, NULL, 'debit', 0, 'active', NOW()),
    ('RETAINED-EARNINGS', 'equity', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('TAX-PAYABLE', 'liability', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('WITHDRAWAL-RESERVED', 'liability', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('WITHDRAWAL-SETTLED', 'liability', NULL, NULL, 'credit', 0, 'active', NOW()),
    ('TASK-ESCROW-POOL', 'escrow', NULL, NULL, 'credit', 0, 'active', NOW())
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. Non-Breaking Task Commission Support Column (Defaults to 0)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'commission_units'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN commission_units BIGINT NOT NULL DEFAULT 0 CHECK (commission_units >= 0);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Payout Methods, Withdrawal Requests, Notifications, Taxes & Financial Audit
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE CHECK (code IN ('KURAIMI', 'NAJM', 'JAWALI', 'ONE_CASH')),
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    min_withdrawal BIGINT NOT NULL DEFAULT 1000 CHECK (min_withdrawal > 0),
    max_withdrawal BIGINT NOT NULL DEFAULT 500000 CHECK (max_withdrawal >= min_withdrawal),
    fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 1.50 CHECK (fee_percentage >= 0),
    fee_flat BIGINT NOT NULL DEFAULT 0 CHECK (fee_flat >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    required_fields JSONB NOT NULL DEFAULT '["beneficiary_name", "phone_number"]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.payout_methods (code, name, name_ar, min_withdrawal, max_withdrawal, fee_percentage, fee_flat, is_active, required_fields) VALUES
    ('KURAIMI', 'Al-Kuraimi Microfinance Bank', 'بنك الكريمي للتمويل الأصغر الإسلامي', 1000, 500000, 1.00, 0, true, '["beneficiary_name", "phone_number", "account_number"]'::jsonb),
    ('NAJM', 'Al-Najm Financial Remittance', 'شبكة النجم للحوالات المالية الفورية', 1000, 500000, 1.50, 0, true, '["beneficiary_name", "phone_number"]'::jsonb),
    ('JAWALI', 'Jawali Wallet (CAC Bank)', 'محفظة جوالي كاك بنك', 1000, 250000, 1.00, 0, true, '["beneficiary_name", "phone_number"]'::jsonb),
    ('ONE_CASH', 'OneCash Wallet', 'محفظة ون كاش (OneCash)', 1000, 300000, 1.00, 0, true, '["beneficiary_name", "phone_number"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    idempotency_key TEXT UNIQUE,
    reservation_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    settlement_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    refund_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

-- Flexible Tax Engine (Zero default tax rates; disabled until owner activates)
CREATE TABLE IF NOT EXISTS public.tax_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_type TEXT NOT NULL,
    tax_authority TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'YEMEN',
    tax_base TEXT NOT NULL,
    rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (rate_percentage >= 0),
    flat_amount BIGINT NOT NULL DEFAULT 0 CHECK (flat_amount >= 0),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT false,
    exemptions_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tax_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_definition_id UUID NOT NULL REFERENCES public.tax_definitions(id) ON DELETE RESTRICT,
    taxable_amount BIGINT NOT NULL CHECK (taxable_amount >= 0),
    tax_amount BIGINT NOT NULL CHECK (tax_amount >= 0),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SETTLED', 'CANCELLED')),
    ledger_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    settled_at TIMESTAMPTZ,
    reference_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active payout methods" ON public.payout_methods;
CREATE POLICY "Public read active payout methods" ON public.payout_methods
FOR SELECT USING (is_active = true OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage payout methods" ON public.payout_methods;
CREATE POLICY "Admin manage payout methods" ON public.payout_methods
FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own withdrawals or admin all" ON public.withdrawal_requests;
CREATE POLICY "Users read own withdrawals or admin all" ON public.withdrawal_requests
FOR SELECT USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage withdrawals" ON public.withdrawal_requests;
CREATE POLICY "Admin manage withdrawals" ON public.withdrawal_requests
FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage tax definitions" ON public.tax_definitions;
CREATE POLICY "Admin manage tax definitions" ON public.tax_definitions
FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage tax settlements" ON public.tax_settlements;
CREATE POLICY "Admin manage tax settlements" ON public.tax_settlements
FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage financial audit logs" ON public.financial_audit_logs;
CREATE POLICY "Admin manage financial audit logs" ON public.financial_audit_logs
FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 5. Immutable Ledger Protection Triggers (Append-Only Enforcement)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Ledger records are immutable and cannot be updated or deleted; use reverse_ledger_transaction instead.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ledger_transactions_mutation ON public.ledger_transactions;
CREATE TRIGGER trg_prevent_ledger_transactions_mutation
    BEFORE UPDATE OR DELETE ON public.ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_prevent_ledger_entries_mutation ON public.ledger_entries;
CREATE TRIGGER trg_prevent_ledger_entries_mutation
    BEFORE UPDATE OR DELETE ON public.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

-- ------------------------------------------------------------------------------
-- 6. Atomic Reversing Entry RPC (reverse_ledger_transaction)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reverse_ledger_transaction(UUID, TEXT);

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
    v_original_tx RECORD;
    v_existing_rev RECORD;
    v_new_tx_id UUID;
    v_idempotency_key TEXT;
    v_entry RECORD;
    v_swapped_side TEXT;
    v_delta BIGINT;
    v_new_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF p_transaction_id IS NULL THEN
        RAISE EXCEPTION 'Transaction ID is required';
    END IF;

    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('reverse_ledger_tx_' || p_transaction_id::text));

    v_idempotency_key := 'REVERSAL:' || p_transaction_id::text;

    SELECT id INTO v_existing_rev
    FROM public.ledger_transactions
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'original_transaction_id', p_transaction_id,
            'reversal_transaction_id', v_existing_rev.id
        );
    END IF;

    SELECT * INTO v_original_tx
    FROM public.ledger_transactions
    WHERE id = p_transaction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original transaction not found';
    END IF;

    IF UPPER(v_original_tx.transaction_type) LIKE 'REVERSAL_%' THEN
        RAISE EXCEPTION 'Cannot reverse a reversal transaction';
    END IF;

    -- Lock all involved accounts in deterministic order to avoid deadlocks
    PERFORM id
    FROM public.financial_accounts
    WHERE id IN (SELECT DISTINCT account_id FROM public.ledger_entries WHERE transaction_id = p_transaction_id)
    ORDER BY id ASC
    FOR UPDATE;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REVERSAL_' || v_original_tx.transaction_type,
        'REVERSAL:' || p_transaction_id::text,
        v_idempotency_key,
        'posted',
        jsonb_build_object(
            'original_transaction_id', p_transaction_id,
            'original_type', v_original_tx.transaction_type,
            'reason', TRIM(p_reason),
            'description', 'قيد عكسي للمعاملة ' || p_transaction_id::text || ': ' || TRIM(p_reason),
            'reversed_by', v_admin_id
        ),
        v_admin_id,
        v_now
    )
    RETURNING id INTO v_new_tx_id;

    FOR v_entry IN
        SELECT le.account_id, le.entry_side, le.amount_units, fa.normal_side
        FROM public.ledger_entries le
        JOIN public.financial_accounts fa ON fa.id = le.account_id
        WHERE le.transaction_id = p_transaction_id
        ORDER BY le.account_id ASC
    LOOP
        v_swapped_side := CASE WHEN LOWER(v_entry.entry_side) = 'debit' THEN 'credit' ELSE 'debit' END;

        INSERT INTO public.ledger_entries (
            transaction_id, account_id, entry_side, amount_units, memo, created_at
        ) VALUES (
            v_new_tx_id,
            v_entry.account_id,
            v_swapped_side,
            v_entry.amount_units,
            'قيد عكسي: ' || TRIM(p_reason),
            v_now
        );

        v_delta := CASE
            WHEN LOWER(v_entry.normal_side) = v_swapped_side THEN v_entry.amount_units
            ELSE -v_entry.amount_units
        END;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + v_delta
        WHERE id = v_entry.account_id
        RETURNING balance_units INTO v_new_bal;

        IF v_new_bal < 0 THEN
            RAISE EXCEPTION 'Reversal would result in negative balance on account %', v_entry.account_id;
        END IF;
    END LOOP;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'REVERSE_TRANSACTION',
        v_admin_id,
        v_new_tx_id,
        jsonb_build_object('original_transaction_id', p_transaction_id, 'reason', TRIM(p_reason)),
        v_now
    );

    INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
        v_admin_id,
        'REVERSE_LEDGER_TRANSACTION',
        'ledger_transaction',
        v_new_tx_id,
        jsonb_build_object('original_transaction_id', p_transaction_id, 'reason', TRIM(p_reason)),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'original_transaction_id', p_transaction_id,
        'reversal_transaction_id', v_new_tx_id
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Atomic Task Escrow Release RPC (release_task_escrow)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_task_escrow(
    p_task_id UUID,
    p_reason TEXT DEFAULT 'تحرير الأموال المتبقية من ميزانية المهمة'
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
    v_existing_tx RECORD;
    v_tx_id UUID;
    v_idempotency_key TEXT;
    v_release_amount BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF p_task_id IS NULL THEN
        RAISE EXCEPTION 'Task ID is required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('release_task_escrow_' || p_task_id::text));

    v_idempotency_key := 'TASK-ESCROW-RELEASE:' || p_task_id::text;

    SELECT id INTO v_existing_tx
    FROM public.ledger_transactions
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'task_id', p_task_id,
            'transaction_id', v_existing_tx.id,
            'released_units', 0
        );
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;

    SELECT * INTO v_escrow
    FROM public.financial_accounts
    WHERE (id = v_task.escrow_account_id OR account_code = 'TASK-ESCROW-' || p_task_id::text)
    LIMIT 1;

    IF NOT FOUND OR v_escrow.balance_units <= 0 THEN
        UPDATE public.tasks SET status = 'archived' WHERE id = p_task_id AND LOWER(status) <> 'completed';
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', false,
            'task_id', p_task_id,
            'released_units', 0,
            'message', 'No remaining escrow balance to release'
        );
    END IF;

    SELECT * INTO v_treasury
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-TREASURY'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PLATFORM-TREASURY account not found';
    END IF;

    -- Deterministic lock
    IF v_escrow.id < v_treasury.id THEN
        PERFORM id FROM public.financial_accounts WHERE id = v_escrow.id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_treasury.id FOR UPDATE;
    ELSE
        PERFORM id FROM public.financial_accounts WHERE id = v_treasury.id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_escrow.id FOR UPDATE;
    END IF;

    SELECT balance_units INTO v_release_amount FROM public.financial_accounts WHERE id = v_escrow.id;

    IF v_release_amount <= 0 THEN
        RETURN jsonb_build_object('success', true, 'idempotent', false, 'task_id', p_task_id, 'released_units', 0);
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'TASK_BUDGET_REFUND',
        'TASK:' || p_task_id::text,
        v_idempotency_key,
        'posted',
        jsonb_build_object(
            'task_id', p_task_id,
            'task_title', v_task.title,
            'released_units', v_release_amount,
            'reason', COALESCE(NULLIF(TRIM(p_reason), ''), 'إلغاء/إغلاق المهمة واسترجاع المتبقي للخزينة'),
            'description', 'استرجاع الرصيد المتبقي من ضمان المهمة: ' || v_task.title
        ),
        v_admin_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_escrow.id, 'debit', v_release_amount, 'تحرير متبقي ضمان المهمة للخزينة: ' || v_task.title, v_now),
        (v_tx_id, v_treasury.id, 'credit', v_release_amount, 'استرداد متبقي ميزانية المهمة: ' || v_task.title, v_now);

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_release_amount ELSE -v_release_amount END,
        status = 'closed'
    WHERE id = v_escrow.id;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_release_amount ELSE -v_release_amount END
    WHERE id = v_treasury.id;

    UPDATE public.tasks
    SET status = CASE WHEN LOWER(status) = 'completed' THEN status ELSE 'archived' END
    WHERE id = p_task_id;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'TASK_ESCROW_RELEASE',
        v_admin_id,
        v_tx_id,
        jsonb_build_object('task_id', p_task_id, 'released_units', v_release_amount, 'reason', p_reason),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'task_id', p_task_id,
        'transaction_id', v_tx_id,
        'released_units', v_release_amount
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. Enhanced review_task_submission with Optional Platform Task Commission
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.review_task_submission(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.review_task_submission(
    p_submission_id UUID,
    p_decision TEXT,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
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
    v_existing_tx RECORD;
    v_tx_id UUID;
    v_comm_tx_id UUID;
    v_idempotency_key TEXT;
    v_legacy_idempotency_key TEXT;
    v_comm_idempotency_key TEXT;
    v_commission_units BIGINT := 0;
    v_total_escrow_debit BIGINT;
    v_escrow_new_bal BIGINT;
    v_wallet_new_bal BIGINT;
    v_rows_affected INT := 0;
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
        IF v_sub.reward_transaction_id IS NOT NULL THEN
            SELECT balance_units INTO v_wallet_new_bal
            FROM public.financial_accounts
            WHERE owner_user_id = v_sub.user_id AND account_type = 'wallet'
            LIMIT 1;
            RETURN jsonb_build_object(
                'success', true,
                'idempotent', true,
                'submission_id', v_sub.id,
                'status', 'approved',
                'transaction_id', v_sub.reward_transaction_id,
                'performer_user_id', v_sub.user_id,
                'wallet_new_balance', COALESCE(v_wallet_new_bal, 0)
            );
        END IF;
    END IF;

    IF LOWER(v_sub.status) = 'rejected' THEN
        IF v_decision = 'approve' THEN
            RAISE EXCEPTION 'Cannot approve an already rejected submission';
        END IF;
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'submission_id', v_sub.id, 'status', 'rejected');
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

        RETURN jsonb_build_object(
            'success', true, 'idempotent', false, 'submission_id', p_submission_id,
            'status', 'rejected', 'reviewed_by', v_admin_id, 'reviewed_at', v_now
        );
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

        SELECT balance_units INTO v_wallet_new_bal
        FROM public.financial_accounts
        WHERE owner_user_id = v_sub.user_id AND account_type = 'wallet'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true, 'idempotent', true, 'submission_id', p_submission_id,
            'status', 'approved', 'transaction_id', v_existing_tx.id,
            'performer_user_id', v_sub.user_id, 'wallet_new_balance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
    IF v_task.reward_units IS NULL OR v_task.reward_units <= 0 THEN RAISE EXCEPTION 'Invalid task reward units'; END IF;
    IF v_task.approved_count >= v_task.slots THEN RAISE EXCEPTION 'Task slots have already been filled'; END IF;
    IF v_task.escrow_account_id IS NULL THEN RAISE EXCEPTION 'Task ESCROW account is not configured or funded'; END IF;

    v_commission_units := GREATEST(0, COALESCE(v_task.commission_units, 0));

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_sub.user_id LIMIT 1;
    IF NOT FOUND OR LOWER(v_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'Performer wallet not found or inactive';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Performer financial account not found or inactive'; END IF;

    SELECT * INTO v_rev_tasks_acc
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-REVENUE-TASKS'
    LIMIT 1;

    -- Lock involved accounts deterministically
    PERFORM id
    FROM public.financial_accounts
    WHERE id IN (v_task.escrow_account_id, v_wallet_acc.id, v_rev_tasks_acc.id)
    ORDER BY id ASC
    FOR UPDATE;

    SELECT * INTO v_escrow_acc FROM public.financial_accounts WHERE id = v_task.escrow_account_id;
    IF NOT FOUND OR LOWER(v_escrow_acc.status) <> 'active' THEN
        RAISE EXCEPTION 'Task ESCROW account not found or inactive';
    END IF;

    -- Only charge commission from escrow if escrow explicitly holds reward + commission
    IF v_commission_units > 0 AND v_escrow_acc.balance_units < (v_task.reward_units + v_commission_units) THEN
        v_commission_units := 0;
    END IF;

    v_total_escrow_debit := v_task.reward_units + v_commission_units;
    IF v_escrow_acc.balance_units < v_task.reward_units THEN
        RAISE EXCEPTION 'Insufficient task ESCROW balance (available %, required %)', v_escrow_acc.balance_units, v_task.reward_units;
    END IF;

    -- Post Performer Reward Transaction
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
            'reward_units', v_task.reward_units,
            'commission_units', v_commission_units
        ),
        v_admin_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_escrow_acc.id, 'debit', v_task.reward_units, 'صرف مكافأة مهمة من الضمان: ' || v_task.title, v_now),
        (v_tx_id, v_wallet_acc.id, 'credit', v_task.reward_units, 'مكافأة إنجاز مهمة: ' || v_task.title, v_now);

    -- Optional Atomic Task Commission Revenue Entry
    IF v_commission_units > 0 AND v_rev_tasks_acc.id IS NOT NULL THEN
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
                'description', 'عمولة المنصة من المهمة: ' || v_task.title
            ),
            v_admin_id,
            v_now
        )
        RETURNING id INTO v_comm_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_comm_tx_id, v_escrow_acc.id, 'debit', v_commission_units, 'خصم عمولة المنصة من ضمان المهمة: ' || v_task.title, v_now),
            (v_comm_tx_id, v_rev_tasks_acc.id, 'credit', v_commission_units, 'إيراد عمولة مهمة: ' || v_task.title, v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_commission_units ELSE -v_commission_units END
        WHERE id = v_rev_tasks_acc.id;
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_total_escrow_debit ELSE -v_total_escrow_debit END
    WHERE id = v_escrow_acc.id
    RETURNING balance_units INTO v_escrow_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_escrow_new_bal < 0 THEN
        RAISE EXCEPTION 'Failed to update ESCROW balance safely';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_task.reward_units ELSE -v_task.reward_units END
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
        budget_spent_yer = COALESCE(budget_spent_yer, 0) + v_total_escrow_debit,
        status = CASE WHEN approved_count + 1 >= slots THEN 'completed' ELSE status END
    WHERE id = v_task.id;

    INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
        v_admin_id, 'APPROVE_SUBMISSION_PAYOUT', 'task_submission', p_submission_id,
        jsonb_build_object(
            'task_id', v_task.id, 'performer_user_id', v_sub.user_id,
            'reward_units', v_task.reward_units, 'commission_units', v_commission_units,
            'transaction_id', v_tx_id, 'commission_transaction_id', v_comm_tx_id,
            'escrow_new_balance', v_escrow_new_bal, 'wallet_new_balance', v_wallet_new_bal
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'submission_id', p_submission_id,
        'status', 'approved',
        'transaction_id', v_tx_id,
        'commission_transaction_id', v_comm_tx_id,
        'commission_units', v_commission_units,
        'reward_units', v_task.reward_units,
        'performer_user_id', v_sub.user_id,
        'escrow_new_balance', v_escrow_new_bal,
        'wallet_new_balance', v_wallet_new_bal,
        'reviewed_by', v_admin_id,
        'reviewed_at', v_now
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. Atomic Double-Entry Withdrawal Reservation & Settlement RPCs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_withdrawal_ledger(
    p_method TEXT,
    p_amount_units BIGINT,
    p_beneficiary_name TEXT,
    p_phone_number TEXT,
    p_account_number TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_method TEXT := UPPER(TRIM(COALESCE(p_method, '')));
    v_key TEXT := COALESCE(NULLIF(TRIM(p_idempotency_key), ''), 'WITHDRAWAL-REQ:' || gen_random_uuid()::text);
    v_existing RECORD;
    v_pm RECORD;
    v_wallet RECORD;
    v_wallet_acc RECORD;
    v_reserved_acc RECORD;
    v_fee BIGINT := 0;
    v_net BIGINT;
    v_tx_id UUID;
    v_withdrawal_id UUID := gen_random_uuid();
    v_wallet_new_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
        RAISE EXCEPTION 'مبلغ السحب يجب أن يكون عدداً صحيحاً موجباً أكبر من صفر.';
    END IF;

    IF v_method NOT IN ('KURAIMI', 'NAJM', 'JAWALI', 'ONE_CASH') THEN
        RAISE EXCEPTION 'طريقة السحب غير مدعومة.';
    END IF;

    IF TRIM(COALESCE(p_beneficiary_name, '')) = '' OR TRIM(COALESCE(p_phone_number, '')) = '' THEN
        RAISE EXCEPTION 'اسم المستفيد ورقم الهاتف مطلوبان.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('reserve_withdrawal_' || v_user_id::text || '_' || v_key));

    SELECT * INTO v_existing FROM public.withdrawal_requests WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        SELECT balance_units INTO v_wallet_new_bal
        FROM public.financial_accounts WHERE owner_user_id = v_user_id AND account_type = 'wallet' LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'withdrawalId', v_existing.id,
            'transactionId', v_existing.reservation_transaction_id,
            'amount', v_existing.amount,
            'fee', v_existing.fee,
            'netAmount', v_existing.net_amount,
            'status', v_existing.status,
            'newAvailableBalance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    SELECT * INTO v_pm FROM public.payout_methods WHERE code = v_method AND is_active = true LIMIT 1;
    IF FOUND THEN
        IF p_amount_units < v_pm.min_withdrawal THEN
            RAISE EXCEPTION 'المبلغ أقل من الحد الأدنى للسحب (% ر.ي).', v_pm.min_withdrawal;
        END IF;
        IF p_amount_units > v_pm.max_withdrawal THEN
            RAISE EXCEPTION 'المبلغ يتجاوز الحد الأقصى للسحب (% ر.ي).', v_pm.max_withdrawal;
        END IF;
        v_fee := ROUND((p_amount_units * v_pm.fee_percentage) / 100.0) + COALESCE(v_pm.fee_flat, 0);
    ELSE
        v_fee := ROUND(p_amount_units * 0.015);
    END IF;

    IF v_fee >= p_amount_units THEN
        RAISE EXCEPTION 'قيمة الرسوم تتجاوز مبلغ السحب.';
    END IF;
    v_net := p_amount_units - v_fee;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id LIMIT 1;
    IF NOT FOUND OR LOWER(v_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'محفظة المستخدم غير مفعلة أو غير موجودة.';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب المالي للمحفظة غير موجود.';
    END IF;

    SELECT * INTO v_reserved_acc
    FROM public.financial_accounts
    WHERE account_code = 'WITHDRAWAL-RESERVED'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'حساب حجز السحوبات WITHDRAWAL-RESERVED غير مهيأ.';
    END IF;

    IF v_wallet_acc.id < v_reserved_acc.id THEN
        PERFORM id FROM public.financial_accounts WHERE id = v_wallet_acc.id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_reserved_acc.id FOR UPDATE;
    ELSE
        PERFORM id FROM public.financial_accounts WHERE id = v_reserved_acc.id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_wallet_acc.id FOR UPDATE;
    END IF;

    SELECT balance_units INTO v_wallet_new_bal FROM public.financial_accounts WHERE id = v_wallet_acc.id;
    IF v_wallet_new_bal < p_amount_units THEN
        RAISE EXCEPTION 'رصيدك المتاح غير كافٍ لطلب سحب هذا المبلغ.';
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'WITHDRAWAL_REQUEST',
        'WITHDRAWAL:' || v_withdrawal_id::text,
        'WITHDRAWAL-RESERVE:' || v_key,
        'posted',
        jsonb_build_object(
            'withdrawal_id', v_withdrawal_id,
            'user_id', v_user_id,
            'method', v_method,
            'amount_units', p_amount_units,
            'fee_units', v_fee,
            'net_units', v_net,
            'description', 'حجز رصيد لطلب سحب عبر ' || v_method
        ),
        v_user_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_wallet_acc.id, 'debit', p_amount_units, 'حجز رصيد طلب سحب عبر ' || v_method, v_now),
        (v_tx_id, v_reserved_acc.id, 'credit', p_amount_units, 'التزام سحب معلق للمستخدم', v_now);

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END
    WHERE id = v_wallet_acc.id
    RETURNING balance_units INTO v_wallet_new_bal;

    IF v_wallet_new_bal < 0 THEN
        RAISE EXCEPTION 'رصيد غير كافٍ بعد القفل.';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END
    WHERE id = v_reserved_acc.id;

    INSERT INTO public.withdrawal_requests (
        id, user_id, method, amount, fee, net_amount, beneficiary_name, phone_number,
        account_number, status, idempotency_key, reservation_transaction_id, created_at
    ) VALUES (
        v_withdrawal_id, v_user_id, v_method, p_amount_units, v_fee, v_net,
        TRIM(p_beneficiary_name), TRIM(p_phone_number), NULLIF(TRIM(COALESCE(p_account_number, '')), ''),
        'PENDING', v_key, v_tx_id, v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'withdrawalId', v_withdrawal_id,
        'transactionId', v_tx_id,
        'amount', p_amount_units,
        'fee', v_fee,
        'netAmount', v_net,
        'status', 'PENDING',
        'newAvailableBalance', v_wallet_new_bal
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_withdrawal_ledger(
    p_withdrawal_id UUID,
    p_decision TEXT,
    p_transfer_reference TEXT DEFAULT NULL,
    p_receipt_url TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_provider_fee_units BIGINT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_decision TEXT := UPPER(TRIM(COALESCE(p_decision, '')));
    v_w RECORD;
    v_reserved_acc RECORD;
    v_settled_acc RECORD;
    v_rev_services_acc RECORD;
    v_wallet_acc RECORD;
    v_treasury_acc RECORD;
    v_issuance_acc RECORD;
    v_provider_fee_acc RECORD;
    v_exp_clearing_acc RECORD;
    v_tx_id UUID;
    v_fee_tx_id UUID;
    v_idempotency_key TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_provider_fee BIGINT := GREATEST(0, COALESCE(p_provider_fee_units, 0));
    v_wallet_new_bal BIGINT;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF v_decision NOT IN ('PAY', 'REJECT') THEN
        RAISE EXCEPTION 'Decision must be PAY or REJECT';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_withdrawal_' || p_withdrawal_id::text));

    SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طلب السحب غير موجود.';
    END IF;

    IF v_w.status = 'PAID' AND v_decision = 'PAY' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'withdrawalId', v_w.id, 'status', 'PAID', 'transactionId', v_w.settlement_transaction_id);
    END IF;
    IF v_w.status = 'REJECTED' AND v_decision = 'REJECT' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'withdrawalId', v_w.id, 'status', 'REJECTED', 'transactionId', v_w.refund_transaction_id);
    END IF;
    IF v_w.status <> 'PENDING' THEN
        RAISE EXCEPTION 'تمت معالجة طلب السحب هذا مسبقاً بحالة مختلفة.';
    END IF;

    SELECT * INTO v_reserved_acc FROM public.financial_accounts WHERE account_code = 'WITHDRAWAL-RESERVED' LIMIT 1;
    SELECT * INTO v_settled_acc FROM public.financial_accounts WHERE account_code = 'WITHDRAWAL-SETTLED' LIMIT 1;
    SELECT * INTO v_rev_services_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-SERVICES' LIMIT 1;
    SELECT * INTO v_wallet_acc FROM public.financial_accounts WHERE owner_user_id = v_w.user_id AND account_type = 'wallet' LIMIT 1;

    IF v_reserved_acc.id IS NULL OR v_wallet_acc.id IS NULL THEN
        RAISE EXCEPTION 'الحسابات المالية المطلوبة لتسوية السحب غير مكتملة.';
    END IF;

    PERFORM id
    FROM public.financial_accounts
    WHERE id IN (v_reserved_acc.id, v_settled_acc.id, v_rev_services_acc.id, v_wallet_acc.id)
    ORDER BY id ASC
    FOR UPDATE;

    SELECT balance_units INTO v_reserved_acc.balance_units FROM public.financial_accounts WHERE id = v_reserved_acc.id;
    IF v_reserved_acc.balance_units < v_w.amount THEN
        RAISE EXCEPTION 'رصيد حساب حجز السحوبات غير كافٍ للتسوية.';
    END IF;

    IF v_decision = 'PAY' THEN
        IF NULLIF(TRIM(COALESCE(p_transfer_reference, '')), '') IS NULL THEN
            RAISE EXCEPTION 'رقم مرجع الحوالة البنكية مطلوب لإتمام السحب.';
        END IF;

        v_idempotency_key := 'WITHDRAWAL-PAY:' || p_withdrawal_id::text;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'WITHDRAWAL_PAYOUT',
            'WITHDRAWAL:' || p_withdrawal_id::text,
            v_idempotency_key,
            'posted',
            jsonb_build_object(
                'withdrawal_id', p_withdrawal_id,
                'user_id', v_w.user_id,
                'amount', v_w.amount,
                'fee', v_w.fee,
                'net_amount', v_w.net_amount,
                'transfer_reference', TRIM(p_transfer_reference),
                'description', 'إتمام سحب وتسوية الالتزام النقدي والرسوم'
            ),
            v_admin_id,
            v_now
        )
        RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_reserved_acc.id, 'debit', v_w.amount, 'تسوية التزام السحب المعلق #' || p_withdrawal_id::text, v_now),
            (v_tx_id, v_settled_acc.id, 'credit', v_w.net_amount, 'صرف سحب نقدي بالمرجع ' || TRIM(p_transfer_reference), v_now);

        IF v_w.fee > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES (v_tx_id, v_rev_services_acc.id, 'credit', v_w.fee, 'رسوم خدمة السحب المحققة', v_now);

            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.fee ELSE -v_w.fee END
            WHERE id = v_rev_services_acc.id;
        END IF;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_w.amount ELSE -v_w.amount END
        WHERE id = v_reserved_acc.id;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.net_amount ELSE -v_w.net_amount END
        WHERE id = v_settled_acc.id;

        -- Optional provider fee expense recording
        IF v_provider_fee > 0 THEN
            SELECT * INTO v_treasury_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' FOR UPDATE;
            SELECT * INTO v_issuance_acc FROM public.financial_accounts WHERE account_code = 'VIRTUAL-ISSUANCE-CONTROL' FOR UPDATE;
            SELECT * INTO v_provider_fee_acc FROM public.financial_accounts WHERE account_code = 'PAYMENT-PROVIDER-FEES' FOR UPDATE;
            SELECT * INTO v_exp_clearing_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSE-CLEARING' FOR UPDATE;

            IF v_treasury_acc.balance_units >= v_provider_fee AND v_issuance_acc.balance_units >= v_provider_fee THEN
                INSERT INTO public.ledger_transactions (
                    transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
                ) VALUES (
                    'PAYMENT_PROVIDER_FEE',
                    'WITHDRAWAL-FEE:' || p_withdrawal_id::text,
                    'WITHDRAWAL-PROVIDER-FEE:' || p_withdrawal_id::text,
                    'posted',
                    jsonb_build_object('withdrawal_id', p_withdrawal_id, 'provider_fee_units', v_provider_fee, 'description', 'رسوم بوابة/صرافة لتنفيذ السحب'),
                    v_admin_id,
                    v_now
                ) RETURNING id INTO v_fee_tx_id;

                INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
                VALUES
                    (v_fee_tx_id, v_treasury_acc.id, 'debit', v_provider_fee, 'سداد عمولة مزود الدفع من الخزينة', v_now),
                    (v_fee_tx_id, v_issuance_acc.id, 'credit', v_provider_fee, 'تسوية خروج وحدات عمولة مزود الدفع', v_now),
                    (v_fee_tx_id, v_provider_fee_acc.id, 'debit', v_provider_fee, 'إثبات مصروف عمولة مزود الدفع', v_now),
                    (v_fee_tx_id, v_exp_clearing_acc.id, 'credit', v_provider_fee, 'مقابل تسوية عمولة مزود الدفع', v_now);

                UPDATE public.financial_accounts SET balance_units = balance_units - v_provider_fee WHERE id IN (v_treasury_acc.id, v_issuance_acc.id);
                UPDATE public.financial_accounts SET balance_units = balance_units + v_provider_fee WHERE id IN (v_provider_fee_acc.id, v_exp_clearing_acc.id);
            END IF;
        END IF;

        UPDATE public.withdrawal_requests
        SET status = 'PAID',
            transfer_reference = TRIM(p_transfer_reference),
            receipt_url = NULLIF(TRIM(COALESCE(p_receipt_url, '')), ''),
            admin_id = v_admin_id,
            settlement_transaction_id = v_tx_id,
            processed_at = v_now
        WHERE id = p_withdrawal_id;

        INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
        VALUES (
            v_w.user_id,
            'تم تحويل مبلغ السحب بنجاح!',
            'تم إرسال ' || v_w.net_amount::text || ' ر.ي بنجاح برقم الحوالة: ' || TRIM(p_transfer_reference),
            'WITHDRAWAL_COMPLETED',
            '/dashboard/withdrawals',
            v_now
        );

        RETURN jsonb_build_object('success', true, 'idempotent', false, 'withdrawalId', p_withdrawal_id, 'status', 'PAID', 'transactionId', v_tx_id);
    ELSE
        IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
            RAISE EXCEPTION 'سبب رفض طلب السحب مطلوب لاستعادة الرصيد.';
        END IF;

        v_idempotency_key := 'WITHDRAWAL-REFUND:' || p_withdrawal_id::text;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'WITHDRAWAL_REFUND',
            'WITHDRAWAL:' || p_withdrawal_id::text,
            v_idempotency_key,
            'posted',
            jsonb_build_object('withdrawal_id', p_withdrawal_id, 'user_id', v_w.user_id, 'amount', v_w.amount, 'reason', TRIM(p_reason), 'description', 'استرجاع رصيد طلب سحب مرفوض'),
            v_admin_id,
            v_now
        ) RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_reserved_acc.id, 'debit', v_w.amount, 'إلغاء حجز سحب مرفوض', v_now),
            (v_tx_id, v_wallet_acc.id, 'credit', v_w.amount, 'استرجاع رصيد سحب مرفوض: ' || TRIM(p_reason), v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_w.amount ELSE -v_w.amount END
        WHERE id = v_reserved_acc.id;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.amount ELSE -v_w.amount END
        WHERE id = v_wallet_acc.id
        RETURNING balance_units INTO v_wallet_new_bal;

        UPDATE public.withdrawal_requests
        SET status = 'REJECTED',
            rejection_reason = TRIM(p_reason),
            admin_id = v_admin_id,
            refund_transaction_id = v_tx_id,
            processed_at = v_now
        WHERE id = p_withdrawal_id;

        INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
        VALUES (
            v_w.user_id,
            'تم رفض طلب السحب واستعادة الرصيد',
            'تم استرجاع مبلغ ' || v_w.amount::text || ' ر.ي إلى محفظتك. السبب: ' || TRIM(p_reason),
            'WITHDRAWAL_REJECTED',
            '/dashboard/wallet',
            v_now
        );

        RETURN jsonb_build_object('success', true, 'idempotent', false, 'withdrawalId', p_withdrawal_id, 'status', 'REJECTED', 'transactionId', v_tx_id, 'newBalance', v_wallet_new_bal);
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 10. Single-Owner Financial Operations RPC (Capital, OpEx, Owner Withdrawal, Revenue)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_owner_financial_operation(
    p_operation_type TEXT,
    p_amount_units BIGINT,
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
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
        RAISE EXCEPTION 'المبلغ يجب أن يكون عدداً صحيحاً موجباً أكبر من صفر.';
    END IF;

    IF TRIM(COALESCE(p_description, '')) = '' THEN
        RAISE EXCEPTION 'البيان المحاسبي مطلوب.';
    END IF;

    IF v_op NOT IN (
        'OWNER_CAPITAL_DEPOSIT',
        'OPERATIONAL_EXPENSE',
        'OWNER_WITHDRAWAL',
        'AD_REVENUE',
        'SUBSCRIPTION_REVENUE',
        'SERVICE_REVENUE'
    ) THEN
        RAISE EXCEPTION 'نوع العملية المالية غير مدعوم: %', v_op;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('owner_fin_op_' || v_key));

    SELECT id INTO v_existing FROM public.ledger_transactions WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'transactionId', v_existing.id, 'operationType', v_op);
    END IF;

    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' FOR UPDATE;
    SELECT * INTO v_issuance FROM public.financial_accounts WHERE account_code = 'VIRTUAL-ISSUANCE-CONTROL' FOR UPDATE;
    SELECT * INTO v_cash_vault FROM public.financial_accounts WHERE account_code = 'PLATFORM-CASH-VAULT' FOR UPDATE;
    SELECT * INTO v_owner_cap FROM public.financial_accounts WHERE account_code = 'OWNER-CAPITAL' FOR UPDATE;
    SELECT * INTO v_owner_wd FROM public.financial_accounts WHERE account_code = 'OWNER-WITHDRAWALS' FOR UPDATE;
    SELECT * INTO v_expenses FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSES' FOR UPDATE;
    SELECT * INTO v_exp_clear FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSE-CLEARING' FOR UPDATE;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        v_op,
        v_op,
        v_key,
        'posted',
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('description', TRIM(p_description), 'amount_units', p_amount_units, 'actor_id', v_admin_id),
        v_admin_id,
        v_now
    ) RETURNING id INTO v_tx_id;

    IF v_op = 'OWNER_CAPITAL_DEPOSIT' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_cash_vault.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_owner_cap.id, 'credit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'debit', p_amount_units, 'تغطية إصدار خزينة برأس مال المالك', v_now),
            (v_tx_id, v_treasury.id, 'credit', p_amount_units, 'إيداع رأس مال المالك في الخزينة التشغيلية', v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + p_amount_units
        WHERE id IN (v_cash_vault.id, v_owner_cap.id, v_issuance.id, v_treasury.id);

    ELSIF v_op = 'OPERATIONAL_EXPENSE' THEN
        IF v_treasury.balance_units < p_amount_units OR v_issuance.balance_units < p_amount_units THEN
            RAISE EXCEPTION 'رصيد الخزينة المتاح غير كافٍ لتسجيل المصروف التشغيلي.';
        END IF;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_treasury.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', p_amount_units, 'سحب وحدات من الخزينة لمصروف تشغيلي', v_now),
            (v_tx_id, v_expenses.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', p_amount_units, 'مقابل تسوية المصروف التشغيلي', v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units - p_amount_units WHERE id IN (v_treasury.id, v_issuance.id);
        UPDATE public.financial_accounts SET balance_units = balance_units + p_amount_units WHERE id IN (v_expenses.id, v_exp_clear.id);

    ELSIF v_op = 'OWNER_WITHDRAWAL' THEN
        IF v_treasury.balance_units < p_amount_units OR v_issuance.balance_units < p_amount_units THEN
            RAISE EXCEPTION 'رصيد الخزينة المتاح غير كافٍ لسحب المالك.';
        END IF;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_treasury.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', p_amount_units, 'سحب شخصي للمالك من الخزينة', v_now),
            (v_tx_id, v_owner_wd.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', p_amount_units, 'تسوية سحب المالك الشخصي', v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units - p_amount_units WHERE id IN (v_treasury.id, v_issuance.id);
        UPDATE public.financial_accounts SET balance_units = balance_units + p_amount_units WHERE id IN (v_owner_wd.id, v_exp_clear.id);

    ELSE
        -- AD_REVENUE, SUBSCRIPTION_REVENUE, SERVICE_REVENUE
        v_target_rev_code := CASE
            WHEN v_op = 'AD_REVENUE' THEN 'PLATFORM-REVENUE-ADS'
            WHEN v_op = 'SUBSCRIPTION_REVENUE' THEN 'PLATFORM-REVENUE-SUBSCRIPTIONS'
            ELSE 'PLATFORM-REVENUE-SERVICES'
        END;

        SELECT * INTO v_rev_acc FROM public.financial_accounts WHERE account_code = v_target_rev_code FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Revenue account % not found', v_target_rev_code;
        END IF;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_cash_vault.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_rev_acc.id, 'credit', p_amount_units, TRIM(p_description), v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + p_amount_units WHERE id IN (v_cash_vault.id, v_rev_acc.id);

        IF COALESCE(p_credit_to_treasury, true) THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_tx_id, v_issuance.id, 'debit', p_amount_units, 'تغطية خزينة من إيراد: ' || v_op, v_now),
                (v_tx_id, v_treasury.id, 'credit', p_amount_units, 'إضافة إيراد إلى الخزينة التشغيلية', v_now);

            UPDATE public.financial_accounts SET balance_units = balance_units + p_amount_units WHERE id IN (v_issuance.id, v_treasury.id);
        END IF;
    END IF;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        v_op,
        v_admin_id,
        v_tx_id,
        jsonb_build_object('amount_units', p_amount_units, 'description', TRIM(p_description), 'credit_to_treasury', p_credit_to_treasury),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'transactionId', v_tx_id,
        'operationType', v_op,
        'amountUnits', p_amount_units
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 11. Strict Execute Privileges
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reverse_ledger_transaction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_transaction(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.release_task_escrow(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_task_escrow(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reserve_withdrawal_ledger(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal_ledger(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_owner_financial_operation(TEXT, BIGINT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_owner_financial_operation(TEXT, BIGINT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated, service_role;
