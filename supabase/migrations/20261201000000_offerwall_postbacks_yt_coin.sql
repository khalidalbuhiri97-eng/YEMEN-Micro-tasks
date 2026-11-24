-- ==============================================================================
-- Migration: Offerwall Postbacks with YT Coin Routing (Strictly Isolated)
-- Date: 2026-12-01
-- Rules:
--   - Table offerwall_postbacks with UNIQUE constraint on tx (transaction id)
--   - RPC process_offerwall_postback handles positive amounts (rewards) and negative (reversals)
--   - Routes rewards exclusively to yt_coin system (yt_coin.post_journal_transaction)
--   - Zero modification to wallets, financial_accounts, ledger_transactions, ledger_entries.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.offerwall_postbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tx VARCHAR(255) NOT NULL UNIQUE,
  amount NUMERIC(18, 6) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'credited',
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offerwall_postbacks_user_id ON public.offerwall_postbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_offerwall_postbacks_tx ON public.offerwall_postbacks(tx);

ALTER TABLE public.offerwall_postbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on offerwall_postbacks"
  ON public.offerwall_postbacks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Atomic RPC function to process offerwall postback and route to YT Coin
CREATE OR REPLACE FUNCTION public.process_offerwall_postback(
  p_user_id UUID,
  p_tx VARCHAR,
  p_amount NUMERIC,
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id UUID;
  v_status VARCHAR(50);
  v_yt_units BIGINT;
BEGIN
  -- Check for duplicate tx (Idempotency)
  SELECT id, status INTO v_existing_id, v_status
  FROM public.offerwall_postbacks
  WHERE tx = p_tx;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'status', v_status,
      'message', 'Transaction already processed'
    );
  END IF;

  -- Determine status
  IF p_amount < 0 THEN
    v_status := 'reversed';
  ELSE
    v_status := 'credited';
  END IF;

  -- Insert offerwall postback record (UNIQUE tx constraint ensures atomic race-condition safety)
  INSERT INTO public.offerwall_postbacks (user_id, tx, amount, status, raw_payload)
  VALUES (p_user_id, p_tx, p_amount, v_status, p_raw_payload);

  -- Route exclusively to YT Coin system (yt_coin schema)
  v_yt_units := ROUND(ABS(p_amount) * 1000)::BIGINT;

  IF v_yt_units > 0 THEN
    IF p_amount >= 0 THEN
      PERFORM yt_coin.post_journal_transaction(
        p_actor_id := p_user_id,
        p_event_type := 'offerwall_reward',
        p_source_account := 'treasury',
        p_target_user_id := p_user_id,
        p_units := v_yt_units,
        p_reference_id := p_tx,
        p_metadata := p_raw_payload
      );
    ELSE
      PERFORM yt_coin.post_journal_transaction(
        p_actor_id := p_user_id,
        p_event_type := 'offerwall_reversal',
        p_source_account := 'user',
        p_source_user_id := p_user_id,
        p_target_account := 'treasury',
        p_units := v_yt_units,
        p_reference_id := p_tx,
        p_metadata := p_raw_payload
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'status', v_status,
    'amount', p_amount
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'status', 'credited',
      'message', 'Concurrent duplicate transaction caught'
    );
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.process_offerwall_postback FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_offerwall_postback TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
