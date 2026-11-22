-- YT Coin wallet, transfers and verified-ad RPC alignment.
-- No YT balances or YER wallets/financial ledgers are reset or modified by this migration.

BEGIN;
ALTER TABLE yt_coin.ad_networks
  ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'hmac_sha256',
  ADD COLUMN IF NOT EXISTS secret_env_key text NOT NULL DEFAULT 'YT_COIN_AD_POSTBACK_SECRET',
  ADD COLUMN IF NOT EXISTS placement_url text,
  ADD COLUMN IF NOT EXISTS ad_type text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS reward_click_units bigint NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reward_view_units bigint NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS daily_user_limit integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;
UPDATE yt_coin.ad_networks SET is_active=enabled WHERE is_active IS DISTINCT FROM enabled;
ALTER TABLE yt_coin.ad_events
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS amount_units bigint,
  ADD COLUMN IF NOT EXISTS verification_source text;
CREATE TABLE IF NOT EXISTS yt_coin.ad_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  network_key text NOT NULL REFERENCES yt_coin.ad_networks(network_key) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN ('click','view')),
  status text NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','credited','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT(now()+interval '30 minutes')
);
CREATE INDEX IF NOT EXISTS idx_yt_coin_ad_sessions_user ON yt_coin.ad_sessions(user_id,created_at DESC);
ALTER TABLE yt_coin.ad_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yt_coin.ad_sessions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION yt_coin.claim_tap_mining(p_taps integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Aden')::date;
  v_taps integer := COALESCE(p_taps,1);
  v_taps_today integer := 0;
  v_reward bigint := 0;
  v_daily_paid bigint := 0;
  v_cap bigint := 0;
  v_total_mined bigint := 0;
  v_reserve bigint := 0;
  v_tx uuid;
  v_reference text;
  v_balance bigint;
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF v_taps < 1 OR v_taps > 200 THEN
    RETURN jsonb_build_object('success',false,'status','invalid_taps','message','عدد النقرات يجب أن يكون بين 1 و200.');
  END IF;

  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton=true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled THEN
    RETURN jsonb_build_object('success',false,'status','not_launched','message','التعدين متوقف حالياً.');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_uid AND p.account_status='active') THEN
    RETURN jsonb_build_object('success',false,'status','not_eligible','message','الحساب غير نشط.');
  END IF;

  INSERT INTO yt_coin.accounts(user_id) VALUES(v_uid) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id=v_uid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM yt_coin.accounts WHERE user_id=v_uid AND wallet_status<>'active') THEN
    RETURN jsonb_build_object('success',false,'status','wallet_unavailable','message','محفظة YT Coin مجمدة أو مغلقة.');
  END IF;

  INSERT INTO yt_coin.daily_user_taps(user_id,tap_date,tap_count,paid_units)
  VALUES(v_uid,v_today,0,0) ON CONFLICT(user_id,tap_date) DO NOTHING;
  SELECT tap_count INTO v_taps_today FROM yt_coin.daily_user_taps
  WHERE user_id=v_uid AND tap_date=v_today FOR UPDATE;

  v_limit := COALESCE(v_cfg.daily_tap_limit,1000);
  IF v_limit>0 THEN
    IF v_taps_today>=v_limit THEN
      RETURN jsonb_build_object('success',false,'status','daily_tap_limit_reached','tapsToday',v_taps_today,'dailyTapLimit',v_limit,'dailyTapsRemaining',0);
    END IF;
    v_taps := LEAST(v_taps,v_limit-v_taps_today);
  END IF;

  v_reward := v_taps::bigint * COALESCE(v_cfg.tap_reward_units,10);
  v_cap := LEAST(
    COALESCE(v_cfg.daily_global_cap_max_units,10000000),
    COALESCE(v_cfg.daily_global_cap_units,1000000)
      + GREATEST(0,(v_today-COALESCE(v_cfg.mining_start_date,v_today))::bigint)
        * COALESCE(v_cfg.daily_global_cap_increment_units,0)
  );

  INSERT INTO yt_coin.daily_mining_totals(claim_date,paid_units,claim_count)
  VALUES(v_today,0,0) ON CONFLICT(claim_date) DO NOTHING;
  SELECT paid_units INTO v_daily_paid FROM yt_coin.daily_mining_totals
  WHERE claim_date=v_today FOR UPDATE;
  IF v_daily_paid+v_reward>v_cap THEN
    RETURN jsonb_build_object('success',false,'status','daily_cap_reached','dailyCapUnits',v_cap,'dailyPaidUnits',v_daily_paid);
  END IF;

  SELECT COALESCE(sum(amount_units),0) INTO v_total_mined
  FROM yt_coin.ledger
  WHERE metadata->>'unit_system'='yt_parts_v3'
    AND event_type='mining_reward';
  IF v_total_mined+v_reward>COALESCE(v_cfg.max_supply_units,100000000000) THEN
    RETURN jsonb_build_object('success',false,'status','max_supply_reached');
  END IF;

  SELECT balance_units INTO v_reserve FROM yt_coin.system_treasury
  WHERE treasury_key='YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_reserve,0)<v_reward THEN
    RETURN jsonb_build_object('success',false,'status','treasury_insufficient');
  END IF;

  v_reference := 'YT-TAP:'||v_uid::text||':'||gen_random_uuid()::text;
  INSERT INTO yt_coin.journal_transactions(transaction_type,reference,user_id,metadata)
  VALUES('tap_reward',v_reference,v_uid,jsonb_build_object('taps',v_taps,'reward_parts',v_reward,'unit_scale',1000))
  RETURNING id INTO v_tx;

  UPDATE yt_coin.system_treasury SET balance_units=balance_units-v_reward,updated_at=now()
  WHERE treasury_key='YT-REWARDS-TREASURY';
  UPDATE yt_coin.accounts SET balance_units=balance_units+v_reward,
    lifetime_earned_units=lifetime_earned_units+v_reward,updated_at=now()
  WHERE user_id=v_uid RETURNING balance_units INTO v_balance;
  UPDATE yt_coin.allocations SET spent_units=LEAST(allocated_units,spent_units+v_reward),updated_at=now()
  WHERE allocation_key='mining_rewards';

  INSERT INTO yt_coin.journal_entries(transaction_id,account_code,user_id,amount_parts)
  VALUES(v_tx,'REWARDS_RESERVE',NULL,-v_reward),(v_tx,'USER_WALLET',v_uid,v_reward);

  INSERT INTO yt_coin.ledger(user_id,event_type,amount_units,reference,allocation_key,metadata)
  VALUES(v_uid,'mining_reward',v_reward,v_reference,'mining_rewards',
    jsonb_build_object('unit_system','yt_parts_v3','parts_per_yt',1000,'reward_yt',v_reward::numeric/1000,'tap_count',v_taps));

  UPDATE yt_coin.daily_user_taps SET tap_count=tap_count+v_taps,paid_units=paid_units+v_reward,updated_at=now()
  WHERE user_id=v_uid AND tap_date=v_today;
  UPDATE yt_coin.daily_mining_totals SET paid_units=paid_units+v_reward,claim_count=claim_count+1,updated_at=now()
  WHERE claim_date=v_today;

  INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
  VALUES(v_uid,'tap_reward_claim','journal_transaction',v_tx::text,
    jsonb_build_object('taps',v_taps,'reward_parts',v_reward,'unit_scale',1000));

  RETURN jsonb_build_object('success',true,'status','credited','unitScale',1000,
    'tapsCredited',v_taps,'rewardUnits',v_reward,'rewardYt',round(v_reward::numeric/1000,3),
    'balanceUnits',v_balance,'tapsToday',v_taps_today+v_taps,'dailyTapLimit',v_limit,
    'dailyTapsRemaining',CASE WHEN v_limit<=0 THEN NULL ELSE GREATEST(v_limit-(v_taps_today+v_taps),0) END);
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_my_yt_coin_taps(p_taps integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  RETURN yt_coin.claim_tap_mining(p_taps);
END;
$function$


CREATE OR REPLACE FUNCTION public.lookup_yt_coin_wallet(p_wallet_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_wallet_user uuid;
  v_name text;
  v_status text;
  v_address text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  v_address := lower(trim(COALESCE(p_wallet_address,'')));
  IF v_address !~ '^yt1[0-9a-f]{32}$' THEN RETURN jsonb_build_object('found',false); END IF;
  v_address := 'yt1'||substring(v_address from 4);
  SELECT a.user_id,p.full_name,a.wallet_status INTO v_wallet_user,v_name,v_status
  FROM yt_coin.accounts a JOIN public.profiles p ON p.id=a.user_id
  WHERE ('yt1'||replace(a.user_id::text,'-',''))=v_address;
  IF NOT FOUND OR v_status<>'active' THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'walletAddress',v_address,'ownerName',COALESCE(v_name,'مستخدم YT Coin'),'status',v_status);
END;
$function$


CREATE OR REPLACE FUNCTION public.transfer_yt_coin(p_recipient_address text, p_amount_units bigint, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_recipient uuid;
  v_key text;
  v_result jsonb;
  v_transfer_id uuid;
  v_reference text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_amount_units IS NULL OR p_amount_units<1 THEN
    RETURN jsonb_build_object('success',false,'message','الحد الأدنى للتحويل هو 0.001 YT.');
  END IF;
  SELECT a.user_id INTO v_recipient
  FROM yt_coin.accounts a
  JOIN public.profiles p ON p.id=a.user_id AND p.account_status='active'
  WHERE lower('yt1'||replace(a.user_id::text,'-',''))=lower(trim(COALESCE(p_recipient_address,'')))
    AND a.wallet_status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','عنوان محفظة YT Coin غير موجود أو غير نشط.'); END IF;
  IF v_recipient=v_uid THEN RETURN jsonb_build_object('success',false,'message','لا يمكنك التحويل إلى محفظتك نفسها.'); END IF;

  v_key:='api-'||gen_random_uuid()::text;
  v_result:=yt_coin.transfer_parts(v_recipient,p_amount_units,v_key);
  IF COALESCE((v_result->>'success')::boolean,false)
     AND p_note IS NOT NULL AND length(trim(p_note))>0 THEN
    v_transfer_id:=(v_result->>'transfer_id')::uuid;
    SELECT reference INTO v_reference FROM yt_coin.transfers WHERE id=v_transfer_id;
    UPDATE yt_coin.journal_transactions
      SET metadata=metadata||jsonb_build_object('note',left(trim(p_note),240))
      WHERE reference=v_reference;
  END IF;
  RETURN v_result;
END;
$function$


CREATE OR REPLACE FUNCTION public.get_yt_coin_ad_center()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_cfg yt_coin.config%ROWTYPE;
  v_today date:=(now() AT TIME ZONE 'Asia/Aden')::date;
  v_count integer:=0;
  v_total bigint:=0;
  v_networks jsonb:='[]'::jsonb;
  v_events jsonb:='[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton=true;
  SELECT count(*) INTO v_count FROM yt_coin.ad_events
    WHERE user_id=v_uid AND verified=true AND (received_at AT TIME ZONE 'Asia/Aden')::date=v_today;
  SELECT COALESCE(sum(reward_parts),0) INTO v_total FROM yt_coin.ad_reward_claims WHERE user_id=v_uid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',n.network_key,'networkKey',n.network_key,'displayName',n.display_name,
    'description',NULL,'adType',n.ad_type,'placementUrl',n.placement_url,
    'secretEnvKey',n.secret_env_key,'rewardClickUnits',n.reward_click_units,
    'rewardClickYt',round(n.reward_click_units::numeric/1000,3),
    'rewardViewUnits',n.reward_view_units,'rewardViewYt',round(n.reward_view_units::numeric/1000,3),
    'dailyUserLimit',n.daily_user_limit,'isActive',n.is_active
  ) ORDER BY n.created_at),'[]'::jsonb) INTO v_networks
  FROM yt_coin.ad_networks n WHERE n.is_active=true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',e.id,'networkKey',e.network_key,'externalEventId',e.provider_event_id,
    'eventType',e.event_type,'amountUnits',COALESCE(c.reward_parts,e.amount_units,0),
    'amountYt',round(COALESCE(c.reward_parts,e.amount_units,0)::numeric/1000,3),
    'verificationSource',COALESCE(e.verification_source,'verified_postback'),'createdAt',e.received_at
  ) ORDER BY e.received_at DESC),'[]'::jsonb) INTO v_events
  FROM (
    SELECT * FROM yt_coin.ad_events WHERE user_id=v_uid AND verified=true
    ORDER BY received_at DESC LIMIT 30
  ) e
  LEFT JOIN yt_coin.ad_reward_claims c ON c.event_id=e.id;
  RETURN jsonb_build_object(
    'unitScale',1000,
    'adClickRewardUnits',COALESCE(v_cfg.ad_click_reward_units,10),
    'adClickRewardYt',round(COALESCE(v_cfg.ad_click_reward_units,10)::numeric/1000,3),
    'adViewRewardUnits',COALESCE(v_cfg.ad_view_reward_units,10),
    'adViewRewardYt',round(COALESCE(v_cfg.ad_view_reward_units,10)::numeric/1000,3),
    'dailyAdLimit',COALESCE(v_cfg.daily_ad_limit,20),
    'adsToday',v_count,'totalAdEarnedUnits',v_total,
    'totalAdEarnedYt',round(v_total::numeric/1000,3),
    'networks',v_networks,'recentEvents',v_events
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.create_yt_coin_ad_session(p_network_key text, p_event_type text DEFAULT 'view'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_net yt_coin.ad_networks%ROWTYPE;
  v_session uuid;
  v_type text:=lower(trim(COALESCE(p_event_type,'view')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF v_type NOT IN ('click','view') THEN RETURN jsonb_build_object('success',false,'message','نوع الإعلان غير صالح.'); END IF;
  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key=lower(trim(COALESCE(p_network_key,''))) AND is_active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الشبكة الإعلانية غير مفعلة.'); END IF;
  IF (v_type='click' AND v_net.ad_type NOT IN ('click','both'))
     OR (v_type='view' AND v_net.ad_type NOT IN ('view','both')) THEN
    RETURN jsonb_build_object('success',false,'message','نوع الإعلان غير مدعوم لهذه الشبكة.');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_uid AND p.account_status='active') THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  INSERT INTO yt_coin.ad_sessions(user_id,network_key,event_type)
  VALUES(v_uid,v_net.network_key,v_type) RETURNING id INTO v_session;
  RETURN jsonb_build_object('success',true,'sessionId',v_session,'userId',v_uid,
    'networkKey',v_net.network_key,'eventType',v_type,'placementUrl',v_net.placement_url);
END;
$function$


CREATE OR REPLACE FUNCTION public.service_get_yt_coin_ad_network(p_network_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_net yt_coin.ad_networks%ROWTYPE;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_net FROM yt_coin.ad_networks
  WHERE network_key=lower(trim(COALESCE(p_network_key,'')));
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'id',v_net.network_key,
    'networkKey',v_net.network_key,'displayName',v_net.display_name,
    'authMode',v_net.auth_mode,'secretEnvKey',v_net.secret_env_key,
    'adType',v_net.ad_type,'rewardClickUnits',v_net.reward_click_units,
    'rewardViewUnits',v_net.reward_view_units,'dailyUserLimit',v_net.daily_user_limit,
    'isActive',v_net.is_active);
END;
$function$


CREATE OR REPLACE FUNCTION public.service_credit_yt_coin_verified_ad(p_network_key text, p_external_event_id text, p_user_id uuid, p_event_type text, p_session_id uuid DEFAULT NULL::uuid, p_verification_source text DEFAULT 's2s_postback'::text, p_raw_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_net yt_coin.ad_networks%ROWTYPE;
  v_cfg yt_coin.config%ROWTYPE;
  v_type text:=lower(trim(COALESCE(p_event_type,'view')));
  v_today date:=(now() AT TIME ZONE 'Asia/Aden')::date;
  v_reward bigint;
  v_count integer;
  v_event uuid;
  v_tx uuid;
  v_balance bigint;
  v_reserve bigint;
  v_reference text;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS NULL OR trim(COALESCE(p_external_event_id,''))='' OR length(p_external_event_id)>128 OR v_type NOT IN ('click','view') THEN
    RETURN jsonb_build_object('success',false,'status','invalid_payload');
  END IF;
  IF EXISTS(SELECT 1 FROM yt_coin.ad_events WHERE network_key=lower(trim(p_network_key)) AND provider_event_id=trim(p_external_event_id)) THEN
    RETURN jsonb_build_object('success',true,'status','duplicate');
  END IF;
  SELECT * INTO v_net FROM yt_coin.ad_networks WHERE network_key=lower(trim(p_network_key)) AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'status','network_inactive'); END IF;
  IF (v_type='click' AND v_net.ad_type NOT IN ('click','both')) OR (v_type='view' AND v_net.ad_type NOT IN ('view','both')) THEN
    RETURN jsonb_build_object('success',false,'status','event_type_not_allowed');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND account_status='active') THEN
    RETURN jsonb_build_object('success',false,'status','user_not_active');
  END IF;
  IF p_session_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM yt_coin.ad_sessions s WHERE s.id=p_session_id AND s.user_id=p_user_id
      AND s.network_key=v_net.network_key AND s.event_type=v_type AND s.status='initiated' AND s.expires_at>now()
  ) THEN RETURN jsonb_build_object('success',false,'status','invalid_or_expired_session'); END IF;
  SELECT count(*) INTO v_count FROM yt_coin.ad_events WHERE user_id=p_user_id AND verified=true
    AND (received_at AT TIME ZONE 'Asia/Aden')::date=v_today;
  IF COALESCE(v_net.daily_user_limit,0)>0 AND
    (SELECT count(*) FROM yt_coin.ad_events WHERE user_id=p_user_id AND network_key=v_net.network_key
      AND verified=true AND (received_at AT TIME ZONE 'Asia/Aden')::date=v_today)>=v_net.daily_user_limit THEN
    RETURN jsonb_build_object('success',false,'status','daily_network_limit');
  END IF;
  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton=true FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.mining_enabled THEN RETURN jsonb_build_object('success',false,'status','rewards_disabled'); END IF;
  IF COALESCE(v_cfg.daily_ad_limit,0)>0 AND v_count>=v_cfg.daily_ad_limit THEN RETURN jsonb_build_object('success',false,'status','daily_global_limit'); END IF;
  v_reward:=CASE WHEN v_type='click' THEN v_net.reward_click_units ELSE v_net.reward_view_units END;
  SELECT balance_units INTO v_reserve FROM yt_coin.system_treasury WHERE treasury_key='YT-REWARDS-TREASURY' FOR UPDATE;
  IF COALESCE(v_reserve,0)<v_reward THEN RETURN jsonb_build_object('success',false,'status','treasury_insufficient'); END IF;

  INSERT INTO yt_coin.accounts(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM yt_coin.accounts WHERE user_id=p_user_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM yt_coin.accounts WHERE user_id=p_user_id AND wallet_status<>'active') THEN
    RETURN jsonb_build_object('success',false,'status','wallet_unavailable');
  END IF;

  INSERT INTO yt_coin.ad_events(network_key,provider_event_id,user_id,event_type,verified,payload,session_id,amount_units,verification_source)
  VALUES(v_net.network_key,trim(p_external_event_id),p_user_id,v_type,true,COALESCE(p_raw_metadata,'{}'::jsonb),
    p_session_id,v_reward,COALESCE(p_verification_source,'s2s_postback')) RETURNING id INTO v_event;
  v_reference:='YT-AD:'||v_net.network_key||':'||trim(p_external_event_id);
  INSERT INTO yt_coin.journal_transactions(transaction_type,reference,user_id,metadata)
  VALUES('verified_ad_reward',v_reference,p_user_id,jsonb_build_object('network_key',v_net.network_key,'event_type',v_type,'reward_parts',v_reward))
  RETURNING id INTO v_tx;
  INSERT INTO yt_coin.journal_entries(transaction_id,account_code,user_id,amount_parts)
  VALUES(v_tx,'REWARDS_RESERVE',NULL,-v_reward),(v_tx,'USER_WALLET',p_user_id,v_reward);
  INSERT INTO yt_coin.ad_reward_claims(event_id,user_id,reward_parts,journal_transaction_id)
  VALUES(v_event,p_user_id,v_reward,v_tx);
  UPDATE yt_coin.system_treasury SET balance_units=balance_units-v_reward,updated_at=now() WHERE treasury_key='YT-REWARDS-TREASURY';
  UPDATE yt_coin.accounts SET balance_units=balance_units+v_reward,lifetime_earned_units=lifetime_earned_units+v_reward,updated_at=now()
    WHERE user_id=p_user_id RETURNING balance_units INTO v_balance;
  INSERT INTO yt_coin.daily_mining_totals(claim_date,paid_units,claim_count) VALUES(v_today,v_reward,1)
  ON CONFLICT(claim_date) DO UPDATE SET paid_units=yt_coin.daily_mining_totals.paid_units+EXCLUDED.paid_units,
    claim_count=yt_coin.daily_mining_totals.claim_count+1,updated_at=now();
  IF p_session_id IS NOT NULL THEN UPDATE yt_coin.ad_sessions SET status='credited' WHERE id=p_session_id AND user_id=p_user_id; END IF;
  INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
  VALUES(p_user_id,'verified_ad_reward','ad_event',v_event::text,jsonb_build_object('network',v_net.network_key,'event',v_type,'reward_parts',v_reward));
  RETURN jsonb_build_object('success',true,'status','credited','eventId',v_event,'amountUnits',v_reward,
    'rewardYt',round(v_reward::numeric/1000,3),'newBalanceUnits',v_balance);
END;
$function$


CREATE OR REPLACE FUNCTION public.admin_manage_yt_coin_ad_network(p_action text, p_id uuid DEFAULT NULL::uuid, p_network_key text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_auth_mode text DEFAULT 'hmac_sha256'::text, p_secret_env_key text DEFAULT 'YT_COIN_AD_POSTBACK_SECRET'::text, p_placement_url text DEFAULT NULL::text, p_ad_type text DEFAULT 'both'::text, p_reward_click_units bigint DEFAULT 10, p_reward_view_units bigint DEFAULT 10, p_daily_user_limit integer DEFAULT 20, p_is_active boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_key text:=lower(trim(COALESCE(p_network_key,'')));
  v_row yt_coin.ad_networks%ROWTYPE;
  v_action text:=lower(trim(COALESCE(p_action,'')));
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Admin privileges required' USING ERRCODE='42501'; END IF;
  IF v_action='upsert' THEN
    IF v_key !~ '^[a-z0-9_-]{2,48}$' OR trim(COALESCE(p_display_name,''))='' THEN
      RAISE EXCEPTION 'Invalid network key or display name';
    END IF;
    IF p_auth_mode NOT IN ('hmac_sha256','shared_secret') OR p_ad_type NOT IN ('view','click','both') THEN
      RAISE EXCEPTION 'Invalid network authentication or ad type';
    END IF;
    IF p_reward_click_units<1 OR p_reward_view_units<1 OR p_daily_user_limit<0 THEN
      RAISE EXCEPTION 'Invalid ad reward limits';
    END IF;
    INSERT INTO yt_coin.ad_networks(network_key,display_name,enabled,verification_mode,
      auth_mode,secret_env_key,placement_url,ad_type,reward_click_units,reward_view_units,
      daily_user_limit,is_active,updated_at)
    VALUES(v_key,trim(p_display_name),COALESCE(p_is_active,false),'server_postback',
      p_auth_mode,COALESCE(NULLIF(trim(p_secret_env_key),''),'YT_COIN_AD_POSTBACK_SECRET'),
      NULLIF(trim(COALESCE(p_placement_url,'')),''),p_ad_type,p_reward_click_units,
      p_reward_view_units,p_daily_user_limit,COALESCE(p_is_active,false),now())
    ON CONFLICT(network_key) DO UPDATE SET
      display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,
      auth_mode=EXCLUDED.auth_mode,secret_env_key=EXCLUDED.secret_env_key,
      placement_url=EXCLUDED.placement_url,ad_type=EXCLUDED.ad_type,
      reward_click_units=EXCLUDED.reward_click_units,reward_view_units=EXCLUDED.reward_view_units,
      daily_user_limit=EXCLUDED.daily_user_limit,is_active=EXCLUDED.is_active,updated_at=now()
    RETURNING * INTO v_row;
    INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
    VALUES(v_uid,'admin_upsert_ad_network','ad_network',v_key,
      jsonb_build_object('isActive',v_row.is_active,'clickUnits',v_row.reward_click_units,'viewUnits',v_row.reward_view_units));
    RETURN jsonb_build_object('networkKey',v_row.network_key,'displayName',v_row.display_name,
      'isActive',v_row.is_active,'placementUrl',v_row.placement_url,'adType',v_row.ad_type);
  ELSIF v_action='delete' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'Network key id required'; END IF;
    UPDATE yt_coin.ad_networks SET enabled=false,is_active=false,updated_at=now()
    WHERE network_key=p_network_key RETURNING * INTO v_row;
    RETURN jsonb_build_object('deactivated',FOUND,'networkKey',p_network_key);
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;
END;
$function$


REVOKE ALL ON FUNCTION yt_coin.claim_tap_mining(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION yt_coin.claim_tap_mining(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_my_yt_coin_taps(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_my_yt_coin_taps(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_yt_coin_wallet(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lookup_yt_coin_wallet(text) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_yt_coin(text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_yt_coin(text,bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_yt_coin_ad_center() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_yt_coin_ad_center() TO authenticated;
REVOKE ALL ON FUNCTION public.create_yt_coin_ad_session(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_yt_coin_ad_session(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.service_get_yt_coin_ad_network(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_yt_coin_ad_network(text) TO service_role;
REVOKE ALL ON FUNCTION public.service_credit_yt_coin_verified_ad(text,text,uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_credit_yt_coin_verified_ad(text,text,uuid,text,uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_manage_yt_coin_ad_network(text,uuid,text,text,text,text,text,text,text,bigint,bigint,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_yt_coin_ad_network(text,uuid,text,text,text,text,text,text,text,bigint,bigint,integer,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
