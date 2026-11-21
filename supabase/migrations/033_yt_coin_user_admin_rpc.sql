CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_balance bigint := 0;
  v_lifetime bigint := 0;
  v_enabled boolean := false;
  v_cap bigint;
  v_last_date date;
  v_last_streak integer := 0;
  v_next_reward bigint := 500000;
  v_history jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT balance_units,lifetime_earned_units INTO v_balance,v_lifetime
  FROM yt_coin.accounts WHERE user_id=v_user_id;
  SELECT mining_enabled,daily_global_cap_units INTO v_enabled,v_cap FROM yt_coin.config WHERE singleton=true;
  SELECT claim_date,streak_day INTO v_last_date,v_last_streak
  FROM yt_coin.mining_claims WHERE user_id=v_user_id ORDER BY claim_date DESC LIMIT 1;
  IF v_last_date = (now() AT TIME ZONE 'Asia/Aden')::date THEN
    v_next_reward := LEAST(500000 + (v_last_streak * 10000),1500000);
  ELSIF v_last_date = (now() AT TIME ZONE 'Asia/Aden')::date - 1 THEN
    v_next_reward := LEAST(500000 + (v_last_streak * 10000),1500000);
  ELSE
    v_next_reward := 500000;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',l.id,'eventType',l.event_type,'amountUnits',l.amount_units,
    'reference',l.reference,'createdAt',l.created_at
  ) ORDER BY l.created_at DESC),'[]'::jsonb)
  INTO v_history FROM (
    SELECT id,event_type,amount_units,reference,created_at FROM yt_coin.ledger
    WHERE user_id=v_user_id ORDER BY created_at DESC LIMIT 30
  ) l;
  RETURN jsonb_build_object(
    'balanceUnits',COALESCE(v_balance,0),'lifetimeEarnedUnits',COALESCE(v_lifetime,0),
    'miningEnabled',COALESCE(v_enabled,false) AND v_cap IS NOT NULL,
    'dailyCapConfigured',v_cap IS NOT NULL,'nextRewardUnits',v_next_reward,
    'lastClaimDate',v_last_date,'streakDay',COALESCE(v_last_streak,0),'history',v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_daily()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  RETURN yt_coin.claim_daily_mining();
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_yt_coin_admin_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_config yt_coin.config%ROWTYPE;
  v_treasury bigint := 0;
  v_total_balance numeric := 0;
  v_account_count bigint := 0;
  v_claims_today bigint := 0;
  v_mined_today bigint := 0;
  v_ledger_count bigint := 0;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_config FROM yt_coin.config WHERE singleton=true;
  SELECT balance_units INTO v_treasury FROM yt_coin.system_treasury WHERE treasury_key='YT-REWARDS-TREASURY';
  SELECT count(*),COALESCE(sum(balance_units),0) INTO v_account_count,v_total_balance FROM yt_coin.accounts;
  SELECT count(*),COALESCE(sum(amount_units),0) INTO v_claims_today,v_mined_today
  FROM yt_coin.mining_claims WHERE claim_date=(now() AT TIME ZONE 'Asia/Aden')::date;
  SELECT count(*) INTO v_ledger_count FROM yt_coin.ledger;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key',allocation_key,'label',label_ar,'allocatedUnits',allocated_units,
    'spentUnits',spent_units,'active',is_active
  ) ORDER BY allocation_key),'[]'::jsonb) INTO v_allocations FROM yt_coin.allocations;
  RETURN jsonb_build_object(
    'maxSupplyUnits',v_config.max_supply_units,'dailyCapUnits',v_config.daily_global_cap_units,
    'miningEnabled',v_config.mining_enabled,'baseRewardUnits',v_config.base_reward_units,
    'incrementUnits',v_config.daily_increment_units,'maxRewardUnits',v_config.max_daily_reward_units,
    'timezone',v_config.timezone_name,'treasuryUnits',COALESCE(v_treasury,0),
    'userBalancesUnits',v_total_balance,'accountCount',v_account_count,
    'claimsToday',v_claims_today,'minedTodayUnits',v_mined_today,
    'ledgerCount',v_ledger_count,'allocations',v_allocations
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_daily() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_yt_coin_admin_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_daily() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_admin_summary() TO authenticated,service_role;
