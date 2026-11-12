-- ==============================================================================
-- Migration 009: Secure Atomic Wallet Transfer & Restricted RPC Permissions
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- ==============================================================================

-- 1. Ensure notes column exists on transfer_idempotency_keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'transfer_idempotency_keys' 
          AND column_name = 'notes'
    ) THEN
        ALTER TABLE public.transfer_idempotency_keys ADD COLUMN notes TEXT;
    END IF;
END $$;

-- 2. Check duplicate idempotency keys before creating UNIQUE constraint
DO $$
DECLARE
    v_duplicate_count INT;
BEGIN
    SELECT COUNT(*) INTO v_duplicate_count
    FROM (
        SELECT sender_id, idempotency_key
        FROM public.transfer_idempotency_keys
        WHERE sender_id IS NOT NULL AND idempotency_key IS NOT NULL
        GROUP BY sender_id, idempotency_key
        HAVING COUNT(*) > 1
    ) dupes;

    IF v_duplicate_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION_HALTED: يوجد عدد % سجلات مكررة في جدول transfer_idempotency_keys. يجب مراجعتها وحلها يدوياً قبل تطبيق القيد.', v_duplicate_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'transfer_idempotency_keys'
          AND constraint_name = 'transfer_idempotency_sender_key_unique'
    ) THEN
        ALTER TABLE public.transfer_idempotency_keys 
        ADD CONSTRAINT transfer_idempotency_sender_key_unique UNIQUE (sender_id, idempotency_key);
    END IF;
END $$;

-- 3. Secure PL/pgSQL Function with Strict Amount Validation, Double Lock Re-verification & Row Count Checks
CREATE OR REPLACE FUNCTION public.transfer_wallet_balance(
    p_sender_id UUID,
    p_recipient_address_or_id TEXT,
    p_amount NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_recipient_id UUID;
    v_recipient_address TEXT;
    v_sender_address TEXT;
    v_sender_avail NUMERIC;
    v_recipient_avail NUMERIC;
    v_new_sender_avail NUMERIC;
    v_new_recipient_avail NUMERIC;
    v_transfer_group_id UUID := gen_random_uuid();
    v_now TIMESTAMPTZ := NOW();
    v_idempotency_record RECORD;
    v_result JSONB;
    v_first_id UUID;
    v_second_id UUID;
    v_clean_notes TEXT := NULLIF(TRIM(p_notes), '');
    v_rows_updated INT := 0;
BEGIN
    -- 1. Validate Basic Inputs and Amount Integrity
    IF p_sender_id IS NULL THEN
        RAISE EXCEPTION 'معرف المرسل غير محدد.';
    END IF;

    IF p_amount IS NULL OR NOT (p_amount > 0) OR p_amount = 'Infinity'::numeric OR p_amount = '-Infinity'::numeric THEN
        RAISE EXCEPTION 'المبلغ المحدد غير صالح للتحويل. يجب أن يكون رقماً موجباً غير منتهٍ وأكبر من صفر.';
    END IF;

    IF p_recipient_address_or_id IS NULL OR TRIM(p_recipient_address_or_id) = '' THEN
        RAISE EXCEPTION 'عنوان محفظة المستلم مطلوب.';
    END IF;

    -- 2. Resolve Recipient Wallet ID
    SELECT user_id, wallet_address INTO v_recipient_id, v_recipient_address
    FROM public.wallets
    WHERE (wallet_address = UPPER(TRIM(p_recipient_address_or_id)) OR user_id::text = TRIM(p_recipient_address_or_id))
    LIMIT 1;

    IF v_recipient_id IS NULL THEN
        RAISE EXCEPTION 'عنوان محفظة المستلم غير موجود في النظام.';
    END IF;

    IF p_sender_id = v_recipient_id THEN
        RAISE EXCEPTION 'لا يمكنك تحويل الرصيد إلى نفس حسابك الشخصي.';
    END IF;

    -- 3. Strict Idempotency Check with Transaction-Level Advisory Lock (pg_advisory_xact_lock)
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_sender_id::text || '_' || TRIM(p_idempotency_key)));

        SELECT * INTO v_idempotency_record
        FROM public.transfer_idempotency_keys
        WHERE sender_id = p_sender_id AND idempotency_key = TRIM(p_idempotency_key);

        IF FOUND THEN
            -- Verify parameter matching (recipient, amount, or notes)
            IF v_idempotency_record.recipient_id <> v_recipient_id THEN
                RAISE EXCEPTION 'مفتاح منع التكرار مستخدم سابقاً لمستلم مختلف.';
            END IF;

            IF v_idempotency_record.amount <> p_amount THEN
                RAISE EXCEPTION 'مفتاح منع التكرار مستخدم سابقاً بمبلغ مختلف.';
            END IF;

            IF COALESCE(v_idempotency_record.notes, '') <> COALESCE(v_clean_notes, '') THEN
                RAISE EXCEPTION 'مفتاح منع التكرار مستخدم سابقاً بملاحظات مختلفة.';
            END IF;

            -- Exact match -> return stored response payload without re-executing debit/credit
            RETURN v_idempotency_record.response_payload;
        END IF;
    END IF;

    -- 4. Deterministic Row Locking (FOR UPDATE)
    IF p_sender_id < v_recipient_id THEN
        v_first_id := p_sender_id;
        v_second_id := v_recipient_id;
    ELSE
        v_first_id := v_recipient_id;
        v_second_id := p_sender_id;
    END IF;

    PERFORM id FROM public.wallets WHERE user_id = v_first_id FOR UPDATE;
    PERFORM id FROM public.wallets WHERE user_id = v_second_id FOR UPDATE;

    -- Re-fetch and verify sender wallet AFTER locking
    SELECT wallet_address, COALESCE(available_balance, balance, 0)
    INTO v_sender_address, v_sender_avail
    FROM public.wallets
    WHERE user_id = p_sender_id;

    IF v_sender_address IS NULL AND v_sender_avail IS NULL THEN
        RAISE EXCEPTION 'محفظة المرسل غير موجودة في قاعدة البيانات.';
    END IF;

    IF v_sender_avail < p_amount THEN
        RAISE EXCEPTION 'رصيدك المتاح غير كافٍ لإتمام عملية التحويل.';
    END IF;

    -- Re-fetch and verify recipient wallet AFTER locking
    SELECT COALESCE(available_balance, balance, 0)
    INTO v_recipient_avail
    FROM public.wallets
    WHERE user_id = v_recipient_id;

    IF v_recipient_avail IS NULL THEN
        RAISE EXCEPTION 'محفظة المستلم غير موجودة في قاعدة البيانات.';
    END IF;

    -- 5. Calculate New Balances
    v_new_sender_avail := v_sender_avail - p_amount;
    v_new_recipient_avail := v_recipient_avail + p_amount;

    -- Update Sender Wallet and verify exactly 1 row updated
    UPDATE public.wallets
    SET 
        available_balance = v_new_sender_avail,
        balance = v_new_sender_avail,
        total_transferred = COALESCE(total_transferred, 0) + p_amount,
        updated_at = v_now
    WHERE user_id = p_sender_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated <> 1 THEN
        RAISE EXCEPTION 'فشل تحديث محفظة المرسل: لم يتم تعديل أي صف.';
    END IF;

    -- Update Recipient Wallet and verify exactly 1 row updated
    UPDATE public.wallets
    SET 
        available_balance = v_new_recipient_avail,
        balance = v_new_recipient_avail,
        total_earned = COALESCE(total_earned, 0) + p_amount,
        updated_at = v_now
    WHERE user_id = v_recipient_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated <> 1 THEN
        RAISE EXCEPTION 'فشل تحديث محفظة المستلم: لم يتم تعديل أي صف.';
    END IF;

    -- 6. Insert Debit and Credit Wallet Transactions
    INSERT INTO public.wallet_transactions (
        id, user_id, type, amount, previous_balance, new_balance, status, reference_id, description, created_at
    ) VALUES
    (
        gen_random_uuid(), p_sender_id, 'WALLET_TRANSFER_SENT', -p_amount, v_sender_avail, v_new_sender_avail, 'COMPLETED', v_transfer_group_id::text, COALESCE(v_clean_notes, 'تحويل إلى ' || COALESCE(v_recipient_address, p_recipient_address_or_id)), v_now
    ),
    (
        gen_random_uuid(), v_recipient_id, 'WALLET_TRANSFER_RECEIVED', p_amount, v_recipient_avail, v_new_recipient_avail, 'COMPLETED', v_transfer_group_id::text, COALESCE(v_clean_notes, 'استلام تحويل من ' || COALESCE(v_sender_address, p_sender_id::text)), v_now
    );

    -- 7. Build Result JSON Payload
    v_result := jsonb_build_object(
        'success', true,
        'transferId', v_transfer_group_id,
        'amount', p_amount,
        'senderId', p_sender_id,
        'recipientId', v_recipient_id,
        'newAvailableBalance', v_new_sender_avail,
        'recipientNewAvailableBalance', v_new_recipient_avail,
        'timestamp', v_now
    );

    -- 8. Record Idempotency Entry
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        INSERT INTO public.transfer_idempotency_keys (
            idempotency_key, sender_id, recipient_id, amount, notes, status, response_payload, created_at
        ) VALUES (
            TRIM(p_idempotency_key), p_sender_id, v_recipient_id, p_amount, v_clean_notes, 'COMPLETED', v_result, v_now
        );
    END IF;

    RETURN v_result;
END;
$$;

-- 4. REVOKE ALL FROM PUBLIC / ANON / AUTHENTICATED & GRANT EXECUTE ONLY TO SERVICE_ROLE
REVOKE ALL ON FUNCTION public.transfer_wallet_balance(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_wallet_balance(UUID, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
