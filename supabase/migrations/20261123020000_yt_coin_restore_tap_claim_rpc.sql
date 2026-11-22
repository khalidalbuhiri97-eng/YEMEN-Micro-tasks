-- Restore YT Coin tap claim RPC against the production schema.
-- Does not touch Yemeni-riyal wallets/ledgers or existing YT balances.
BEGIN;

CREATE TABLE IF NOT EXISTS yt_coin.daily_user_taps (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_date date NOT NULL,
  tap_count integer NOT NULL DEFAULT 0 CHECK (tap_count >= 0),
  paid_units bigint NOT NULL DEFAULT 0 CHECK (paid_units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tap_date)
);

ALTER TABLE yt_coin.daily_user_taps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yt_coin.daily_user_taps FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION yt_coin.claim_tap_mining(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_taps integer := COALESCE(p_taps, 1);
  v_taps_today integer := 0;
  v_reward_units bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_total_mined_units bigint := 0;
  v_treasury_balance bigint := 0;
  v_new_balance_units bigint := 0;
  v_daily_limit integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_taps < 1 OR v_taps > 200 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_taps',
      'message', 'عدد النقرات يجب أن يكون بين 1 و200.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched',
      'message', 'التعدين متوقف حالياً.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible',
      'message', 'حساب المستخدم غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  INSERT INTO yt_coin.daily_user_taps(user_id, tap_date, tap_count, paid_units)
  VALUES (v_user_id, v_today, 0, 0)
  ON CONFLICT (user_id, tap_date) DO NOTHING;
  SELECT tap_count INTO v_taps_today
  FROM yt_coin.daily_user_taps
  WHERE user_id = v_user_id AND tap_date = v_today FOR UPDATE;

  v_daily_limit := COALESCE(v_cfg.daily_tap_limit, 0);
  IF v_daily_limit > 0 THEN
    IF v_taps_today >= v_daily_limit THEN
      RETURN jsonb_build_object('success', false, 'status', 'daily_tap_limit_reached',
        'message', 'تم بلوغ الحد اليومي للنقرات.',
        'tapsToday', v_taps_today, 'dailyTapLimit', v_daily_limit,
        'dailyTapsRemaining', 0);
    END IF;
    v_taps := LEAST(v_taps, v_daily_limit - v_taps_today);
  END IF;

  v_reward_units := v_taps::bigint * COALESCE(v_cfg.tap_reward_units, 10);
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_global_cap_max_units, 10000000),
    COALESCE(v_cfg.daily_global_cap_units, 1000000)
      + GREATEST(0, (v_today - v_cfg.mining_start_date)::bigint)
        * COALESCE(v_cfg.daily_global_cap_increment_units, 0)
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid_units
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF v_daily_paid_units + v_reward_units > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached',
      'message', 'تم بلوغ السقف اليومي للمنصة.',
      'dailyCapUnits', v_cap_units, 'dailyPaidUnits', v_daily_paid_units,
      'dailyRemainingUnits', GREATEST(v_cap_units - v_daily_paid_units, 0));
  END IF;

  SELECT COALESCE(sum(amount_units), 0) INTO v_total_mined_units
  FROM yt_coin.ledger WHERE event_type IN ('mining_reward', 'tap_mining_reward');
  IF v_total_mined_units + v_reward_units > COALESCE(v_cfg.max_supply_units, 100000000000) THEN
    RETURN jsonb_build_object('success', false, 'status', 'max_supply_reached',
      'message', 'تم بلوغ الحد الأقصى لمعروض YT Coin.');
  END IF;

  SELECT balance_units INTO v_treasury_balance
  FROM yt_coin.system_treasury
  WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF NOT FOUND OR v_treasury_balance < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient',
      'message', 'رصيد خزينة مكافآت YT Coin غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    v_user_id, 'tap_mining_reward', v_reward_units,
    'YT-TAP:' || v_user_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('tapDate', v_today, 'taps', v_taps,
      'tapRewardUnits', COALESCE(v_cfg.tap_reward_units, 10), 'unitScale', 1000)
  );

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';
  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance_units;
  UPDATE yt_coin.daily_user_taps
  SET tap_count = tap_count + v_taps,
      paid_units = paid_units + v_reward_units, updated_at = now()
  WHERE user_id = v_user_id AND tap_date = v_today;
  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units,
      claim_count = claim_count + 1, updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true, 'status', 'credited', 'unitScale', 1000,
    'tapsCredited', v_taps, 'rewardUnits', v_reward_units,
    'amountUnits', v_reward_units,
    'rewardYt', round(v_reward_units::numeric / 1000, 3),
    'balanceUnits', v_new_balance_units,
    'tapsToday', v_taps_today + v_taps, 'dailyTapLimit', v_daily_limit,
    'dailyTapsRemaining', CASE WHEN v_daily_limit <= 0 THEN NULL
      ELSE GREATEST(v_daily_limit - (v_taps_today + v_taps), 0) END,
    'dailyCapUnits', v_cap_units,
    'dailyRemainingUnits', GREATEST(v_cap_units - (v_daily_paid_units + v_reward_units), 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_taps(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN yt_coin.claim_tap_mining(p_taps);
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_tap_mining(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_tap_mining(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_taps(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_taps(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
