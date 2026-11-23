-- ==============================================================================
-- Migration: Ad Tracking, Server-Side Verification, Anti-Fraud & Comfort Policy
-- Date: 2026-11-27
-- Strictly Non-Financial / Additive Layer:
--   - Does NOT create any parallel currency, wallet, or balance ledger.
--   - Does NOT alter YT Coin precision, reward rates, balances, or financial tables.
--   - Links cleanly to yt_coin.ad_sessions & yt_coin.ad_reward_claims only via UUIDs.
--   - Requires explicit user review & approval before executing on live Supabase.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Global UX Comfort & Ad Density Settings (Singleton Row id = 1)
CREATE TABLE IF NOT EXISTS public.ad_center_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  popunder_auto_disabled BOOLEAN NOT NULL DEFAULT true,
  max_sticky_ads INTEGER NOT NULL DEFAULT 1 CHECK (max_sticky_ads >= 0 AND max_sticky_ads <= 2),
  max_animated_ads_in_view INTEGER NOT NULL DEFAULT 1 CHECK (max_animated_ads_in_view >= 0 AND max_animated_ads_in_view <= 3),
  cooldown_after_dismiss_sec INTEGER NOT NULL DEFAULT 120 CHECK (cooldown_after_dismiss_sec >= 0 AND cooldown_after_dismiss_sec <= 86400),
  min_spacing_px INTEGER NOT NULL DEFAULT 16 CHECK (min_spacing_px >= 8 AND min_spacing_px <= 96),
  push_ads_enabled BOOLEAN NOT NULL DEFAULT false,
  default_session_ttl_sec INTEGER NOT NULL DEFAULT 900 CHECK (default_session_ttl_sec >= 60 AND default_session_ttl_sec <= 7200),
  default_max_daily_per_user INTEGER NOT NULL DEFAULT 25 CHECK (default_max_daily_per_user >= 0 AND default_max_daily_per_user <= 500),
  tracking_enabled_by_format JSONB NOT NULL DEFAULT '{
    "banner": true,
    "popunder": false,
    "instant_message": true,
    "sticky_banner": true,
    "desktop_interstitial": true,
    "mobile_banner": true,
    "mobile_sticky_banner": true,
    "mobile_interstitial": true,
    "instream_video": true,
    "invideo_banner": true,
    "video_slider": true,
    "outstream_video": true,
    "vertical_video": true,
    "recommendation_widget": true,
    "native_cards": true,
    "push_notification": false,
    "multi_format": true,
    "external_link": true
  }'::jsonb,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.ad_center_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Per-Template / Per-Format Verification & Dwell Completion Rules
CREATE TABLE IF NOT EXISTS public.ad_completion_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID UNIQUE REFERENCES public.mining_ad_templates(id) ON DELETE CASCADE,
  ad_format TEXT,
  tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  verification_mode TEXT NOT NULL DEFAULT 'dwell'
    CHECK (verification_mode IN ('dwell', 'vast', 'link_return', 's2s_postback', 'impression_only')),
  required_watch_sec INTEGER NOT NULL DEFAULT 15 CHECK (required_watch_sec >= 0 AND required_watch_sec <= 600),
  require_active_visibility BOOLEAN NOT NULL DEFAULT true,
  required_vast_events TEXT[] NOT NULL DEFAULT ARRAY['start', 'complete']::TEXT[],
  require_link_return BOOLEAN NOT NULL DEFAULT false,
  require_server_postback BOOLEAN NOT NULL DEFAULT false,
  session_ttl_sec INTEGER NOT NULL DEFAULT 900 CHECK (session_ttl_sec >= 60 AND session_ttl_sec <= 7200),
  max_daily_per_user INTEGER NOT NULL DEFAULT 20 CHECK (max_daily_per_user >= 0 AND max_daily_per_user <= 500),
  frequency_cap_minutes INTEGER NOT NULL DEFAULT 0 CHECK (frequency_cap_minutes >= 0 AND frequency_cap_minutes <= 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_completion_rules_format_default
  ON public.ad_completion_rules(ad_format)
  WHERE template_id IS NULL AND ad_format IS NOT NULL;

-- 3. Server-Side Ad Tracking Sessions (Never trusted from client clocks alone)
CREATE TABLE IF NOT EXISTS public.ad_tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.mining_ad_templates(id) ON DELETE CASCADE,
  placement_key TEXT NOT NULL,
  network_key TEXT,
  ad_format TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'mobile' CHECK (device_type IN ('desktop', 'mobile')),
  verification_mode TEXT NOT NULL DEFAULT 'dwell'
    CHECK (verification_mode IN ('dwell', 'vast', 'link_return', 's2s_postback', 'impression_only')),
  required_watch_sec INTEGER NOT NULL DEFAULT 15 CHECK (required_watch_sec >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  active_duration_sec NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (active_duration_sec >= 0),
  exit_at TIMESTAMPTZ,
  return_at TIMESTAMPTZ,
  vast_milestones TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  session_status TEXT NOT NULL DEFAULT 'started'
    CHECK (session_status IN ('started', 'active', 'left_to_external', 'returned', 'completed', 'rejected', 'expired')),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'flagged')),
  eligibility_result TEXT NOT NULL DEFAULT 'pending'
    CHECK (eligibility_result IN ('pending', 'eligible_tracking_only', 'eligible_for_yt_reward', 'credited', 'rejected')),
  rejection_reason TEXT,
  yt_ad_session_id UUID,
  yt_reward_claim_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  client_fingerprint_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_tracking_sessions_unique_yt_claim
  ON public.ad_tracking_sessions(yt_reward_claim_id)
  WHERE yt_reward_claim_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_tracking_sessions_user_lookup
  ON public.ad_tracking_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_tracking_sessions_analytics
  ON public.ad_tracking_sessions(ad_format, network_key, session_status, created_at DESC);

-- 4. Immutable Append-Only Event Telemetry Ledger
CREATE TABLE IF NOT EXISTS public.ad_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ad_tracking_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.mining_ad_templates(id) ON DELETE CASCADE,
  network_key TEXT,
  ad_format TEXT NOT NULL,
  event_name TEXT NOT NULL
    CHECK (event_name IN (
      'impression',
      'view_start',
      'heartbeat',
      'visibility_hidden',
      'visibility_visible',
      'vast_impression',
      'vast_start',
      'vast_firstQuartile',
      'vast_midpoint',
      'vast_thirdQuartile',
      'vast_complete',
      'vast_clickThrough',
      'vast_error',
      'click',
      'external_open',
      'external_return',
      'dismiss',
      'complete_attempt',
      'complete_verified',
      'complete_rejected',
      'reward_approved',
      'reward_rejected',
      'error'
    )),
  client_elapsed_sec NUMERIC(10, 2) NOT NULL DEFAULT 0,
  server_delta_sec NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ad_tracking_events_session
  ON public.ad_tracking_events(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ad_tracking_events_metrics
  ON public.ad_tracking_events(event_name, ad_format, created_at DESC);

-- 5. Inbound Provider Postbacks Audit Table (Replay-Protected)
CREATE TABLE IF NOT EXISTS public.ad_provider_postbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_key TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  tracking_session_id UUID REFERENCES public.ad_tracking_sessions(id) ON DELETE SET NULL,
  yt_ad_session_id UUID,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'credited', 'duplicate', 'rejected')),
  rejection_reason TEXT,
  sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (network_key, provider_event_id)
);

-- 6. Anti-Fraud Anomaly & Risk Flags Telemetry
CREATE TABLE IF NOT EXISTS public.ad_tracking_risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.ad_tracking_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.mining_ad_templates(id) ON DELETE SET NULL,
  flag_type TEXT NOT NULL
    CHECK (flag_type IN (
      'premature_complete',
      'visibility_bypass',
      'duplicate_complete',
      'forged_template_id',
      'rate_limit_exceeded',
      'expired_session',
      'invalid_vast_sequence',
      'duplicate_postback',
      'velocity_anomaly'
    )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ad_tracking_risk_flags_lookup
  ON public.ad_tracking_risk_flags(flag_type, severity, created_at DESC);

-- 7. Explicit Promotional Push Notification Opt-In Preferences (Non-Financial)
CREATE TABLE IF NOT EXISTS public.push_ad_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  opted_in BOOLEAN NOT NULL DEFAULT false,
  frequency_per_day INTEGER NOT NULL DEFAULT 2 CHECK (frequency_per_day >= 0 AND frequency_per_day <= 10),
  opted_in_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. Row-Level Security & Strict Least-Privilege Grants
ALTER TABLE public.ad_center_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_completion_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_provider_postbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_tracking_risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_ad_preferences ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ad_center_settings TO anon, authenticated;
GRANT SELECT ON public.ad_center_settings TO anon, authenticated;
GRANT ALL ON public.ad_center_settings TO service_role;

GRANT SELECT ON public.ad_completion_rules TO anon, authenticated;
GRANT SELECT ON public.ad_completion_rules TO anon, authenticated;
GRANT ALL ON public.ad_completion_rules TO service_role;

GRANT SELECT ON public.ad_tracking_sessions TO authenticated;
GRANT ALL ON public.ad_tracking_sessions TO service_role;

GRANT SELECT ON public.ad_tracking_events TO authenticated;
GRANT ALL ON public.ad_tracking_events TO service_role;

GRANT SELECT ON public.ad_provider_postbacks TO authenticated;
GRANT ALL ON public.ad_provider_postbacks TO service_role;

GRANT SELECT ON public.ad_tracking_risk_flags TO authenticated;
GRANT ALL ON public.ad_tracking_risk_flags TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.push_ad_preferences TO authenticated;
GRANT ALL ON public.push_ad_preferences TO service_role;

-- Settings policies
DROP POLICY IF EXISTS "Ad center settings public read" ON public.ad_center_settings;
CREATE POLICY "Ad center settings public read"
  ON public.ad_center_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Ad center settings admin write" ON public.ad_center_settings;
CREATE POLICY "Ad center settings admin write"
  ON public.ad_center_settings FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- Completion rules policies
DROP POLICY IF EXISTS "Ad completion rules public read" ON public.ad_completion_rules;
CREATE POLICY "Ad completion rules public read"
  ON public.ad_completion_rules FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Ad completion rules admin write" ON public.ad_completion_rules;
CREATE POLICY "Ad completion rules admin write"
  ON public.ad_completion_rules FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- Tracking sessions: users can ONLY read their own; writes ONLY via server service_role
DROP POLICY IF EXISTS "Ad tracking sessions user read own" ON public.ad_tracking_sessions;
CREATE POLICY "Ad tracking sessions user read own"
  ON public.ad_tracking_sessions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin() OR auth.role() = 'service_role');

-- Tracking events: users can ONLY read their own; append-only writes ONLY via server service_role
DROP POLICY IF EXISTS "Ad tracking events user read own" ON public.ad_tracking_events;
CREATE POLICY "Ad tracking events user read own"
  ON public.ad_tracking_events FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin() OR auth.role() = 'service_role');

-- Postbacks & risk flags: Admin or service_role ONLY
DROP POLICY IF EXISTS "Ad postbacks admin read" ON public.ad_provider_postbacks;
CREATE POLICY "Ad postbacks admin read"
  ON public.ad_provider_postbacks FOR SELECT
  USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Ad risk flags admin read" ON public.ad_tracking_risk_flags;
CREATE POLICY "Ad risk flags admin read"
  ON public.ad_tracking_risk_flags FOR SELECT
  USING (public.is_admin() OR auth.role() = 'service_role');

-- Push ad preferences: each user owns their explicit consent toggle
DROP POLICY IF EXISTS "Push ad prefs user own" ON public.push_ad_preferences;
CREATE POLICY "Push ad prefs user own"
  ON public.push_ad_preferences FOR ALL
  USING (user_id = auth.uid() OR public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (user_id = auth.uid() OR public.is_admin() OR auth.role() = 'service_role');

-- 9. Log Retention Cleanup Helper (Admin / Cron Only)
CREATE OR REPLACE FUNCTION public.prune_old_ad_tracking_logs(p_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin or service_role required';
  END IF;

  DELETE FROM public.ad_tracking_sessions
  WHERE created_at < timezone('utc'::text, now()) - make_interval(days => LEAST(3650, GREATEST(7, COALESCE(p_days, 90))))
    AND yt_reward_claim_id IS NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_old_ad_tracking_logs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_old_ad_tracking_logs(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
