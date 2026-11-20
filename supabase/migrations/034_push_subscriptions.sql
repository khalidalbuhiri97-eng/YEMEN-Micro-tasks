-- ==============================================================================
-- Migration 034: Web Push Subscriptions Table (Non-Financial)
-- Yemen Task (كسب اليمن)
-- Strictly Non-Financial: Stores per-user Web Push endpoints only.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON public.push_subscriptions(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated, service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Push subscriptions user manage own" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions user manage own" ON public.push_subscriptions
    FOR ALL
    USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');
