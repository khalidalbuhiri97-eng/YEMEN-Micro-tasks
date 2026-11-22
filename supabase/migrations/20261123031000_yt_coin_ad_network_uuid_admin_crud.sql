-- Stable UUID identifiers for YT Coin ad networks and admin CRUD compatibility.
BEGIN;
ALTER TABLE yt_coin.ad_networks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
UPDATE yt_coin.ad_networks SET id=gen_random_uuid() WHERE id IS NULL;
ALTER TABLE yt_coin.ad_networks ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS yt_coin_ad_networks_id_uidx ON yt_coin.ad_networks(id);
CREATE OR REPLACE FUNCTION public.get_yt_coin_ad_center()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_cfg yt_coin.config%ROWTYPE; v_today date:=(now() AT TIME ZONE 'Asia/Aden')::date;
  v_count integer:=0; v_total bigint:=0; v_networks jsonb:='[]'::jsonb; v_events jsonb:='[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_cfg FROM yt_coin.config WHERE singleton=true;
  SELECT count(*) INTO v_count FROM yt_coin.ad_events WHERE user_id=v_uid AND verified=true
    AND (received_at AT TIME ZONE 'Asia/Aden')::date=v_today;
  SELECT COALESCE(sum(reward_parts),0) INTO v_total FROM yt_coin.ad_reward_claims WHERE user_id=v_uid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',n.id,'networkKey',n.network_key,'displayName',n.display_name,'description',NULL,
    'adType',n.ad_type,'placementUrl',n.placement_url,'secretEnvKey',n.secret_env_key,
    'rewardClickUnits',n.reward_click_units,'rewardClickYt',round(n.reward_click_units::numeric/1000,3),
    'rewardViewUnits',n.reward_view_units,'rewardViewYt',round(n.reward_view_units::numeric/1000,3),
    'dailyUserLimit',n.daily_user_limit,'isActive',n.is_active
  ) ORDER BY n.created_at),'[]'::jsonb) INTO v_networks FROM yt_coin.ad_networks n WHERE n.is_active=true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',e.id,'networkKey',e.network_key,'externalEventId',e.provider_event_id,'eventType',e.event_type,
    'amountUnits',COALESCE(c.reward_parts,e.amount_units,0),
    'amountYt',round(COALESCE(c.reward_parts,e.amount_units,0)::numeric/1000,3),
    'verificationSource',COALESCE(e.verification_source,'verified_postback'),'createdAt',e.received_at
  ) ORDER BY e.received_at DESC),'[]'::jsonb) INTO v_events
  FROM (SELECT * FROM yt_coin.ad_events WHERE user_id=v_uid AND verified=true ORDER BY received_at DESC LIMIT 30) e
  LEFT JOIN yt_coin.ad_reward_claims c ON c.event_id=e.id;
  RETURN jsonb_build_object('unitScale',1000,
    'adClickRewardUnits',COALESCE(v_cfg.ad_click_reward_units,10),
    'adClickRewardYt',round(COALESCE(v_cfg.ad_click_reward_units,10)::numeric/1000,3),
    'adViewRewardUnits',COALESCE(v_cfg.ad_view_reward_units,10),
    'adViewRewardYt',round(COALESCE(v_cfg.ad_view_reward_units,10)::numeric/1000,3),
    'dailyAdLimit',COALESCE(v_cfg.daily_ad_limit,20),'adsToday',v_count,
    'totalAdEarnedUnits',v_total,'totalAdEarnedYt',round(v_total::numeric/1000,3),
    'networks',v_networks,'recentEvents',v_events);
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
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_net FROM yt_coin.ad_networks WHERE network_key=lower(trim(COALESCE(p_network_key,'')));
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'id',v_net.id,'networkKey',v_net.network_key,
    'displayName',v_net.display_name,'authMode',v_net.auth_mode,'secretEnvKey',v_net.secret_env_key,
    'adType',v_net.ad_type,'rewardClickUnits',v_net.reward_click_units,
    'rewardViewUnits',v_net.reward_view_units,'dailyUserLimit',v_net.daily_user_limit,'isActive',v_net.is_active);
END;
$function$


CREATE OR REPLACE FUNCTION public.admin_manage_yt_coin_ad_network(p_action text, p_id uuid DEFAULT NULL::uuid, p_network_key text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_auth_mode text DEFAULT 'hmac_sha256'::text, p_secret_env_key text DEFAULT 'YT_COIN_AD_POSTBACK_SECRET'::text, p_placement_url text DEFAULT NULL::text, p_ad_type text DEFAULT 'both'::text, p_reward_click_units bigint DEFAULT 10, p_reward_view_units bigint DEFAULT 10, p_daily_user_limit integer DEFAULT 20, p_is_active boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_key text:=lower(trim(COALESCE(p_network_key,'')));
  v_row yt_coin.ad_networks%ROWTYPE; v_action text:=lower(trim(COALESCE(p_action,'')));
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Admin privileges required' USING ERRCODE='42501'; END IF;
  IF v_action='upsert' THEN
    IF v_key !~ '^[a-z0-9_-]{2,48}$' OR trim(COALESCE(p_display_name,''))='' THEN RAISE EXCEPTION 'Invalid network key or display name'; END IF;
    IF p_auth_mode NOT IN ('hmac_sha256','shared_secret') OR p_ad_type NOT IN ('view','click','both') THEN RAISE EXCEPTION 'Invalid network authentication or ad type'; END IF;
    IF p_reward_click_units<1 OR p_reward_view_units<1 OR p_daily_user_limit<0 THEN RAISE EXCEPTION 'Invalid ad reward limits'; END IF;
    IF p_id IS NOT NULL THEN
      UPDATE yt_coin.ad_networks SET network_key=v_key,display_name=trim(p_display_name),
        auth_mode=p_auth_mode,secret_env_key=COALESCE(NULLIF(trim(p_secret_env_key),''),'YT_COIN_AD_POSTBACK_SECRET'),
        placement_url=NULLIF(trim(COALESCE(p_placement_url,'')),''),ad_type=p_ad_type,
        reward_click_units=p_reward_click_units,reward_view_units=p_reward_view_units,
        daily_user_limit=p_daily_user_limit,is_active=COALESCE(p_is_active,false),
        enabled=COALESCE(p_is_active,false),updated_at=now()
      WHERE id=p_id RETURNING * INTO v_row;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ad network not found'; END IF;
    ELSE
      INSERT INTO yt_coin.ad_networks(network_key,display_name,enabled,verification_mode,auth_mode,
        secret_env_key,placement_url,ad_type,reward_click_units,reward_view_units,daily_user_limit,is_active,updated_at)
      VALUES(v_key,trim(p_display_name),COALESCE(p_is_active,false),'server_postback',p_auth_mode,
        COALESCE(NULLIF(trim(p_secret_env_key),''),'YT_COIN_AD_POSTBACK_SECRET'),
        NULLIF(trim(COALESCE(p_placement_url,'')),''),p_ad_type,p_reward_click_units,p_reward_view_units,
        p_daily_user_limit,COALESCE(p_is_active,false),now())
      ON CONFLICT(network_key) DO UPDATE SET display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,
        auth_mode=EXCLUDED.auth_mode,secret_env_key=EXCLUDED.secret_env_key,placement_url=EXCLUDED.placement_url,
        ad_type=EXCLUDED.ad_type,reward_click_units=EXCLUDED.reward_click_units,
        reward_view_units=EXCLUDED.reward_view_units,daily_user_limit=EXCLUDED.daily_user_limit,
        is_active=EXCLUDED.is_active,updated_at=now()
      RETURNING * INTO v_row;
    END IF;
    INSERT INTO yt_coin.audit_log(actor_id,action,entity_type,entity_id,details)
    VALUES(v_uid,'admin_upsert_ad_network','ad_network',v_row.id::text,
      jsonb_build_object('networkKey',v_row.network_key,'isActive',v_row.is_active,
        'clickUnits',v_row.reward_click_units,'viewUnits',v_row.reward_view_units));
    RETURN jsonb_build_object('id',v_row.id,'networkKey',v_row.network_key,'displayName',v_row.display_name,
      'isActive',v_row.is_active,'placementUrl',v_row.placement_url,'adType',v_row.ad_type);
  ELSIF v_action='delete' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'Ad network id required'; END IF;
    SELECT * INTO v_row FROM yt_coin.ad_networks WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('deleted',false,'message','الشبكة غير موجودة.'); END IF;
    IF EXISTS(SELECT 1 FROM yt_coin.ad_events WHERE network_key=v_row.network_key) THEN
      UPDATE yt_coin.ad_networks SET enabled=false,is_active=false,updated_at=now() WHERE id=p_id;
      RETURN jsonb_build_object('deactivated',true,'id',p_id,'networkKey',v_row.network_key);
    END IF;
    DELETE FROM yt_coin.ad_networks WHERE id=p_id;
    RETURN jsonb_build_object('deleted',true,'id',p_id);
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;
END;
$function$

NOTIFY pgrst,'reload schema';
COMMIT;
