-- ============================================================================
-- YT COIN MINING PROGRESSION (+0.5 YT DAILY UNTIL DAY 20 -> 20 YT DAILY)
-- + 1-DECIMAL PRECISION SUPPORT (1 internal unit = 0.5 YT)
-- + ADMIN-ONLY CONFIG & TREASURY SUMMARY RPCS
-- ============================================================================
-- Note on internal units:
--   1 internal unit = 0.5 YT (stored as exact bigint to eliminate drift).
--   Day 1  =  1 unit  =  0.5 YT
--   Day 2  =  2 units =  1.0 YT (+0.5 YT)
--   ...
--   Day 19 = 19 units =  9.5 YT (+0.5 YT)
--   Day 20+= 40 units = 20.0 YT daily (while consecutive streak holds)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS yt_coin;

-- 1. Ensure yt_coin.config has all required columns
CREATE TABLE IF NOT EXISTS yt_coin.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mining_enabled boolean NOT NULL DEFAULT true,
  max_supply_units bigint NOT NULL DEFAULT 2000000000, -- 1,000,000,000 YT * 2
  base_reward_units bigint NOT NULL DEFAULT 1,         -- 0.5 YT
  daily_increment_units bigint NOT NULL DEFAULT 1,     -- +0.5 YT/day
  max_daily_reward_units bigint NOT NULL DEFAULT 40,   -- 20.0 YT/day on Day 20+
  daily_cap_start_units bigint NOT NULL DEFAULT 2000,  -- 1,000 YT/day platform cap
  daily_cap_increment_units bigint NOT NULL DEFAULT 20,-- +10 YT/day
  daily_cap_max_units bigint NOT NULL DEFAULT 2000000, -- 1,000,000 YT/day max cap
  mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE yt_coin.config
  ADD COLUMN IF NOT EXISTS mining_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_supply_units bigint NOT NULL DEFAULT 2000000000,
  ADD COLUMN IF NOT EXISTS base_reward_units bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS daily_increment_units bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_daily_reward_units bigint NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS daily_cap_start_units bigint NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS daily_cap_increment_units bigint NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS daily_cap_max_units bigint NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS daily_global_cap_units bigint DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS daily_global_cap_increment_units bigint DEFAULT 20,
  ADD COLUMN IF NOT EXISTS daily_global_cap_max_units bigint DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

INSERT INTO yt_coin.config (
  singleton,
  mining_enabled,
  max_supply_units,
  base_reward_units,
  daily_increment_units,
  max_daily_reward_units,
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
  2000000000,
  1,
  1,
  40,
  2000,
  20,
  2000000,
  2000,
  20,
  2000000,
  (now() AT TIME ZONE 'Asia/Aden')::date
)
ON CONFLICT (singleton) DO UPDATE SET
  max_supply_units = 2000000000,
  base_reward_units = 1,
  daily_increment_units = 1,
  max_daily_reward_units = 40,
  daily_cap_start_units = GREATEST(COALESCE(yt_coin.config.daily_cap_start_units, 2000), 2000),
  daily_cap_increment_units = GREATEST(COALESCE(yt_coin.config.daily_cap_increment_units, 20), 20),
  daily_cap_max_units = GREATEST(COALESCE(yt_coin.config.daily_cap_max_units, 2000000), 2000000),
  daily_global_cap_units = GREATEST(COALESCE(yt_coin.config.daily_global_cap_units, 2000), 2000),
  daily_global_cap_increment_units = GREATEST(COALESCE(yt_coin.config.daily_global_cap_increment_units, 20), 20),
  daily_global_cap_max_units = GREATEST(COALESCE(yt_coin.config.daily_global_cap_max_units, 2000000), 2000000),
  updated_at = now();

-- 2. Ensure core tables & compatible columns (amount_units + reward_units)
CREATE TABLE IF NOT EXISTS yt_coin.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_units bigint NOT NULL DEFAULT 0,
  lifetime_earned_units bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.system_treasury (
  treasury_key text PRIMARY KEY,
  balance_units bigint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO yt_coin.system_treasury (treasury_key, balance_units)
VALUES ('YT-REWARDS-TREASURY', 2000000000)
ON CONFLICT (treasury_key) DO UPDATE SET
  balance_units = GREATEST(
    0,
    2000000000 - COALESCE((SELECT sum(balance_units) FROM yt_coin.accounts), 0)
  ),
  updated_at = now();

CREATE TABLE IF NOT EXISTS yt_coin.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  streak_day integer NOT NULL DEFAULT 1,
  amount_units bigint,
  reward_units bigint,
  ledger_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_date)
);

ALTER TABLE yt_coin.mining_claims
  ADD COLUMN IF NOT EXISTS amount_units bigint,
  ADD COLUMN IF NOT EXISTS reward_units bigint;

DO $$
BEGIN
  BEGIN
    ALTER TABLE yt_coin.mining_claims ALTER COLUMN amount_units DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    ALTER TABLE yt_coin.mining_claims ALTER COLUMN reward_units DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

UPDATE yt_coin.mining_claims
SET amount_units = COALESCE(amount_units, reward_units, 0),
    reward_units = COALESCE(reward_units, amount_units, 0)
WHERE amount_units IS NULL OR reward_units IS NULL;

CREATE TABLE IF NOT EXISTS yt_coin.daily_mining_totals (
  claim_date date PRIMARY KEY,
  paid_units bigint NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount_units bigint,
  reward_units bigint,
  reference text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE yt_coin.ledger
  ADD COLUMN IF NOT EXISTS amount_units bigint,
  ADD COLUMN IF NOT EXISTS reward_units bigint;

DO $$
BEGIN
  BEGIN
    ALTER TABLE yt_coin.ledger ALTER COLUMN amount_units DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    ALTER TABLE yt_coin.ledger ALTER COLUMN reward_units DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

UPDATE yt_coin.ledger
SET amount_units = COALESCE(amount_units, reward_units, 0),
    reward_units = COALESCE(reward_units, amount_units, 0)
WHERE amount_units IS NULL OR reward_units IS NULL;

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
  v_cap bigint := 0;
  v_cap_start bigint := 2000;
  v_cap_increment bigint := 20;
  v_cap_max bigint := 2000000;
  v_max_supply bigint := 2000000000;
  v_base_reward bigint := 1;
  v_daily_increment bigint := 1;
  v_max_daily_reward bigint := 40;
  v_start_date date;
  v_days_elapsed bigint := 0;
  v_last_date date;
  v_last_streak integer := 0;
  v_display_streak integer := 0;
  v_upcoming_streak integer := 1;
  v_next_reward bigint := 1;
  v_claimed_today boolean := false;
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
    COALESCE(daily_cap_start_units, daily_global_cap_units, 2000),
    COALESCE(daily_cap_increment_units, daily_global_cap_increment_units, 20),
    COALESCE(daily_cap_max_units, daily_global_cap_max_units, 2000000),
    COALESCE(max_supply_units, 2000000000),
    COALESCE(base_reward_units, 1),
    COALESCE(daily_increment_units, 1),
    COALESCE(max_daily_reward_units, 40),
    mining_start_date
  INTO
    v_enabled,
    v_cap_start,
    v_cap_increment,
    v_cap_max,
    v_max_supply,
    v_base_reward,
    v_daily_increment,
    v_max_daily_reward,
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

  v_days_elapsed := CASE WHEN v_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_start_date)) END;
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_increment));

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  IF v_last_date = v_today THEN
    v_claimed_today := true;
    v_display_streak := COALESCE(v_last_streak, 1);
    v_upcoming_streak := v_display_streak + 1;
  ELSIF v_last_date = v_today - 1 THEN
    v_claimed_today := false;
    v_display_streak := COALESCE(v_last_streak, 0);
    v_upcoming_streak := v_display_streak + 1;
  ELSE
    v_claimed_today := false;
    v_display_streak := 0;
    v_upcoming_streak := 1;
  END IF;

  -- Day 1..19: base (0.5 YT) + (streak - 1) * increment (+0.5 YT/day) => Day 19 = 9.5 YT
  -- Day 20+: jumps to max_daily_reward (40 units = 20 YT daily)
  v_next_reward := CASE
    WHEN v_upcoming_streak >= 20 THEN v_max_daily_reward
    ELSE v_base_reward + ((v_upcoming_streak - 1) * v_daily_increment)
  END;

  SELECT COALESCE(paid_units, 0) INTO v_today_paid
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type = 'mining_reward';

  SELECT COALESCE(balance_units, 0) INTO v_treasury_balance
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'rewardUnits', COALESCE(l.reward_units, l.amount_units, 0),
    'amountUnits', COALESCE(l.amount_units, l.reward_units, 0),
    'reference', l.reference,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, reward_units, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) l;

  RETURN jsonb_build_object(
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
    'dailyIncrementUnits', v_daily_increment,
    'maxDailyRewardUnits', v_max_daily_reward,
    'minedTodayUnits', v_today_paid,
    'dailyCapRemainingUnits', GREATEST(COALESCE(v_cap, 0) - COALESCE(v_today_paid, 0), 0),
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_enabled, false) OR v_start_date IS NULL THEN 'التعدين متاح من الإدارة فقط حالياً.'
      WHEN NOT v_eligible THEN 'يلزم حساب نشط للمطالبة بالتعدين.'
      ELSE NULL
    END,
    'nextRewardUnits', v_next_reward,
    'lastClaimDate', v_last_date,
    'streakDay', v_display_streak,
    'totalClaims', v_user_claims_count,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

-- ============================================================================
-- 4. RPC: yt_coin.claim_daily_mining() & public.claim_my_yt_coin_daily()
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
  v_cap_start bigint := 2000;
  v_cap_inc bigint := 20;
  v_cap_max bigint := 2000000;
  v_base_reward bigint := 1;
  v_daily_inc bigint := 1;
  v_max_daily_reward bigint := 40;
  v_max_supply bigint := 2000000000;
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

  v_cap_start := COALESCE(v_cfg.daily_cap_start_units, v_cfg.daily_global_cap_units, 2000);
  v_cap_inc := COALESCE(v_cfg.daily_cap_increment_units, v_cfg.daily_global_cap_increment_units, 20);
  v_cap_max := COALESCE(v_cfg.daily_cap_max_units, v_cfg.daily_global_cap_max_units, 2000000);
  v_base_reward := COALESCE(v_cfg.base_reward_units, 1);
  v_daily_inc := COALESCE(v_cfg.daily_increment_units, 1);
  v_max_daily_reward := COALESCE(v_cfg.max_daily_reward_units, 40);
  v_max_supply := COALESCE(v_cfg.max_supply_units, 2000000000);

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_inc));

  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة التعدين لهذا اليوم بالفعل.');
  END IF;

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;

  v_streak := CASE WHEN v_last_date = v_today - 1 THEN COALESCE(v_last_streak, 0) + 1 ELSE 1 END;

  -- Day 1 = 0.5 YT (1 unit), +0.5 YT each day until Day 19 = 9.5 YT (19 units)
  -- Day 20 and beyond = 20 YT daily (40 units)
  v_reward := CASE
    WHEN v_streak >= 20 THEN v_max_daily_reward
    ELSE v_base_reward + ((v_streak - 1) * v_daily_inc)
  END;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type = 'mining_reward';

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
      'streakDay', v_streak,
      'timezone', 'Asia/Aden',
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
  VALUES (v_user_id, v_today, v_streak, v_reward, v_reward, v_ledger_id)
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
    'amountUnits', v_reward,
    'streakDay', v_streak,
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
-- 5. ADMIN-ONLY RPCS: get_yt_coin_admin_summary() & admin_update_yt_coin_config()
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
  v_cap_start bigint := 2000;
  v_cap_inc bigint := 20;
  v_cap_max bigint := 2000000;
  v_days_elapsed bigint := 0;
  v_rewards_treasury bigint := 0;
  v_total_mined bigint := 0;
  v_user_balances bigint := 0;
  v_today_mined bigint := 0;
  v_claims_today integer := 0;
  v_total_claims bigint := 0;
  v_active_miners bigint := 0;
  v_recent_claims jsonb := '[]'::jsonb;
  v_treasuries jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;
  v_cap_start := COALESCE(v_cfg.daily_cap_start_units, v_cfg.daily_global_cap_units, 2000);
  v_cap_inc := COALESCE(v_cfg.daily_cap_increment_units, v_cfg.daily_global_cap_increment_units, 20);
  v_cap_max := COALESCE(v_cfg.daily_cap_max_units, v_cfg.daily_global_cap_max_units, 2000000);
  v_days_elapsed := CASE WHEN v_cfg.mining_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_cfg.mining_start_date)) END;
  v_cap := LEAST(v_cap_max, v_cap_start + (v_days_elapsed * v_cap_inc));

  SELECT COALESCE(balance_units, 0) INTO v_rewards_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(sum(COALESCE(reward_units, amount_units, 0)), 0) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type = 'mining_reward';

  SELECT COALESCE(sum(balance_units), 0), count(*)
  INTO v_user_balances, v_active_miners
  FROM yt_coin.accounts;

  SELECT COALESCE(paid_units, 0), COALESCE(claim_count, 0)
  INTO v_today_mined, v_claims_today
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

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
    'streak_day', c.streak_day,
    'amount_units', COALESCE(c.reward_units, c.amount_units, 0),
    'created_at', c.created_at
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_recent_claims
  FROM (
    SELECT id, user_id, claim_date, streak_day, amount_units, reward_units, created_at
    FROM yt_coin.mining_claims
    ORDER BY created_at DESC LIMIT 25
  ) c
  LEFT JOIN public.profiles p ON p.id = c.user_id;

  RETURN jsonb_build_object(
    'mining_enabled', COALESCE(v_cfg.mining_enabled, false),
    'max_supply_units', COALESCE(v_cfg.max_supply_units, 2000000000),
    'base_reward_units', COALESCE(v_cfg.base_reward_units, 1),
    'daily_increment_units', COALESCE(v_cfg.daily_increment_units, 1),
    'max_daily_reward_units', COALESCE(v_cfg.max_daily_reward_units, 40),
    'daily_cap_start_units', v_cap_start,
    'daily_cap_increment_units', v_cap_inc,
    'daily_cap_max_units', v_cap_max,
    'daily_cap_units', v_cap,
    'rewards_treasury_balance_units', v_rewards_treasury,
    'total_mined_units', v_total_mined,
    'total_user_balances_units', v_user_balances,
    'today_mined_units', v_today_mined,
    'claims_today', v_claims_today,
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

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_units bigint DEFAULT NULL,
  p_daily_increment_units bigint DEFAULT NULL,
  p_max_daily_reward_units bigint DEFAULT NULL,
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
    RAISE EXCEPTION 'base_reward_units must be >= 1 (0.5 YT)';
  END IF;
  IF p_daily_increment_units IS NOT NULL AND p_daily_increment_units < 0 THEN
    RAISE EXCEPTION 'daily_increment_units must be >= 0';
  END IF;
  IF p_max_daily_reward_units IS NOT NULL AND p_max_daily_reward_units < 1 THEN
    RAISE EXCEPTION 'max_daily_reward_units must be >= 1 (0.5 YT)';
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
    daily_increment_units = COALESCE(p_daily_increment_units, daily_increment_units),
    max_daily_reward_units = COALESCE(p_max_daily_reward_units, max_daily_reward_units),
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
      'daily_increment_units', v_cfg.daily_increment_units,
      'max_daily_reward_units', v_cfg.max_daily_reward_units,
      'daily_cap_start_units', v_cfg.daily_cap_start_units,
      'daily_cap_max_units', v_cfg.daily_cap_max_units
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'mining_enabled', v_cfg.mining_enabled,
    'base_reward_units', v_cfg.base_reward_units,
    'daily_increment_units', v_cfg.daily_increment_units,
    'max_daily_reward_units', v_cfg.max_daily_reward_units,
    'daily_cap_start_units', v_cfg.daily_cap_start_units,
    'daily_cap_max_units', v_cfg.daily_cap_max_units,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, bigint) TO authenticated;
