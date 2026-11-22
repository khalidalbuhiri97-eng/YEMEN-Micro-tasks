-- ============================================================================
-- YT COIN: 100,000,000 YT FINAL SUPPLY | BIGINT INTEGER SUB-UNITS (1 YT = 1,000)
-- Smallest unit: 0.001 YT = 1 part (BIGINT)
-- Tokenomics Cap Allocations (Sum = 100,000,000 YT = 100,000,000,000 parts):
--   1. YT-USER-REWARDS       : 30,000,000 YT (30,000,000,000 parts)
--   2. YT-TEAM-VESTING       : 10,000,000 YT (10,000,000,000 parts) - Locked + Vesting
--   3. YT-MARKET-LIQUIDITY    : 15,000,000 YT (15,000,000,000 parts) - Independent Account
--   4. YT-GENERAL-CIRCULATION: 45,000,000 YT (45,000,000,000 parts) - Pre-approval Reserve
-- Verified Ad Rewards (10 parts = 0.01 YT click/view) via trusted S2S postbacks only.
-- STRICT PROTECTION:
--   * Never alters or modifies public.wallets / financial_accounts / ledger_transactions.
--   * Never zeroes existing user balances or deletes historical records.
--   * Never auto-converts non-zero legacy units without audit verification.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS yt_coin;

-- ----------------------------------------------------------------------------
-- 1. Core Independent Tables (pure BIGINT sub-units: 1 YT = 1,000 parts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yt_coin.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  unit_scale integer NOT NULL DEFAULT 1000 CHECK (unit_scale = 1000),
  mining_enabled boolean NOT NULL DEFAULT true,
  max_supply_units bigint NOT NULL DEFAULT 100000000000 CHECK (max_supply_units = 100000000000),
  base_reward_units bigint NOT NULL DEFAULT 500 CHECK (base_reward_units >= 1),        -- 0.5 YT
  tap_reward_units bigint NOT NULL DEFAULT 10 CHECK (tap_reward_units >= 1),           -- 0.01 YT
  ad_click_reward_units bigint NOT NULL DEFAULT 10 CHECK (ad_click_reward_units >= 1), -- 0.01 YT
  ad_view_reward_units bigint NOT NULL DEFAULT 10 CHECK (ad_view_reward_units >= 1),   -- 0.01 YT
  daily_tap_limit integer NOT NULL DEFAULT 1000 CHECK (daily_tap_limit >= 0),
  daily_ad_limit integer NOT NULL DEFAULT 20 CHECK (daily_ad_limit >= 0),
  daily_cap_start_units bigint NOT NULL DEFAULT 1000000 CHECK (daily_cap_start_units >= 1), -- 1,000 YT
  daily_cap_increment_units bigint NOT NULL DEFAULT 10000 CHECK (daily_cap_increment_units >= 0), -- 10 YT
  daily_cap_max_units bigint NOT NULL DEFAULT 1000000000 CHECK (daily_cap_max_units >= 1), -- 1,000,000 YT
  swap_enabled boolean NOT NULL DEFAULT false,
  exchange_rate_yer_per_yt numeric(20, 6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate_yer_per_yt > 0),
  swap_fee_percent numeric(5, 2) NOT NULL DEFAULT 0.00 CHECK (swap_fee_percent >= 0 AND swap_fee_percent <= 100),
  mining_start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  economy_version text NOT NULL DEFAULT 'yt_bigint_100m_v2',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text UNIQUE,
  balance_units bigint NOT NULL DEFAULT 0 CHECK (balance_units >= 0),
  lifetime_earned_units bigint NOT NULL DEFAULT 0 CHECK (lifetime_earned_units >= 0),
  ad_earned_units bigint NOT NULL DEFAULT 0 CHECK (ad_earned_units >= 0),
  total_transferred_out_units bigint NOT NULL DEFAULT 0 CHECK (total_transferred_out_units >= 0),
  total_transferred_in_units bigint NOT NULL DEFAULT 0 CHECK (total_transferred_in_units >= 0),
  total_swapped_to_yer_units bigint NOT NULL DEFAULT 0 CHECK (total_swapped_to_yer_units >= 0),
  total_swapped_from_yer_units bigint NOT NULL DEFAULT 0 CHECK (total_swapped_from_yer_units >= 0),
  legacy_balance_units bigint,
  legacy_unit_system text,
  migration_audit_status text NOT NULL DEFAULT 'clean',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.system_treasury (
  treasury_key text PRIMARY KEY,
  account_type text NOT NULL DEFAULT 'rewards',
  label_ar text,
  allocated_units bigint NOT NULL DEFAULT 0 CHECK (allocated_units >= 0),
  balance_units bigint NOT NULL DEFAULT 0 CHECK (balance_units >= 0),
  distributed_units bigint NOT NULL DEFAULT 0 CHECK (distributed_units >= 0),
  is_locked boolean NOT NULL DEFAULT false,
  approved_for_distribution boolean NOT NULL DEFAULT false,
  vesting_schedule jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  amount_units bigint NOT NULL DEFAULT 500 CHECK (amount_units > 0),
  ledger_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_date)
);

CREATE TABLE IF NOT EXISTS yt_coin.daily_user_taps (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_date date NOT NULL,
  tap_count integer NOT NULL DEFAULT 0,
  paid_units bigint NOT NULL DEFAULT 0 CHECK (paid_units >= 0),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, tap_date)
);

CREATE TABLE IF NOT EXISTS yt_coin.daily_mining_totals (
  claim_date date PRIMARY KEY,
  paid_units bigint NOT NULL DEFAULT 0 CHECK (paid_units >= 0),
  claim_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount_units bigint NOT NULL DEFAULT 0,
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
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  note text,
  sender_ledger_id uuid REFERENCES yt_coin.ledger(id),
  recipient_ledger_id uuid REFERENCES yt_coin.ledger(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_transfers_parties
  ON yt_coin.transfers(sender_id, recipient_id, created_at DESC);

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
-- 2. Verified Ad Networks, Sessions & Deduplicated Reward Events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yt_coin.ad_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_key text NOT NULL UNIQUE CHECK (network_key ~ '^[a-z0-9_-]{2,48}$'),
  display_name text NOT NULL,
  description text,
  auth_mode text NOT NULL DEFAULT 'hmac_sha256' CHECK (auth_mode IN ('hmac_sha256', 'shared_secret')),
  secret_env_key text NOT NULL DEFAULT 'YT_COIN_AD_POSTBACK_SECRET',
  placement_url text,
  ad_type text NOT NULL DEFAULT 'both' CHECK (ad_type IN ('view', 'click', 'both')),
  reward_click_units bigint NOT NULL DEFAULT 10 CHECK (reward_click_units >= 1),
  reward_view_units bigint NOT NULL DEFAULT 10 CHECK (reward_view_units >= 1),
  daily_user_limit integer NOT NULL DEFAULT 20 CHECK (daily_user_limit >= 0),
  is_active boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt_coin.ad_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  network_key text NOT NULL REFERENCES yt_coin.ad_networks(network_key) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('click', 'view')),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'credited', 'expired')),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes')
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_ad_sessions_user
  ON yt_coin.ad_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS yt_coin.ad_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  network_key text NOT NULL REFERENCES yt_coin.ad_networks(network_key) ON DELETE RESTRICT,
  external_event_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('click', 'view')),
  event_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  session_id uuid REFERENCES yt_coin.ad_sessions(id) ON DELETE SET NULL,
  ledger_id uuid REFERENCES yt_coin.ledger(id) ON DELETE RESTRICT,
  verification_source text NOT NULL,
  raw_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(network_key, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_ad_events_user_date
  ON yt_coin.ad_reward_events(user_id, event_date DESC);

-- ----------------------------------------------------------------------------
-- 3. Non-destructive Upgrade of Existing yt_coin Tables (Zero Data Loss)
-- ----------------------------------------------------------------------------
ALTER TABLE yt_coin.config
  ADD COLUMN IF NOT EXISTS unit_scale integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS mining_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_supply_units bigint DEFAULT 100000000000,
  ADD COLUMN IF NOT EXISTS base_reward_units bigint DEFAULT 500,
  ADD COLUMN IF NOT EXISTS tap_reward_units bigint DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ad_click_reward_units bigint DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ad_view_reward_units bigint DEFAULT 10,
  ADD COLUMN IF NOT EXISTS daily_tap_limit integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS daily_ad_limit integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS daily_cap_start_units bigint DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS daily_cap_increment_units bigint DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS daily_cap_max_units bigint DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS swap_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_rate_yer_per_yt numeric(20, 6) DEFAULT 1.000000,
  ADD COLUMN IF NOT EXISTS swap_fee_percent numeric(5, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS mining_start_date date DEFAULT (now() AT TIME ZONE 'Asia/Aden')::date,
  ADD COLUMN IF NOT EXISTS economy_version text DEFAULT 'yt_bigint_100m_v2',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE yt_coin.accounts
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS balance_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_earned_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ad_earned_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_transferred_out_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_transferred_in_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_swapped_to_yer_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_swapped_from_yer_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_balance_units bigint,
  ADD COLUMN IF NOT EXISTS legacy_unit_system text,
  ADD COLUMN IF NOT EXISTS migration_audit_status text DEFAULT 'clean';

ALTER TABLE yt_coin.system_treasury
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'rewards',
  ADD COLUMN IF NOT EXISTS label_ar text,
  ADD COLUMN IF NOT EXISTS allocated_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distributed_units bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_for_distribution boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vesting_schedule jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE yt_coin.mining_claims
  ADD COLUMN IF NOT EXISTS amount_units bigint DEFAULT 500;

ALTER TABLE yt_coin.daily_mining_totals
  ADD COLUMN IF NOT EXISTS paid_units bigint DEFAULT 0;

ALTER TABLE yt_coin.ledger
  ADD COLUMN IF NOT EXISTS amount_units bigint DEFAULT 0;

-- Drop any old constraints on config/treasury that enforced 1B or unit_scale = 100
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE conrelid IN ('yt_coin.config'::regclass, 'yt_coin.system_treasury'::regclass)
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ~* 'max_supply_units|unit_scale|allocated_units'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', v_con.tbl, v_con.conname);
  END LOOP;
END $$;

-- Non-destructive migration step:
-- 1) Preserve existing balances & ledger rows untouched; flag non-zero legacy rows for manual audit rather than auto-multiplying.
-- 2) Backfill yt1 wallet addresses safely.
-- 3) Configure exact 100,000,000 YT economy (1 YT = 1,000 parts) and 4 canonical treasury allocations.
DO $$
DECLARE
  v_prev_version text := 'half_yt_v1';
  v_existing_non_zero integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'yt_coin' AND table_name = 'config' AND column_name = 'economy_version'
  ) THEN
    SELECT COALESCE(economy_version, 'half_yt_v1') INTO v_prev_version
    FROM yt_coin.config WHERE singleton = true;
  END IF;

  IF v_prev_version IS DISTINCT FROM 'yt_bigint_100m_v2' THEN
    -- Audit & preserve any pre-existing accounts WITHOUT zeroing or blindly scaling
    UPDATE yt_coin.accounts
    SET legacy_balance_units = balance_units,
        legacy_unit_system = v_prev_version,
        migration_audit_status = CASE
          WHEN COALESCE(balance_units, 0) > 0 OR COALESCE(lifetime_earned_units, 0) > 0 THEN 'pending_audit'
          ELSE 'verified_zero'
        END,
        updated_at = now()
    WHERE legacy_unit_system IS NULL;

    SELECT count(*) INTO v_existing_non_zero
    FROM yt_coin.accounts
    WHERE migration_audit_status = 'pending_audit';

    IF v_existing_non_zero > 0 THEN
      INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
      VALUES (
        NULL,
        'legacy_balance_snapshot_preserved',
        'yt_coin_migration',
        'yt_bigint_100m_v2',
        jsonb_build_object(
          'pending_audit_accounts', v_existing_non_zero,
          'note', 'Pre-existing non-zero accounts preserved without auto-conversion until source reconciliation.'
        )
      );
    END IF;

    -- Backfill ledger amount_units from legacy reward_units only where amount_units = 0 and reward_units IS NOT NULL
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'yt_coin' AND table_name = 'ledger' AND column_name = 'reward_units'
    ) THEN
      EXECUTE 'UPDATE yt_coin.ledger SET amount_units = COALESCE(reward_units, 0) WHERE COALESCE(amount_units, 0) = 0 AND COALESCE(reward_units, 0) <> 0';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'yt_coin' AND table_name = 'mining_claims' AND column_name = 'reward_units'
    ) THEN
      EXECUTE 'UPDATE yt_coin.mining_claims SET amount_units = COALESCE(reward_units, 0) WHERE COALESCE(amount_units, 0) = 0 AND COALESCE(reward_units, 0) > 0';
    END IF;
  END IF;

  -- Backfill yt1 wallet addresses without erasing any existing addresses
  UPDATE yt_coin.accounts
  SET wallet_address = 'yt1' || replace(user_id::text, '-', '')
  WHERE wallet_address IS NULL OR wallet_address = '';

  -- Upsert canonical config: 100M YT cap, 1 YT = 1,000 parts, 0.5 YT daily = 500, 0.01 YT ad click/view = 10
  INSERT INTO yt_coin.config (
    singleton, unit_scale, mining_enabled, max_supply_units,
    base_reward_units, tap_reward_units, ad_click_reward_units, ad_view_reward_units,
    daily_tap_limit, daily_ad_limit, daily_cap_start_units, daily_cap_increment_units, daily_cap_max_units,
    swap_enabled, exchange_rate_yer_per_yt, swap_fee_percent, mining_start_date, economy_version, updated_at
  ) VALUES (
    true, 1000, true, 100000000000,
    500, 10, 10, 10,
    1000, 20, 1000000, 10000, 1000000000,
    false, 1.000000, 0.00, (now() AT TIME ZONE 'Asia/Aden')::date, 'yt_bigint_100m_v2', now()
  )
  ON CONFLICT (singleton) DO UPDATE SET
    unit_scale = 1000,
    max_supply_units = 100000000000,
    base_reward_units = 500,
    tap_reward_units = 10,
    ad_click_reward_units = 10,
    ad_view_reward_units = 10,
    daily_cap_start_units = GREATEST(1000, COALESCE(yt_coin.config.daily_cap_start_units, 1000000)),
    daily_cap_max_units = GREATEST(100000, COALESCE(yt_coin.config.daily_cap_max_units, 1000000000)),
    economy_version = 'yt_bigint_100m_v2',
    updated_at = now();

  -- Enforce exact 4 Tokenomics Allocation Accounts (Total = 100,000,000 YT = 100,000,000,000 parts)
  -- Legacy 'YT-REWARDS-TREASURY' if present is retired cleanly to 0 allocation/balance without deleting audit trail
  UPDATE yt_coin.system_treasury
  SET account_type = 'legacy_retired',
      label_ar = 'حساب تاريخي سابق (مغلق)',
      allocated_units = 0,
      balance_units = 0,
      is_locked = true,
      approved_for_distribution = false,
      updated_at = now()
  WHERE treasury_key = 'YT-REWARDS-TREASURY';

  -- 1. User Rewards Pool: 30,000,000 YT = 30,000,000,000 parts (approved for active user rewards distribution)
  INSERT INTO yt_coin.system_treasury (
    treasury_key, account_type, label_ar, allocated_units, balance_units, distributed_units,
    is_locked, approved_for_distribution, vesting_schedule
  ) VALUES (
    'YT-USER-REWARDS', 'user_rewards', 'مكافآت المستخدمين',
    30000000000, 30000000000, 0, false, true, '{}'::jsonb
  )
  ON CONFLICT (treasury_key) DO UPDATE SET
    account_type = 'user_rewards',
    label_ar = 'مكافآت المستخدمين',
    allocated_units = 30000000000,
    balance_units = GREATEST(0, 30000000000 - COALESCE(yt_coin.system_treasury.distributed_units, 0)),
    is_locked = false,
    approved_for_distribution = true,
    updated_at = now();

  -- 2. Team Allocation: 10,000,000 YT = 10,000,000,000 parts (LOCKED + VESTING SCHEDULE; NOT circulating)
  INSERT INTO yt_coin.system_treasury (
    treasury_key, account_type, label_ar, allocated_units, balance_units, distributed_units,
    is_locked, approved_for_distribution, vesting_schedule
  ) VALUES (
    'YT-TEAM-VESTING', 'team_vesting', 'حصة الفريق (مقفلة ومجدولة للاستحقاق)',
    10000000000, 10000000000, 0, true, false,
    jsonb_build_object(
      'cliff_months', 12,
      'duration_months', 36,
      'release_cadence', 'monthly',
      'locked_since', (now() AT TIME ZONE 'UTC')::date
    )
  )
  ON CONFLICT (treasury_key) DO UPDATE SET
    account_type = 'team_vesting',
    label_ar = 'حصة الفريق (مقفلة ومجدولة للاستحقاق)',
    allocated_units = 10000000000,
    balance_units = GREATEST(0, 10000000000 - COALESCE(yt_coin.system_treasury.distributed_units, 0)),
    is_locked = true,
    approved_for_distribution = false,
    updated_at = now();

  -- 3. Market Liquidity: 15,000,000 YT = 15,000,000,000 parts (INDEPENDENT ACCOUNT; NOT circulating before approval)
  INSERT INTO yt_coin.system_treasury (
    treasury_key, account_type, label_ar, allocated_units, balance_units, distributed_units,
    is_locked, approved_for_distribution, vesting_schedule
  ) VALUES (
    'YT-MARKET-LIQUIDITY', 'market_liquidity', 'سيولة السوق (حساب مستقل)',
    15000000000, 15000000000, 0, false, false, '{}'::jsonb
  )
  ON CONFLICT (treasury_key) DO UPDATE SET
    account_type = 'market_liquidity',
    label_ar = 'سيولة السوق (حساب مستقل)',
    allocated_units = 15000000000,
    balance_units = GREATEST(0, 15000000000 - COALESCE(yt_coin.system_treasury.distributed_units, 0)),
    approved_for_distribution = false,
    updated_at = now();

  -- 4. General Circulation & Distribution: 45,000,000 YT = 45,000,000,000 parts (NOT circulating before approval)
  INSERT INTO yt_coin.system_treasury (
    treasury_key, account_type, label_ar, allocated_units, balance_units, distributed_units,
    is_locked, approved_for_distribution, vesting_schedule
  ) VALUES (
    'YT-GENERAL-CIRCULATION', 'general_circulation', 'التداول والتوزيع العام',
    45000000000, 45000000000, 0, false, false, '{}'::jsonb
  )
  ON CONFLICT (treasury_key) DO UPDATE SET
    account_type = 'general_circulation',
    label_ar = 'التداول والتوزيع العام',
    allocated_units = 45000000000,
    balance_units = GREATEST(0, 45000000000 - COALESCE(yt_coin.system_treasury.distributed_units, 0)),
    approved_for_distribution = false,
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

-- Enforce 100,000,000 YT (100,000,000,000 units) global allocation cap at DB trigger level
CREATE OR REPLACE FUNCTION yt_coin.enforce_treasury_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_total_allocated bigint;
BEGIN
  SELECT COALESCE(SUM(allocated_units), 0) INTO v_total_allocated
  FROM yt_coin.system_treasury
  WHERE treasury_key <> NEW.treasury_key;

  IF (v_total_allocated + COALESCE(NEW.allocated_units, 0)) > 100000000000 THEN
    RAISE EXCEPTION 'Total YT Coin allocations cannot exceed 100,000,000 YT (100,000,000,000 parts).'
      USING ERRCODE = '22000';
  END IF;

  IF NEW.is_locked AND COALESCE(NEW.distributed_units, 0) > 0 AND NOT NEW.approved_for_distribution THEN
    RAISE EXCEPTION 'Locked allocation cannot distribute units before approval/vesting.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_yt_coin_enforce_treasury_cap ON yt_coin.system_treasury;
CREATE TRIGGER trg_yt_coin_enforce_treasury_cap
  BEFORE INSERT OR UPDATE ON yt_coin.system_treasury
  FOR EACH ROW EXECUTE FUNCTION yt_coin.enforce_treasury_cap();

-- ----------------------------------------------------------------------------
-- 4. Lock Down Direct Access on yt_coin Schema (RLS + REVOKE ALL)
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA yt_coin FROM PUBLIC, anon, authenticated;
ALTER TABLE yt_coin.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.system_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.mining_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.daily_user_taps ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.daily_mining_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ad_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ad_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_coin.ad_reward_events ENABLE ROW LEVEL SECURITY;

-- Disable legacy unverified browser-trusted ad payout RPC
DROP FUNCTION IF EXISTS public.claim_my_yt_coin_ad(text);
DROP FUNCTION IF EXISTS yt_coin.claim_daily_mining();
DROP FUNCTION IF EXISTS public.claim_my_yt_coin_daily();
DROP FUNCTION IF EXISTS yt_coin.claim_tap_mining(integer);
DROP FUNCTION IF EXISTS public.claim_my_yt_coin_taps(integer);

-- ----------------------------------------------------------------------------
-- 5. RPC: public.get_my_yt_coin_summary()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_yt_coin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_balance_units bigint := 0;
  v_lifetime_units bigint := 0;
  v_ad_earned_units bigint := 0;
  v_wallet_address text;
  v_last_date date;
  v_claimed_today boolean := false;
  v_today_paid_units bigint := 0;
  v_taps_today integer := 0;
  v_ads_today integer := 0;
  v_total_circulating_units bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_rewards_allocated_units bigint := 0;
  v_rewards_distributed_units bigint := 0;
  v_daily_cap_units bigint := 0;
  v_days_elapsed bigint := 0;
  v_user_claims_count bigint := 0;
  v_eligible boolean := false;
  v_next_claim_at timestamptz;
  v_history jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
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

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(lifetime_earned_units, 0),
    COALESCE(ad_earned_units, 0),
    wallet_address
  INTO v_balance_units, v_lifetime_units, v_ad_earned_units, v_wallet_address
  FROM yt_coin.accounts WHERE user_id = v_user_id;

  v_days_elapsed := CASE
    WHEN v_cfg.mining_start_date IS NULL THEN 0
    ELSE GREATEST(0, (v_today - v_cfg.mining_start_date))
  END;

  v_daily_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  SELECT max(claim_date), count(*) INTO v_last_date, v_user_claims_count
  FROM yt_coin.mining_claims WHERE user_id = v_user_id;

  v_claimed_today := (v_last_date = v_today);
  v_next_claim_at := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Aden');

  SELECT COALESCE(paid_units, 0) INTO v_today_paid_units
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(tap_count, 0) INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE user_id = v_user_id AND tap_date = v_today;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id AND event_date = v_today;

  -- Actual issued/circulating supply = actual user balances ONLY (never unapproved allocations)
  SELECT COALESCE(SUM(balance_units), 0) INTO v_total_circulating_units
  FROM yt_coin.accounts;

  SELECT
    COALESCE(balance_units, 0),
    COALESCE(allocated_units, 0),
    COALESCE(distributed_units, 0)
  INTO v_rewards_remaining_units, v_rewards_allocated_units, v_rewards_distributed_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasuryKey', t.treasury_key,
    'accountType', t.account_type,
    'labelAr', t.label_ar,
    'allocatedUnits', t.allocated_units,
    'allocatedYt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'remainingUnits', t.balance_units,
    'distributedUnits', t.distributed_units,
    'isLocked', t.is_locked,
    'approvedForDistribution', t.approved_for_distribution,
    'vestingSchedule', t.vesting_schedule
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'eventType', l.event_type,
    'amountUnits', l.amount_units,
    'amountYt', ROUND(l.amount_units::numeric / 1000.0, 3),
    'reference', l.reference,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, event_type, amount_units, reference, created_at
    FROM yt_coin.ledger WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 40
  ) l;

  RETURN jsonb_build_object(
    'unitScale', 1000,
    'economyVersion', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_v2'),
    'walletAddress', COALESCE(v_wallet_address, 'yt1' || replace(v_user_id::text, '-', '')),
    'balanceUnits', v_balance_units,
    'balanceYt', ROUND(v_balance_units::numeric / 1000.0, 3),
    'lifetimeEarnedUnits', v_lifetime_units,
    'lifetimeEarnedYt', ROUND(v_lifetime_units::numeric / 1000.0, 3),
    'adEarnedUnits', v_ad_earned_units,
    'adEarnedYt', ROUND(v_ad_earned_units::numeric / 1000.0, 3),
    'miningEnabled', COALESCE(v_cfg.mining_enabled, false),
    'maxSupplyUnits', COALESCE(v_cfg.max_supply_units, 100000000000),
    'maxSupplyYt', 100000000,
    'circulatingSupplyUnits', v_total_circulating_units,
    'circulatingSupplyYt', ROUND(v_total_circulating_units::numeric / 1000.0, 3),
    'poolAllocatedUnits', v_rewards_allocated_units,
    'poolDistributedUnits', v_rewards_distributed_units,
    'poolRemainingUnits', v_rewards_remaining_units,
    'poolRemainingYt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'baseRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'baseRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tapRewardUnits', COALESCE(v_cfg.tap_reward_units, 10),
    'tapRewardYt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'adClickRewardUnits', COALESCE(v_cfg.ad_click_reward_units, 10),
    'adClickRewardYt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'adViewRewardUnits', COALESCE(v_cfg.ad_view_reward_units, 10),
    'adViewRewardYt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'tapsToday', v_taps_today,
    'dailyTapLimit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'dailyTapsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_tap_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_tap_limit - v_taps_today, 0)
    END,
    'adsToday', v_ads_today,
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'dailyAdsRemaining', CASE
      WHEN COALESCE(v_cfg.daily_ad_limit, 0) <= 0 THEN NULL
      ELSE GREATEST(v_cfg.daily_ad_limit - v_ads_today, 0)
    END,
    'dailyCapUnits', v_daily_cap_units,
    'dailyCapYt', ROUND(v_daily_cap_units::numeric / 1000.0, 3),
    'minedTodayUnits', v_today_paid_units,
    'dailyMinedYt', ROUND(v_today_paid_units::numeric / 1000.0, 3),
    'dailyCapRemainingUnits', GREATEST(v_daily_cap_units - v_today_paid_units, 0),
    'dailyRemainingYt', ROUND(GREATEST(v_daily_cap_units - v_today_paid_units, 0)::numeric / 1000.0, 3),
    'swapEnabled', COALESCE(v_cfg.swap_enabled, false),
    'exchangeRateYerPerYt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'eligible', v_eligible,
    'claimedToday', v_claimed_today,
    'canClaim', v_eligible AND COALESCE(v_cfg.mining_enabled, false) AND NOT v_claimed_today AND v_rewards_remaining_units >= COALESCE(v_cfg.base_reward_units, 500),
    'nextRewardUnits', COALESCE(v_cfg.base_reward_units, 500),
    'todayRewardYt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'lastClaimDate', v_last_date,
    'nextClaimAt', CASE WHEN v_claimed_today THEN v_next_claim_at ELSE NULL END,
    'totalClaims', v_user_claims_count,
    'allocations', v_allocations,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_yt_coin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_yt_coin_summary() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: Daily Login Claim (0.5 YT = 500 BIGINT units from YT-USER-REWARDS)
-- ----------------------------------------------------------------------------
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
  v_reward_units bigint := 500;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_ledger_id uuid;
  v_claim_id uuid;
  v_new_balance_units bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين متوقف حالياً من الإدارة.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  v_reward_units := COALESCE(v_cfg.base_reward_units, 500);
  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM yt_coin.mining_claims WHERE user_id = v_user_id AND claim_date = v_today) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'message', 'تم استلام مكافأة الدخول اليومي لهذا اليوم بالفعل.');
  END IF;

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0)
  ON CONFLICT (claim_date) DO NOTHING;

  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التوزيع اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;

  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص مكافآت المستخدمين غير كافٍ أو غير معتمد.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    v_user_id,
    'daily_mining_reward',
    v_reward_units,
    'YT-DAILY:' || v_user_id::text || ':' || v_today::text,
    jsonb_build_object('claimDate', v_today, 'timezone', 'Asia/Aden', 'unitScale', 1000)
  ) RETURNING id INTO v_ledger_id;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance_units;

  INSERT INTO yt_coin.mining_claims(user_id, claim_date, amount_units, ledger_id)
  VALUES (v_user_id, v_today, v_reward_units, v_ledger_id)
  RETURNING id INTO v_claim_id;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units,
      claim_count = claim_count + 1,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'daily_login_reward',
    'mining_claim',
    v_claim_id::text,
    jsonb_build_object('amountUnits', v_reward_units, 'claimDate', v_today, 'treasury', 'YT-USER-REWARDS')
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'claimed',
    'unitScale', 1000,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'balanceUnits', v_new_balance_units,
    'claimDate', v_today
  );
END;
$function$;

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

REVOKE ALL ON FUNCTION yt_coin.claim_daily_mining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_daily_mining() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_daily() TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: Tap Mining (integer BIGINT units, default 10 units = 0.01 YT)
-- ----------------------------------------------------------------------------
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
  v_taps_today integer := 0;
  v_reward_units bigint := 0;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_new_balance_units bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_taps < 1 OR v_taps > 200 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_taps', 'message', 'عدد النقرات غير صالح.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled OR v_cfg.mining_start_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_launched', 'message', 'التعدين متوقف حالياً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_eligible', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = v_user_id FOR UPDATE;

  INSERT INTO yt_coin.daily_user_taps(user_id, tap_date, tap_count, paid_units)
  VALUES (v_user_id, v_today, 0, 0)
  ON CONFLICT (user_id, tap_date) DO NOTHING;

  SELECT tap_count INTO v_taps_today
  FROM yt_coin.daily_user_taps WHERE user_id = v_user_id AND tap_date = v_today FOR UPDATE;

  IF COALESCE(v_cfg.daily_tap_limit, 0) > 0 THEN
    IF v_taps_today >= v_cfg.daily_tap_limit THEN
      RETURN jsonb_build_object('success', false, 'status', 'daily_tap_limit_reached', 'message', 'تم بلوغ الحد اليومي للنقرات.');
    END IF;
    v_taps := LEAST(v_taps, v_cfg.daily_tap_limit - v_taps_today);
  END IF;

  v_reward_units := v_taps::bigint * COALESCE(v_cfg.tap_reward_units, 10);
  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ السقف اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;
  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص المكافآت غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    v_user_id,
    'tap_mining_reward',
    v_reward_units,
    'YT-TAP:' || v_user_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('taps', v_taps, 'unitScale', 1000)
  );

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING balance_units INTO v_new_balance_units;

  UPDATE yt_coin.daily_user_taps
  SET tap_count = tap_count + v_taps,
      paid_units = paid_units + v_reward_units,
      updated_at = now()
  WHERE user_id = v_user_id AND tap_date = v_today;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units, updated_at = now()
  WHERE claim_date = v_today;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'unitScale', 1000,
    'tapsCredited', v_taps,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'balanceUnits', v_new_balance_units
  );
END;
$function$;

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

REVOKE ALL ON FUNCTION yt_coin.claim_tap_mining(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_tap_mining(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_taps(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_taps(integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPCs: Wallet Lookup & Atomic BIGINT P2P Transfer
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lookup_yt_coin_wallet(text);
CREATE OR REPLACE FUNCTION public.lookup_yt_coin_wallet(p_wallet_address text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_clean text := lower(trim(COALESCE(p_wallet_address, '')));
  v_acc RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_clean = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT a.wallet_address, p.full_name, a.status
  INTO v_acc
  FROM yt_coin.accounts a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE lower(a.wallet_address) = v_clean;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'walletAddress', v_acc.wallet_address,
    'ownerName', COALESCE(v_acc.full_name, 'مستخدم YT Coin'),
    'status', v_acc.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_yt_coin_wallet(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_yt_coin_wallet(text) TO authenticated;

DROP FUNCTION IF EXISTS public.transfer_yt_coin(text, numeric, text);
DROP FUNCTION IF EXISTS public.transfer_yt_coin(text, bigint, text);
CREATE OR REPLACE FUNCTION public.transfer_yt_coin(
  p_recipient_address text,
  p_amount_units bigint,
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
  v_sender yt_coin.accounts%ROWTYPE;
  v_recipient yt_coin.accounts%ROWTYPE;
  v_sender_ledger uuid;
  v_recipient_ledger uuid;
  v_transfer_id uuid;
  v_ref text;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_units IS NULL OR p_amount_units <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'يجب أن تكون الكمية جزءاً واحداً (0.001 YT) على الأقل.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_sender_id, 'yt1' || replace(v_sender_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_recipient FROM yt_coin.accounts WHERE lower(wallet_address) = v_clean_addr;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'عنوان محفظة YT Coin المستلمة غير موجود.');
  END IF;
  IF v_recipient.user_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'لا يمكنك التحويل إلى نفس محفظتك.');
  END IF;

  -- Deterministic lock order to prevent deadlocks
  IF v_sender_id < v_recipient.user_id THEN
    SELECT * INTO v_sender FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
    SELECT * INTO v_recipient FROM yt_coin.accounts WHERE user_id = v_recipient.user_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM yt_coin.accounts WHERE user_id = v_recipient.user_id FOR UPDATE;
    SELECT * INTO v_sender FROM yt_coin.accounts WHERE user_id = v_sender_id FOR UPDATE;
  END IF;

  IF v_sender.balance_units < p_amount_units THEN
    RETURN jsonb_build_object('success', false, 'message', 'رصيد YT Coin غير كافٍ لإتمام التحويل.');
  END IF;

  v_ref := 'YT-XFER:' || gen_random_uuid()::text;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    v_sender_id, 'transfer_sent', -p_amount_units, v_ref || ':OUT',
    jsonb_build_object('to', v_recipient.wallet_address, 'note', p_note, 'unitScale', 1000)
  ) RETURNING id INTO v_sender_ledger;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    v_recipient.user_id, 'transfer_received', p_amount_units, v_ref || ':IN',
    jsonb_build_object('from', v_sender.wallet_address, 'note', p_note, 'unitScale', 1000)
  ) RETURNING id INTO v_recipient_ledger;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units - p_amount_units,
      total_transferred_out_units = total_transferred_out_units + p_amount_units,
      updated_at = now()
  WHERE user_id = v_sender_id;

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + p_amount_units,
      total_transferred_in_units = total_transferred_in_units + p_amount_units,
      updated_at = now()
  WHERE user_id = v_recipient.user_id;

  INSERT INTO yt_coin.transfers(
    sender_id, recipient_id, sender_address, recipient_address,
    amount_units, note, sender_ledger_id, recipient_ledger_id
  ) VALUES (
    v_sender_id, v_recipient.user_id, v_sender.wallet_address, v_recipient.wallet_address,
    p_amount_units, p_note, v_sender_ledger, v_recipient_ledger
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_sender_id, 'yt_coin_p2p_transfer', 'transfer', v_transfer_id::text,
    jsonb_build_object('amountUnits', p_amount_units, 'to', v_recipient.wallet_address)
  );

  RETURN jsonb_build_object(
    'success', true,
    'transferId', v_transfer_id,
    'amountUnits', p_amount_units,
    'amountYt', ROUND(p_amount_units::numeric / 1000.0, 3),
    'newBalanceUnits', v_sender.balance_units - p_amount_units
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_yt_coin(text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_yt_coin(text, bigint, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Verified Ad Center RPCs (No Browser Self-Payout; Trusted S2S Postback Only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_yt_coin_ad_center()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_ads_today integer := 0;
  v_total_ad_units bigint := 0;
  v_networks jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id AND event_date = v_today;

  SELECT COALESCE(SUM(amount_units), 0) INTO v_total_ad_units
  FROM yt_coin.ad_reward_events WHERE user_id = v_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'networkKey', n.network_key,
    'displayName', n.display_name,
    'description', n.description,
    'adType', n.ad_type,
    'placementUrl', n.placement_url,
    'secretEnvKey', n.secret_env_key,
    'rewardClickUnits', n.reward_click_units,
    'rewardClickYt', ROUND(n.reward_click_units::numeric / 1000.0, 3),
    'rewardViewUnits', n.reward_view_units,
    'rewardViewYt', ROUND(n.reward_view_units::numeric / 1000.0, 3),
    'dailyUserLimit', n.daily_user_limit,
    'isActive', n.is_active
  ) ORDER BY n.created_at ASC), '[]'::jsonb)
  INTO v_networks
  FROM yt_coin.ad_networks n
  WHERE n.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'networkKey', e.network_key,
    'externalEventId', e.external_event_id,
    'eventType', e.event_type,
    'amountUnits', e.amount_units,
    'amountYt', ROUND(e.amount_units::numeric / 1000.0, 3),
    'verificationSource', e.verification_source,
    'createdAt', e.created_at
  ) ORDER BY e.created_at DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT id, network_key, external_event_id, event_type, amount_units, verification_source, created_at
    FROM yt_coin.ad_reward_events
    WHERE user_id = v_user_id
    ORDER BY created_at DESC LIMIT 30
  ) e;

  RETURN jsonb_build_object(
    'unitScale', 1000,
    'adClickRewardUnits', COALESCE(v_cfg.ad_click_reward_units, 10),
    'adClickRewardYt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'adViewRewardUnits', COALESCE(v_cfg.ad_view_reward_units, 10),
    'adViewRewardYt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'dailyAdLimit', COALESCE(v_cfg.daily_ad_limit, 20),
    'adsToday', v_ads_today,
    'totalAdEarnedUnits', v_total_ad_units,
    'totalAdEarnedYt', ROUND(v_total_ad_units::numeric / 1000.0, 3),
    'networks', v_networks,
    'recentEvents', v_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_ad_center() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_ad_center() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_yt_coin_ad_session(
  p_network_key text,
  p_event_type text DEFAULT 'view'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_net yt_coin.ad_networks%ROWTYPE;
  v_session_id uuid;
  v_clean_type text := lower(trim(COALESCE(p_event_type, 'view')));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_clean_type NOT IN ('click', 'view') THEN
    RETURN jsonb_build_object('success', false, 'message', 'نوع الحدث الإعلاني غير صالح.');
  END IF;

  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key = lower(trim(COALESCE(p_network_key, ''))) AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'الشبكة الإعلانية غير متاحة أو غير مفعلة حالياً.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (v_user_id, 'yt1' || replace(v_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO yt_coin.ad_sessions(user_id, network_key, event_type)
  VALUES (v_user_id, v_net.network_key, v_clean_type)
  RETURNING id INTO v_session_id;

  -- Zero reward is granted here. Payout only happens after trusted S2S postback verification.
  RETURN jsonb_build_object(
    'success', true,
    'sessionId', v_session_id,
    'userId', v_user_id,
    'networkKey', v_net.network_key,
    'eventType', v_clean_type,
    'placementUrl', v_net.placement_url
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_yt_coin_ad_session(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_yt_coin_ad_session(text, text) TO authenticated;

-- Service-role-ONLY atomic ad reward processor (called strictly after backend S2S signature verification)
CREATE OR REPLACE FUNCTION yt_coin.process_verified_ad_event(
  p_network_key text,
  p_external_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_session_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT 's2s_postback',
  p_raw_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cfg yt_coin.config%ROWTYPE;
  v_net yt_coin.ad_networks%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_clean_type text := lower(trim(COALESCE(p_event_type, 'view')));
  v_clean_event_id text := trim(COALESCE(p_external_event_id, ''));
  v_reward_units bigint := 10;
  v_ads_today integer := 0;
  v_days_elapsed bigint := 0;
  v_cap_units bigint := 0;
  v_daily_paid_units bigint := 0;
  v_treasury yt_coin.system_treasury%ROWTYPE;
  v_ledger_id uuid;
  v_event_row_id uuid;
  v_new_balance_units bigint := 0;
BEGIN
  IF p_user_id IS NULL OR v_clean_event_id = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'بيانات حدث الإعلان غير مكتملة.');
  END IF;

  IF v_clean_type NOT IN ('click', 'view') THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_event_type', 'message', 'نوع الحدث يجب أن يكون click أو view.');
  END IF;

  -- Check duplicate external reference first
  IF EXISTS (
    SELECT 1 FROM yt_coin.ad_reward_events
    WHERE network_key = lower(trim(p_network_key)) AND external_event_id = v_clean_event_id
  ) THEN
    RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'message', 'تم تسجيل مكافأة هذا الحدث الإعلاني مسبقاً.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled THEN
    RETURN jsonb_build_object('success', false, 'status', 'disabled', 'message', 'نظام مكافآت YT Coin متوقف حالياً.');
  END IF;

  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key = lower(trim(p_network_key)) AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'network_inactive', 'message', 'الشبكة الإعلانية غير مفعلة.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.account_status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'status', 'user_not_active', 'message', 'حساب المستخدم غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id, wallet_address)
  VALUES (p_user_id, 'yt1' || replace(p_user_id::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id = p_user_id FOR UPDATE;

  SELECT count(*) INTO v_ads_today
  FROM yt_coin.ad_reward_events
  WHERE user_id = p_user_id AND event_date = v_today;

  IF COALESCE(v_net.daily_user_limit, 0) > 0 AND v_ads_today >= v_net.daily_user_limit THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_ad_limit_reached', 'message', 'تم بلوغ الحد اليومي للإعلانات لهذه الشبكة.');
  END IF;
  IF COALESCE(v_cfg.daily_ad_limit, 0) > 0 AND v_ads_today >= v_cfg.daily_ad_limit THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_ad_limit_reached', 'message', 'تم بلوغ الحد اليومي العام للإعلانات.');
  END IF;

  v_reward_units := CASE
    WHEN v_clean_type = 'click' THEN COALESCE(v_net.reward_click_units, v_cfg.ad_click_reward_units, 10)
    ELSE COALESCE(v_net.reward_view_units, v_cfg.ad_view_reward_units, 10)
  END;

  v_days_elapsed := GREATEST(0, (v_today - v_cfg.mining_start_date));
  v_cap_units := LEAST(
    COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    COALESCE(v_cfg.daily_cap_start_units, 1000000) + (v_days_elapsed * COALESCE(v_cfg.daily_cap_increment_units, 10000))
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date, paid_units, claim_count)
  VALUES (v_today, 0, 0) ON CONFLICT (claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid_units FROM yt_coin.daily_mining_totals WHERE claim_date = v_today FOR UPDATE;

  IF (v_daily_paid_units + v_reward_units) > v_cap_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'daily_cap_reached', 'message', 'تم بلوغ سقف التوزيع اليومي للمنصة.');
  END IF;

  SELECT * INTO v_treasury
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS' FOR UPDATE;
  IF NOT FOUND OR v_treasury.is_locked OR NOT v_treasury.approved_for_distribution OR v_treasury.balance_units < v_reward_units THEN
    RETURN jsonb_build_object('success', false, 'status', 'treasury_insufficient', 'message', 'رصيد مخصص مكافآت المستخدمين غير كافٍ.');
  END IF;

  INSERT INTO yt_coin.ledger(user_id, event_type, amount_units, reference, metadata)
  VALUES (
    p_user_id,
    CASE WHEN v_clean_type = 'click' THEN 'ad_click_reward' ELSE 'ad_view_reward' END,
    v_reward_units,
    'YT-AD:' || v_net.network_key || ':' || v_clean_event_id,
    jsonb_build_object(
      'networkKey', v_net.network_key,
      'externalEventId', v_clean_event_id,
      'eventType', v_clean_type,
      'verificationSource', p_verification_source,
      'unitScale', 1000
    )
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO yt_coin.ad_reward_events(
    user_id, network_key, external_event_id, event_type, event_date,
    amount_units, session_id, ledger_id, verification_source, raw_metadata
  ) VALUES (
    p_user_id, v_net.network_key, v_clean_event_id, v_clean_type, v_today,
    v_reward_units, p_session_id, v_ledger_id, p_verification_source, COALESCE(p_raw_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_event_row_id;

  IF p_session_id IS NOT NULL THEN
    UPDATE yt_coin.ad_sessions
    SET status = 'credited'
    WHERE id = p_session_id AND user_id = p_user_id AND status = 'initiated';
  END IF;

  UPDATE yt_coin.system_treasury
  SET balance_units = balance_units - v_reward_units,
      distributed_units = distributed_units + v_reward_units,
      updated_at = now()
  WHERE treasury_key = 'YT-USER-REWARDS';

  UPDATE yt_coin.accounts
  SET balance_units = balance_units + v_reward_units,
      lifetime_earned_units = lifetime_earned_units + v_reward_units,
      ad_earned_units = ad_earned_units + v_reward_units,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance_units INTO v_new_balance_units;

  UPDATE yt_coin.daily_mining_totals
  SET paid_units = paid_units + v_reward_units,
      updated_at = now()
  WHERE claim_date = v_today;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    p_user_id,
    'verified_ad_reward_credited',
    'ad_reward_event',
    v_event_row_id::text,
    jsonb_build_object(
      'networkKey', v_net.network_key,
      'externalEventId', v_clean_event_id,
      'eventType', v_clean_type,
      'amountUnits', v_reward_units,
      'verificationSource', p_verification_source
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'eventId', v_event_row_id,
    'ledgerId', v_ledger_id,
    'amountUnits', v_reward_units,
    'rewardYt', ROUND(v_reward_units::numeric / 1000.0, 3),
    'newBalanceUnits', v_new_balance_units
  );
END;
$function$;

-- Public wrapper strictly executable by service_role ONLY (so backend Supabase admin client can invoke via RPC)
CREATE OR REPLACE FUNCTION public.service_credit_yt_coin_verified_ad(
  p_network_key text,
  p_external_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_session_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT 's2s_postback',
  p_raw_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN yt_coin.process_verified_ad_event(
    p_network_key, p_external_event_id, p_user_id, p_event_type, p_session_id, p_verification_source, p_raw_metadata
  );
END;
$function$;

REVOKE ALL ON FUNCTION yt_coin.process_verified_ad_event(text, text, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION yt_coin.process_verified_ad_event(text, text, uuid, text, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.service_credit_yt_coin_verified_ad(text, text, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_credit_yt_coin_verified_ad(text, text, uuid, text, uuid, text, jsonb) TO service_role;

-- Service-role lookup helper for postback signature verification
CREATE OR REPLACE FUNCTION public.service_get_yt_coin_ad_network(p_network_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_net yt_coin.ad_networks%ROWTYPE;
BEGIN
  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key = lower(trim(COALESCE(p_network_key, '')));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'id', v_net.id,
    'networkKey', v_net.network_key,
    'displayName', v_net.display_name,
    'authMode', v_net.auth_mode,
    'secretEnvKey', v_net.secret_env_key,
    'adType', v_net.ad_type,
    'rewardClickUnits', v_net.reward_click_units,
    'rewardViewUnits', v_net.reward_view_units,
    'dailyUserLimit', v_net.daily_user_limit,
    'isActive', v_net.is_active
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.service_get_yt_coin_ad_network(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_yt_coin_ad_network(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. Admin RPCs: Summary, Config Update & Ad Networks Management
-- ----------------------------------------------------------------------------
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
  v_circulating_units bigint := 0;
  v_total_mined_units bigint := 0;
  v_today_mined_units bigint := 0;
  v_today_claims integer := 0;
  v_today_taps integer := 0;
  v_today_ads integer := 0;
  v_active_miners bigint := 0;
  v_pending_audit_accounts bigint := 0;
  v_rewards_remaining_units bigint := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_ad_networks jsonb := '[]'::jsonb;
  v_recent_claims jsonb := '[]'::jsonb;
  v_recent_ad_events jsonb := '[]'::jsonb;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true;

  SELECT COALESCE(SUM(balance_units), 0), count(*), count(*) FILTER (WHERE migration_audit_status = 'pending_audit')
  INTO v_circulating_units, v_active_miners, v_pending_audit_accounts
  FROM yt_coin.accounts;

  SELECT COALESCE(SUM(amount_units), 0) INTO v_total_mined_units
  FROM yt_coin.ledger WHERE amount_units > 0;

  SELECT COALESCE(paid_units, 0), COALESCE(claim_count, 0)
  INTO v_today_mined_units, v_today_claims
  FROM yt_coin.daily_mining_totals WHERE claim_date = v_today;

  SELECT COALESCE(SUM(tap_count), 0) INTO v_today_taps
  FROM yt_coin.daily_user_taps WHERE tap_date = v_today;

  SELECT count(*) INTO v_today_ads
  FROM yt_coin.ad_reward_events WHERE event_date = v_today;

  SELECT COALESCE(balance_units, 0) INTO v_rewards_remaining_units
  FROM yt_coin.system_treasury WHERE treasury_key = 'YT-USER-REWARDS';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'treasury_key', t.treasury_key,
    'account_type', t.account_type,
    'label_ar', t.label_ar,
    'allocated_units', t.allocated_units,
    'allocated_yt', ROUND(t.allocated_units::numeric / 1000.0, 3),
    'balance_units', t.balance_units,
    'balance_yt', ROUND(t.balance_units::numeric / 1000.0, 3),
    'distributed_units', t.distributed_units,
    'distributed_yt', ROUND(t.distributed_units::numeric / 1000.0, 3),
    'is_locked', t.is_locked,
    'approved_for_distribution', t.approved_for_distribution,
    'vesting_schedule', t.vesting_schedule,
    'updated_at', t.updated_at
  ) ORDER BY t.allocated_units DESC), '[]'::jsonb)
  INTO v_allocations
  FROM yt_coin.system_treasury t
  WHERE t.treasury_key IN ('YT-USER-REWARDS', 'YT-TEAM-VESTING', 'YT-MARKET-LIQUIDITY', 'YT-GENERAL-CIRCULATION');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'network_key', n.network_key,
    'display_name', n.display_name,
    'description', n.description,
    'auth_mode', n.auth_mode,
    'secret_env_key', n.secret_env_key,
    'placement_url', n.placement_url,
    'ad_type', n.ad_type,
    'reward_click_units', n.reward_click_units,
    'reward_click_yt', ROUND(n.reward_click_units::numeric / 1000.0, 3),
    'reward_view_units', n.reward_view_units,
    'reward_view_yt', ROUND(n.reward_view_units::numeric / 1000.0, 3),
    'daily_user_limit', n.daily_user_limit,
    'is_active', n.is_active,
    'updated_at', n.updated_at
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_ad_networks
  FROM yt_coin.ad_networks n;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_recent_claims
  FROM (
    SELECT mc.id, mc.user_id, p.full_name, mc.claim_date, mc.amount_units,
           ROUND(mc.amount_units::numeric / 1000.0, 3) AS amount_yt, mc.created_at
    FROM yt_coin.mining_claims mc
    LEFT JOIN public.profiles p ON p.id = mc.user_id
    ORDER BY mc.created_at DESC LIMIT 20
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(ae)), '[]'::jsonb) INTO v_recent_ad_events
  FROM (
    SELECT e.id, e.user_id, p.full_name, e.network_key, e.external_event_id,
           e.event_type, e.amount_units, ROUND(e.amount_units::numeric / 1000.0, 3) AS amount_yt,
           e.verification_source, e.created_at
    FROM yt_coin.ad_reward_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    ORDER BY e.created_at DESC LIMIT 20
  ) ae;

  RETURN jsonb_build_object(
    'unit_scale', 1000,
    'economy_version', COALESCE(v_cfg.economy_version, 'yt_bigint_100m_v2'),
    'mining_enabled', COALESCE(v_cfg.mining_enabled, true),
    'max_supply_units', COALESCE(v_cfg.max_supply_units, 100000000000),
    'max_supply_yt', 100000000,
    'rewards_treasury_balance_units', v_rewards_remaining_units,
    'rewards_treasury_balance_yt', ROUND(v_rewards_remaining_units::numeric / 1000.0, 3),
    'circulating_supply_units', v_circulating_units,
    'circulating_supply_yt', ROUND(v_circulating_units::numeric / 1000.0, 3),
    'total_mined_units', v_total_mined_units,
    'total_mined_yt', ROUND(v_total_mined_units::numeric / 1000.0, 3),
    'today_mined_units', v_today_mined_units,
    'today_mined_yt', ROUND(v_today_mined_units::numeric / 1000.0, 3),
    'active_miners_count', v_active_miners,
    'pending_audit_accounts', v_pending_audit_accounts,
    'today_claims_count', v_today_claims,
    'today_taps_count', v_today_taps,
    'today_ads_count', v_today_ads,
    'base_reward_units', COALESCE(v_cfg.base_reward_units, 500),
    'base_reward_yt', ROUND(COALESCE(v_cfg.base_reward_units, 500)::numeric / 1000.0, 3),
    'tap_reward_units', COALESCE(v_cfg.tap_reward_units, 10),
    'tap_reward_yt', ROUND(COALESCE(v_cfg.tap_reward_units, 10)::numeric / 1000.0, 3),
    'ad_click_reward_units', COALESCE(v_cfg.ad_click_reward_units, 10),
    'ad_click_reward_yt', ROUND(COALESCE(v_cfg.ad_click_reward_units, 10)::numeric / 1000.0, 3),
    'ad_view_reward_units', COALESCE(v_cfg.ad_view_reward_units, 10),
    'ad_view_reward_yt', ROUND(COALESCE(v_cfg.ad_view_reward_units, 10)::numeric / 1000.0, 3),
    'daily_tap_limit', COALESCE(v_cfg.daily_tap_limit, 1000),
    'daily_ad_limit', COALESCE(v_cfg.daily_ad_limit, 20),
    'daily_cap_start_units', COALESCE(v_cfg.daily_cap_start_units, 1000000),
    'daily_cap_start_yt', ROUND(COALESCE(v_cfg.daily_cap_start_units, 1000000)::numeric / 1000.0, 3),
    'daily_cap_max_units', COALESCE(v_cfg.daily_cap_max_units, 1000000000),
    'daily_cap_max_yt', ROUND(COALESCE(v_cfg.daily_cap_max_units, 1000000000)::numeric / 1000.0, 3),
    'swap_enabled', COALESCE(v_cfg.swap_enabled, false),
    'exchange_rate_yer_per_yt', COALESCE(v_cfg.exchange_rate_yer_per_yt, 1.000000),
    'treasuries', v_allocations,
    'ad_networks', v_ad_networks,
    'recent_claims', v_recent_claims,
    'recent_ad_events', v_recent_ad_events,
    'updated_at', v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_yt_coin_admin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_admin_summary() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, integer, bigint, bigint);
DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.admin_update_yt_coin_config(boolean, numeric, numeric, numeric, integer, integer, numeric, numeric, boolean, numeric);

CREATE OR REPLACE FUNCTION public.admin_update_yt_coin_config(
  p_mining_enabled boolean DEFAULT NULL,
  p_base_reward_units bigint DEFAULT NULL,
  p_tap_reward_units bigint DEFAULT NULL,
  p_ad_click_reward_units bigint DEFAULT NULL,
  p_ad_view_reward_units bigint DEFAULT NULL,
  p_daily_tap_limit integer DEFAULT NULL,
  p_daily_ad_limit integer DEFAULT NULL,
  p_daily_cap_start_units bigint DEFAULT NULL,
  p_daily_cap_max_units bigint DEFAULT NULL,
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

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton = true FOR UPDATE;

  UPDATE yt_coin.config
  SET mining_enabled = COALESCE(p_mining_enabled, mining_enabled),
      base_reward_units = COALESCE(NULLIF(GREATEST(p_base_reward_units, 1), 0), base_reward_units),
      tap_reward_units = COALESCE(NULLIF(GREATEST(p_tap_reward_units, 1), 0), tap_reward_units),
      ad_click_reward_units = COALESCE(NULLIF(GREATEST(p_ad_click_reward_units, 1), 0), ad_click_reward_units),
      ad_view_reward_units = COALESCE(NULLIF(GREATEST(p_ad_view_reward_units, 1), 0), ad_view_reward_units),
      daily_tap_limit = COALESCE(GREATEST(p_daily_tap_limit, 0), daily_tap_limit),
      daily_ad_limit = COALESCE(GREATEST(p_daily_ad_limit, 0), daily_ad_limit),
      daily_cap_start_units = COALESCE(NULLIF(GREATEST(p_daily_cap_start_units, 1), 0), daily_cap_start_units),
      daily_cap_max_units = COALESCE(NULLIF(GREATEST(p_daily_cap_max_units, 1), 0), daily_cap_max_units),
      swap_enabled = COALESCE(p_swap_enabled, swap_enabled),
      exchange_rate_yer_per_yt = CASE
        WHEN p_exchange_rate_yer_per_yt IS NOT NULL AND p_exchange_rate_yer_per_yt > 0 THEN p_exchange_rate_yer_per_yt
        ELSE exchange_rate_yer_per_yt
      END,
      updated_at = now()
  WHERE singleton = true
  RETURNING * INTO v_cfg;

  INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'admin_update_config',
    'yt_coin_config',
    'singleton',
    jsonb_build_object(
      'base_reward_units', v_cfg.base_reward_units,
      'ad_click_reward_units', v_cfg.ad_click_reward_units,
      'ad_view_reward_units', v_cfg.ad_view_reward_units,
      'daily_ad_limit', v_cfg.daily_ad_limit,
      'mining_enabled', v_cfg.mining_enabled
    )
  );

  RETURN row_to_json(v_cfg)::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_yt_coin_config(boolean, bigint, bigint, bigint, bigint, integer, integer, bigint, bigint, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_manage_yt_coin_ad_network(
  p_action text,
  p_id uuid DEFAULT NULL,
  p_network_key text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_auth_mode text DEFAULT 'hmac_sha256',
  p_secret_env_key text DEFAULT 'YT_COIN_AD_POSTBACK_SECRET',
  p_placement_url text DEFAULT NULL,
  p_ad_type text DEFAULT 'both',
  p_reward_click_units bigint DEFAULT 10,
  p_reward_view_units bigint DEFAULT 10,
  p_daily_user_limit integer DEFAULT 20,
  p_is_active boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_row yt_coin.ad_networks%ROWTYPE;
  v_clean_key text := lower(trim(COALESCE(p_network_key, '')));
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF v_action = 'upsert' THEN
    IF v_clean_key !~ '^[a-z0-9_-]{2,48}$' THEN
      RAISE EXCEPTION 'مفتاح الشبكة الإعلانية يجب أن يحتوي على حروف إنجليزية صغيرة وأرقام وشرطة فقط (2-48 حرفاً).';
    END IF;
    IF trim(COALESCE(p_display_name, '')) = '' THEN
      RAISE EXCEPTION 'اسم الشبكة الإعلانية مطلوب.';
    END IF;

    IF p_id IS NOT NULL THEN
      UPDATE yt_coin.ad_networks
      SET network_key = v_clean_key,
          display_name = trim(p_display_name),
          description = NULLIF(trim(COALESCE(p_description, '')), ''),
          auth_mode = CASE WHEN p_auth_mode IN ('hmac_sha256', 'shared_secret') THEN p_auth_mode ELSE 'hmac_sha256' END,
          secret_env_key = COALESCE(NULLIF(trim(p_secret_env_key), ''), 'YT_COIN_AD_POSTBACK_SECRET'),
          placement_url = NULLIF(trim(COALESCE(p_placement_url, '')), ''),
          ad_type = CASE WHEN p_ad_type IN ('view', 'click', 'both') THEN p_ad_type ELSE 'both' END,
          reward_click_units = GREATEST(1, COALESCE(p_reward_click_units, 10)),
          reward_view_units = GREATEST(1, COALESCE(p_reward_view_units, 10)),
          daily_user_limit = GREATEST(0, COALESCE(p_daily_user_limit, 20)),
          is_active = COALESCE(p_is_active, false),
          updated_at = now()
      WHERE id = p_id
      RETURNING * INTO v_row;
    ELSE
      INSERT INTO yt_coin.ad_networks(
        network_key, display_name, description, auth_mode, secret_env_key,
        placement_url, ad_type, reward_click_units, reward_view_units, daily_user_limit, is_active
      ) VALUES (
        v_clean_key,
        trim(p_display_name),
        NULLIF(trim(COALESCE(p_description, '')), ''),
        CASE WHEN p_auth_mode IN ('hmac_sha256', 'shared_secret') THEN p_auth_mode ELSE 'hmac_sha256' END,
        COALESCE(NULLIF(trim(p_secret_env_key), ''), 'YT_COIN_AD_POSTBACK_SECRET'),
        NULLIF(trim(COALESCE(p_placement_url, '')), ''),
        CASE WHEN p_ad_type IN ('view', 'click', 'both') THEN p_ad_type ELSE 'both' END,
        GREATEST(1, COALESCE(p_reward_click_units, 10)),
        GREATEST(1, COALESCE(p_reward_view_units, 10)),
        GREATEST(0, COALESCE(p_daily_user_limit, 20)),
        COALESCE(p_is_active, false)
      )
      ON CONFLICT (network_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        auth_mode = EXCLUDED.auth_mode,
        secret_env_key = EXCLUDED.secret_env_key,
        placement_url = EXCLUDED.placement_url,
        ad_type = EXCLUDED.ad_type,
        reward_click_units = EXCLUDED.reward_click_units,
        reward_view_units = EXCLUDED.reward_view_units,
        daily_user_limit = EXCLUDED.daily_user_limit,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      RETURNING * INTO v_row;
    END IF;

    INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id, 'admin_upsert_ad_network', 'ad_network', v_row.id::text,
      jsonb_build_object('networkKey', v_row.network_key, 'isActive', v_row.is_active, 'clickUnits', v_row.reward_click_units, 'viewUnits', v_row.reward_view_units)
    );

    RETURN row_to_json(v_row)::jsonb;
  ELSIF v_action = 'delete' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'معرف الشبكة الإعلانية مطلوب للحذف.';
    END IF;
    -- Protect audit integrity: disallow delete if reward events already reference this network
    IF EXISTS (
      SELECT 1 FROM yt_coin.ad_reward_events e
      JOIN yt_coin.ad_networks n ON n.network_key = e.network_key
      WHERE n.id = p_id
    ) THEN
      UPDATE yt_coin.ad_networks SET is_active = false, updated_at = now() WHERE id = p_id RETURNING * INTO v_row;
      RETURN jsonb_build_object('deactivated', true, 'network', row_to_json(v_row)::jsonb, 'message', 'تم تعطيل الشبكة للحفاظ على سجل التدقيق التاريخي.');
    END IF;

    DELETE FROM yt_coin.ad_networks WHERE id = p_id RETURNING * INTO v_row;
    INSERT INTO yt_coin.audit_log(actor_id, action, entity_type, entity_id, details)
    VALUES (v_caller_id, 'admin_delete_ad_network', 'ad_network', p_id::text, jsonb_build_object('networkKey', v_row.network_key));
    RETURN jsonb_build_object('deleted', true, 'id', p_id);
  ELSE
    RAISE EXCEPTION 'إجراء غير صالح لإدارة الشبكات الإعلانية.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_manage_yt_coin_ad_network(text, uuid, text, text, text, text, text, text, text, bigint, bigint, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_yt_coin_ad_network(text, uuid, text, text, text, text, text, text, text, bigint, bigint, integer, boolean) TO authenticated;
