-- ============================================================================
-- Migration: Real Supabase Auth Email Verification Sync to public.profiles
-- Non-destructive & idempotent. Does NOT alter wallets, ledgers, or balances.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

-- Backfill existing confirmed users directly from auth.users
UPDATE public.profiles p
SET
  email_verified = (u.email_confirmed_at IS NOT NULL),
  email_verified_at = u.email_confirmed_at
FROM auth.users u
WHERE u.id = p.id
  AND (
    p.email_verified IS DISTINCT FROM (u.email_confirmed_at IS NOT NULL)
    OR p.email_verified_at IS DISTINCT FROM u.email_confirmed_at
  );

-- Automatic trigger function to sync email_confirmed_at whenever user verifies email
CREATE OR REPLACE FUNCTION public.sync_profile_email_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    email_verified = (NEW.email_confirmed_at IS NOT NULL),
    email_verified_at = NEW.email_confirmed_at,
    updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_email_verification ON auth.users;

CREATE TRIGGER trg_sync_profile_email_verification
AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_email_verification();
