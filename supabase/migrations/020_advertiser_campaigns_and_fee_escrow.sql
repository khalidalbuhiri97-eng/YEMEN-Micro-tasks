-- ==============================================================================
-- Migration 020: Advertiser Campaign Funding, Fee Escrow & Atomic Settlement
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Purpose:
--   1. Configurable advertiser campaign platform fee percentage (default 20%)
--      in platform_settings, snapshotted historically per campaign at creation.
--   2. public.campaigns table linking advertiser wallet funding to segregated
--      CAMPAIGN-ESCROW-<id> (task rewards) and CAMPAIGN-FEE-ESCROW-<id> (held fee).
--   3. Atomic PostgreSQL SECURITY DEFINER RPCs:
--      - create_funded_campaign (wallet balance check, advisory + row locks,
--        idempotency, reserves budget + fee WITHOUT recognizing revenue early)
--      - start_advertiser_campaign (moves held fee ONCE into PLATFORM-REVENUE-ADS
--        and publishes linked task with commission_units = 0)
--      - settle_advertiser_campaign (refunds unused budget + unstarted fee back
--        to advertiser wallet atomically)
-- NOTE: Prepared for review & controlled deployment; NOT executed on live DB.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. ENSURE platform_settings SUPPORTS advertiser_campaign_fee_percentage (20%)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.platform_settings') IS NOT NULL THEN
        -- Schema A: column-based platform_settings (Migration 005)
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'referral_bonus'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'advertiser_campaign_fee_percentage'
            ) THEN
                ALTER TABLE public.platform_settings
                ADD COLUMN advertiser_campaign_fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 20.00
                CHECK (advertiser_campaign_fee_percentage >= 0 AND advertiser_campaign_fee_percentage <= 50);
            END IF;
        END IF;

        -- Schema B: key-value platform_settings
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
        ) THEN
            INSERT INTO public.platform_settings (setting_key, setting_value, updated_at)
            VALUES ('advertiser_campaign_fee_percentage', '20'::jsonb, NOW())
            ON CONFLICT (setting_key) DO NOTHING;
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. ENSURE PLATFORM-REVENUE-ADS & ESCROW ACCOUNT TYPE ARE READY
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_constraint RECORD;
    v_struct_def TEXT;
    v_existing_rev RECORD;
BEGIN
    -- Safely include 'escrow' and 'revenue' if financial_accounts_account_type_check exists
    SELECT pg_get_constraintdef(c.oid)
    INTO v_struct_def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.financial_accounts'::regclass
      AND c.contype = 'c'
      AND c.conname = 'financial_accounts_structure'
    LIMIT 1;

    IF v_struct_def IS NOT NULL AND v_struct_def ILIKE '%issuance_control%' AND v_struct_def NOT ILIKE '%escrow%' THEN
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

    SELECT id, normal_side INTO v_existing_rev
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-REVENUE-ADS'
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.financial_accounts (
            account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            'PLATFORM-REVENUE-ADS', 'revenue', NULL, NULL, 'credit', 0, 'active', NOW()
        )
        ON CONFLICT (account_code) DO NOTHING;
    ELSIF LOWER(v_existing_rev.normal_side) <> 'credit' THEN
        RAISE EXCEPTION 'MIGRATION_020_HALTED: PLATFORM-REVENUE-ADS has incompatible normal_side=%', v_existing_rev.normal_side;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. CAMPAIGNS TABLE & TASKS LINKAGE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'app_testing',
    reward_units BIGINT NOT NULL CHECK (reward_units > 0),
    slots INTEGER NOT NULL CHECK (slots > 0),
    budget_units BIGINT NOT NULL CHECK (budget_units = reward_units * slots AND budget_units > 0),
    fee_percentage NUMERIC(5,2) NOT NULL CHECK (fee_percentage >= 0 AND fee_percentage <= 50),
    fee_units BIGINT NOT NULL CHECK (fee_units >= 0),
    total_units BIGINT NOT NULL CHECK (total_units = budget_units + fee_units AND total_units > 0),
    refunded_units BIGINT NOT NULL DEFAULT 0 CHECK (refunded_units >= 0),
    status TEXT NOT NULL DEFAULT 'pending_start' CHECK (status IN ('pending_start', 'active', 'paused', 'completed', 'cancelled')),
    creation_key TEXT NOT NULL UNIQUE,
    budget_escrow_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
    fee_escrow_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
    funding_transaction_id UUID REFERENCES public.ledger_transactions(id),
    fee_revenue_transaction_id UUID REFERENCES public.ledger_transactions(id),
    settlement_transaction_id UUID REFERENCES public.ledger_transactions(id),
    linked_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    time_estimate_minutes INTEGER NOT NULL DEFAULT 10 CHECK (time_estimate_minutes > 0),
    proof_requirements JSONB NOT NULL DEFAULT '{"requireImage": true, "requireText": true}'::jsonb,
    deadline_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser_created
    ON public.campaigns (advertiser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status
    ON public.campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_linked_task
    ON public.campaigns (linked_task_id) WHERE linked_task_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'campaign_id'
    ) THEN
        ALTER TABLE public.tasks
        ADD COLUMN campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.tasks
        ADD COLUMN category TEXT NOT NULL DEFAULT 'app_testing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'budget_spent_yer'
    ) THEN
        ALTER TABLE public.tasks
        ADD COLUMN budget_spent_yer BIGINT NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'commission_units'
    ) THEN
        ALTER TABLE public.tasks
        ADD COLUMN commission_units BIGINT NOT NULL DEFAULT 0 CHECK (commission_units >= 0);
    END IF;
END $$;

-- RLS & Least Privilege on public.campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.campaigns FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.campaigns TO authenticated;
GRANT ALL ON TABLE public.campaigns TO service_role;

DROP POLICY IF EXISTS campaigns_select_own_or_admin ON public.campaigns;
CREATE POLICY campaigns_select_own_or_admin
ON public.campaigns
FOR SELECT
TO authenticated
USING (
    advertiser_id = auth.uid()
    OR public.is_admin()
);

-- ------------------------------------------------------------------------------
-- 4. HELPER: READ CURRENT CONFIGURED CAMPAIGN FEE PERCENTAGE (DEFAULT 20.00)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_advertiser_campaign_fee_percentage()
RETURNS NUMERIC(5,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pct NUMERIC(5,2) := 20.00;
    v_kv_val TEXT;
BEGIN
    IF to_regclass('public.platform_settings') IS NULL THEN
        RETURN v_pct;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'advertiser_campaign_fee_percentage'
    ) THEN
        SELECT advertiser_campaign_fee_percentage
        INTO v_pct
        FROM public.platform_settings
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
    ) THEN
        SELECT (setting_value #>> '{}')
        INTO v_kv_val
        FROM public.platform_settings
        WHERE setting_key = 'advertiser_campaign_fee_percentage'
        LIMIT 1;

        IF v_kv_val IS NOT NULL AND v_kv_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
            v_pct := v_kv_val::NUMERIC(5,2);
        END IF;
    END IF;

    IF v_pct IS NULL OR v_pct < 0 OR v_pct > 50 THEN
        RETURN 20.00;
    END IF;
    RETURN v_pct;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. ATOMIC RPC: create_funded_campaign
--    - Checks active approved advertiser status.
--    - Re-computes budget, snapshotted fee%, fee_units, total_units server-side.
--    - Uses advisory lock + FOR UPDATE on WALLET-* to prevent double spending.
--    - Reserves BOTH budget and fee into separate escrow accounts in 1 atomic tx.
--    - Does NOT recognize platform fee into PLATFORM-REVENUE-ADS yet!
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_funded_campaign(
    p_title TEXT,
    p_description TEXT,
    p_category TEXT DEFAULT 'app_testing',
    p_reward_units BIGINT DEFAULT NULL,
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
    v_fee_pct NUMERIC(5,2);
    v_budget BIGINT;
    v_fee BIGINT;
    v_total BIGINT;
    v_wallet RECORD;
    v_wallet_acc RECORD;
    v_budget_escrow_id UUID;
    v_fee_escrow_id UUID;
    v_campaign_id UUID := gen_random_uuid();
    v_tx_id UUID;
    v_wallet_new_bal BIGINT;
    v_budget_escrow_bal BIGINT;
    v_fee_escrow_bal BIGINT;
    v_rows_affected INT := 0;
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
        RAISE EXCEPTION 'سعر المهمة وعدد المهمات يجب أن يكونا أعداداً صحيحة أكبر من صفر.';
    END IF;

    -- Verify advertiser role and active approval status (schema-safe across account_status/status/role)
    SELECT *
    INTO v_profile
    FROM public.profiles
    WHERE id = v_adv_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ملف المعلن غير موجود.';
    END IF;

    SELECT role INTO v_adv_role
    FROM public.user_roles
    WHERE user_id = v_adv_id
    ORDER BY CASE WHEN role = 'admin' THEN 1 WHEN role = 'advertiser' THEN 2 ELSE 3 END
    LIMIT 1;

    v_adv_role := COALESCE(v_adv_role, NULLIF(to_jsonb(v_profile)->>'role', ''), 'user');
    v_adv_status := LOWER(COALESCE(
        NULLIF(to_jsonb(v_profile)->>'account_status', ''),
        NULLIF(to_jsonb(v_profile)->>'status', ''),
        'pending'
    ));

    IF v_adv_role <> 'advertiser' THEN
        RAISE EXCEPTION 'هذا الإجراء مخصص لحسابات المعلنين المعتمدة فقط.' USING ERRCODE = '42501';
    END IF;
    IF v_adv_status <> 'active' THEN
        RAISE EXCEPTION 'حساب المعلن غير مفعل بعد وبانتظار اعتماد الإدارة.' USING ERRCODE = '42501';
    END IF;

    -- Serialize concurrent funding requests from the same advertiser wallet
    PERFORM pg_advisory_xact_lock(hashtext('advertiser_campaign_fund_' || v_adv_id::text));

    -- Idempotency check by creation_key
    SELECT * INTO v_existing
    FROM public.campaigns
    WHERE creation_key = v_key
    LIMIT 1;

    IF FOUND THEN
        SELECT balance_units INTO v_wallet_new_bal
        FROM public.financial_accounts
        WHERE owner_user_id = v_adv_id AND account_type = 'wallet'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_existing.id,
            'status', v_existing.status,
            'budgetUnits', v_existing.budget_units,
            'feePercentage', v_existing.fee_percentage,
            'feeUnits', v_existing.fee_units,
            'totalUnits', v_existing.total_units,
            'fundingTransactionId', v_existing.funding_transaction_id,
            'newAvailableBalance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    -- Authoritative server-side cost computation (snapshot current fee%)
    v_fee_pct := public.get_advertiser_campaign_fee_percentage();
    v_budget := p_reward_units * p_slots;
    v_fee := ROUND((v_budget * v_fee_pct) / 100.0)::BIGINT;
    v_total := v_budget + v_fee;

    IF v_budget <= 0 OR v_fee < 0 OR v_total <= 0 THEN
        RAISE EXCEPTION 'حساب تكلفة الحملة غير صالح.';
    END IF;

    -- Locate & lock advertiser wallet financial account
    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_adv_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.wallets (id, user_id, wallet_address, status, created_at)
        VALUES (
            gen_random_uuid(),
            v_adv_id,
            'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(v_adv_id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
            'active',
            v_now
        )
        RETURNING * INTO v_wallet;
    END IF;

    IF LOWER(COALESCE(v_wallet.status, 'active')) <> 'active' THEN
        RAISE EXCEPTION 'محفظة المعلن مجمدة أو غير نشطة.';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet'
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'WALLET-' || v_wallet.id::text, 'wallet', v_adv_id, v_wallet.id, 'credit', 0, 'active', v_now
        )
        RETURNING * INTO v_wallet_acc;
    END IF;

    IF LOWER(COALESCE(v_wallet_acc.status, 'active')) <> 'active' THEN
        RAISE EXCEPTION 'الحساب المالي لمحفظة المعلن غير نشط.';
    END IF;

    IF v_wallet_acc.balance_units < v_total THEN
        RAISE EXCEPTION 'INSUFFICIENT_FUNDS: رصيد محفظة المعلن غير كافٍ. المطلوب % ر.ي، المتاح % ر.ي، العجز المطلوب شحنه % ر.ي.',
            v_total, v_wallet_acc.balance_units, (v_total - v_wallet_acc.balance_units);
    END IF;

    -- Create segregated escrow accounts for campaign rewards & held platform fee
    INSERT INTO public.financial_accounts (
        id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
    ) VALUES (
        gen_random_uuid(), 'CAMPAIGN-ESCROW-' || v_campaign_id::text, 'escrow', NULL, NULL, 'credit', 0, 'active', v_now
    )
    RETURNING id INTO v_budget_escrow_id;

    INSERT INTO public.financial_accounts (
        id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
    ) VALUES (
        gen_random_uuid(), 'CAMPAIGN-FEE-ESCROW-' || v_campaign_id::text, 'escrow', NULL, NULL, 'credit', 0, 'active', v_now
    )
    RETURNING id INTO v_fee_escrow_id;

    -- Post balanced double-entry reservation (wallet -> budget escrow + fee escrow)
    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'CAMPAIGN_FUNDING_RESERVE',
        'CAMPAIGN:' || v_campaign_id::text,
        'CAMPAIGN-FUND-RESERVE:' || v_campaign_id::text,
        'posted',
        jsonb_build_object(
            'campaign_id', v_campaign_id,
            'advertiser_id', v_adv_id,
            'reward_units', p_reward_units,
            'slots', p_slots,
            'budget_units', v_budget,
            'fee_percentage', v_fee_pct,
            'fee_units', v_fee,
            'total_units', v_total,
            'creation_key', v_key,
            'description', 'حجز تمويل حملة إعلانية ورسوم المنصة لحين التشغيل: ' || v_clean_title
        ),
        v_adv_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_wallet_acc.id, 'debit', v_total, 'حجز إجمالي تمويل الحملة: ' || v_clean_title, v_now),
        (v_tx_id, v_budget_escrow_id, 'credit', v_budget, 'حجز ميزانية مكافآت الحملة: ' || v_clean_title, v_now);

    IF v_fee > 0 THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES (
            v_tx_id,
            v_fee_escrow_id,
            'credit',
            v_fee,
            'حجز رسوم المنصة المعلقة (' || v_fee_pct::text || '%) قبل بدء الحملة: ' || v_clean_title,
            v_now
        );
    END IF;

    -- Update balances atomically
    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_total ELSE -v_total END
    WHERE id = v_wallet_acc.id
    RETURNING balance_units INTO v_wallet_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_wallet_new_bal < 0 THEN
        RAISE EXCEPTION 'فشل تحديث رصيد محفظة المعلن بأمان.';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_budget ELSE -v_budget END
    WHERE id = v_budget_escrow_id
    RETURNING balance_units INTO v_budget_escrow_bal;

    IF v_budget_escrow_bal < 0 THEN
        RAISE EXCEPTION 'فشل تحديث حساب ضمان مكافآت الحملة.';
    END IF;

    IF v_fee > 0 THEN
        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_fee ELSE -v_fee END
        WHERE id = v_fee_escrow_id
        RETURNING balance_units INTO v_fee_escrow_bal;

        IF v_fee_escrow_bal < 0 THEN
            RAISE EXCEPTION 'فشل تحديث حساب ضمان رسوم الحملة.';
        END IF;
    END IF;

    INSERT INTO public.campaigns (
        id, advertiser_id, title, description, category,
        reward_units, slots, budget_units, fee_percentage, fee_units, total_units,
        status, creation_key, budget_escrow_account_id, fee_escrow_account_id,
        funding_transaction_id, time_estimate_minutes, proof_requirements, deadline_at,
        created_at, updated_at
    ) VALUES (
        v_campaign_id, v_adv_id, v_clean_title, v_clean_desc, v_clean_cat,
        p_reward_units, p_slots, v_budget, v_fee_pct, v_fee, v_total,
        'pending_start', v_key, v_budget_escrow_id, v_fee_escrow_id,
        v_tx_id, COALESCE(p_time_estimate_minutes, 10),
        COALESCE(p_proof_requirements, '{"requireImage": true, "requireText": true}'::jsonb),
        p_deadline_at,
        v_now, v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_campaign_id,
        'status', 'pending_start',
        'budgetUnits', v_budget,
        'feePercentage', v_fee_pct,
        'feeUnits', v_fee,
        'totalUnits', v_total,
        'fundingTransactionId', v_tx_id,
        'newAvailableBalance', v_wallet_new_bal
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. ATOMIC RPC: start_advertiser_campaign
--    - Transitions campaign from pending_start -> active ONCE.
--    - Recognizes held platform fee from CAMPAIGN-FEE-ESCROW-<id> into
--      PLATFORM-REVENUE-ADS with strict idempotency ('CAMPAIGN-FEE-REVENUE:<id>').
--    - Publishes linked worker-facing task with commission_units = 0 linked to
--      CAMPAIGN-ESCROW-<id> so worker payouts come from advertiser escrow only.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_advertiser_campaign(
    p_campaign_id UUID,
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
    v_campaign RECORD;
    v_fee_escrow RECORD;
    v_rev_ads RECORD;
    v_rev_tx_id UUID := NULL;
    v_task_id UUID := NULL;
    v_fee_rev_key TEXT;
    v_existing_rev_tx UUID;
    v_lock_ids UUID[];
    v_fee_escrow_new_bal BIGINT;
    v_rev_new_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'Campaign ID is required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('start_campaign_' || p_campaign_id::text));

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحملة الإعلانية غير موجودة.';
    END IF;

    IF NOT v_is_service AND v_caller_id <> v_campaign.advertiser_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'ليست لديك صلاحية تشغيل هذه الحملة.' USING ERRCODE = '42501';
    END IF;

    IF v_campaign.status = 'active' THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_campaign.id,
            'status', 'active',
            'feeRevenueTransactionId', v_campaign.fee_revenue_transaction_id,
            'linkedTaskId', v_campaign.linked_task_id
        );
    END IF;

    IF v_campaign.status IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'لا يمكن تشغيل حملة منتهية أو ملغاة.';
    END IF;

    v_fee_rev_key := 'CAMPAIGN-FEE-REVENUE:' || v_campaign.id::text;

    -- Recognize fee into PLATFORM-REVENUE-ADS ONLY ONCE (on first transition to active)
    IF v_campaign.fee_units > 0 AND v_campaign.started_at IS NULL THEN
        SELECT id INTO v_existing_rev_tx
        FROM public.ledger_transactions
        WHERE idempotency_key = v_fee_rev_key
        LIMIT 1;

        IF FOUND THEN
            v_rev_tx_id := v_existing_rev_tx;
        ELSE
            SELECT * INTO v_rev_ads
            FROM public.financial_accounts
            WHERE account_code = 'PLATFORM-REVENUE-ADS'
            LIMIT 1;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'حساب إيرادات الإعلانات PLATFORM-REVENUE-ADS غير موجود.';
            END IF;

            SELECT array_agg(x ORDER BY x) INTO v_lock_ids
            FROM unnest(ARRAY[v_campaign.fee_escrow_account_id, v_rev_ads.id]) AS x;

            PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

            SELECT * INTO v_fee_escrow
            FROM public.financial_accounts
            WHERE id = v_campaign.fee_escrow_account_id;

            IF v_fee_escrow.balance_units < v_campaign.fee_units THEN
                RAISE EXCEPTION 'رصيد حساب ضمان رسوم الحملة غير كافٍ للتحصيل.';
            END IF;

            INSERT INTO public.ledger_transactions (
                transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
            ) VALUES (
                'AD_REVENUE',
                'CAMPAIGN:' || v_campaign.id::text,
                v_fee_rev_key,
                'posted',
                jsonb_build_object(
                    'campaign_id', v_campaign.id,
                    'advertiser_id', v_campaign.advertiser_id,
                    'source', 'campaign_fee_escrow',
                    'fee_percentage', v_campaign.fee_percentage,
                    'fee_units', v_campaign.fee_units,
                    'description', 'إثبات إيراد رسوم منصة على بدء الحملة الإعلانية: ' || v_campaign.title
                ),
                COALESCE(v_actor_id, v_campaign.advertiser_id),
                v_now
            )
            RETURNING id INTO v_rev_tx_id;

            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES
                (v_rev_tx_id, v_campaign.fee_escrow_account_id, 'debit', v_campaign.fee_units, 'تحصيل رسوم المنصة عند بدء الحملة: ' || v_campaign.title, v_now),
                (v_rev_tx_id, v_rev_ads.id, 'credit', v_campaign.fee_units, 'إيراد إعلانات متحقق من الحملة: ' || v_campaign.title, v_now);

            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_campaign.fee_units ELSE -v_campaign.fee_units END
            WHERE id = v_campaign.fee_escrow_account_id
            RETURNING balance_units INTO v_fee_escrow_new_bal;

            IF v_fee_escrow_new_bal < 0 THEN
                RAISE EXCEPTION 'فشل خصم رسوم الحملة من حساب الضمان.';
            END IF;

            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_campaign.fee_units ELSE -v_campaign.fee_units END
            WHERE id = v_rev_ads.id
            RETURNING balance_units INTO v_rev_new_bal;

            IF v_rev_new_bal < 0 THEN
                RAISE EXCEPTION 'فشل إثبات إيراد الإعلانات.';
            END IF;
        END IF;
    ELSE
        v_rev_tx_id := v_campaign.fee_revenue_transaction_id;
    END IF;

    -- Publish or reactivate linked worker task (commission_units = 0 so no double commission)
    IF v_campaign.linked_task_id IS NOT NULL THEN
        v_task_id := v_campaign.linked_task_id;
        UPDATE public.tasks
        SET status = 'active'
        WHERE id = v_task_id AND LOWER(status) <> 'completed';
    ELSE
        INSERT INTO public.tasks (
            title, description, category, reward_units, slots, approved_count,
            total_budget_units, budget_spent_yer, commission_units,
            escrow_account_id, funding_transaction_id, creation_key,
            deadline_at, status, created_by, campaign_id, created_at
        ) VALUES (
            v_campaign.title, v_campaign.description, v_campaign.category,
            v_campaign.reward_units, v_campaign.slots, 0,
            v_campaign.budget_units, 0, 0,
            v_campaign.budget_escrow_account_id, v_campaign.funding_transaction_id,
            'CAMPAIGN-TASK:' || v_campaign.id::text,
            v_campaign.deadline_at, 'active', v_campaign.advertiser_id, v_campaign.id, v_now
        )
        ON CONFLICT (creation_key) DO UPDATE SET status = 'active'
        RETURNING id INTO v_task_id;
    END IF;

    UPDATE public.campaigns
    SET status = 'active',
        started_at = COALESCE(started_at, v_now),
        fee_revenue_transaction_id = COALESCE(fee_revenue_transaction_id, v_rev_tx_id),
        linked_task_id = COALESCE(linked_task_id, v_task_id),
        updated_at = v_now
    WHERE id = v_campaign.id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_campaign.id,
        'status', 'active',
        'feeRevenueTransactionId', COALESCE(v_campaign.fee_revenue_transaction_id, v_rev_tx_id),
        'linkedTaskId', COALESCE(v_campaign.linked_task_id, v_task_id)
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. ATOMIC RPC: settle_advertiser_campaign
--    - Closes/cancels campaign and refunds remaining unused reward budget back to
--      advertiser's WALLET-*.
--    - If campaign NEVER started (started_at IS NULL), also refunds the held
--      platform fee from CAMPAIGN-FEE-ESCROW-<id> back to advertiser wallet.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_advertiser_campaign(
    p_campaign_id UUID,
    p_target_status TEXT DEFAULT 'cancelled',
    p_reason TEXT DEFAULT NULL,
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
    v_target_status TEXT := LOWER(TRIM(COALESCE(p_target_status, 'cancelled')));
    v_clean_reason TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'تسوية وإغلاق الحملة وإرجاع المتبقي لمحفظة المعلن');
    v_campaign RECORD;
    v_wallet_acc RECORD;
    v_budget_escrow RECORD;
    v_fee_escrow RECORD;
    v_lock_ids UUID[];
    v_refund_budget BIGINT := 0;
    v_refund_fee BIGINT := 0;
    v_total_refund BIGINT := 0;
    v_tx_id UUID := NULL;
    v_refund_key TEXT;
    v_existing_tx UUID;
    v_new_bal BIGINT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'Campaign ID is required';
    END IF;
    IF v_target_status NOT IN ('cancelled', 'completed') THEN
        v_target_status := 'cancelled';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_campaign_' || p_campaign_id::text));

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحملة الإعلانية غير موجودة.';
    END IF;

    IF NOT v_is_service AND v_caller_id <> v_campaign.advertiser_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'ليست لديك صلاحية تسوية هذه الحملة.' USING ERRCODE = '42501';
    END IF;

    IF v_campaign.status IN ('cancelled', 'completed') THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'campaignId', v_campaign.id,
            'status', v_campaign.status,
            'refundedUnits', v_campaign.refunded_units,
            'settlementTransactionId', v_campaign.settlement_transaction_id
        );
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE owner_user_id = v_campaign.advertiser_id AND account_type = 'wallet'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحساب المالي لمحفظة المعلن غير موجود.';
    END IF;

    SELECT array_agg(x ORDER BY x) INTO v_lock_ids
    FROM unnest(ARRAY[
        v_wallet_acc.id,
        v_campaign.budget_escrow_account_id,
        v_campaign.fee_escrow_account_id
    ]) AS x;

    PERFORM id FROM public.financial_accounts WHERE id = ANY(v_lock_ids) ORDER BY id ASC FOR UPDATE;

    SELECT * INTO v_budget_escrow FROM public.financial_accounts WHERE id = v_campaign.budget_escrow_account_id;
    SELECT * INTO v_fee_escrow FROM public.financial_accounts WHERE id = v_campaign.fee_escrow_account_id;

    v_refund_budget := GREATEST(0, COALESCE(v_budget_escrow.balance_units, 0));
    -- Unstarted campaigns also refund the held fee; started campaigns already recognized fee into PLATFORM-REVENUE-ADS
    IF v_campaign.started_at IS NULL THEN
        v_refund_fee := GREATEST(0, COALESCE(v_fee_escrow.balance_units, 0));
    ELSE
        v_refund_fee := 0;
    END IF;

    v_total_refund := v_refund_budget + v_refund_fee;
    v_refund_key := 'CAMPAIGN-REFUND:' || v_campaign.id::text;

    IF v_total_refund > 0 THEN
        SELECT id INTO v_existing_tx
        FROM public.ledger_transactions
        WHERE idempotency_key = v_refund_key
        LIMIT 1;

        IF FOUND THEN
            v_tx_id := v_existing_tx;
        ELSE
            INSERT INTO public.ledger_transactions (
                transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
            ) VALUES (
                'CAMPAIGN_ESCROW_REFUND',
                'CAMPAIGN:' || v_campaign.id::text,
                v_refund_key,
                'posted',
                jsonb_build_object(
                    'campaign_id', v_campaign.id,
                    'advertiser_id', v_campaign.advertiser_id,
                    'refund_budget_units', v_refund_budget,
                    'refund_fee_units', v_refund_fee,
                    'total_refund_units', v_total_refund,
                    'reason', v_clean_reason,
                    'description', 'استرجاع الفائض من الحملة الإعلانية لمحفظة المعلن: ' || v_campaign.title
                ),
                COALESCE(v_actor_id, v_campaign.advertiser_id),
                v_now
            )
            RETURNING id INTO v_tx_id;

            IF v_refund_budget > 0 THEN
                INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
                VALUES (v_tx_id, v_budget_escrow.id, 'debit', v_refund_budget, 'استرجاع متبقي ميزانية الحملة: ' || v_campaign.title, v_now);

                UPDATE public.financial_accounts
                SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_refund_budget ELSE -v_refund_budget END
                WHERE id = v_budget_escrow.id
                RETURNING balance_units INTO v_new_bal;

                IF v_new_bal < 0 THEN RAISE EXCEPTION 'رصيد ضمان الميزانية غير كافٍ للاسترجاع.'; END IF;
            END IF;

            IF v_refund_fee > 0 THEN
                INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
                VALUES (v_tx_id, v_fee_escrow.id, 'debit', v_refund_fee, 'استرجاع رسوم منصة محتجزة لحملة لم تبدأ: ' || v_campaign.title, v_now);

                UPDATE public.financial_accounts
                SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_refund_fee ELSE -v_refund_fee END
                WHERE id = v_fee_escrow.id
                RETURNING balance_units INTO v_new_bal;

                IF v_new_bal < 0 THEN RAISE EXCEPTION 'رصيد ضمان الرسوم غير كافٍ للاسترجاع.'; END IF;
            END IF;

            INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
            VALUES (v_tx_id, v_wallet_acc.id, 'credit', v_total_refund, 'إيداع مرتجع الحملة في محفظة المعلن: ' || v_campaign.title, v_now);

            UPDATE public.financial_accounts
            SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_total_refund ELSE -v_total_refund END
            WHERE id = v_wallet_acc.id
            RETURNING balance_units INTO v_new_bal;

            IF v_new_bal < 0 THEN RAISE EXCEPTION 'فشل تحديث محفظة المعلن بالمرتجع.'; END IF;
        END IF;
    END IF;

    IF v_campaign.linked_task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = CASE WHEN v_target_status = 'completed' THEN 'completed' ELSE 'paused' END
        WHERE id = v_campaign.linked_task_id;
    END IF;

    UPDATE public.campaigns
    SET status = v_target_status,
        refunded_units = v_total_refund,
        settlement_transaction_id = COALESCE(v_tx_id, settlement_transaction_id),
        settled_at = v_now,
        updated_at = v_now
    WHERE id = v_campaign.id;

    SELECT balance_units INTO v_new_bal FROM public.financial_accounts WHERE id = v_wallet_acc.id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'campaignId', v_campaign.id,
        'status', v_target_status,
        'refundedBudgetUnits', v_refund_budget,
        'refundedFeeUnits', v_refund_fee,
        'refundedUnits', v_total_refund,
        'settlementTransactionId', v_tx_id,
        'newAvailableBalance', COALESCE(v_new_bal, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_advertiser_campaign_fee_percentage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_advertiser_campaign_fee_percentage() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_funded_campaign(TEXT, TEXT, TEXT, BIGINT, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_funded_campaign(TEXT, TEXT, TEXT, BIGINT, INTEGER, TEXT, INTEGER, JSONB, TIMESTAMPTZ, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_advertiser_campaign(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_advertiser_campaign(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_advertiser_campaign(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_advertiser_campaign(UUID, TEXT, TEXT, UUID) TO authenticated, service_role;
