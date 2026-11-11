-- ==============================================================================
-- KASB YEMEN PLATFORM (كسب اليمن للمهام المصغرة)
-- Versioned Migration: 004_system_error_logs.sql
-- Production System Error Logging & Supabase Database Monitoring
-- ==============================================================================

-- 1. Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CREATE SYSTEM ERROR LOGS TABLE
CREATE TABLE IF NOT EXISTS public.system_error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_code TEXT,
    error_type TEXT NOT NULL CHECK (error_type IN (
        'NETWORK_CONNECTION',
        'AUTHENTICATION',
        'PERMISSIONS_RLS',
        'MISSING_TABLE_COLUMN',
        'CONSTRAINT_VIOLATION',
        'POSTGRES_INTERNAL',
        'RPC_FUNCTION_ERROR',
        'DATA_WRITE_ERROR',
        'DATA_READ_ERROR',
        'STORAGE_ERROR',
        'TIMEOUT_ERROR',
        'UNKNOWN_ERROR'
    )),
    severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    operation TEXT NOT NULL,
    source_table TEXT,
    source_function TEXT,
    api_route TEXT,
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    request_id TEXT,
    environment TEXT NOT NULL DEFAULT 'Production',
    execution_duration_ms INT,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolution_note TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ
);

-- 3. INDEXES FOR HIGH-PERFORMANCE SEARCH & FILTERING
CREATE INDEX IF NOT EXISTS idx_system_error_logs_occurred_at ON public.system_error_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_error_type ON public.system_error_logs(error_type);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_resolved ON public.system_error_logs(resolved);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_source_table ON public.system_error_logs(source_table);

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage system error logs" ON public.system_error_logs;
CREATE POLICY "Admins can manage system error logs" ON public.system_error_logs
    FOR ALL USING (
        COALESCE(auth.jwt() ->> 'email', '') IN ('khalidalbuhiri@gmail.com', 'khalidalbuhiri97@gmail.com')
        OR EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 5. FUNCTION TO RECORD SYSTEM ERROR SAFELY (SECURE RPC)
CREATE OR REPLACE FUNCTION public.log_system_error(
    p_error_code TEXT,
    p_error_type TEXT,
    p_severity TEXT,
    p_operation TEXT,
    p_source_table TEXT,
    p_source_function TEXT,
    p_api_route TEXT,
    p_message TEXT,
    p_details JSONB DEFAULT '{}'::jsonb,
    p_request_id TEXT DEFAULT NULL,
    p_environment TEXT DEFAULT 'Production',
    p_execution_duration_ms INT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO public.system_error_logs (
        error_code,
        error_type,
        severity,
        operation,
        source_table,
        source_function,
        api_route,
        message,
        details,
        request_id,
        environment,
        execution_duration_ms,
        occurred_at
    ) VALUES (
        p_error_code,
        p_error_type,
        COALESCE(p_severity, 'MEDIUM'),
        p_operation,
        p_source_table,
        p_source_function,
        p_api_route,
        p_message,
        COALESCE(p_details, '{}'::jsonb),
        p_request_id,
        COALESCE(p_environment, 'Production'),
        p_execution_duration_ms,
        timezone('utc'::text, now())
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
    -- Prevent logging failures from aborting primary transactions
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
