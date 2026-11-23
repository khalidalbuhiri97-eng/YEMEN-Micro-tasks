-- Disable promotional ad push delivery; keep ordinary app notifications unchanged.
-- This setting is consumed by the mining ads center only.
UPDATE public.ad_center_settings
SET push_ads_enabled = false,
    tracking_enabled_by_format = jsonb_set(
      COALESCE(tracking_enabled_by_format, '{}'::jsonb),
      '{push_notification}',
      'false'::jsonb,
      true
    ),
    updated_at = timezone('utc'::text, now())
WHERE id = 1;
