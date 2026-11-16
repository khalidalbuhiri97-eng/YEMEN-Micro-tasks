-- ==============================================================================
-- Migration 025: Withdrawal Schema Alignment & Atomic Receipt-Enforced Settlement
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Scope:
--   1. Align live & historical withdrawal_requests columns cleanly in NUMERIC(30,6).
--   2. Enforce mandatory transfer_reference + receipt_url when settling as PAID.
--   3. Upgrade reserve_withdrawal_ledger & settle_withdrawal_ledger to NUMERIC(30,6),
--      creating notifications for PENDING, PAID, and REJECTED transitions.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Reconcile withdrawal_requests schema without losing existing columns or data
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.withdrawal_requests') IS NOT NULL THEN
        ALTER TABLE public.withdrawal_requests
            ADD COLUMN IF NOT EXISTS amount NUMERIC(30,6),
            ADD COLUMN IF NOT EXISTS fee NUMERIC(30,6) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS net_amount NUMERIC(30,6),
            ADD COLUMN IF NOT EXISTS amount_units NUMERIC(30,6),
            ADD COLUMN IF NOT EXISTS fee_units NUMERIC(30,6),
            ADD COLUMN IF NOT EXISTS net_units NUMERIC(30,6),
            ADD COLUMN IF NOT EXISTS method TEXT,
            ADD COLUMN IF NOT EXISTS payout_method_code TEXT,
            ADD COLUMN IF NOT EXISTS beneficiary_name TEXT,
            ADD COLUMN IF NOT EXISTS phone_number TEXT,
            ADD COLUMN IF NOT EXISTS account_number TEXT,
            ADD COLUMN IF NOT EXISTS transfer_reference TEXT,
            ADD COLUMN IF NOT EXISTS receipt_url TEXT,
            ADD COLUMN IF NOT EXISTS receipt_object_path TEXT,
            ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
            ADD COLUMN IF NOT EXISTS admin_id UUID,
            ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS ledger_reservation_transaction_id UUID,
            ADD COLUMN IF NOT EXISTS ledger_settlement_transaction_id UUID;

        -- Sync mirror columns cleanly if either set was populated historically
        UPDATE public.withdrawal_requests
        SET amount = COALESCE(amount, amount_units, 0),
            amount_units = COALESCE(amount_units, amount, 0),
            fee = COALESCE(fee, fee_units, 0),
            fee_units = COALESCE(fee_units, fee, 0),
            net_amount = COALESCE(net_amount, net_units, GREATEST(0, COALESCE(amount, amount_units, 0) - COALESCE(fee, fee_units, 0))),
            net_units = COALESCE(net_units, net_amount, GREATEST(0, COALESCE(amount_units, amount, 0) - COALESCE(fee_units, fee, 0))),
            method = COALESCE(method, payout_method_code),
            payout_method_code = COALESCE(payout_method_code, method),
            receipt_url = COALESCE(receipt_url, receipt_object_path),
            receipt_object_path = COALESCE(receipt_object_path, receipt_url);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Upgrade reserve_withdrawal_ledger to NUMERIC(30,6) + Notification
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reserve_withdrawal_ledger(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.reserve_withdrawal_ledger(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.reserve_withdrawal_ledger(
    p_method TEXT,
    p_amount_units NUMERIC,
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
    v_amount NUMERIC(30,6);
    v_fee NUMERIC(30,6) := 0;
    v_net NUMERIC(30,6);
    v_tx_id UUID;
    v_withdrawal_id UUID := gen_random_uuid();
    v_wallet_new_bal NUMERIC(30,6);
    v_reserved_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
    v_res_fk_is_wallet_tx BOOLEAN := false;
    v_legacy_res_tx_id UUID := NULL;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_amount_units IS NULL OR p_amount_units <= 0 OR p_amount_units <> ROUND(p_amount_units, 6) THEN
        RAISE EXCEPTION 'مبلغ السحب يجب أن يكون أكبر من صفر وبحد أقصى 6 منازل عشرية.';
    END IF;
    v_amount := ROUND(p_amount_units, 6);

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
            'amount', COALESCE(v_existing.amount, v_existing.amount_units),
            'fee', COALESCE(v_existing.fee, v_existing.fee_units),
            'netAmount', COALESCE(v_existing.net_amount, v_existing.net_units),
            'status', v_existing.status,
            'newAvailableBalance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    SELECT * INTO v_pm FROM public.payout_methods WHERE code = v_method AND is_active = true LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طريقة الدفع % غير مفعلة أو غير موجودة.', v_method;
    END IF;
    IF v_amount < v_pm.min_withdrawal THEN
        RAISE EXCEPTION 'المبلغ أقل من الحد الأدنى للسحب (% ر.ي).', v_pm.min_withdrawal;
    END IF;
    IF v_amount > v_pm.max_withdrawal THEN
        RAISE EXCEPTION 'المبلغ يتجاوز الحد الأقصى للسحب (% ر.ي).', v_pm.max_withdrawal;
    END IF;

    v_fee := ROUND((v_amount * COALESCE(v_pm.fee_percentage, 0)) / 100.0, 6) + COALESCE(v_pm.fee_flat, 0);
    IF v_fee < 0 OR v_fee >= v_amount THEN
        RAISE EXCEPTION 'قيمة رسوم السحب المحتسبة غير صالحة.';
    END IF;
    v_net := v_amount - v_fee;

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

    v_tx_id := public.post_ledger_transaction(
        p_transaction_type := 'WITHDRAWAL_REQUEST',
        p_idempotency_key := 'WITHDRAWAL-RESERVE:' || v_key,
        p_reference := 'WITHDRAWAL:' || v_withdrawal_id::text,
        p_metadata := jsonb_build_object(
            'withdrawal_id', v_withdrawal_id,
            'user_id', v_user_id,
            'method', v_method,
            'amount_units', v_amount,
            'fee_units', v_fee,
            'net_units', v_net,
            'description', 'حجز رصيد لطلب سحب عبر ' || v_method
        ),
        p_entries := jsonb_build_array(
            jsonb_build_object('account_id', v_wallet_acc.id, 'side', 'debit', 'amount_units', v_amount, 'memo', 'حجز رصيد طلب سحب عبر ' || v_method),
            jsonb_build_object('account_id', v_reserved_acc.id, 'side', 'credit', 'amount_units', v_amount, 'memo', 'التزام سحب معلق للمستخدم')
        )
    );

    SELECT balance_units INTO v_wallet_new_bal FROM public.financial_accounts WHERE id = v_wallet_acc.id;
    SELECT balance_units INTO v_reserved_new_bal FROM public.financial_accounts WHERE id = v_reserved_acc.id;

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
        id, user_id, method, payout_method_code,
        amount, fee, net_amount, amount_units, fee_units, net_units,
        beneficiary_name, phone_number, account_number,
        status, idempotency_key, reservation_transaction_id, ledger_reservation_transaction_id, created_at
    ) VALUES (
        v_withdrawal_id, v_user_id, v_method, v_method,
        v_amount, v_fee, v_net, v_amount, v_fee, v_net,
        TRIM(p_beneficiary_name), TRIM(p_phone_number), NULLIF(TRIM(COALESCE(p_account_number, '')), ''),
        'PENDING', v_key, v_legacy_res_tx_id, v_tx_id, v_now
    );

    INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
    VALUES (
        v_user_id,
        'تم استلام طلب السحب وحجز المبلغ',
        'تم تسجيل طلب سحب بمبلغ ' || v_amount || ' ر.ي عبر ' || v_method || ' وهو الآن قيد المراجعة.',
        'WITHDRAWAL_PENDING',
        false,
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'withdrawalId', v_withdrawal_id,
        'transactionId', v_tx_id,
        'amount', v_amount,
        'fee', v_fee,
        'netAmount', v_net,
        'status', 'PENDING',
        'newAvailableBalance', v_wallet_new_bal
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Upgrade settle_withdrawal_ledger: NUMERIC(30,6), Mandatory Ref + Receipt on PAY
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.settle_withdrawal_ledger(
    p_withdrawal_id UUID,
    p_decision TEXT,
    p_transfer_reference TEXT DEFAULT NULL,
    p_receipt_url TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_provider_fee_units NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_decision TEXT := UPPER(TRIM(COALESCE(p_decision, '')));
    v_clean_ref TEXT := NULLIF(TRIM(COALESCE(p_transfer_reference, '')), '');
    v_clean_receipt TEXT := NULLIF(TRIM(COALESCE(p_receipt_url, '')), '');
    v_clean_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
    v_w RECORD;
    v_amount NUMERIC(30,6);
    v_fee NUMERIC(30,6);
    v_net NUMERIC(30,6);
    v_provider_fee NUMERIC(30,6) := ROUND(COALESCE(p_provider_fee_units, 0), 6);
    v_reserved_acc RECORD;
    v_settled_acc RECORD;
    v_rev_services_acc RECORD;
    v_wallet_acc RECORD;
    v_entries JSONB;
    v_tx_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_wallet_new_bal NUMERIC(30,6);
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

    IF v_decision = 'PAY' THEN
        IF v_clean_ref IS NULL THEN
            RAISE EXCEPTION 'رقم الحوالة المرجعي مطلوب لاعتماد صرف السحب.';
        END IF;
        IF v_clean_receipt IS NULL THEN
            RAISE EXCEPTION 'إرفاق صورة إيصال التحويل إلزامي قبل تأكيد صرف السحب.';
        END IF;
    ELSE
        IF v_clean_reason IS NULL THEN
            RAISE EXCEPTION 'سبب الرفض مطلوب لإرجاع الرصيد إلى المستفيد.';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_withdrawal_' || p_withdrawal_id::text));

    SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'طلب السحب غير موجود.';
    END IF;

    v_amount := ROUND(COALESCE(v_w.amount, v_w.amount_units, 0), 6);
    v_fee := ROUND(COALESCE(v_w.fee, v_w.fee_units, 0), 6);
    v_net := ROUND(COALESCE(v_w.net_amount, v_w.net_units, GREATEST(0, v_amount - v_fee)), 6);

    IF UPPER(v_w.status) IN ('PAID', 'REJECTED') THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'withdrawalId', v_w.id,
            'status', UPPER(v_w.status),
            'transactionId', v_w.ledger_settlement_transaction_id
        );
    END IF;

    SELECT * INTO v_reserved_acc FROM public.financial_accounts WHERE account_code = 'WITHDRAWAL-RESERVED' LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'حساب WITHDRAWAL-RESERVED غير موجود.';
    END IF;

    IF v_decision = 'PAY' THEN
        SELECT * INTO v_settled_acc
        FROM public.financial_accounts
        WHERE account_code IN ('PLATFORM-CASH-VAULT', 'WITHDRAWAL-SETTLED')
        ORDER BY CASE WHEN account_code = 'PLATFORM-CASH-VAULT' THEN 1 ELSE 2 END
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'حساب تسوية السحب أو الخزينة النقدية غير موجود.';
        END IF;

        v_entries := jsonb_build_array(
            jsonb_build_object('account_id', v_reserved_acc.id, 'side', 'debit', 'amount_units', v_amount, 'memo', 'إقفال التزام السحب المرجع ' || v_clean_ref),
            jsonb_build_object('account_id', v_settled_acc.id, 'side', 'credit', 'amount_units', v_net, 'memo', 'صرف حوالة السحب مرجع ' || v_clean_ref)
        );

        IF v_fee > 0 THEN
            SELECT * INTO v_rev_services_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-REVENUE-SERVICES' LIMIT 1;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'حساب PLATFORM-REVENUE-SERVICES غير موجود.';
            END IF;
            v_entries := v_entries || jsonb_build_array(
                jsonb_build_object('account_id', v_rev_services_acc.id, 'side', 'credit', 'amount_units', v_fee, 'memo', 'رسوم خدمة السحب - مرجع ' || v_clean_ref)
            );
        END IF;

        v_tx_id := public.post_ledger_transaction(
            p_transaction_type := 'WITHDRAWAL_PAYOUT',
            p_idempotency_key := 'WITHDRAWAL-PAY:' || v_w.id::text,
            p_reference := 'WITHDRAWAL:' || v_w.id::text,
            p_metadata := jsonb_build_object(
                'withdrawal_id', v_w.id,
                'user_id', v_w.user_id,
                'transfer_reference', v_clean_ref,
                'receipt_url', v_clean_receipt,
                'amount_units', v_amount,
                'fee_units', v_fee,
                'net_units', v_net,
                'provider_fee_units', v_provider_fee,
                'description', 'صرف حوالة السحب المرجع: ' || v_clean_ref
            ),
            p_entries := v_entries
        );

        UPDATE public.withdrawal_requests
        SET status = 'PAID',
            transfer_reference = v_clean_ref,
            receipt_url = v_clean_receipt,
            receipt_object_path = v_clean_receipt,
            admin_id = v_admin_id,
            processed_at = v_now,
            ledger_settlement_transaction_id = v_tx_id
        WHERE id = v_w.id;

        INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
        VALUES (
            v_w.user_id,
            'تم تحويل مبلغ السحب بنجاح',
            'تم صرف حوالة السحب بقيمة ' || v_net || ' ر.ي بنجاح. رقم المرجع: ' || v_clean_ref,
            'WITHDRAWAL_PAID',
            false,
            v_now
        );

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', false,
            'withdrawalId', v_w.id,
            'status', 'PAID',
            'transactionId', v_tx_id,
            'transferReference', v_clean_ref,
            'receiptUrl', v_clean_receipt
        );
    ELSE
        SELECT * INTO v_wallet_acc
        FROM public.financial_accounts
        WHERE owner_user_id = v_w.user_id AND account_type = 'wallet'
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'محفظة المستخدم غير موجودة لاسترداد المبلغ.';
        END IF;

        v_tx_id := public.post_ledger_transaction(
            p_transaction_type := 'WITHDRAWAL_REFUND',
            p_idempotency_key := 'WITHDRAWAL-REFUND:' || v_w.id::text,
            p_reference := 'WITHDRAWAL:' || v_w.id::text,
            p_metadata := jsonb_build_object(
                'withdrawal_id', v_w.id,
                'user_id', v_w.user_id,
                'reason', v_clean_reason,
                'amount_units', v_amount,
                'description', 'إرجاع رصيد طلب سحب مرفوض: ' || v_clean_reason
            ),
            p_entries := jsonb_build_array(
                jsonb_build_object('account_id', v_reserved_acc.id, 'side', 'debit', 'amount_units', v_amount, 'memo', 'إلغاء حجز سحب مرفوض'),
                jsonb_build_object('account_id', v_wallet_acc.id, 'side', 'credit', 'amount_units', v_amount, 'memo', 'إرجاع مبلغ سحب مرفوض: ' || v_clean_reason)
            )
        );

        UPDATE public.withdrawal_requests
        SET status = 'REJECTED',
            rejection_reason = v_clean_reason,
            admin_id = v_admin_id,
            processed_at = v_now,
            ledger_settlement_transaction_id = v_tx_id
        WHERE id = v_w.id;

        INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
        VALUES (
            v_w.user_id,
            'تم رفض طلب السحب وإرجاع الرصيد',
            'تم رفض طلب السحب بقيمة ' || v_amount || ' ر.ي وإعادة المبلغ بالكامل إلى محفظتك. السبب: ' || v_clean_reason,
            'WITHDRAWAL_REJECTED',
            false,
            v_now
        );

        SELECT balance_units INTO v_wallet_new_bal FROM public.financial_accounts WHERE id = v_wallet_acc.id;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', false,
            'withdrawalId', v_w.id,
            'status', 'REJECTED',
            'transactionId', v_tx_id,
            'newAvailableBalance', v_wallet_new_bal
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_withdrawal_ledger(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal_ledger(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_withdrawal_ledger(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
