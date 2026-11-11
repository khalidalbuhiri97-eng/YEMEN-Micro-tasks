-- ==============================================================================
-- KASB YEMEN PLATFORM (كسب اليمن للمهام المصغرة)
-- Versioned Migration: 003_supabase_production_ledger_and_auth.sql
-- Production Auth Trigger Fixes & Atomic Task Budget Allocation RPC
-- ==============================================================================

-- 1. FIX AUTH TRIGGER: REPLACE HARDCODED FALLBACK PHONE NUMBER WITH DYNAMIC UNIQUE IDENTIFIER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_ref_code TEXT;
    v_role TEXT := 'user';
    v_phone TEXT;
    v_full_name TEXT;
BEGIN
    -- Check if this is an authorized owner administrator
    IF LOWER(COALESCE(NEW.email, '')) IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com') THEN
        v_role := 'admin';
    END IF;

    -- Generate random 8-character referral code
    v_ref_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    
    -- Extract phone cleanly without static default phone numbers
    v_phone := COALESCE(
        NEW.raw_user_meta_data->>'phone',
        NEW.phone,
        '967' || SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 9)
    );
    
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        'مستخدم جديد'
    );

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
    ) ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE public.profiles.role END;

    -- Insert Initial Empty Wallet (0 YER)
    INSERT INTO public.wallets (
        user_id,
        available_balance,
        pending_balance,
        total_earned,
        total_withdrawn,
        currency,
        wallet_address
    ) VALUES (
        NEW.id,
        0,
        0,
        0,
        0,
        'YER',
        'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(NEW.id::text, 'sha256'), 'hex'), 1, 12))
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

-- Re-bind auth trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. ATOMIC POSTGRESQL RPC FUNCTION FOR CREATING TASK WITH LEDGER BUDGET RESERVATION
CREATE OR REPLACE FUNCTION public.create_task_with_ledger_transaction(
    p_title TEXT,
    p_description TEXT,
    p_category TEXT,
    p_reward_yer BIGINT,
    p_total_quantity INT,
    p_time_estimate_minutes INT DEFAULT 10,
    p_steps JSONB DEFAULT '[]'::jsonb,
    p_proof_requirements JSONB DEFAULT '{"require_image": true, "require_text": true}'::jsonb,
    p_admin_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_admin_role TEXT;
    v_total_budget BIGINT;
    v_task_id UUID;
    v_treasury_account_id UUID;
    v_escrow_account_id UUID;
    v_tx_id UUID;
    v_existing_task RECORD;
BEGIN
    -- Idempotency Check
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key != '' THEN
        SELECT id INTO v_tx_id FROM public.ledger_transactions WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            SELECT * INTO v_existing_task FROM public.tasks WHERE id::text = (
                SELECT reference_id FROM public.ledger_transactions WHERE id = v_tx_id
            );
            IF FOUND THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'is_duplicate', true,
                    'task', row_to_json(v_existing_task)::jsonb
                );
            END IF;
        END IF;
    END IF;

    -- Validate Caller Authorization if admin_id is provided
    IF p_admin_id IS NOT NULL THEN
        SELECT role INTO v_admin_role FROM public.profiles WHERE id = p_admin_id;
        IF v_admin_role IS NULL OR v_admin_role != 'admin' THEN
            RAISE EXCEPTION 'غير مصرح: يجب أن يكون منشئ المهمة مديراً للنظام.';
        END IF;
    END IF;

    -- Validate Inputs
    IF p_reward_yer <= 0 THEN
        RAISE EXCEPTION 'مكافأة المهمة يجب أن تكون أكبر من 0 ريال.';
    END IF;
    IF p_total_quantity <= 0 THEN
        RAISE EXCEPTION 'كمية التنفيذ للمهمة يجب أن تكون أكبر من 0.';
    END IF;

    v_total_budget := p_reward_yer * p_total_quantity;
    v_task_id := uuid_generate_v4();

    -- Ensure System Treasury and Escrow Accounts Exist
    SELECT id INTO v_treasury_account_id FROM public.wallet_accounts WHERE name = 'SYSTEM_TREASURY_MAIN';
    IF v_treasury_account_id IS NULL THEN
        INSERT INTO public.wallet_accounts (name, account_type)
        VALUES ('SYSTEM_TREASURY_MAIN', 'TREASURY')
        RETURNING id INTO v_treasury_account_id;
    END IF;

    SELECT id INTO v_escrow_account_id FROM public.wallet_accounts WHERE name = 'TASK_ESCROW_POOL';
    IF v_escrow_account_id IS NULL THEN
        INSERT INTO public.wallet_accounts (name, account_type)
        VALUES ('TASK_ESCROW_POOL', 'ESCROW')
        RETURNING id INTO v_escrow_account_id;
    END IF;

    -- Create Task Row
    INSERT INTO public.tasks (
        id,
        title,
        description,
        category,
        reward_yer,
        total_quantity,
        completed_quantity,
        max_per_user,
        budget_yer,
        budget_spent_yer,
        steps,
        proof_requirements,
        time_estimate_minutes,
        status,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        v_task_id,
        p_title,
        p_description,
        p_category,
        p_reward_yer,
        p_total_quantity,
        0,
        1,
        v_total_budget,
        0,
        p_steps,
        p_proof_requirements,
        p_time_estimate_minutes,
        'ACTIVE',
        p_admin_id,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    );

    -- Create Double-Entry Ledger Transaction for Task Budget Allocation
    INSERT INTO public.ledger_transactions (
        transaction_type,
        reference_id,
        idempotency_key,
        description,
        created_by
    ) VALUES (
        'TASK_BUDGET_RESERVATION',
        v_task_id::text,
        p_idempotency_key,
        'حجز ميزانية المهمة الجديدة: ' || p_title,
        p_admin_id
    ) RETURNING id INTO v_tx_id;

    -- Debit System Treasury (Transfer out to Escrow)
    INSERT INTO public.ledger_entries (
        transaction_id,
        account_id,
        debit_amount,
        credit_amount
    ) VALUES (
        v_tx_id,
        v_treasury_account_id,
        v_total_budget,
        0
    );

    -- Credit Task Escrow Pool
    INSERT INTO public.ledger_entries (
        transaction_id,
        account_id,
        debit_amount,
        credit_amount
    ) VALUES (
        v_tx_id,
        v_escrow_account_id,
        0,
        v_total_budget
    );

    -- Log Admin Audit Entry if admin_id is set
    IF p_admin_id IS NOT NULL THEN
        INSERT INTO public.admin_logs (
            admin_id,
            action,
            target_type,
            target_id,
            details
        ) VALUES (
            p_admin_id,
            'CREATE_TASK',
            'TASK',
            v_task_id::text,
            jsonb_build_object(
                'title', p_title,
                'total_budget', v_total_budget,
                'reward_yer', p_reward_yer,
                'total_quantity', p_total_quantity
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'task_id', v_task_id,
        'transaction_id', v_tx_id,
        'total_budget', v_total_budget,
        'task', jsonb_build_object(
            'id', v_task_id,
            'title', p_title,
            'description', p_description,
            'category', p_category,
            'rewardYer', p_reward_yer,
            'totalQuantity', p_total_quantity,
            'completedQuantity', 0,
            'budgetYer', v_total_budget,
            'budgetSpentYer', 0,
            'status', 'ACTIVE',
            'createdBy', p_admin_id,
            'createdAt', timezone('utc'::text, now())
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
