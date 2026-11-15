-- ==============================================================================
-- Migration 013: Compatible Financial Ledger, Task Accounting & Security Hardening
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Supersedes Migration 011 & 012 safely without breaking live production schema:
--   1. Preserves live account_type `'issuance_control'` alongside `'wallet'`,
--      `'treasury'`, `'escrow'`, `'revenue'`, `'expense'`, `'liability'`, `'equity'`, `'asset'`.
--   2. Respects and preserves `financial_accounts_structure` and
--      `financial_accounts_balance_units_check` without blindly dropping them.
--   3. Preserves `public.review_task_submission(UUID, TEXT, TEXT)` return type `UUID`
--      so live callers remain 100% compatible, while making reward + optional
--      configured commission atomic, idempotent, and double-entry verified.
--   4. Revokes direct INSERT/UPDATE/DELETE privileges on `ledger_transactions`,
--      `ledger_entries`, and `financial_accounts` from `authenticated` & `anon`.
--   5. Maintains `public.financial_accounts`, `public.ledger_transactions`,
--      `public.ledger_entries` as the sole authoritative accounting ledger.
-- NOTE: Prepared for review & manual deployment after backup; NOT run on production.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. PREFLIGHT STRUCTURAL VERIFICATION (ZERO ASSUMPTIONS)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_missing_tables TEXT[] := ARRAY[]::TEXT[];
    v_tbl TEXT;
    v_ledger_fk_target TEXT;
BEGIN
    FOREACH v_tbl IN ARRAY ARRAY[
        'profiles',
        'user_roles',
        'wallets',
        'financial_accounts',
        'ledger_transactions',
        'ledger_entries',
        'tasks',
        'task_submissions',
        'admin_logs'
    ]
    LOOP
        IF to_regclass('public.' || v_tbl) IS NULL THEN
            v_missing_tables := array_append(v_missing_tables, 'public.' || v_tbl);
        END IF;
    END LOOP;

    IF array_length(v_missing_tables, 1) > 0 THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: الجداول الأساسية التالية مفقودة: %',
            array_to_string(v_missing_tables, ', ');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'financial_accounts' AND column_name = 'account_code'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'financial_accounts' AND column_name = 'normal_side'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'financial_accounts' AND column_name = 'balance_units'
    ) THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: جدول public.financial_accounts لا يطابق البنية المطلوبة.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ledger_entries' AND column_name = 'entry_side'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ledger_entries' AND column_name = 'amount_units'
    ) THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: جدول public.ledger_entries لا يطابق البنية المعتمدة (entry_side, amount_units).';
    END IF;

    SELECT c.confrelid::regclass::text
    INTO v_ledger_fk_target
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.ledger_entries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'account_id'
    LIMIT 1;

    IF v_ledger_fk_target IS NOT NULL AND v_ledger_fk_target NOT IN ('public.financial_accounts', 'financial_accounts') THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: تعارض بنيوي — ledger_entries.account_id يشير إلى % بدلاً من public.financial_accounts.',
            v_ledger_fk_target;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. SAFE CONSTRAINT ALIGNMENT ON public.financial_accounts
--    - Preserves `issuance_control` (production) alongside new accounting types.
--    - Preserves `financial_accounts_balance_units_check`.
--    - Preserves `financial_accounts_structure` invariant (only extends allowed
--      system account_type values if the live compound check explicitly restricts
--      non-wallet rows to ('treasury', 'issuance_control')).
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_constraint RECORD;
    v_invalid_types TEXT;
    v_allowed TEXT[] := ARRAY[
        'wallet', 'treasury', 'issuance_control', 'control',
        'escrow', 'revenue', 'expense', 'liability', 'equity', 'asset'
    ];
    v_struct_def TEXT;
BEGIN
    SELECT string_agg(DISTINCT LOWER(account_type), ', ')
    INTO v_invalid_types
    FROM public.financial_accounts
    WHERE LOWER(account_type) <> ALL(v_allowed);

    IF v_invalid_types IS NOT NULL THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: توجد صفوف في financial_accounts بقيم account_type غير متوقعة (%).',
            v_invalid_types;
    END IF;

    -- Replace ONLY single-column domain CHECK constraints on account_type
    FOR v_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.financial_accounts'::regclass
          AND c.contype = 'c'
          AND (
              (
                  array_length(c.conkey, 1) = 1
                  AND EXISTS (
                      SELECT 1
                      FROM pg_attribute a
                      WHERE a.attrelid = c.conrelid
                        AND a.attnum = c.conkey[1]
                        AND a.attname = 'account_type'
                  )
              )
              OR c.conname = 'financial_accounts_account_type_check'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.financial_accounts DROP CONSTRAINT IF EXISTS %I', v_constraint.conname);
    END LOOP;

    ALTER TABLE public.financial_accounts
    ADD CONSTRAINT financial_accounts_account_type_check
    CHECK (LOWER(account_type) IN (
        'wallet', 'treasury', 'issuance_control', 'control',
        'escrow', 'revenue', 'expense', 'liability', 'equity', 'asset'
    ));

    -- Inspect compound constraint `financial_accounts_structure` without weakening it
    SELECT pg_get_constraintdef(c.oid)
    INTO v_struct_def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.financial_accounts'::regclass
      AND c.contype = 'c'
      AND c.conname = 'financial_accounts_structure'
    LIMIT 1;

    IF v_struct_def IS NOT NULL THEN
        -- Extend only if live constraint explicitly enumerates ('treasury', 'issuance_control') without 'revenue'
        IF v_struct_def ILIKE '%issuance_control%' AND v_struct_def NOT ILIKE '%revenue%' THEN
            ALTER TABLE public.financial_accounts DROP CONSTRAINT financial_accounts_structure;
            ALTER TABLE public.financial_accounts
            ADD CONSTRAINT financial_accounts_structure
            CHECK (
                (
                    LOWER(account_type) = 'wallet'
                    AND owner_user_id IS NOT NULL
                    AND wallet_id IS NOT NULL
                )
                OR
                (
                    LOWER(account_type) IN (
                        'treasury', 'issuance_control', 'control',
                        'escrow', 'revenue', 'expense', 'liability', 'equity', 'asset'
                    )
                    AND owner_user_id IS NULL
                    AND wallet_id IS NULL
                )
            );
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. SEED MISSING CHART OF ACCOUNTS WITHOUT ALTERING EXISTING BALANCES OR TYPES
--    - VIRTUAL-ISSUANCE-CONTROL uses `'issuance_control'` when seeded, and
--      accepts existing `'issuance_control'` or `'control'` rows untouched.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_def RECORD;
    v_existing RECORD;
BEGIN
    FOR v_def IN
        SELECT * FROM (VALUES
            ('PLATFORM-TREASURY', 'treasury', 'credit'),
            ('VIRTUAL-ISSUANCE-CONTROL', 'issuance_control', 'debit'),
            ('PLATFORM-CASH-VAULT', 'asset', 'debit'),
            ('PLATFORM-REVENUE-TASKS', 'revenue', 'credit'),
            ('PLATFORM-REVENUE-ADS', 'revenue', 'credit'),
            ('PLATFORM-REVENUE-SUBSCRIPTIONS', 'revenue', 'credit'),
            ('PLATFORM-REVENUE-SERVICES', 'revenue', 'credit'),
            ('PLATFORM-EXPENSES', 'expense', 'debit'),
            ('PLATFORM-EXPENSE-CLEARING', 'liability', 'credit'),
            ('PAYMENT-PROVIDER-FEES', 'expense', 'debit'),
            ('OWNER-CAPITAL', 'equity', 'credit'),
            ('OWNER-CURRENT-ACCOUNT', 'equity', 'credit'),
            ('OWNER-WITHDRAWALS', 'equity', 'debit'),
            ('RETAINED-EARNINGS', 'equity', 'credit'),
            ('TAX-PAYABLE', 'liability', 'credit'),
            ('WITHDRAWAL-RESERVED', 'liability', 'credit'),
            ('WITHDRAWAL-SETTLED', 'liability', 'credit'),
            ('TASK-ESCROW-POOL', 'escrow', 'credit')
        ) AS t(account_code, account_type, normal_side)
    LOOP
        SELECT id, account_type, normal_side
        INTO v_existing
        FROM public.financial_accounts
        WHERE account_code = v_def.account_code
        LIMIT 1;

        IF FOUND THEN
            IF LOWER(v_existing.normal_side) <> v_def.normal_side THEN
                RAISE EXCEPTION 'MIGRATION_013_HALTED: الحساب المالي % موجود بطبيعة محاسبية مخالفة (normal_side=% بدلاً من %).',
                    v_def.account_code, v_existing.normal_side, v_def.normal_side;
            END IF;
        ELSE
            INSERT INTO public.financial_accounts (
                account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
            ) VALUES (
                v_def.account_code, v_def.account_type, NULL, NULL, v_def.normal_side, 0, 'active', NOW()
            )
            ON CONFLICT (account_code) DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- Ensure tasks.commission_units exists (defaults to 0; never invents commission)
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
-- 4. PAYOUT METHODS, WITHDRAWAL COMPATIBILITY, NOTIFICATIONS, TAXES & AUDIT LOGS
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
    idempotency_key TEXT,
    reservation_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    settlement_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    refund_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    ledger_reservation_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    ledger_refund_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
    v_col_type TEXT;
    v_fk_target TEXT;
    v_dup_count INT := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'idempotency_key'
    ) THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN idempotency_key TEXT;
    END IF;

    SELECT COUNT(*) INTO v_dup_count
    FROM (
        SELECT idempotency_key
        FROM public.withdrawal_requests
        WHERE idempotency_key IS NOT NULL
        GROUP BY idempotency_key
        HAVING COUNT(*) > 1
    ) d;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION_013_HALTED: توجد قيم مكررة للعمود withdrawal_requests.idempotency_key (%).', v_dup_count;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_idempotency_key_unique
        ON public.withdrawal_requests(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'settlement_transaction_id';

    IF v_col_type IS NULL THEN
        ALTER TABLE public.withdrawal_requests
        ADD COLUMN settlement_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT;
    ELSE
        IF v_col_type <> 'uuid' THEN
            RAISE EXCEPTION 'MIGRATION_013_HALTED: withdrawal_requests.settlement_transaction_id نوعه % وليس uuid.', v_col_type;
        END IF;

        SELECT c.confrelid::regclass::text INTO v_fk_target
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.withdrawal_requests'::regclass
          AND c.contype = 'f'
          AND a.attname = 'settlement_transaction_id'
        LIMIT 1;

        IF v_fk_target IS NOT NULL AND v_fk_target NOT IN ('public.ledger_transactions', 'ledger_transactions') THEN
            RAISE EXCEPTION 'MIGRATION_013_HALTED: withdrawal_requests.settlement_transaction_id يشير إلى %.', v_fk_target;
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'ledger_reservation_transaction_id'
    ) THEN
        ALTER TABLE public.withdrawal_requests
        ADD COLUMN ledger_reservation_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'ledger_refund_transaction_id'
    ) THEN
        ALTER TABLE public.withdrawal_requests
        ADD COLUMN ledger_refund_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT;
    END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS public.tax_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_type TEXT NOT NULL,
    tax_authority TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'YEMEN',
    tax_base TEXT NOT NULL,
    rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (rate_percentage >= 0 AND rate_percentage <= 100),
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

-- Enforce immutable append-only ledger
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
-- 5. SAFE WALLET ACCOUNT INITIALIZER RPC (No direct authenticated INSERT needed)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_own_financial_account()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_wallet RECORD;
    v_acc RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.wallets (id, user_id, wallet_address, status, created_at)
        VALUES (
            gen_random_uuid(),
            v_user_id,
            'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(v_user_id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
            'active',
            v_now
        )
        ON CONFLICT (user_id) DO NOTHING
        RETURNING * INTO v_wallet;

        IF v_wallet.id IS NULL THEN
            SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id ORDER BY created_at ASC LIMIT 1;
        END IF;
    END IF;

    SELECT * INTO v_acc
    FROM public.financial_accounts
    WHERE account_type = 'wallet' AND (wallet_id = v_wallet.id OR owner_user_id = v_user_id)
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'WALLET-' || v_wallet.id::text, 'wallet', v_user_id, v_wallet.id, 'credit', 0, 'active', v_now
        )
        ON CONFLICT (account_code) DO NOTHING
        RETURNING * INTO v_acc;

        IF v_acc.id IS NULL THEN
            SELECT * INTO v_acc FROM public.financial_accounts WHERE wallet_id = v_wallet.id AND account_type = 'wallet' LIMIT 1;
        END IF;
    END IF;

    RETURN v_acc.id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. COMPATIBLE ATOMIC review_task_submission(UUID, TEXT, TEXT) RETURNS UUID
--    - Preserves exact live signature AND return type `UUID`!
--    - Pays reward from Task ESCROW + optional task-configured commission atomically.
--    - Never invents default commission rate.
--    - Triggers first-task referral evaluation (if Migration 014 is installed) ONLY
--      for newly approved submissions (zero retroactive payouts).
-- ------------------------------------------------------------------------------
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
    v_commission_units BIGINT := 0;
    v_total_escrow_debit BIGINT;
    v_escrow_new_bal BIGINT;
    v_wallet_new_bal BIGINT;
    v_rev_new_bal BIGINT;
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

    -- Idempotency guards (never trigger retroactive referral rewards)
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

    -- Check ledger idempotency before mutating
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

    -- Lock & Validate Task
    SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
    IF v_task.reward_units IS NULL OR v_task.reward_units <= 0 THEN RAISE EXCEPTION 'Invalid task reward units'; END IF;
    IF v_task.approved_count >= v_task.slots THEN RAISE EXCEPTION 'Task slots have already been filled'; END IF;
    IF v_task.escrow_account_id IS NULL THEN RAISE EXCEPTION 'Task ESCROW account is not configured or funded'; END IF;

    v_commission_units := GREATEST(0, COALESCE(v_task.commission_units, 0));

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

    -- Validate Performer Wallet & Financial Account
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

    -- Deterministic lock order across ALL involved accounts
    v_lock_ids := ARRAY[v_task.escrow_account_id, v_wallet_acc.id];
    IF v_rev_tasks_acc_id IS NOT NULL THEN
        v_lock_ids := array_append(v_lock_ids, v_rev_tasks_acc_id);
    END IF;

    PERFORM id
    FROM public.financial_accounts
    WHERE id = ANY(v_lock_ids)
    ORDER BY id ASC
    FOR UPDATE;

    SELECT * INTO v_escrow_acc FROM public.financial_accounts WHERE id = v_task.escrow_account_id;
    IF NOT FOUND OR LOWER(v_escrow_acc.status) <> 'active' THEN
        RAISE EXCEPTION 'Task ESCROW account not found or inactive';
    END IF;

    v_total_escrow_debit := v_task.reward_units + v_commission_units;
    IF v_escrow_acc.balance_units < v_total_escrow_debit THEN
        RAISE EXCEPTION 'رصيد ضمان المهمة غير كافٍ لتغطية المكافأة والعمولة (المتاح %، المطلوب %)',
            v_escrow_acc.balance_units, v_total_escrow_debit;
    END IF;

    -- Post Performer Reward Double-Entry Transaction
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

    -- Optional Commission (ONLY when task explicitly configured commission_units > 0)
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
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_commission_units ELSE -v_commission_units END
        WHERE id = v_rev_tasks_acc_id
        RETURNING balance_units INTO v_rev_new_bal;

        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected <> 1 OR v_rev_new_bal < 0 THEN
            RAISE EXCEPTION 'Failed to update PLATFORM-REVENUE-TASKS balance safely';
        END IF;
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

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'TASK_SUBMISSION_APPROVED',
        v_admin_id,
        v_tx_id,
        jsonb_build_object(
            'submission_id', p_submission_id,
            'task_id', v_task.id,
            'reward_units', v_task.reward_units,
            'commission_units', v_commission_units,
            'commission_transaction_id', v_comm_tx_id
        ),
        v_now
    );

    -- Trigger first-task referral reward evaluation if Migration 014 helper exists
    IF to_regprocedure('public.process_referral_reward_for_submission(uuid)') IS NOT NULL THEN
        PERFORM public.process_referral_reward_for_submission(p_submission_id);
    END IF;

    RETURN v_tx_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. WITHDRAWAL RESERVATION & SETTLEMENT RPCS
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
    v_reserved_new_bal BIGINT;
    v_rows_affected INT := 0;
    v_now TIMESTAMPTZ := NOW();
    v_res_fk_is_wallet_tx BOOLEAN := false;
    v_legacy_res_tx_id UUID := NULL;
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
            'transactionId', COALESCE(v_existing.ledger_reservation_transaction_id, v_existing.reservation_transaction_id),
            'amount', v_existing.amount,
            'fee', v_existing.fee,
            'netAmount', v_existing.net_amount,
            'status', v_existing.status,
            'newAvailableBalance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    SELECT * INTO v_pm FROM public.payout_methods WHERE code = v_method AND is_active = true LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طريقة الدفع % غير مفعلة أو غير موجودة.', v_method;
    END IF;
    IF p_amount_units < v_pm.min_withdrawal THEN
        RAISE EXCEPTION 'المبلغ أقل من الحد الأدنى للسحب (% ر.ي).', v_pm.min_withdrawal;
    END IF;
    IF p_amount_units > v_pm.max_withdrawal THEN
        RAISE EXCEPTION 'المبلغ يتجاوز الحد الأقصى للسحب (% ر.ي).', v_pm.max_withdrawal;
    END IF;

    v_fee := ROUND((p_amount_units * v_pm.fee_percentage) / 100.0) + COALESCE(v_pm.fee_flat, 0);
    IF v_fee < 0 OR v_fee >= p_amount_units THEN
        RAISE EXCEPTION 'قيمة رسوم السحب المحتسبة غير صالحة.';
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
    WHERE account_code = 'WITHDRAWAL-RESERVED' AND LOWER(status) = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'حساب حجز السحوبات WITHDRAWAL-RESERVED غير مهيأ أو غير مفعل.';
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id IN (v_wallet_acc.id, v_reserved_acc.id) ORDER BY id ASC FOR UPDATE;

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

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_wallet_new_bal < 0 THEN
        RAISE EXCEPTION 'رصيد غير كافٍ بعد القفل.';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END
    WHERE id = v_reserved_acc.id
    RETURNING balance_units INTO v_reserved_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_reserved_new_bal < 0 THEN
        RAISE EXCEPTION 'فشل تحديث حساب حجز السحوبات.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.withdrawal_requests'::regclass
          AND c.contype = 'f'
          AND a.attname = 'reservation_transaction_id'
          AND c.confrelid::regclass::text IN ('public.wallet_transactions', 'wallet_transactions')
    ) INTO v_res_fk_is_wallet_tx;

    v_legacy_res_tx_id := CASE WHEN v_res_fk_is_wallet_tx THEN NULL ELSE v_tx_id END;

    INSERT INTO public.withdrawal_requests (
        id, user_id, method, amount, fee, net_amount, beneficiary_name, phone_number,
        account_number, status, idempotency_key, reservation_transaction_id, ledger_reservation_transaction_id, created_at
    ) VALUES (
        v_withdrawal_id, v_user_id, v_method, p_amount_units, v_fee, v_net,
        TRIM(p_beneficiary_name), TRIM(p_phone_number), NULLIF(TRIM(COALESCE(p_account_number, '')), ''),
        'PENDING', v_key, v_legacy_res_tx_id, v_tx_id, v_now
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
    v_fee_tx_id UUID := NULL;
    v_idempotency_key TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_provider_fee BIGINT := COALESCE(p_provider_fee_units, 0);
    v_new_bal BIGINT;
    v_wallet_new_bal BIGINT;
    v_rows_affected INT := 0;
    v_lock_ids UUID[];
    v_ref_fk_is_wallet_tx BOOLEAN := false;
    v_legacy_refund_tx_id UUID := NULL;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;
    IF v_decision NOT IN ('PAY', 'REJECT') THEN
        RAISE EXCEPTION 'Decision must be PAY or REJECT';
    END IF;
    IF v_provider_fee < 0 THEN
        RAISE EXCEPTION 'رسوم مزود الدفع لا يمكن أن تكون سالبة.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_withdrawal_' || p_withdrawal_id::text));

    SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'طلب السحب غير موجود.'; END IF;

    IF v_w.status = 'PAID' AND v_decision = 'PAY' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'withdrawalId', v_w.id, 'status', 'PAID', 'transactionId', v_w.settlement_transaction_id);
    END IF;
    IF v_w.status = 'REJECTED' AND v_decision = 'REJECT' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'withdrawalId', v_w.id, 'status', 'REJECTED', 'transactionId', COALESCE(v_w.ledger_refund_transaction_id, v_w.refund_transaction_id));
    END IF;
    IF v_w.status NOT IN ('PENDING', 'PROCESSING') THEN
        RAISE EXCEPTION 'تمت معالجة طلب السحب هذا مسبقاً بحالة مختلفة (%).', v_w.status;
    END IF;
    IF v_w.net_amount + v_w.fee <> v_w.amount THEN
        RAISE EXCEPTION 'تضارب في بيانات طلب السحب: المبلغ (%) لا يساوي الصافي (%) + الرسوم (%).', v_w.amount, v_w.net_amount, v_w.fee;
    END IF;

    SELECT * INTO v_reserved_acc FROM public.financial_accounts WHERE account_code = 'WITHDRAWAL-RESERVED' LIMIT 1;
    SELECT * INTO v_settled_acc FROM public.financial_accounts WHERE account_code = 'WITHDRAWAL-SETTLED' LIMIT 1;
    SELECT * INTO v_rev_services_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-SERVICES' LIMIT 1;
    SELECT * INTO v_wallet_acc FROM public.financial_accounts WHERE owner_user_id = v_w.user_id AND account_type = 'wallet' LIMIT 1;

    IF v_reserved_acc.id IS NULL OR LOWER(v_reserved_acc.status) <> 'active'
       OR v_wallet_acc.id IS NULL OR LOWER(v_wallet_acc.status) <> 'active' THEN
        RAISE EXCEPTION 'الحسابات المالية المطلوبة غير مكتملة أو غير مفعلة.';
    END IF;

    IF v_decision = 'PAY' THEN
        IF NULLIF(TRIM(COALESCE(p_transfer_reference, '')), '') IS NULL THEN
            RAISE EXCEPTION 'رقم مرجع الحوالة البنكية مطلوب لإتمام السحب.';
        END IF;
        IF v_settled_acc.id IS NULL OR LOWER(v_settled_acc.status) <> 'active' THEN
            RAISE EXCEPTION 'حساب تسوية السحوبات WITHDRAWAL-SETTLED غير موجود أو غير مفعل.';
        END IF;
        IF v_w.fee > 0 AND (v_rev_services_acc.id IS NULL OR LOWER(v_rev_services_acc.status) <> 'active') THEN
            RAISE EXCEPTION 'حساب إيرادات الخدمات PLATFORM-REVENUE-SERVICES غير موجود أو غير مفعل.';
        END IF;

        v_lock_ids := ARRAY[v_reserved_acc.id, v_settled_acc.id, v_wallet_acc.id];
        IF v_rev_services_acc.id IS NOT NULL THEN
            v_lock_ids := array_append(v_lock_ids, v_rev_services_acc.id);
        END IF;

        IF v_provider_fee > 0 THEN
            SELECT * INTO v_treasury_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' LIMIT 1;
            SELECT * INTO v_issuance_acc FROM public.financial_accounts WHERE account_code = 'VIRTUAL-ISSUANCE-CONTROL' LIMIT 1;
            SELECT * INTO v_provider_fee_acc FROM public.financial_accounts WHERE account_code = 'PAYMENT-PROVIDER-FEES' LIMIT 1;
            SELECT * INTO v_exp_clearing_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSE-CLEARING' LIMIT 1;

            IF v_treasury_acc.id IS NULL OR LOWER(v_treasury_acc.status) <> 'active'
               OR v_issuance_acc.id IS NULL OR LOWER(v_issuance_acc.status) <> 'active'
               OR v_provider_fee_acc.id IS NULL OR LOWER(v_provider_fee_acc.status) <> 'active'
               OR v_exp_clearing_acc.id IS NULL OR LOWER(v_exp_clearing_acc.status) <> 'active' THEN
                RAISE EXCEPTION 'حسابات تسجيل رسوم مزود الدفع غير مكتملة؛ تم إيقاف التسوية بالكامل دون تنفيذ جزئي.';
            END IF;

            v_lock_ids := v_lock_ids || ARRAY[v_treasury_acc.id, v_issuance_acc.id, v_provider_fee_acc.id, v_exp_clearing_acc.id];
        END IF;

        PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

        SELECT * INTO v_reserved_acc FROM public.financial_accounts WHERE id = v_reserved_acc.id;
        IF v_reserved_acc.balance_units < v_w.amount THEN
            RAISE EXCEPTION 'رصيد حساب حجز السحوبات غير كافٍ للتسوية.';
        END IF;

        IF v_provider_fee > 0 THEN
            SELECT * INTO v_treasury_acc FROM public.financial_accounts WHERE id = v_treasury_acc.id;
            SELECT * INTO v_issuance_acc FROM public.financial_accounts WHERE id = v_issuance_acc.id;
            IF v_treasury_acc.balance_units < v_provider_fee OR v_issuance_acc.balance_units < v_provider_fee THEN
                RAISE EXCEPTION 'رصيد الخزينة المتاح (%) غير كافٍ لتغطية رسوم مزود الدفع (%).',
                    v_treasury_acc.balance_units, v_provider_fee;
            END IF;
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
                'withdrawal_id', p_withdrawal_id, 'user_id', v_w.user_id,
                'amount', v_w.amount, 'fee', v_w.fee, 'net_amount', v_w.net_amount,
                'provider_fee_units', v_provider_fee, 'transfer_reference', TRIM(p_transfer_reference),
                'description', 'إتمام سحب وتسوية الالتزام النقدي والرسوم'
            ),
            v_admin_id, v_now
        ) RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_reserved_acc.id, 'debit', v_w.amount, 'تسوية التزام السحب المعلق #' || p_withdrawal_id::text, v_now),
            (v_tx_id, v_settled_acc.id, 'credit', v_w.net_amount, 'صرف سحب نقدي بالمرجع ' || TRIM(p_transfer_reference), v_now);

        IF v_w.fee > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES (v_tx_id, v_rev_services_acc.id, 'credit', v_w.fee, 'رسوم خدمة السحب المحققة', v_now);

            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.fee ELSE -v_w.fee END
            WHERE id = v_rev_services_acc.id
            RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث حساب إيرادات رسوم السحب.'; END IF;
        END IF;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_w.amount ELSE -v_w.amount END
        WHERE id = v_reserved_acc.id
        RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل خصم حساب حجز السحوبات.'; END IF;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.net_amount ELSE -v_w.net_amount END
        WHERE id = v_settled_acc.id
        RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث حساب السحوبات المسددة.'; END IF;

        IF v_provider_fee > 0 THEN
            INSERT INTO public.ledger_transactions (
                transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
            ) VALUES (
                'PAYMENT_PROVIDER_FEE', 'WITHDRAWAL-FEE:' || p_withdrawal_id::text, 'WITHDRAWAL-PROVIDER-FEE:' || p_withdrawal_id::text,
                'posted', jsonb_build_object('withdrawal_id', p_withdrawal_id, 'provider_fee_units', v_provider_fee, 'description', 'مصروف عمولة مزود الدفع لتنفيذ السحب'),
                v_admin_id, v_now
            ) RETURNING id INTO v_fee_tx_id;

            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_fee_tx_id, v_treasury_acc.id, 'debit', v_provider_fee, 'سداد عمولة مزود الدفع من الخزينة', v_now),
                (v_fee_tx_id, v_issuance_acc.id, 'credit', v_provider_fee, 'تسوية خروج وحدات عمولة مزود الدفع', v_now),
                (v_fee_tx_id, v_provider_fee_acc.id, 'debit', v_provider_fee, 'إثبات مصروف عمولة مزود الدفع', v_now),
                (v_fee_tx_id, v_exp_clearing_acc.id, 'credit', v_provider_fee, 'مقابل تسوية عمولة مزود الدفع', v_now);

            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_provider_fee ELSE -v_provider_fee END WHERE id = v_treasury_acc.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل خصم عمولة مزود الدفع من الخزينة.'; END IF;
            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_provider_fee ELSE -v_provider_fee END WHERE id = v_issuance_acc.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث حساب التحكم بالوحدات.'; END IF;
            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_provider_fee ELSE -v_provider_fee END WHERE id = v_provider_fee_acc.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث حساب مصروفات مزود الدفع.'; END IF;
            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_provider_fee ELSE -v_provider_fee END WHERE id = v_exp_clearing_acc.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث حساب تسوية المصروفات.'; END IF;
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
        VALUES (v_w.user_id, 'تم تحويل مبلغ السحب بنجاح!', 'تم إرسال ' || v_w.net_amount::text || ' ر.ي بنجاح برقم الحوالة: ' || TRIM(p_transfer_reference), 'WITHDRAWAL_COMPLETED', '/dashboard/withdrawals', v_now);

        INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
        VALUES ('WITHDRAWAL_SETTLED', v_admin_id, v_tx_id, jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_w.amount, 'fee', v_w.fee, 'net_amount', v_w.net_amount, 'provider_fee_units', v_provider_fee, 'provider_fee_transaction_id', v_fee_tx_id), v_now);

        RETURN jsonb_build_object('success', true, 'idempotent', false, 'withdrawalId', p_withdrawal_id, 'status', 'PAID', 'transactionId', v_tx_id, 'providerFeeTransactionId', v_fee_tx_id);
    ELSE
        IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
            RAISE EXCEPTION 'سبب رفض طلب السحب مطلوب لاستعادة الرصيد.';
        END IF;

        PERFORM id FROM public.financial_accounts WHERE id IN (v_reserved_acc.id, v_wallet_acc.id) ORDER BY id ASC FOR UPDATE;

        SELECT balance_units INTO v_reserved_acc.balance_units FROM public.financial_accounts WHERE id = v_reserved_acc.id;
        IF v_reserved_acc.balance_units < v_w.amount THEN
            RAISE EXCEPTION 'رصيد حساب حجز السحوبات غير كافٍ للاسترجاع.';
        END IF;

        v_idempotency_key := 'WITHDRAWAL-REFUND:' || p_withdrawal_id::text;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'WITHDRAWAL_REFUND', 'WITHDRAWAL:' || p_withdrawal_id::text, v_idempotency_key, 'posted',
            jsonb_build_object('withdrawal_id', p_withdrawal_id, 'user_id', v_w.user_id, 'amount', v_w.amount, 'reason', TRIM(p_reason), 'description', 'استرجاع رصيد طلب سحب مرفوض'),
            v_admin_id, v_now
        ) RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_reserved_acc.id, 'debit', v_w.amount, 'إلغاء حجز سحب مرفوض', v_now),
            (v_tx_id, v_wallet_acc.id, 'credit', v_w.amount, 'استرجاع رصيد سحب مرفوض: ' || TRIM(p_reason), v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_w.amount ELSE -v_w.amount END WHERE id = v_reserved_acc.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل خصم حساب حجز السحوبات عند الرفض.'; END IF;

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_w.amount ELSE -v_w.amount END WHERE id = v_wallet_acc.id RETURNING balance_units INTO v_wallet_new_bal;
        IF v_wallet_new_bal < 0 THEN RAISE EXCEPTION 'فشل استرجاع الرصيد إلى محفظة المستخدم.'; END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = 'public.withdrawal_requests'::regclass
              AND c.contype = 'f' AND a.attname = 'refund_transaction_id'
              AND c.confrelid::regclass::text IN ('public.wallet_transactions', 'wallet_transactions')
        ) INTO v_ref_fk_is_wallet_tx;

        v_legacy_refund_tx_id := CASE WHEN v_ref_fk_is_wallet_tx THEN NULL ELSE v_tx_id END;

        UPDATE public.withdrawal_requests
        SET status = 'REJECTED', rejection_reason = TRIM(p_reason), admin_id = v_admin_id,
            refund_transaction_id = COALESCE(v_legacy_refund_tx_id, refund_transaction_id),
            ledger_refund_transaction_id = v_tx_id, processed_at = v_now
        WHERE id = p_withdrawal_id;

        INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
        VALUES (v_w.user_id, 'تم رفض طلب السحب واستعادة الرصيد', 'تم استرجاع مبلغ ' || v_w.amount::text || ' ر.ي إلى محفظتك. السبب: ' || TRIM(p_reason), 'WITHDRAWAL_REJECTED', '/dashboard/wallet', v_now);

        INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
        VALUES ('WITHDRAWAL_REJECTED_REFUND', v_admin_id, v_tx_id, jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_w.amount, 'reason', TRIM(p_reason)), v_now);

        RETURN jsonb_build_object('success', true, 'idempotent', false, 'withdrawalId', p_withdrawal_id, 'status', 'REJECTED', 'transactionId', v_tx_id, 'newBalance', v_wallet_new_bal);
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. OWNER FINANCIAL OPERATIONS, TASK ESCROW RELEASE & REVERSALS
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
    v_new_bal BIGINT;
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
        IF v_treasury.balance_units < p_amount_units OR v_issuance.balance_units < p_amount_units THEN
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
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('description', TRIM(p_description), 'amount_units', p_amount_units, 'actor_id', v_admin_id),
        v_admin_id, v_now
    ) RETURNING id INTO v_tx_id;

    IF v_op = 'OWNER_CAPITAL_DEPOSIT' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_cash_vault.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_owner_cap.id, 'credit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'debit', p_amount_units, 'تغطية إصدار خزينة برأس مال المالك', v_now),
            (v_tx_id, v_treasury.id, 'credit', p_amount_units, 'إيداع رأس مال المالك في الخزينة التشغيلية', v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_cash_vault.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-CASH-VAULT'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_owner_cap.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on OWNER-CAPITAL'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
    ELSIF v_op = 'OPERATIONAL_EXPENSE' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_treasury.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', p_amount_units, 'سحب وحدات من الخزينة لمصروف تشغيلي', v_now),
            (v_tx_id, v_expenses.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', p_amount_units, 'مقابل تسوية المصروف التشغيلي', v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_expenses.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSES'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_exp_clear.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSE-CLEARING'; END IF;
    ELSIF v_op = 'OWNER_WITHDRAWAL' THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_treasury.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_issuance.id, 'credit', p_amount_units, 'سحب شخصي للمالك من الخزينة', v_now),
            (v_tx_id, v_owner_wd.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_exp_clear.id, 'credit', p_amount_units, 'تسوية سحب المالك الشخصي', v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_owner_wd.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on OWNER-WITHDRAWALS'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_exp_clear.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-EXPENSE-CLEARING'; END IF;
    ELSE
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
            (v_tx_id, v_cash_vault.id, 'debit', p_amount_units, TRIM(p_description), v_now),
            (v_tx_id, v_rev_acc.id, 'credit', p_amount_units, TRIM(p_description), v_now);

        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_cash_vault.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-CASH-VAULT'; END IF;
        UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_rev_acc.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on revenue account'; END IF;

        IF COALESCE(p_credit_to_treasury, true) THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
                (v_tx_id, v_issuance.id, 'debit', p_amount_units, 'تغطية خزينة من إيراد: ' || v_op, v_now),
                (v_tx_id, v_treasury.id, 'credit', p_amount_units, 'إضافة إيراد إلى الخزينة التشغيلية', v_now);

            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_issuance.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on VIRTUAL-ISSUANCE-CONTROL'; END IF;
            UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN p_amount_units ELSE -p_amount_units END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
            IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on PLATFORM-TREASURY'; END IF;
        END IF;
    END IF;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (v_op, v_admin_id, v_tx_id, jsonb_build_object('amount_units', p_amount_units, 'description', TRIM(p_description), 'credit_to_treasury', p_credit_to_treasury), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'transactionId', v_tx_id, 'operationType', v_op, 'amountUnits', p_amount_units);
END;
$$;

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
    v_remaining BIGINT;
    v_new_bal BIGINT;
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
    SELECT balance_units INTO v_remaining FROM public.financial_accounts WHERE id = v_escrow.id;

    IF COALESCE(v_remaining, 0) <= 0 THEN
        RETURN jsonb_build_object('success', true, 'idempotent', false, 'released_units', 0, 'transaction_id', NULL);
    END IF;

    INSERT INTO public.ledger_transactions (transaction_type, reference, idempotency_key, status, metadata, created_by, created_at)
    VALUES ('TASK_BUDGET_REFUND', 'TASK:' || p_task_id::text, v_key, 'posted', jsonb_build_object('task_id', p_task_id, 'released_units', v_remaining, 'reason', TRIM(COALESCE(p_reason, '')), 'description', 'تحرير المتبقي من ضمان المهمة للخزينة'), v_admin_id, v_now)
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at) VALUES
        (v_tx_id, v_escrow.id, 'debit', v_remaining, TRIM(COALESCE(p_reason, 'تحرير ضمان المهمة')), v_now),
        (v_tx_id, v_treasury.id, 'credit', v_remaining, 'استرجاع رصيد ضمان المهمة إلى الخزينة', v_now);

    UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_remaining ELSE -v_remaining END WHERE id = v_escrow.id RETURNING balance_units INTO v_new_bal;
    IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on task escrow'; END IF;

    UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_remaining ELSE -v_remaining END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
    IF v_new_bal < 0 THEN RAISE EXCEPTION 'Negative balance prevented on treasury'; END IF;

    UPDATE public.tasks SET status = 'cancelled' WHERE id = p_task_id;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES ('TASK_ESCROW_RELEASE', v_admin_id, v_tx_id, jsonb_build_object('task_id', p_task_id, 'released_units', v_remaining, 'reason', p_reason), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'released_units', v_remaining, 'transaction_id', v_tx_id);
END;
$$;

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
    v_delta BIGINT;
    v_new_bal BIGINT;
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
        jsonb_build_object('original_transaction_id', p_transaction_id, 'original_type', v_orig.transaction_type, 'reason', TRIM(p_reason), 'description', 'قيد عكسي للمعاملة #' || p_transaction_id::text || ': ' || TRIM(p_reason)),
        v_admin_id,
        v_now
    ) RETURNING id INTO v_rev_id;

    FOR v_entry IN SELECT * FROM public.ledger_entries WHERE transaction_id = p_transaction_id ORDER BY id ASC LOOP
        v_swapped_side := CASE WHEN LOWER(v_entry.entry_side) = 'debit' THEN 'credit' ELSE 'debit' END;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES (v_rev_id, v_entry.account_id, v_swapped_side, v_entry.amount_units, 'قيد عكسي: ' || TRIM(p_reason), v_now);

        SELECT * INTO v_acc FROM public.financial_accounts WHERE id = v_entry.account_id;
        v_delta := CASE WHEN LOWER(v_acc.normal_side) = v_swapped_side THEN v_entry.amount_units ELSE -v_entry.amount_units END;

        UPDATE public.financial_accounts SET balance_units = balance_units + v_delta WHERE id = v_acc.id RETURNING balance_units INTO v_new_bal;
        IF v_new_bal < 0 THEN
            RAISE EXCEPTION 'لا يمكن تنفيذ القيد العكسي لأن الرصيد الحالي للحساب (%) غير كافٍ.', v_acc.account_code;
        END IF;
    END LOOP;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES ('REVERSE_TRANSACTION', v_admin_id, v_rev_id, jsonb_build_object('original_transaction_id', p_transaction_id, 'reason', TRIM(p_reason)), v_now);

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'original_transaction_id', p_transaction_id, 'reversal_transaction_id', v_rev_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. HARDENED SECURITY PRIVILEGES & RLS POLICIES (NO BYPASS OF LEDGER RPCS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ledger_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ledger_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.withdrawal_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tax_definitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tax_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payout_methods FROM PUBLIC, anon, authenticated;

-- Strictly SELECT ONLY for authenticated where permitted by RLS; NO direct INSERT/UPDATE/DELETE on ledger!
GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT SELECT ON public.ledger_transactions TO authenticated;
GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT ALL ON public.financial_accounts, public.ledger_transactions, public.ledger_entries TO service_role;

GRANT SELECT ON public.payout_methods TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payout_methods TO authenticated;
GRANT ALL ON public.payout_methods TO service_role;

GRANT SELECT, UPDATE ON public.withdrawal_requests TO authenticated;
GRANT ALL ON public.withdrawal_requests TO service_role;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.tax_definitions, public.tax_settlements TO authenticated;
GRANT ALL ON public.tax_definitions, public.tax_settlements TO service_role;

GRANT SELECT, INSERT ON public.financial_audit_logs TO authenticated;
GRANT ALL ON public.financial_audit_logs TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;

-- Clean RLS Policies (Zero authenticated direct INSERT/UPDATE/DELETE on ledger tables!)
DROP POLICY IF EXISTS "Admin or owner read financial_accounts" ON public.financial_accounts;
CREATE POLICY "Admin or owner read financial_accounts" ON public.financial_accounts
    FOR SELECT USING (owner_user_id = auth.uid() OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage financial_accounts" ON public.financial_accounts;
DROP POLICY IF EXISTS "Service manage financial_accounts" ON public.financial_accounts;
CREATE POLICY "Service manage financial_accounts" ON public.financial_accounts
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin only read ledger_transactions" ON public.ledger_transactions;
DROP POLICY IF EXISTS "Admin or service insert ledger_transactions" ON public.ledger_transactions;
DROP POLICY IF EXISTS "Owner or admin read ledger_transactions" ON public.ledger_transactions;
CREATE POLICY "Owner or admin read ledger_transactions" ON public.ledger_transactions
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR EXISTS (
            SELECT 1
            FROM public.ledger_entries le
            JOIN public.financial_accounts fa ON fa.id = le.account_id
            WHERE le.transaction_id = ledger_transactions.id
              AND fa.owner_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admin only read ledger_entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Admin or service insert ledger_entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Owner or admin read ledger_entries" ON public.ledger_entries;
CREATE POLICY "Owner or admin read ledger_entries" ON public.ledger_entries
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR EXISTS (
            SELECT 1
            FROM public.financial_accounts fa
            WHERE fa.id = ledger_entries.account_id
              AND fa.owner_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Public read active payout methods" ON public.payout_methods;
CREATE POLICY "Public read active payout methods" ON public.payout_methods
    FOR SELECT USING (is_active = true OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage payout methods" ON public.payout_methods;
CREATE POLICY "Admin manage payout methods" ON public.payout_methods
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own withdrawals or admin all" ON public.withdrawal_requests;
CREATE POLICY "Users read own withdrawals or admin all" ON public.withdrawal_requests
    FOR SELECT USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage withdrawals" ON public.withdrawal_requests;
CREATE POLICY "Admin manage withdrawals" ON public.withdrawal_requests
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage tax definitions" ON public.tax_definitions;
CREATE POLICY "Admin manage tax definitions" ON public.tax_definitions
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage tax settlements" ON public.tax_settlements;
CREATE POLICY "Admin manage tax settlements" ON public.tax_settlements
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin read financial audit logs" ON public.financial_audit_logs;
CREATE POLICY "Admin read financial audit logs" ON public.financial_audit_logs
    FOR SELECT USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin insert financial audit logs" ON public.financial_audit_logs;
CREATE POLICY "Admin insert financial audit logs" ON public.financial_audit_logs
    FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

REVOKE ALL ON FUNCTION public.ensure_own_financial_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_own_financial_account() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reserve_withdrawal_ledger(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal_ledger(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_owner_financial_operation(TEXT, BIGINT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_owner_financial_operation(TEXT, BIGINT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.release_task_escrow(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_task_escrow(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reverse_ledger_transaction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_transaction(UUID, TEXT) TO authenticated, service_role;
