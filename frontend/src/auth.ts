import { createClient, Session } from '@supabase/supabase-js';

// Vite exposes env vars via import.meta.env
// The user will set these in a .env file later
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

let currentSession: Session | null = null;

export async function initAuth(onAuthStateChange: (session: Session | null) => void) {
  // Check active session on load
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  onAuthStateChange(session);

  // Listen for changes
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    onAuthStateChange(session);
  });
}

export function getSessionToken(): string | null {
  return currentSession?.access_token || null;
}
