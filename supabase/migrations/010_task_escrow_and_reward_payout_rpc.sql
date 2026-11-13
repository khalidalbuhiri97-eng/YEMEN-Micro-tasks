-- ==============================================================================
-- Migration 010: Atomic Task Escrow & Reward Payout RPC + Schema Alignment
-- Platform: Yemen Micro-tasks (كسب اليمن)
-- Live Schema: financial_accounts, ledger_transactions, ledger_entries, wallets,
--              tasks, task_submissions, user_roles, admin_logs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Backfill Escrow Accounts & Funding Ledger Transactions for Unfunded Tasks
--    (e.g., tasks created directly into public.tasks bypassing create_funded_task)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_task RECORD;
    v_treasury RECORD;
    v_escrow_id UUID;
    v_tx_id UUID;
    v_budget BIGINT;
    v_idempotency_key TEXT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_treasury
    FROM public.financial_accounts
    WHERE account_code = 'PLATFORM-TREASURY'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE NOTICE 'PLATFORM-TREASURY account not found; skipping task escrow backfill.';
        RETURN;
    END IF;

    FOR v_task IN
        SELECT *
        FROM public.tasks
        WHERE escrow_account_id IS NULL
          AND total_budget_units > 0
          AND LOWER(status) IN ('active', 'paused')
        ORDER BY created_at ASC
        FOR UPDATE
    LOOP
        v_idempotency_key := 'TASK-FUNDING:' || v_task.id::text;

        -- Skip if funding transaction already exists
        SELECT id INTO v_tx_id
        FROM public.ledger_transactions
        WHERE idempotency_key = v_idempotency_key;

        IF FOUND THEN
            SELECT id INTO v_escrow_id
            FROM public.financial_accounts
            WHERE account_code = 'TASK-ESCROW-' || v_task.id::text;

            UPDATE public.tasks
            SET escrow_account_id = v_escrow_id,
                funding_transaction_id = v_tx_id
            WHERE id = v_task.id;
            CONTINUE;
        END IF;

        v_budget := v_task.total_budget_units;

        -- Re-read treasury balance
        SELECT * INTO v_treasury
        FROM public.financial_accounts
        WHERE id = v_treasury.id
        FOR UPDATE;

        IF v_treasury.balance_units < v_budget THEN
            RAISE EXCEPTION 'Insufficient PLATFORM-TREASURY balance to backfill task % (needed %, available %)',
                v_task.id, v_budget, v_treasury.balance_units;
        END IF;

        -- Create or fetch task ESCROW financial account
        SELECT id INTO v_escrow_id
        FROM public.financial_accounts
        WHERE account_code = 'TASK-ESCROW-' || v_task.id::text
        FOR UPDATE;

        IF NOT FOUND THEN
            INSERT INTO public.financial_accounts (
                account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at
            ) VALUES (
                'TASK-ESCROW-' || v_task.id::text, 'treasury', NULL, NULL, 'credit', 0, 'active', v_now
            )
            RETURNING id INTO v_escrow_id;
        END IF;

        -- Post balanced task_budget_reservation transaction
        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'task_budget_reservation',
            'TASK-FUNDING',
            v_idempotency_key,
            'posted',
            jsonb_build_object(
                'task_id', v_task.id,
                'reward_units', v_task.reward_units,
                'slots', v_task.slots,
                'budget_units', v_budget,
                'backfilled', true
            ),
            v_task.created_by,
            v_now
        )
        RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_treasury.id, 'debit', v_budget, 'Task budget reserved (backfill)', v_now),
            (v_tx_id, v_escrow_id, 'credit', v_budget, 'Task escrow funding (backfill)', v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN normal_side = 'debit' THEN v_budget ELSE -v_budget END
        WHERE id = v_treasury.id;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN normal_side = 'credit' THEN v_budget ELSE -v_budget END
        WHERE id = v_escrow_id;

        UPDATE public.tasks
        SET escrow_account_id = v_escrow_id,
            funding_transaction_id = v_tx_id
        WHERE id = v_task.id;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Reconcile Historically Approved Submissions Missing reward_transaction_id
--    (Submissions approved prior to fix where status became 'approved' without payout)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_sub RECORD;
    v_task RECORD;
    v_escrow RECORD;
    v_wallet RECORD;
    v_wallet_acc RECORD;
    v_tx_id UUID;
    v_idempotency_key TEXT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    FOR v_sub IN
        SELECT *
        FROM public.task_submissions
        WHERE LOWER(status) = 'approved'
          AND reward_transaction_id IS NULL
        ORDER BY created_at ASC
        FOR UPDATE
    LOOP
        v_idempotency_key := 'TASK_REWARD_PAYOUT:' || v_sub.id::text;

        SELECT id INTO v_tx_id
        FROM public.ledger_transactions
        WHERE idempotency_key IN (v_idempotency_key, 'TASK-REWARD:' || v_sub.id::text)
        LIMIT 1;

        IF FOUND THEN
            UPDATE public.task_submissions
            SET reward_transaction_id = v_tx_id
            WHERE id = v_sub.id;
            CONTINUE;
        END IF;

        SELECT * INTO v_task
        FROM public.tasks
        WHERE id = v_sub.task_id
        FOR UPDATE;

        IF NOT FOUND OR v_task.escrow_account_id IS NULL OR v_task.reward_units <= 0 THEN
            CONTINUE;
        END IF;

        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE user_id = v_sub.user_id
        LIMIT 1;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        SELECT * INTO v_wallet_acc
        FROM public.financial_accounts
        WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND status = 'active'
        FOR UPDATE;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        SELECT * INTO v_escrow
        FROM public.financial_accounts
        WHERE id = v_task.escrow_account_id AND status = 'active'
        FOR UPDATE;

        IF NOT FOUND OR v_escrow.balance_units < v_task.reward_units THEN
            CONTINUE;
        END IF;

        INSERT INTO public.ledger_transactions (
            transaction_type, reference, idempotency_key, status, metadata, created_by, created_at
        ) VALUES (
            'TASK_REWARD_PAYOUT',
            'TASK-SUBMISSION:' || v_sub.id::text,
            v_idempotency_key,
            'posted',
            jsonb_build_object(
                'task_id', v_task.id,
                'submission_id', v_sub.id,
                'performer_user_id', v_sub.user_id,
                'reward_units', v_task.reward_units,
                'reconciled_backfill', true
            ),
            v_sub.reviewed_by,
            v_now
        )
        RETURNING id INTO v_tx_id;

        INSERT INTO public.ledger_entries (transaction_id, account_id, entry_side, amount_units, memo, created_at)
        VALUES
            (v_tx_id, v_escrow.id, 'debit', v_task.reward_units, 'Task reward payout (reconciled): ' || v_task.title, v_now),
            (v_tx_id, v_wallet_acc.id, 'credit', v_task.reward_units, 'Task completion reward (reconciled): ' || v_task.title, v_now);

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN normal_side = 'debit' THEN v_task.reward_units ELSE -v_task.reward_units END
        WHERE id = v_escrow.id;

        UPDATE public.financial_accounts
        SET balance_units = balance_units + CASE WHEN normal_side = 'credit' THEN v_task.reward_units ELSE -v_task.reward_units END
        WHERE id = v_wallet_acc.id;

        UPDATE public.task_submissions
        SET reward_transaction_id = v_tx_id
        WHERE id = v_sub.id;

        UPDATE public.tasks
        SET approved_count = approved_count + 1,
            budget_spent_yer = COALESCE(budget_spent_yer, 0) + v_task.reward_units,
            status = CASE WHEN approved_count + 1 >= slots THEN 'completed' ELSE status END
        WHERE id = v_task.id;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Update submit_task_proof to support { text, url, images, storage_path }
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_task_proof(
    p_task_id UUID,
    p_proof JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_task RECORD;
    v_key TEXT;
    v_text TEXT;
    v_url TEXT;
    v_storage_path TEXT;
    v_images_count INT := 0;
    v_submission_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_task_id IS NULL THEN
        RAISE EXCEPTION 'Task ID is required';
    END IF;

    IF p_proof IS NULL OR jsonb_typeof(p_proof) <> 'object' THEN
        RAISE EXCEPTION 'Proof payload must be a JSON object';
    END IF;

    -- Validate only supported keys
    FOR v_key IN SELECT jsonb_object_keys(p_proof)
    LOOP
        IF v_key NOT IN ('text', 'url', 'images', 'storage_path') THEN
            RAISE EXCEPTION 'Unsupported proof field';
        END IF;
    END LOOP;

    v_text := NULLIF(TRIM(COALESCE(p_proof->>'text', '')), '');
    v_url := NULLIF(TRIM(COALESCE(p_proof->>'url', '')), '');
    v_storage_path := NULLIF(TRIM(COALESCE(p_proof->>'storage_path', '')), '');

    IF p_proof ? 'images' AND jsonb_typeof(p_proof->'images') = 'array' THEN
        v_images_count := jsonb_array_length(p_proof->'images');
    END IF;

    IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN
        RAISE EXCEPTION 'Proof must contain valid text, HTTPS URL, or storage path';
    END IF;

    IF v_text IS NULL AND v_url IS NULL AND v_storage_path IS NULL AND v_images_count = 0 THEN
        RAISE EXCEPTION 'Proof must contain valid text, HTTPS URL, or storage path';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;

    IF LOWER(v_task.status) <> 'active' THEN
        RAISE EXCEPTION 'Task is not active';
    END IF;

    IF v_task.deadline_at IS NOT NULL AND v_task.deadline_at < NOW() THEN
        RAISE EXCEPTION 'Task deadline has passed';
    END IF;

    IF v_task.approved_count >= v_task.slots THEN
        RAISE EXCEPTION 'Task slots are full';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.task_submissions
        WHERE task_id = p_task_id
          AND user_id = v_user_id
          AND LOWER(status) IN ('pending', 'under_review', 'approved')
    ) THEN
        RAISE EXCEPTION 'You already have a pending or approved submission for this task';
    END IF;

    INSERT INTO public.task_submissions (
        task_id, user_id, proof, status, created_at
    ) VALUES (
        p_task_id, v_user_id, p_proof, 'pending', NOW()
    )
    RETURNING id INTO v_submission_id;

    RETURN v_submission_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Atomic Double-Entry Payout RPC: review_task_submission
--    Enforces admin role in DB, row locking, ESCROW balance check,
--    TASK_REWARD_PAYOUT transaction, debit ESCROW / credit performer wallet,
--    normal_side accounting, idempotency, and full rollback on failure.
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.review_task_submission(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.review_task_submission(
    p_submission_id UUID,
    p_decision TEXT,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_decision TEXT := LOWER(TRIM(COALESCE(p_decision, '')));
    v_clean_note TEXT := NULLIF(TRIM(COALESCE(p_review_note, '')), '');
    v_now TIMESTAMPTZ := NOW();
    v_sub RECORD;
    v_task RECORD;
    v_wallet RECORD;
    v_escrow_acc RECORD;
    v_wallet_acc RECORD;
    v_existing_tx RECORD;
    v_tx_id UUID;
    v_idempotency_key TEXT;
    v_legacy_idempotency_key TEXT;
    v_escrow_new_bal BIGINT;
    v_wallet_new_bal BIGINT;
    v_rows_affected INT := 0;
BEGIN
    -- 1. Strict Database-Level Admin Verification (requires verified admin JWT)
    IF v_admin_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    -- Also verify admin role explicitly in user_roles
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = v_admin_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Administrator permission required' USING ERRCODE = '42501';
    END IF;

    -- 2. Validate Decision & Submission ID
    IF p_submission_id IS NULL THEN
        RAISE EXCEPTION 'Submission ID is required';
    END IF;

    IF v_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Decision must be approve or reject';
    END IF;

    -- 3. Transaction-Level Advisory Lock on submission_id to eliminate concurrent double-payouts
    PERFORM pg_advisory_xact_lock(hashtext('review_task_submission_' || p_submission_id::text));

    -- 4. Lock Submission Row
    SELECT * INTO v_sub
    FROM public.task_submissions
    WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found';
    END IF;

    v_idempotency_key := 'TASK_REWARD_PAYOUT:' || p_submission_id::text;
    v_legacy_idempotency_key := 'TASK-REWARD:' || p_submission_id::text;

    -- 5. Idempotency & State Conflict Guards
    IF LOWER(v_sub.status) = 'approved' THEN
        IF v_decision = 'reject' THEN
            RAISE EXCEPTION 'Cannot reject an already approved submission';
        END IF;

        IF v_sub.reward_transaction_id IS NOT NULL THEN
            SELECT balance_units INTO v_wallet_new_bal
            FROM public.financial_accounts
            WHERE owner_user_id = v_sub.user_id AND account_type = 'wallet'
            LIMIT 1;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent', true,
                'submission_id', v_sub.id,
                'status', 'approved',
                'transaction_id', v_sub.reward_transaction_id,
                'performer_user_id', v_sub.user_id,
                'wallet_new_balance', COALESCE(v_wallet_new_bal, 0)
            );
        END IF;
    END IF;

    IF LOWER(v_sub.status) = 'rejected' THEN
        IF v_decision = 'approve' THEN
            RAISE EXCEPTION 'Cannot approve an already rejected submission';
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'submission_id', v_sub.id,
            'status', 'rejected'
        );
    END IF;

    -- 6. Handle Rejection (Zero Ledger / Balance Movement)
    IF v_decision = 'reject' THEN
        UPDATE public.task_submissions
        SET status = 'rejected',
            review_note = v_clean_note,
            reviewed_by = v_admin_id,
            reviewed_at = v_now
        WHERE id = p_submission_id;

        INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
        VALUES (
            v_admin_id,
            'REJECT_SUBMISSION',
            'task_submission',
            p_submission_id,
            jsonb_build_object('task_id', v_sub.task_id, 'user_id', v_sub.user_id, 'review_note', v_clean_note),
            v_now
        );

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', false,
            'submission_id', p_submission_id,
            'status', 'rejected',
            'reviewed_by', v_admin_id,
            'reviewed_at', v_now
        );
    END IF;

    -- 7. Idempotency Check against ledger_transactions before posting
    SELECT id INTO v_existing_tx
    FROM public.ledger_transactions
    WHERE idempotency_key IN (v_idempotency_key, v_legacy_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
        UPDATE public.task_submissions
        SET status = 'approved',
            reward_transaction_id = COALESCE(reward_transaction_id, v_existing_tx.id),
            reviewed_by = COALESCE(reviewed_by, v_admin_id),
            reviewed_at = COALESCE(reviewed_at, v_now)
        WHERE id = p_submission_id;

        SELECT balance_units INTO v_wallet_new_bal
        FROM public.financial_accounts
        WHERE owner_user_id = v_sub.user_id AND account_type = 'wallet'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'submission_id', p_submission_id,
            'status', 'approved',
            'transaction_id', v_existing_tx.id,
            'performer_user_id', v_sub.user_id,
            'wallet_new_balance', COALESCE(v_wallet_new_bal, 0)
        );
    END IF;

    -- 8. Lock & Verify Task + Escrow Link
    SELECT * INTO v_task
    FROM public.tasks
    WHERE id = v_sub.task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;

    IF v_task.reward_units IS NULL OR v_task.reward_units <= 0 THEN
        RAISE EXCEPTION 'Invalid task reward units';
    END IF;

    IF v_task.approved_count >= v_task.slots THEN
        RAISE EXCEPTION 'Task slots have already been filled';
    END IF;

    IF v_task.escrow_account_id IS NULL THEN
        RAISE EXCEPTION 'Task ESCROW account is not configured or funded';
    END IF;

    -- 9. Verify Performer Wallet & Financial Account
    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_sub.user_id
    LIMIT 1;

    IF NOT FOUND OR LOWER(v_wallet.status) <> 'active' THEN
        RAISE EXCEPTION 'Performer wallet not found or inactive';
    END IF;

    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE wallet_id = v_wallet.id AND account_type = 'wallet' AND LOWER(status) = 'active'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Performer financial account not found or inactive';
    END IF;

    IF v_task.escrow_account_id = v_wallet_acc.id THEN
        RAISE EXCEPTION 'Escrow account cannot equal performer wallet account';
    END IF;

    -- 10. Deterministic Account Row Locking (Prevent Deadlocks)
    IF v_task.escrow_account_id < v_wallet_acc.id THEN
        PERFORM id FROM public.financial_accounts WHERE id = v_task.escrow_account_id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_wallet_acc.id FOR UPDATE;
    ELSE
        PERFORM id FROM public.financial_accounts WHERE id = v_wallet_acc.id FOR UPDATE;
        PERFORM id FROM public.financial_accounts WHERE id = v_task.escrow_account_id FOR UPDATE;
    END IF;

    -- Re-fetch Escrow Account AFTER Locking and Check Balance
    SELECT * INTO v_escrow_acc
    FROM public.financial_accounts
    WHERE id = v_task.escrow_account_id;

    IF NOT FOUND OR LOWER(v_escrow_acc.status) <> 'active' THEN
        RAISE EXCEPTION 'Task ESCROW account not found or inactive';
    END IF;

    IF v_escrow_acc.balance_units < v_task.reward_units THEN
        RAISE EXCEPTION 'Insufficient task ESCROW balance (available %, required %)',
            v_escrow_acc.balance_units, v_task.reward_units;
    END IF;

    -- Re-fetch Performer Account AFTER Locking
    SELECT * INTO v_wallet_acc
    FROM public.financial_accounts
    WHERE id = v_wallet_acc.id;

    -- 11. Create Atomic Ledger Transaction (TASK_REWARD_PAYOUT)
    INSERT INTO public.ledger_transactions (
        transaction_type,
        reference,
        idempotency_key,
        status,
        metadata,
        created_by,
        created_at
    ) VALUES (
        'TASK_REWARD_PAYOUT',
        'TASK-SUBMISSION:' || p_submission_id::text,
        v_idempotency_key,
        'posted',
        jsonb_build_object(
            'task_id', v_task.id,
            'task_title', v_task.title,
            'submission_id', p_submission_id,
            'performer_user_id', v_sub.user_id,
            'wallet_id', v_wallet.id,
            'escrow_account_id', v_escrow_acc.id,
            'wallet_account_id', v_wallet_acc.id,
            'reward_units', v_task.reward_units
        ),
        v_admin_id,
        v_now
    )
    RETURNING id INTO v_tx_id;

    -- 12. Create Balanced Double-Entry Ledger Entries
    -- Debit Task ESCROW account, Credit Performer Wallet account
    INSERT INTO public.ledger_entries (
        transaction_id, account_id, entry_side, amount_units, memo, created_at
    ) VALUES
        (v_tx_id, v_escrow_acc.id, 'debit', v_task.reward_units, 'Task reward payout from escrow: ' || v_task.title, v_now),
        (v_tx_id, v_wallet_acc.id, 'credit', v_task.reward_units, 'Task completion reward: ' || v_task.title, v_now);

    -- 13. Update Financial Account Balances Strictly Following normal_side
    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE
        WHEN LOWER(normal_side) = 'debit' THEN v_task.reward_units
        ELSE -v_task.reward_units
    END
    WHERE id = v_escrow_acc.id
    RETURNING balance_units INTO v_escrow_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_escrow_new_bal < 0 THEN
        RAISE EXCEPTION 'Failed to update ESCROW balance safely';
    END IF;

    UPDATE public.financial_accounts
    SET balance_units = balance_units + CASE
        WHEN LOWER(normal_side) = 'credit' THEN v_task.reward_units
        ELSE -v_task.reward_units
    END
    WHERE id = v_wallet_acc.id
    RETURNING balance_units INTO v_wallet_new_bal;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected <> 1 OR v_wallet_new_bal < 0 THEN
        RAISE EXCEPTION 'Failed to update performer wallet balance safely';
    END IF;

    -- 14. Update Submission Status & Reward Reference
    UPDATE public.task_submissions
    SET status = 'approved',
        review_note = v_clean_note,
        reviewed_by = v_admin_id,
        reviewed_at = v_now,
        reward_transaction_id = v_tx_id
    WHERE id = p_submission_id;

    -- 15. Update Task Progress & Auto-Complete if Slots Filled
    UPDATE public.tasks
    SET approved_count = approved_count + 1,
        budget_spent_yer = COALESCE(budget_spent_yer, 0) + v_task.reward_units,
        status = CASE WHEN approved_count + 1 >= slots THEN 'completed' ELSE status END
    WHERE id = v_task.id;

    -- 16. Record Admin Audit Log
    INSERT INTO public.admin_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
        v_admin_id,
        'APPROVE_SUBMISSION_PAYOUT',
        'task_submission',
        p_submission_id,
        jsonb_build_object(
            'task_id', v_task.id,
            'performer_user_id', v_sub.user_id,
            'reward_units', v_task.reward_units,
            'transaction_id', v_tx_id,
            'escrow_new_balance', v_escrow_new_bal,
            'wallet_new_balance', v_wallet_new_bal
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'submission_id', p_submission_id,
        'status', 'approved',
        'transaction_id', v_tx_id,
        'transaction_type', 'TASK_REWARD_PAYOUT',
        'reward_units', v_task.reward_units,
        'performer_user_id', v_sub.user_id,
        'escrow_new_balance', v_escrow_new_bal,
        'wallet_new_balance', v_wallet_new_bal,
        'reviewed_by', v_admin_id,
        'reviewed_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_task_proof(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_proof(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_task_submission(UUID, TEXT, TEXT) TO authenticated, service_role;
