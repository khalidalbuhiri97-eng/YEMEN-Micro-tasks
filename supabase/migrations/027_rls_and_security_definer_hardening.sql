-- ==============================================================================
-- Migration 027: Explicit RLS Least-Privilege Policies & SECURITY DEFINER Hardening
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Scope:
--   1. Harden public.is_admin() with pinned search_path = public, pg_temp and
--      explicit auth.uid() + user_roles/profiles verification.
--   2. Enable RLS + explicit least-privilege policies on:
--      financial_audit_logs, referral_rewards, referral_task_rewards,
--      tax_definitions, tax_settlements, withdrawal_requests,
--      external_accounts, external_deposits, external_account_transfers,
--      external_account_reconciliations, campaigns.
--   3. Harden SECURITY DEFINER functions (cancel_funded_task, create_funded_task,
--      review_task_submission, submit_task_proof, transfer_wallet_units):
--      pinned SET search_path = public, pg_temp, strict caller/role checks,
--      explicit REVOKE/GRANT.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Hardened public.is_admin()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT := LOWER(COALESCE(auth.jwt() ->> 'email', ''));
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_email IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com') THEN
        RETURN TRUE;
    END IF;

    IF to_regclass('public.user_roles') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = v_uid AND ur.role = 'admin'
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_uid AND p.role = 'admin'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Explicit RLS Policies on Financial, Tax, Referral, Withdrawal, External & Campaign Tables
-- ------------------------------------------------------------------------------

-- 2a. financial_audit_logs (Admin read/insert only; immutable audit trail)
DO $$
BEGIN
    IF to_regclass('public.financial_audit_logs') IS NOT NULL THEN
        ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS financial_audit_logs_admin_select ON public.financial_audit_logs;
        DROP POLICY IF EXISTS financial_audit_logs_admin_insert ON public.financial_audit_logs;
        CREATE POLICY financial_audit_logs_admin_select
            ON public.financial_audit_logs FOR SELECT TO authenticated
            USING (public.is_admin());
        CREATE POLICY financial_audit_logs_admin_insert
            ON public.financial_audit_logs FOR INSERT TO authenticated
            WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2b. referral_rewards (Referrer read own rows; Admin full read)
DO $$
BEGIN
    IF to_regclass('public.referral_rewards') IS NOT NULL THEN
        ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS referral_rewards_select_own ON public.referral_rewards;
        DROP POLICY IF EXISTS referral_rewards_admin_all ON public.referral_rewards;
        CREATE POLICY referral_rewards_select_own
            ON public.referral_rewards FOR SELECT TO authenticated
            USING (referrer_id = auth.uid() OR public.is_admin());
        CREATE POLICY referral_rewards_admin_all
            ON public.referral_rewards FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2c. referral_task_rewards (Referrer read own rows; Admin read; trigger/RPC writes only)
DO $$
BEGIN
    IF to_regclass('public.referral_task_rewards') IS NOT NULL THEN
        ALTER TABLE public.referral_task_rewards ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS referral_task_rewards_select_own ON public.referral_task_rewards;
        DROP POLICY IF EXISTS referral_task_rewards_admin_all ON public.referral_task_rewards;
        CREATE POLICY referral_task_rewards_select_own
            ON public.referral_task_rewards FOR SELECT TO authenticated
            USING (referrer_user_id = auth.uid() OR public.is_admin());
        CREATE POLICY referral_task_rewards_admin_all
            ON public.referral_task_rewards FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2d. tax_definitions & tax_settlements (Strict Admin only)
DO $$
BEGIN
    IF to_regclass('public.tax_definitions') IS NOT NULL THEN
        ALTER TABLE public.tax_definitions ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tax_definitions_admin_all ON public.tax_definitions;
        CREATE POLICY tax_definitions_admin_all
            ON public.tax_definitions FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;

    IF to_regclass('public.tax_settlements') IS NOT NULL THEN
        ALTER TABLE public.tax_settlements ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tax_settlements_admin_all ON public.tax_settlements;
        CREATE POLICY tax_settlements_admin_all
            ON public.tax_settlements FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2e. withdrawal_requests (Users read own requests only; Admin manages)
DO $$
BEGIN
    IF to_regclass('public.withdrawal_requests') IS NOT NULL THEN
        ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS withdrawal_requests_select_own ON public.withdrawal_requests;
        DROP POLICY IF EXISTS withdrawal_requests_admin_all ON public.withdrawal_requests;
        CREATE POLICY withdrawal_requests_select_own
            ON public.withdrawal_requests FOR SELECT TO authenticated
            USING (user_id = auth.uid() OR public.is_admin());
        CREATE POLICY withdrawal_requests_admin_all
            ON public.withdrawal_requests FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2f. external_accounts & external_deposits & internal transfers & reconciliations
DO $$
BEGIN
    IF to_regclass('public.external_accounts') IS NOT NULL THEN
        ALTER TABLE public.external_accounts ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS external_accounts_admin_all ON public.external_accounts;
        DROP POLICY IF EXISTS external_accounts_advertiser_select ON public.external_accounts;
        CREATE POLICY external_accounts_admin_all
            ON public.external_accounts FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
        -- Advertisers can view active destination accounts to transfer campaign deposits
        CREATE POLICY external_accounts_advertiser_select
            ON public.external_accounts FOR SELECT TO authenticated
            USING (
                status = 'active'
                AND fund_scope IN ('advertiser', 'mixed')
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role IN ('advertiser', 'admin')
                )
            );
    END IF;

    IF to_regclass('public.external_deposits') IS NOT NULL THEN
        ALTER TABLE public.external_deposits ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS external_deposits_admin_all ON public.external_deposits;
        DROP POLICY IF EXISTS external_deposits_advertiser_select ON public.external_deposits;
        DROP POLICY IF EXISTS external_deposits_advertiser_insert ON public.external_deposits;

        CREATE POLICY external_deposits_admin_all
            ON public.external_deposits FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());

        CREATE POLICY external_deposits_advertiser_select
            ON public.external_deposits FOR SELECT TO authenticated
            USING (advertiser_id = auth.uid() OR public.is_admin());

        -- Advertiser can ONLY insert pending advertiser_wallet deposits for themselves with receipt + ref
        CREATE POLICY external_deposits_advertiser_insert
            ON public.external_deposits FOR INSERT TO authenticated
            WITH CHECK (
                deposit_purpose = 'advertiser_wallet'
                AND advertiser_id = auth.uid()
                AND status = 'pending'
                AND NULLIF(TRIM(reference_number), '') IS NOT NULL
                AND NULLIF(TRIM(receipt_url), '') IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'advertiser'
                )
            );
    END IF;

    IF to_regclass('public.external_account_transfers') IS NOT NULL THEN
        ALTER TABLE public.external_account_transfers ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS external_account_transfers_admin_all ON public.external_account_transfers;
        CREATE POLICY external_account_transfers_admin_all
            ON public.external_account_transfers FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;

    IF to_regclass('public.external_account_reconciliations') IS NOT NULL THEN
        ALTER TABLE public.external_account_reconciliations ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS external_account_reconciliations_admin_all ON public.external_account_reconciliations;
        CREATE POLICY external_account_reconciliations_admin_all
            ON public.external_account_reconciliations FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- 2g. campaigns (Advertiser reads own campaigns; Admin full access; mutations via SECURITY DEFINER RPCs)
DO $$
BEGIN
    IF to_regclass('public.campaigns') IS NOT NULL THEN
        ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS campaigns_select_own ON public.campaigns;
        DROP POLICY IF EXISTS campaigns_admin_all ON public.campaigns;
        CREATE POLICY campaigns_select_own
            ON public.campaigns FOR SELECT TO authenticated
            USING (advertiser_id = auth.uid() OR public.is_admin());
        CREATE POLICY campaigns_admin_all
            ON public.campaigns FOR ALL TO authenticated
            USING (public.is_admin()) WITH CHECK (public.is_admin());
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Harden Core SECURITY DEFINER RPCs (create_funded_task, cancel_funded_task)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_funded_task(TEXT, TEXT, BIGINT, INTEGER, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_funded_task(TEXT, TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_funded_task(
    p_title TEXT,
    p_description TEXT,
    p_reward_units NUMERIC,
    p_slots INTEGER,
    p_creation_key TEXT,
    p_deadline_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_clean_title TEXT := NULLIF(TRIM(COALESCE(p_title, '')), '');
    v_clean_desc TEXT := NULLIF(TRIM(COALESCE(p_description, '')), '');
    v_key TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_creation_key, '')), ''), 'TASK-' || gen_random_uuid()::text);
    v_reward NUMERIC(30,6);
    v_budget NUMERIC(30,6);
    v_existing_task_id UUID;
    v_treasury RECORD;
    v_escrow_id UUID;
    v_task_id UUID := gen_random_uuid();
    v_tx_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    IF v_clean_title IS NULL OR v_clean_desc IS NULL THEN
        RAISE EXCEPTION 'عنوان المهمة والوصف مطلوبان.';
    END IF;
    IF p_reward_units IS NULL OR p_reward_units <= 0 OR p_reward_units <> ROUND(p_reward_units, 6) THEN
        RAISE EXCEPTION 'مكافأة المهمة يجب أن تكون أكبر من صفر وبحد أقصى 6 منازل عشرية.';
    END IF;
    IF p_slots IS NULL OR p_slots <= 0 THEN
        RAISE EXCEPTION 'عدد المقاعد المطلوبة يجب أن يكون أكبر من صفر.';
    END IF;

    v_reward := ROUND(p_reward_units, 6);
    v_budget := ROUND(v_reward * p_slots, 6);

    PERFORM pg_advisory_xact_lock(hashtext('create_task_' || v_key));

    SELECT id INTO v_existing_task_id FROM public.tasks WHERE creation_key = v_key LIMIT 1;
    IF FOUND THEN
        RETURN v_existing_task_id;
    END IF;

    SELECT * INTO v_treasury FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'حساب PLATFORM-TREASURY غير موجود.';
    END IF;

    INSERT INTO public.financial_accounts (
        account_code, account_type, owner_user_id, normal_side, balance_units, status, created_at
    ) VALUES (
        'TASK-ESCROW-' || v_task_id::text, 'treasury', NULL, 'credit', 0, 'active', v_now
    )
    RETURNING id INTO v_escrow_id;

    v_tx_id := public.post_ledger_transaction(
        p_transaction_type := 'task_budget_reservation',
        p_idempotency_key := 'TASK-FUNDING:' || v_key,
        p_reference := 'TASK:' || v_task_id::text,
        p_metadata := jsonb_build_object(
            'task_id', v_task_id,
            'reward_units', v_reward,
            'slots', p_slots,
            'budget_units', v_budget,
            'description', 'حجز ميزانية مهمة إدارية: ' || v_clean_title
        ),
        p_entries := jsonb_build_array(
            jsonb_build_object('account_id', v_treasury.id, 'side', 'debit', 'amount_units', v_budget, 'memo', 'حجز ميزانية مهمة: ' || v_clean_title),
            jsonb_build_object('account_id', v_escrow_id, 'side', 'credit', 'amount_units', v_budget, 'memo', 'ضمان ميزانية مهمة: ' || v_clean_title)
        )
    );

    INSERT INTO public.tasks (
        id, title, description, reward_units, slots, approved_count, completed_quantity,
        total_budget_units, budget_spent_yer, deadline_at, status,
        escrow_account_id, funding_transaction_id, creation_key, created_by, created_at
    ) VALUES (
        v_task_id, v_clean_title, v_clean_desc, v_reward, p_slots, 0, 0,
        v_budget, 0, p_deadline_at, 'active',
        v_escrow_id, v_tx_id, v_key, v_admin_id, v_now
    );

    RETURN v_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_funded_task(
    p_task_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_task RECORD;
    v_release_res JSONB;
BEGIN
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'المهمة غير موجودة.';
    END IF;

    UPDATE public.tasks
    SET status = 'cancelled'
    WHERE id = p_task_id;

    v_release_res := public.release_task_escrow(p_task_id, COALESCE(NULLIF(TRIM(p_reason), ''), 'إلغاء المهمة وتحرير الضمان'));

    RETURN jsonb_build_object(
        'success', true,
        'taskId', p_task_id,
        'status', 'cancelled',
        'escrowRelease', v_release_res
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_funded_task(TEXT, TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_funded_task(TEXT, TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_funded_task(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_funded_task(UUID, TEXT) TO authenticated, service_role;

-- Enforce search_path pinning on all existing sensitive SECURITY DEFINER functions dynamically
DO $$
DECLARE
    v_fn RECORD;
BEGIN
    FOR v_fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
        WHERE p.prosecdef = TRUE
          AND p.proname IN (
              'post_ledger_transaction',
              'transfer_wallet_units',
              'create_funded_task',
              'cancel_funded_task',
              'review_task_submission',
              'submit_task_proof',
              'is_admin',
              'reserve_withdrawal_ledger',
              'settle_withdrawal_ledger',
              'create_funded_campaign',
              'approve_advertiser_campaign',
              'start_advertiser_campaign',
              'settle_advertiser_campaign',
              'process_referral_task_share',
              'settle_pending_referral_task_shares',
              'get_my_referral_summary',
              'approve_external_deposit',
              'execute_internal_account_transfer',
              'reconcile_external_account'
          )
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', v_fn.sig);
    END LOOP;
END $$;
