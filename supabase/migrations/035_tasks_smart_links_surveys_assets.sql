-- ==============================================================================
-- Migration 035: Tasks Visual System, Assets Storage, Favorites, Smart Links & Sequential Surveys
-- Yemen Task (كسب اليمن)
-- Preserves existing Auth, Wallets, Financial Ledger (NUMERIC(30,6) YER), ClixWall, and AdPartners.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. EXTEND public.tasks NON-DESTRUCTIVELY
-- ------------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_kind TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_theme TEXT NOT NULL DEFAULT 'emerald',
  ADD COLUMN IF NOT EXISTS badge_label TEXT,
  ADD COLUMN IF NOT EXISTS badge_color TEXT,
  ADD COLUMN IF NOT EXISTS time_estimate_minutes INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proof_requirements JSONB NOT NULL DEFAULT '{"requireImage": true, "requireText": true, "requireUrl": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS task_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS max_per_user INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS provider_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS postback_secret TEXT;

-- Relax & expand tasks.category CHECK constraint safely if present
DO $$
DECLARE
  v_chk RECORD;
BEGIN
  FOR v_chk IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~* 'category'
  LOOP
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS %I', v_chk.conname);
  END LOOP;

  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_category_check CHECK (
      category IN (
        'general',
        'app_testing',
        'surveys',
        'social_engagement',
        'content_writing',
        'data_entry',
        'review_ratings',
        'local_services',
        'smart_links'
      )
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_featured_sort ON public.tasks (is_featured DESC, sort_order ASC, created_at DESC);

-- ------------------------------------------------------------------------------
-- 2. TASK CATEGORIES & ASSETS (STORED IN SUPABASE STORAGE BUCKET 'task-assets')
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label_ar TEXT NOT NULL,
  icon_url TEXT,
  badge_color TEXT NOT NULL DEFAULT '#059669',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  asset_kind TEXT NOT NULL DEFAULT 'task_illustration' CHECK (asset_kind IN ('task_illustration', 'category_icon', 'provider_logo')),
  task_kind TEXT,
  storage_path TEXT UNIQUE NOT NULL,
  public_url TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public storage bucket for task illustrations & category icons
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-assets',
  'task-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

DROP POLICY IF EXISTS "Public read task-assets" ON storage.objects;
CREATE POLICY "Public read task-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-assets');

DROP POLICY IF EXISTS "Admins manage task-assets" ON storage.objects;
CREATE POLICY "Admins manage task-assets"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'task-assets' AND public.is_admin())
WITH CHECK (bucket_id = 'task-assets' AND public.is_admin());

-- ------------------------------------------------------------------------------
-- 3. USER TASK FAVORITES (NO LOCALSTORAGE DEPENDENCE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_favorites_user ON public.task_favorites (user_id);

-- ------------------------------------------------------------------------------
-- 4. SEQUENTIAL SURVEY SYSTEM (WITH CONDITIONAL BRANCHING & DRAFT PERSISTENCE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  reward_yer NUMERIC(30,6) NOT NULL DEFAULT 0.000000 CHECK (reward_yer >= 0),
  estimated_minutes INTEGER NOT NULL DEFAULT 5,
  max_participants INTEGER NOT NULL DEFAULT 100,
  completed_participants INTEGER NOT NULL DEFAULT 0,
  max_attempts_per_user INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  escrow_account_id UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.survey_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (
    question_type IN ('single_choice', 'multiple_choice', 'yes_no', 'short_text', 'long_text', 'rating_1_5')
  ),
  is_required BOOLEAN NOT NULL DEFAULT true,
  branch_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_questions_order ON public.survey_questions (survey_id, order_index ASC);

CREATE TABLE IF NOT EXISTS public.survey_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  option_text TEXT NOT NULL,
  next_question_id UUID REFERENCES public.survey_questions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_survey_options_order ON public.survey_options (question_id, order_index ASC);

CREATE TABLE IF NOT EXISTS public.survey_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'rewarded', 'rejected')),
  current_question_index INTEGER NOT NULL DEFAULT 0,
  reward_transaction_id UUID REFERENCES public.ledger_transactions(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_id, user_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_survey_attempts_user ON public.survey_attempts (user_id, survey_id);

CREATE TABLE IF NOT EXISTS public.survey_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.survey_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  answer_value JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, question_id)
);

-- ------------------------------------------------------------------------------
-- 5. SMART LINKS ATTEMPTS & VERIFIED POSTBACK LOGS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smart_link_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL DEFAULT 'SmartLink',
  click_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'rejected', 'reversed')),
  external_tx_id TEXT UNIQUE,
  reward_yer NUMERIC(30,6) NOT NULL DEFAULT 0.000000,
  reward_transaction_id UUID REFERENCES public.ledger_transactions(id),
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_smart_link_attempts_user_task ON public.smart_link_attempts (user_id, task_id);
CREATE INDEX IF NOT EXISTS idx_smart_link_attempts_token ON public.smart_link_attempts (click_token);

-- ------------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY & POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_link_attempts ENABLE ROW LEVEL SECURITY;

-- task_categories
DROP POLICY IF EXISTS "Public read active task categories" ON public.task_categories;
CREATE POLICY "Public read active task categories" ON public.task_categories
  FOR SELECT USING (is_active = true OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage task categories" ON public.task_categories;
CREATE POLICY "Admins manage task categories" ON public.task_categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- task_assets
DROP POLICY IF EXISTS "Public read task assets" ON public.task_assets;
CREATE POLICY "Public read task assets" ON public.task_assets
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage task assets" ON public.task_assets;
CREATE POLICY "Admins manage task assets" ON public.task_assets
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- task_favorites
DROP POLICY IF EXISTS "Users manage own favorites" ON public.task_favorites;
CREATE POLICY "Users manage own favorites" ON public.task_favorites
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- surveys / questions / options
DROP POLICY IF EXISTS "Read active surveys" ON public.surveys;
CREATE POLICY "Read active surveys" ON public.surveys
  FOR SELECT USING (status = 'active' OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage surveys" ON public.surveys;
CREATE POLICY "Admins manage surveys" ON public.surveys
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Read active survey questions" ON public.survey_questions;
CREATE POLICY "Read active survey questions" ON public.survey_questions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND (s.status = 'active' OR public.is_admin()))
  );
DROP POLICY IF EXISTS "Admins manage survey questions" ON public.survey_questions;
CREATE POLICY "Admins manage survey questions" ON public.survey_questions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Read active survey options" ON public.survey_options;
CREATE POLICY "Read active survey options" ON public.survey_options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.survey_questions q
      JOIN public.surveys s ON s.id = q.survey_id
      WHERE q.id = question_id AND (s.status = 'active' OR public.is_admin())
    )
  );
DROP POLICY IF EXISTS "Admins manage survey options" ON public.survey_options;
CREATE POLICY "Admins manage survey options" ON public.survey_options
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- survey_attempts & survey_answers
DROP POLICY IF EXISTS "Users manage own survey attempts" ON public.survey_attempts;
CREATE POLICY "Users manage own survey attempts" ON public.survey_attempts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users manage own survey answers" ON public.survey_answers;
CREATE POLICY "Users manage own survey answers" ON public.survey_answers
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.survey_attempts a WHERE a.id = attempt_id AND (a.user_id = auth.uid() OR public.is_admin()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.survey_attempts a WHERE a.id = attempt_id AND (a.user_id = auth.uid() OR public.is_admin()))
  );

-- smart_link_attempts
DROP POLICY IF EXISTS "Users read own smart link attempts" ON public.smart_link_attempts;
CREATE POLICY "Users read own smart link attempts" ON public.smart_link_attempts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "Service manages smart link attempts" ON public.smart_link_attempts;
CREATE POLICY "Service manages smart link attempts" ON public.smart_link_attempts
  FOR ALL USING (auth.role() = 'service_role' OR public.is_admin())
  WITH CHECK (auth.role() = 'service_role' OR public.is_admin());

GRANT SELECT ON public.task_categories, public.task_assets, public.surveys, public.survey_questions, public.survey_options TO anon, authenticated;
GRANT ALL ON public.task_favorites, public.survey_attempts, public.survey_answers TO authenticated;
GRANT SELECT ON public.smart_link_attempts TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ------------------------------------------------------------------------------
-- 7. ATOMIC LEDGER RPC: SMART LINK VERIFIED POSTBACK PAYOUT (6-DECIMAL YER)
--    Credits ONLY via verified postback (never on click/timer), idempotent by p_external_tx_id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_smart_link_postback(
  p_external_tx_id TEXT,
  p_click_token TEXT,
  p_user_id UUID DEFAULT NULL,
  p_task_id UUID DEFAULT NULL,
  p_reward_yer NUMERIC DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_ext_tx TEXT := btrim(COALESCE(p_external_tx_id, ''));
  v_clean_token TEXT := btrim(COALESCE(p_click_token, ''));
  v_attempt RECORD;
  v_task RECORD;
  v_user_id UUID;
  v_task_id UUID;
  v_reward NUMERIC(30,6);
  v_wallet_id UUID;
  v_user_wallet_acc RECORD;
  v_source_acc RECORD;
  v_tx_id UUID;
  v_existing_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'FORBIDDEN_FINANCIAL_RPC';
  END IF;

  IF v_clean_ext_tx = '' THEN
    RAISE EXCEPTION 'MISSING_EXTERNAL_TX_ID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('smartlink:' || v_clean_ext_tx));

  -- Idempotency guard
  SELECT id INTO v_existing_id
  FROM public.smart_link_attempts
  WHERE external_tx_id = v_clean_ext_tx
    AND status = 'completed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'attempt_id', v_existing_id);
  END IF;

  -- Locate attempt by click_token if supplied
  IF v_clean_token <> '' THEN
    SELECT * INTO v_attempt
    FROM public.smart_link_attempts
    WHERE click_token = v_clean_token
    FOR UPDATE;
  END IF;

  v_user_id := COALESCE(v_attempt.user_id, p_user_id);
  v_task_id := COALESCE(v_attempt.task_id, p_task_id);

  IF v_user_id IS NULL OR v_task_id IS NULL THEN
    RAISE EXCEPTION 'SMART_LINK_ATTEMPT_OR_TARGET_NOT_FOUND';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = v_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  v_reward := ROUND(COALESCE(p_reward_yer, v_task.reward_units, 0)::numeric, 6);
  IF v_reward <= 0 THEN
    RAISE EXCEPTION 'INVALID_REWARD_AMOUNT';
  END IF;

  IF v_task.slots > 0 AND v_task.approved_count >= v_task.slots THEN
    RAISE EXCEPTION 'TASK_SLOTS_FILLED';
  END IF;

  -- Resolve source funding account: prefer task escrow if funded & sufficient, else PLATFORM-TREASURY
  IF v_task.escrow_account_id IS NOT NULL THEN
    SELECT * INTO v_source_acc FROM public.financial_accounts WHERE id = v_task.escrow_account_id;
  END IF;
  IF v_source_acc.id IS NULL OR v_source_acc.balance_units < v_reward THEN
    SELECT * INTO v_source_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' LIMIT 1;
  END IF;
  IF v_source_acc.id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_FINANCIAL_ACCOUNT_NOT_FOUND';
  END IF;

  -- Ensure user wallet + wallet financial account
  INSERT INTO public.wallets (id, user_id, wallet_address, status)
  VALUES (
    gen_random_uuid(),
    v_user_id,
    'KY-' || upper(substring(md5(v_user_id::text || '_kasb_wallet_salt_yemen_v1'), 1, 12)),
    'active'
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id LIMIT 1;

  SELECT * INTO v_user_wallet_acc
  FROM public.financial_accounts
  WHERE account_type = 'wallet' AND (wallet_id = v_wallet_id OR owner_user_id = v_user_id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_user_wallet_acc.id IS NULL THEN
    INSERT INTO public.financial_accounts (
      id, account_code, account_type, normal_side, balance_units, owner_user_id, wallet_id, status, created_at
    ) VALUES (
      gen_random_uuid(),
      'WALLET-' || COALESCE(v_wallet_id::text, substring(v_user_id::text, 1, 8)),
      'wallet',
      'credit',
      0.000000,
      v_user_id,
      v_wallet_id,
      'active',
      v_now
    )
    RETURNING * INTO v_user_wallet_acc;
  END IF;

  -- Post balanced ledger transaction using canonical post_ledger_transaction
  v_tx_id := public.post_ledger_transaction(
    p_transaction_type := 'TASK_REWARD_PAYOUT',
    p_idempotency_key := 'SMARTLINK:' || v_clean_ext_tx,
    p_reference := 'SMARTLINK:' || v_task_id::text,
    p_metadata := jsonb_build_object(
      'task_id', v_task_id,
      'task_title', v_task.title,
      'performer_user_id', v_user_id,
      'external_tx_id', v_clean_ext_tx,
      'click_token', v_clean_token,
      'reward_yer', v_reward,
      'source', 'smart_link_postback'
    ),
    p_entries := jsonb_build_array(
      jsonb_build_object('account_id', v_source_acc.id, 'side', 'debit', 'amount_units', v_reward, 'memo', 'صرف مكافأة رابط ذكي: ' || v_task.title),
      jsonb_build_object('account_id', v_user_wallet_acc.id, 'side', 'credit', 'amount_units', v_reward, 'memo', 'مكافأة رابط ذكي: ' || v_task.title)
    )
  );

  IF v_attempt.id IS NOT NULL THEN
    UPDATE public.smart_link_attempts
    SET status = 'completed',
        external_tx_id = v_clean_ext_tx,
        reward_yer = v_reward,
        reward_transaction_id = v_tx_id,
        provider_payload = COALESCE(p_payload, '{}'::jsonb),
        completed_at = v_now
    WHERE id = v_attempt.id;
  ELSE
    INSERT INTO public.smart_link_attempts (
      task_id, user_id, provider_name, click_token, status, external_tx_id, reward_yer, reward_transaction_id, provider_payload, started_at, completed_at
    ) VALUES (
      v_task_id, v_user_id, COALESCE(v_task.provider_name, 'SmartLink'),
      COALESCE(NULLIF(v_clean_token, ''), 'DIRECT-' || v_clean_ext_tx),
      'completed', v_clean_ext_tx, v_reward, v_tx_id, COALESCE(p_payload, '{}'::jsonb), v_now, v_now
    );
  END IF;

  UPDATE public.tasks
  SET approved_count = approved_count + 1,
      budget_spent_yer = ROUND(COALESCE(budget_spent_yer, 0)::numeric + v_reward, 6),
      status = CASE WHEN slots > 0 AND approved_count + 1 >= slots THEN 'completed' ELSE status END
  WHERE id = v_task_id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'user_id', v_user_id,
    'task_id', v_task_id,
    'task_title', v_task.title,
    'reward_yer', v_reward,
    'transaction_id', v_tx_id
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. ATOMIC LEDGER RPC: SURVEY COMPLETION PAYOUT (6-DECIMAL YER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_survey_completion(
  p_attempt_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt RECORD;
  v_survey RECORD;
  v_reward NUMERIC(30,6);
  v_wallet_id UUID;
  v_user_wallet_acc RECORD;
  v_source_acc RECORD;
  v_tx_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_attempt_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_PARAMETERS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('survey_attempt:' || p_attempt_id::text));

  SELECT * INTO v_attempt
  FROM public.survey_attempts
  WHERE id = p_attempt_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SURVEY_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt.status = 'rewarded' AND v_attempt.reward_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'transaction_id', v_attempt.reward_transaction_id
    );
  END IF;

  SELECT * INTO v_survey FROM public.surveys WHERE id = v_attempt.survey_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SURVEY_NOT_FOUND';
  END IF;

  IF v_survey.status <> 'active' THEN
    RAISE EXCEPTION 'SURVEY_NOT_ACTIVE';
  END IF;

  IF v_survey.max_participants > 0 AND v_survey.completed_participants >= v_survey.max_participants THEN
    RAISE EXCEPTION 'SURVEY_PARTICIPANTS_FULL';
  END IF;

  v_reward := ROUND(COALESCE(v_survey.reward_yer, 0)::numeric, 6);

  IF v_reward > 0 THEN
    IF v_survey.escrow_account_id IS NOT NULL THEN
      SELECT * INTO v_source_acc FROM public.financial_accounts WHERE id = v_survey.escrow_account_id;
    END IF;
    IF v_source_acc.id IS NULL OR v_source_acc.balance_units < v_reward THEN
      SELECT * INTO v_source_acc FROM public.financial_accounts WHERE account_code = 'PLATFORM-TREASURY' LIMIT 1;
    END IF;
    IF v_source_acc.id IS NULL THEN
      RAISE EXCEPTION 'SOURCE_FINANCIAL_ACCOUNT_NOT_FOUND';
    END IF;

    INSERT INTO public.wallets (id, user_id, wallet_address, status)
    VALUES (
      gen_random_uuid(),
      p_user_id,
      'KY-' || upper(substring(md5(p_user_id::text || '_kasb_wallet_salt_yemen_v1'), 1, 12)),
      'active'
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id LIMIT 1;

    SELECT * INTO v_user_wallet_acc
    FROM public.financial_accounts
    WHERE account_type = 'wallet' AND (wallet_id = v_wallet_id OR owner_user_id = p_user_id)
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_user_wallet_acc.id IS NULL THEN
      INSERT INTO public.financial_accounts (
        id, account_code, account_type, normal_side, balance_units, owner_user_id, wallet_id, status, created_at
      ) VALUES (
        gen_random_uuid(),
        'WALLET-' || COALESCE(v_wallet_id::text, substring(p_user_id::text, 1, 8)),
        'wallet',
        'credit',
        0.000000,
        p_user_id,
        v_wallet_id,
        'active',
        v_now
      )
      RETURNING * INTO v_user_wallet_acc;
    END IF;

    v_tx_id := public.post_ledger_transaction(
      p_transaction_type := 'TASK_REWARD_PAYOUT',
      p_idempotency_key := 'SURVEY-REWARD:' || p_attempt_id::text,
      p_reference := 'SURVEY:' || v_survey.id::text,
      p_metadata := jsonb_build_object(
        'survey_id', v_survey.id,
        'survey_title', v_survey.title,
        'attempt_id', p_attempt_id,
        'performer_user_id', p_user_id,
        'reward_yer', v_reward,
        'source', 'survey_completion'
      ),
      p_entries := jsonb_build_array(
        jsonb_build_object('account_id', v_source_acc.id, 'side', 'debit', 'amount_units', v_reward, 'memo', 'صرف مكافأة استبيان: ' || v_survey.title),
        jsonb_build_object('account_id', v_user_wallet_acc.id, 'side', 'credit', 'amount_units', v_reward, 'memo', 'مكافأة إتمام استبيان: ' || v_survey.title)
      )
    );
  END IF;

  UPDATE public.survey_attempts
  SET status = CASE WHEN v_reward > 0 THEN 'rewarded' ELSE 'submitted' END,
      reward_transaction_id = v_tx_id,
      submitted_at = v_now,
      updated_at = v_now
  WHERE id = p_attempt_id;

  UPDATE public.surveys
  SET completed_participants = completed_participants + 1,
      status = CASE WHEN max_participants > 0 AND completed_participants + 1 >= max_participants THEN 'completed' ELSE status END,
      updated_at = v_now
  WHERE id = v_survey.id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'reward_yer', v_reward,
    'transaction_id', v_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_smart_link_postback(TEXT, TEXT, UUID, UUID, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_smart_link_postback(TEXT, TEXT, UUID, UUID, NUMERIC, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.submit_survey_completion(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_survey_completion(UUID, UUID) TO authenticated, service_role;

COMMIT;
