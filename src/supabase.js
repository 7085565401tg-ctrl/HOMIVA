import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigured = Boolean(url && publishableKey);
export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { 'X-Client-Info': 'homiva-web' } }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('HOMIVA cloud services are not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment, then redeploy.');
  }
  return supabase;
}
