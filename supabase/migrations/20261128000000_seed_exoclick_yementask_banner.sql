-- ==============================================================================
-- Migration: Seed ExoClick Display Banner Zone 6104102 (YemenTask_Website_Banner)
-- Date: 2026-11-28
-- Prepared ONLY — DO NOT execute automatically on production without review.
-- Strictly Non-Financial & Separated from Tasks / YT Coin Rewards:
--   - Uses ONLY public.mining_ad_placements & public.mining_ad_templates.
--   - yt_network_key = NULL, reward_event_type = NULL, tracking_enabled = false.
--   - Idempotent: guarded by ON CONFLICT & NOT EXISTS (zoneid 6104102 / title).
-- ==============================================================================

-- 1. Ensure target placement exists cleanly without overwriting admin customizations
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
ON CONFLICT (placement_key) DO NOTHING;

-- 2. Seed ExoClick YemenTask_Website_Banner (Zone 6104102, 300x250) cleanly without duplicates
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
  false,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.mining_ad_templates
  WHERE code_content LIKE '%6104102%'
     OR title = 'YemenTask_Website_Banner'
);

NOTIFY pgrst, 'reload schema';
