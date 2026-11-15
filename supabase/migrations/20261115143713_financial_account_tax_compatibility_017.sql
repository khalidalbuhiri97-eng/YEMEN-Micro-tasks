-- Migration 017: Align financial account taxonomy and tax settlement compatibility.
-- Safe to run after the live foundation / migrations 011-014.
-- Does not alter existing balances or historical ledger entries.

ALTER TABLE public.financial_accounts
  DROP CONSTRAINT IF EXISTS financial_accounts_account_type_check;

ALTER TABLE public.financial_accounts
  ADD CONSTRAINT financial_accounts_account_type_check
  CHECK (account_type = ANY (ARRAY[
    'wallet','treasury','issuance_control','asset','revenue',
    'expense','liability','equity','escrow'
  ]));

ALTER TABLE public.financial_accounts
  DROP CONSTRAINT IF EXISTS financial_accounts_structure;

ALTER TABLE public.financial_accounts
  ADD CONSTRAINT financial_accounts_structure CHECK (
    (account_type='wallet' AND owner_user_id IS NOT NULL
      AND wallet_id IS NOT NULL AND normal_side='credit')
    OR
    (account_type='issuance_control' AND owner_user_id IS NULL
      AND wallet_id IS NULL AND normal_side='debit')
    OR (
      account_type IN ('treasury','asset','revenue','expense','liability','equity','escrow')
      AND owner_user_id IS NULL AND wallet_id IS NULL
      AND (
        (account_type IN ('asset','expense') AND normal_side='debit')
        OR (account_type IN ('treasury','revenue','liability','escrow') AND normal_side='credit')
        OR (account_type='equity' AND (
          (account_code='OWNER-WITHDRAWALS' AND normal_side='debit')
          OR (account_code<>'OWNER-WITHDRAWALS' AND normal_side='credit')
        ))
      )
    )
  );

INSERT INTO public.financial_accounts
  (account_code,account_type,owner_user_id,wallet_id,normal_side,balance_units,status)
VALUES
  ('PLATFORM-CASH-VAULT','asset',NULL,NULL,'debit',0,'active'),
  ('PLATFORM-REVENUE-TASKS','revenue',NULL,NULL,'credit',0,'active'),
  ('PLATFORM-REVENUE-ADS','revenue',NULL,NULL,'credit',0,'active'),
  ('PLATFORM-REVENUE-SUBSCRIPTIONS','revenue',NULL,NULL,'credit',0,'active'),
  ('PLATFORM-REVENUE-SERVICES','revenue',NULL,NULL,'credit',0,'active'),
  ('PLATFORM-EXPENSES','expense',NULL,NULL,'debit',0,'active'),
  ('PLATFORM-EXPENSE-CLEARING','liability',NULL,NULL,'credit',0,'active'),
  ('PAYMENT-PROVIDER-FEES','expense',NULL,NULL,'debit',0,'active'),
  ('OWNER-CAPITAL','equity',NULL,NULL,'credit',0,'active'),
  ('OWNER-CURRENT-ACCOUNT','equity',NULL,NULL,'credit',0,'active'),
  ('OWNER-WITHDRAWALS','equity',NULL,NULL,'debit',0,'active'),
  ('RETAINED-EARNINGS','equity',NULL,NULL,'credit',0,'active'),
  ('TAX-PAYABLE','liability',NULL,NULL,'credit',0,'active'),
  ('WITHDRAWAL-RESERVED','liability',NULL,NULL,'credit',0,'active'),
  ('WITHDRAWAL-SETTLED','liability',NULL,NULL,'credit',0,'active'),
  ('TASK-ESCROW-POOL','escrow',NULL,NULL,'credit',0,'active')
ON CONFLICT (account_code) DO NOTHING;

-- Live schema stores tax_amount_units; dashboard expects tax_amount.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tax_settlements'
      AND column_name='tax_amount'
  ) THEN
    ALTER TABLE public.tax_settlements
      ADD COLUMN tax_amount BIGINT GENERATED ALWAYS AS (tax_amount_units) STORED;
  END IF;
END
$$;
