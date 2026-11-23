-- ==============================================================================
-- Migration: Activate ExoClick Zone 6104102 (YemenTask_Website_Banner)
--            with Professional Server-Side 30s Tracking & Anti-Tampering Rules
-- Date: 2026-11-30
-- Strictly Isolated to Ad Center & Tracking Tables Only:
--   - Uses ONLY public.mining_ad_placements, public.mining_ad_templates,
--     and public.ad_completion_rules.
--   - Zero reward network linkage (yt_network_key = NULL, reward_event_type = NULL, require_server_postback = false).
--   - Idempotent: safe to re-run cleanly.
-- ==============================================================================

-- 1. Ensure target banner gallery placement is present & active
INSERT INTO public.mining_ad_placements (
  placement_key,
  title_ar,
  description_ar,
  page_scope,
  slot_type,
  default_width,
  default_height,
  max_ads,
  sort_order,
  is_active,
  is_system
)
VALUES (
  'mining_banner_gallery',
  'معرض البانرات (Web & Mobile Banners)',
  'عرض منظم لإعلانات البانر الثابتة والمخصصة حسب نوع الجهاز',
  'banner_ads',
  'banner',
  728,
  90,
  6,
  85,
  true,
  true
)
ON CONFLICT (placement_key) DO UPDATE
SET is_active = true,
    updated_at = NOW();

-- 2. Activate & sync ExoClick Zone 6104102 template (exact script tag, tracking enabled, zero YT Coin linkage)
INSERT INTO public.mining_ad_templates (
  title,
  placement_key,
  template_type,
  ad_format,
  device_target,
  source_name,
  code_content,
  target_url,
  media_url,
  vast_url,
  cta_label,
  width,
  height,
  priority,
  sort_order,
  max_impressions,
  impressions_count,
  yt_network_key,
  reward_event_type,
  is_dismissible,
  tracking_enabled,
  is_active
)
SELECT
  'YemenTask_Website_Banner',
  'mining_banner_gallery',
  'network_code',
  'banner',
  'all',
  'ExoClick',
  '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
<ins class="eas6a97888e2" data-zoneid="6104102"></ins>
<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>',
  NULL,
  NULL,
  NULL,
  NULL,
  300,
  250,
  20,
  10,
  0,
  0,
  NULL,
  NULL,
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.mining_ad_templates
  WHERE code_content LIKE '%6104102%'
     OR title = 'YemenTask_Website_Banner'
);

UPDATE public.mining_ad_templates
SET
  source_name = 'ExoClick',
  template_type = 'network_code',
  ad_format = 'banner',
  code_content = '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
<ins class="eas6a97888e2" data-zoneid="6104102"></ins>
<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>',
  width = 300,
  height = 250,
  yt_network_key = NULL,
  reward_event_type = NULL,
  tracking_enabled = true,
  is_active = true,
  updated_at = NOW()
WHERE code_content LIKE '%6104102%'
   OR title = 'YemenTask_Website_Banner';

-- 3. Upsert strict 30-second server dwell, visibility & anti-duplicate rule for Zone 6104102
INSERT INTO public.ad_completion_rules (
  template_id,
  ad_format,
  tracking_enabled,
  verification_mode,
  required_watch_sec,
  require_active_visibility,
  required_vast_events,
  require_link_return,
  require_server_postback,
  session_ttl_sec,
  max_daily_per_user,
  frequency_cap_minutes,
  updated_at
)
SELECT
  t.id,
  t.ad_format,
  true,
  'dwell',
  30,
  true,
  ARRAY[]::TEXT[],
  false,
  false,
  900,
  25,
  5,
  NOW()
FROM public.mining_ad_templates t
WHERE t.code_content LIKE '%6104102%'
   OR t.title = 'YemenTask_Website_Banner'
ON CONFLICT (template_id) DO UPDATE
SET
  ad_format = EXCLUDED.ad_format,
  tracking_enabled = true,
  verification_mode = 'dwell',
  required_watch_sec = 30,
  require_active_visibility = true,
  required_vast_events = ARRAY[]::TEXT[],
  require_link_return = false,
  require_server_postback = false,
  session_ttl_sec = 900,
  max_daily_per_user = 25,
  frequency_cap_minutes = 5,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
