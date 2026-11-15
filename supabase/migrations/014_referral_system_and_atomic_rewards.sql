-- ==============================================================================
-- Migration 014: Auditable Referral System & Atomic Ledger-Backed Rewards
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Guarantees:
--   1. Adds profiles.referred_by (FK -> profiles(id) ON DELETE SET NULL) and
--      safely ensures unique profiles.referral_code without altering balances.
--   2. Prevents self-referrals and blocks modifying profiles.referred_by after signup.
--   3. Creates public.referral_rewards with UNIQUE(referred_user_id),
--      UNIQUE(trigger_submission_id), UNIQUE(ledger_transaction_id), explicit
--      statuses ('pending', 'approved', 'paid', 'rejected'), and strict RLS.
--   4. Zero rewards on signup; zero retroactive payouts for old tasks/users.
--   5. Reads real `referral_bonus` from platform_settings (never hardcodes 300;
--      preserves live 30 units).
--   6. Atomic double-entry REFERRAL_REWARD from funded PLATFORM-TREASURY ONLY;
--      if treasury balance is insufficient, records status='pending' without
--      inventing an unbacked funding source.
-- NOTE: Prepared for review & manual deployment after backup; NOT run on production.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. PROFILES REFERRAL COLUMNS, UNIQUE CODE & IMMUTABILITY PROTECTION
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_dup_codes INT := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'referral_code'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN referral_code TEXT;
    END IF;

    -- Backfill ONLY rows where referral_code IS NULL or blank; never touch existing codes
    UPDATE public.profiles
    SET referral_code = 'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(id::text || ':kasb_referral_v1', 'sha256'), 'hex'), 1, 8))
    WHERE referral_code IS NULL OR TRIM(referral_code) = '';

    -- Normalize existing non-empty referral codes safely (trim/uppercase only if no collision)
    SELECT COUNT(*) INTO v_dup_codes
    FROM (
        SELECT UPPER(TRIM(referral_code)) AS norm_code
        FROM public.profiles
        WHERE referral_code IS NOT NULL AND TRIM(referral_code) <> ''
        GROUP BY UPPER(TRIM(referral_code))
        HAVING COUNT(*) > 1
    ) d;

    IF v_dup_codes > 0 THEN
        RAISE EXCEPTION 'MIGRATION_014_HALTED: توجد أكواد إحالة مكررة في جدول profiles (%). يرجى مراجعتها قبل فرض قيد التفرد.', v_dup_codes;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code_upper_unique
        ON public.profiles (UPPER(TRIM(referral_code)))
        WHERE referral_code IS NOT NULL AND TRIM(referral_code) <> '';

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'referred_by'
    ) THEN
        ALTER TABLE public.profiles
        ADD COLUMN referred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.profiles'::regclass
          AND conname = 'profiles_no_self_referral'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_no_self_referral CHECK (referred_by IS NULL OR referred_by <> id);
    END IF;

    CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
        ON public.profiles (referred_by)
        WHERE referred_by IS NOT NULL;
END $$;

-- Immutability Trigger: block changing profiles.referred_by after registration
CREATE OR REPLACE FUNCTION public.protect_profiles_referred_by()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.referred_by IS DISTINCT FROM NEW.referred_by THEN
        IF OLD.referred_by IS NOT NULL THEN
            RAISE EXCEPTION 'referred_by cannot be modified once set' USING ERRCODE = '42501';
        END IF;
        IF COALESCE(current_setting('role', true), '') <> 'service_role' AND NOT public.is_admin() THEN
            RAISE EXCEPTION 'referred_by cannot be modified after registration' USING ERRCODE = '42501';
        END IF;
    END IF;
    IF NEW.referred_by IS NOT NULL AND NEW.referred_by = NEW.id THEN
        RAISE EXCEPTION 'Self-referral is not allowed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profiles_referred_by ON public.profiles;
CREATE TRIGGER trg_protect_profiles_referred_by
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profiles_referred_by();

-- ------------------------------------------------------------------------------
-- 2. REFERRAL REWARDS TABLE (ONE REWARD MAX PER REFERRED USER + LEDGER LINKED)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    referred_user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
    trigger_submission_id UUID NOT NULL UNIQUE REFERENCES public.task_submissions(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
    reward_amount BIGINT NOT NULL CHECK (reward_amount > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
    ledger_transaction_id UUID UNIQUE REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    failure_reason TEXT,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_rewards_no_self_referral CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_status
    ON public.referral_rewards (referrer_id, status, created_at DESC);

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.referral_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_rewards TO service_role;

DROP POLICY IF EXISTS "Users read own referral rewards" ON public.referral_rewards;
CREATE POLICY "Users read own referral rewards" ON public.referral_rewards
    FOR SELECT USING (
        referrer_id = auth.uid()
        OR referred_user_id = auth.uid()
        OR public.is_admin()
        OR auth.role() = 'service_role'
    );

-- ------------------------------------------------------------------------------
-- 3. SAFE REFERRAL CODE RESOLVER & SETTINGS READER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean TEXT := UPPER(TRIM(COALESCE(p_code, '')));
    v_referrer_id UUID;
BEGIN
    IF v_clean = '' THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_referrer_id
    FROM public.profiles
    WHERE UPPER(TRIM(referral_code)) = v_clean
    LIMIT 1;

    RETURN v_referrer_id;
END;
$$;

-- Reads live referral_bonus dynamically across either key-value or column-based platform_settings
CREATE OR REPLACE FUNCTION public.get_configured_referral_bonus()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bonus BIGINT := 0;
    v_has_kv BOOLEAN := false;
    v_has_col BOOLEAN := false;
    v_raw TEXT;
BEGIN
    IF to_regclass('public.platform_settings') IS NULL THEN
        RETURN 0;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
    ) INTO v_has_kv;

    IF v_has_kv THEN
        SELECT setting_value::text INTO v_raw
        FROM public.platform_settings
        WHERE setting_key = 'referral_bonus'
        LIMIT 1;

        IF v_raw IS NOT NULL THEN
            v_bonus := COALESCE(NULLIF(regexp_replace(v_raw, '[^0-9]', '', 'g'), '')::bigint, 0);
            RETURN GREATEST(0, v_bonus);
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'referral_bonus'
    ) INTO v_has_col;

    IF v_has_col THEN
        EXECUTE 'SELECT COALESCE(referral_bonus, 0)::bigint FROM public.platform_settings LIMIT 1' INTO v_bonus;
        RETURN GREATEST(0, COALESCE(v_bonus, 0));
    END IF;

    RETURN 0;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. SIGNUP TRIGGER: ASSIGN UNIQUE referral_code & referred_by ONLY ON SIGNUP
--    - Zero referral rewards are created or paid at signup!
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ref_code TEXT;
    v_role TEXT := 'user';
    v_phone TEXT;
    v_full_name TEXT;
    v_referred_by_code TEXT;
    v_referrer_id UUID := NULL;
    v_wallet_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF LOWER(COALESCE(NEW.email, '')) IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com') THEN
        v_role := 'admin';
    END IF;

    v_ref_code := 'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(NEW.id::text || ':kasb_referral_v1', 'sha256'), 'hex'), 1, 8));

    v_referred_by_code := NULLIF(UPPER(TRIM(COALESCE(NEW.raw_user_meta_data->>'referred_by_code', ''))), '');
    IF v_referred_by_code IS NOT NULL THEN
        SELECT id INTO v_referrer_id
        FROM public.profiles
        WHERE UPPER(TRIM(referral_code)) = v_referred_by_code
          AND id <> NEW.id
        LIMIT 1;
    END IF;

    v_phone := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
        NULLIF(TRIM(NEW.phone), ''),
        '967' || SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 9)
    );

    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        'مستخدم جديد'
    );

    INSERT INTO public.profiles (
        id, full_name, phone, role, account_status, referral_code, referred_by, city, created_at, updated_at
    ) VALUES (
        NEW.id,
        v_full_name,
        v_phone,
        v_role,
        'active',
        v_ref_code,
        v_referrer_id,
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'city'), ''), 'صنعاء'),
        v_now,
        v_now
    )
    ON CONFLICT (id) DO UPDATE SET
        updated_at = v_now;

    INSERT INTO public.wallets (
        id, user_id, wallet_address, status, created_at
    ) VALUES (
        gen_random_uuid(),
        NEW.id,
        'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(NEW.id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
        'active',
        v_now
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.id ORDER BY created_at ASC LIMIT 1;

    IF v_wallet_id IS NOT NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'WALLET-' || v_wallet_id::text, 'wallet', NEW.id, v_wallet_id, 'credit', 0, 'active', v_now
        )
        ON CONFLICT (account_code) DO NOTHING;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. ATOMIC FIRST-TASK REFERRAL REWARD PROCESSOR (DOUBLE-ENTRY LEDGER BACKED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_referral_reward_for_submission(p_submission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_user RECORD;
    v_referrer RECORD;
    v_existing RECORD;
    v_approved_count INT := 0;
    v_bonus BIGINT := 0;
    v_ref_wallet RECORD;
    v_ref_wallet_acc RECORD;
    v_treasury RECORD;
    v_tx_id UUID;
    v_reward_id UUID;
    v_idem_key TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_new_treasury_bal BIGINT;
    v_new_wallet_bal BIGINT;
    v_rows INT := 0;
BEGIN
    IF p_submission_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'missing_submission_id');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('referral_sub_' || p_submission_id::text));

    SELECT * INTO v_sub FROM public.task_submissions WHERE id = p_submission_id;
    IF NOT FOUND OR LOWER(v_sub.status) <> 'approved' OR v_sub.reward_transaction_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'submission_not_approved_with_ledger');
    END IF;

    SELECT * INTO v_user FROM public.profiles WHERE id = v_sub.user_id;
    IF NOT FOUND OR v_user.referred_by IS NULL OR v_user.referred_by = v_user.id THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'no_valid_referrer');
    END IF;

    -- Lock per referred user so concurrent approvals never create duplicate rewards
    PERFORM pg_advisory_xact_lock(hashtext('referral_user_' || v_user.id::text));

    SELECT * INTO v_existing FROM public.referral_rewards WHERE referred_user_id = v_user.id LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'idempotent', true,
            'reason', 'already_recorded',
            'referral_reward_id', v_existing.id,
            'status', v_existing.status
        );
    END IF;

    -- Must be the referred user's FIRST approved real task (never retroactive)
    SELECT COUNT(*) INTO v_approved_count
    FROM public.task_submissions
    WHERE user_id = v_sub.user_id
      AND LOWER(status) = 'approved'
      AND reward_transaction_id IS NOT NULL;

    IF v_approved_count <> 1 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_first_approved_task', 'approved_count', v_approved_count);
    END IF;

    v_bonus := public.get_configured_referral_bonus();
    IF v_bonus <= 0 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'referral_bonus_disabled_or_zero');
    END IF;

    v_idem_key := 'REFERRAL-REWARD:' || v_sub.user_id::text;

    -- Validate referrer profile & active wallet account
    SELECT * INTO v_referrer FROM public.profiles WHERE id = v_user.referred_by;
    IF NOT FOUND OR LOWER(COALESCE(v_referrer.account_status, 'active')) <> 'active' THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'rejected', v_idem_key, 'حساب المُحيل غير نشط أو غير موجود', v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', false, 'paid', false, 'status', 'rejected', 'referral_reward_id', v_reward_id);
    END IF;

    SELECT * INTO v_ref_wallet FROM public.wallets WHERE user_id = v_user.referred_by ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND OR LOWER(v_ref_wallet.status) <> 'active' THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'محفظة المُحيل غير مهيأة أو غير نشطة', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'referral_reward_id', v_reward_id);
    END IF;

    SELECT * INTO v_ref_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_ref_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    LIMIT 1;

    SELECT * INTO v_treasury
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-TREASURY' AND LOWER(status) = 'active'
    LIMIT 1;

    IF v_ref_wallet_acc.id IS NULL OR v_treasury.id IS NULL THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'حساب الخزينة أو الحساب المالي للمُحيل غير متوفر', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'referral_reward_id', v_reward_id);
    END IF;

    -- Lock treasury & referrer wallet account in deterministic UUID order
    PERFORM id FROM public.financial_accounts
    WHERE id IN (v_treasury.id, v_ref_wallet_acc.id)
    ORDER BY id ASC
    FOR UPDATE;

    SELECT * INTO v_treasury FROM public.financial_accounts WHERE id = v_treasury.id;
    SELECT * INTO v_ref_wallet_acc FROM public.financial_accounts WHERE id = v_ref_wallet_acc.id;

    -- Do NOT invent unbacked funding source if PLATFORM-TREASURY balance < v_bonus
    IF v_treasury.balance_units < v_bonus THEN
        INSERT INTO public.referral_rewards (
            referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
            status, idempotency_key, failure_reason, approved_at, created_at, updated_at
        ) VALUES (
            v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
            'pending', v_idem_key, 'رصيد خزينة المنصة (PLATFORM-TREASURY) غير كافٍ لصرف المكافأة تلقائياً', v_now, v_now, v_now
        ) RETURNING id INTO v_reward_id;

        RETURN jsonb_build_object('eligible', true, 'paid', false, 'status', 'pending', 'reason', 'insufficient_treasury_balance', 'referral_reward_id', v_reward_id);
    END IF;

    -- Atomic double-entry ledger transaction: DEBIT PLATFORM-TREASURY, CREDIT WALLET-REFERRER
    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REFERRAL_REWARD',
        'REFERRAL:' || v_sub.user_id::text,
        v_idem_key,
        'posted',
        jsonb_build_object(
            'referrer_id', v_user.referred_by,
            'referred_user_id', v_sub.user_id,
            'submission_id', p_submission_id,
            'task_id', v_sub.task_id,
            'reward_units', v_bonus,
            'description', 'مكافأة إحالة بعد اعتماد أول مهمة للمدعو'
        ),
        v_sub.reviewed_by,
        v_now
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_treasury.id, 'debit', v_bonus, 'صرف مكافأة إحالة من خزينة المنصة', v_now),
        (v_tx_id, v_ref_wallet_acc.id, 'credit', v_bonus, 'مكافأة دعوة صديق بعد إنجاز أول مهمة معتمدة', v_now);

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_bonus ELSE -v_bonus END
    WHERE id = v_treasury.id
    RETURNING balance_units INTO v_new_treasury_bal;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_treasury_bal < 0 THEN
        RAISE EXCEPTION 'Failed to debit PLATFORM-TREASURY safely for referral reward';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_bonus ELSE -v_bonus END
    WHERE id = v_ref_wallet_acc.id
    RETURNING balance_units INTO v_new_wallet_bal;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_wallet_bal < 0 THEN
        RAISE EXCEPTION 'Failed to credit referrer wallet safely for referral reward';
    END IF;

    INSERT INTO public.referral_rewards (
        referrer_id, referred_user_id, trigger_submission_id, task_id, reward_amount,
        status, ledger_transaction_id, idempotency_key, approved_at, paid_at, created_at, updated_at
    ) VALUES (
        v_user.referred_by, v_user.id, p_submission_id, v_sub.task_id, v_bonus,
        'paid', v_tx_id, v_idem_key, v_now, v_now, v_now, v_now
    ) RETURNING id INTO v_reward_id;

    IF to_regclass('public.notifications') IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
        VALUES (
            v_user.referred_by,
            'تم إضافة مكافأة إحالة إلى محفظتك!',
            'أكمل صديقك مهمته الأولى المعتمدة وتم إضافة ' || v_bonus::text || ' ر.ي إلى محفظتك.',
            'REFERRAL_REWARD',
            '/dashboard/referrals',
            v_now
        );
    END IF;

    IF to_regclass('public.financial_audit_logs') IS NOT NULL THEN
        INSERT INTO public.financial_audit_logs (action_type, actor_id, transaction_id, details, created_at)
        VALUES (
            'REFERRAL_REWARD_PAID',
            v_sub.reviewed_by,
            v_tx_id,
            jsonb_build_object(
                'referral_reward_id', v_reward_id,
                'referrer_id', v_user.referred_by,
                'referred_user_id', v_sub.user_id,
                'submission_id', p_submission_id,
                'reward_amount', v_bonus
            ),
            v_now
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', true,
        'paid', true,
        'status', 'paid',
        'referral_reward_id', v_reward_id,
        'transaction_id', v_tx_id,
        'reward_amount', v_bonus
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. ADMIN SETTLEMENT FOR PENDING REFERRAL REWARDS (ONCE TREASURY IS FUNDED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_pending_referral_reward(p_referral_reward_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_rr RECORD;
    v_ref_wallet RECORD;
    v_ref_wallet_acc RECORD;
    v_treasury RECORD;
    v_tx_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_new_bal BIGINT;
    v_rows INT := 0;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('settle_referral_' || p_referral_reward_id::text));

    SELECT * INTO v_rr FROM public.referral_rewards WHERE id = p_referral_reward_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'سجل مكافأة الإحالة غير موجود.'; END IF;
    IF v_rr.status = 'paid' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', 'paid', 'transaction_id', v_rr.ledger_transaction_id);
    END IF;
    IF v_rr.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'لا يمكن صرف مكافأة إحالة بحالة (%).', v_rr.status;
    END IF;

    SELECT * INTO v_ref_wallet FROM public.wallets WHERE user_id = v_rr.referrer_id ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND OR LOWER(v_ref_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'محفظة المُحيل غير نشطة أو غير موجودة.';
    END IF;

    SELECT * INTO v_ref_wallet_acc FROM public.financial_accounts WHERE wallet_id = v_ref_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active' LIMIT 1;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' AND LOWER(status) = 'active' LIMIT 1;
    IF v_ref_wallet_acc.id IS NULL OR v_treasury.id IS NULL THEN
        RAISE EXCEPTION 'الحسابات المالية المطلوبة لصرف مكافأة الإحالة غير مكتملة.';
    END IF;

    PERFORM id FROM public.financial_accounts WHERE id IN (v_treasury.id, v_ref_wallet_acc.id) ORDER BY id ASC FOR UPDATE;
    SELECT * INTO v_treasury FROM public.financial_accounts WHERE id = v_treasury.id;
    IF v_treasury.balance_units < v_rr.reward_amount THEN
        RAISE EXCEPTION 'رصيد خزينة المنصة (%) غير كافٍ لصرف مكافأة الإحالة (%).', v_treasury.balance_units, v_rr.reward_amount;
    END IF;

    INSERT INTO public.ledger_transactions (
        transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
    ) VALUES (
        'REFERRAL_REWARD', 'REFERRAL:' || v_rr.referred_user_id::text, v_rr.idempotency_key, 'posted',
        jsonb_build_object('referrer_id', v_rr.referrer_id, 'referred_user_id', v_rr.referred_user_id, 'submission_id', v_rr.trigger_submission_id, 'reward_units', v_rr.reward_amount, 'description', 'تسوية مكافأة إحالة معلقة'),
        v_admin_id, v_now
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
    VALUES
        (v_tx_id, v_treasury.id, 'debit', v_rr.reward_amount, 'صرف مكافأة إحالة من خزينة المنصة', v_now),
        (v_tx_id, v_ref_wallet_acc.id, 'credit', v_rr.reward_amount, 'مكافأة دعوة صديق بعد إنجاز أول مهمة معتمدة', v_now);

    UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'debit' THEN v_rr.reward_amount ELSE -v_rr.reward_amount END WHERE id = v_treasury.id RETURNING balance_units INTO v_new_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_bal < 0 THEN RAISE EXCEPTION 'Failed to debit PLATFORM-TREASURY safely'; END IF;

    UPDATE public.financial_accounts SET balance_units = balance_units + CASE WHEN LOWER(normal_side) = 'credit' THEN v_rr.reward_amount ELSE -v_rr.reward_amount END WHERE id = v_ref_wallet_acc.id RETURNING balance_units INTO v_new_bal;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_new_bal < 0 THEN RAISE EXCEPTION 'Failed to credit referrer wallet safely'; END IF;

    UPDATE public.referral_rewards
    SET status = 'paid',
        ledger_transaction_id = v_tx_id,
        failure_reason = NULL,
        paid_at = v_now,
        updated_at = v_now
    WHERE id = v_rr.id;

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'paid', 'transaction_id', v_tx_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. USER REFERRAL SUMMARY RPC (REAL DATA FROM PROFILES, SUBMISSIONS & LEDGER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_referral_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_code TEXT;
    v_bonus BIGINT := 0;
    v_total_referred INT := 0;
    v_qualified_count INT := 0;
    v_paid_count INT := 0;
    v_total_earned BIGINT := 0;
    v_items JSONB := '[]'::jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT referral_code INTO v_code FROM public.profiles WHERE id = v_user_id;
    v_bonus := public.get_configured_referral_bonus();

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM public.task_submissions ts
            WHERE ts.user_id = p.id AND LOWER(ts.status) = 'approved' AND ts.reward_transaction_id IS NOT NULL
        ))
    INTO v_total_referred, v_qualified_count
    FROM public.profiles p
    WHERE p.referred_by = v_user_id;

    SELECT
        COUNT(*) FILTER (WHERE rr.status = 'paid' AND rr.ledger_transaction_id IS NOT NULL),
        COALESCE(SUM(rr.reward_amount) FILTER (WHERE rr.status = 'paid' AND rr.ledger_transaction_id IS NOT NULL), 0)
    INTO v_paid_count, v_total_earned
    FROM public.referral_rewards rr
    WHERE rr.referrer_id = v_user_id;

    SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'createdAt') DESC), '[]'::jsonb)
    INTO v_items
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'fullName', p.full_name,
            'createdAt', p.created_at,
            'hasCompletedFirstTask', EXISTS (
                SELECT 1 FROM public.task_submissions ts
                WHERE ts.user_id = p.id AND LOWER(ts.status) = 'approved' AND ts.reward_transaction_id IS NOT NULL
            ),
            'rewardStatus', COALESCE(rr.status, CASE
                WHEN EXISTS (
                    SELECT 1 FROM public.task_submissions ts
                    WHERE ts.user_id = p.id AND LOWER(ts.status) = 'approved' AND ts.reward_transaction_id IS NOT NULL
                ) THEN 'pending'
                ELSE 'awaiting_first_task'
            END),
            'rewardEarned', CASE
                WHEN rr.status = 'paid' AND rr.ledger_transaction_id IS NOT NULL THEN rr.reward_amount
                ELSE 0
            END,
            'paidAt', rr.paid_at
        ) AS item
        FROM public.profiles p
        LEFT JOIN public.referral_rewards rr ON rr.referred_user_id = p.id AND rr.referrer_id = v_user_id
        WHERE p.referred_by = v_user_id
    ) sub;

    RETURN jsonb_build_object(
        'code', COALESCE(v_code, ''),
        'referralBonus', v_bonus,
        'totalReferred', COALESCE(v_total_referred, 0),
        'qualifiedReferralsCount', COALESCE(v_qualified_count, 0),
        'paidRewardsCount', COALESCE(v_paid_count, 0),
        'totalEarnedYer', COALESCE(v_total_earned, 0),
        'referredUsers', v_items
    );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.resolve_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_configured_referral_bonus() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_configured_referral_bonus() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.process_referral_reward_for_submission(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward_for_submission(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.settle_pending_referral_reward(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_pending_referral_reward(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_referral_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_summary() TO authenticated, service_role;
