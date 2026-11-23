-- YT Coin journal integrity hardening and per-ad-type reward audit.
-- Safe additive migration: no historical rows, balances, reward settings, or legacy wallets are changed.

BEGIN;

CREATE OR REPLACE FUNCTION yt_coin.check_journal_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_count bigint;
  v_net numeric;
  v_negative_count bigint;
  v_positive_count bigint;
BEGIN
  SELECT count(*), coalesce(sum(je.amount_parts), 0),
         count(*) FILTER (WHERE je.amount_parts < 0),
         count(*) FILTER (WHERE je.amount_parts > 0)
    INTO v_count, v_net, v_negative_count, v_positive_count
    FROM yt_coin.journal_entries je
   WHERE je.transaction_id = NEW.transaction_id;

  IF v_count < 2 OR v_negative_count = 0 OR v_positive_count = 0 OR v_net <> 0 THEN
    RAISE EXCEPTION
      'YT Coin journal transaction % is not balanced: rows %, negative %, positive %, net % parts',
      NEW.transaction_id, v_count, v_negative_count, v_positive_count, v_net
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION yt_coin.check_journal_transaction_has_balanced_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_count bigint;
  v_net numeric;
  v_negative_count bigint;
  v_positive_count bigint;
BEGIN
  SELECT count(*), coalesce(sum(je.amount_parts), 0),
         count(*) FILTER (WHERE je.amount_parts < 0),
         count(*) FILTER (WHERE je.amount_parts > 0)
    INTO v_count, v_net, v_negative_count, v_positive_count
    FROM yt_coin.journal_entries je
   WHERE je.transaction_id = NEW.id;

  IF v_count < 2 OR v_negative_count = 0 OR v_positive_count = 0 OR v_net <> 0 THEN
    RAISE EXCEPTION
      'YT Coin journal transaction % must contain balanced debit and credit entries; rows %, negative %, positive %, net % parts',
      NEW.id, v_count, v_negative_count, v_positive_count, v_net
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS journal_transactions_balance_check ON yt_coin.journal_transactions;
CREATE CONSTRAINT TRIGGER journal_transactions_balance_check
AFTER INSERT ON yt_coin.journal_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION yt_coin.check_journal_transaction_has_balanced_entries();

-- Keep the existing deferred journal_entries_balance_check trigger; its function
-- now also requires at least two lines and both positive and negative entries.

CREATE OR REPLACE FUNCTION public.admin_verify_yt_coin_ledger_integrity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  WITH per_transaction AS (
    SELECT jt.id,
           count(je.id) AS entry_count,
           coalesce(sum(je.amount_parts), 0) AS net_parts,
           count(*) FILTER (WHERE je.amount_parts < 0) AS debit_lines,
           count(*) FILTER (WHERE je.amount_parts > 0) AS credit_lines,
           coalesce(sum(-je.amount_parts) FILTER (WHERE je.amount_parts < 0), 0) AS debit_units,
           coalesce(sum(je.amount_parts) FILTER (WHERE je.amount_parts > 0), 0) AS credit_units
      FROM yt_coin.journal_transactions jt
      LEFT JOIN yt_coin.journal_entries je ON je.transaction_id = jt.id
     WHERE jt.status = 'posted'
     GROUP BY jt.id
  ),
  journal_totals AS (
    SELECT count(*) AS total_posted,
           coalesce(sum(debit_units), 0) AS total_debit,
           coalesce(sum(credit_units), 0) AS total_credit,
           count(*) FILTER (
             WHERE entry_count < 2 OR debit_lines = 0 OR credit_lines = 0
                OR net_parts <> 0 OR debit_units <> credit_units
           ) AS unbalanced_count
      FROM per_transaction
  ),
  ad_totals AS (
    SELECT e.event_type,
           count(*) AS event_count,
           coalesce(sum(c.reward_parts), 0) AS reward_parts
      FROM yt_coin.ad_reward_claims c
      JOIN yt_coin.ad_events e ON e.id = c.event_id
     GROUP BY e.event_type
  )
  SELECT jsonb_build_object(
    'isBalanced', jt.unbalanced_count = 0 AND jt.total_debit = jt.total_credit,
    'totalPostedJournalTx', jt.total_posted,
    'totalDebitUnits', jt.total_debit,
    'totalCreditUnits', jt.total_credit,
    'unbalancedTransactions', jt.unbalanced_count,
    'adRewards', jsonb_build_object(
      'click', jsonb_build_object(
        'events', coalesce((SELECT event_count FROM ad_totals WHERE event_type = 'click'), 0),
        'rewardParts', coalesce((SELECT reward_parts FROM ad_totals WHERE event_type = 'click'), 0),
        'rewardYt', coalesce((SELECT reward_parts::numeric / 1000 FROM ad_totals WHERE event_type = 'click'), 0)
      ),
      'view', jsonb_build_object(
        'events', coalesce((SELECT event_count FROM ad_totals WHERE event_type = 'view'), 0),
        'rewardParts', coalesce((SELECT reward_parts FROM ad_totals WHERE event_type = 'view'), 0),
        'rewardYt', coalesce((SELECT reward_parts::numeric / 1000 FROM ad_totals WHERE event_type = 'view'), 0)
      )
    ),
    'unitScale', 1000
  )
    INTO v_result
    FROM journal_totals jt;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_verify_yt_coin_ledger_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_yt_coin_ledger_integrity() TO authenticated;
REVOKE ALL ON FUNCTION yt_coin.check_journal_transaction_balanced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION yt_coin.check_journal_transaction_has_balanced_entries() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
