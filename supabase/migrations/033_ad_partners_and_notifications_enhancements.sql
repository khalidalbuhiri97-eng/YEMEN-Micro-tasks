-- ==============================================================================
-- Migration 033: Isolated Ad Partners Registry & Notifications Enhancements
-- Yemen Task (كسب اليمن)
-- Strictly Non-Financial: Does not alter wallets, balances, ledger, or ClixWall.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ad Partners Table (for isolated sandboxed ad slots controlled by Owner Admin)
CREATE TABLE IF NOT EXISTS public.ad_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_name TEXT NOT NULL,
    placement_key TEXT NOT NULL DEFAULT 'home_clixwall_slot',
    code_type TEXT NOT NULL DEFAULT 'html' CHECK (code_type IN ('html', 'javascript', 'iframe')),
    code TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 300 CHECK (width >= 100 AND width <= 1200),
    height INTEGER NOT NULL DEFAULT 250 CHECK (height >= 50 AND height <= 800),
    rotation_mode TEXT NOT NULL DEFAULT 'rotate' CHECK (rotation_mode IN ('single', 'rotate')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ad_partners_active_placement
    ON public.ad_partners(placement_key, is_active, sort_order, created_at DESC);

GRANT SELECT ON public.ad_partners TO anon, authenticated;
GRANT ALL ON public.ad_partners TO authenticated, service_role;

ALTER TABLE public.ad_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ad partners public read active" ON public.ad_partners;
CREATE POLICY "Ad partners public read active" ON public.ad_partners
    FOR SELECT
    USING (is_active = true OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Ad partners admin write" ON public.ad_partners;
CREATE POLICY "Ad partners admin write" ON public.ad_partners
    FOR ALL
    USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- 2. Notifications Query Performance & Safe User Read/Update RLS
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON public.notifications(user_id, created_at DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Notifications user select" ON public.notifications;
        CREATE POLICY "Notifications user select" ON public.notifications
            FOR SELECT
            USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

        DROP POLICY IF EXISTS "Notifications user update read" ON public.notifications;
        CREATE POLICY "Notifications user update read" ON public.notifications
            FOR UPDATE
            USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role')
            WITH CHECK (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');
    END IF;
END $$;
