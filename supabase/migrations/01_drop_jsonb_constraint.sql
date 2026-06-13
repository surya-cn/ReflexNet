-- ============================================================================
-- Migration: Drop Strict JSONB Constraints
-- ============================================================================
-- We are removing the explicit schema constraint on metrics_summary to allow 
-- for variable JSON structures depending on the drill mode (Flicking vs Tracking).

ALTER TABLE public.telemetry_sessions
DROP CONSTRAINT IF EXISTS metrics_summary_schema_check;
