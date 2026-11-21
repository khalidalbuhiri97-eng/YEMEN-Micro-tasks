-- YT Coin: isolated ledger and mining foundation.
-- Does not modify public wallets, financial_accounts, ledger_transactions, or ledger_entries.
CREATE SCHEMA IF NOT EXISTS yt_coin;
REVOKE ALL ON SCHEMA yt_coin FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA yt_coin TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS yt_coin.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_supply_units bigint NOT NULL DEFAULT 1000000000000000 CHECK (max_supply_units = 1000000000000000),
  daily_global_cap_units bigint NULL CHECK (daily_global_cap_units IS NULL OR daily_global_cap_units > 0),
  mining_enabled boolean NOT NULL DEFAULT false,
  base_reward_units bigint NOT NULL DEFAULT 500000 CHECK (base_reward_units = 500000),
  daily_increment_units bigint NOT NULL DEFAULT 10000 CHECK (daily_increment_units = 10000),
  max_daily_reward_units bigint NOT NULL DEFAULT 1500000 CHECK (max_daily_reward_units = 1500000),
  timezone_name text NOT NULL DEFAULT 'Asia/Aden' CHECK (timezone_name = 'Asia/Aden'),
  reference_yt_per_yer numeric(12,6) NOT NULL DEFAULT 100 CHECK (reference_yt_per_yer = 100),
  legacy_backing_snapshot_units bigint NOT NULL DEFAULT 999973500000000,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO yt_coin.config(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS yt_coin.accounts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  balance_units bigint NOT NULL DEFAULT 0 CHECK (balance_units >= 0),
  lifetime_earned_units bigint NOT NULL DEFAULT 0 CHECK (lifetime_earned_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.system_treasury (
  treasury_key text PRIMARY KEY DEFAULT 'YT-REWARDS-TREASURY' CHECK (treasury_key = 'YT-REWARDS-TREASURY'),
  balance_units bigint NOT NULL DEFAULT 0 CHECK (balance_units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO yt_coin.system_treasury(treasury_key) VALUES ('YT-REWARDS-TREASURY') ON CONFLICT (treasury_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS yt_coin.allocations (
  allocation_key text PRIMARY KEY,
  label_ar text NOT NULL,
  allocated_units bigint NOT NULL CHECK (allocated_units >= 0),
  spent_units bigint NOT NULL DEFAULT 0 CHECK (spent_units >= 0 AND spent_units <= allocated_units),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.issuance_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_key text REFERENCES yt_coin.allocations(allocation_key) ON DELETE RESTRICT,
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','issued','rejected')),
  proposed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  executed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  executed_at timestamptz
);

CREATE TABLE IF NOT EXISTS yt_coin.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('initial_treasury_snapshot','mining_reward','approved_issuance','admin_adjustment','purchase_credit','reservation_release')),
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  reference text NOT NULL UNIQUE,
  allocation_key text REFERENCES yt_coin.allocations(allocation_key) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.daily_mining_totals (
  claim_date date PRIMARY KEY,
  paid_units bigint NOT NULL DEFAULT 0 CHECK (paid_units >= 0),
  claim_count integer NOT NULL DEFAULT 0 CHECK (claim_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  claim_date date NOT NULL,
  streak_day integer NOT NULL CHECK (streak_day BETWEEN 1 AND 101),
  amount_units bigint NOT NULL CHECK (amount_units BETWEEN 500000 AND 1500000),
  ledger_id uuid NOT NULL UNIQUE REFERENCES yt_coin.ledger(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, claim_date)
);
CREATE INDEX IF NOT EXISTS mining_claims_user_date_idx ON yt_coin.mining_claims(user_id, claim_date DESC);

CREATE TABLE IF NOT EXISTS yt_coin.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE yt_coin.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.system_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.issuance_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.daily_mining_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.mining_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA yt_coin FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA yt_coin TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA yt_coin TO service_role;

CREATE OR REPLACE FUNCTION yt_coin.claim_daily_mining()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date;
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
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.daily_global_cap_units IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين غير متاح قبل اعتماد سقف التعدين اليومي وإطلاق الخدمة.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_submissions ts
    WHERE ts.user_id = v_user_id
      AND lower(ts.status) = 'approved'
      AND ts.reward_transaction_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'يجب اعتماد مهمة واحدة على الأقل قبل أهلية التعدين.');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Aden')::date;
  INSERT INTO yt_coin.accounts(user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة التعدين لهذا اليوم.');
  END IF;

  SELECT claim_date, streak_day INTO v_last_date, v_last_streak
  FROM yt_coin.mining_claims
  WHERE user_id = v_user_id
  ORDER BY claim_date DESC
  LIMIT 1;

  v_streak := CASE WHEN v_last_date = v_today - 1 THEN LEAST(v_last_streak + 1, 101) ELSE 1 END;
  v_reward := LEAST(v_cfg.base_reward_units + ((v_streak - 1) * v_cfg.daily_increment_units), v_cfg.max_daily_reward_units);

  INSERT INTO yt_coin.daily_mining_totals(claim_date) VALUES (v_today)
  ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF v_daily_paid + v_reward > v_cfg.daily_global_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التعدين اليومي.');
  END IF;

  SELECT balance_units INTO v_treasury FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص التعدين غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id,event_type,amount_units,reference,metadata)
  VALUES (v_user_id,'mining_reward',v_reward,'YT-MINING:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object('claim_date',v_today,'streak_day',v_streak,'timezone','Asia/Aden'))
  RETURNING id INTO v_ledger_id;

  UPDATE yt_coin.system_treasury SET balance_units = balance_units - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts SET balance_units = balance_units + v_reward,
    lifetime_earned_units = lifetime_earned_units + v_reward, updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO yt_coin.mining_claims(user_id,claim_date,streak_day,amount_units,ledger_id)
  VALUES (v_user_id,v_today,v_streak,v_reward,v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals SET paid_units = paid_units + v_reward,
    claim_count = claim_count + 1, updated_at = now() WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
  VALUES (v_user_id,'daily_mining_claim','mining_claim',v_claim_id::text,
    jsonb_build_object('amount_units',v_reward,'streak_day',v_streak,'claim_date',v_today));

  RETURN jsonb_build_object('success',true,'status','claimed','amount_units',v_reward,'streak_day',v_streak,'claim_date',v_today);
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated, service_role;

COMMENT ON SCHEMA yt_coin IS 'Independent YT Coin ledger; isolated from Yemeni Rial financial ledgers.';
COMMENT ON TABLE yt_coin.config IS 'Fixed YT Coin rules. Daily mining cap remains NULL and mining disabled until explicitly approved.';
COMMENT ON COLUMN yt_coin.config.legacy_backing_snapshot_units IS 'Read-only atomic-unit snapshot of legacy public.yt_coin_treasury; not imported as spendable balance to avoid double counting.';
