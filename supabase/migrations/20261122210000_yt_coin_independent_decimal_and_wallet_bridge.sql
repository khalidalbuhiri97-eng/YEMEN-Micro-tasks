-- ============================================================================
-- YT COIN: INDEPENDENT SYSTEM & TABLES (1.00 YT = 100 SUB-PARTS OF 0.01 YT)
-- MAX SUPPLY = EXACT 1,000,000,000.00 YT (NEVER MULTIPLIED BY 100)
-- DAILY REWARD = FLAT 0.50 YT | TAP REWARD = 0.01 YT | AD REWARD = 0.05 YT
-- RELATIONAL BRIDGE TO EXTERNAL YEMEN TASK WALLET (YER) VIA yt_coin.wallet_swaps
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS yt_coin;

-- ----------------------------------------------------------------------------
-- 1. Independent YT Coin Tables (yt_coin schema)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yt_coin.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mining_enabled boolean NOT NULL DEFAULT true,
  max_supply_yt numeric(20, 2) NOT NULL DEFAULT 1000000000.00,
  base_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.50,
  tap_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.01,
  ad_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.05,
  daily_tap_limit integer NOT NULL DEFAULT 1000,
  daily_ad_limit integer NOT NULL DEFAULT 20,
  daily_cap_start_yt numeric(20, 2) NOT NULL DEFAULT 1000.00,
  daily_cap_increment_yt numeric(20, 2) NOT NULL DEFAULT 10.00,
  daily_cap_max_yt numeric(20, 2) NOT NULL DEFAULT 1000000.00,
  swap_enabled boolean NOT NULL DEFAULT true,
  exchange_rate_yer_per_yt numeric(20, 6) NOT NULL DEFAULT 1.000000,
  swap_fee_percent numeric(5, 2) NOT NULL DEFAULT 0.00,
  mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  decimal_migrated boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text UNIQUE,
  balance_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (balance_yt >= 0),
  lifetime_earned_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (lifetime_earned_yt >= 0),
  total_transferred_out_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (total_transferred_out_yt >= 0),
  total_transferred_in_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (total_transferred_in_yt >= 0),
  total_swapped_to_yer_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (total_swapped_to_yer_yt >= 0),
  total_swapped_from_yer_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (total_swapped_from_yer_yt >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.system_treasury (
  treasury_key text PRIMARY KEY,
  balance_yt numeric(20, 2) NOT NULL DEFAULT 0.00 CHECK (balance_yt >= 0),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  amount_yt numeric(20, 2) NOT NULL DEFAULT 0.50 CHECK (amount_yt > 0),
  ledger_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_date)
);

CREATE TABLE IF NOT EXISTS yt_coin.daily_user_taps (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_date date NOT NULL,
  tap_count integer NOT NULL DEFAULT 0,
  paid_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, tap_date)
);

CREATE TABLE IF NOT EXISTS yt_coin.ad_watch_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watch_date date NOT NULL,
  ad_slot text NOT NULL DEFAULT 'yt_coin_reward_ad',
  reward_yt numeric(20, 2) NOT NULL CHECK (reward_yt > 0),
  ledger_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_ad_watch_user_date
  ON yt_coin.ad_watch_claims(user_id, watch_date);

CREATE TABLE IF NOT EXISTS yt_coin.daily_mining_totals (
  claim_date date PRIMARY KEY,
  paid_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  claim_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount_yt numeric(20, 2) NOT NULL,
  reference text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_ledger_user_created
  ON yt_coin.ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS yt_coin.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_address text NOT NULL,
  recipient_address text NOT NULL,
  amount_yt numeric(20, 2) NOT NULL CHECK (amount_yt > 0),
  note text,
  sender_ledger_id uuid REFERENCES yt_coin.ledger(id),
  recipient_ledger_id uuid REFERENCES yt_coin.ledger(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_transfers_parties
  ON yt_coin.transfers(sender_id, recipient_id, created_at DESC);

-- Relational Bridge Only: connects independent YT Coin ledger to Yemen Task YER wallets
CREATE TABLE IF NOT EXISTS yt_coin.wallet_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('YT_TO_YER', 'YER_TO_YT')),
  yt_wallet_address text NOT NULL,
  yer_wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  yer_wallet_address text,
  amount_yt numeric(20, 2) NOT NULL CHECK (amount_yt > 0),
  exchange_rate_yer_per_yt numeric(20, 6) NOT NULL CHECK (exchange_rate_yer_per_yt > 0),
  fee_yer numeric(30, 6) NOT NULL DEFAULT 0.000000 CHECK (fee_yer >= 0),
  amount_yer numeric(30, 6) NOT NULL CHECK (amount_yer > 0),
  yt_ledger_id uuid REFERENCES yt_coin.ledger(id),
  yer_ledger_tx_id uuid REFERENCES public.ledger_transactions(id),
  status text NOT NULL DEFAULT 'COMPLETED',
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_wallet_swaps_user
  ON yt_coin.wallet_swaps(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS yt_coin.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Upgrade pre-existing tables safely & idempotently to pure NUMERIC(20,2)
-- ----------------------------------------------------------------------------
ALTER TABLE yt_coin.config
  ADD COLUMN IF NOT EXISTS mining_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_supply_yt numeric(20, 2) NOT NULL DEFAULT 1000000000.00,
  ADD COLUMN IF NOT EXISTS base_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS tap_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS ad_reward_yt numeric(20, 2) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS daily_tap_limit integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS daily_ad_limit integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS daily_cap_start_yt numeric(20, 2) NOT NULL DEFAULT 1000.00,
  ADD COLUMN IF NOT EXISTS daily_cap_increment_yt numeric(20, 2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS daily_cap_max_yt numeric(20, 2) NOT NULL DEFAULT 1000000.00,
  ADD COLUMN IF NOT EXISTS swap_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exchange_rate_yer_per_yt numeric(20, 6) NOT NULL DEFAULT 1.000000,
  ADD COLUMN IF NOT EXISTS swap_fee_percent numeric(5, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  ADD COLUMN IF NOT EXISTS decimal_migrated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE yt_coin.accounts
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS balance_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS lifetime_earned_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_transferred_out_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_transferred_in_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_swapped_to_yer_yt numeric(20, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_swapped_from_yer_yt numeric(20, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE yt_coin.system_treasury
  ADD COLUMN IF NOT EXISTS balance_yt numeric(20, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE yt_coin.mining_claims
  ADD COLUMN IF NOT EXISTS amount_yt numeric(20, 2) NOT NULL DEFAULT 0.50;

ALTER TABLE yt_coin.daily_user_taps
  ADD COLUMN IF NOT EXISTS paid_yt numeric(20, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE yt_coin.daily_mining_totals
  ADD COLUMN IF NOT EXISTS paid_yt numeric(20, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE yt_coin.ledger
  ADD COLUMN IF NOT EXISTS amount_yt numeric(20, 2) NOT NULL DEFAULT 0.00;

DO $$
DECLARE
  v_has_legacy_units boolean := false;
  v_old_scale numeric := 1;
  v_migrated boolean := false;
  v_total_circulating numeric(20, 2) := 0;
  v_swap_pool numeric(20, 2) := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM yt_coin.config WHERE singleton = true) THEN
    SELECT COALESCE(decimal_migrated, false) INTO v_migrated
    FROM yt_coin.config WHERE singleton = true;
  ELSE
    INSERT INTO yt_coin.config (
      singleton, mining_enabled, max_supply_yt, base_reward_yt, tap_reward_yt, ad_reward_yt,
      daily_tap_limit, daily_ad_limit, daily_cap_start_yt, daily_cap_increment_yt, daily_cap_max_yt,
      swap_enabled, exchange_rate_yer_per_yt, swap_fee_percent, mining_start_date, decimal_migrated
    ) VALUES (
      true, true, 1000000000.00, 0.50, 0.01, 0.05,
      1000, 20, 1000.00, 10.00, 1000000.00,
      true, 1.000000, 0.00, (now() AT TIME ZONE 'Asia/Aden')::date, true
    );
    v_migrated := true;
  END IF;

  IF NOT v_migrated THEN
    v_has_legacy_units := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'yt_coin' AND table_name = 'config' AND column_name = 'max_supply_units'
    );

    IF v_has_legacy_units THEN
      EXECUTE $q$
        SELECT COALESCE(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'yt_coin' AND table_name = 'config' AND column_name = 'unit_scale'
            ) AND COALESCE(unit_scale, 0) > 0 THEN unit_scale::numeric
            WHEN COALESCE(max_supply_units, 0) >= 50000000000 THEN 100
            WHEN COALESCE(max_supply_units, 0) >= 1500000000 THEN 2
            ELSE 1
          END,
          1
        )
        FROM yt_coin.config WHERE singleton = true
      $q$ INTO v_old_scale;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'yt_coin' AND table_name = 'accounts' AND column_name = 'balance_units'
      ) THEN
        EXECUTE format(
          'UPDATE yt_coin.accounts SET balance_yt = ROUND(COALESCE(balance_units, 0)::numeric / %s, 2), lifetime_earned_yt = ROUND(COALESCE(lifetime_earned_units, 0)::numeric / %s, 2)',
          v_old_scale, v_old_scale
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'yt_coin' AND table_name = 'ledger' AND column_name = 'amount_units'
      ) THEN
        EXECUTE format(
          'UPDATE yt_coin.ledger SET amount_yt = ROUND(COALESCE(amount_units, reward_units, 0)::numeric / %s, 2)',
          v_old_scale
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'yt_coin' AND table_name = 'mining_claims' AND column_name = 'amount_units'
      ) THEN
        EXECUTE format(
          'UPDATE yt_coin.mining_claims SET amount_yt = ROUND(COALESCE(amount_units, reward_units, 0)::numeric / %s, 2)',
          v_old_scale
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'yt_coin' AND table_name = 'daily_user_taps' AND column_name = 'paid_units'
      ) THEN
        EXECUTE format(
          'UPDATE yt_coin.daily_user_taps SET paid_yt = ROUND(COALESCE(paid_units, 0)::numeric / %s, 2)',
          v_old_scale
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'yt_coin' AND table_name = 'daily_mining_totals' AND column_name = 'paid_units'
      ) THEN
        EXECUTE format(
          'UPDATE yt_coin.daily_mining_totals SET paid_yt = ROUND(COALESCE(paid_units, 0)::numeric / %s, 2)',
          v_old_scale
        );
      END IF;
    END IF;

    UPDATE yt_coin.config
    SET max_supply_yt = 1000000000.00,
        base_reward_yt = 0.50,
        tap_reward_yt = 0.01,
        ad_reward_yt = COALESCE(NULLIF(ad_reward_yt, 0), 0.05),
        daily_tap_limit = COALESCE(NULLIF(daily_tap_limit, 0), 1000),
        daily_ad_limit = COALESCE(NULLIF(daily_ad_limit, 0), 20),
        daily_cap_start_yt = GREATEST(COALESCE(daily_cap_start_yt, 1000.00), 1000.00),
        daily_cap_increment_yt = GREATEST(COALESCE(daily_cap_increment_yt, 10.00), 10.00),
        daily_cap_max_yt = GREATEST(COALESCE(daily_cap_max_yt, 1000000.00), 1000000.00),
        decimal_migrated = true,
        updated_at = now()
    WHERE singleton = true;
  END IF;

  -- Clean up legacy scaled *_units columns so 1,000,000,000.00 YT is the sole canonical representation
  ALTER TABLE yt_coin.config
    DROP COLUMN IF EXISTS unit_scale,
    DROP COLUMN IF EXISTS max_supply_units,
    DROP COLUMN IF EXISTS base_reward_units,
    DROP COLUMN IF EXISTS daily_increment_units,
    DROP COLUMN IF EXISTS max_daily_reward_units,
    DROP COLUMN IF EXISTS tap_reward_units,
    DROP COLUMN IF EXISTS daily_cap_start_units,
    DROP COLUMN IF EXISTS daily_cap_increment_units,
    DROP COLUMN IF EXISTS daily_cap_max_units,
    DROP COLUMN IF EXISTS daily_global_cap_units,
    DROP COLUMN IF EXISTS daily_global_cap_increment_units,
    DROP COLUMN IF EXISTS daily_global_cap_max_units;

  ALTER TABLE yt_coin.accounts
    DROP COLUMN IF EXISTS balance_units,
    DROP COLUMN IF EXISTS lifetime_earned_units;

  ALTER TABLE yt_coin.system_treasury
    DROP COLUMN IF EXISTS balance_units;

  ALTER TABLE yt_coin.mining_claims
    DROP COLUMN IF EXISTS amount_units,
    DROP COLUMN IF EXISTS reward_units,
    DROP COLUMN IF EXISTS streak_day;

  ALTER TABLE yt_coin.daily_user_taps
    DROP COLUMN IF EXISTS paid_units;

  ALTER TABLE yt_coin.daily_mining_totals
    DROP COLUMN IF EXISTS paid_units;

  ALTER TABLE yt_coin.ledger
    DROP COLUMN IF EXISTS amount_units,
    DROP COLUMN IF EXISTS reward_units;

  -- Backfill independent yt1 wallet addresses
  UPDATE yt_coin.accounts
  SET wallet_address = 'yt1' || replace(user_id::text, '-', '')
  WHERE wallet_address IS NULL OR wallet_address = '';

  SELECT COALESCE(sum(balance_yt), 0.00) INTO v_total_circulating FROM yt_coin.accounts;
  SELECT COALESCE(balance_yt, 0.00) INTO v_swap_pool
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-SWAP-POOL';

  INSERT INTO yt_coin.system_treasury (treasury_key, balance_yt)
  VALUES ('YT-SWAP-POOL', COALESCE(v_swap_pool, 0.00))
  ON CONFLICT (treasury_key) DO NOTHING;

  INSERT INTO yt_coin.system_treasury (treasury_key, balance_yt)
  VALUES (
    'YT-REWARDS-TREASURY',
    GREATEST(0.00, 1000000000.00 - v_total_circulating - COALESCE(v_swap_pool, 0.00))
  )
  ON CONFLICT (treasury_key) DO UPDATE SET
    balance_yt = GREATEST(0.00, 1000000000.00 - v_total_circulating - COALESCE(v_swap_pool, 0.00)),
    updated_at = now();
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'yt_coin.accounts'::regclass AND conname = 'yt_coin_accounts_wallet_address_uniq'
  ) THEN
    ALTER TABLE yt_coin.accounts ALTER COLUMN wallet_address SET NOT NULL;
    ALTER TABLE yt_coin.accounts ADD CONSTRAINT yt_coin_accounts_wallet_address_uniq UNIQUE (wallet_address);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Yemen Task Ledger Integration Account (Stays 100% YER; Bridge Only)
-- ----------------------------------------------------------------------------
INSERT INTO public.financial_accounts (
  account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
) VALUES (
  'YT-COIN-SWAP-LIQUIDITY', 'treasury', NULL, NULL, 'credit', 0.000000, 'active', NOW()
)
ON CONFLICT (account_code) DO NOTHING;

-- Allow YT_COIN_SWAP in public.wallet_transactions if a CHECK constraint exists on type
DO $$
DECLARE
  v_chk RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_transactions') THEN
    FOR v_chk IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.wallet_transactions'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ~* '\ytype\y'
    LOOP
      EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS %I', v_chk.conname);
    END LOOP;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Lock down direct table access on yt_coin schema (RPC-only access)
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA yt_coin FROM PUBLIC, anon, authenticated;
ALTER TABLE yt_coin.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.system_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.mining_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.daily_user_taps ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ad_watch_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.daily_mining_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.wallet_swaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RPC: public.get_my_yt_coin_summary()
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_my_yt_coin_summary();
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
  v_cfg yt_coin.config%ROWTYPE;
  v_acct yt_coin.accounts%ROWTYPE;
  v_cap numeric(20, 2) := 0;
  v_days_elapsed bigint := 0;
  v_last_date date;
  v_claimed_today boolean := false;
  v_taps_today integer := 0;
  v_tap_paid_today numeric(20, 2) := 0.00;
  v_ads_today integer := 0;
  v_today_paid numeric(20, 2) := 0.00;
  v_total_mined numeric(20, 2) := 0.00;
  v_treasury_balance numeric(20, 2) := 0.00;
  v_swap_pool_balance numeric(20, 2) := 0.00;
  v_user_claims_count bigint := 0;
  v_eligible boolean := false;
  v_yer_wallet_address text;
  v_yer_available_balance numeric(30, 6) := 0.000000;
  v_history jsonb := '[]'::jsonb;
  v_swaps jsonb := '[]'::jsonb;
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

  SELECT * INTO v_acct FROM yt_coin.accounts WHERE user_id = v_user_id;

  SELECT count(*) INTO v_user_claims_count
  FROM yt_coin.mining_claims WHERE user_id = v_user_id;

  SELECT COALESCE(tap_count, 0), COALESCE(paid_yt, 0.00)
  INTO v_taps_today, v_tap_paid_today
  FROM yt_coin.daily_user_taps
  WHERE user_id = v_user_id AND tap_date = v_today;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_watch_claims
  WHERE user_id = v_user_id AND watch_date = v_today;

  v_days_elapsed := CASE
    WHEN v_cfg.mining_start_date IS NULL THEN 0
    ELSE GREATEST(0, (v_today - v_cfg.mining_start_date))
  END;
  v_cap := LEAST(
    COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    COALESCE(v_cfg.daily_cap_start_yt, 1000.00) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_yt, 10.00))
  );

  SELECT claim_date INTO v_last_date
  FROM yt_coin.mining_claims WHERE user_id = v_user_id
  ORDER BY claim_date DESC LIMIT 1;
  v_claimed_today := (v_last_date = v_today);

  SELECT COALESCE(paid_yt, 0.00) INTO v_today_paid
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_mined
  FROM yt_coin.ledger
  WHERE event_type IN ('daily_mining_reward', 'tap_mining_reward', 'ad_watch_reward', 'mining_reward');

  SELECT COALESCE(balance_yt, 0.00) INTO v_treasury_balance
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(balance_yt, 0.00) INTO v_swap_pool_balance
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-SWAP-POOL';

  SELECT w.wallet_address, COALESCE(fa.balance_units, 0.000000)
  INTO v_yer_wallet_address, v_yer_available_balance
  FROM public.wallets w
  LEFT JOIN public.financial_accounts fa
    ON fa.wallet_id = w.id AND fa.account_type = 'wallet' AND fa.status = 'active'
  WHERE w.user_id = v_user_id
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'amountYt', l.amount_yt,
    'reference', l.reference,
    'metadata', l.metadata,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_yt, reference, metadata, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) l;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'direction', s.direction,
    'amountYt', s.amount_yt,
    'amountYer', s.amount_yer,
    'exchangeRate', s.exchange_rate_yer_per_yt,
    'yerWalletAddress', s.yer_wallet_address,
    'status', s.status,
    'createdAt', s.created_at
  ) ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_swaps
  FROM (
    SELECT id, direction, amount_yt, amount_yer, exchange_rate_yer_per_yt, yer_wallet_address, status, created_at
    FROM yt_coin.wallet_swaps WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 15
  ) s;

  RETURN jsonb_build_object(
    'walletAddress', COALESCE(v_acct.wallet_address, 'yt1' || replace(v_user_id::text, '-', '')),
    'balanceYt', COALESCE(v_acct.balance_yt, 0.00),
    'lifetimeEarnedYt', COALESCE(v_acct.lifetime_earned_yt, 0.00),
    'miningEnabled', COALESCE(v_cfg.mining_enabled, false) AND v_cfg.mining_start_date IS NOT NULL,
    'maxSupplyYt', COALESCE(v_cfg.max_supply_yt, 1000000000.00),
    'totalMinedYt', v_total_mined,
    'poolRemainingYt', v_treasury_balance,
    'swapPoolYt', v_swap_pool_balance,
    'dailyCapConfigured', v_cfg.mining_start_date IS NOT NULL,
    'dailyCapYt', v_cap,
    'dailyCapStartYt', COALESCE(v_cfg.daily_cap_start_yt, 1000.00),
    'dailyCapIncrementYt', COALESCE(v_cfg.daily_cap_increment_yt, 10.00),
    'dailyCapMaxYt', COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    'baseRewardYt', COALESCE(v_cfg.base_reward_yt, 0.50),
    'tapRewardYt', COALESCE(v_cfg.tap_reward_yt, 0.01),
    'adRewardYt', COALESCE(v_cfg.ad_reward_yt, 0.05),
    'dailyTapLimit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'tapsToday', v_taps_today,
    'tapPaidYtToday', v_tap_paid_today,
    'dailyTapsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_tap_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_tap_limit - v_taps_today, 0)
    END,
    'adsToday', v_ads_today,
    'dailyAdsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_ad_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_ad_limit - v_ads_today, 0)
    END,
    'minedTodayYt', v_today_paid,
    'dailyCapRemainingYt', GREATEST(COALESCE(v_cap, 0.00) - COALESCE(v_today_paid, 0.00), 0.00),
    'swapEnabled', COALESCE(v_cfg.swap_enabled, true),
    'exchangeRateYerPerYt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'swapFeePercent', COALESCE(v_cfg.swap_fee_percent, 0.00),
    'yerWalletAddress', v_yer_wallet_address,
    'yerAvailableBalance', v_yer_available_balance,
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'eligibilityMessage', CASE
      WHEN NOT COALESCE(v_cfg.mining_enabled, false) OR v_cfg.mining_start_date IS NULL THEN 'التعدين متاح من الإدارة فقط حالياً.'
      WHEN NOT v_eligible THEN 'يلزم حساب نشط للتعدين.'
      ELSE NULL
    END,
    'nextRewardYt', COALESCE(v_cfg.base_reward_yt, 0.50),
    'lastClaimDate', v_last_date,
    'totalClaims', v_user_claims_count,
    'history', v_history,
    'swaps', v_swaps
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

-- ============================================================================
-- 6. RPC: yt_coin.claim_daily_mining() & public.claim_my_yt_coin_daily()
--         Flat 0.50 YT daily login reward (zero daily growth)
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
  v_cap numeric(20, 2) := 0.00;
  v_reward numeric(20, 2) := 0.50;
  v_daily_paid numeric(20, 2) := 0.00;
  v_total_mined numeric(20, 2) := 0.00;
  v_treasury numeric(20, 2) := 0.00;
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

  v_reward := COALESCE(v_cfg.base_reward_yt, 0.50);
  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(
    COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    COALESCE(v_cfg.daily_cap_start_yt, 1000.00) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_yt, 10.00))
  );

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة الدخول اليومي لهذا اليوم بالفعل.');
  END IF;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_yt, claim_count)
  VALUES (v_today, 0.00, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_yt INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('daily_mining_reward', 'tap_mining_reward', 'ad_watch_reward', 'mining_reward');

  IF (v_daily_paid + v_reward) > v_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'daily_cap_reached',
      'message', 'تم بلوغ سقف التعدين اليومي للمنصة.',
      'dailyCapYt', v_cap,
      'dailyPaidYt', v_daily_paid,
      'dailyRemainingYt', GREATEST(v_cap - v_daily_paid, 0.00)
    );
  END IF;

  IF (v_total_mined + v_reward) > v_cfg.max_supply_yt THEN
    RETURN jsonb_build_object('success', false, 'status', 'max_supply_reached', 'message', 'تم استنفاد المعروض الكلي البالغ 1 مليار YT Coin.');
  END IF;

  SELECT balance_yt INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0.00) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد خزينة المكافآت غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
  VALUES (
    v_user_id,
    'daily_mining_reward',
    v_reward,
    'YT-DAILY:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object('claimDate', v_today, 'timezone', 'Asia/Aden', 'dailyCapYt', v_cap)
  ) RETURNING id INTO v_ledger_id;

  UPDATE yt_coin.system_treasury
  SET balance_yt = balance_yt - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_yt = balance_yt + v_reward,
      lifetime_earned_yt = lifetime_earned_yt + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO yt_coin.mining_claims(user_id, claim_date, amount_yt, ledger_id)
  VALUES (v_user_id, v_today, v_reward, v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals
  SET paid_yt = paid_yt + v_reward,
      claim_count = claim_count + 1,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id, 'daily_mining_claim', 'mining_claim', v_claim_id::text,
    jsonb_build_object('amountYt', v_reward, 'claimDate', v_today)
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'claimed',
    'rewardYt', v_reward,
    'amountYt', v_reward,
    'claimDate', v_today,
    'dailyCapYt', v_cap,
    'dailyRemainingYt', GREATEST(v_cap - (v_daily_paid + v_reward), 0.00)
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
-- 7. RPC: yt_coin.claim_tap_mining(p_taps) & public.claim_my_yt_coin_taps(p_taps)
--         0.01 YT per tap (1/100 sub-unit of 1 YT)
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
  v_cap numeric(20, 2) := 0.00;
  v_tap_reward numeric(20, 2) := 0.01;
  v_daily_tap_limit integer := 1000;
  v_taps_today integer := 0;
  v_reward numeric(20, 2) := 0.00;
  v_daily_paid numeric(20, 2) := 0.00;
  v_total_mined numeric(20, 2) := 0.00;
  v_treasury numeric(20, 2) := 0.00;
  v_new_balance numeric(20, 2) := 0.00;
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

  v_tap_reward := COALESCE(v_cfg.tap_reward_yt, 0.01);
  v_daily_tap_limit := COALESCE(v_cfg.daily_tap_limit, 1000);
  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(
    COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    COALESCE(v_cfg.daily_cap_start_yt, 1000.00) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_yt, 10.00))
  );

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  INSERT INTO yt_coin.daily_user_taps(user_id, tap_date, tap_count, paid_yt)
  VALUES (v_user_id, v_today, 0, 0.00)
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

  v_reward := ROUND(v_taps::numeric * v_tap_reward, 2);

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_yt, claim_count)
  VALUES (v_today, 0.00, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_yt INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('daily_mining_reward', 'tap_mining_reward', 'ad_watch_reward', 'mining_reward');

  IF (v_daily_paid + v_reward) > v_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'daily_cap_reached',
      'message', 'تم بلوغ سقف التعدين اليومي للمنصة.',
      'dailyCapYt', v_cap,
      'dailyPaidYt', v_daily_paid,
      'dailyRemainingYt', GREATEST(v_cap - v_daily_paid, 0.00)
    );
  END IF;

  IF (v_total_mined + v_reward) > v_cfg.max_supply_yt THEN
    RETURN jsonb_build_object('success', false, 'status', 'max_supply_reached', 'message', 'تم استنفاد إجمالي المعروض الكلي.');
  END IF;

  SELECT balance_yt INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0.00) < v_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد الخزينة غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
  VALUES (
    v_user_id,
    'tap_mining_reward',
    v_reward,
    'YT-TAP:' || v_user_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('tapDate', v_today, 'taps', v_taps, 'tapRewardYt', v_tap_reward)
  );

  UPDATE yt_coin.system_treasury
  SET balance_yt = balance_yt - v_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_yt = balance_yt + v_reward,
      lifetime_earned_yt = lifetime_earned_yt + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_yt INTO v_new_balance;

  UPDATE yt_coin.daily_user_taps
  SET tap_count = tap_count + v_taps,
      paid_yt = paid_yt + v_reward,
      updated_at = now()
  WHERE user_id = v_user_id AND tap_date = v_today;

  UPDATE yt_coin.daily_mining_totals
  SET paid_yt = paid_yt + v_reward,
      updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'tapsCredited', v_taps,
    'rewardYt', v_reward,
    'amountYt', v_reward,
    'balanceYt', v_new_balance,
    'tapsToday', v_taps_today + v_taps,
    'dailyTapLimit', v_daily_tap_limit,
    'dailyTapsRemaining', CASE WHEN v_daily_tap_limit <= 0 THEN NULL ELSE GREATEST(v_daily_tap_limit - (v_taps_today + v_taps), 0) END,
    'dailyCapYt', v_cap,
    'dailyRemainingYt', GREATEST(v_cap - (v_daily_paid + v_reward), 0.00)
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
-- 8. RPC: public.claim_my_yt_coin_ad(p_ad_slot)
--         Fractional YT reward for watching ads (default 0.05 YT)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_ad(p_ad_slot text DEFAULT 'yt_coin_reward_ad')
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
  v_cap numeric(20, 2) := 0.00;
  v_ad_reward numeric(20, 2) := 0.05;
  v_daily_ad_limit integer := 20;
  v_ads_today integer := 0;
  v_last_ad_at timestamptz;
  v_daily_paid numeric(20, 2) := 0.00;
  v_total_mined numeric(20, 2) := 0.00;
  v_treasury numeric(20, 2) := 0.00;
  v_ledger_id uuid;
  v_new_balance numeric(20, 2) := 0.00;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين متاح من الإدارة فقط حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  v_ad_reward := COALESCE(v_cfg.ad_reward_yt, 0.05);
  v_daily_ad_limit := COALESCE(v_cfg.daily_ad_limit, 20);
  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap := LEAST(
    COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    COALESCE(v_cfg.daily_cap_start_yt, 1000.00) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_yt, 10.00))
  );

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  SELECT count(*), max(created_at) INTO v_ads_today, v_last_ad_at
  FROM yt_coin.ad_watch_claims
  WHERE user_id = v_user_id AND watch_date = v_today;

  IF v_last_ad_at IS NOT NULL AND v_last_ad_at > now() - interval '8 seconds' THEN
    RETURN jsonb_build_object('success', false, 'status', 'cooldown', 'message', 'يرجى الانتظار قليلاً بين كل إعلان وآخر.');
  END IF;

  IF v_daily_ad_limit > 0 AND v_ads_today >= v_daily_ad_limit THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_ad_limit_reached', 'message', 'تم بلوغ الحد اليومي لمكافآت مشاهدة الإعلانات.');
  END IF;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_yt, claim_count)
  VALUES (v_today, 0.00, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_yt INTO v_daily_paid FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;
  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_mined
  FROM yt_coin.ledger WHERE event_type IN ('daily_mining_reward', 'tap_mining_reward', 'ad_watch_reward', 'mining_reward');

  IF (v_daily_paid + v_ad_reward) > v_cap THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التعدين اليومي للمنصة.');
  END IF;

  IF (v_total_mined + v_ad_reward) > v_cfg.max_supply_yt THEN
    RETURN jsonb_build_object('success', false, 'status', 'max_supply_reached', 'message', 'تم استنفاد المعروض الكلي للعملة.');
  END IF;

  SELECT balance_yt INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_treasury, 0.00) < v_ad_reward THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد الخزينة غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
  VALUES (
    v_user_id,
    'ad_watch_reward',
    v_ad_reward,
    'YT-AD:' || v_user_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('watchDate', v_today, 'adSlot', COALESCE(NULLIF(TRIM(p_ad_slot), ''), 'yt_coin_reward_ad'))
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO yt_coin.ad_watch_claims(user_id, watch_date, ad_slot, reward_yt, ledger_id)
  VALUES (v_user_id, v_today, COALESCE(NULLIF(TRIM(p_ad_slot), ''), 'yt_coin_reward_ad'), v_ad_reward, v_ledger_id);

  UPDATE yt_coin.system_treasury
  SET balance_yt = balance_yt - v_ad_reward, updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  UPDATE yt_coin.accounts
  SET balance_yt = balance_yt + v_ad_reward,
      lifetime_earned_yt = lifetime_earned_yt + v_ad_reward,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_yt INTO v_new_balance;

  UPDATE yt_coin.daily_mining_totals
  SET paid_yt = paid_yt + v_ad_reward,
      updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'rewardYt', v_ad_reward,
    'balanceYt', v_new_balance,
    'adsToday', v_ads_today + 1,
    'dailyAdLimit', v_daily_ad_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_my_yt_coin_ad(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_ad(text) TO authenticated;

-- ============================================================================
-- 9. RPC: Independent YT Coin P2P Transfer (yt1... -> yt1...)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lookup_yt_coin_wallet(p_wallet_address text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_clean_addr text := lower(trim(COALESCE(p_wallet_address, '')));
  v_rec RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_clean_addr = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT a.user_id, a.wallet_address, COALESCE(p.full_name, 'مستخدم YT Coin') AS owner_name
  INTO v_rec
  FROM yt_coin.accounts a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE lower(a.wallet_address) = v_clean_addr AND a.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'walletAddress', v_rec.wallet_address,
    'ownerName', v_rec.owner_name,
    'isSelf', v_rec.user_id = v_caller_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_yt_coin_wallet(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_yt_coin_wallet(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_yt_coin(
  p_recipient_address text,
  p_amount_yt numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sender_id uuid := auth.uid();
  v_clean_addr text := lower(trim(COALESCE(p_recipient_address, '')));
  v_amount numeric(20, 2);
  v_sender_acct yt_coin.accounts%ROWTYPE;
  v_recipient_acct yt_coin.accounts%ROWTYPE;
  v_sender_ledger_id uuid;
  v_recipient_ledger_id uuid;
  v_transfer_id uuid;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_yt IS NULL OR p_amount_yt < 0.01 OR p_amount_yt <> ROUND(p_amount_yt, 2) THEN
    RETURN jsonb_build_object('success', false, 'message', 'المبلغ يجب أن يكون 0.01 YT على الأقل وبحد أقصى خانتين عشريتين.');
  END IF;
  v_amount := ROUND(p_amount_yt, 2);

  IF v_clean_addr = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'يرجى إدخال عنوان محفظة المستلم (yt1...).');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_sender_id, 'yt1' || replace(v_sender_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_recipient_acct
  FROM yt_coin.accounts
  WHERE lower(wallet_address) = v_clean_addr AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'عنوان محفظة YT Coin غير موجود أو غير نشط.');
  END IF;
  IF v_recipient_acct.user_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'لا يمكنك التحويل إلى نفس محفظتك.');
  END IF;

  -- Deterministic lock order to prevent deadlocks
  IF v_sender_id < v_recipient_acct.user_id THEN
    SELECT * INTO v_sender_acct FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
    SELECT * INTO v_recipient_acct FROM yt_coin.accounts WHERE user_id = v_recipient_acct.user_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient_acct FROM yt_coin.accounts WHERE user_id = v_recipient_acct.user_id FOR UPDATE;
    SELECT * INTO v_sender_acct FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
  END IF;

  IF v_sender_acct.balance_yt < v_amount THEN
    RETURN jsonb_build_object('success', false, 'message', 'رصيد YT Coin المتاح غير كافٍ لإتمام التحويل.');
  END IF;

  UPDATE yt_coin.accounts
  SET balance_yt = balance_yt - v_amount,
      total_transferred_out_yt = total_transferred_out_yt + v_amount,
      updated_at = now()
  WHERE user_id = v_sender_id;

  UPDATE yt_coin.accounts
  SET balance_yt = balance_yt + v_amount,
      total_transferred_in_yt = total_transferred_in_yt + v_amount,
      updated_at = now()
  WHERE user_id = v_recipient_acct.user_id;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
  VALUES (
    v_sender_id, 'yt_transfer_sent', -v_amount,
    'YT-SEND:' || v_recipient_acct.wallet_address,
    jsonb_build_object('to', v_recipient_acct.wallet_address, 'note', p_note)
  ) RETURNING id INTO v_sender_ledger_id;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
  VALUES (
    v_recipient_acct.user_id, 'yt_transfer_received', v_amount,
    'YT-RECV:' || v_sender_acct.wallet_address,
    jsonb_build_object('from', v_sender_acct.wallet_address, 'note', p_note)
  ) RETURNING id INTO v_recipient_ledger_id;

  INSERT INTO yt_coin.transfers(
    sender_id, recipient_id, sender_address, recipient_address, amount_yt, note, sender_ledger_id, recipient_ledger_id
  ) VALUES (
    v_sender_id, v_recipient_acct.user_id, v_sender_acct.wallet_address, v_recipient_acct.wallet_address,
    v_amount, NULLIF(TRIM(COALESCE(p_note, '')), ''), v_sender_ledger_id, v_recipient_ledger_id
  ) RETURNING id INTO v_transfer_id;

  RETURN jsonb_build_object(
    'success', true,
    'transferId', v_transfer_id,
    'amountYt', v_amount,
    'recipientAddress', v_recipient_acct.wallet_address,
    'newBalanceYt', v_sender_acct.balance_yt - v_amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_yt_coin(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_yt_coin(text, numeric, text) TO authenticated;

-- ============================================================================
-- 10. RPC: Relational Bridge Swap (YT Coin Wallet <-> Yemen Task YER Wallet)
--          Keeps YT Coin in yt_coin schema and Yemen Task wallet strictly in YER.
--          Connected ONLY via relational records in yt_coin.wallet_swaps.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.swap_yt_coin_with_yer(
  p_direction text,
  p_amount_yt numeric,
  p_target_yer_wallet_address text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_dir text := upper(trim(COALESCE(p_direction, 'YT_TO_YER')));
  v_cfg yt_coin.config%ROWTYPE;
  v_yt_acct yt_coin.accounts%ROWTYPE;
  v_yer_wallet RECORD;
  v_user_yer_acc RECORD;
  v_liquidity_acc RECORD;
  v_clean_yer_addr text := upper(trim(COALESCE(p_target_yer_wallet_address, '')));
  v_amount_yt numeric(20, 2);
  v_rate numeric(20, 6);
  v_gross_yer numeric(30, 6);
  v_fee_yer numeric(30, 6);
  v_net_yer numeric(30, 6);
  v_yt_ledger_id uuid;
  v_yer_tx_id uuid;
  v_swap_id uuid;
  v_swap_pool_bal numeric(20, 2) := 0.00;
  v_rewards_pool_bal numeric(20, 2) := 0.00;
  v_new_yer_bal numeric(30, 6);
  v_prev_yer_bal numeric(30, 6);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_dir NOT IN ('YT_TO_YER', 'YER_TO_YT') THEN
    RETURN jsonb_build_object('success', false, 'message', 'اتجاه التحويل غير صالح.');
  END IF;

  IF p_amount_yt IS NULL OR p_amount_yt < 0.01 OR p_amount_yt <> ROUND(p_amount_yt, 2) THEN
    RETURN jsonb_build_object('success', false, 'message', 'الكمية يجب أن تكون 0.01 YT على الأقل وبحد أقصى خانتين عشريتين.');
  END IF;
  v_amount_yt := ROUND(p_amount_yt, 2);

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_cfg.swap_enabled, false) THEN
    RETURN jsonb_build_object('success', false, 'status', 'swap_disabled', 'message', 'خدمة التبديل مع محفظة يمن تاسك متوقفة حالياً من الإدارة.');
  END IF;

  v_rate := COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000);
  IF v_rate <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'سعر الصرف المرجعي غير مهيأ.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_yt_acct FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  -- Resolve target or own Yemen Task YER wallet
  IF v_dir = 'YT_TO_YER' AND v_clean_yer_addr <> '' THEN
    SELECT * INTO v_yer_wallet FROM public.wallets WHERE upper(wallet_address) = v_clean_yer_addr LIMIT 1;
  ELSE
    SELECT * INTO v_yer_wallet FROM public.wallets WHERE user_id = v_user_id LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'محفظة يمن تاسك (ر.ي) المستهدفة غير موجودة.');
  END IF;

  SELECT * INTO v_user_yer_acc
  FROM public.financial_accounts
  WHERE wallet_id = v_yer_wallet.id AND account_type = 'wallet' AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'الحساب المالي لمحفظة يمن تاسك غير نشط أو غير مهيأ.');
  END IF;

  SELECT * INTO v_liquidity_acc
  FROM public.financial_accounts
  WHERE account_code = 'YT-COIN-SWAP-LIQUIDITY' AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'حساب سيولة التبديل YT-COIN-SWAP-LIQUIDITY غير متوفر.');
  END IF;

  v_gross_yer := ROUND(v_amount_yt * v_rate, 6);
  v_fee_yer := ROUND(v_gross_yer * (COALESCE(v_cfg.swap_fee_percent, 0.00) / 100.0), 6);
  v_net_yer := ROUND(v_gross_yer - v_fee_yer, 6);
  IF v_net_yer <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'القيمة المقابلة بالريال اليمني صغيرة جداً.');
  END IF;

  v_prev_yer_bal := COALESCE(v_user_yer_acc.balance_units, 0.000000);

  IF v_dir = 'YT_TO_YER' THEN
    IF v_yt_acct.balance_yt < v_amount_yt THEN
      RETURN jsonb_build_object('success', false, 'status', 'insufficient_yt', 'message', 'رصيد YT Coin المتاح غير كافٍ لإجراء التحويل.');
    END IF;
    IF COALESCE(v_liquidity_acc.balance_units, 0.000000) < v_net_yer THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'liquidity_insufficient',
        'message', 'رصيد سيولة التبديل بالريال اليمني (YT-COIN-SWAP-LIQUIDITY) غير كافٍ حالياً. يرجى تغذية حساب الصرف من لوحة الإدارة أو استخدام خيار التحويل من ر.ي إلى YT.'
      );
    END IF;

    -- 1. Independent YT Coin deduction -> YT-SWAP-POOL
    UPDATE yt_coin.accounts
    SET balance_yt = balance_yt - v_amount_yt,
        total_swapped_to_yer_yt = total_swapped_to_yer_yt + v_amount_yt,
        updated_at = now()
    WHERE user_id = v_user_id;

    INSERT INTO yt_coin.system_treasury (treasury_key, balance_yt)
    VALUES ('YT-SWAP-POOL', v_amount_yt)
    ON CONFLICT (treasury_key) DO UPDATE SET
      balance_yt = yt_coin.system_treasury.balance_yt + v_amount_yt,
      updated_at = now();

    INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
    VALUES (
      v_user_id, 'swap_yt_to_yer', -v_amount_yt,
      'BRIDGE->' || COALESCE(v_yer_wallet.wallet_address, v_yer_wallet.id::text),
      jsonb_build_object('direction', 'YT_TO_YER', 'rateYerPerYt', v_rate, 'amountYer', v_net_yer, 'note', p_note)
    ) RETURNING id INTO v_yt_ledger_id;

    -- 2. Balanced YER settlement inside Yemen Task's closed-loop ledger
    v_yer_tx_id := public.post_ledger_transaction(
      p_transaction_type := 'YT_COIN_SWAP',
      p_idempotency_key := 'YT-SWAP:' || v_yt_ledger_id::text,
      p_reference := 'YT-BRIDGE:' || v_yt_acct.wallet_address,
      p_metadata := jsonb_build_object(
        'bridge', 'yt_coin_swap',
        'direction', 'YT_TO_YER',
        'user_id', v_user_id,
        'yt_wallet_address', v_yt_acct.wallet_address,
        'yer_wallet_address', v_yer_wallet.wallet_address,
        'amount_yt', v_amount_yt,
        'exchange_rate_yer_per_yt', v_rate,
        'amount_yer', v_net_yer,
        'yt_ledger_id', v_yt_ledger_id
      ),
      p_entries := jsonb_build_array(
        jsonb_build_object(
          'account_id', v_liquidity_acc.id,
          'side', 'debit',
          'amount_units', v_net_yer,
          'memo', 'تبديل YT Coin إلى رصيد يمن تاسك (ر.ي)'
        ),
        jsonb_build_object(
          'account_id', v_user_yer_acc.id,
          'side', 'credit',
          'amount_units', v_net_yer,
          'memo', 'استلام قيمة تبديل ' || v_amount_yt::text || ' YT Coin'
        )
      )
    );

    SELECT balance_units INTO v_new_yer_bal FROM public.financial_accounts WHERE id = v_user_yer_acc.id;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_transactions') THEN
      INSERT INTO public.wallet_transactions (
        user_id, type, amount, previous_balance, new_balance, status, reference_id, description
      ) VALUES (
        v_yer_wallet.user_id, 'YT_COIN_SWAP', v_net_yer, v_prev_yer_bal, v_new_yer_bal,
        'COMPLETED', v_yer_tx_id::text, 'تحويل من محفظة YT Coin (' || v_amount_yt::text || ' YT)'
      );
    END IF;
  ELSE
    -- Direction: YER_TO_YT (Swap YER from user's Yemen Task wallet to YT Coin wallet)
    IF COALESCE(v_user_yer_acc.balance_units, 0.000000) < v_gross_yer THEN
      RETURN jsonb_build_object('success', false, 'status', 'insufficient_yer', 'message', 'رصيد محفظة يمن تاسك (ر.ي) غير كافٍ.');
    END IF;

    SELECT COALESCE(balance_yt, 0.00) INTO v_swap_pool_bal
    FROM yt_coin.system_treasury WHERE treasury_key = 'YT-SWAP-POOL' FOR UPDATE;
    SELECT COALESCE(balance_yt, 0.00) INTO v_rewards_pool_bal
    FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY' FOR UPDATE;

    IF (COALESCE(v_swap_pool_bal, 0.00) + COALESCE(v_rewards_pool_bal, 0.00)) < v_amount_yt THEN
      RETURN jsonb_build_object('success', false, 'message', 'مخزون YT Coin المتاح للتبديل غير كافٍ.');
    END IF;

    INSERT INTO yt_coin.ledger(user_id, event_type, amount_yt, reference, metadata)
    VALUES (
      v_user_id, 'swap_yer_to_yt', v_amount_yt,
      'BRIDGE<-' || COALESCE(v_yer_wallet.wallet_address, v_yer_wallet.id::text),
      jsonb_build_object('direction', 'YER_TO_YT', 'rateYerPerYt', v_rate, 'amountYer', v_gross_yer, 'note', p_note)
    ) RETURNING id INTO v_yt_ledger_id;

    v_yer_tx_id := public.post_ledger_transaction(
      p_transaction_type := 'YT_COIN_SWAP',
      p_idempotency_key := 'YT-SWAP:' || v_yt_ledger_id::text,
      p_reference := 'YT-BRIDGE:' || v_yt_acct.wallet_address,
      p_metadata := jsonb_build_object(
        'bridge', 'yt_coin_swap',
        'direction', 'YER_TO_YT',
        'user_id', v_user_id,
        'yt_wallet_address', v_yt_acct.wallet_address,
        'yer_wallet_address', v_yer_wallet.wallet_address,
        'amount_yt', v_amount_yt,
        'exchange_rate_yer_per_yt', v_rate,
        'amount_yer', v_gross_yer,
        'yt_ledger_id', v_yt_ledger_id
      ),
      p_entries := jsonb_build_array(
        jsonb_build_object(
          'account_id', v_user_yer_acc.id,
          'side', 'debit',
          'amount_units', v_gross_yer,
          'memo', 'تحويل رصيد (ر.ي) إلى محفظة YT Coin'
        ),
        jsonb_build_object(
          'account_id', v_liquidity_acc.id,
          'side', 'credit',
          'amount_units', v_gross_yer,
          'memo', 'إيداع سيولة تبديل YT Coin'
        )
      )
    );

    IF COALESCE(v_swap_pool_bal, 0.00) >= v_amount_yt THEN
      UPDATE yt_coin.system_treasury SET balance_yt = balance_yt - v_amount_yt, updated_at = now() WHERE treasury_key = 'YT-SWAP-POOL';
    ELSE
      IF COALESCE(v_swap_pool_bal, 0.00) > 0 THEN
        UPDATE yt_coin.system_treasury SET balance_yt = 0.00, updated_at = now() WHERE treasury_key = 'YT-SWAP-POOL';
      END IF;
      UPDATE yt_coin.system_treasury
      SET balance_yt = balance_yt - (v_amount_yt - COALESCE(v_swap_pool_bal, 0.00)), updated_at = now()
      WHERE treasury_key = 'YT-REWARDS-TREASURY';
    END IF;

    UPDATE yt_coin.accounts
    SET balance_yt = balance_yt + v_amount_yt,
        total_swapped_from_yer_yt = total_swapped_from_yer_yt + v_amount_yt,
        updated_at = now()
    WHERE user_id = v_user_id;

    SELECT balance_units INTO v_new_yer_bal FROM public.financial_accounts WHERE id = v_user_yer_acc.id;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_transactions') THEN
      INSERT INTO public.wallet_transactions (
        user_id, type, amount, previous_balance, new_balance, status, reference_id, description
      ) VALUES (
        v_user_id, 'YT_COIN_SWAP', -v_gross_yer, v_prev_yer_bal, v_new_yer_bal,
        'COMPLETED', v_yer_tx_id::text, 'تبديل إلى محفظة YT Coin (' || v_amount_yt::text || ' YT)'
      );
    END IF;
    v_net_yer := v_gross_yer;
  END IF;

  -- Record relational bridge row
  INSERT INTO yt_coin.wallet_swaps(
    user_id, direction, yt_wallet_address, yer_wallet_id, yer_wallet_address,
    amount_yt, exchange_rate_yer_per_yt, fee_yer, amount_yer, yt_ledger_id, yer_ledger_tx_id, status, note
  ) VALUES (
    v_user_id, v_dir, v_yt_acct.wallet_address, v_yer_wallet.id, v_yer_wallet.wallet_address,
    v_amount_yt, v_rate, CASE WHEN v_dir = 'YT_TO_YER' THEN v_fee_yer ELSE 0.000000 END,
    v_net_yer, v_yt_ledger_id, v_yer_tx_id, 'COMPLETED', NULLIF(TRIM(COALESCE(p_note, '')), '')
  ) RETURNING id INTO v_swap_id;

  RETURN jsonb_build_object(
    'success', true,
    'swapId', v_swap_id,
    'direction', v_dir,
    'amountYt', v_amount_yt,
    'amountYer', v_net_yer,
    'exchangeRate', v_rate,
    'yerWalletAddress', v_yer_wallet.wallet_address,
    'ytWalletAddress', v_yt_acct.wallet_address
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.swap_yt_coin_with_yer(text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_yt_coin_with_yer(text, numeric, text, text) TO authenticated;

-- ============================================================================
-- 11. ADMIN RPCS: get_yt_coin_admin_summary() & admin_update_yt_coin_config()
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_yt_coin_admin_summary();
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
  v_cap numeric(20, 2) := 0.00;
  v_days_elapsed bigint := 0;
  v_rewards_treasury numeric(20, 2) := 0.00;
  v_swap_pool numeric(20, 2) := 0.00;
  v_total_mined numeric(20, 2) := 0.00;
  v_user_balances numeric(20, 2) := 0.00;
  v_today_mined numeric(20, 2) := 0.00;
  v_claims_today integer := 0;
  v_taps_today bigint := 0;
  v_ads_today bigint := 0;
  v_total_claims bigint := 0;
  v_active_miners bigint := 0;
  v_swap_liquidity_yer numeric(30, 6) := 0.000000;
  v_total_swapped_to_yer numeric(20, 2) := 0.00;
  v_recent_claims jsonb := '[]'::jsonb;
  v_treasuries jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;
  v_days_elapsed := CASE WHEN v_cfg.mining_start_date IS NULL THEN 0 ELSE GREATEST(0, (v_today - v_cfg.mining_start_date)) END;
  v_cap := LEAST(
    COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    COALESCE(v_cfg.daily_cap_start_yt, 1000.00) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_yt, 10.00))
  );

  SELECT COALESCE(balance_yt, 0.00) INTO v_rewards_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-REWARDS-TREASURY';

  SELECT COALESCE(balance_yt, 0.00) INTO v_swap_pool
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-SWAP-POOL';

  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_mined
  FROM yt_coin.ledger
  WHERE event_type IN ('daily_mining_reward', 'tap_mining_reward', 'ad_watch_reward', 'mining_reward');

  SELECT COALESCE(sum(balance_yt), 0.00), count(*)
  INTO v_user_balances, v_active_miners
  FROM yt_coin.accounts;

  SELECT COALESCE(paid_yt, 0.00), COALESCE(claim_count, 0)
  INTO v_today_mined, v_claims_today
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(sum(tap_count), 0) INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE tap_date = v_today;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_watch_claims WHERE watch_date = v_today;

  SELECT count(*) INTO v_total_claims FROM yt_coin.mining_claims;

  SELECT COALESCE(balance_units, 0.000000) INTO v_swap_liquidity_yer
  FROM public.financial_accounts WHERE account_code = 'YT-COIN-SWAP-LIQUIDITY';

  SELECT COALESCE(sum(amount_yt), 0.00) INTO v_total_swapped_to_yer
  FROM yt_coin.wallet_swaps WHERE direction = 'YT_TO_YER';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasury_key', t.treasury_key,
    'balance_yt', t.balance_yt,
    'updated_at', t.updated_at
  )), '[]'::jsonb)
  INTO v_treasuries
  FROM yt_coin.system_treasury t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'full_name', p.full_name,
    'claim_date', c.claim_date,
    'amount_yt', c.amount_yt,
    'created_at', c.created_at
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_recent_claims
  FROM (
    SELECT id, user_id, claim_date, amount_yt, created_at
    FROM yt_coin.mining_claims
    ORDER BY created_at DESC LIMIT 25
  ) c
  LEFT JOIN public.profiles p ON p.id = c.user_id;

  RETURN jsonb_build_object(
    'mining_enabled', COALESCE(v_cfg.mining_enabled, false),
    'max_supply_yt', COALESCE(v_cfg.max_supply_yt, 1000000000.00),
    'base_reward_yt', COALESCE(v_cfg.base_reward_yt, 0.50),
    'tap_reward_yt', COALESCE(v_cfg.tap_reward_yt, 0.01),
    'ad_reward_yt', COALESCE(v_cfg.ad_reward_yt, 0.05),
    'daily_tap_limit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'daily_ad_limit', COALESCE(v_cfg.daily_ad_limit, 20),
    'daily_cap_start_yt', COALESCE(v_cfg.daily_cap_start_yt, 1000.00),
    'daily_cap_increment_yt', COALESCE(v_cfg.daily_cap_increment_yt, 10.00),
    'daily_cap_max_yt', COALESCE(v_cfg.daily_cap_max_yt, 1000000.00),
    'daily_cap_yt', v_cap,
    'swap_enabled', COALESCE(v_cfg.swap_enabled, true),
    'exchange_rate_yer_per_yt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'swap_fee_percent', COALESCE(v_cfg.swap_fee_percent, 0.00),
    'swap_liquidity_yer', v_swap_liquidity_yer,
    'total_swapped_to_yer_yt', v_total_swapped_to_yer,
    'rewards_treasury_balance_yt', v_rewards_treasury,
    'swap_pool_balance_yt', v_swap_pool,
    'total_mined_yt', v_total_mined,
    'total_user_balances_yt', v_user_balances,
    'today_mined_yt', v_today_mined,
    'claims_today', v_claims_today,
    'today_taps_count', v_taps_today,
    'today_ads_count', v_ads_today,
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

DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, integer, bigint, bigint);
DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_yt numeric DEFAULT NULL,
  p_tap_reward_yt numeric DEFAULT NULL,
  p_ad_reward_yt numeric DEFAULT NULL,
  p_daily_tap_limit integer DEFAULT NULL,
  p_daily_ad_limit integer DEFAULT NULL,
  p_daily_cap_start_yt numeric DEFAULT NULL,
  p_daily_cap_max_yt numeric DEFAULT NULL,
  p_swap_enabled boolean DEFAULT NULL,
  p_exchange_rate_yer_per_yt numeric DEFAULT NULL
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

  IF p_base_reward_yt IS NOT NULL AND p_base_reward_yt < 0.01 THEN
    RAISE EXCEPTION 'base_reward_yt must be >= 0.01';
  END IF;
  IF p_tap_reward_yt IS NOT NULL AND p_tap_reward_yt < 0.01 THEN
    RAISE EXCEPTION 'tap_reward_yt must be >= 0.01';
  END IF;
  IF p_ad_reward_yt IS NOT NULL AND p_ad_reward_yt < 0.01 THEN
    RAISE EXCEPTION 'ad_reward_yt must be >= 0.01';
  END IF;
  IF p_daily_tap_limit IS NOT NULL AND p_daily_tap_limit < 0 THEN
    RAISE EXCEPTION 'daily_tap_limit must be >= 0';
  END IF;
  IF p_daily_ad_limit IS NOT NULL AND p_daily_ad_limit < 0 THEN
    RAISE EXCEPTION 'daily_ad_limit must be >= 0';
  END IF;
  IF p_daily_cap_start_yt IS NOT NULL AND p_daily_cap_start_yt < 0.01 THEN
    RAISE EXCEPTION 'daily_cap_start_yt must be >= 0.01';
  END IF;
  IF p_daily_cap_max_yt IS NOT NULL AND p_daily_cap_max_yt < 0.01 THEN
    RAISE EXCEPTION 'daily_cap_max_yt must be >= 0.01';
  END IF;
  IF p_exchange_rate_yer_per_yt IS NOT NULL AND p_exchange_rate_yer_per_yt <= 0 THEN
    RAISE EXCEPTION 'exchange_rate_yer_per_yt must be > 0';
  END IF;

  UPDATE yt_coin.config
  SET
    mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
    base_reward_yt = COALESCE(ROUND(p_base_reward_yt, 2), base_reward_yt),
    tap_reward_yt = COALESCE(ROUND(p_tap_reward_yt, 2), tap_reward_yt),
    ad_reward_yt = COALESCE(ROUND(p_ad_reward_yt, 2), ad_reward_yt),
    daily_tap_limit = COALESCE(p_daily_tap_limit, daily_tap_limit),
    daily_ad_limit = COALESCE(p_daily_ad_limit, daily_ad_limit),
    daily_cap_start_yt = COALESCE(ROUND(p_daily_cap_start_yt, 2), daily_cap_start_yt),
    daily_cap_max_yt = GREATEST(
      COALESCE(ROUND(p_daily_cap_max_yt, 2), daily_cap_max_yt),
      COALESCE(ROUND(p_daily_cap_start_yt, 2), daily_cap_start_yt)
    ),
    swap_enabled = COALESCE(p_swap_enabled, swap_enabled),
    exchange_rate_yer_per_yt = COALESCE(ROUND(p_exchange_rate_yer_per_yt, 6), exchange_rate_yer_per_yt),
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
      'base_reward_yt', v_cfg.base_reward_yt,
      'tap_reward_yt', v_cfg.tap_reward_yt,
      'ad_reward_yt', v_cfg.ad_reward_yt,
      'daily_tap_limit', v_cfg.daily_tap_limit,
      'daily_ad_limit', v_cfg.daily_ad_limit,
      'daily_cap_start_yt', v_cfg.daily_cap_start_yt,
      'daily_cap_max_yt', v_cfg.daily_cap_max_yt,
      'swap_enabled', v_cfg.swap_enabled,
      'exchange_rate_yer_per_yt', v_cfg.exchange_rate_yer_per_yt
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'mining_enabled', v_cfg.mining_enabled,
    'base_reward_yt', v_cfg.base_reward_yt,
    'tap_reward_yt', v_cfg.tap_reward_yt,
    'ad_reward_yt', v_cfg.ad_reward_yt,
    'daily_tap_limit', v_cfg.daily_tap_limit,
    'daily_ad_limit', v_cfg.daily_ad_limit,
    'daily_cap_start_yt', v_cfg.daily_cap_start_yt,
    'daily_cap_max_yt', v_cfg.daily_cap_max_yt,
    'swap_enabled', v_cfg.swap_enabled,
    'exchange_rate_yer_per_yt', v_cfg.exchange_rate_yer_per_yt,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(
  boolean, numeric, numeric, numeric, integer, integer, numeric, numeric, boolean, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(
  boolean, numeric, numeric, numeric, integer, integer, numeric, numeric, boolean, numeric
) TO authenticated;
