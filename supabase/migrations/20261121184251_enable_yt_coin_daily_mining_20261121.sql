-- Enable the already provisioned YT Coin mining engine.
-- This migration is intentionally limited to the isolated yt_coin configuration.
-- It does not modify YER wallets, financial accounts, or the financial ledger.
UPDATE yt_coin.config
SET mining_enabled = true,
    updated_at = now()
WHERE singleton = true
  AND daily_global_cap_units = 10000000000
  AND base_reward_units = 500000
  AND daily_increment_units = 10000
  AND max_daily_reward_units = 1500000
  AND timezone_name = 'Asia/Aden'
  AND EXISTS (
    SELECT 1
    FROM yt_coin.system_treasury
    WHERE treasury_key = 'YT-REWARDS-TREASURY'
      AND balance_units > 0
  );
