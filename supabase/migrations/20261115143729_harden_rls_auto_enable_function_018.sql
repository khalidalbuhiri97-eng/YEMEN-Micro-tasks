-- Migration 018: prevent public API roles from invoking the RLS event-trigger helper.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
