-- ExoClick Zone 6104102: mining-only banner template.
-- No application-wide ad placement, no YT Coin reward, no wallet/ledger changes.
-- Kept inactive until the provider's compliance review is approved.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.mining_ad_templates
    WHERE lower(coalesce(source_name, '')) = 'exoclick'
      AND code_content ILIKE '%data-zoneid="6104102"%'
  ) THEN
    INSERT INTO public.mining_ad_templates (
      title,
      placement_key,
      template_type,
      ad_format,
      device_target,
      source_name,
      code_content,
      width,
      height,
      priority,
      sort_order,
      max_impressions,
      yt_network_key,
      reward_event_type,
      is_dismissible,
      tracking_enabled,
      is_active
    )
    SELECT
      'YemenTask_Website_Banner',
      p.placement_key,
      'network_code',
      'banner',
      'all',
      'ExoClick',
      '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
<ins class="eas6a97888e2" data-zoneid="6104102"></ins>
<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>',
      300,
      250,
      20,
      10,
      0,
      NULL,
      NULL,
      true,
      false,
      false
    FROM public.mining_ad_placements p
    WHERE p.placement_key = 'mining_banner_gallery'
      AND p.is_active = true;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
