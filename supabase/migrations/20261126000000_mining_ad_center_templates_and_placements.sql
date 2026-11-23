-- ==============================================================================
-- Migration: Mining Ad Center Placements & Sandboxed Templates (Extended Formats)
-- Date: 2026-11-26
-- Strictly Non-Financial:
--   - Does NOT touch yt_coin.*, wallets, financial_accounts, ledger_transactions,
--     ledger_entries, ad_partners, clixwall_*, offerwall_gg_*, or auth tables.
--   - Does NOT modify YT Coin rewards or balances.
--   - Seeds ONLY structural placement slots (0 dummy/test ads).
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Mining Ad Placements Registry (Admin-controlled & extensible slots)
CREATE TABLE IF NOT EXISTS public.mining_ad_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL,
  description_ar TEXT,
  page_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (page_scope IN (
      'all',
      'mining_home',
      'mining_tasks',
      'banner_ads',
      'recommendation_ads',
      'video_ads',
      'link_ads',
      'mixed_ads',
      'push_notifications',
      'ad_templates',
      'ads_history'
    )),
  slot_type TEXT NOT NULL DEFAULT 'banner'
    CHECK (slot_type IN (
      'banner',
      'between_tasks',
      'horizontal_strip',
      'video',
      'image',
      'link',
      'mixed',
      'recommendation',
      'sticky',
      'native',
      'push',
      'popunder',
      'extensible'
    )),
  default_width INTEGER NOT NULL DEFAULT 728 CHECK (default_width >= 100 AND default_width <= 1400),
  default_height INTEGER NOT NULL DEFAULT 90 CHECK (default_height >= 50 AND default_height <= 900),
  max_ads INTEGER NOT NULL DEFAULT 3 CHECK (max_ads >= 1 AND max_ads <= 20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mining_ad_placements_active
  ON public.mining_ad_placements(is_active, sort_order, created_at);

-- 2. Mining Ad Templates Registry (Supports HTML, JS, VAST XML, Banner, Recommendation, Multi-Format, Links, Push)
CREATE TABLE IF NOT EXISTS public.mining_ad_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  placement_key TEXT NOT NULL REFERENCES public.mining_ad_placements(placement_key)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  template_type TEXT NOT NULL
    CHECK (template_type IN (
      'html',
      'javascript',
      'external_link',
      'video_player',
      'vast_url',
      'image_banner',
      'recommendation_widget',
      'network_code',
      'multi_format',
      'push_notification',
      'mixed'
    )),
  ad_format TEXT NOT NULL DEFAULT 'banner'
    CHECK (ad_format IN (
      'banner',
      'popunder',
      'instant_message',
      'sticky_banner',
      'desktop_interstitial',
      'mobile_banner',
      'mobile_sticky_banner',
      'mobile_interstitial',
      'instream_video',
      'invideo_banner',
      'video_slider',
      'outstream_video',
      'vertical_video',
      'recommendation_widget',
      'native_cards',
      'push_notification',
      'multi_format',
      'external_link'
    )),
  device_target TEXT NOT NULL DEFAULT 'all'
    CHECK (device_target IN ('all', 'desktop', 'mobile')),
  source_name TEXT NOT NULL DEFAULT '',
  code_content TEXT NOT NULL DEFAULT '',
  target_url TEXT,
  media_url TEXT,
  vast_url TEXT,
  cta_label TEXT,
  width INTEGER NOT NULL DEFAULT 320 CHECK (width >= 100 AND width <= 1400),
  height INTEGER NOT NULL DEFAULT 250 CHECK (height >= 50 AND height <= 900),
  priority INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  max_impressions INTEGER NOT NULL DEFAULT 0 CHECK (max_impressions >= 0),
  impressions_count INTEGER NOT NULL DEFAULT 0 CHECK (impressions_count >= 0),
  yt_network_key TEXT,
  reward_event_type TEXT CHECK (reward_event_type IS NULL OR reward_event_type IN ('view', 'click')),
  is_dismissible BOOLEAN NOT NULL DEFAULT true,
  tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mining_ad_templates_lookup
  ON public.mining_ad_templates(placement_key, is_active, device_target, ad_format, sort_order, priority DESC);

-- 3. Row-Level Security & Grants
GRANT SELECT ON public.mining_ad_placements TO anon, authenticated;
GRANT SELECT ON public.mining_ad_placements TO anon, authenticated;
GRANT ALL ON public.mining_ad_placements TO authenticated, service_role;

GRANT SELECT ON public.mining_ad_templates TO anon, authenticated;
GRANT SELECT ON public.mining_ad_templates TO anon, authenticated;
GRANT ALL ON public.mining_ad_templates TO authenticated, service_role;

ALTER TABLE public.mining_ad_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_ad_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mining ad placements public read active" ON public.mining_ad_placements;
CREATE POLICY "Mining ad placements public read active"
  ON public.mining_ad_placements
  FOR SELECT
  USING (is_active = true OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Mining ad placements admin write" ON public.mining_ad_placements;
CREATE POLICY "Mining ad placements admin write"
  ON public.mining_ad_placements
  FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Mining ad templates public read active" ON public.mining_ad_templates;
CREATE POLICY "Mining ad templates public read active"
  ON public.mining_ad_templates
  FOR SELECT
  USING (
    (
      is_active = true
      AND (max_impressions = 0 OR impressions_count < max_impressions)
      AND EXISTS (
        SELECT 1 FROM public.mining_ad_placements p
        WHERE p.placement_key = mining_ad_templates.placement_key AND p.is_active = true
      )
    )
    OR public.is_admin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "Mining ad templates admin write" ON public.mining_ad_templates;
CREATE POLICY "Mining ad templates admin write"
  ON public.mining_ad_templates
  FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- 4. Non-Financial Impression Counter RPC (Never grants YT Coin or YER rewards)
CREATE OR REPLACE FUNCTION public.increment_mining_ad_impression(p_template_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.mining_ad_templates t
  SET impressions_count = t.impressions_count + 1,
      updated_at = timezone('utc'::text, now())
  FROM public.mining_ad_placements p
  WHERE t.id = p_template_id
    AND t.placement_key = p.placement_key
    AND p.is_active = true
    AND t.is_active = true
    AND (t.max_impressions = 0 OR t.impressions_count < t.max_impressions)
  RETURNING t.impressions_count INTO v_new_count;

  RETURN COALESCE(v_new_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_mining_ad_impression(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_mining_ad_impression(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_mining_ad_impression(UUID) TO service_role;

-- 5. Seed ONLY Structural Ad Placements (Zero dummy or test ads in mining_ad_templates)
INSERT INTO public.mining_ad_placements (
  placement_key, title_ar, description_ar, page_scope, slot_type, default_width, default_height, max_ads, sort_order, is_active, is_system
)
VALUES
  ('mining_top_banner', 'بانر أعلى صفحة التعدين', 'بانر أفقي مدمج أعلى منطقة منجم YT Coin بدون إعاقة النقر', 'mining_home', 'banner', 728, 90, 2, 10, true, true),
  ('mining_recommendation_intro', 'توصيات إعلانية أسفل المقدمة (Recommendation Widget)', 'وحدة توصيات أصلية خفيفة أسفل مقدمة التعدين', 'mining_home', 'recommendation', 728, 180, 2, 15, true, true),
  ('mining_arena_below', 'مساحة وسط الصفحة (تحت منجم التعدين)', 'مساحة متوسطة الأبعاد بين لوحة التعدين وإحصائيات المنصة', 'mining_home', 'mixed', 320, 120, 2, 20, true, true),
  ('mining_between_cards_strip', 'شريط إعلاني أفقي بين البطاقات', 'شريط إعلاني مرن يظهر بين بطاقات المعدلات والسقف اليومي', 'all', 'horizontal_strip', 728, 90, 3, 30, true, true),
  ('mining_between_tasks_1', 'نافذة إعلانية بين مهمات التعدين (1)', 'وحدة إعلانية تظهر بين صفوف مهمات التعدين اليومية', 'mining_tasks', 'between_tasks', 320, 120, 2, 40, true, true),
  ('mining_between_tasks_2', 'نافذة إعلانية بين مهمات التعدين (2)', 'وحدة إعلانية ثانوية أسفل قائمة المهمات', 'mining_tasks', 'between_tasks', 728, 90, 2, 50, true, true),
  ('mining_video_primary', 'مساحة إعلانات الفيديو الرئيسية (VAST / Video)', 'مشغل إعلانات الفيديو (In-Stream / Outstream) مع تتبع أحداث VAST', 'video_ads', 'video', 640, 360, 4, 60, true, true),
  ('mining_video_mid', 'مساحة فيديو وسط الصفحة (Video Slider)', 'مساحة متجاوبة لمقاطع الفيديو الإعلانية الجانبية والمتوسطة', 'video_ads', 'video', 480, 270, 3, 65, true, true),
  ('mining_video_secondary', 'مساحة إعلانات الفيديو الإضافية', 'وحدات فيديو ثانوية أو إعلانات مرافقة لقسم الفيديو', 'video_ads', 'video', 320, 240, 4, 70, true, true),
  ('mining_mobile_vertical', 'مساحة عمودية مخصصة للهواتف (Vertical / Mobile)', 'وحدة عمودية متوافقة مع شاشات الجوال فقط', 'all', 'sticky', 320, 480, 2, 75, true, true),
  ('mining_links_featured', 'مساحة إعلانات الروابط المميزة', 'إعلانات الروابط الخارجية مع تسجيل الخروج والعودة والتحقق الخادمي', 'link_ads', 'link', 728, 110, 6, 80, true, true),
  ('mining_banner_gallery', 'معرض البانرات (Web & Mobile Banners)', 'عرض منظم لإعلانات البانر الثابتة والمخصصة حسب نوع الجهاز', 'banner_ads', 'banner', 728, 90, 6, 85, true, true),
  ('mining_image_gallery', 'مساحات الإعلانات المصورة والبانرات', 'شبكة بانرات وصور إعلانية متجاوبة مع الهواتف', 'mixed_ads', 'image', 320, 250, 6, 90, true, true),
  ('mining_mixed_grid', 'مساحة الإعلانات المختلطة (Multi Format)', 'أكواد HTML وJavaScript وشبكات Multi Format المتكيفة', 'mixed_ads', 'mixed', 320, 250, 6, 100, true, true),
  ('mining_mid_banner', 'بانر وسط الصفحات الفرعية', 'بانر متوسط الصفحة داخل أقسام مركز الإعلانات', 'all', 'banner', 728, 90, 3, 110, true, true),
  ('mining_sticky_bottom', 'بانر لاصق صغير قابل للإغلاق (Sticky Banner)', 'شريط إعلاني صغير قابل للإغلاق باحترام التبريد دون إعاقة الأزرار', 'all', 'sticky', 320, 60, 1, 115, true, true),
  ('mining_bottom_banner', 'مساحة إعلانية أسفل مركز التعدين', 'بانر ختامي أسفل الصفحة متوافق مع شاشات الجوال', 'all', 'extensible', 728, 90, 3, 120, true, true)
ON CONFLICT (placement_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
