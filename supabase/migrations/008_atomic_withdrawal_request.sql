-- ==============================================================================
-- Migration 008: Atomic Withdrawal Request & Idempotency Stored Procedure
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- ==============================================================================

-- 1. Idempotency Table for Withdrawal Requests
CREATE TABLE IF NOT EXISTS public.withdrawal_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    withdrawal_id UUID,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, idempotency_key)
);

-- 2. Atomic Withdrawal Reservation PL/pgSQL Function
CREATE OR REPLACE FUNCTION public.reserve_withdrawal(
    p_user_id UUID,
    p_method TEXT,
    p_amount NUMERIC,
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
    v_avail_bal NUMERIC;
    v_pending_bal NUMERIC;
    v_new_avail NUMERIC;
    v_new_pending NUMERIC;
    v_fee NUMERIC;
    v_net_amount NUMERIC;
    v_withdrawal_id UUID := gen_random_uuid();
    v_now TIMESTAMPTZ := NOW();
    v_min_limit NUMERIC := 1000; -- Default min limit
    v_max_limit NUMERIC := 500000; -- Default max limit
    v_idempotency_record RECORD;
    v_result JSONB;
BEGIN
    -- 1. Input Validations
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'معرف المستخدم غير محدد.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'مبلغ السحب يجب أن يكون رقماً موجباً أكبر من صفر.';
    END IF;

    IF p_beneficiary_name IS NULL OR TRIM(p_beneficiary_name) = '' THEN
        RAISE EXCEPTION 'اسم المستفيد التجاري أو الشخصي مطلوب.';
    END IF;

    IF p_phone_number IS NULL OR TRIM(p_phone_number) = '' THEN
        RAISE EXCEPTION 'رقم كشف الحساب أو الهاتف المحول إليه مطلوب.';
    END IF;

    -- Fetch dynamic platform limits if configured
    SELECT 
        COALESCE((setting_value->>'min_withdrawal_yer')::numeric, 1000),
        COALESCE((setting_value->>'max_withdrawal_yer')::numeric, 500000)
    INTO v_min_limit, v_max_limit
    FROM public.platform_settings
    WHERE setting_key = 'withdrawal_limits'
    LIMIT 1;

    IF p_amount < v_min_limit THEN
        RAISE EXCEPTION 'المبلغ المطلوب أقل من الحد الأدنى المسموح به للسحب (% ر.ي).', v_min_limit;
    END IF;

    IF p_amount > v_max_limit THEN
        RAISE EXCEPTION 'المبلغ المطلوب يتجاوز الحد الأقصى المسموح به للسحب (% ر.ي).', v_max_limit;
    END IF;

    -- 2. Idempotency Check
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        SELECT * INTO v_idempotency_record
        FROM public.withdrawal_idempotency_keys
        WHERE user_id = p_user_id AND idempotency_key = TRIM(p_idempotency_key);

        IF FOUND THEN
            -- Verify parameter matching
            IF v_idempotency_record.amount <> p_amount THEN
                RAISE EXCEPTION 'مفتاح منع التكرار مستخدم سابقاً بمبلغ مختلف.';
            END IF;

            RETURN v_idempotency_record.response_payload;
        END IF;
    END IF;

    -- 3. Lock Wallet Row for Update
    SELECT 
        COALESCE(available_balance, balance, 0),
        COALESCE(pending_balance, 0)
    INTO v_avail_bal, v_pending_bal
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_avail_bal IS NULL THEN
        RAISE EXCEPTION 'محفظة المستخدم غير موجودة في قاعدة البيانات.';
    END IF;

    IF v_avail_bal < p_amount THEN
        RAISE EXCEPTION 'رصيدك المتاح غير كافٍ لطلب سحب هذا المبلغ.';
    END IF;

    -- 4. Calculate Fee and Balances
    v_fee := ROUND(p_amount * 0.015, 2); -- 1.5% platform fee
    v_net_amount := p_amount - v_fee;
    v_new_avail := v_avail_bal - p_amount;
    v_new_pending := v_pending_bal + p_amount;

    -- 5. Update Wallet Balances
    UPDATE public.wallets
    SET 
        available_balance = v_new_avail,
        balance = v_new_avail,
        pending_balance = v_new_pending,
        updated_at = v_now
    WHERE user_id = p_user_id;

    -- 6. Insert Withdrawal Request
    INSERT INTO public.withdrawal_requests (
        id, user_id, method, amount, fee, net_amount, beneficiary_name, phone_number, account_number, status, created_at
    ) VALUES (
        v_withdrawal_id, p_user_id, UPPER(TRIM(p_method)), p_amount, v_fee, v_net_amount, TRIM(p_beneficiary_name), TRIM(p_phone_number), NULLIF(TRIM(p_account_number), ''), 'PENDING', v_now
    );

    -- 7. Insert Wallet Transaction
    INSERT INTO public.wallet_transactions (
        id, user_id, type, amount, previous_balance, new_balance, status, reference_id, description, created_at
    ) VALUES (
        gen_random_uuid(), p_user_id, 'WITHDRAWAL_REQUEST', -p_amount, v_avail_bal, v_new_avail, 'COMPLETED', v_withdrawal_id::text, 'حجز رصيد لطلب سحب عبر ' || TRIM(p_method), v_now
    );

    -- 8. Prepare JSON Response Payload
    v_result := jsonb_build_object(
        'success', true,
        'withdrawalId', v_withdrawal_id,
        'amount', p_amount,
        'fee', v_fee,
        'netAmount', v_net_amount,
        'status', 'PENDING',
        'newAvailableBalance', v_new_avail,
        'newPendingBalance', v_new_pending,
        'timestamp', v_now
    );

    -- 9. Record Idempotency Key if provided
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        INSERT INTO public.withdrawal_idempotency_keys (
            idempotency_key, user_id, amount, withdrawal_id, status, response_payload, created_at
        ) VALUES (
            TRIM(p_idempotency_key), p_user_id, p_amount, v_withdrawal_id, 'COMPLETED', v_result, v_now
        );
    END IF;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal TO service_role;
