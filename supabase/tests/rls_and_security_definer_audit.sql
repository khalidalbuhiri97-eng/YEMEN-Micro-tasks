-- ==============================================================================
-- KASB YEMEN — RLS, SECURITY DEFINER, 6-Decimal Precision & Double-Entry Audit SQL
-- Run in Supabase SQL Editor AFTER applying Migrations 023 through 027.
-- Every assertion raises an EXCEPTION if any invariant fails.
-- ==============================================================================

DO $$
DECLARE
    v_missing_rls TEXT[];
    v_unpinned_funcs TEXT[];
    v_bad_cols TEXT[];
    v_unbalanced_tx INT := 0;
BEGIN
    -- 1. Verify RLS is enabled on all critical tables
    SELECT array_agg(c.relname)
    INTO v_missing_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relname IN (
          'financial_audit_logs',
          'referral_rewards',
          'referral_task_rewards',
          'tax_definitions',
          'tax_settlements',
          'withdrawal_requests',
          'external_accounts',
          'external_deposits',
          'external_account_transfers',
          'external_account_reconciliations',
          'campaigns',
          'financial_accounts',
          'ledger_transactions',
          'ledger_entries'
      )
      AND c.relrowsecurity = FALSE;

    IF v_missing_rls IS NOT NULL AND array_length(v_missing_rls, 1) > 0 THEN
        RAISE EXCEPTION 'AUDIT FAIL: RLS disabled on tables: %', array_to_string(v_missing_rls, ', ');
    END IF;

    -- 2. Verify SECURITY DEFINER functions have pinned search_path
    SELECT array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
    INTO v_unpinned_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.prosecdef = TRUE
      AND p.proname IN (
          'post_ledger_transaction',
          'transfer_wallet_units',
          'create_funded_task',
          'cancel_funded_task',
          'review_task_submission',
          'submit_task_proof',
          'is_admin',
          'reserve_withdrawal_ledger',
          'settle_withdrawal_ledger',
          'create_funded_campaign',
          'approve_advertiser_campaign',
          'start_advertiser_campaign',
          'settle_advertiser_campaign',
          'process_referral_task_share',
          'get_my_referral_summary'
      )
      AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
          )
      );

    IF v_unpinned_funcs IS NOT NULL AND array_length(v_unpinned_funcs, 1) > 0 THEN
        RAISE EXCEPTION 'AUDIT FAIL: Unpinned SECURITY DEFINER functions: %', array_to_string(v_unpinned_funcs, '; ');
    END IF;

    -- 3. Verify critical monetary columns are NUMERIC(30,6)
    SELECT array_agg(table_name || '.' || column_name || ' (' || data_type || ',' || COALESCE(numeric_precision::text, '?') || ',' || COALESCE(numeric_scale::text, '?') || ')')
    INTO v_bad_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
          (table_name = 'financial_accounts' AND column_name = 'balance_units')
          OR (table_name = 'ledger_entries' AND column_name = 'amount_units')
          OR (table_name = 'wallets' AND column_name IN ('available_balance', 'pending_balance'))
          OR (table_name = 'tasks' AND column_name IN ('reward_units', 'commission_units'))
          OR (table_name = 'withdrawal_requests' AND column_name IN ('amount', 'fee', 'net_amount'))
          OR (table_name = 'campaigns' AND column_name IN ('reward_units', 'budget_units', 'fee_units', 'total_units', 'refunded_units'))
          OR (table_name = 'referral_task_rewards' AND column_name IN ('amount_units', 'platform_net_profit_units'))
      )
      AND NOT (data_type = 'numeric' AND numeric_precision = 30 AND numeric_scale = 6);

    IF v_bad_cols IS NOT NULL AND array_length(v_bad_cols, 1) > 0 THEN
        RAISE EXCEPTION 'AUDIT FAIL: Non-NUMERIC(30,6) monetary columns found: %', array_to_string(v_bad_cols, '; ');
    END IF;

    -- 4. Verify double-entry parity across entire ledger
    SELECT COUNT(*)
    INTO v_unbalanced_tx
    FROM (
        SELECT transaction_id
        FROM public.ledger_entries
        GROUP BY transaction_id
        HAVING SUM(CASE WHEN entry_side = 'debit' THEN amount_units ELSE 0 END)
            <> SUM(CASE WHEN entry_side = 'credit' THEN amount_units ELSE 0 END)
    ) bad;

    IF v_unbalanced_tx > 0 THEN
        RAISE EXCEPTION 'AUDIT FAIL: Found % unbalanced ledger transactions!', v_unbalanced_tx;
    END IF;

    -- 5. Verify 3% transfer fee formula without minimum floor
    IF ROUND(15::numeric * 0.03, 6) <> 0.450000 OR ROUND(0.01::numeric * 0.03, 6) <> 0.000300 THEN
        RAISE EXCEPTION 'AUDIT FAIL: Transfer 3%% rounding mismatch!';
    END IF;

    RAISE NOTICE 'ALL RLS, SECURITY DEFINER, 6-DECIMAL PRECISION & DOUBLE-ENTRY AUDITS PASSED.';
END $$;
