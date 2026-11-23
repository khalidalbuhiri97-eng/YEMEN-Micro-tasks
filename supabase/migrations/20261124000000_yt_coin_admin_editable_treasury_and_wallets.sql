-- ============================================================================
-- Migration: 20261124000000_yt_coin_admin_editable_treasury_and_wallets.sql
-- Purpose  : Make ALL YT Coin admin economy parameters, max supply,
--            system treasury allocations, and user YT wallet balances
--            server-editable and persistently stored in Supabase with
--            BIGINT 1,000 sub-unit precision and full audit logging.
-- ============================================================================

-- 1. Enforce dynamic max_supply_units from yt_coin.config in treasury trigger
CREATE OR REPLACE FUNCTION yt_coin.enforce_treasury_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_total_allocated bigint;
  v_max_supply_units bigint;
BEGIN
  SELECT COALESCE(max_supply_units, 100000000000)
  INTO v_max_supply_units
  FROM yt_coin.config
  WHERE singleton = true;

  SELECT COALESCE(SUM(allocated_units), 0) INTO v_total_allocated
  FROM yt_coin.system_treasury
  WHERE treasury_key <> NEW.treasury_key;

  IF (v_total_allocated + COALESCE(NEW.allocated_units, 0)) > v_max_supply_units THEN
    RAISE EXCEPTION 'Total YT Coin allocations (% units) cannot exceed configured max supply (% units).',
      (v_total_allocated + COALESCE(NEW.allocated_units, 0)), v_max_supply_units
      USING ERRCODE = '22000';
  END IF;

  IF NEW.is_locked AND COALESCE(NEW.distributed_units, 0) > 0 AND NOT NEW.approved_for_distribution THEN
    RAISE EXCEPTION 'Locked allocation cannot distribute units before approval/vesting.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Update public.get_my_yt_coin_summary() to read maxSupplyYt dynamically
CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_balance_units bigint := 0;
  v_lifetime_units bigint := 0;
  v_ad_earned_units bigint := 0;
  v_wallet_address text;
  v_last_date date;
  v_claimed_today boolean := false;
  v_today_paid_units bigint := 0;
  v_taps_today integer := 0;
  v_ads_today integer := 0;
  v_total_circulating_units bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_rewards_allocated_units bigint := 0;
  v_rewards_distributed_units bigint := 0;
  v_daily_cap_units bigint := 0;
  v_days_elapsed bigint := 0;
  v_user_claims_count bigint := 0;
  v_eligible boolean := false;
  v_next_claim_at timestamptz;
  v_history jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  v_eligible := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  );

  IF v_eligible THEN
    INSERT INTO yt_coin.accounts(user_id, wallet_address)
    VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(lifetime_earned_units, 0),
    COALESCE(ad_earned_units, 0),
    wallet_address
  INTO v_balance_units, v_lifetime_units, v_ad_earned_units, v_wallet_address
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  v_days_elapsed := CASE
    WHEN v_cfg.mining_start_date IS NULL THEN 0
    ELSE GREATEST(0, (v_today - v_cfg.mining_start_date))
  END;

  v_daily_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  SELECT max(claim_date), count(*) INTO v_last_date, v_user_claims_count
  FROM yt_coin.mining_claims WHERE user_id = v_user_id;

  v_claimed_today := (v_last_date = v_today);
  v_next_claim_at := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Aden');

  SELECT COALESCE(paid_units, 0) INTO v_today_paid_units
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(tap_count, 0) INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE user_id = v_user_id AND tap_date = v_today;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id AND event_date = v_today;

  SELECT COALESCE(SUM(balance_units), 0) INTO v_total_circulating_units
  FROM yt_coin.accounts;

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(allocated_units, 0),
    COALESCE(distributed_units, 0)
  INTO v_rewards_remaining_units, v_rewards_allocated_units, v_rewards_distributed_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasuryKey', t.treasury_key,
    'accountType', t.account_type,
    'labelAr', t.label_ar,
    'allocatedUnits', t.allocated_units,
    'allocatedYt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'remainingUnits', t.balance_units,
    'remainingYt', ROUND(t.balance_units::numeric / 1000.0, 3),
    'distributedUnits', t.distributed_units,
    'distributedYt', ROUND(t.distributed_units::numeric / 1000.0, 3),
    'isLocked', t.is_locked,
    'approvedForDistribution', t.approved_for_distribution,
    'vestingSchedule', t.vesting_schedule
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'amountUnits', l.amount_units,
    'amountYt', ROUND(l.amount_units::numeric / 1000.0, 3),
    'reference', l.reference,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 40
  ) l;

  RETURN jsonb_build_object(
    'unitScale', 1000,
    'economyVersion', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_v2'),
    'walletAddress', COALESCE(v_wallet_address, 'yt1' || replace(v_user_id::text, '-', '')),
    'balanceUnits', v_balance_units,
    'balanceYt', ROUND(v_balance_units::numeric / 1000.0, 3),
    'lifetimeEarnedUnits', v_lifetime_units,
    'lifetimeEarnedYt', ROUND(v_lifetime_units::numeric / 1000.0, 3),
    'adEarnedUnits', v_ad_earned_units,
    'adEarnedYt', ROUND(v_ad_earned_units::numeric / 1000.0, 3),
    'miningEnabled', COALESCE(v_cfg.mining_enabled, false),
    'maxSupplyUnits', COALESCE(v_cfg.max_supply_units, 100000000000),
    'maxSupplyYt', ROUND(COALESCE(v_cfg.max_supply_units, 100000000000)::numeric / 1000.0, 3),
    'circulatingSupplyUnits', v_total_circulating_units,
    'circulatingSupplyYt', ROUND(v_total_circulating_units::numeric / 1000.0, 3),
    'poolAllocatedUnits', v_rewards_allocated_units,
    'poolAllocatedYt', ROUND(v_rewards_allocated_units::numeric / 1000.0, 3),
    'poolDistributedUnits', v_rewards_distributed_units,
    'poolRemainingUnits', v_rewards_remaining_units,
    'poolRemainingYt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'baseRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'baseRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tapRewardUnits', COALESCE(v_cfg.tap_reward_units, 10),
    'tapRewardYt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'adClickRewardUnits', COALESCE(v_cfg.ad_click_reward_units, 10),
    'adClickRewardYt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'adViewRewardUnits', COALESCE(v_cfg.ad_view_reward_units, 10),
    'adViewRewardYt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'tapsToday', v_taps_today,
    'dailyTapLimit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'dailyTapsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_tap_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_tap_limit - v_taps_today, 0)
    END,
    'adsToday', v_ads_today,
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'dailyAdsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_ad_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_ad_limit - v_ads_today, 0)
    END,
    'dailyCapUnits', v_daily_cap_units,
    'dailyCapYt', ROUND(v_daily_cap_units::numeric / 1000.0, 3),
    'minedTodayUnits', v_today_paid_units,
    'dailyMinedYt', ROUND(v_today_paid_units::numeric / 1000.0, 3),
    'dailyCapRemainingUnits', GREATEST(v_daily_cap_units - v_today_paid_units, 0),
    'dailyRemainingYt', ROUND(GREATEST(v_daily_cap_units - v_today_paid_units, 0)::numeric / 1000.0, 3),
    'swapEnabled', COALESCE(v_cfg.swap_enabled, false),
    'exchangeRateYerPerYt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'canClaim', v_eligible AND COALESCE(v_cfg.mining_enabled, false) AND NOT v_claimed_today AND v_rewards_remaining_units >= COALESCE(v_cfg.base_reward_units, 500),
    'nextRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'todayRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'lastClaimDate', v_last_date,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'totalClaims', v_user_claims_count,
    'allocations', v_allocations,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

-- 3. Update public.get_yt_coin_admin_summary() to read max_supply_yt & include wallet accounts
CREATE OR REPLACE FUNCTION public.get_yt_coin_admin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_cfg yt_coin.config%ROWTYPE;
  v_circulating_units bigint := 0;
  v_total_mined_units bigint := 0;
  v_today_mined_units bigint := 0;
  v_today_claims integer := 0;
  v_today_taps integer := 0;
  v_today_ads integer := 0;
  v_active_miners bigint := 0;
  v_pending_audit_accounts bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_rewards_allocated_units bigint := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_ad_networks jsonb := '[]'::jsonb;
  v_recent_claims jsonb := '[]'::jsonb;
  v_recent_ad_events jsonb := '[]'::jsonb;
  v_accounts jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT COALESCE(SUM(balance_units), 0), count(*), count(*) FILTER (WHERE migration_audit_status = 'pending_audit')
  INTO v_circulating_units, v_active_miners, v_pending_audit_accounts
  FROM yt_coin.accounts;

  SELECT COALESCE(SUM(amount_units), 0) INTO v_total_mined_units
  FROM yt_coin.ledger WHERE amount_units > 0;

  SELECT COALESCE(paid_units, 0), COALESCE(claim_count, 0)
  INTO v_today_mined_units, v_today_claims
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(SUM(tap_count), 0) INTO v_today_taps
  FROM yt_coin.daily_user_taps WHERE tap_date = v_today;

  SELECT count(*) INTO v_today_ads
  FROM yt_coin.ad_reward_events WHERE event_date = v_today;

  SELECT COALESCE(balance_units, 0), COALESCE(allocated_units, 0)
  INTO v_rewards_remaining_units, v_rewards_allocated_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasury_key', t.treasury_key,
    'account_type', t.account_type,
    'label_ar', t.label_ar,
    'allocated_units', t.allocated_units,
    'allocated_yt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'balance_units', t.balance_units,
    'balance_yt', ROUND(t.balance_units::numeric / 1000.0, 3),
    'distributed_units', t.distributed_units,
    'distributed_yt', ROUND(t.distributed_units::numeric / 1000.0, 3),
    'is_locked', t.is_locked,
    'approved_for_distribution', t.approved_for_distribution,
    'vesting_schedule', t.vesting_schedule,
    'updated_at', t.updated_at
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'network_key', n.network_key,
    'display_name', n.display_name,
    'description', n.description,
    'auth_mode', n.auth_mode,
    'secret_env_key', n.secret_env_key,
    'placement_url', n.placement_url,
    'ad_type', n.ad_type,
    'reward_click_units', n.reward_click_units,
    'reward_click_yt', ROUND(n.reward_click_units::numeric / 1000.0, 3),
    'reward_view_units', n.reward_view_units,
    'reward_view_yt', ROUND(n.reward_view_units::numeric / 1000.0, 3),
    'daily_user_limit', n.daily_user_limit,
    'is_active', n.is_active,
    'updated_at', n.updated_at
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_ad_networks
  FROM yt_coin.ad_networks n;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_recent_claims
  FROM (
    SELECT mc.id, mc.user_id, p.full_name, mc.claim_date, mc.amount_units,
           ROUND(mc.amount_units::numeric / 1000.0, 3) AS amount_yt, mc.created_at
    FROM yt_coin.mining_claims mc
    LEFT JOIN public.profiles p ON p.id = mc.user_id
    ORDER BY mc.created_at DESC LIMIT 20
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(ae)), '[]'::jsonb) INTO v_recent_ad_events
  FROM (
    SELECT e.id, e.user_id, p.full_name, e.network_key, e.external_event_id,
           e.event_type, e.amount_units, ROUND(e.amount_units::numeric / 1000.0, 3) AS amount_yt,
           e.verification_source, e.created_at
    FROM yt_coin.ad_reward_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    ORDER BY e.created_at DESC LIMIT 20
  ) ae;

  SELECT COALESCE(jsonb_agg(row_to_json(ua)), '[]'::jsonb) INTO v_accounts
  FROM (
    SELECT a.user_id, p.full_name, p.phone, p.email, a.wallet_address,
           a.balance_units, ROUND(a.balance_units::numeric / 1000.0, 3) AS balance_yt,
           a.lifetime_earned_units, ROUND(a.lifetime_earned_units::numeric / 1000.0, 3) AS lifetime_earned_yt,
           a.ad_earned_units, ROUND(a.ad_earned_units::numeric / 1000.0, 3) AS ad_earned_yt,
           a.migration_audit_status, a.updated_at
    FROM yt_coin.accounts a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    ORDER BY a.balance_units DESC, a.updated_at DESC
    LIMIT 30
  ) ua;

  RETURN jsonb_build_object(
    'unit_scale', 1000,
    'economy_version', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_v2'),
    'mining_enabled', COALESCE(v_cfg.mining_enabled, true),
    'max_supply_units', COALESCE(v_cfg.max_supply_units, 100000000000),
    'max_supply_yt', ROUND(COALESCE(v_cfg.max_supply_units, 100000000000)::numeric / 1000.0, 3),
    'rewards_treasury_allocated_units', v_rewards_allocated_units,
    'rewards_treasury_allocated_yt', ROUND(v_rewards_allocated_units::numeric / 1000.0, 3),
    'rewards_treasury_balance_units', v_rewards_remaining_units,
    'rewards_treasury_balance_yt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'circulating_supply_units', v_circulating_units,
    'circulating_supply_yt', ROUND(v_circulating_units::numeric / 1000.0, 3),
    'total_mined_units', v_total_mined_units,
    'total_mined_yt', ROUND(v_total_mined_units::numeric / 1000.0, 3),
    'today_mined_units', v_today_mined_units,
    'today_mined_yt', ROUND(v_today_mined_units::numeric / 1000.0, 3),
    'active_miners_count', v_active_miners,
    'pending_audit_accounts', v_pending_audit_accounts,
    'today_claims_count', v_today_claims,
    'today_taps_count', v_today_taps,
    'today_ads_count', v_today_ads,
    'base_reward_units', COALESCE(v_cfg.base_reward_units, 500),
    'base_reward_yt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tap_reward_units', COALESCE(v_cfg.tap_reward_units, 10),
    'tap_reward_yt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'ad_click_reward_units', COALESCE(v_cfg.ad_click_reward_units, 10),
    'ad_click_reward_yt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'ad_view_reward_units', COALESCE(v_cfg.ad_view_reward_units, 10),
    'ad_view_reward_yt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'daily_tap_limit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'daily_ad_limit', COALESCE(v_cfg.daily_ad_limit, 20),
    'daily_cap_start_units', COALESCE(v_cfg.daily_cap_start_units, 1000000),
    'daily_cap_start_yt', ROUND(COALESCE(v_cfg.daily_cap_start_units, 1000000)::numeric / 1000.0, 3),
    'daily_cap_max_units', COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    'daily_cap_max_yt', ROUND(COALESCE(v_cfg.daily_cap_max_units, 1000000000)::numeric / 1000.0, 3),
    'swap_enabled', COALESCE(v_cfg.swap_enabled, false),
    'exchange_rate_yer_per_yt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'treasuries', v_allocations,
    'ad_networks', v_ad_networks,
    'recent_claims', v_recent_claims,
    'recent_ad_events', v_recent_ad_events,
    'accounts', v_accounts,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_admin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_admin_summary() TO authenticated;

-- 4. Update public.admin_update_yt_coin_config() with editable p_max_supply_units
DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric);

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_units bigint DEFAULT NULL,
  p_tap_reward_units bigint DEFAULT NULL,
  p_ad_click_reward_units bigint DEFAULT NULL,
  p_ad_view_reward_units bigint DEFAULT NULL,
  p_daily_tap_limit integer DEFAULT NULL,
  p_daily_ad_limit integer DEFAULT NULL,
  p_daily_cap_start_units bigint DEFAULT NULL,
  p_daily_cap_max_units bigint DEFAULT NULL,
  p_swap_enabled boolean DEFAULT NULL,
  p_exchange_rate_yer_per_yt numeric DEFAULT NULL,
  p_max_supply_units bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_total_allocated bigint := 0;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;

  IF p_max_supply_units IS NOT NULL THEN
    IF p_max_supply_units < 1000 THEN
      RAISE EXCEPTION 'سقف الإصدار الكلي يجب أن لا يقل عن 1 YT (1,000 جزء).' USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(SUM(allocated_units), 0) INTO v_total_allocated FROM yt_coin.system_treasury;
    IF p_max_supply_units < v_total_allocated THEN
      RAISE EXCEPTION 'لا يمكن خفض سقف الإصدار أقل من مجموع التخصيصات الحالية (% YT). عدّل التخصيصات أولاً.',
        ROUND(v_total_allocated::numeric / 1000.0, 3) USING ERRCODE = '22000';
    END IF;
  END IF;

  UPDATE yt_coin.config
  SET mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
      max_supply_units = COALESCE(p_max_supply_units, max_supply_units),
      base_reward_units = COALESCE(NULLIF(GREATEST(p_base_reward_units, 1), 0), base_reward_units),
      tap_reward_units = COALESCE(NULLIF(GREATEST(p_tap_reward_units, 1), 0), tap_reward_units),
      ad_click_reward_units = COALESCE(NULLIF(GREATEST(p_ad_click_reward_units, 1), 0), ad_click_reward_units),
      ad_view_reward_units = COALESCE(NULLIF(GREATEST(p_ad_view_reward_units, 1), 0), ad_view_reward_units),
      daily_tap_limit = COALESCE(GREATEST(p_daily_tap_limit, 0), daily_tap_limit),
      daily_ad_limit = COALESCE(GREATEST(p_daily_ad_limit, 0), daily_ad_limit),
      daily_cap_start_units = COALESCE(NULLIF(GREATEST(p_daily_cap_start_units, 1), 0), daily_cap_start_units),
      daily_cap_max_units = COALESCE(NULLIF(GREATEST(p_daily_cap_max_units, 1), 0), daily_cap_max_units),
      swap_enabled = COALESCE(p_swap_enabled, swap_enabled),
      exchange_rate_yer_per_yt = CASE
        WHEN p_exchange_rate_yer_per_yt IS NOT NULL AND p_exchange_rate_yer_per_yt > 0 THEN p_exchange_rate_yer_per_yt
        ELSE exchange_rate_yer_per_yt
      END,
      updated_at = now()
  WHERE singleton = true
  RETURNING * INTO v_cfg;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_config',
    'yt_coin_config',
    'singleton',
    jsonb_build_object(
      'max_supply_units', v_cfg.max_supply_units,
      'base_reward_units', v_cfg.base_reward_units,
      'tap_reward_units', v_cfg.tap_reward_units,
      'ad_click_reward_units', v_cfg.ad_click_reward_units,
      'ad_view_reward_units', v_cfg.ad_view_reward_units,
      'daily_tap_limit', v_cfg.daily_tap_limit,
      'daily_ad_limit', v_cfg.daily_ad_limit,
      'daily_cap_start_units', v_cfg.daily_cap_start_units,
      'daily_cap_max_units', v_cfg.daily_cap_max_units,
      'exchange_rate_yer_per_yt', v_cfg.exchange_rate_yer_per_yt,
      'mining_enabled', v_cfg.mining_enabled
    )
  );

  RETURN row_to_json(v_cfg)::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric, bigint) TO authenticated;

-- 5. New RPC: public.admin_update_yt_coin_treasury(...)
CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_treasury(
  p_treasury_key text,
  p_label_ar text DEFAULT NULL,
  p_allocated_units bigint DEFAULT NULL,
  p_is_locked boolean DEFAULT NULL,
  p_approved_for_distribution boolean DEFAULT NULL,
  p_vesting_schedule jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_row yt_coin.system_treasury%ROWTYPE;
  v_new_allocated bigint;
  v_new_balance bigint;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM yt_coin.system_treasury
  WHERE treasury_key = trim(COALESCE(p_treasury_key, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'حساب الخزينة غير موجود: %', p_treasury_key USING ERRCODE = '22000';
  END IF;

  v_new_allocated := COALESCE(p_allocated_units, v_row.allocated_units);
  IF v_new_allocated < 0 THEN
    RAISE EXCEPTION 'المخصص لا يمكن أن يكون سالباً.' USING ERRCODE = '22000';
  END IF;
  IF v_new_allocated < v_row.distributed_units THEN
    RAISE EXCEPTION 'لا يمكن خفض المخصص أقل من الكمية الموزعة فعلياً (% YT).',
      ROUND(v_row.distributed_units::numeric / 1000.0, 3) USING ERRCODE = '22000';
  END IF;

  v_new_balance := v_new_allocated - v_row.distributed_units;

  UPDATE yt_coin.system_treasury
  SET label_ar = COALESCE(NULLIF(trim(p_label_ar), ''), label_ar),
      allocated_units = v_new_allocated,
      balance_units = v_new_balance,
      is_locked = COALESCE(p_is_locked, is_locked),
      approved_for_distribution = COALESCE(p_approved_for_distribution, approved_for_distribution),
      vesting_schedule = COALESCE(p_vesting_schedule, vesting_schedule),
      updated_at = now()
  WHERE treasury_key = v_row.treasury_key
  RETURNING * INTO v_row;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_treasury',
    'yt_coin_treasury',
    v_row.treasury_key,
    jsonb_build_object(
      'allocated_units', v_row.allocated_units,
      'balance_units', v_row.balance_units,
      'distributed_units', v_row.distributed_units,
      'is_locked', v_row.is_locked,
      'approved_for_distribution', v_row.approved_for_distribution
    )
  );

  RETURN jsonb_build_object(
    'treasury_key', v_row.treasury_key,
    'label_ar', v_row.label_ar,
    'allocated_units', v_row.allocated_units,
    'allocated_yt', ROUND(v_row.allocated_units::numeric / 1000.0, 3),
    'balance_units', v_row.balance_units,
    'balance_yt', ROUND(v_row.balance_units::numeric / 1000.0, 3),
    'distributed_units', v_row.distributed_units,
    'distributed_yt', ROUND(v_row.distributed_units::numeric / 1000.0, 3),
    'is_locked', v_row.is_locked,
    'approved_for_distribution', v_row.approved_for_distribution,
    'vesting_schedule', v_row.vesting_schedule,
    'updated_at', v_row.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_treasury(text, text, bigint, boolean, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_treasury(text, text, bigint, boolean, boolean, jsonb) TO authenticated;

-- 6. New RPC: public.admin_list_yt_coin_accounts(p_search, p_limit)
CREATE OR REPLACE FUNCTION public.admin_list_yt_coin_accounts(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT a.user_id, p.full_name, p.phone, p.email, a.wallet_address,
           a.balance_units, ROUND(a.balance_units::numeric / 1000.0, 3) AS balance_yt,
           a.lifetime_earned_units, ROUND(a.lifetime_earned_units::numeric / 1000.0, 3) AS lifetime_earned_yt,
           a.ad_earned_units, ROUND(a.ad_earned_units::numeric / 1000.0, 3) AS ad_earned_yt,
           a.migration_audit_status, a.updated_at
    FROM yt_coin.accounts a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    WHERE v_q IS NULL
       OR a.wallet_address ILIKE ('%' || v_q || '%')
       OR COALESCE(p.full_name, '') ILIKE ('%' || v_q || '%')
       OR COALESCE(p.phone, '') ILIKE ('%' || v_q || '%')
       OR COALESCE(p.email, '') ILIKE ('%' || v_q || '%')
    ORDER BY a.balance_units DESC, a.updated_at DESC
    LIMIT v_lim
  ) r;

  RETURN jsonb_build_object('accounts', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_yt_coin_accounts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_yt_coin_accounts(text, integer) TO authenticated;

-- 7. New RPC: public.admin_adjust_yt_coin_wallet(p_user_id, p_new_balance_units, p_reason, p_clear_pending_audit)
CREATE OR REPLACE FUNCTION public.admin_adjust_yt_coin_wallet(
  p_user_id uuid,
  p_new_balance_units bigint,
  p_reason text DEFAULT NULL,
  p_clear_pending_audit boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_acc yt_coin.accounts%ROWTYPE;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_old_balance bigint;
  v_delta bigint;
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'تعديل إداري مباشر لرصيد محفظة YT Coin');
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب.' USING ERRCODE = '22000';
  END IF;

  IF p_new_balance_units IS NULL OR p_new_balance_units < 0 THEN
    RAISE EXCEPTION 'الرصيد الجديد يجب أن يكون موجباً أو صفراً.' USING ERRCODE = '22000';
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (p_user_id, 'yt1' || replace(p_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_acc FROM yt_coin.accounts WHERE user_id = p_user_id FOR UPDATE;
  v_old_balance := COALESCE(v_acc.balance_units, 0);
  v_delta := p_new_balance_units - v_old_balance;

  IF v_delta <> 0 THEN
    SELECT * INTO v_treasury
    FROM yt_coin.system_treasury
    WHERE treasury_key = 'YT-USER-REWARDS'
    FOR UPDATE;

    IF v_delta > 0 THEN
      IF v_treasury.balance_units < v_delta THEN
        RAISE EXCEPTION 'رصيد خزينة مكافآت المستخدمين المتاح (% YT) لا يكفي لإضافة % YT.',
          ROUND(v_treasury.balance_units::numeric / 1000.0, 3),
          ROUND(v_delta::numeric / 1000.0, 3)
          USING ERRCODE = '22000';
      END IF;
      UPDATE yt_coin.system_treasury
      SET balance_units = balance_units - v_delta,
          distributed_units = distributed_units + v_delta,
          updated_at = now()
      WHERE treasury_key = 'YT-USER-REWARDS';
    ELSE
      UPDATE yt_coin.system_treasury
      SET balance_units = LEAST(allocated_units, balance_units + ABS(v_delta)),
          distributed_units = GREATEST(0, distributed_units - ABS(v_delta)),
          updated_at = now()
      WHERE treasury_key = 'YT-USER-REWARDS';
    END IF;
  END IF;

  UPDATE yt_coin.accounts
  SET balance_units = p_new_balance_units,
      lifetime_earned_units = CASE
        WHEN v_delta > 0 THEN lifetime_earned_units + v_delta
        ELSE lifetime_earned_units
      END,
      migration_audit_status = CASE
        WHEN COALESCE(p_clear_pending_audit, true) THEN 'verified'
        ELSE migration_audit_status
      END,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_acc;

  IF v_delta <> 0 THEN
    INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
    VALUES (
      p_user_id,
      'admin_adjustment',
      v_delta,
      v_reason,
      jsonb_build_object(
        'actor_id', v_caller_id,
        'old_balance_units', v_old_balance,
        'new_balance_units', v_acc.balance_units
      )
    );
  END IF;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_adjust_wallet',
    'yt_coin_account',
    p_user_id::text,
    jsonb_build_object(
      'old_balance_units', v_old_balance,
      'new_balance_units', v_acc.balance_units,
      'delta_units', v_delta,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'user_id', v_acc.user_id,
    'wallet_address', v_acc.wallet_address,
    'old_balance_units', v_old_balance,
    'balance_units', v_acc.balance_units,
    'balance_yt', ROUND(v_acc.balance_units::numeric / 1000.0, 3),
    'delta_units', v_delta,
    'migration_audit_status', v_acc.migration_audit_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_yt_coin_wallet(uuid, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_yt_coin_wallet(uuid, bigint, text, boolean) TO authenticated;
