-- ==============================================================================
-- Migration 021: Advertiser Identity Preferences & External Campaign Attribution
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Purpose:
--   1. Allow advertisers to optionally display their name & logo or hide their
--      identity from workers (displayed publicly as "معلن عبر يمن تاسك").
--   2. Retain real advertiser_id & real identity for Admin oversight.
--   3. Mark linked worker tasks explicitly as external campaigns
--      (is_external_campaign = true) so they are never shown as platform-funded.
-- NOTE: Prepared for controlled deployment; NOT executed on live DB.
-- ==============================================================================

DO $$
BEGIN
    IF to_regclass('public.campaigns') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'hide_advertiser_name'
        ) THEN
            ALTER TABLE public.campaigns
            ADD COLUMN hide_advertiser_name BOOLEAN NOT NULL DEFAULT false;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'advertiser_display_name'
        ) THEN
            ALTER TABLE public.campaigns
            ADD COLUMN advertiser_display_name TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'advertiser_logo_url'
        ) THEN
            ALTER TABLE public.campaigns
            ADD COLUMN advertiser_logo_url TEXT;
        END IF;
    END IF;

    IF to_regclass('public.tasks') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'is_external_campaign'
        ) THEN
            ALTER TABLE public.tasks
            ADD COLUMN is_external_campaign BOOLEAN NOT NULL DEFAULT false;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'hide_advertiser_name'
        ) THEN
            ALTER TABLE public.tasks
            ADD COLUMN hide_advertiser_name BOOLEAN NOT NULL DEFAULT false;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'advertiser_display_name'
        ) THEN
            ALTER TABLE public.tasks
            ADD COLUMN advertiser_display_name TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'advertiser_logo_url'
        ) THEN
            ALTER TABLE public.tasks
            ADD COLUMN advertiser_logo_url TEXT;
        END IF;

        -- Backfill existing campaign-linked tasks as external campaigns safely
        UPDATE public.tasks
        SET is_external_campaign = true
        WHERE campaign_id IS NOT NULL AND is_external_campaign = false;
    END IF;
END $$;
