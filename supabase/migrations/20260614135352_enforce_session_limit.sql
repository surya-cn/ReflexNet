CREATE OR REPLACE FUNCTION enforce_session_limit(p_user_id uuid, keep_count int)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Double check that the calling user is operating on their own sessions
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: User ID mismatch.';
  END IF;

  DELETE FROM telemetry_sessions
  WHERE id IN (
    SELECT id FROM telemetry_sessions
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    OFFSET keep_count
  );
END;
$$;