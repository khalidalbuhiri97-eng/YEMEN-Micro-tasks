-- ============================================================================
-- YT COIN PERFECT INTEGER MINING & REWARDS SYSTEM MIGRATION
-- 1 Billion max supply, integer units, daily cap progression, UTC-based reset.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS yt_coin;

-- 1. Config table with strict integer units
CREATE TABLE IF NOT EXISTS yt_coin.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mining_enabled boolean NOT NULL DEFAULT true,
  max_supply_units bigint NOT NULL DEFAULT 1000000000, -- 1 Billion exact integer units
  base_reward_units bigint NOT NULL DEFAULT 1, -- 1 coin integer base reward
  daily_cap_start_units bigint NOT NULL DEFAULT 1, -- Starts at 1 coin on day 1
  daily_cap_increment_units bigint NOT NULL DEFAULT 1, -- Increases by 1 coin daily
  daily_cap_max_units bigint NOT NULL DEFAULT 1000000, -- Max daily cap ceiling
  max_daily_reward_units bigint NOT NULL DEFAULT 10,
  mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO yt_coin.config (
  singleton, mining_enabled, max_supply_units, base_reward_units,
  daily_cap_start_units, daily_cap_increment_units, daily_cap_max_units,
  max_daily_reward_units, mining_start_date
) VALUES (
  true, true, 1000000000, 1, 1, 1, 1000000, 10, (now() AT TIME ZONE 'UTC')::date
)
ON CONFLICT (singleton) DO UPDATE SET
  max_supply_units = 1000000000,
  base_reward_units = 1,
  daily_cap_start_units = 1,
  daily_cap_increment_units = 1,
  daily_cap_max_units = 1000000,
  max_daily_reward_units = 10,
  updated_at = now();

-- 2. Accounts table & reset test balances
CREATE TABLE IF NOT EXISTS yt_coin.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_units bigint NOT NULL DEFAULT 0,
  lifetime_earned_units bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

UPDATE yt_coin.accounts SET balance_units = 0, lifetime_earned_units = 0;

-- 3. System Treasury funded with 1 Billion units
CREATE TABLE IF NOT EXISTS yt_coin.system_treasury (
  treasury_key text PRIMARY KEY,
  balance_units bigint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO yt_coin.system_treasury (treasury_key, balance_units)
VALUES ('YT-REWARDS-TREASURY', 1000000000)
ON CONFLICT (treasury_key) DO UPDATE SET balance_units = 1000000000;

-- 4. Claims, Totals, Ledger, Audit Log
CREATE TABLE IF NOT EXISTS yt_coin.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  streak_day integer NOT NULL DEFAULT 1,
  reward_units bigint NOT NULL,
  ledger_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_date)
);

CREATE TABLE IF NOT EXISTS yt_coin.daily_mining_totals (
  claim_date date PRIMARY KEY,
  paid_units bigint NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

UPDATE yt_coin.daily_mining_totals SET paid_units = 0, claim_count = 0;

CREATE TABLE IF NOT EXISTS yt_coin.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reward_units bigint NOT NULL,
  reference text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 5. RPC: get_my_yt_coin_summary()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_balance bigint := 0;
  v_lifetime bigint := 0;
  v_enabled boolean := false;
  v_cap bigint := 0;
  v_cap_start bigint := 1;
  v_cap_increment bigint := 1;
  v_cap_max bigint := 1000000;
  v_max_supply bigint := 1000000000;
  v_start_date date;
  v_days_elapsed bigint := 0;
  v_last_date date;
  v_last_streak integer := 0;
  v_display_streak integer := 0;
  v_next_reward bigint := 1;
  v_today_paid bigint := 0;
  v_total_mined bigint := 0;
  v_eligible boolean := false;
  v_history jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT mining_enabled, daily_cap_start_units, daily_cap_increment_units,
         daily_cap_max_units, max_supply_units, mining_start_date, base_reward_units
  INTO v_enabled, v_cap_start, v_cap_increment, v_cap_max, v_max_supply, v_start_date, v_next_reward
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

  v_days_elapsed := CASE WHEN v_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_start_date)) END;
  
  v_cap := LEAST(
    v_cap_max,
    v_cap_start + (v_days_elapsed * v_cap_increment)
  );

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  IF v_last_date = v_today OR v_last_date = v_today - 1 THEN
    v_display_streak := COALESCE(v_last_streak, 0);
    v_next_reward := LEAST(1 + v_display_streak, 10);
  ELSE
    v_display_streak := 0;
    v_next_reward := 1;
  END IF;

  SELECT COALESCE(paid_units, 0) INTO v_today_paid
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(reward_units), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type = 'mining_reward';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'eventType', l.event_type, 'rewardUnits', l.reward_units,
    'reference', l.reference, 'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, reward_units, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) l;

  RETURN jsonb_build_object(
    'balanceUnits', COALESCE(v_balance, 0),
    'lifetimeEarnedUnits', COALESCE(v_lifetime, 0),
    'miningEnabled', COALESCE(v_enabled, false) AND v_start_date IS NOT NULL,
    'maxSupplyUnits', v_max_supply,
    'totalMinedUnits', v_total_mined,
    'dailyCapConfigured', v_start_date IS NOT NULL,
    'dailyCapUnits', v_cap,
    'dailyCapStartUnits', v_cap_start,
    'dailyCapIncrementUnits', v_cap_increment,
    'dailyCapMaxUnits', v_cap_max,
    'minedTodayUnits', v_today_paid,
    'dailyCapRemainingUnits', GREATEST(COALESCE(v_cap, 0) - COALESCE(v_today_paid, 0), 0),
    'eligible', v_eligible,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_enabled, false) OR v_start_date IS NULL THEN 'التعدين غير متاح حالياً.'
      WHEN NOT v_eligible THEN 'يلزم حساب نشط للمطالبة بالتعدين.'
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


-- ============================================================================
-- 6. RPC: yt_coin.claim_daily_mining()
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
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_days_elapsed bigint := 0;
  v_cap bigint := 0;
  v_last_date date;
  v_last_streak integer := 0;
  v_streak integer := 1;
  v_reward bigint := 1;
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

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));

  v_cap := LEAST(
    v_cfg.daily_cap_max_units,
    v_cfg.daily_cap_start_units + (v_days_elapsed * v_cfg.daily_cap_increment_units)
  );

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة التعدين لهذا اليوم بالفعل.');
  END IF;

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  v_streak := CASE WHEN v_last_date = v_today - 1 THEN LEAST(v_last_streak + 1, 365) ELSE 1 END;
  v_reward := LEAST(v_cfg.base_reward_units + (v_streak - 1), v_cfg.max_daily_reward_units);

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(reward_units), 0) INTO v_total_mined FROM yt_coin.ledger WHERE event_type = 'mining_reward';

  -- Strict validation: minedTodayUnits + rewardAmount > currentDailyCap OR totalMinedUnits + rewardAmount > maxSupplyUnits
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

  IF (v_total_mined + v_reward) > v_cfg.max_supply_units THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'max_supply_reached',
      'message', 'تم استنفاد إجمالي المعروض النهائي من عملة YT Coin (1 مليار عملة).'
    );
  END IF;

  SELECT balance_units INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد الخزينة غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, reward_units, reference, metadata)
  VALUES (
    v_user_id,
    'mining_reward',
    v_reward,
    'YT-MINING:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object(
      'claimDate', v_today,
      'streakDay', v_streak,
      'timezone', 'UTC',
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

  INSERT INTO yt_coin.mining_claims(user_id, claim_date, streak_day, reward_units, ledger_id)
  VALUES (v_user_id, v_today, v_streak, v_reward, v_ledger_id)
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
      'streakDay', v_streak,
      'claimDate', v_today,
      'dailyCapUnits', v_cap
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'claimed',
    'rewardUnits', v_reward,
    'streakDay', v_streak,
    'claimDate', v_today,
    'dailyCapUnits', v_cap,
    'dailyRemainingUnits', GREATEST(v_cap - (v_daily_paid + v_reward), 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated;
