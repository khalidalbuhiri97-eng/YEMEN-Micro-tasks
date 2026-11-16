-- ==============================================================================
-- Migration 022: External Accounts, Receipt-Backed Manual Deposit Approvals,
-- Internal Transfers, Reconciliation & 3-Way Fund Segregation (Phase 5)
-- ==============================================================================
-- Accounting & Security Principles:
--   1. Existing PLATFORM-TREASURY & PLATFORM-CASH-VAULT remain untouched and are
--      NEVER replaced or double-credited.
--   2. Every External Account owns a dedicated ledger account in financial_accounts
--      (account_type = 'asset', normal_side = 'debit', code = 'EXT-ACC-*').
--   3. Advertiser deposits are recorded STRICTLY as LIABILITIES (WALLET-* credit /
--      EXT-ACC-* debit) — NEVER as platform revenue or virtual treasury issuance.
--   4. Same receipt reference number cannot be approved/used twice (partial UNIQUE
--      index on normalized reference + status lock + idempotency key).
--   5. Internal transfers between Owner/Admin accounts only debit/credit Assets
--      with zero impact on revenues, expenses, or treasury supply.
-- ==============================================================================

-- 1. External Accounts Table (Bank, Exchange, E-Wallet, Physical Cash Custody)
CREATE TABLE IF NOT EXISTS public.external_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    owner_role TEXT NOT NULL DEFAULT 'owner' CHECK (owner_role IN ('owner', 'admin', 'company')),
    account_type TEXT NOT NULL CHECK (account_type IN ('bank', 'exchange', 'ewallet', 'cash')),
    provider_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'YER',
    fund_scope TEXT NOT NULL DEFAULT 'mixed' CHECK (fund_scope IN ('platform', 'advertiser', 'mixed')),
    financial_account_id UUID NOT NULL UNIQUE REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
    actual_balance_units BIGINT NOT NULL DEFAULT 0,
    last_reconciled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_accounts_scope_status
    ON public.external_accounts(fund_scope, status, created_at DESC);

-- 2. External Deposits Table (Receipt + Unique Reference + Manual Admin Approval)
CREATE TABLE IF NOT EXISTS public.external_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_account_id UUID NOT NULL REFERENCES public.external_accounts(id) ON DELETE RESTRICT,
    deposit_purpose TEXT NOT NULL DEFAULT 'advertiser_wallet'
        CHECK (deposit_purpose IN ('advertiser_wallet', 'platform_capital')),
    advertiser_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount_units BIGINT NOT NULL CHECK (amount_units > 0),
    reference_number TEXT NOT NULL,
    reference_number_normalized TEXT NOT NULL,
    receipt_url TEXT NOT NULL,
    depositor_name TEXT,
    depositor_phone TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    ledger_transaction_id UUID UNIQUE REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    idempotency_key TEXT UNIQUE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_external_deposit_advertiser_required CHECK (
        (deposit_purpose = 'advertiser_wallet' AND advertiser_id IS NOT NULL)
        OR deposit_purpose = 'platform_capital'
    )
);

-- Prevent the same receipt/reference number from ever being approved or active twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_deposits_unique_active_ref
    ON public.external_deposits(reference_number_normalized)
    WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS idx_external_deposits_status_created
    ON public.external_deposits(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_deposits_advertiser
    ON public.external_deposits(advertiser_id, created_at DESC);

-- 3. Internal Transfers Between Owner/Admin Asset Accounts
CREATE TABLE IF NOT EXISTS public.external_account_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_external_account_id UUID REFERENCES public.external_accounts(id) ON DELETE RESTRICT,
    to_external_account_id UUID REFERENCES public.external_accounts(id) ON DELETE RESTRICT,
    from_financial_account_id UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
    to_financial_account_id UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
    amount_units BIGINT NOT NULL CHECK (amount_units > 0),
    reference_number TEXT,
    reason TEXT NOT NULL,
    ledger_transaction_id UUID NOT NULL UNIQUE REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    idempotency_key TEXT UNIQUE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_internal_transfer_distinct_accounts CHECK (
        from_financial_account_id <> to_financial_account_id
    )
);

CREATE INDEX IF NOT EXISTS idx_external_transfers_created
    ON public.external_account_transfers(created_at DESC);

-- 4. External Account Reconciliations & Documented Adjustments
CREATE TABLE IF NOT EXISTS public.external_account_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_account_id UUID NOT NULL REFERENCES public.external_accounts(id) ON DELETE RESTRICT,
    accounting_balance_units BIGINT NOT NULL,
    actual_balance_units BIGINT NOT NULL,
    discrepancy_units BIGINT NOT NULL,
    adjustment_transaction_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    adjustment_reason TEXT,
    status TEXT NOT NULL CHECK (status IN ('matched', 'discrepancy', 'adjusted')),
    reconciled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_reconciliations_account
    ON public.external_account_reconciliations(external_account_id, created_at DESC);

-- 5. Strict Row-Level Security (Admin/Owner Exclusive, Read-Own Exception for Advertiser Receipts)
ALTER TABLE public.external_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_account_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_account_reconciliations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.external_accounts FROM PUBLIC, anon;
REVOKE ALL ON public.external_deposits FROM PUBLIC, anon;
REVOKE ALL ON public.external_account_transfers FROM PUBLIC, anon;
REVOKE ALL ON public.external_account_reconciliations FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Admin manage external accounts" ON public.external_accounts;
CREATE POLICY "Admin manage external accounts" ON public.external_accounts
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage external deposits" ON public.external_deposits;
CREATE POLICY "Admin manage external deposits" ON public.external_deposits
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Advertisers read own external deposits" ON public.external_deposits;
CREATE POLICY "Advertisers read own external deposits" ON public.external_deposits
    FOR SELECT USING (auth.uid() = advertiser_id);

DROP POLICY IF EXISTS "Admin manage external transfers" ON public.external_account_transfers;
CREATE POLICY "Admin manage external transfers" ON public.external_account_transfers
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin manage external reconciliations" ON public.external_account_reconciliations;
CREATE POLICY "Admin manage external reconciliations" ON public.external_account_reconciliations
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

-- 6. Helper: Reference Number Normalization
CREATE OR REPLACE FUNCTION public.normalize_receipt_reference(p_ref TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_ref, '')), '[\s\-]+', '', 'g'));
$$;

-- 7. Atomic RPC: Create Independent External Account + Linked Asset Ledger Account
CREATE OR REPLACE FUNCTION public.create_external_account(
    p_account_name TEXT,
    p_owner_name TEXT,
    p_owner_role TEXT DEFAULT 'owner',
    p_account_type TEXT DEFAULT 'bank',
    p_provider_name TEXT DEFAULT '',
    p_account_number TEXT DEFAULT '',
    p_fund_scope TEXT DEFAULT 'mixed',
    p_notes TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_actor_id UUID := COALESCE(v_caller_id, p_actor_id);
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_ext_id UUID := gen_random_uuid();
    v_fin_id UUID := gen_random_uuid();
    v_fin_code TEXT := 'EXT-ACC-' || UPPER(SUBSTRING(REPLACE(v_ext_id::text, '-', ''), 1, 10));
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة لإنشاء حساب خارجي.' USING ERRCODE = '42501';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_account_name, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(p_owner_name, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(p_provider_name, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(p_account_number, '')), '') IS NULL THEN
        RAISE EXCEPTION 'اسم الحساب، صاحب الحساب، المزود، ورقم الحساب حقول إلزامية.';
    END IF;

    INSERT INTO public.financial_accounts (
        id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
    ) VALUES (
        v_fin_id, v_fin_code, 'asset', NULL, NULL, 'debit', 0, 'active', v_now
    );

    INSERT INTO public.external_accounts (
        id, account_name, owner_name, owner_role, account_type, provider_name,
        account_number, currency, fund_scope, financial_account_id,
        actual_balance_units, status, notes, created_by, created_at, updated_at
    ) VALUES (
        v_ext_id,
        TRIM(p_account_name),
        TRIM(p_owner_name),
        LOWER(COALESCE(NULLIF(TRIM(p_owner_role), ''), 'owner')),
        LOWER(COALESCE(NULLIF(TRIM(p_account_type), ''), 'bank')),
        TRIM(p_provider_name),
        TRIM(p_account_number),
        'YER',
        LOWER(COALESCE(NULLIF(TRIM(p_fund_scope), ''), 'mixed')),
        v_fin_id,
        0,
        'active',
        NULLIF(TRIM(COALESCE(p_notes, '')), ''),
        v_actor_id,
        v_now,
        v_now
    );

    INSERT INTO public.financial_audit_logs (action_type, actor_id, details, created_at)
    VALUES (
        'EXTERNAL_ACCOUNT_CREATED',
        v_actor_id,
        jsonb_build_object(
            'external_account_id', v_ext_id,
            'financial_account_id', v_fin_id,
            'account_code', v_fin_code,
            'owner_name', TRIM(p_owner_name),
            'account_type', LOWER(TRIM(p_account_type)),
            'fund_scope', LOWER(TRIM(p_fund_scope))
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', v_ext_id,
        'financialAccountId', v_fin_id,
        'accountCode', v_fin_code
    );
END;
$$;

-- 8. Atomic RPC: Manual Collection Approval of External Deposit
--    - Debits External Account Asset (EXT-ACC-*)
--    - Credits Advertiser Wallet Liability (WALLET-*) OR OWNER-CAPITAL (if platform_capital)
--    - NEVER credits PLATFORM-REVENUE-* or PLATFORM-TREASURY
--    - Prevents double-approval via row lock, status check, idempotency_key, and unique normalized reference
CREATE OR REPLACE FUNCTION public.approve_external_deposit(
    p_deposit_id UUID,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_actor_id UUID := COALESCE(v_caller_id, p_actor_id);
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_dep RECORD;
    v_ext_acc RECORD;
    v_ext_fin_acc RECORD;
    v_credit_fin_acc RECORD;
    v_wallet RECORD;
    v_dup_count INT := 0;
    v_lock_ids UUID[];
    v_tx_id UUID;
    v_tx_type TEXT;
    v_idem_key TEXT;
    v_ext_new_bal BIGINT;
    v_credit_new_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة لاعتماد التحصيل اليدوي.' USING ERRCODE = '42501';
    END IF;

    IF p_deposit_id IS NULL THEN
        RAISE EXCEPTION 'معرف الإيداع مطلوب.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('approve_ext_deposit_' || p_deposit_id::text));

    SELECT * INTO v_dep
    FROM public.external_deposits
    WHERE id = p_deposit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'سجل الإيداع غير موجود.';
    END IF;

    IF v_dep.status = 'approved' AND v_dep.ledger_transaction_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'depositId', v_dep.id,
            'status', 'approved',
            'transactionId', v_dep.ledger_transaction_id
        );
    END IF;

    IF v_dep.status <> 'pending' THEN
        RAISE EXCEPTION 'لا يمكن اعتماد إيداع حالته الحالية (%)', v_dep.status;
    END IF;

    -- Serialize by normalized reference number to block concurrent duplicate receipt approvals
    PERFORM pg_advisory_xact_lock(hashtext('ext_dep_ref_' || v_dep.reference_number_normalized));

    SELECT COUNT(*) INTO v_dup_count
    FROM public.external_deposits
    WHERE reference_number_normalized = v_dep.reference_number_normalized
      AND status = 'approved'
      AND id <> v_dep.id;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'الرقم المرجعي للإيصال (%) معتمد مسبقاً لإيداع آخر ولا يمكن اعتماده مرتين.', v_dep.reference_number;
    END IF;

    SELECT * INTO v_ext_acc
    FROM public.external_accounts
    WHERE id = v_dep.external_account_id;

    IF NOT FOUND OR v_ext_acc.status <> 'active' THEN
        RAISE EXCEPTION 'الحساب الخارجي غير موجود أو مجمد.';
    END IF;

    IF v_dep.deposit_purpose = 'advertiser_wallet' THEN
        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE user_id = v_dep.advertiser_id
        ORDER BY created_at ASC
        LIMIT 1;

        IF NOT FOUND THEN
            INSERT INTO public.wallets (id, user_id, wallet_address, status, created_at)
            VALUES (
                gen_random_uuid(),
                v_dep.advertiser_id,
                'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(v_dep.advertiser_id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
                'active',
                v_now
            )
            RETURNING * INTO v_wallet;
        END IF;

        SELECT * INTO v_credit_fin_acc
        FROM public.financial_accounts
        WHERE wallet_id = v_wallet.id AND account_type = 'wallet'
        LIMIT 1;

        IF NOT FOUND THEN
            INSERT INTO public.financial_accounts (
                id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
            ) VALUES (
                gen_random_uuid(), 'WALLET-' || v_wallet.id::text, 'wallet', v_dep.advertiser_id, v_wallet.id, 'credit', 0, 'active', v_now
            )
            RETURNING * INTO v_credit_fin_acc;
        END IF;

        v_tx_type := 'EXTERNAL_ADVERTISER_DEPOSIT';
    ELSE
        SELECT * INTO v_credit_fin_acc
        FROM public.financial_accounts
        WHERE account_code = 'OWNER-CAPITAL'
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'حساب رأس مال المالك OWNER-CAPITAL غير موجود.';
        END IF;

        v_tx_type := 'EXTERNAL_CAPITAL_DEPOSIT';
    END IF;

    SELECT array_agg(x ORDER BY x) INTO v_lock_ids
    FROM unnest(ARRAY[v_ext_acc.financial_account_id, v_credit_fin_acc.id]) AS x;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    SELECT * INTO v_ext_fin_acc FROM public.financial_accounts WHERE id = v_ext_acc.financial_account_id;
    SELECT * INTO v_credit_fin_acc FROM public.financial_accounts WHERE id = v_credit_fin_acc.id;

    v_idem_key := 'EXT-DEP-APPROVE:' || v_dep.id::text;

    SELECT id INTO v_tx_id
    FROM public.ledger_transactions
    WHERE idempotency_key = v_idem_key
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            v_tx_type,
            v_dep.reference_number,
            v_idem_key,
            'posted',
            jsonb_build_object(
                'deposit_id', v_dep.id,
                'external_account_id', v_ext_acc.id,
                'external_account_name', v_ext_acc.account_name,
                'advertiser_id', v_dep.advertiser_id,
                'deposit_purpose', v_dep.deposit_purpose,
                'reference_number', v_dep.reference_number,
                'receipt_url', v_dep.receipt_url,
                'accounting_classification', CASE WHEN v_dep.deposit_purpose = 'advertiser_wallet' THEN 'ADVERTISER_LIABILITY' ELSE 'OWNER_EQUITY' END,
                'description', CASE
                    WHEN v_dep.deposit_purpose = 'advertiser_wallet'
                        THEN 'اعتماد تحصيل وشحن محفظة معلن (التزام للغير) عبر ' || v_ext_acc.account_name || ' - مرجع: ' || v_dep.reference_number
                    ELSE 'اعتماد إيداع رأسمالي بالحساب الخارجي ' || v_ext_acc.account_name || ' - مرجع: ' || v_dep.reference_number
                END
            ),
            v_actor_id,
            v_now
        )
        RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_ext_fin_acc.id, 'debit', v_dep.amount_units, 'تحصيل نقدي في الحساب الخارجي: ' || v_ext_acc.account_name || ' (' || v_dep.reference_number || ')', v_now),
            (v_tx_id, v_credit_fin_acc.id, 'credit', v_dep.amount_units,
                CASE WHEN v_dep.deposit_purpose = 'advertiser_wallet'
                    THEN 'شحن محفظة المعلن (التزام غير مُستحق كإيراد) - مرجع: ' || v_dep.reference_number
                    ELSE 'إثبات رأس مال مضاف بالحساب الخارجي - مرجع: ' || v_dep.reference_number
                END,
                v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_dep.amount_units ELSE -v_dep.amount_units END
        WHERE id = v_ext_fin_acc.id
        RETURNING balance_units INTO v_ext_new_bal;

        IF v_ext_new_bal < 0 THEN
            RAISE EXCEPTION 'فشل تحديث رصيد الحساب الخارجي.';
        END IF;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_dep.amount_units ELSE -v_dep.amount_units END
        WHERE id = v_credit_fin_acc.id
        RETURNING balance_units INTO v_credit_new_bal;

        IF v_credit_new_bal < 0 THEN
            RAISE EXCEPTION 'فشل تحديث الرصيد الدائن.';
        END IF;
    END IF;

    UPDATE public.external_deposits
    SET status = 'approved',
        reviewed_by = v_actor_id,
        reviewed_at = v_now,
        ledger_transaction_id = v_tx_id,
        idempotency_key = v_idem_key,
        updated_at = v_now
    WHERE id = v_dep.id;

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        v_tx_type,
        v_actor_id,
        v_tx_id,
        jsonb_build_object(
            'deposit_id', v_dep.id,
            'external_account_id', v_ext_acc.id,
            'advertiser_id', v_dep.advertiser_id,
            'amount_units', v_dep.amount_units,
            'reference_number', v_dep.reference_number
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'depositId', v_dep.id,
        'status', 'approved',
        'transactionId', v_tx_id,
        'externalAccountBalance', v_ext_new_bal,
        'targetAccountBalance', v_credit_new_bal
    );
END;
$$;

-- 9. Atomic RPC: Internal Asset-to-Asset Transfer Between Owner/Admin Accounts
CREATE OR REPLACE FUNCTION public.execute_internal_account_transfer(
    p_from_financial_account_id UUID,
    p_to_financial_account_id UUID,
    p_amount_units BIGINT,
    p_reason TEXT,
    p_reference_number TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_actor_id UUID := COALESCE(v_caller_id, p_actor_id);
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_from_acc RECORD;
    v_to_acc RECORD;
    v_from_ext RECORD;
    v_to_ext RECORD;
    v_lock_ids UUID[];
    v_tx_id UUID;
    v_transfer_id UUID := gen_random_uuid();
    v_key TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''), 'INT-XFER:' || v_transfer_id::text);
    v_existing RECORD;
    v_from_bal BIGINT;
    v_to_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة للتحويل الداخلي.' USING ERRCODE = '42501';
    END IF;

    IF p_from_financial_account_id IS NULL OR p_to_financial_account_id IS NULL OR p_from_financial_account_id = p_to_financial_account_id THEN
        RAISE EXCEPTION 'يجب اختيار حسابين مختلفين للتحويل الداخلي.';
    END IF;

    IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
        RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون عدداً صحيحاً موجباً.';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'سبب التحويل الداخلي مطلوب للتوثيق.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('internal_transfer_' || v_key));

    SELECT * INTO v_existing FROM public.external_account_transfers WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'transferId', v_existing.id,
            'transactionId', v_existing.ledger_transaction_id
        );
    END IF;

    SELECT array_agg(x ORDER BY x) INTO v_lock_ids
    FROM unnest(ARRAY[p_from_financial_account_id, p_to_financial_account_id]) AS x;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    SELECT * INTO v_from_acc FROM public.financial_accounts WHERE id = p_from_financial_account_id;
    SELECT * INTO v_to_acc FROM public.financial_accounts WHERE id = p_to_financial_account_id;

    IF NOT FOUND OR v_from_acc.id IS NULL OR v_to_acc.id IS NULL THEN
        RAISE EXCEPTION 'أحد حسابي التحويل الداخلي غير موجود.';
    END IF;

    IF LOWER(v_from_acc.account_type) <> 'asset' OR LOWER(v_to_acc.account_type) <> 'asset' THEN
        RAISE EXCEPTION 'التحويل الداخلي مسموح فقط بين حسابات الأصول النقدية والحسابات الخارجية للمالك والمدير.';
    END IF;

    IF v_from_acc.balance_units < p_amount_units THEN
        RAISE EXCEPTION 'رصيد الحساب المصدر (%) غير كافٍ لتحويل % ر.ي.', v_from_acc.balance_units, p_amount_units;
    END IF;

    SELECT id INTO v_from_ext FROM public.external_accounts WHERE financial_account_id = v_from_acc.id LIMIT 1;
    SELECT id INTO v_to_ext FROM public.external_accounts WHERE financial_account_id = v_to_acc.id LIMIT 1;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'INTERNAL_ACCOUNT_TRANSFER',
        COALESCE(NULLIF(TRIM(COALESCE(p_reference_number, '')), ''), 'INT-TRANSFER'),
        v_key,
        'posted',
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'from_account_code', v_from_acc.account_code,
            'to_account_code', v_to_acc.account_code,
            'amount_units', p_amount_units,
            'reason', TRIM(p_reason),
            'description', 'تحويل داخلي بين حسابات المنصة: من ' || v_from_acc.account_code || ' إلى ' || v_to_acc.account_code || ' — ' || TRIM(p_reason)
        ),
        v_actor_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_to_acc.id, 'debit', p_amount_units, 'استلام تحويل داخلي من ' || v_from_acc.account_code, v_now),
        (v_tx_id, v_from_acc.id, 'credit', p_amount_units, 'تحويل داخلي صادر إلى ' || v_to_acc.account_code, v_now);

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN -p_amount_units ELSE p_amount_units END
    WHERE id = v_from_acc.id
    RETURNING balance_units INTO v_from_bal;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN p_amount_units ELSE -p_amount_units END
    WHERE id = v_to_acc.id
    RETURNING balance_units INTO v_to_bal;

    INSERT INTO public.external_account_transfers (
        id, from_external_account_id, to_external_account_id,
        from_financial_account_id, to_financial_account_id,
        amount_units, reference_number, reason, ledger_transaction_id,
        idempotency_key, created_by, created_at
    ) VALUES (
        v_transfer_id, v_from_ext.id, v_to_ext.id,
        v_from_acc.id, v_to_acc.id,
        p_amount_units, NULLIF(TRIM(COALESCE(p_reference_number, '')), ''), TRIM(p_reason), v_tx_id,
        v_key, v_actor_id, v_now
    );

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'INTERNAL_ACCOUNT_TRANSFER',
        v_actor_id,
        v_tx_id,
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'from_account', v_from_acc.account_code,
            'to_account', v_to_acc.account_code,
            'amount_units', p_amount_units,
            'reason', TRIM(p_reason)
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'transferId', v_transfer_id,
        'transactionId', v_tx_id,
        'fromBalance', v_from_bal,
        'toBalance', v_to_bal
    );
END;
$$;

-- 10. Atomic RPC: Reconcile External Account (Actual Bank Balance vs Accounting Balance)
CREATE OR REPLACE FUNCTION public.reconcile_external_account(
    p_external_account_id UUID,
    p_actual_balance_units BIGINT,
    p_apply_adjustment BOOLEAN DEFAULT false,
    p_adjustment_reason TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_actor_id UUID := COALESCE(v_caller_id, p_actor_id);
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_ext_acc RECORD;
    v_fin_acc RECORD;
    v_contra_acc RECORD;
    v_lock_ids UUID[];
    v_accounting BIGINT;
    v_diff BIGINT;
    v_abs_diff BIGINT;
    v_tx_id UUID := NULL;
    v_rec_id UUID := gen_random_uuid();
    v_status TEXT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة لتنفيذ المطابقة والتسوية.' USING ERRCODE = '42501';
    END IF;

    IF p_actual_balance_units IS NULL OR p_actual_balance_units < 0 THEN
        RAISE EXCEPTION 'الرصيد الفعلي يجب أن يكون عدداً صحيحاً غير سالب.';
    END IF;

    SELECT * INTO v_ext_acc FROM public.external_accounts WHERE id = p_external_account_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب الخارجي غير موجود.';
    END IF;

    SELECT * INTO v_fin_acc FROM public.financial_accounts WHERE id = v_ext_acc.financial_account_id FOR UPDATE;
    v_accounting := COALESCE(v_fin_acc.balance_units, 0);
    v_diff := p_actual_balance_units - v_accounting;

    IF v_diff = 0 THEN
        v_status := 'matched';
    ELSIF COALESCE(p_apply_adjustment, false) = false THEN
        v_status := 'discrepancy';
    ELSE
        IF NULLIF(TRIM(COALESCE(p_adjustment_reason, '')), '') IS NULL THEN
            RAISE EXCEPTION 'يجب كتابة سبب التسوية المحاسبية عند وجود فرق بين الرصيد الفعلي والمحاسبي.';
        END IF;

        v_abs_diff := ABS(v_diff);
        IF v_diff > 0 THEN
            SELECT * INTO v_contra_acc FROM public.financial_accounts
            WHERE account_code = CASE WHEN v_ext_acc.fund_scope = 'platform' THEN 'OWNER-CAPITAL' ELSE 'PLATFORM-EXPENSE-CLEARING' END
            LIMIT 1;
        ELSE
            SELECT * INTO v_contra_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-EXPENSES' LIMIT 1;
        END IF;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'حساب التسوية المقابل غير موجود في دليل الحسابات.';
        END IF;

        SELECT array_agg(x ORDER BY x) INTO v_lock_ids FROM unnest(ARRAY[v_fin_acc.id, v_contra_acc.id]) AS x;
        PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'EXTERNAL_RECONCILIATION_ADJUSTMENT',
            'RECON:' || v_rec_id::text,
            'EXT-RECON:' || v_rec_id::text,
            'posted',
            jsonb_build_object(
                'reconciliation_id', v_rec_id,
                'external_account_id', v_ext_acc.id,
                'account_name', v_ext_acc.account_name,
                'accounting_before', v_accounting,
                'actual_balance', p_actual_balance_units,
                'discrepancy', v_diff,
                'reason', TRIM(p_adjustment_reason),
                'description', 'تسوية مطابقة حساب خارجي (' || v_ext_acc.account_name || '): ' || TRIM(p_adjustment_reason)
            ),
            v_actor_id,
            v_now
        )
        RETURNING id INTO v_tx_id;

        IF v_diff > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_tx_id, v_fin_acc.id, 'debit', v_abs_diff, 'قيد تسوية زيادة فعلية بالمطابقة: ' || TRIM(p_adjustment_reason), v_now),
                (v_tx_id, v_contra_acc.id, 'credit', v_abs_diff, 'مقابل تسوية مطابقة الحساب الخارجي', v_now);

            UPDATE public.financial_accounts SET balance_units = balance_units + v_abs_diff WHERE id = v_fin_acc.id;
            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_abs_diff ELSE -v_abs_diff END
            WHERE id = v_contra_acc.id;
        ELSE
            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_tx_id, v_contra_acc.id, 'debit', v_abs_diff, 'قيد تسوية عجز/عمولات بالمطابقة: ' || TRIM(p_adjustment_reason), v_now),
                (v_tx_id, v_fin_acc.id, 'credit', v_abs_diff, 'تعديل رصيد الحساب الخارجي للرصيد الفعلي', v_now);

            UPDATE public.financial_accounts SET balance_units = balance_units - v_abs_diff WHERE id = v_fin_acc.id;
            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_abs_diff ELSE -v_abs_diff END
            WHERE id = v_contra_acc.id;
        END IF;

        v_accounting := p_actual_balance_units;
        v_status := 'adjusted';
    END IF;

    UPDATE public.external_accounts
    SET actual_balance_units = p_actual_balance_units,
        last_reconciled_at = v_now,
        updated_at = v_now
    WHERE id = v_ext_acc.id;

    INSERT INTO public.external_account_reconciliations (
        id, external_account_id, accounting_balance_units, actual_balance_units,
        discrepancy_units, adjustment_transaction_id, adjustment_reason, status, reconciled_by, created_at
    ) VALUES (
        v_rec_id, v_ext_acc.id, v_accounting, p_actual_balance_units,
        v_diff, v_tx_id, NULLIF(TRIM(COALESCE(p_adjustment_reason, '')), ''), v_status, v_actor_id, v_now
    );

    INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
    VALUES (
        'EXTERNAL_ACCOUNT_RECONCILED',
        v_actor_id,
        v_tx_id,
        jsonb_build_object(
            'reconciliation_id', v_rec_id,
            'external_account_id', v_ext_acc.id,
            'actual_balance_units', p_actual_balance_units,
            'discrepancy_units', v_diff,
            'status', v_status
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'reconciliationId', v_rec_id,
        'status', v_status,
        'accountingBalanceUnits', v_accounting,
        'actualBalanceUnits', p_actual_balance_units,
        'discrepancyUnits', v_diff,
        'adjustmentTransactionId', v_tx_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_receipt_reference(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_receipt_reference(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_external_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_external_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_external_deposit(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_external_deposit(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.execute_internal_account_transfer(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_internal_account_transfer(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reconcile_external_account(UUID, BIGINT, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_external_account(UUID, BIGINT, BOOLEAN, TEXT, UUID) TO authenticated, service_role;
