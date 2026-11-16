-- Migration 019: Advertiser Role and Pending Account Status Support
-- 1. Update check constraints on profiles.role and user_roles.role to include 'advertiser'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin', 'advertiser'));

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('user', 'admin', 'advertiser'));

-- 2. Update check constraint on profiles.status to include 'pending'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended', 'under_review', 'pending'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'account_status'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check';
    EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check CHECK (account_status IN (''active'', ''suspended'', ''under_review'', ''pending''))';
  END IF;
END $$;

-- 3. Add advertiser profile columns if not present
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_person TEXT;
