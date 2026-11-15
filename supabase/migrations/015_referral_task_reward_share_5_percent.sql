-- Referral task reward share: 5% of each approved referred user's task reward.
-- Separate table preserves the one-time referral signup reward constraints.

CREATE TABLE IF NOT EXISTS public.referral_task_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  referred_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  task_submission_id uuid NOT NULL UNIQUE REFERENCES public.task_submissions(id) ON DELETE RESTRICT,
  amount_units bigint NOT NULL CHECK (amount_units > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','reversed')),
  ledger_transaction_id uuid REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  CONSTRAINT referral_task_rewards_no_self_referral CHECK (referrer_user_id <> referred_user_id),
  CONSTRAINT referral_task_rewards_posted_requires_ledger
    CHECK (status <> 'posted' OR (ledger_transaction_id IS NOT NULL AND posted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS referral_task_rewards_pending_idx
  ON public.referral_task_rewards(created_at, id) WHERE status = 'pending';

ALTER TABLE public.referral_task_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referral_task_rewards FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.referral_task_rewards TO service_role;

CREATE OR REPLACE FUNCTION public.process_referral_task_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_referrer_id uuid; v_reward_units bigint; v_share_units bigint;
  v_referrer_wallet_id uuid; v_treasury_id uuid; v_treasury_balance bigint;
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
  SELECT id,balance_units INTO v_treasury_id,v_treasury_balance
  FROM public.financial_accounts
  WHERE account_code='PLATFORM-TREASURY' AND account_type='treasury' AND status='active'
  FOR UPDATE;
  IF v_referrer_wallet_id IS NULL OR v_treasury_id IS NULL OR v_treasury_balance<v_share_units THEN
    UPDATE public.referral_task_rewards SET metadata=metadata||jsonb_build_object(
      'pending_reason',CASE WHEN v_referrer_wallet_id IS NULL THEN 'referrer_wallet_account_unavailable'
      WHEN v_treasury_id IS NULL THEN 'platform_treasury_unavailable'
      ELSE 'insufficient_platform_treasury' END)
    WHERE id=v_reward_id AND status='pending';
    RETURN NEW;
  END IF;
  v_transaction_id:=public.post_ledger_transaction(
    'REFERRAL_TASK_SHARE','REFERRAL-TASK-SHARE:'||NEW.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id',v_treasury_id,'side','debit','amount_units',v_share_units),
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

DROP TRIGGER IF EXISTS trg_referral_task_share_after_approval ON public.task_submissions;
CREATE TRIGGER trg_referral_task_share_after_approval
AFTER UPDATE OF status,reward_transaction_id ON public.task_submissions
FOR EACH ROW WHEN (NEW.status='approved' AND NEW.reward_transaction_id IS NOT NULL)
EXECUTE FUNCTION public.process_referral_task_share();

CREATE OR REPLACE FUNCTION public.settle_pending_referral_task_shares()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r record; v_wallet_id uuid; v_treasury_id uuid; v_treasury_balance bigint;
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
    SELECT id,balance_units INTO v_treasury_id,v_treasury_balance
      FROM public.financial_accounts WHERE account_code='PLATFORM-TREASURY'
      AND account_type='treasury' AND status='active' FOR UPDATE;
    IF v_wallet_id IS NULL OR v_treasury_id IS NULL OR v_treasury_balance<r.amount_units THEN
      CONTINUE;
    END IF;
    v_tx_id:=public.post_ledger_transaction('REFERRAL_TASK_SHARE',r.idempotency_key,
      jsonb_build_array(
        jsonb_build_object('account_id',v_treasury_id,'side','debit','amount_units',r.amount_units),
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

REVOKE ALL ON FUNCTION public.process_referral_task_share() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_pending_referral_task_shares() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pending_referral_task_shares() TO service_role;
