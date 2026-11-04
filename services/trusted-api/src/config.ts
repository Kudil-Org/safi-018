import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.SAFI_ENV_FILE ?? "../../.env" });

const EnvSchema = z.object({
  SAFI_API_PORT: z.coerce.number().int().positive().default(8080),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SAFI_CONTEXT_SECRET: z.string().min(32),
  SAFI_INTERNAL_TOKEN: z.string().min(16),
  SAFI_CONTEXT_TTL_SECONDS: z.coerce.number().int().positive().default(14400),
  SAFI_ARTIFACT_TEMPLATE_REF: z.string().min(1).default("checklist.v1"),
  WINDMILL_CHAT_TOKEN: z.string().min(1),
  WINDMILL_WORKSPACE: z.string().min(1),
  WINDMILL_FLOW_PATH: z.string().min(1),
  PUBLIC_WINDMILL_BASE_URL: z.string().url(),
  WINDMILL_INTERNAL_BASE_URL: z.string().url().default("http://windmill_server:8000"),
  PUBLIC_PLATFORM_URL: z.string().url().default("https://platform.example.com"),
  CALNODE_BASE_URL: z.string().url(),
  CALNODE_API_KEY: z.string().min(1),
  CALNODE_EVENT_SLUG: z.string().min(1),
  CALNODE_TIMEZONE: z.string().min(1).default("UTC"),
  SAFI_RELEASE: z.string().min(1).default("0.1.0"),
  CORS_ORIGINS: z.string().default("http://localhost:5173")
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid trusted-api configuration:\n${missing.join("\n")}`);
}

const env = parsed.data;

export const config = {
  port: env.SAFI_API_PORT,
  release: env.SAFI_RELEASE,
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
  },
  context: {
    secret: env.SAFI_CONTEXT_SECRET,
    ttlSeconds: env.SAFI_CONTEXT_TTL_SECONDS,
    issuer: "safi-trusted-api",
    audience: "safi-platform"
  },
  internalToken: env.SAFI_INTERNAL_TOKEN,
  artifactTemplateRef: env.SAFI_ARTIFACT_TEMPLATE_REF,
  windmill: {
    baseUrl: env.PUBLIC_WINDMILL_BASE_URL,
    internalBaseUrl: env.WINDMILL_INTERNAL_BASE_URL,
    workspace: env.WINDMILL_WORKSPACE,
    flowPath: env.WINDMILL_FLOW_PATH,
    chatToken: env.WINDMILL_CHAT_TOKEN
  },
  calnode: {
    baseUrl: env.CALNODE_BASE_URL,
    apiKey: env.CALNODE_API_KEY,
    eventSlug: env.CALNODE_EVENT_SLUG,
    timezone: env.CALNODE_TIMEZONE
  },
  platformUrl: env.PUBLIC_PLATFORM_URL,
  corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
} as const;
