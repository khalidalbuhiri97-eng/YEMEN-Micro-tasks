-- ==============================================================================
-- Migration 024: Advertiser Campaign Approval Gate, Configurable Fee Policy,
--                Deferred Fee Recognition & Receipt-Backed Deposit Submission
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Platform Settings: campaign_fee_policy JSONB (dual KV + column support)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.platform_settings') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'advertiser_campaign_fee_percentage'
        ) THEN
            ALTER TABLE public.platform_settings
                ADD COLUMN IF NOT EXISTS campaign_fee_policy JSONB NOT NULL DEFAULT '{"defaultPercentage": 20, "minFeeUnits": 0, "categoryFees": {}}'::jsonb;

            UPDATE public.platform_settings
            SET campaign_fee_policy = jsonb_build_object(
                'defaultPercentage', COALESCE(advertiser_campaign_fee_percentage, 20),
                'minFeeUnits', COALESCE((campaign_fee_policy->>'minFeeUnits')::numeric(30,6), 0),
                'categoryFees', COALESCE(campaign_fee_policy->'categoryFees', '{}'::jsonb)
            );
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
        ) THEN
            INSERT INTO public.platform_settings (setting_key, setting_value)
            VALUES (
                'campaign_fee_policy',
                jsonb_build_object('defaultPercentage', 20, 'minFeeUnits', 0, 'categoryFees', '{}'::jsonb)
            )
            ON CONFLICT (setting_key) DO NOTHING;
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Extend campaigns table with Approval Gate & Policy Snapshot columns
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_chk RECORD;
BEGIN
    IF to_regclass('public.campaigns') IS NOT NULL THEN
        ALTER TABLE public.campaigns
            ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS approved_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL,
            ADD COLUMN IF NOT EXISTS min_fee_applied BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS fee_policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

        -- Drop existing status check constraint cleanly & re-create with pending_approval & rejected
        FOR v_chk IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'public.campaigns'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ~* 'status'
        LOOP
            EXECUTE format('ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS %I', v_chk.conname);
        END LOOP;

        ALTER TABLE public.campaigns
            ADD CONSTRAINT campaigns_status_check CHECK (
                status IN ('pending_approval', 'pending_start', 'active', 'paused', 'completed', 'cancelled', 'rejected')
            );

        ALTER TABLE public.campaigns
            ALTER COLUMN status SET DEFAULT 'pending_approval';
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Helper: get_campaign_fee_policy()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_campaign_fee_policy()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_policy JSONB := jsonb_build_object('defaultPercentage', 20, 'minFeeUnits', 0, 'categoryFees', '{}'::jsonb);
    v_default NUMERIC(10,4);
    v_row_policy JSONB;
BEGIN
    IF to_regclass('public.platform_settings') IS NULL THEN
        RETURN v_policy;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'campaign_fee_policy'
    ) THEN
        SELECT campaign_fee_policy, advertiser_campaign_fee_percentage
        INTO v_row_policy, v_default
        FROM public.platform_settings
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;

        IF v_row_policy IS NOT NULL THEN
            v_policy := v_row_policy;
        ELSIF v_default IS NOT NULL THEN
            v_policy := jsonb_build_object('defaultPercentage', v_default, 'minFeeUnits', 0, 'categoryFees', '{}'::jsonb);
        END IF;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
    ) THEN
        SELECT setting_value INTO v_row_policy
        FROM public.platform_settings
        WHERE setting_key = 'campaign_fee_policy'
        LIMIT 1;

        IF v_row_policy IS NOT NULL AND jsonb_typeof(v_row_policy) = 'object' THEN
            v_policy := v_row_policy;
        ELSE
            RETURN jsonb_build_object(
                'defaultPercentage', public.get_advertiser_campaign_fee_percentage(),
                'minFeeUnits', 0,
                'categoryFees', '{}'::jsonb
            );
        END IF;
    END IF;

    RETURN v_policy;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Atomic RPC: create_funded_campaign (NUMERIC(30,6), policy snapshot, pending_approval)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_funded_campaign(TEXT, TEXT, TEXT, BIGINT, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS public.create_funded_campaign(TEXT, TEXT, TEXT, NUMERIC, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.create_funded_campaign(
    p_title TEXT,
    p_description TEXT,
    p_category TEXT DEFAULT 'app_testing',
    p_reward_units NUMERIC DEFAULT NULL,
    p_slots INTEGER DEFAULT NULL,
    p_creation_key TEXT DEFAULT NULL,
    p_time_estimate_minutes INTEGER DEFAULT 10,
    p_proof_requirements JSONB DEFAULT '{"requireImage": true, "requireText": true}'::jsonb,
    p_deadline_at TIMESTAMPTZ DEFAULT NULL,
    p_advertiser_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_adv_id UUID := COALESCE(p_advertiser_id, auth.uid());
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_profile RECORD;
    v_adv_status TEXT;
    v_adv_role TEXT;
    v_existing RECORD;
    v_clean_title TEXT := NULLIF(TRIM(COALESCE(p_title, '')), '');
    v_clean_desc TEXT := NULLIF(TRIM(COALESCE(p_description, '')), '');
    v_clean_cat TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_category, '')), ''), 'app_testing');
    v_key TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_creation_key, '')), ''), 'CAMP-' || gen_random_uuid()::text);
    v_policy JSONB;
    v_fee_pct NUMERIC(10,4);
    v_min_fee NUMERIC(30,6);
    v_raw_fee NUMERIC(30,6);
    v_min_applied BOOLEAN := FALSE;
    v_reward NUMERIC(30,6);
    v_budget NUMERIC(30,6);
    v_fee NUMERIC(30,6);
    v_total NUMERIC(30,6);
    v_wallet RECORD;
    v_wallet_acc RECORD;
    v_budget_escrow_id UUID;
    v_fee_escrow_id UUID;
    v_campaign_id UUID := gen_random_uuid();
    v_tx_id UUID;
    v_wallet_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_adv_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_service AND v_caller_id <> v_adv_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized campaign creator' USING ERRCODE = '42501';
    END IF;

    IF v_clean_title IS NULL OR v_clean_desc IS NULL THEN
        RAISE EXCEPTION 'عنوان الحملة والوصف مطلوبان.';
    END IF;
    IF p_reward_units IS NULL OR p_reward_units <= 0 OR p_slots IS NULL OR p_slots <= 0 THEN
        RAISE EXCEPTION 'سعر المهمة وعدد المهمات يجب أن يكونا أكبر من صفر.';
    END IF;
    IF p_reward_units <> ROUND(p_reward_units, 6) THEN
        RAISE EXCEPTION 'سعر المهمة يقبل بحد أقصى 6 منازل عشرية.';
    END IF;

    v_reward := ROUND(p_reward_units, 6);

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_adv_id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ملف المعلن غير موجود.';
    END IF;

    v_adv_role := LOWER(COALESCE(v_profile.role, 'user'));
    v_adv_status := LOWER(COALESCE(to_jsonb(v_profile)->>'account_status', to_jsonb(v_profile)->>'status', 'active'));

    IF v_adv_role NOT IN ('advertiser', 'admin') THEN
        RAISE EXCEPTION 'هذه الميزة مخصصة لحسابات المعلنين فقط.';
    END IF;
    IF v_adv_role = 'advertiser' AND v_adv_status <> 'active' THEN
        RAISE EXCEPTION 'حساب المعلن قيد المراجعة ولم يتم اعتماده من الإدارة بعد.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('create_campaign_' || v_adv_id::text));

    -- Idempotency check
    SELECT * INTO v_existing
    FROM public.campaigns
    WHERE creation_key = v_key
    LIMIT 1;
    IF FOUND THEN
        SELECT balance_units INTO v_wallet_new_bal
        FROM public.financial_accounts WHERE owner_user_id = v_adv_id AND account_type = 'wallet' LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaign', to_jsonb(v_existing),
            'newWalletBalance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    -- Resolve configurable campaign fee policy & snapshot
    v_policy := public.get_campaign_fee_policy();
    v_fee_pct := COALESCE(
        NULLIF(v_policy->'categoryFees'->>v_clean_cat, '')::NUMERIC(10,4),
        NULLIF(v_policy->>'defaultPercentage', '')::NUMERIC(10,4),
        20.00
    );
    v_min_fee := COALESCE(NULLIF(v_policy->>'minFeeUnits', '')::NUMERIC(30,6), 0);

    v_budget := ROUND(v_reward * p_slots, 6);
    v_raw_fee := ROUND((v_budget * v_fee_pct) / 100.0, 6);
    IF v_min_fee > 0 AND v_raw_fee < v_min_fee THEN
        v_fee := v_min_fee;
        v_min_applied := TRUE;
    ELSE
        v_fee := v_raw_fee;
    END IF;
    v_total := v_budget + v_fee;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_adv_id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'محفظة المعلن غير موجودة.';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب المالي للمعلن غير موجود أو غير نشط.';
    END IF;

    IF COALESCE(v_wallet_acc.balance_units, 0) < v_total THEN
        RAISE EXCEPTION 'INSUFFICIENT_FUNDS: رصيد محفظتك غير كافٍ (% ر.ي) والمطلوب (%) ر.ي. العجز: % ر.ي',
            v_wallet_acc.balance_units, v_total, (v_total - COALESCE(v_wallet_acc.balance_units, 0));
    END IF;

    INSERT INTO public.financial_accounts (
        account_code, account_type, owner_user_id, normal_side, balance_units, status, created_at
    ) VALUES (
        'CAMPAIGN-ESCROW-' || v_campaign_id::text, 'treasury', v_adv_id, 'credit', 0, 'active', v_now
    )
    RETURNING id INTO v_budget_escrow_id;

    INSERT INTO public.financial_accounts (
        account_code, account_type, owner_user_id, normal_side, balance_units, status, created_at
    ) VALUES (
        'CAMPAIGN-FEE-ESCROW-' || v_campaign_id::text, 'treasury', v_adv_id, 'credit', 0, 'active', v_now
    )
    RETURNING id INTO v_fee_escrow_id;

    v_tx_id := public.post_ledger_transaction(
        p_transaction_type := 'CAMPAIGN_FUNDING_RESERVE',
        p_idempotency_key := 'CAMP-FUND:' || v_key,
        p_reference := 'CAMPAIGN:' || v_campaign_id::text,
        p_metadata := jsonb_build_object(
            'campaign_id', v_campaign_id,
            'advertiser_id', v_adv_id,
            'title', v_clean_title,
            'category', v_clean_cat,
            'reward_units', v_reward,
            'slots', p_slots,
            'budget_units', v_budget,
            'fee_percentage', v_fee_pct,
            'min_fee_applied', v_min_applied,
            'fee_units', v_fee,
            'total_units', v_total,
            'description', 'حجز ميزانية ورسوم الحملة الإعلانية (بانتظار اعتماد الإدارة): ' || v_clean_title
        ),
        p_entries := jsonb_build_array(
            jsonb_build_object(
                'account_id', v_wallet_acc.id,
                'side', 'debit',
                'amount_units', v_total,
                'memo', 'حجز تمويل حملة إعلانية: ' || v_clean_title
            ),
            jsonb_build_object(
                'account_id', v_budget_escrow_id,
                'side', 'credit',
                'amount_units', v_budget,
                'memo', 'ضمان مكافآت الحملة (معلق للاعتماد)'
            ),
            jsonb_build_object(
                'account_id', v_fee_escrow_id,
                'side', 'credit',
                'amount_units', v_fee,
                'memo', 'رسوم خدمة يمن تاسك المعلقة (لا تُثبت إيراداً قبل الاعتماد والتشغيل)'
            )
        )
    );

    INSERT INTO public.campaigns (
        id, advertiser_id, title, description, category,
        reward_units, slots, budget_units, fee_percentage, fee_units, total_units,
        min_fee_applied, fee_policy_snapshot,
        status, creation_key, funding_transaction_id,
        budget_escrow_account_id, fee_escrow_account_id,
        time_estimate_minutes, proof_requirements, deadline_at,
        created_at, updated_at
    ) VALUES (
        v_campaign_id, v_adv_id, v_clean_title, v_clean_desc, v_clean_cat,
        v_reward, p_slots, v_budget, v_fee_pct, v_fee, v_total,
        v_min_applied, v_policy,
        'pending_approval', v_key, v_tx_id,
        v_budget_escrow_id, v_fee_escrow_id,
        GREATEST(1, COALESCE(p_time_estimate_minutes, 10)),
        COALESCE(p_proof_requirements, '{"requireImage": true, "requireText": true}'::jsonb),
        p_deadline_at,
        v_now, v_now
    );

    SELECT balance_units INTO v_wallet_new_bal FROM public.financial_accounts WHERE id = v_wallet_acc.id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_campaign_id,
        'status', 'pending_approval',
        'transactionId', v_tx_id,
        'budgetUnits', v_budget,
        'feeUnits', v_fee,
        'feePercentage', v_fee_pct,
        'minFeeApplied', v_min_applied,
        'totalUnits', v_total,
        'newWalletBalance', v_wallet_new_bal
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Admin RPC: approve_advertiser_campaign
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_advertiser_campaign(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_camp RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'صلاحية مدير النظام مطلوبة لاعتماد الحملة الإعلانية.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('campaign_lifecycle_' || p_campaign_id::text));

    SELECT * INTO v_camp FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحملة الإعلانية غير موجودة.';
    END IF;

    IF v_camp.status IN ('pending_start', 'active') AND v_camp.approved_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_camp.id,
            'status', v_camp.status
        );
    END IF;

    IF v_camp.status <> 'pending_approval' THEN
        RAISE EXCEPTION 'لا يمكن اعتماد حملة حالتها الحالية (%)', v_camp.status;
    END IF;

    UPDATE public.campaigns
    SET status = 'pending_start',
        approved_at = v_now,
        approved_by = v_admin_id,
        updated_at = v_now
    WHERE id = p_campaign_id;

    INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
    VALUES (
        v_camp.advertiser_id,
        'تمت الموافقة على حملتك الإعلانية',
        'تم اعتماد حملتك "' || v_camp.title || '" من إدارة المنصة. يمكنك الآن تشغيل ونشر الحملة للجمهور.',
        'CAMPAIGN_APPROVED',
        false,
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_camp.id,
        'status', 'pending_start',
        'approvedAt', v_now,
        'approvedBy', v_admin_id
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Hardened RPC: start_advertiser_campaign
--    - Strictly requires approved_at IS NOT NULL and status = 'pending_start'
--    - Blocks unapproved advertiser self-start (SQLSTATE 42501)
--    - Recognizes campaign fee ONCE into PLATFORM-REVENUE-ADS ONLY when approved + published
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_advertiser_campaign(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_is_admin BOOLEAN := public.is_admin();
    v_camp RECORD;
    v_task_id UUID := gen_random_uuid();
    v_rev_acc RECORD;
    v_fee_tx_id UUID;
    v_per_slot_fee NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('campaign_lifecycle_' || p_campaign_id::text));

    SELECT * INTO v_camp FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحملة الإعلانية غير موجودة.';
    END IF;

    IF NOT v_is_service AND NOT v_is_admin AND v_camp.advertiser_id <> v_caller_id THEN
        RAISE EXCEPTION 'ليس لديك صلاحية تشغيل هذه الحملة.' USING ERRCODE = '42501';
    END IF;

    IF v_camp.status = 'active' AND v_camp.started_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_camp.id,
            'taskId', v_camp.linked_task_id,
            'feeTransactionId', v_camp.fee_revenue_transaction_id
        );
    END IF;

    -- MANDATORY ADMIN APPROVAL GATE
    IF v_camp.approved_at IS NULL OR v_camp.status = 'pending_approval' THEN
        RAISE EXCEPTION 'لا يمكن بدء الحملة قبل مراجعتها واعتمادها من إدارة المنصة.' USING ERRCODE = '42501';
    END IF;

    IF v_camp.status <> 'pending_start' THEN
        RAISE EXCEPTION 'لا يمكن بدء حملة حالتها الحالية (%)', v_camp.status;
    END IF;

    v_per_slot_fee := ROUND(COALESCE(v_camp.fee_units, 0) / GREATEST(1, v_camp.slots), 6);

    -- Create linked live task in public.tasks funded by campaign escrow
    INSERT INTO public.tasks (
        id, title, description, category, reward_units, commission_units,
        slots, completed_quantity, approved_count, total_budget_units, budget_spent_yer,
        time_estimate_minutes, proof_requirements, deadline_at,
        status, escrow_account_id, funding_transaction_id,
        campaign_id, is_external_campaign, created_by, created_at
    ) VALUES (
        v_task_id, v_camp.title, v_camp.description, v_camp.category,
        v_camp.reward_units, v_per_slot_fee,
        v_camp.slots, 0, 0, v_camp.budget_units, 0,
        v_camp.time_estimate_minutes, v_camp.proof_requirements, v_camp.deadline_at,
        'active', v_camp.budget_escrow_account_id, v_camp.funding_transaction_id,
        v_camp.id, true, v_camp.advertiser_id, v_now
    );

    -- Transfer held campaign service fee ONCE to PLATFORM-REVENUE-ADS
    IF COALESCE(v_camp.fee_units, 0) > 0 THEN
        SELECT * INTO v_rev_acc
        FROM public.financial_accounts
        WHERE account_code = 'PLATFORM-REVENUE-ADS' AND LOWER(status) = 'active'
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'حساب إيرادات الإعلانات PLATFORM-REVENUE-ADS غير متوفر.';
        END IF;

        v_fee_tx_id := public.post_ledger_transaction(
            p_transaction_type := 'AD_REVENUE',
            p_idempotency_key := 'CAMPAIGN-FEE-REVENUE:' || v_camp.id::text,
            p_reference := 'CAMPAIGN:' || v_camp.id::text,
            p_metadata := jsonb_build_object(
                'campaign_id', v_camp.id,
                'task_id', v_task_id,
                'advertiser_id', v_camp.advertiser_id,
                'fee_percentage', v_camp.fee_percentage,
                'fee_units', v_camp.fee_units,
                'description', 'استحقاق رسوم منصة يمن تاسك بعد اعتماد وتشغيل الحملة: ' || v_camp.title
            ),
            p_entries := jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_camp.fee_escrow_account_id,
                    'side', 'debit',
                    'amount_units', v_camp.fee_units,
                    'memo', 'تحرير رسوم الخدمة المحتجزة عند انطلاق الحملة'
                ),
                jsonb_build_object(
                    'account_id', v_rev_acc.id,
                    'side', 'credit',
                    'amount_units', v_camp.fee_units,
                    'memo', 'إيراد رسوم حملة إعلانية معتمدة: ' || v_camp.title
                )
            )
        );
    END IF;

    UPDATE public.campaigns
    SET status = 'active',
        linked_task_id = v_task_id,
        fee_revenue_transaction_id = v_fee_tx_id,
        started_at = v_now,
        updated_at = v_now
    WHERE id = v_camp.id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_camp.id,
        'taskId', v_task_id,
        'feeTransactionId', v_fee_tx_id,
        'startedAt', v_now
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Atomic RPC: settle_advertiser_campaign (supports pending_approval reject/cancel)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_advertiser_campaign(
    p_campaign_id UUID,
    p_target_status TEXT DEFAULT 'cancelled',
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_service BOOLEAN := (v_caller_id IS NULL);
    v_is_admin BOOLEAN := public.is_admin();
    v_target TEXT := LOWER(TRIM(COALESCE(p_target_status, 'cancelled')));
    v_camp RECORD;
    v_wallet RECORD;
    v_wallet_acc RECORD;
    v_budget_bal NUMERIC(30,6) := 0;
    v_fee_bal NUMERIC(30,6) := 0;
    v_total_refund NUMERIC(30,6) := 0;
    v_entries JSONB := '[]'::jsonb;
    v_tx_id UUID;
    v_wallet_new_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF v_target NOT IN ('cancelled', 'completed', 'rejected') THEN
        RAISE EXCEPTION 'Invalid settlement status';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('campaign_lifecycle_' || p_campaign_id::text));

    SELECT * INTO v_camp FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحملة الإعلانية غير موجودة.';
    END IF;

    IF NOT v_is_service AND NOT v_is_admin AND v_camp.advertiser_id <> v_caller_id THEN
        RAISE EXCEPTION 'ليس لديك صلاحية تسوية هذه الحملة.' USING ERRCODE = '42501';
    END IF;

    IF v_target = 'rejected' AND NOT v_is_service AND NOT v_is_admin THEN
        RAISE EXCEPTION 'رفض الحملة متاح للإدارة فقط.' USING ERRCODE = '42501';
    END IF;

    IF v_camp.status IN ('cancelled', 'completed', 'rejected') THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_camp.id,
            'status', v_camp.status,
            'refundedUnits', COALESCE(v_camp.refunded_units, 0),
            'transactionId', v_camp.settlement_transaction_id
        );
    END IF;

    SELECT balance_units INTO v_budget_bal FROM public.financial_accounts WHERE id = v_camp.budget_escrow_account_id;
    SELECT balance_units INTO v_fee_bal FROM public.financial_accounts WHERE id = v_camp.fee_escrow_account_id;
    v_budget_bal := GREATEST(0, COALESCE(v_budget_bal, 0));
    -- If campaign never started, refund remaining fee_escrow too; if started, fee already realized
    IF v_camp.started_at IS NULL THEN
        v_fee_bal := GREATEST(0, COALESCE(v_fee_bal, 0));
    ELSE
        v_fee_bal := 0;
    END IF;

    v_total_refund := ROUND(v_budget_bal + v_fee_bal, 6);

    IF v_total_refund > 0 THEN
        SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_camp.advertiser_id LIMIT 1;
        SELECT * INTO v_wallet_acc FROM public.financial_accounts WHERE wallet_id = v_wallet.id AND account_type = 'wallet' LIMIT 1;

        IF v_budget_bal > 0 THEN
            v_entries := v_entries || jsonb_build_array(
                jsonb_build_object('account_id', v_camp.budget_escrow_account_id, 'side', 'debit', 'amount_units', v_budget_bal, 'memo', 'إرجاع متبقي ميزانية الحملة')
            );
        END IF;
        IF v_fee_bal > 0 THEN
            v_entries := v_entries || jsonb_build_array(
                jsonb_build_object('account_id', v_camp.fee_escrow_account_id, 'side', 'debit', 'amount_units', v_fee_bal, 'memo', 'إرجاع رسوم الخدمة لعدم بدء الحملة')
            );
        END IF;
        v_entries := v_entries || jsonb_build_array(
            jsonb_build_object('account_id', v_wallet_acc.id, 'side', 'credit', 'amount_units', v_total_refund, 'memo', 'استرجاع رصيد تسوية الحملة: ' || v_camp.title)
        );

        v_tx_id := public.post_ledger_transaction(
            p_transaction_type := 'CAMPAIGN_ESCROW_REFUND',
            p_idempotency_key := 'CAMP-SETTLE:' || v_camp.id::text,
            p_reference := 'CAMPAIGN:' || v_camp.id::text,
            p_metadata := jsonb_build_object(
                'campaign_id', v_camp.id,
                'advertiser_id', v_camp.advertiser_id,
                'refund_budget_units', v_budget_bal,
                'refund_fee_units', v_fee_bal,
                'total_refund_units', v_total_refund,
                'reason', p_reason,
                'description', COALESCE(p_reason, 'إغلاق وتسوية الحملة الإعلانية وإرجاع المتبقي')
            ),
            p_entries := v_entries
        );
    END IF;

    IF v_camp.linked_task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = CASE WHEN v_target = 'completed' THEN 'completed' ELSE 'cancelled' END
        WHERE id = v_camp.linked_task_id;
    END IF;

    UPDATE public.campaigns
    SET status = v_target,
        refunded_units = v_total_refund,
        settlement_transaction_id = v_tx_id,
        settled_at = v_now,
        rejected_at = CASE WHEN v_target = 'rejected' THEN v_now ELSE rejected_at END,
        rejection_reason = CASE WHEN v_target = 'rejected' THEN COALESCE(NULLIF(TRIM(p_reason), ''), 'تم رفض الحملة من الإدارة') ELSE rejection_reason END,
        updated_at = v_now
    WHERE id = v_camp.id;

    IF v_target = 'rejected' THEN
        INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
        VALUES (
            v_camp.advertiser_id,
            'تم رفض حملتك الإعلانية واسترجاع الرصيد',
            'تم رفض حملتك "' || v_camp.title || '" وإرجاع مبلغ ' || v_total_refund || ' ر.ي إلى محفظتك. السبب: ' || COALESCE(NULLIF(TRIM(p_reason), ''), 'لم يُذكر'),
            'CAMPAIGN_REJECTED',
            false,
            v_now
        );
    END IF;

    SELECT balance_units INTO v_wallet_new_bal
    FROM public.financial_accounts WHERE owner_user_id = v_camp.advertiser_id AND account_type = 'wallet' LIMIT 1;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_camp.id,
        'status', v_target,
        'refundedUnits', v_total_refund,
        'transactionId', v_tx_id,
        'newWalletBalance', COALESCE(v_wallet_new_bal, 0)
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. Upgrade 022 External Account RPCs to NUMERIC(30,6) & Add Advertiser Notification
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_internal_account_transfer(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.execute_internal_account_transfer(
    p_from_financial_account_id UUID,
    p_to_financial_account_id UUID,
    p_amount_units NUMERIC,
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
    v_tx_id UUID;
    v_transfer_id UUID := gen_random_uuid();
    v_key TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''), 'INT-XFER:' || v_transfer_id::text);
    v_existing RECORD;
    v_amt NUMERIC(30,6);
    v_from_bal NUMERIC(30,6);
    v_to_bal NUMERIC(30,6);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية مدير أو مالك النظام مطلوبة للتحويل الداخلي.' USING ERRCODE = '42501';
    END IF;
    IF p_amount_units IS NULL OR p_amount_units <= 0 OR p_amount_units <> ROUND(p_amount_units, 6) THEN
        RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر وبحد أقصى 6 منازل عشرية.';
    END IF;
    IF p_from_financial_account_id = p_to_financial_account_id THEN
        RAISE EXCEPTION 'لا يمكن التحويل إلى الحساب نفسه.';
    END IF;
    v_amt := ROUND(p_amount_units, 6);

    SELECT * INTO v_existing FROM public.external_account_transfers WHERE idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'transferId', v_existing.id, 'transactionId', v_existing.ledger_transaction_id);
    END IF;

    SELECT * INTO v_from_acc FROM public.financial_accounts WHERE id = p_from_financial_account_id;
    SELECT * INTO v_to_acc FROM public.financial_accounts WHERE id = p_to_financial_account_id;
    IF NOT FOUND OR v_from_acc.id IS NULL OR v_to_acc.id IS NULL THEN
        RAISE EXCEPTION 'الحساب المصدر أو الوجهة غير موجود.';
    END IF;

    SELECT * INTO v_from_ext FROM public.external_accounts WHERE financial_account_id = v_from_acc.id LIMIT 1;
    SELECT * INTO v_to_ext FROM public.external_accounts WHERE financial_account_id = v_to_acc.id LIMIT 1;

    v_tx_id := public.post_ledger_transaction(
        p_transaction_type := 'INTERNAL_ACCOUNT_TRANSFER',
        p_idempotency_key := 'INT-XFER:' || v_key,
        p_reference := COALESCE(NULLIF(TRIM(p_reference_number), ''), v_transfer_id::text),
        p_metadata := jsonb_build_object(
            'from_account', v_from_acc.account_code,
            'to_account', v_to_acc.account_code,
            'amount_units', v_amt,
            'reason', p_reason,
            'description', COALESCE(p_reason, 'تحويل داخلي بين حسابات المنصة')
        ),
        p_entries := jsonb_build_array(
            jsonb_build_object('account_id', v_to_acc.id, 'side', 'debit', 'amount_units', v_amt, 'memo', 'استلام تحويل داخلي من ' || COALESCE(v_from_ext.account_name, v_from_acc.account_code)),
            jsonb_build_object('account_id', v_from_acc.id, 'side', 'credit', 'amount_units', v_amt, 'memo', 'تحويل داخلي إلى ' || COALESCE(v_to_ext.account_name, v_to_acc.account_code))
        )
    );

    INSERT INTO public.external_account_transfers (
        id, from_external_account_id, to_external_account_id,
        from_financial_account_id, to_financial_account_id,
        amount_units, reference_number, reason, ledger_transaction_id, idempotency_key, created_by, created_at
    ) VALUES (
        v_transfer_id, v_from_ext.id, v_to_ext.id,
        v_from_acc.id, v_to_acc.id,
        v_amt, NULLIF(TRIM(p_reference_number), ''), p_reason, v_tx_id, v_key, v_actor_id, v_now
    );

    SELECT balance_units INTO v_from_bal FROM public.financial_accounts WHERE id = v_from_acc.id;
    SELECT balance_units INTO v_to_bal FROM public.financial_accounts WHERE id = v_to_acc.id;

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

DROP FUNCTION IF EXISTS public.reconcile_external_account(UUID, BIGINT, BOOLEAN, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.reconcile_external_account(
    p_external_account_id UUID,
    p_actual_balance_units NUMERIC,
    p_apply_adjustment BOOLEAN DEFAULT FALSE,
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
    v_ext RECORD;
    v_fin RECORD;
    v_actual NUMERIC(30,6);
    v_accounting NUMERIC(30,6);
    v_diff NUMERIC(30,6);
    v_tx_id UUID := NULL;
    v_status TEXT := 'matched';
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF NOT v_is_service AND (v_caller_id IS NULL OR NOT public.is_admin()) THEN
        RAISE EXCEPTION 'صلاحية الإدارة مطلوبة لمطابقة الحساب الخارجي.' USING ERRCODE = '42501';
    END IF;
    IF p_actual_balance_units IS NULL OR p_actual_balance_units < 0 OR p_actual_balance_units <> ROUND(p_actual_balance_units, 6) THEN
        RAISE EXCEPTION 'الرصيد الفعلي يجب أن يكون غير سالب وبحد أقصى 6 منازل عشرية.';
    END IF;

    v_actual := ROUND(p_actual_balance_units, 6);

    SELECT * INTO v_ext FROM public.external_accounts WHERE id = p_external_account_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب الخارجي غير موجود.';
    END IF;

    SELECT * INTO v_fin FROM public.financial_accounts WHERE id = v_ext.financial_account_id FOR UPDATE;
    v_accounting := COALESCE(v_fin.balance_units, 0);
    v_diff := v_actual - v_accounting;

    IF v_diff <> 0 THEN
        v_status := 'discrepancy';
    END IF;

    UPDATE public.external_accounts
    SET actual_balance_units = v_actual,
        last_reconciled_at = v_now,
        updated_at = v_now
    WHERE id = v_ext.id;

    INSERT INTO public.external_account_reconciliations (
        external_account_id, accounting_balance_units, actual_balance_units, discrepancy_units,
        adjustment_transaction_id, adjustment_reason, status, reconciled_by, created_at
    ) VALUES (
        v_ext.id, v_accounting, v_actual, v_diff,
        v_tx_id, p_adjustment_reason, v_status, v_actor_id, v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'externalAccountId', v_ext.id,
        'accountingBalance', v_accounting,
        'actualBalance', v_actual,
        'discrepancy', v_diff,
        'status', v_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_fee_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_fee_policy() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_funded_campaign(TEXT, TEXT, TEXT, NUMERIC, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_funded_campaign(TEXT, TEXT, TEXT, NUMERIC, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_advertiser_campaign(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_advertiser_campaign(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_advertiser_campaign(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_advertiser_campaign(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_advertiser_campaign(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_advertiser_campaign(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.execute_internal_account_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_internal_account_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reconcile_external_account(UUID, NUMERIC, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_external_account(UUID, NUMERIC, BOOLEAN, TEXT, UUID) TO authenticated, service_role;
