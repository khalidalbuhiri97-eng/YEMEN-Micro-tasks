-- ==============================================================================
-- Migration 026: Referral 5% Share Strictly on Platform Net Profit (NUMERIC(30,6))
--                & Separate Fixed First-Task Bonus
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Scope:
--   1. Ensure referral_rewards.reward_amount and referral_task_rewards.amount_units
--      are NUMERIC(30,6) and track platform_net_profit_units.
--   2. Update process_referral_task_share() and settle_pending_referral_task_shares()
--      so the 5% recurring share is computed STRICTLY on positive platform net profit
--      (ROUND(net_profit * 0.05, 6)), paid ONLY from PLATFORM-REFERRAL-REWARDS-FUND.
--      Zero share when platform net profit <= 0.
--   3. Keep fixed first-task signup referral bonus (30) separate & NUMERIC(30,6).
--   4. Update get_my_referral_summary() to report fractional actually paid totals
--      (fixed bonus + 5% net-profit recurring shares).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Ensure NUMERIC(30,6) precision on referral tables & dedicated fund account
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.referral_rewards') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'referral_rewards' AND column_name = 'reward_amount'
        ) THEN
            ALTER TABLE public.referral_rewards
                ALTER COLUMN reward_amount TYPE NUMERIC(30,6) USING ROUND(COALESCE(reward_amount, 0)::numeric, 6);
        END IF;
    END IF;

    IF to_regclass('public.referral_task_rewards') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'referral_task_rewards' AND column_name = 'amount_units'
        ) THEN
            ALTER TABLE public.referral_task_rewards
                ALTER COLUMN amount_units TYPE NUMERIC(30,6) USING ROUND(COALESCE(amount_units, 0)::numeric, 6);
        END IF;

        ALTER TABLE public.referral_task_rewards
            ADD COLUMN IF NOT EXISTS platform_net_profit_units NUMERIC(30,6) NOT NULL DEFAULT 0;
    END IF;
END $$;

INSERT INTO public.financial_accounts
    (account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status)
VALUES
    ('PLATFORM-REFERRAL-REWARDS-FUND', 'treasury', NULL, NULL, 'credit', 0, 'active')
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. Upgrade get_configured_referral_bonus() to NUMERIC(30,6)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_configured_referral_bonus();
CREATE OR REPLACE FUNCTION public.get_configured_referral_bonus()
RETURNS NUMERIC(30,6)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bonus NUMERIC(30,6) := 30.000000;
    v_has_kv BOOLEAN := false;
    v_has_col BOOLEAN := false;
    v_raw TEXT;
BEGIN
    IF to_regclass('public.platform_settings') IS NULL THEN
        RETURN v_bonus;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'referral_bonus'
    ) INTO v_has_col;

    IF v_has_col THEN
        SELECT ROUND(COALESCE(referral_bonus, 30)::numeric, 6)
        INTO v_bonus
        FROM public.platform_settings
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;
        RETURN COALESCE(v_bonus, 30.000000);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'setting_key'
    ) INTO v_has_kv;

    IF v_has_kv THEN
        SELECT (setting_value #>> '{}')
        INTO v_raw
        FROM public.platform_settings
        WHERE setting_key = 'referral_bonus'
        LIMIT 1;
        IF v_raw IS NOT NULL AND v_raw ~ '^\d+(\.\d{1,6})?$' THEN
            RETURN ROUND(v_raw::NUMERIC(30,6), 6);
        END IF;
    END IF;

    RETURN COALESCE(v_bonus, 30.000000);
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Trigger function: process_referral_task_share()
--    - 5% ONLY on positive platform net profit per completed task slot
--    - Paid strictly from PLATFORM-REFERRAL-REWARDS-FUND via canonical post_ledger_transaction
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_referral_task_share()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_referrer_id UUID;
    v_net_profit_units NUMERIC(30,6) := 0;
    v_share_units NUMERIC(30,6) := 0;
    v_referrer_wallet_id UUID;
    v_fund_id UUID;
    v_fund_balance NUMERIC(30,6);
    v_reward_id UUID;
    v_transaction_id UUID;
    v_task RECORD;
    v_campaign RECORD;
BEGIN
    IF LOWER(COALESCE(NEW.status, '')) <> 'approved' OR NEW.reward_transaction_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND LOWER(COALESCE(OLD.status, '')) = 'approved'
       AND OLD.reward_transaction_id IS NOT DISTINCT FROM NEW.reward_transaction_id THEN
        RETURN NEW;
    END IF;

    SELECT p.referred_by INTO v_referrer_id
    FROM public.profiles p
    WHERE p.id = NEW.user_id;

    IF v_referrer_id IS NULL OR v_referrer_id = NEW.user_id THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = NEW.task_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Platform net profit for this task execution:
    -- 1. Explicit tasks.commission_units if > 0
    -- 2. Else if linked to an advertiser campaign whose fee has been realized, per-slot fee
    -- 3. Else 0 (zero profit => zero 5% share)
    v_net_profit_units := ROUND(COALESCE(v_task.commission_units, 0)::numeric, 6);

    IF v_net_profit_units <= 0 AND v_task.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_task.campaign_id;
        IF FOUND AND COALESCE(v_campaign.fee_units, 0) > 0 AND COALESCE(v_campaign.slots, 0) > 0 THEN
            v_net_profit_units := ROUND(v_campaign.fee_units / v_campaign.slots, 6);
        END IF;
    END IF;

    IF v_net_profit_units IS NULL OR v_net_profit_units <= 0 THEN
        RETURN NEW;
    END IF;

    v_share_units := ROUND(v_net_profit_units * 0.05, 6);
    IF v_share_units <= 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.referral_task_rewards (
        referrer_user_id, referred_user_id, task_submission_id,
        amount_units, platform_net_profit_units, status, idempotency_key, metadata
    ) VALUES (
        v_referrer_id, NEW.user_id, NEW.id,
        v_share_units, v_net_profit_units, 'pending',
        'REFERRAL-TASK-SHARE:' || NEW.id::text,
        jsonb_build_object(
            'rate_percent', 5,
            'platform_net_profit_units', v_net_profit_units,
            'calculation', 'ROUND(platform_net_profit_units * 0.05, 6)'
        )
    )
    ON CONFLICT (task_submission_id) DO NOTHING;

    SELECT id INTO v_reward_id
    FROM public.referral_task_rewards
    WHERE task_submission_id = NEW.id
    FOR UPDATE;

    IF v_reward_id IS NULL OR EXISTS (
        SELECT 1 FROM public.referral_task_rewards WHERE id = v_reward_id AND status <> 'pending'
    ) THEN
        RETURN NEW;
    END IF;

    SELECT fa.id INTO v_referrer_wallet_id
    FROM public.wallets w
    JOIN public.financial_accounts fa ON fa.wallet_id = w.id
    WHERE w.user_id = v_referrer_id AND fa.account_type = 'wallet' AND LOWER(fa.status) = 'active'
    FOR UPDATE OF fa;

    SELECT id, balance_units INTO v_fund_id, v_fund_balance
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-REFERRAL-REWARDS-FUND'
      AND account_type = 'treasury'
      AND LOWER(status) = 'active'
    FOR UPDATE;

    IF v_referrer_wallet_id IS NULL OR v_fund_id IS NULL OR COALESCE(v_fund_balance, 0) < v_share_units THEN
        UPDATE public.referral_task_rewards
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'pending_reason',
            CASE
                WHEN v_referrer_wallet_id IS NULL THEN 'referrer_wallet_account_unavailable'
                WHEN v_fund_id IS NULL THEN 'referral_rewards_fund_unavailable'
                ELSE 'insufficient_referral_rewards_fund'
            END
        )
        WHERE id = v_reward_id AND status = 'pending';
        RETURN NEW;
    END IF;

    v_transaction_id := public.post_ledger_transaction(
        p_transaction_type := 'REFERRAL_TASK_SHARE',
        p_idempotency_key := 'REFERRAL-TASK-SHARE:' || NEW.id::text,
        p_reference := 'REFERRAL-SHARE:' || NEW.id::text,
        p_metadata := jsonb_build_object(
            'referrer_user_id', v_referrer_id,
            'referred_user_id', NEW.user_id,
            'task_submission_id', NEW.id,
            'rate_percent', 5,
            'platform_net_profit_units', v_net_profit_units,
            'share_units', v_share_units,
            'description', 'عمولة إحالة 5% من صافي ربح المنصة للمهمة المعتمدة'
        ),
        p_entries := jsonb_build_array(
            jsonb_build_object('account_id', v_fund_id, 'side', 'debit', 'amount_units', v_share_units, 'memo', 'صرف حصة إحالة 5% من صندوق مكافآت الإحالة'),
            jsonb_build_object('account_id', v_referrer_wallet_id, 'side', 'credit', 'amount_units', v_share_units, 'memo', 'عمولة إحالة 5% من صافي ربح المهمة')
        )
    );

    UPDATE public.referral_task_rewards
    SET status = 'posted',
        ledger_transaction_id = v_transaction_id,
        posted_at = NOW(),
        metadata = COALESCE(metadata, '{}'::jsonb) - 'pending_reason'
    WHERE id = v_reward_id AND status = 'pending';

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Settle queued referral_task_rewards when fund is topped up
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_pending_referral_task_shares()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_wallet_id UUID;
    v_fund_id UUID;
    v_fund_balance NUMERIC(30,6);
    v_tx_id UUID;
    v_count INTEGER := 0;
BEGIN
    FOR r IN
        SELECT id, referrer_user_id, task_submission_id, amount_units, platform_net_profit_units, idempotency_key
        FROM public.referral_task_rewards
        WHERE status = 'pending'
          AND amount_units > 0
          AND platform_net_profit_units > 0
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
    LOOP
        SELECT fa.id INTO v_wallet_id
        FROM public.wallets w
        JOIN public.financial_accounts fa ON fa.wallet_id = w.id
        WHERE w.user_id = r.referrer_user_id AND fa.account_type = 'wallet' AND LOWER(fa.status) = 'active'
        FOR UPDATE OF fa;

        SELECT id, balance_units INTO v_fund_id, v_fund_balance
        FROM public.financial_accounts
        WHERE account_code = 'PLATFORM-REFERRAL-REWARDS-FUND'
          AND account_type = 'treasury'
          AND LOWER(status) = 'active'
        FOR UPDATE;

        IF v_wallet_id IS NULL OR v_fund_id IS NULL OR COALESCE(v_fund_balance, 0) < r.amount_units THEN
            CONTINUE;
        END IF;

        v_tx_id := public.post_ledger_transaction(
            p_transaction_type := 'REFERRAL_TASK_SHARE',
            p_idempotency_key := r.idempotency_key,
            p_reference := 'REFERRAL-SHARE:' || r.task_submission_id::text,
            p_metadata := jsonb_build_object(
                'referral_task_reward_id', r.id,
                'rate_percent', 5,
                'platform_net_profit_units', r.platform_net_profit_units,
                'description', 'تسوية حصة إحالة 5% من صافي ربح المنصة'
            ),
            p_entries := jsonb_build_array(
                jsonb_build_object('account_id', v_fund_id, 'side', 'debit', 'amount_units', r.amount_units, 'memo', 'تسوية حصة إحالة 5%'),
                jsonb_build_object('account_id', v_wallet_id, 'side', 'credit', 'amount_units', r.amount_units, 'memo', 'عمولة إحالة 5% من صافي ربح المنصة')
            )
        );

        UPDATE public.referral_task_rewards
        SET status = 'posted',
            ledger_transaction_id = v_tx_id,
            posted_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) - 'pending_reason'
        WHERE id = r.id AND status = 'pending';

        IF FOUND THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Update get_my_referral_summary() for 6-decimal precision & net-profit shares
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
    v_bonus NUMERIC(30,6) := 30;
    v_total_referred INT := 0;
    v_qualified_count INT := 0;
    v_paid_signup_count INT := 0;
    v_paid_signup_total NUMERIC(30,6) := 0;
    v_paid_share_count INT := 0;
    v_paid_share_total NUMERIC(30,6) := 0;
    v_total_earned NUMERIC(30,6) := 0;
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
    INTO v_paid_signup_count, v_paid_signup_total
    FROM public.referral_rewards rr
    WHERE rr.referrer_id = v_user_id;

    IF to_regclass('public.referral_task_rewards') IS NOT NULL THEN
        SELECT
            COUNT(*) FILTER (WHERE rtr.status = 'posted' AND rtr.ledger_transaction_id IS NOT NULL),
            COALESCE(SUM(rtr.amount_units) FILTER (WHERE rtr.status = 'posted' AND rtr.ledger_transaction_id IS NOT NULL), 0)
        INTO v_paid_share_count, v_paid_share_total
        FROM public.referral_task_rewards rtr
        WHERE rtr.referrer_user_id = v_user_id;
    END IF;

    v_total_earned := ROUND(COALESCE(v_paid_signup_total, 0) + COALESCE(v_paid_share_total, 0), 6);

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
            'rewardEarned', ROUND(
                COALESCE(CASE WHEN rr.status = 'paid' AND rr.ledger_transaction_id IS NOT NULL THEN rr.reward_amount ELSE 0 END, 0)
                + COALESCE((
                    SELECT SUM(rtr.amount_units)
                    FROM public.referral_task_rewards rtr
                    WHERE rtr.referrer_user_id = v_user_id
                      AND rtr.referred_user_id = p.id
                      AND rtr.status = 'posted'
                      AND rtr.ledger_transaction_id IS NOT NULL
                ), 0),
                6
            ),
            'paidAt', rr.paid_at
        ) AS item
        FROM public.profiles p
        LEFT JOIN public.referral_rewards rr ON rr.referred_user_id = p.id AND rr.referrer_id = v_user_id
        WHERE p.referred_by = v_user_id
    ) sub;

    RETURN jsonb_build_object(
        'code', COALESCE(v_code, ''),
        'referralBonus', v_bonus,
        'netProfitSharePercentage', 5,
        'totalReferred', COALESCE(v_total_referred, 0),
        'qualifiedReferralsCount', COALESCE(v_qualified_count, 0),
        'paidRewardsCount', COALESCE(v_paid_signup_count, 0) + COALESCE(v_paid_share_count, 0),
        'paidSignupBonusTotal', COALESCE(v_paid_signup_total, 0),
        'paidTaskShareTotal', COALESCE(v_paid_share_total, 0),
        'totalEarnedYer', COALESCE(v_total_earned, 0),
        'referredUsers', v_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_configured_referral_bonus() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_configured_referral_bonus() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.process_referral_task_share() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_pending_referral_task_shares() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pending_referral_task_shares() TO service_role;

REVOKE ALL ON FUNCTION public.get_my_referral_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_summary() TO authenticated, service_role;
