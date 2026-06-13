-- ============================================================================
-- ReflexNet Database Schema (Supabase)
-- ============================================================================

-- Create the telemetry_sessions table
CREATE TABLE IF NOT EXISTS public.telemetry_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_game TEXT NOT NULL,
    dpi INTEGER NOT NULL,
    polling_rate INTEGER NOT NULL,
    metrics_summary JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce strict schema on the JSONB metrics_summary
-- Ensures consistency for frontend graphing and AI parsing
ALTER TABLE public.telemetry_sessions
ADD CONSTRAINT metrics_summary_schema_check
CHECK (
    jsonb_typeof(metrics_summary) = 'object' AND
    metrics_summary ? 'overshoot_rate' AND
    metrics_summary ? 'undershoot_rate' AND
    metrics_summary ? 'ttk_ms' AND
    metrics_summary ? 'path_efficiency'
);

-- Create an index to speed up the Rate Limiter query
CREATE INDEX IF NOT EXISTS idx_telemetry_sessions_user_time 
ON public.telemetry_sessions(user_id, created_at);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE public.telemetry_sessions ENABLE ROW LEVEL SECURITY;

-- 1. Insert Policy: Users can only upload data matching their own Auth UID
CREATE POLICY "Users can insert their own telemetry"
ON public.telemetry_sessions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 2. Select Policy: Users can only view their own historical data
CREATE POLICY "Users can view their own telemetry"
ON public.telemetry_sessions
FOR SELECT
USING (auth.uid() = user_id);

-- ============================================================================
-- Profiles Table & RLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_groq_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

