-- Keep referral rewards separate from the general treasury.
-- The dedicated fund starts at zero and can only pay rewards after being funded.

INSERT INTO public.financial_accounts
  (account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status)
VALUES
  ('PLATFORM-REFERRAL-REWARDS-FUND', 'treasury', NULL, NULL, 'credit', 0, 'active')
ON CONFLICT (account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.process_referral_task_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_referrer_id uuid; v_reward_units bigint; v_share_units bigint;
  v_referrer_wallet_id uuid; v_fund_id uuid; v_fund_balance bigint;
  v_reward_id uuid; v_transaction_id uuid;
BEGIN
  IF NEW.status <> 'approved' OR NEW.reward_transaction_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.status = 'approved'
         AND OLD.reward_transaction_id IS NOT DISTINCT FROM NEW.reward_transaction_id) THEN
    RETURN NEW;
  END IF;
  SELECT p.referred_by, t.reward_units INTO v_referrer_id, v_reward_units
  FROM public.profiles p JOIN public.tasks t ON t.id = NEW.task_id WHERE p.id = NEW.user_id;
  IF v_referrer_id IS NULL OR v_referrer_id = NEW.user_id
     OR v_reward_units IS NULL OR v_reward_units <= 0 THEN RETURN NEW; END IF;
  v_share_units := floor((v_reward_units::numeric * 5) / 100)::bigint;
  IF v_share_units <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.referral_task_rewards
    (referrer_user_id,referred_user_id,task_submission_id,amount_units,status,idempotency_key,metadata)
  VALUES (v_referrer_id,NEW.user_id,NEW.id,v_share_units,'pending',
    'REFERRAL-TASK-SHARE:'||NEW.id::text,
    jsonb_build_object('rate_percent',5,'task_reward_units',v_reward_units,
      'calculation','floor(task_reward_units*5/100)'))
  ON CONFLICT (task_submission_id) DO NOTHING;
  SELECT id INTO v_reward_id FROM public.referral_task_rewards
    WHERE task_submission_id=NEW.id FOR UPDATE;
  IF v_reward_id IS NULL OR EXISTS (
    SELECT 1 FROM public.referral_task_rewards WHERE id=v_reward_id AND status<>'pending'
  ) THEN RETURN NEW; END IF;
  SELECT fa.id INTO v_referrer_wallet_id
  FROM public.wallets w JOIN public.financial_accounts fa ON fa.wallet_id=w.id
  WHERE w.user_id=v_referrer_id AND fa.account_type='wallet' AND fa.status='active'
  FOR UPDATE OF fa;
  SELECT id,balance_units INTO v_fund_id,v_fund_balance
  FROM public.financial_accounts
  WHERE account_code='PLATFORM-REFERRAL-REWARDS-FUND'
    AND account_type='treasury' AND status='active'
  FOR UPDATE;
  IF v_referrer_wallet_id IS NULL OR v_fund_id IS NULL OR v_fund_balance<v_share_units THEN
    UPDATE public.referral_task_rewards SET metadata=metadata||jsonb_build_object(
      'pending_reason',CASE WHEN v_referrer_wallet_id IS NULL THEN 'referrer_wallet_account_unavailable'
      WHEN v_fund_id IS NULL THEN 'referral_rewards_fund_unavailable'
      ELSE 'insufficient_referral_rewards_fund' END)
    WHERE id=v_reward_id AND status='pending';
    RETURN NEW;
  END IF;
  v_transaction_id:=public.post_ledger_transaction(
    'REFERRAL_TASK_SHARE','REFERRAL-TASK-SHARE:'||NEW.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id',v_fund_id,'side','debit','amount_units',v_share_units),
      jsonb_build_object('account_id',v_referrer_wallet_id,'side','credit','amount_units',v_share_units)),
    'Referral task share for submission '||NEW.id::text,
    jsonb_build_object('referrer_user_id',v_referrer_id,'referred_user_id',NEW.user_id,
      'task_submission_id',NEW.id,'rate_percent',5,'task_reward_units',v_reward_units));
  UPDATE public.referral_task_rewards SET status='posted',ledger_transaction_id=v_transaction_id,
    posted_at=now(),metadata=metadata-'pending_reason'
  WHERE id=v_reward_id AND status='pending';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_pending_referral_task_shares()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r record; v_wallet_id uuid; v_fund_id uuid; v_fund_balance bigint;
  v_tx_id uuid; v_count integer:=0;
BEGIN
  FOR r IN SELECT id,referrer_user_id,task_submission_id,amount_units,idempotency_key
    FROM public.referral_task_rewards WHERE status='pending'
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED
  LOOP
    SELECT fa.id INTO v_wallet_id FROM public.wallets w
      JOIN public.financial_accounts fa ON fa.wallet_id=w.id
      WHERE w.user_id=r.referrer_user_id AND fa.account_type='wallet' AND fa.status='active'
      FOR UPDATE OF fa;
    SELECT id,balance_units INTO v_fund_id,v_fund_balance
      FROM public.financial_accounts WHERE account_code='PLATFORM-REFERRAL-REWARDS-FUND'
      AND account_type='treasury' AND status='active' FOR UPDATE;
    IF v_wallet_id IS NULL OR v_fund_id IS NULL OR v_fund_balance<r.amount_units THEN
      CONTINUE;
    END IF;
    v_tx_id:=public.post_ledger_transaction('REFERRAL_TASK_SHARE',r.idempotency_key,
      jsonb_build_array(
        jsonb_build_object('account_id',v_fund_id,'side','debit','amount_units',r.amount_units),
        jsonb_build_object('account_id',v_wallet_id,'side','credit','amount_units',r.amount_units)),
      'Pending referral task share '||r.task_submission_id::text,
      jsonb_build_object('referral_task_reward_id',r.id,'rate_percent',5));
    UPDATE public.referral_task_rewards SET status='posted',ledger_transaction_id=v_tx_id,
      posted_at=now(),metadata=metadata-'pending_reason' WHERE id=r.id AND status='pending';
    IF FOUND THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_referral_fund_topup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.account_code='PLATFORM-REFERRAL-REWARDS-FUND'
     AND NEW.balance_units>OLD.balance_units THEN
    PERFORM public.settle_pending_referral_task_shares();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_settle_referral_shares_on_fund_topup ON public.financial_accounts;
CREATE TRIGGER trg_settle_referral_shares_on_fund_topup
AFTER UPDATE OF balance_units ON public.financial_accounts
FOR EACH ROW
WHEN (NEW.account_code='PLATFORM-REFERRAL-REWARDS-FUND' AND NEW.balance_units>OLD.balance_units)
EXECUTE FUNCTION public.process_referral_fund_topup();

REVOKE ALL ON FUNCTION public.process_referral_task_share() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_pending_referral_task_shares() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_referral_fund_topup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pending_referral_task_shares() TO service_role;
