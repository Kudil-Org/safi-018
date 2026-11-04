import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { HttpError } from "./http-error.js";
import type { AuthenticatedUser } from "./types.js";

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
} as const;

export const authClient = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  clientOptions
);

export const adminClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  clientOptions
);

export async function verifySupabaseSession(accessToken: string): Promise<AuthenticatedUser> {
  if (!accessToken || accessToken.length < 20) {
    throw new HttpError(401, "missing_session", "A Supabase access token is required.");
  }

  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new HttpError(401, "invalid_session", "The Supabase session is invalid or expired.");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null
  };
}
