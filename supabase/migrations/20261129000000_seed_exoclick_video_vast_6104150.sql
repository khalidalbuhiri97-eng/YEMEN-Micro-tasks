-- ==============================================================================
-- Migration: Seed ExoClick Video VAST Zone 6104150 (YemenTask_Video_VAST_6104150)
-- Date: 2026-11-29
-- Prepared ONLY — DO NOT execute automatically on production without review.
-- Uses ONLY existing tables: public.mining_ad_placements, public.mining_ad_templates,
-- and public.ad_completion_rules.
-- ==============================================================================

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
  'mining_video_primary',
  'مساحة إعلانات الفيديو الرئيسية (VAST / Video)',
  'مشغل إعلانات الفيديو (In-Stream / Outstream) مع تتبع أحداث VAST',
  'video_ads',
  'video',
  640,
  360,
  4,
  60,
  true,
  true
)
ON CONFLICT (placement_key) DO NOTHING;

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
  'YemenTask_Video_VAST_6104150',
  'mining_video_primary',
  'vast_url',
  'instream_video',
  'all',
  'ExoClick',
  '',
  NULL,
  NULL,
  'https://s.magsrv.com/v1/vast.php?idz=6104150',
  NULL,
  640,
  360,
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
  WHERE vast_url LIKE '%6104150%'
     OR title = 'YemenTask_Video_VAST_6104150'
);

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
  frequency_cap_minutes
)
SELECT
  t.id,
  t.ad_format,
  true,
  'vast',
  30,
  true,
  ARRAY['start', 'complete']::TEXT[],
  false,
  false,
  900,
  20,
  0
FROM public.mining_ad_templates t
WHERE t.vast_url LIKE '%6104150%'
  AND NOT EXISTS (
    SELECT 1 FROM public.ad_completion_rules r WHERE r.template_id = t.id
  );

NOTIFY pgrst, 'reload schema';
