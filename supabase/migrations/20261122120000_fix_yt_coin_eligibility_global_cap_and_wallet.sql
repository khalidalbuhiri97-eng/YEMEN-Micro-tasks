-- Repair YT Coin mining eligibility, per-user account initialization and
-- platform-wide daily cap. YT Coin remains fully isolated from all YER ledgers.
-- Existing balances and historical mining claims are preserved.

UPDATE yt_coin.config
SET daily_global_cap_max_units = 1000000000, -- hard safety ceiling: 1,000 YT/day
    updated_at = now()
WHERE singleton = true;

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
  v_cap_start bigint := 0;
  v_cap_increment bigint := 0;
  v_cap_max bigint := 0;
  v_start_date date;
  v_last_date date;
  v_last_streak integer := 0;
  v_display_streak integer := 0;
  v_next_reward bigint := 500000;
  v_today_paid bigint := 0;
  v_eligible boolean := false;
  v_eligible_count bigint := 0;
  v_history jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT mining_enabled, daily_global_cap_units, daily_global_cap_increment_units,
         daily_global_cap_max_units, mining_start_date
  INTO v_enabled, v_cap_start, v_cap_increment, v_cap_max, v_start_date
  FROM yt_coin.config WHERE singleton = true;

  v_eligible := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  ) AND EXISTS (
    SELECT 1 FROM public.task_submissions ts
    WHERE ts.user_id = v_user_id AND lower(ts.status) = 'approved'
      AND ts.reward_transaction_id IS NOT NULL
  );

  -- Provision a zero-balance YT account only for eligible users; never mint here.
  IF v_eligible THEN
    INSERT INTO yt_coin.accounts(user_id)
    VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT COALESCE(balance_units, 0), COALESCE(lifetime_earned_units, 0)
  INTO v_balance, v_lifetime
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  SELECT count(*) INTO v_eligible_count
  FROM public.profiles p
  WHERE p.account_status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.task_submissions ts
      WHERE ts.user_id = p.id AND lower(ts.status) = 'approved'
        AND ts.reward_transaction_id IS NOT NULL
    );

  -- The global cap must cover every eligible user at the maximum individual reward.
  v_cap := CASE WHEN v_start_date IS NULL THEN 0 ELSE LEAST(
    GREATEST(
      v_cap_start + GREATEST(v_today - v_start_date, 0)::bigint * v_cap_increment,
      v_eligible_count * 1500000
    ),
    v_cap_max
  ) END;

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
    'miningEnabled', COALESCE(v_enabled, false) AND v_start_date IS NOT NULL,
    'dailyCapConfigured', v_start_date IS NOT NULL,
    'dailyCapUnits', v_cap,
    'dailyCapStartUnits', v_cap_start,
    'dailyCapIncrementUnits', v_cap_increment,
    'dailyCapMaxUnits', v_cap_max,
    'dailyCapRemainingUnits', GREATEST(COALESCE(v_cap, 0) - COALESCE(v_today_paid, 0), 0),
    'eligible', v_eligible,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_enabled, false) OR v_start_date IS NULL THEN 'التعدين غير متاح حالياً.'
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

CREATE OR REPLACE FUNCTION yt_coin.claim_daily_mining()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date;
  v_cap bigint;
  v_eligible_count bigint := 0;
  v_last_date date;
  v_last_streak integer := 0;
  v_streak integer;
  v_reward bigint;
  v_daily_paid bigint;
  v_treasury bigint;
  v_ledger_id uuid;
  v_claim_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.daily_global_cap_units IS NULL
     OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين غير متاح حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.task_submissions ts
    WHERE ts.user_id = v_user_id AND lower(ts.status) = 'approved'
      AND ts.reward_transaction_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'يجب اعتماد مهمة واحدة على الأقل قبل أهلية التعدين.');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Aden')::date;

  SELECT count(*) INTO v_eligible_count
  FROM public.profiles p
  WHERE p.account_status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.task_submissions ts
      WHERE ts.user_id = p.id AND lower(ts.status) = 'approved'
        AND ts.reward_transaction_id IS NOT NULL
    );

  v_cap := LEAST(
    GREATEST(
      v_cfg.daily_global_cap_units
        + (GREATEST(v_today - v_cfg.mining_start_date, 0)::bigint * v_cfg.daily_global_cap_increment_units),
      v_eligible_count * v_cfg.max_daily_reward_units
    ),
    v_cfg.daily_global_cap_max_units
  );

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة التعدين لهذا اليوم.');
  END IF;

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  v_streak := CASE WHEN v_last_date = v_today - 1 THEN LEAST(v_last_streak + 1, 101) ELSE 1 END;
  v_reward := LEAST(v_cfg.base_reward_units + ((v_streak - 1) * v_cfg.daily_increment_units), v_cfg.max_daily_reward_units);

  INSERT INTO yt_coin.daily_mining_totals(claim_date) VALUES (v_today) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF v_daily_paid + v_reward > v_cap THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'daily_cap_reached',
      'message', 'تم بلوغ سقف التعدين اليومي للمنصة.',
      'daily_cap_units', v_cap,
      'daily_paid_units', v_daily_paid,
      'daily_remaining_units', GREATEST(v_cap - v_daily_paid, 0)
    );
  END IF;

  SELECT balance_units INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص التعدين غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id,event_type,amount_units,reference,metadata)
  VALUES (
    v_user_id,'mining_reward',v_reward,
    'YT-MINING:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object('claim_date',v_today,'streak_day',v_streak,'timezone','Asia/Aden',
      'daily_cap_units',v_cap,'daily_cap_increment_units',v_cfg.daily_global_cap_increment_units)
  ) RETURNING id INTO v_ledger_id;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward,
      lifetime_earned_units = lifetime_earned_units + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO yt_coin.mining_claims(user_id,claim_date,streak_day,amount_units,ledger_id)
  VALUES (v_user_id,v_today,v_streak,v_reward,v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward, claim_count = claim_count + 1, updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
  VALUES (
    v_user_id,'daily_mining_claim','mining_claim',v_claim_id::text,
    jsonb_build_object('amount_units',v_reward,'streak_day',v_streak,
      'claim_date',v_today,'daily_cap_units',v_cap)
  );

  RETURN jsonb_build_object(
    'success',true,'status','claimed','amount_units',v_reward,
    'streak_day',v_streak,'claim_date',v_today,
    'daily_cap_units',v_cap,
    'daily_remaining_units',GREATEST(v_cap - (v_daily_paid + v_reward),0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated;
