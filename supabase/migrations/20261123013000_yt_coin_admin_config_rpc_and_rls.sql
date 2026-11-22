-- YT Coin admin config RPC and RLS hardening.
-- Applied to production project pevftfrgtzspiphibbla on 2026-11-23.
-- Does not alter YT balances, supply, treasury allocations, YER wallets/ledgers, or ad-provider enablement.

BEGIN;

ALTER TABLE yt_coin.config
  ADD COLUMN IF NOT EXISTS tap_reward_units bigint NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS daily_tap_limit integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS daily_ad_limit integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ad_click_reward_units bigint NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ad_view_reward_units bigint NOT NULL DEFAULT 10;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='yt_coin_config_tap_reward_positive') THEN
    ALTER TABLE yt_coin.config ADD CONSTRAINT yt_coin_config_tap_reward_positive CHECK (tap_reward_units > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='yt_coin_config_daily_tap_limit_nonnegative') THEN
    ALTER TABLE yt_coin.config ADD CONSTRAINT yt_coin_config_daily_tap_limit_nonnegative CHECK (daily_tap_limit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='yt_coin_config_daily_ad_limit_nonnegative') THEN
    ALTER TABLE yt_coin.config ADD CONSTRAINT yt_coin_config_daily_ad_limit_nonnegative CHECK (daily_ad_limit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='yt_coin_config_ad_click_reward_positive') THEN
    ALTER TABLE yt_coin.config ADD CONSTRAINT yt_coin_config_ad_click_reward_positive CHECK (ad_click_reward_units > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='yt_coin_config_ad_view_reward_positive') THEN
    ALTER TABLE yt_coin.config ADD CONSTRAINT yt_coin_config_ad_view_reward_positive CHECK (ad_view_reward_units > 0);
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_ad_click_reward_units bigint,
  p_ad_view_reward_units bigint,
  p_base_reward_units bigint,
  p_daily_ad_limit integer,
  p_daily_cap_max_units bigint,
  p_daily_cap_start_units bigint,
  p_daily_tap_limit integer,
  p_exchange_rate_yer_per_yt numeric,
  p_mining_enabled boolean,
  p_swap_enabled boolean,
  p_tap_reward_units bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cfg yt_coin.config%ROWTYPE;
  v_actor uuid := auth.uid();
  v_network record;
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF (p_ad_click_reward_units IS NOT NULL AND p_ad_click_reward_units <= 0)
     OR (p_ad_view_reward_units IS NOT NULL AND p_ad_view_reward_units <= 0)
     OR (p_base_reward_units IS NOT NULL AND p_base_reward_units <= 0)
     OR (p_tap_reward_units IS NOT NULL AND p_tap_reward_units <= 0)
     OR (p_daily_ad_limit IS NOT NULL AND p_daily_ad_limit < 0)
     OR (p_daily_tap_limit IS NOT NULL AND p_daily_tap_limit < 0)
     OR (p_daily_cap_max_units IS NOT NULL AND p_daily_cap_max_units <= 0)
     OR (p_daily_cap_start_units IS NOT NULL AND p_daily_cap_start_units <= 0)
     OR (p_exchange_rate_yer_per_yt IS NOT NULL AND p_exchange_rate_yer_per_yt <= 0)
  THEN
    RAISE EXCEPTION 'Invalid YT Coin configuration value' USING ERRCODE = '22023';
  END IF;

  UPDATE yt_coin.config
  SET mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
      base_reward_units = COALESCE(p_base_reward_units, base_reward_units),
      tap_reward_units = COALESCE(p_tap_reward_units, tap_reward_units),
      ad_click_reward_units = COALESCE(p_ad_click_reward_units, ad_click_reward_units),
      ad_view_reward_units = COALESCE(p_ad_view_reward_units, ad_view_reward_units),
      daily_tap_limit = COALESCE(p_daily_tap_limit, daily_tap_limit),
      daily_ad_limit = COALESCE(p_daily_ad_limit, daily_ad_limit),
      daily_global_cap_units = COALESCE(p_daily_cap_start_units, daily_global_cap_units),
      daily_global_cap_max_units = COALESCE(p_daily_cap_max_units, daily_global_cap_max_units),
      reference_yt_per_yer = CASE
        WHEN p_exchange_rate_yer_per_yt IS NULL THEN reference_yt_per_yer
        ELSE round(1::numeric / p_exchange_rate_yer_per_yt, 6)
      END,
      updated_at = v_now
  WHERE singleton = true
  RETURNING * INTO v_cfg;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'YT Coin configuration row is missing';
  END IF;

  -- Market price discovery remains based on completed P2P trades.
  UPDATE yt_coin.market_config
  SET market_enabled = COALESCE(p_swap_enabled, market_enabled),
      updated_at = v_now
  WHERE singleton = true;

  -- Keep history: close the current rule and append a new version.
  FOR v_network IN
    SELECT network_key, enabled FROM yt_coin.ad_networks
  LOOP
    UPDATE yt_coin.ad_reward_rules
    SET ends_at = v_now
    WHERE network_key = v_network.network_key
      AND event_type IN ('qualified_click', 'qualified_view')
      AND ends_at IS NULL
      AND starts_at <= v_now;

    INSERT INTO yt_coin.ad_reward_rules
      (network_key, event_type, reward_parts, daily_user_limit, enabled, starts_at)
    VALUES
      (v_network.network_key, 'qualified_click',
       COALESCE(p_ad_click_reward_units, v_cfg.ad_click_reward_units),
       COALESCE(p_daily_ad_limit, v_cfg.daily_ad_limit),
       v_network.enabled, v_now),
      (v_network.network_key, 'qualified_view',
       COALESCE(p_ad_view_reward_units, v_cfg.ad_view_reward_units),
       COALESCE(p_daily_ad_limit, v_cfg.daily_ad_limit),
       v_network.enabled, v_now);
  END LOOP;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor,
    'admin_update_config',
    'yt_coin_config',
    'singleton',
    jsonb_build_object(
      'mining_enabled', p_mining_enabled,
      'base_reward_units', p_base_reward_units,
      'tap_reward_units', p_tap_reward_units,
      'ad_click_reward_units', p_ad_click_reward_units,
      'ad_view_reward_units', p_ad_view_reward_units,
      'daily_tap_limit', p_daily_tap_limit,
      'daily_ad_limit', p_daily_ad_limit,
      'daily_cap_start_units', p_daily_cap_start_units,
      'daily_cap_max_units', p_daily_cap_max_units,
      'swap_enabled', p_swap_enabled,
      'exchange_rate_yer_per_yt', p_exchange_rate_yer_per_yt
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'config', to_jsonb(v_cfg),
    'market_enabled', (SELECT market_enabled FROM yt_coin.market_config WHERE singleton = true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(bigint,bigint,bigint,integer,bigint,bigint,integer,numeric,boolean,boolean,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(bigint,bigint,bigint,integer,bigint,bigint,integer,numeric,boolean,boolean,bigint) TO authenticated;

ALTER TABLE yt_coin.team_vesting_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.market_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.exchange_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.system_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yt_team_vesting_admin_read ON yt_coin.team_vesting_schedule;
CREATE POLICY yt_team_vesting_admin_read ON yt_coin.team_vesting_schedule
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS yt_market_price_history_authenticated_read ON yt_coin.market_price_history;
CREATE POLICY yt_market_price_history_authenticated_read ON yt_coin.market_price_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS yt_exchange_settlements_admin_read ON yt_coin.exchange_settlements;
CREATE POLICY yt_exchange_settlements_admin_read ON yt_coin.exchange_settlements
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS yt_system_permissions_admin_read ON yt_coin.system_permissions;
CREATE POLICY yt_system_permissions_admin_read ON yt_coin.system_permissions
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON yt_coin.market_price_history TO authenticated;
GRANT SELECT ON yt_coin.team_vesting_schedule, yt_coin.exchange_settlements, yt_coin.system_permissions TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
