-- Keep source migration history aligned with the production YT Coin summary RPC.
CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_balance bigint := 0;
  v_lifetime bigint := 0;
  v_enabled boolean := false;
  v_cap bigint := 0;
  v_last_date date;
  v_last_streak integer := 0;
  v_display_streak integer := 0;
  v_next_reward bigint := 500000;
  v_today_paid bigint := 0;
  v_eligible boolean := false;
  v_history jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT balance_units, lifetime_earned_units INTO v_balance, v_lifetime
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  SELECT mining_enabled, daily_global_cap_units INTO v_enabled, v_cap
  FROM yt_coin.config WHERE singleton = true;

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  IF v_last_date = v_today OR v_last_date = v_today - 1 THEN
    v_display_streak := COALESCE(v_last_streak, 0);
    v_next_reward := LEAST(500000 + (COALESCE(v_last_streak, 0) * 10000), 1500000);
  ELSE
    v_display_streak := 0;
    v_next_reward := 500000;
  END IF;

  SELECT COALESCE(paid_units, 0) INTO v_today_paid
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  v_eligible := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  ) AND EXISTS (
    SELECT 1 FROM public.task_submissions ts
    WHERE ts.user_id = v_user_id AND lower(ts.status) = 'approved'
      AND ts.reward_transaction_id IS NOT NULL
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'eventType', l.event_type, 'amountUnits', l.amount_units,
    'reference', l.reference, 'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) l;

  RETURN jsonb_build_object(
    'balanceUnits', COALESCE(v_balance, 0),
    'lifetimeEarnedUnits', COALESCE(v_lifetime, 0),
    'miningEnabled', COALESCE(v_enabled, false) AND v_cap IS NOT NULL,
    'dailyCapConfigured', v_cap IS NOT NULL,
    'dailyCapRemainingUnits', GREATEST(COALESCE(v_cap, 0) - COALESCE(v_today_paid, 0), 0),
    'eligible', v_eligible,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_enabled, false) OR v_cap IS NULL THEN 'التعدين غير متاح حالياً.'
      WHEN NOT v_eligible THEN 'يلزم حساب نشط ومهمة واحدة معتمدة على الأقل.'
      ELSE NULL
    END,
    'nextRewardUnits', v_next_reward,
    'lastClaimDate', v_last_date,
    'streakDay', v_display_streak,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;
