-- Activate the new ExoClick VAST video zone without changing the existing 6104150 zone.
INSERT INTO public.mining_ad_templates (
  title, placement_key, template_type, ad_format, device_target, source_name,
  code_content, target_url, media_url, vast_url, cta_label, width, height,
  priority, sort_order, max_impressions, impressions_count, yt_network_key,
  reward_event_type, is_dismissible, tracking_enabled, is_active
)
SELECT
  'YemenTask_ExoClick_Video_VAST_6107774',
  'mining_video_primary',
  'vast_url',
  'instream_video',
  'all',
  'ExoClick',
  '',
  '',
  NULL,
  'https://s.magsrv.com/v1/vast.php?idz=6107774',
  NULL,
  640,
  360,
  21,
  11,
  0,
  0,
  NULL,
  NULL,
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.mining_ad_templates
  WHERE vast_url = 'https://s.magsrv.com/v1/vast.php?idz=6107774'
     OR title = 'YemenTask_ExoClick_Video_VAST_6107774'
);

UPDATE public.mining_ad_templates
SET placement_key = 'mining_video_primary',
    template_type = 'vast_url',
    ad_format = 'instream_video',
    source_name = 'ExoClick',
    vast_url = 'https://s.magsrv.com/v1/vast.php?idz=6107774',
    width = 640,
    height = 360,
    tracking_enabled = true,
    is_active = true,
    updated_at = timezone('utc'::text, now())
WHERE title = 'YemenTask_ExoClick_Video_VAST_6107774'
   OR vast_url = 'https://s.magsrv.com/v1/vast.php?idz=6107774';

INSERT INTO public.ad_completion_rules (
  template_id, ad_format, tracking_enabled, verification_mode, required_watch_sec,
  require_active_visibility, required_vast_events, require_link_return,
  require_server_postback, session_ttl_sec, max_daily_per_user, frequency_cap_minutes
)
SELECT
  t.id,
  t.ad_format,
  true,
  'vast',
  30,
  true,
  ARRAY['start','complete']::TEXT[],
  false,
  false,
  900,
  20,
  0
FROM public.mining_ad_templates t
WHERE t.vast_url = 'https://s.magsrv.com/v1/vast.php?idz=6107774'
  AND NOT EXISTS (
    SELECT 1 FROM public.ad_completion_rules r WHERE r.template_id = t.id
  );

NOTIFY pgrst, 'reload schema';
