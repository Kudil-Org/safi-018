import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlatformConfig } from "../types";

let client: SupabaseClient | null = null;

export function getSupabase(config: PlatformConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }
  return client;
}
