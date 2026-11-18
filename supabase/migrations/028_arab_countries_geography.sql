-- ==============================================================================
-- Migration 028: Arab League Countries & Multi-Level Administrative Divisions
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Scope:
--   1. Core Geographic Tables: countries, country_admin_levels, administrative_divisions
--   2. Strict Integrity Constraints & Cycle/Cross-Country Triggers
--   3. Multi-Location Campaign & Task Targeting Tables
--   4. Non-Destructive Foreign Keys on profiles, tasks, campaigns, tax_definitions
--   5. Updated handle_new_user() trigger preserving optional geo selections
--   6. Least-Privilege RLS Policies & Safe Idempotent Legacy Backfill Function
--   Note: Does NOT modify financial currency (YER), wallets, ledger, or payout methods.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. COUNTRIES TABLE (22 Arab League Member States)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iso2 TEXT NOT NULL UNIQUE CHECK (char_length(iso2) = 2 AND iso2 = UPPER(iso2)),
    iso3 TEXT NOT NULL UNIQUE CHECK (char_length(iso3) = 3 AND iso3 = UPPER(iso3)),
    name_ar TEXT NOT NULL CHECK (NULLIF(TRIM(name_ar), '') IS NOT NULL),
    name_en TEXT NOT NULL CHECK (NULLIF(TRIM(name_en), '') IS NOT NULL),
    phone_code TEXT,
    flag_emoji TEXT NOT NULL DEFAULT '🏳️',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 100,
    data_source TEXT,
    data_license TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_countries_active_sort
    ON public.countries (is_active, sort_order, iso2);

-- ------------------------------------------------------------------------------
-- 2. COUNTRY ADMINISTRATIVE LEVELS (Official Local Terminology Per Country)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.country_admin_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    level_order INT NOT NULL CHECK (level_order BETWEEN 1 AND 6),
    name_ar TEXT NOT NULL CHECK (NULLIF(TRIM(name_ar), '') IS NOT NULL),
    name_en TEXT NOT NULL CHECK (NULLIF(TRIM(name_en), '') IS NOT NULL),
    plural_ar TEXT,
    is_required BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (country_id, level_order)
);

CREATE INDEX IF NOT EXISTS idx_country_admin_levels_country_order
    ON public.country_admin_levels (country_id, level_order, is_active);

-- ------------------------------------------------------------------------------
-- 3. ADMINISTRATIVE DIVISIONS (Hierarchical Tree + Provenance & Coordinates)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.administrative_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    level_id UUID NOT NULL REFERENCES public.country_admin_levels(id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES public.administrative_divisions(id) ON DELETE RESTRICT,
    code TEXT,
    geonames_id BIGINT,
    wikidata_id TEXT,
    name_ar TEXT NOT NULL CHECK (NULLIF(TRIM(name_ar), '') IS NOT NULL),
    name_en TEXT NOT NULL CHECK (NULLIF(TRIM(name_en), '') IS NOT NULL),
    latitude NUMERIC(10, 6),
    longitude NUMERIC(10, 6),
    is_active BOOLEAN NOT NULL DEFAULT true,
    data_source TEXT NOT NULL DEFAULT 'Open Geo Dataset',
    data_license TEXT NOT NULL DEFAULT 'Verified Open License',
    source_url TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_admin_div_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_admin_div_country_parent_active
    ON public.administrative_divisions (country_id, parent_id, is_active);

CREATE INDEX IF NOT EXISTS idx_admin_div_level_active
    ON public.administrative_divisions (level_id, is_active);

CREATE INDEX IF NOT EXISTS idx_admin_div_name_ar_lower
    ON public.administrative_divisions (country_id, LOWER(TRIM(name_ar)));

CREATE INDEX IF NOT EXISTS idx_admin_div_name_en_lower
    ON public.administrative_divisions (country_id, LOWER(TRIM(name_en)));

-- Unique official code per country when provided
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_div_country_code
    ON public.administrative_divisions (country_id, code)
    WHERE code IS NOT NULL AND NULLIF(TRIM(code), '') IS NOT NULL;

-- Prevent duplicate sibling divisions within same country + parent + level
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_div_unique_sibling_name_en
    ON public.administrative_divisions (
        country_id,
        COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
        level_id,
        LOWER(TRIM(name_en))
    );

-- ------------------------------------------------------------------------------
-- 4. INTEGRITY TRIGGERS (Same-Country Parent, Level Ordering, Cycle Prevention)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_administrative_division_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_level_country_id UUID;
    v_level_order INT;
    v_parent_country_id UUID;
    v_parent_level_order INT;
    v_curr_parent UUID;
    v_depth INT := 0;
BEGIN
    -- 1. Verify level belongs to same country
    SELECT country_id, level_order
    INTO v_level_country_id, v_level_order
    FROM public.country_admin_levels
    WHERE id = NEW.level_id;

    IF v_level_country_id IS NULL THEN
        RAISE EXCEPTION 'Invalid administrative level_id: %', NEW.level_id;
    END IF;

    IF v_level_country_id <> NEW.country_id THEN
        RAISE EXCEPTION 'Cross-country level mismatch: level % belongs to country %, division belongs to %',
            NEW.level_id, v_level_country_id, NEW.country_id;
    END IF;

    -- 2. Verify parent belongs to same country, has strictly lower level_order, and forms no cycle
    IF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.id THEN
            RAISE EXCEPTION 'Division cannot be its own parent';
        END IF;

        SELECT d.country_id, l.level_order
        INTO v_parent_country_id, v_parent_level_order
        FROM public.administrative_divisions d
        JOIN public.country_admin_levels l ON l.id = d.level_id
        WHERE d.id = NEW.parent_id;

        IF v_parent_country_id IS NULL THEN
            RAISE EXCEPTION 'Parent administrative division not found: %', NEW.parent_id;
        END IF;

        IF v_parent_country_id <> NEW.country_id THEN
            RAISE EXCEPTION 'Cross-country parent rejected: parent belongs to % while child belongs to %',
                v_parent_country_id, NEW.country_id;
        END IF;

        IF v_parent_level_order >= v_level_order THEN
            RAISE EXCEPTION 'Hierarchy order violation: parent level (%) must be higher than child level (%)',
                v_parent_level_order, v_level_order;
        END IF;

        -- Cycle detection when updating parent_id
        v_curr_parent := NEW.parent_id;
        WHILE v_curr_parent IS NOT NULL AND v_depth < 12 LOOP
            IF v_curr_parent = NEW.id THEN
                RAISE EXCEPTION 'Cycle detected in administrative_divisions hierarchy';
            END IF;
            SELECT parent_id INTO v_curr_parent
            FROM public.administrative_divisions
            WHERE id = v_curr_parent;
            v_depth := v_depth + 1;
        END LOOP;

        IF v_depth >= 12 THEN
            RAISE EXCEPTION 'Administrative division hierarchy exceeded maximum depth (possible cycle)';
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_administrative_division ON public.administrative_divisions;
CREATE TRIGGER trg_validate_administrative_division
    BEFORE INSERT OR UPDATE ON public.administrative_divisions
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_administrative_division_hierarchy();

-- Descendant lookup helper (used by backend/SQL queries)
CREATE OR REPLACE FUNCTION public.get_division_descendant_ids(p_division_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH RECURSIVE tree AS (
        SELECT id FROM public.administrative_divisions WHERE id = p_division_id
        UNION ALL
        SELECT d.id
        FROM public.administrative_divisions d
        JOIN tree t ON d.parent_id = t.id
    )
    SELECT id FROM tree;
$$;

-- ------------------------------------------------------------------------------
-- 5. NON-DESTRUCTIVE GEO LINKS ON EXISTING TABLES
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    -- profiles: add country_id and administrative_division_id (preserve city & area_name!)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'country_id'
    ) THEN
        ALTER TABLE public.profiles
            ADD COLUMN country_id UUID REFERENCES public.countries(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'administrative_division_id'
    ) THEN
        ALTER TABLE public.profiles
            ADD COLUMN administrative_division_id UUID REFERENCES public.administrative_divisions(id) ON DELETE SET NULL;
    END IF;

    -- tasks: add country_id, administrative_division_id, is_nationwide
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'country_id'
    ) THEN
        ALTER TABLE public.tasks
            ADD COLUMN country_id UUID REFERENCES public.countries(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'administrative_division_id'
    ) THEN
        ALTER TABLE public.tasks
            ADD COLUMN administrative_division_id UUID REFERENCES public.administrative_divisions(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'is_nationwide'
    ) THEN
        ALTER TABLE public.tasks
            ADD COLUMN is_nationwide BOOLEAN NOT NULL DEFAULT true;
    END IF;

    -- campaigns: add country_id and is_nationwide
    IF to_regclass('public.campaigns') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'country_id'
        ) THEN
            ALTER TABLE public.campaigns
                ADD COLUMN country_id UUID REFERENCES public.countries(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'is_nationwide'
        ) THEN
            ALTER TABLE public.campaigns
                ADD COLUMN is_nationwide BOOLEAN NOT NULL DEFAULT true;
        END IF;
    END IF;

    -- tax_definitions: optional link to country (preserves legacy region column & YER accounting)
    IF to_regclass('public.tax_definitions') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tax_definitions' AND column_name = 'country_id'
        ) THEN
            ALTER TABLE public.tax_definitions
                ADD COLUMN country_id UUID REFERENCES public.countries(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_country_div
    ON public.profiles (country_id, administrative_division_id);

CREATE INDEX IF NOT EXISTS idx_tasks_country_div
    ON public.tasks (country_id, administrative_division_id, status);

-- Validate profile & task division belongs to selected country when both are set
CREATE OR REPLACE FUNCTION public.validate_record_country_division_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_div_country_id UUID;
BEGIN
    IF NEW.administrative_division_id IS NOT NULL THEN
        SELECT country_id INTO v_div_country_id
        FROM public.administrative_divisions
        WHERE id = NEW.administrative_division_id;

        IF v_div_country_id IS NULL THEN
            RAISE EXCEPTION 'Referenced administrative_division_id % does not exist', NEW.administrative_division_id;
        END IF;

        IF NEW.country_id IS NULL THEN
            NEW.country_id := v_div_country_id;
        ELSIF NEW.country_id <> v_div_country_id THEN
            RAISE EXCEPTION 'Selected division belongs to a different country than country_id';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_geo_validate ON public.profiles;
CREATE TRIGGER trg_profiles_geo_validate
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_record_country_division_match();

DROP TRIGGER IF EXISTS trg_tasks_geo_validate ON public.tasks;
CREATE TRIGGER trg_tasks_geo_validate
    BEFORE INSERT OR UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_record_country_division_match();

-- ------------------------------------------------------------------------------
-- 6. MULTI-LOCATION TARGETING TABLES (CAMPAIGNS & TASKS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_target_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    country_id UUID NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    division_id UUID NOT NULL REFERENCES public.administrative_divisions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (campaign_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_target_divisions_campaign
    ON public.campaign_target_divisions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_target_divisions_division
    ON public.campaign_target_divisions (division_id);

CREATE TABLE IF NOT EXISTS public.task_target_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    country_id UUID NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    division_id UUID NOT NULL REFERENCES public.administrative_divisions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (task_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_task_target_divisions_task
    ON public.task_target_divisions (task_id);
CREATE INDEX IF NOT EXISTS idx_task_target_divisions_division
    ON public.task_target_divisions (division_id);

CREATE OR REPLACE FUNCTION public.validate_target_division_country()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_div_country_id UUID;
BEGIN
    SELECT country_id INTO v_div_country_id
    FROM public.administrative_divisions
    WHERE id = NEW.division_id;

    IF v_div_country_id IS NULL THEN
        RAISE EXCEPTION 'Target administrative division % not found', NEW.division_id;
    END IF;

    IF NEW.country_id IS NULL THEN
        NEW.country_id := v_div_country_id;
    ELSIF NEW.country_id <> v_div_country_id THEN
        RAISE EXCEPTION 'Target division country mismatch';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_campaign_target_div ON public.campaign_target_divisions;
CREATE TRIGGER trg_validate_campaign_target_div
    BEFORE INSERT OR UPDATE ON public.campaign_target_divisions
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_target_division_country();

DROP TRIGGER IF EXISTS trg_validate_task_target_div ON public.task_target_divisions;
CREATE TRIGGER trg_validate_task_target_div
    BEFORE INSERT OR UPDATE ON public.task_target_divisions
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_target_division_country();

-- ------------------------------------------------------------------------------
-- 7. SAFE UPDATE TO handle_new_user() PRESERVING OPTIONAL GEO FIELDS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ref_code TEXT;
    v_role TEXT := 'user';
    v_phone TEXT;
    v_full_name TEXT;
    v_referred_by_code TEXT;
    v_referrer_id UUID := NULL;
    v_wallet_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_raw_country TEXT;
    v_raw_div TEXT;
    v_country_id UUID := NULL;
    v_division_id UUID := NULL;
    v_city TEXT;
BEGIN
    IF LOWER(COALESCE(NEW.email, '')) IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com') THEN
        v_role := 'admin';
    END IF;

    v_ref_code := 'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(NEW.id::text || ':kasb_referral_v1', 'sha256'), 'hex'), 1, 8));

    v_referred_by_code := NULLIF(UPPER(TRIM(COALESCE(NEW.raw_user_meta_data->>'referred_by_code', ''))), '');
    IF v_referred_by_code IS NOT NULL THEN
        SELECT id INTO v_referrer_id
        FROM public.profiles
        WHERE UPPER(TRIM(referral_code)) = v_referred_by_code
          AND id <> NEW.id
        LIMIT 1;
    END IF;

    v_raw_country := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'country_id', '')), '');
    IF v_raw_country ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_country_id FROM public.countries WHERE id = v_raw_country::uuid LIMIT 1;
    END IF;

    v_raw_div := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'administrative_division_id', '')), '');
    IF v_raw_div ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id, country_id INTO v_division_id, v_country_id
        FROM public.administrative_divisions
        WHERE id = v_raw_div::uuid
        LIMIT 1;
    END IF;

    IF v_country_id IS NULL THEN
        SELECT id INTO v_country_id FROM public.countries WHERE iso2 = 'YE' LIMIT 1;
    END IF;

    v_city := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'city'), ''), 'صنعاء');

    v_phone := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
        NULLIF(TRIM(NEW.phone), ''),
        '967' || SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 9)
    );

    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        'مستخدم جديد'
    );

    INSERT INTO public.profiles (
        id, full_name, phone, role, account_status, referral_code, referred_by,
        city, country_id, administrative_division_id, created_at, updated_at
    ) VALUES (
        NEW.id,
        v_full_name,
        v_phone,
        v_role,
        'active',
        v_ref_code,
        v_referrer_id,
        v_city,
        v_country_id,
        v_division_id,
        v_now,
        v_now
    )
    ON CONFLICT (id) DO UPDATE SET
        updated_at = v_now;

    INSERT INTO public.wallets (
        id, user_id, wallet_address, status, created_at
    ) VALUES (
        gen_random_uuid(),
        NEW.id,
        'KY-' || UPPER(SUBSTRING(ENCODE(DIGEST(NEW.id::text || '_kasb_wallet_salt_yemen_v1', 'sha256'), 'hex'), 1, 12)),
        'active',
        v_now
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.id ORDER BY created_at ASC LIMIT 1;

    IF v_wallet_id IS NOT NULL THEN
        INSERT INTO public.financial_accounts (
            id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
        ) VALUES (
            gen_random_uuid(), 'WALLET-' || v_wallet_id::text, 'wallet', NEW.id, v_wallet_id, 'credit', 0, 'active', v_now
        )
        ON CONFLICT (account_code) DO NOTHING;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY POLICIES (Public/Auth Read, Admin Write)
-- ------------------------------------------------------------------------------
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS countries_public_select ON public.countries;
DROP POLICY IF EXISTS countries_admin_all ON public.countries;
CREATE POLICY countries_public_select
    ON public.countries FOR SELECT TO anon, authenticated
    USING (is_active = true OR public.is_admin());
CREATE POLICY countries_admin_all
    ON public.countries FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.country_admin_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS country_admin_levels_public_select ON public.country_admin_levels;
DROP POLICY IF EXISTS country_admin_levels_admin_all ON public.country_admin_levels;
CREATE POLICY country_admin_levels_public_select
    ON public.country_admin_levels FOR SELECT TO anon, authenticated
    USING (is_active = true OR public.is_admin());
CREATE POLICY country_admin_levels_admin_all
    ON public.country_admin_levels FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.administrative_divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_divisions_public_select ON public.administrative_divisions;
DROP POLICY IF EXISTS admin_divisions_admin_all ON public.administrative_divisions;
CREATE POLICY admin_divisions_public_select
    ON public.administrative_divisions FOR SELECT TO anon, authenticated
    USING (is_active = true OR public.is_admin());
CREATE POLICY admin_divisions_admin_all
    ON public.administrative_divisions FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.campaign_target_divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_target_divisions_select_own ON public.campaign_target_divisions;
DROP POLICY IF EXISTS campaign_target_divisions_advertiser_insert ON public.campaign_target_divisions;
DROP POLICY IF EXISTS campaign_target_divisions_admin_all ON public.campaign_target_divisions;
CREATE POLICY campaign_target_divisions_select_own
    ON public.campaign_target_divisions FOR SELECT TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = campaign_id AND c.advertiser_id = auth.uid()
        )
    );
CREATE POLICY campaign_target_divisions_advertiser_insert
    ON public.campaign_target_divisions FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = campaign_id AND c.advertiser_id = auth.uid()
              AND c.status IN ('pending_approval', 'pending_start')
        )
    );
CREATE POLICY campaign_target_divisions_admin_all
    ON public.campaign_target_divisions FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.task_target_divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_target_divisions_public_select ON public.task_target_divisions;
DROP POLICY IF EXISTS task_target_divisions_admin_all ON public.task_target_divisions;
CREATE POLICY task_target_divisions_public_select
    ON public.task_target_divisions FOR SELECT TO anon, authenticated
    USING (true);
CREATE POLICY task_target_divisions_admin_all
    ON public.task_target_divisions FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.countries, public.country_admin_levels, public.administrative_divisions, public.task_target_divisions TO anon, authenticated;
GRANT ALL ON public.countries, public.country_admin_levels, public.administrative_divisions, public.campaign_target_divisions, public.task_target_divisions TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. SAFE IDEMPOTENT LEGACY BACKFILL FUNCTION
--    - Backfills Yemen country_id on legacy records with NULL country_id
--    - Matches ONLY unambiguous Yemen city strings; preserves original city/area_name
--    - Deletes zero records and preserves all existing user UUIDs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_arab_geography_legacy_links()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ye_id UUID;
    v_profiles_country_updated INT := 0;
    v_profiles_div_updated INT := 0;
    v_tasks_country_updated INT := 0;
BEGIN
    SELECT id INTO v_ye_id FROM public.countries WHERE iso2 = 'YE' LIMIT 1;
    IF v_ye_id IS NULL THEN
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'YE country not seeded yet');
    END IF;

    -- Backfill Yemen country_id on existing profiles missing country_id
    UPDATE public.profiles
    SET country_id = v_ye_id
    WHERE country_id IS NULL;
    GET DIAGNOSTICS v_profiles_country_updated = ROW_COUNT;

    -- Match unambiguous Yemeni city / governorate strings (preserving profiles.city and area_name!)
    WITH normalized_profiles AS (
        SELECT
            p.id AS profile_id,
            CASE
                WHEN TRIM(COALESCE(p.city, '')) IN ('المكلا', 'حضرموت (المكلا)', 'حضرموت') THEN 'حضرموت'
                WHEN TRIM(COALESCE(p.city, '')) IN ('صنعاء', 'أمانة العاصمة') THEN TRIM(p.city)
                ELSE TRIM(COALESCE(p.city, ''))
            END AS lookup_name
        FROM public.profiles p
        WHERE p.country_id = v_ye_id
          AND p.administrative_division_id IS NULL
          AND NULLIF(TRIM(COALESCE(p.city, '')), '') IS NOT NULL
    ),
    unambiguous_divs AS (
        SELECT
            LOWER(TRIM(d.name_ar)) AS key_ar,
            (ARRAY_AGG(d.id))[1] AS div_id,
            COUNT(*) AS match_count
        FROM public.administrative_divisions d
        JOIN public.country_admin_levels l ON l.id = d.level_id
        WHERE d.country_id = v_ye_id AND l.level_order = 1
        GROUP BY LOWER(TRIM(d.name_ar))
        HAVING COUNT(*) = 1
    )
    UPDATE public.profiles p
    SET administrative_division_id = u.div_id
    FROM normalized_profiles np
    JOIN unambiguous_divs u ON u.key_ar = LOWER(np.lookup_name)
    WHERE p.id = np.profile_id;
    GET DIAGNOSTICS v_profiles_div_updated = ROW_COUNT;

    -- Backfill Yemen country_id on existing legacy tasks that have NULL country_id
    UPDATE public.tasks
    SET country_id = v_ye_id
    WHERE country_id IS NULL;
    GET DIAGNOSTICS v_tasks_country_updated = ROW_COUNT;

    RETURN jsonb_build_object(
        'status', 'completed',
        'profiles_country_backfilled', v_profiles_country_updated,
        'profiles_division_matched', v_profiles_div_updated,
        'tasks_country_backfilled', v_tasks_country_updated
    );
END;
$$;
