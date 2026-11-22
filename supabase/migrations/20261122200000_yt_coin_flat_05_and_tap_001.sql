-- ============================================================================
-- YT COIN: FLAT 0.5 YT DAILY REWARD (NO DAILY GROWTH) + 0.01 YT PER TAP
-- ============================================================================
-- Precision model:
--   100 internal units = 1.00 YT (1 internal unit = 0.01 YT)
--   - 1 tap            =   1 unit  = 0.01 YT
--   - Daily claim      =  50 units = 0.50 YT (constant every day, no growth)
--   - Max supply       = 1,000,000,000 YT = 100,000,000,000 units
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS yt_coin;

-- 1. Extend yt_coin.config cleanly
ALTER TABLE yt_coin.config
  ADD COLUMN IF NOT EXISTS unit_scale integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS tap_reward_units bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS daily_tap_limit integer NOT NULL DEFAULT 1000;

-- Migrate existing ledger/account units safely & idempotently to scale = 100 (1 unit = 0.01 YT)
DO $$
DECLARE
  v_cfg yt_coin.config%ROWTYPE;
  v_scale integer := 2;
  v_mult bigint := 50;
BEGIN
  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO yt_coin.config (
      singleton,
      mining_enabled,
      unit_scale,
      max_supply_units,
      base_reward_units,
      daily_increment_units,
      max_daily_reward_units,
      tap_reward_units,
      daily_tap_limit,
      daily_cap_start_units,
      daily_cap_increment_units,
      daily_cap_max_units,
      daily_global_cap_units,
      daily_global_cap_increment_units,
      daily_global_cap_max_units,
      mining_start_date
    ) VALUES (
      true,
      true,
      100,
      100000000000,
      50,
      0,
      50,
      1,
      1000,
      100000,
      1000,
      100000000,
      100000,
      1000,
      100000000,
      (now() AT TIME ZONE 'Asia/Aden')::date
    );
  ELSE
    v_scale := COALESCE(v_cfg.unit_scale, 2);
    IF v_scale <> 100 THEN
      IF COALESCE(v_cfg.max_supply_units, 0) <= 1500000000 THEN
        v_mult := 100;
      ELSIF COALESCE(v_cfg.max_supply_units, 0) <= 3000000000 THEN
        v_mult := 50;
      ELSE
        v_mult := 1;
      END IF;

      IF v_mult > 1 THEN
        UPDATE yt_coin.accounts
        SET balance_units = balance_units * v_mult,
            lifetime_earned_units = lifetime_earned_units * v_mult,
            updated_at = now();

        UPDATE yt_coin.ledger
        SET amount_units = COALESCE(amount_units, reward_units, 0) * v_mult,
            reward_units = COALESCE(reward_units, amount_units, 0) * v_mult;

        UPDATE yt_coin.mining_claims
        SET amount_units = COALESCE(amount_units, reward_units, 0) * v_mult,
            reward_units = COALESCE(reward_units, amount_units, 0) * v_mult;

        UPDATE yt_coin.daily_mining_totals
        SET paid_units = paid_units * v_mult,
            updated_at = now();
      END IF;

      UPDATE yt_coin.config
      SET unit_scale = 100,
          max_supply_units = 100000000000,
          base_reward_units = 50,
          daily_increment_units = 0,
          max_daily_reward_units = 50,
          tap_reward_units = 1,
          daily_tap_limit = COALESCE(NULLIF(daily_tap_limit, 0), 1000),
          daily_cap_start_units = GREATEST(COALESCE(daily_cap_start_units, 2000) * v_mult, 100000),
          daily_cap_increment_units = GREATEST(COALESCE(daily_cap_increment_units, 20) * v_mult, 1000),
          daily_cap_max_units = GREATEST(COALESCE(daily_cap_max_units, 2000000) * v_mult, 100000000),
          daily_global_cap_units = GREATEST(COALESCE(daily_global_cap_units, 2000) * v_mult, 100000),
          daily_global_cap_increment_units = GREATEST(COALESCE(daily_global_cap_increment_units, 20) * v_mult, 1000),
          daily_global_cap_max_units = GREATEST(COALESCE(daily_global_cap_max_units, 2000000) * v_mult, 100000000),
          updated_at = now()
      WHERE singleton = true;
    ELSE
      UPDATE yt_coin.config
      SET base_reward_units = 50,
          daily_increment_units = 0,
          max_daily_reward_units = 50,
          tap_reward_units = GREATEST(COALESCE(tap_reward_units, 1), 1),
          updated_at = now()
      WHERE singleton = true;
    END IF;
  END IF;
END $$;

-- Re-sync rewards treasury against 1,000,000,000 YT total supply (100,000,000,000 atomic units)
INSERT INTO yt_coin.system_treasury (treasury_key, balance_units)
VALUES (
  'YT-REWARDS-TREASURY',
  GREATEST(0, 100000000000 - COALESCE((SELECT sum(balance_units) FROM yt_coin.accounts), 0))
)
ON CONFLICT (treasury_key) DO UPDATE SET
  balance_units = GREATEST(
    0,
    100000000000 - COALESCE((SELECT sum(balance_units) FROM yt_coin.accounts), 0)
  ),
  updated_at = now();

-- 2. Track per-user daily taps safely
CREATE TABLE IF NOT EXISTS yt_coin.daily_user_taps (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_date date NOT NULL,
  tap_count integer NOT NULL DEFAULT 0,
  paid_units bigint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, tap_date)
);

-- ============================================================================
-- 3. RPC: public.get_my_yt_coin_summary()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_next_claim_at timestamptz := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Aden');
  v_balance bigint := 0;
  v_lifetime bigint := 0;
  v_enabled boolean := false;
  v_unit_scale integer := 100;
  v_cap bigint := 0;
  v_cap_start bigint := 100000;
  v_cap_increment bigint := 1000;
  v_cap_max bigint := 100000000;
  v_max_supply bigint := 100000000000;
  v_base_reward bigint := 50;      -- 0.50 YT flat daily reward
  v_tap_reward bigint := 1;        -- 0.01 YT per tap
  v_daily_tap_limit integer := 1000;
  v_start_date date;
  v_days_elapsed bigint := 0;
  v_last_date date;
  v_claimed_today boolean := false;
  v_taps_today integer := 0;
  v_tap_paid_today bigint := 0;
  v_today_paid bigint := 0;
  v_total_mined bigint := 0;
  v_treasury_balance bigint := 0;
  v_user_claims_count bigint := 0;
  v_eligible boolean := false;
  v_history jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT
    mining_enabled,
    COALESCE(unit_scale, 100),
    COALESCE(daily_cap_start_units, daily_global_cap_units, 100000),
    COALESCE(daily_cap_increment_units, daily_global_cap_increment_units, 1000),
    COALESCE(daily_cap_max_units, daily_global_cap_max_units, 100000000),
    COALESCE(max_supply_units, 100000000000),
    COALESCE(base_reward_units, 50),
    COALESCE(tap_reward_units, 1),
    COALESCE(daily_tap_limit, 1000),
    mining_start_date
  INTO
    v_enabled,
    v_unit_scale,
    v_cap_start,
    v_cap_increment,
    v_cap_max,
    v_max_supply,
    v_base_reward,
    v_tap_reward,
    v_daily_tap_limit,
    v_start_date
  FROM yt_coin.config WHERE singleton = true;

  v_eligible := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  );

  IF v_eligible THEN
    INSERT INTO yt_coin.accounts(user_id)
    VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT COALESCE(balance_units, 0), COALESCE(lifetime_earned_units, 0)
  INTO v_balance, v_lifetime
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  SELECT count(*) INTO v_user_claims_count
  FROM yt_coin.mining_claims WHERE user_id = v_user_id;

  SELECT COALESCE(tap_count, 0), COALESCE(paid_units, 0)
  INTO v_taps_today, v_tap_paid_today
  FROM yt_coin.daily_user_taps
  WHERE user_id = v_user_id AND tap_date = v_today;

  v_days_elapsed := CASE WHEN v_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_start_date)) END;
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_increment));

  SELECT claim_date INTO v_last_date
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  v_claimed_today := (v_last_date = v_today);

  SELECT COALESCE(paid_units, 0) INTO v_today_paid
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('mining_reward', 'tap_mining_reward');

  SELECT COALESCE(balance_units, 0) INTO v_treasury_balance
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'rewardUnits', COALESCE(l.reward_units, l.amount_units, 0),
    'amountUnits', COALESCE(l.amount_units, l.reward_units, 0),
    'reference', l.reference,
    'metadata', l.metadata,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, reward_units, reference, metadata, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) l;

  RETURN jsonb_build_object(
    'unitScale', v_unit_scale,
    'balanceUnits', COALESCE(v_balance, 0),
    'lifetimeEarnedUnits', COALESCE(v_lifetime, 0),
    'miningEnabled', COALESCE(v_enabled, false) AND v_start_date IS NOT NULL,
    'maxSupplyUnits', v_max_supply,
    'totalMinedUnits', v_total_mined,
    'poolRemainingUnits', v_treasury_balance,
    'dailyCapConfigured', v_start_date IS NOT NULL,
    'dailyCapUnits', v_cap,
    'dailyCapStartUnits', v_cap_start,
    'dailyCapIncrementUnits', v_cap_increment,
    'dailyCapMaxUnits', v_cap_max,
    'baseRewardUnits', v_base_reward,
    'dailyIncrementUnits', 0,
    'maxDailyRewardUnits', v_base_reward,
    'tapRewardUnits', v_tap_reward,
    'dailyTapLimit', v_daily_tap_limit,
    'tapsToday', v_taps_today,
    'tapPaidUnitsToday', v_tap_paid_today,
    'dailyTapsRemaining', CASE WHEN v_daily_tap_limit <= 0 THEN NULL ELSE GREATEST(v_daily_tap_limit - v_taps_today, 0) END,
    'minedTodayUnits', v_today_paid,
    'dailyCapRemainingUnits', GREATEST(COALESCE(v_cap, 0) - COALESCE(v_today_paid, 0), 0),
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_enabled, false) OR v_start_date IS NULL THEN 'التعدين متاح من الإدارة فقط حالياً.'
      WHEN NOT v_eligible THEN 'يلزم حساب نشط للتعدين.'
      ELSE NULL
    END,
    'nextRewardUnits', v_base_reward,
    'lastClaimDate', v_last_date,
    'totalClaims', v_user_claims_count,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

-- ============================================================================
-- 4. RPC: yt_coin.claim_daily_mining() & public.claim_my_yt_coin_daily()
--         Flat 0.5 YT (50 units) daily with NO daily growth
-- ============================================================================
CREATE OR REPLACE FUNCTION yt_coin.claim_daily_mining()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_days_elapsed bigint := 0;
  v_cap bigint := 0;
  v_cap_start bigint := 100000;
  v_cap_inc bigint := 1000;
  v_cap_max bigint := 100000000;
  v_reward bigint := 50;
  v_max_supply bigint := 100000000000;
  v_daily_paid bigint := 0;
  v_total_mined bigint := 0;
  v_treasury bigint := 0;
  v_ledger_id uuid;
  v_claim_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين غير متاح حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  v_cap_start := COALESCE(v_cfg.daily_cap_start_units, v_cfg.daily_global_cap_units, 100000);
  v_cap_inc := COALESCE(v_cfg.daily_cap_increment_units, v_cfg.daily_global_cap_increment_units, 1000);
  v_cap_max := COALESCE(v_cfg.daily_cap_max_units, v_cfg.daily_global_cap_max_units, 100000000);
  v_reward := COALESCE(v_cfg.base_reward_units, 50);
  v_max_supply := COALESCE(v_cfg.max_supply_units, 100000000000);

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_inc));

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة التعدين لهذا اليوم بالفعل.');
  END IF;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('mining_reward', 'tap_mining_reward');

  IF (v_daily_paid + v_reward) > v_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'daily_cap_reached',
      'message', 'تم بلوغ سقف التعدين اليومي للمنصة.',
      'dailyCapUnits', v_cap,
      'dailyPaidUnits', v_daily_paid,
      'dailyRemainingUnits', GREATEST(v_cap - v_daily_paid, 0)
    );
  END IF;

  IF (v_total_mined + v_reward) > v_max_supply THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'max_supply_reached',
      'message', 'تم استنفاد إجمالي المعروض النهائي من عملة YT Coin.'
    );
  END IF;

  SELECT balance_units INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد الخزينة غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reward_units, reference, metadata)
  VALUES (
    v_user_id,
    'mining_reward',
    v_reward,
    v_reward,
    'YT-MINING:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object(
      'claimDate', v_today,
      'timezone', 'Asia/Aden',
      'unitScale', COALESCE(v_cfg.unit_scale, 100),
      'dailyCapUnits', v_cap,
      'dailyPaidUnits', v_daily_paid + v_reward
    )
  ) RETURNING id INTO v_ledger_id;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward,
      lifetime_earned_units = lifetime_earned_units + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO yt_coin.mining_claims(user_id, claim_date, streak_day, amount_units, reward_units, ledger_id)
  VALUES (v_user_id, v_today, 1, v_reward, v_reward, v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward,
      claim_count = claim_count + 1,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'daily_mining_claim',
    'mining_claim',
    v_claim_id::text,
    jsonb_build_object(
      'rewardUnits', v_reward,
      'claimDate', v_today,
      'unitScale', COALESCE(v_cfg.unit_scale, 100),
      'dailyCapUnits', v_cap
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'claimed',
    'unitScale', COALESCE(v_cfg.unit_scale, 100),
    'rewardUnits', v_reward,
    'amountUnits', v_reward,
    'claimDate', v_today,
    'dailyCapUnits', v_cap,
    'dailyRemainingUnits', GREATEST(v_cap - (v_daily_paid + v_reward), 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.claim_daily_mining();
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_my_yt_coin_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_daily() TO authenticated;

-- ============================================================================
-- 5. RPC: yt_coin.claim_tap_mining(p_taps) & public.claim_my_yt_coin_taps(p_taps)
--         0.01 YT (1 unit) per tap, atomic treasury & daily cap accounting
-- ============================================================================
CREATE OR REPLACE FUNCTION yt_coin.claim_tap_mining(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_taps integer := COALESCE(p_taps, 1);
  v_days_elapsed bigint := 0;
  v_cap bigint := 0;
  v_cap_start bigint := 100000;
  v_cap_inc bigint := 1000;
  v_cap_max bigint := 100000000;
  v_tap_reward bigint := 1;
  v_daily_tap_limit integer := 1000;
  v_taps_today integer := 0;
  v_reward bigint := 0;
  v_max_supply bigint := 100000000000;
  v_daily_paid bigint := 0;
  v_total_mined bigint := 0;
  v_treasury bigint := 0;
  v_new_balance bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_taps < 1 OR v_taps > 200 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_taps', 'message', 'عدد النقرات غير صالح.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين غير متاح حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  v_cap_start := COALESCE(v_cfg.daily_cap_start_units, v_cfg.daily_global_cap_units, 100000);
  v_cap_inc := COALESCE(v_cfg.daily_cap_increment_units, v_cfg.daily_global_cap_increment_units, 1000);
  v_cap_max := COALESCE(v_cfg.daily_cap_max_units, v_cfg.daily_global_cap_max_units, 100000000);
  v_tap_reward := COALESCE(v_cfg.tap_reward_units, 1);
  v_daily_tap_limit := COALESCE(v_cfg.daily_tap_limit, 1000);
  v_max_supply := COALESCE(v_cfg.max_supply_units, 100000000000);

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_inc));

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  INSERT INTO yt_coin.daily_user_taps(user_id, tap_date, tap_count, paid_units)
  VALUES (v_user_id, v_today, 0, 0)
  ON CONFLICT (user_id, tap_date) DO NOTHING;

  SELECT tap_count INTO v_taps_today
  FROM yt_coin.daily_user_taps
  WHERE user_id = v_user_id AND tap_date = v_today
  FOR UPDATE;

  IF v_daily_tap_limit > 0 THEN
    IF v_taps_today >= v_daily_tap_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'daily_tap_limit_reached',
        'message', 'تم بلوغ الحد اليومي لنقرات التعدين.',
        'tapsToday', v_taps_today,
        'dailyTapLimit', v_daily_tap_limit,
        'dailyTapsRemaining', 0
      );
    END IF;
    v_taps := LEAST(v_taps, v_daily_tap_limit - v_taps_today);
  END IF;

  v_reward := v_taps::bigint * v_tap_reward;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('mining_reward', 'tap_mining_reward');

  IF (v_daily_paid + v_reward) > v_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'daily_cap_reached',
      'message', 'تم بلوغ سقف التعدين اليومي للمنصة.',
      'dailyCapUnits', v_cap,
      'dailyPaidUnits', v_daily_paid,
      'dailyRemainingUnits', GREATEST(v_cap - v_daily_paid, 0)
    );
  END IF;

  IF (v_total_mined + v_reward) > v_max_supply THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'max_supply_reached',
      'message', 'تم استنفاد إجمالي المعروض النهائي من عملة YT Coin.'
    );
  END IF;

  SELECT balance_units INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد الخزينة غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reward_units, reference, metadata)
  VALUES (
    v_user_id,
    'tap_mining_reward',
    v_reward,
    v_reward,
    'YT-TAP:' || v_user_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object(
      'tapDate', v_today,
      'taps', v_taps,
      'tapRewardUnits', v_tap_reward,
      'unitScale', COALESCE(v_cfg.unit_scale, 100)
    )
  );

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward,
      lifetime_earned_units = lifetime_earned_units + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance;

  UPDATE yt_coin.daily_user_taps
  SET tap_count = tap_count + v_taps,
      paid_units = paid_units + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id AND tap_date = v_today;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward,
      updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'unitScale', COALESCE(v_cfg.unit_scale, 100),
    'tapsCredited', v_taps,
    'rewardUnits', v_reward,
    'amountUnits', v_reward,
    'balanceUnits', v_new_balance,
    'tapsToday', v_taps_today + v_taps,
    'dailyTapLimit', v_daily_tap_limit,
    'dailyTapsRemaining', CASE WHEN v_daily_tap_limit <= 0 THEN NULL ELSE GREATEST(v_daily_tap_limit - (v_taps_today + v_taps), 0) END,
    'dailyCapUnits', v_cap,
    'dailyRemainingUnits', GREATEST(v_cap - (v_daily_paid + v_reward), 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_tap_mining(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_tap_mining(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_taps(p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.claim_tap_mining(p_taps);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_my_yt_coin_taps(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_taps(integer) TO authenticated;

-- ============================================================================
-- 6. ADMIN RPCS: get_yt_coin_admin_summary() & admin_update_yt_coin_config()
-- ============================================================================
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
  v_cap bigint := 0;
  v_cap_start bigint := 100000;
  v_cap_inc bigint := 1000;
  v_cap_max bigint := 100000000;
  v_days_elapsed bigint := 0;
  v_rewards_treasury bigint := 0;
  v_total_mined bigint := 0;
  v_user_balances bigint := 0;
  v_today_mined bigint := 0;
  v_claims_today integer := 0;
  v_taps_today bigint := 0;
  v_total_claims bigint := 0;
  v_active_miners bigint := 0;
  v_recent_claims jsonb := '[]'::jsonb;
  v_treasuries jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;
  v_cap_start := COALESCE(v_cfg.daily_cap_start_units, v_cfg.daily_global_cap_units, 100000);
  v_cap_inc := COALESCE(v_cfg.daily_cap_increment_units, v_cfg.daily_global_cap_increment_units, 1000);
  v_cap_max := COALESCE(v_cfg.daily_cap_max_units, v_cfg.daily_global_cap_max_units, 100000000);
  v_days_elapsed := CASE WHEN v_cfg.mining_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_cfg.mining_start_date)) END;
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_inc));

  SELECT COALESCE(balance_units, 0) INTO v_rewards_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('mining_reward', 'tap_mining_reward');

  SELECT COALESCE(sum(balance_units), 0), count(*)
  INTO v_user_balances, v_active_miners
  FROM yt_coin.accounts;

  SELECT COALESCE(paid_units, 0), COALESCE(claim_count, 0)
  INTO v_today_mined, v_claims_today
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(tap_count), 0) INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE tap_date = v_today;

  SELECT count(*) INTO v_total_claims FROM yt_coin.mining_claims;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasury_key', t.treasury_key,
    'balance_units', t.balance_units,
    'updated_at', t.updated_at
  )), '[]'::jsonb)
  INTO v_treasuries
  FROM yt_coin.system_treasury t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'full_name', p.full_name,
    'claim_date', c.claim_date,
    'amount_units', COALESCE(c.reward_units, c.amount_units, 0),
    'created_at', c.created_at
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_recent_claims
  FROM (
    SELECT id, user_id, claim_date, amount_units, reward_units, created_at
    FROM yt_coin.mining_claims
    ORDER BY created_at DESC LIMIT 25
  ) c
  LEFT JOIN public.profiles p ON p.id = c.user_id;

  RETURN jsonb_build_object(
    'unit_scale', COALESCE(v_cfg.unit_scale, 100),
    'mining_enabled', COALESCE(v_cfg.mining_enabled, false),
    'max_supply_units', COALESCE(v_cfg.max_supply_units, 100000000000),
    'base_reward_units', COALESCE(v_cfg.base_reward_units, 50),
    'tap_reward_units', COALESCE(v_cfg.tap_reward_units, 1),
    'daily_tap_limit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'daily_cap_start_units', v_cap_start,
    'daily_cap_increment_units', v_cap_inc,
    'daily_cap_max_units', v_cap_max,
    'daily_cap_units', v_cap,
    'rewards_treasury_balance_units', v_rewards_treasury,
    'total_mined_units', v_total_mined,
    'total_user_balances_units', v_user_balances,
    'today_mined_units', v_today_mined,
    'claims_today', v_claims_today,
    'today_taps_count', v_taps_today,
    'total_claims', v_total_claims,
    'active_miners_count', v_active_miners,
    'treasuries', v_treasuries,
    'recent_claims', v_recent_claims,
    'updated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_admin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_admin_summary() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_units bigint DEFAULT NULL,
  p_tap_reward_units bigint DEFAULT NULL,
  p_daily_tap_limit integer DEFAULT NULL,
  p_daily_cap_start_units bigint DEFAULT NULL,
  p_daily_cap_max_units bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_base_reward_units IS NOT NULL AND p_base_reward_units < 1 THEN
    RAISE EXCEPTION 'base_reward_units must be >= 1 (0.01 YT)';
  END IF;
  IF p_tap_reward_units IS NOT NULL AND p_tap_reward_units < 1 THEN
    RAISE EXCEPTION 'tap_reward_units must be >= 1 (0.01 YT)';
  END IF;
  IF p_daily_tap_limit IS NOT NULL AND p_daily_tap_limit < 0 THEN
    RAISE EXCEPTION 'daily_tap_limit must be >= 0';
  END IF;
  IF p_daily_cap_start_units IS NOT NULL AND p_daily_cap_start_units < 1 THEN
    RAISE EXCEPTION 'daily_cap_start_units must be >= 1';
  END IF;
  IF p_daily_cap_max_units IS NOT NULL AND p_daily_cap_max_units < 1 THEN
    RAISE EXCEPTION 'daily_cap_max_units must be >= 1';
  END IF;

  UPDATE yt_coin.config
  SET
    mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
    base_reward_units = COALESCE(p_base_reward_units, base_reward_units),
    daily_increment_units = 0,
    max_daily_reward_units = COALESCE(p_base_reward_units, max_daily_reward_units),
    tap_reward_units = COALESCE(p_tap_reward_units, tap_reward_units),
    daily_tap_limit = COALESCE(p_daily_tap_limit, daily_tap_limit),
    daily_cap_start_units = COALESCE(p_daily_cap_start_units, daily_cap_start_units),
    daily_global_cap_units = COALESCE(p_daily_cap_start_units, daily_global_cap_units),
    daily_cap_max_units = GREATEST(
      COALESCE(p_daily_cap_max_units, daily_cap_max_units),
      COALESCE(p_daily_cap_start_units, daily_cap_start_units)
    ),
    daily_global_cap_max_units = GREATEST(
      COALESCE(p_daily_cap_max_units, daily_global_cap_max_units),
      COALESCE(p_daily_cap_start_units, daily_global_cap_units)
    ),
    updated_at = now()
  WHERE singleton = true
  RETURNING * INTO v_cfg;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_config',
    'config',
    'singleton',
    jsonb_build_object(
      'mining_enabled', v_cfg.mining_enabled,
      'base_reward_units', v_cfg.base_reward_units,
      'tap_reward_units', v_cfg.tap_reward_units,
      'daily_tap_limit', v_cfg.daily_tap_limit,
      'daily_cap_start_units', v_cfg.daily_cap_start_units,
      'daily_cap_max_units', v_cfg.daily_cap_max_units
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'unit_scale', v_cfg.unit_scale,
    'mining_enabled', v_cfg.mining_enabled,
    'base_reward_units', v_cfg.base_reward_units,
    'tap_reward_units', v_cfg.tap_reward_units,
    'daily_tap_limit', v_cfg.daily_tap_limit,
    'daily_cap_start_units', v_cfg.daily_cap_start_units,
    'daily_cap_max_units', v_cfg.daily_cap_max_units,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, integer, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, integer, bigint, bigint) TO authenticated;
