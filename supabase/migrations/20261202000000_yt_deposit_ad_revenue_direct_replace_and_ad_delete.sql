-- ==============================================================================
-- Taska Coin (yt-ecosystem) Targeted Fixes & Offerwall.GG Direct Integration
-- Scope: Strictly isolated to Taska Coin (yt_*) tables only.
-- Zero modifications to Yemen Task core financial tables
-- (wallets, financial_accounts, ledger_transactions, ledger_entries).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Non-Cumulative Ad Revenue Distribution (70% Liquidity / 30% Admin)
--    Targets real live table: public.yt_liquidity_engine (singleton = true)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.yt_deposit_ad_revenue(p_total_usd NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool_70 NUMERIC;
  v_admin_30 NUMERIC;
  v_total_mined_units BIGINT;
  v_new_price_usd NUMERIC;
BEGIN
  -- التحقق الصارم من صلاحية المدير
  IF NOT public.yt_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  IF p_total_usd IS NULL OR p_total_usd <= 0 THEN
    RAISE EXCEPTION 'INVALID_REVENUE_AMOUNT';
  END IF;

  -- المحافظة على دقة 6 منازل عشرية (70% سيولة / 30% إدارة)
  v_pool_70 := ROUND(p_total_usd * 0.70, 6);
  v_admin_30 := ROUND(p_total_usd * 0.30, 6);

  -- التحقق من وجود سجل الصندوق واستبدال القيم مباشرة بدون جمع تراكمي
  UPDATE public.yt_liquidity_engine
  SET
    ad_pool_usd = v_pool_70,
    yt_ad_pool_usd = v_pool_70,
    admin_revenue_usd = v_admin_30,
    yt_admin_revenue_usd = v_admin_30,
    updated_at = NOW()
  WHERE singleton = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LIQUIDITY_POOL_NOT_FOUND';
  END IF;

  -- تسجيل عملية التحديث الإداري في سجل إيداعات الإيرادات إن وجد الجدول ومعرف المدير
  IF auth.uid() IS NOT NULL AND to_regclass('public.yt_revenue_deposits') IS NOT NULL THEN
    INSERT INTO public.yt_revenue_deposits (total_usd, liquidity_usd, admin_revenue_usd, deposited_by)
    VALUES (ROUND(p_total_usd, 6), v_pool_70, v_admin_30, auth.uid());
  END IF;

  -- جلب إجمالي العملات المعدّنة المتداولة لحساب السعر اللحظي الجديد
  SELECT COALESCE(
    SUM(mined_units + withdrawable_units + withdrawal_pending_units), 0
  )
  INTO v_total_mined_units
  FROM public.yt_wallets;

  IF v_total_mined_units > 0 THEN
    v_new_price_usd := ROUND(v_pool_70 / (v_total_mined_units::NUMERIC / 100000.0), 12);
  ELSE
    v_new_price_usd := 0;
  END IF;

  -- تسجيل نقطة السعر الجديدة في سجل الأسعار
  INSERT INTO public.yt_price_history (price_usd_per_yt, ad_pool_usd, total_mined_units, event_type)
  VALUES (v_new_price_usd, v_pool_70, v_total_mined_units, 'admin_revenue_reset');

  RETURN jsonb_build_object(
    'success', true,
    'message_ar', 'تم استبدال رصيد صندوق السيولة الجديد (' || v_pool_70 || '$) وتحديث السعر اللحظي بنجاح.',
    'pool_70', v_pool_70,
    'admin_30', v_admin_30,
    'price_usd_per_yt', v_new_price_usd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.yt_deposit_ad_revenue(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yt_deposit_ad_revenue(NUMERIC) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Safe Permanent Deletion of Published Mining Ads (Preserves All History)
--    Converts any FK referencing yt_mining_ads(id) on historical/session tables
--    to ON DELETE SET NULL so deleting an ad NEVER deletes rewards or wallets.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      con.conname,
      rel.relname AS child_table,
      att.attname AS child_column
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND con.confrelid = 'public.yt_mining_ads'::regclass
      AND rel.relname IN ('yt_user_ad_claims', 'yt_link_tracking_sessions', 'yt_ad_sessions')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', v_rec.child_table, v_rec.child_column);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_rec.child_table, v_rec.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.yt_mining_ads(id) ON DELETE SET NULL',
      v_rec.child_table,
      v_rec.conname,
      v_rec.child_column
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.yt_admin_delete_mining_ad(p_ad_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_title TEXT;
BEGIN
  IF NOT public.yt_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  IF p_ad_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_AD_ID';
  END IF;

  -- إلغاء الجلسات المعلقة فقط وفك الارتباط بدون حذف أي سجلات تاريخية أو مطالبات مكافآت
  IF to_regclass('public.yt_link_tracking_sessions') IS NOT NULL THEN
    UPDATE public.yt_link_tracking_sessions
    SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
        ad_id = NULL
    WHERE ad_id = p_ad_id;
  END IF;

  IF to_regclass('public.yt_ad_sessions') IS NOT NULL THEN
    UPDATE public.yt_ad_sessions
    SET ad_id = NULL
    WHERE ad_id = p_ad_id;
  END IF;

  -- الحفاظ الكامل على سجل مطالبات المستخدمين التاريخي yt_user_ad_claims دون حذفه
  IF to_regclass('public.yt_user_ad_claims') IS NOT NULL THEN
    UPDATE public.yt_user_ad_claims
    SET ad_id = NULL
    WHERE ad_id = p_ad_id;
  END IF;

  -- حذف الإعلان المطلوب نهائياً من قاعدة البيانات فقط
  DELETE FROM public.yt_mining_ads
  WHERE id = p_ad_id
  RETURNING title INTO v_deleted_title;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'AD_NOT_FOUND',
      'message_ar', 'الإعلان غير موجود أو تم حذفه مسبقاً.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_id', p_ad_id,
    'message_ar', 'تم حذف الإعلان "' || COALESCE(v_deleted_title, '') || '" نهائياً مع الحفاظ على جميع أرصدة وسجلات المستخدمين.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.yt_admin_delete_mining_ad(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yt_admin_delete_mining_ad(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Performance Indexes for Taska Mining Queries (Safe IF NOT EXISTS)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_yt_wallets_updated_at
  ON public.yt_wallets (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_mining_ads_active_sort
  ON public.yt_mining_ads (is_active, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_user_ad_claims_user_date
  ON public.yt_user_ad_claims (user_id, claimed_date);

CREATE INDEX IF NOT EXISTS idx_yt_daily_click_claims_user_date
  ON public.yt_daily_click_claims (user_id, claim_date);

CREATE INDEX IF NOT EXISTS idx_yt_daily_checkins_user_created
  ON public.yt_daily_checkins (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_ledger_transactions_wallet_created
  ON public.yt_ledger_transactions (wallet_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_price_history_created
  ON public.yt_price_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_withdrawal_requests_user_created
  ON public.yt_withdrawal_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_withdrawal_requests_status_created
  ON public.yt_withdrawal_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yt_link_tracking_sessions_ad_id
  ON public.yt_link_tracking_sessions (ad_id);

-- ------------------------------------------------------------------------------
-- 4. Direct Server-Side Offerwall.GG -> Taska Coin (yt_wallets) Postbacks
--    Strictly isolated from core Yemen Task wallets/ledger tables.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.yt_offerwall_gg_postbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_tx_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.yt_wallets(user_id) ON DELETE RESTRICT,
  offer_id TEXT,
  offer_name TEXT,
  goal_id TEXT,
  status TEXT NOT NULL DEFAULT 'credited' CHECK (status IN ('credited')),
  raw_amount NUMERIC(20, 6) NOT NULL CHECK (raw_amount > 0),
  raw_currency TEXT NOT NULL,
  payout_usd NUMERIC(20, 6),
  price_usd_per_yt NUMERIC(20, 12),
  price_yer_per_yt NUMERIC(20, 12),
  reward_units BIGINT NOT NULL CHECK (reward_units > 0),
  ledger_transaction_id UUID REFERENCES public.yt_ledger_transactions(id),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yt_offerwall_gg_postbacks_user_created
  ON public.yt_offerwall_gg_postbacks (user_id, created_at DESC);

ALTER TABLE public.yt_offerwall_gg_postbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yt_offerwall_gg_postbacks_read_own" ON public.yt_offerwall_gg_postbacks;
CREATE POLICY "yt_offerwall_gg_postbacks_read_own"
  ON public.yt_offerwall_gg_postbacks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "yt_offerwall_gg_postbacks_service_all" ON public.yt_offerwall_gg_postbacks;
CREATE POLICY "yt_offerwall_gg_postbacks_service_all"
  ON public.yt_offerwall_gg_postbacks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Atomic single-transaction RPC: idempotency check + wallet credit + Taska ledger entry
CREATE OR REPLACE FUNCTION public.yt_process_offerwall_gg_postback(
  p_external_tx_id TEXT,
  p_user_id UUID,
  p_raw_amount NUMERIC,
  p_raw_currency TEXT,
  p_payout_usd NUMERIC DEFAULT NULL,
  p_offer_id TEXT DEFAULT NULL,
  p_offer_name TEXT DEFAULT NULL,
  p_goal_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_tx TEXT;
  v_clean_currency TEXT;
  v_upper_currency TEXT;
  v_mode TEXT;
  v_existing RECORD;
  v_wallet RECORD;
  v_engine RECORD;
  v_alloc RECORD;
  v_total_mined_units BIGINT;
  v_price_usd_per_yt NUMERIC;
  v_price_yer_per_yt NUMERIC;
  v_reward_units BIGINT;
  v_postback_id UUID;
  v_before_units BIGINT;
  v_after_units BIGINT;
  v_ledger_id UUID;
  v_group_id UUID := gen_random_uuid();
BEGIN
  v_clean_tx := TRIM(COALESCE(p_external_tx_id, ''));
  IF v_clean_tx = '' OR LENGTH(v_clean_tx) > 200 THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_ID';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER';
  END IF;

  IF p_raw_amount IS NULL OR p_raw_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  v_clean_currency := REGEXP_REPLACE(
    REGEXP_REPLACE(TRIM(COALESCE(p_raw_currency, '')), '\s+', ' ', 'g'),
    '\s*[-–—]\s*', '-', 'g'
  );
  v_upper_currency := UPPER(v_clean_currency);

  IF v_upper_currency IN ('TSK', 'YT', 'TASKA', 'TASKA COIN') THEN
    v_mode := 'TSK';
  ELSIF v_upper_currency IN ('YER', 'YEMENI RIAL', 'REAL YEMENI', 'REAL YEMENI-ريال يمني', 'REAL YEMENI-الريال اليمني')
     OR v_clean_currency IN ('ريال يمني', 'الريال اليمني', 'ريال', 'ر.ي', 'ر.ي.') THEN
    v_mode := 'YER';
  ELSIF v_upper_currency = 'USD' THEN
    v_mode := 'USD';
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_CURRENCY';
  END IF;

  -- فحص سريع للتكرار قبل أي تعديل
  SELECT id, reward_units, ledger_transaction_id
  INTO v_existing
  FROM public.yt_offerwall_gg_postbacks
  WHERE external_tx_id = v_clean_tx;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'external_tx_id', v_clean_tx,
      'reward_units', v_existing.reward_units,
      'ledger_transaction_id', v_existing.ledger_transaction_id,
      'message_ar', 'تمت معالجة هذه المعاملة مسبقاً ولم تُضف مكافأة مكررة.'
    );
  END IF;

  -- قفل محفظة التعدين والتحقق من وجودها وسلامتها
  SELECT user_id, mined_units, is_frozen, wallet_status
  INTO v_wallet
  FROM public.yt_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF COALESCE(v_wallet.is_frozen, false) OR COALESCE(v_wallet.wallet_status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'WALLET_FROZEN';
  END IF;

  -- قفل محرك السيولة ومخصّص التعدين لحساب التحويل المعتمد بدقة ذرية
  SELECT ad_pool_usd, yer_per_usd, total_mined_units, mining_remaining_units
  INTO v_engine
  FROM public.yt_liquidity_engine
  WHERE singleton = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LIQUIDITY_POOL_NOT_FOUND';
  END IF;

  SELECT allocation_code, distributed_units, remaining_units
  INTO v_alloc
  FROM public.yt_token_allocations
  WHERE allocation_key = 'mining'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINING_ALLOCATION_NOT_FOUND';
  END IF;

  SELECT COALESCE(SUM(mined_units + withdrawable_units + withdrawal_pending_units), 0)
  INTO v_total_mined_units
  FROM public.yt_wallets;

  IF v_total_mined_units > 0 AND COALESCE(v_engine.ad_pool_usd, 0) > 0 THEN
    v_price_usd_per_yt := ROUND(v_engine.ad_pool_usd / (v_total_mined_units::NUMERIC / 100000.0), 12);
    v_price_yer_per_yt := ROUND(v_price_usd_per_yt * COALESCE(v_engine.yer_per_usd, 1600), 12);
  ELSE
    v_price_usd_per_yt := 0;
    v_price_yer_per_yt := 0;
  END IF;

  -- تحويل المبلغ لوحدات عملة التعدين (دقة 100,000 وحدة = 1 TSK) وفق السعر المعتمد فقط
  IF v_mode = 'TSK' THEN
    v_reward_units := ROUND(p_raw_amount * 100000.0)::BIGINT;
  ELSIF v_mode = 'YER' THEN
    IF v_price_yer_per_yt <= 0 THEN
      RAISE EXCEPTION 'PRICE_NOT_AVAILABLE';
    END IF;
    v_reward_units := ROUND((p_raw_amount / v_price_yer_per_yt) * 100000.0)::BIGINT;
  ELSE -- USD
    IF v_price_usd_per_yt <= 0 THEN
      RAISE EXCEPTION 'PRICE_NOT_AVAILABLE';
    END IF;
    v_reward_units := ROUND((p_raw_amount / v_price_usd_per_yt) * 100000.0)::BIGINT;
  END IF;

  IF v_reward_units IS NULL OR v_reward_units <= 0 THEN
    RAISE EXCEPTION 'INVALID_REWARD_UNITS';
  END IF;

  IF COALESCE(v_alloc.remaining_units, 0) < v_reward_units THEN
    RAISE EXCEPTION 'MINING_ALLOCATION_EXHAUSTED';
  END IF;

  -- إدراج سجل الـ Postback مع قيد UNIQUE لمنع التكرار حتى في الطلبات المتزامنة
  INSERT INTO public.yt_offerwall_gg_postbacks (
    external_tx_id,
    user_id,
    offer_id,
    offer_name,
    goal_id,
    status,
    raw_amount,
    raw_currency,
    payout_usd,
    price_usd_per_yt,
    price_yer_per_yt,
    reward_units,
    raw_payload
  )
  VALUES (
    v_clean_tx,
    p_user_id,
    NULLIF(TRIM(COALESCE(p_offer_id, '')), ''),
    NULLIF(TRIM(COALESCE(p_offer_name, '')), ''),
    NULLIF(TRIM(COALESCE(p_goal_id, '')), ''),
    'credited',
    ROUND(p_raw_amount, 6),
    v_clean_currency,
    p_payout_usd,
    v_price_usd_per_yt,
    v_price_yer_per_yt,
    v_reward_units,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (external_tx_id) DO NOTHING
  RETURNING id INTO v_postback_id;

  IF v_postback_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'external_tx_id', v_clean_tx,
      'message_ar', 'تمت معالجة هذه المعاملة مسبقاً (حماية التزامن).'
    );
  END IF;

  -- تحديث رصيد محفظة التعدين ومخصّص التعدين ومحرك السيولة ذرياً
  v_before_units := COALESCE(v_wallet.mined_units, 0);
  v_after_units := v_before_units + v_reward_units;

  UPDATE public.yt_wallets
  SET mined_units = v_after_units,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  UPDATE public.yt_token_allocations
  SET distributed_units = distributed_units + v_reward_units,
      remaining_units = remaining_units - v_reward_units,
      updated_at = NOW()
  WHERE allocation_key = 'mining';

  UPDATE public.yt_liquidity_engine
  SET total_mined_units = total_mined_units + v_reward_units,
      mining_remaining_units = GREATEST(0, mining_remaining_units - v_reward_units),
      updated_at = NOW()
  WHERE singleton = true;

  -- تسجيل القيد في سجل معاملات التعدين الرسمي yt_ledger_transactions
  INSERT INTO public.yt_ledger_transactions (
    transaction_group_id,
    wallet_user_id,
    actor_user_id,
    transaction_type,
    balance_bucket,
    amount_units,
    balance_before_units,
    balance_after_units,
    reference_id,
    description,
    metadata,
    source_allocation_code
  )
  VALUES (
    v_group_id,
    p_user_id,
    NULL,
    'offerwall_gg_reward',
    'mined',
    v_reward_units,
    v_before_units,
    v_after_units,
    v_clean_tx,
    'مكافأة Offerwall.GG: ' || COALESCE(NULLIF(TRIM(COALESCE(p_offer_name, '')), ''), 'عرض مكتمل'),
    jsonb_build_object(
      'provider', 'offerwall.gg',
      'external_tx_id', v_clean_tx,
      'offer_id', p_offer_id,
      'offer_name', p_offer_name,
      'goal_id', p_goal_id,
      'raw_amount', p_raw_amount,
      'raw_currency', v_clean_currency,
      'payout_usd', p_payout_usd,
      'price_usd_per_yt', v_price_usd_per_yt,
      'price_yer_per_yt', v_price_yer_per_yt
    ),
    'mining'
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.yt_offerwall_gg_postbacks
  SET ledger_transaction_id = v_ledger_id
  WHERE id = v_postback_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'external_tx_id', v_clean_tx,
    'wallet_user_id', p_user_id,
    'reward_units', v_reward_units,
    'balance_before_units', v_before_units,
    'balance_after_units', v_after_units,
    'ledger_transaction_id', v_ledger_id,
    'price_usd_per_yt', v_price_usd_per_yt,
    'price_yer_per_yt', v_price_yer_per_yt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.yt_process_offerwall_gg_postback(TEXT, UUID, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.yt_process_offerwall_gg_postback(TEXT, UUID, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
