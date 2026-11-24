-- Taska Coin public branding remains separate from yt_* database identifiers.
-- Wallet pay_id remains BIGINT for RPC compatibility and is displayed as TSK-XXXXXX.
DO $fee$
DECLARE v text;
BEGIN
  SELECT pg_get_functiondef('public.yt_send_pay(bigint,numeric,text,text)'::regprocedure) INTO v;
  v := replace(v, 'amount::numeric*0.05', 'amount::numeric*0.03');
  v := replace(v, '5% manager fee returned to sender-manager', '3% network transfer fee');
  v := replace(v, '5% manager fee credited to recipient-manager', '3% network transfer fee');
  v := replace(v, '5% manager fee', '3% network transfer fee');
  v := replace(v, $old$'fee_percent',5$old$, $new$'fee_percent',3$new$);
  EXECUTE v;
END
$fee$;

ALTER TABLE public.yt_system_settings
  DROP CONSTRAINT IF EXISTS yt_system_settings_transfer_fee_bps_check;
ALTER TABLE public.yt_system_settings
  ADD CONSTRAINT yt_system_settings_transfer_fee_bps_check
  CHECK (transfer_fee_bps BETWEEN 0 AND 10000);

UPDATE public.yt_system_settings
SET transfer_fee_bps = 300,
    admin_user_id = (SELECT id FROM auth.users WHERE lower(email) = 'khalidalbuhiri@gmail.com' LIMIT 1),
    updated_at = now()
WHERE singleton = true;

CREATE OR REPLACE FUNCTION public.yt_resolve_pay_recipient(p_identifier text)
RETURNS TABLE(pay_id bigint, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_lookup text := upper(trim(coalesce(p_identifier,'')));
  v_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_lookup ~ '^TSK-[0-9]{6}$' THEN
    SELECT w.user_id INTO v_user
    FROM public.yt_wallets w
    WHERE w.pay_id = substring(v_lookup from 5)::bigint
      AND w.wallet_status = 'active' AND NOT w.is_frozen;
  ELSIF position('@' in p_identifier) > 1 THEN
    SELECT u.id INTO v_user
    FROM auth.users u
    JOIN public.yt_wallets w ON w.user_id = u.id
    WHERE lower(u.email) = lower(trim(p_identifier))
      AND w.wallet_status = 'active' AND NOT w.is_frozen
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'INVALID_RECIPIENT_IDENTIFIER';
  END IF;
  IF v_user IS NULL OR v_user = auth.uid() THEN RAISE EXCEPTION 'RECIPIENT_NOT_FOUND'; END IF;
  RETURN QUERY
  SELECT w.pay_id, coalesce(nullif(trim(p.full_name),''),'مستخدم')
  FROM public.yt_wallets w
  LEFT JOIN public.profiles p ON p.id = w.user_id
  WHERE w.user_id = v_user;
END;
$function$;
REVOKE ALL ON FUNCTION public.yt_resolve_pay_recipient(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yt_resolve_pay_recipient(text) TO authenticated;

DO $cap$
DECLARE v text;
BEGIN
  SELECT pg_get_functiondef('public.yt_verify_and_complete_link(text)'::regprocedure) INTO v;
  v := replace(
    v,
    'reward:=a.reward_units;',
    'reward:=a.reward_units; IF coalesce((SELECT sum(c.reward_units) FROM public.yt_user_ad_claims c WHERE c.user_id=u AND c.claimed_date=d),0)+reward>200000 THEN RAISE EXCEPTION ''DAILY_MINING_CAP_REACHED''; END IF;'
  );
  IF position('DAILY_MINING_CAP_REACHED' in v) = 0 THEN
    RAISE EXCEPTION 'Could not add daily mining cap';
  END IF;
  EXECUTE v;
END
$cap$;

REVOKE ALL ON FUNCTION public.yt_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yt_is_admin() TO authenticated;
