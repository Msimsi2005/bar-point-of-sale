const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const envApiBase = import.meta.env.VITE_API_BASE;

if (!envSupabaseUrl || !envSupabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be defined in your environment.");
}

export const SUPABASE_URL = envSupabaseUrl;
export const SUPABASE_ANON_KEY = envSupabaseAnonKey;

function normalizeApiBase(raw: string) {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.replace(/\/make-server-b88a7963$/, "");
}

export const API_BASE = normalizeApiBase(envApiBase ?? `${SUPABASE_URL}/functions/v1/server`);
