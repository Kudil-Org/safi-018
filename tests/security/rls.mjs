import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

const baseUrl = (
  process.env.SAFI_API_BASE_URL ??
  process.env.E2E_BASE_URL ??
  process.env.PUBLIC_PLATFORM_URL ??
  ""
).replace(/\/+$/, "");

if (!baseUrl) {
  throw new Error("Set SAFI_API_BASE_URL, E2E_BASE_URL or PUBLIC_PLATFORM_URL.");
}

const credentials = {
  a: {
    email: required("E2E_USER_A_EMAIL"),
    password: required("E2E_USER_A_PASSWORD")
  },
  b: {
    email: required("E2E_USER_B_EMAIL"),
    password: required("E2E_USER_B_PASSWORD")
  }
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function api(token, path, init = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}

const configResponse = await fetch(`${baseUrl}/api/config`);
assert(configResponse.ok, `GET /api/config failed with ${configResponse.status}.`);
const config = await configResponse.json();

const makeClient = () =>
  createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

const authA = makeClient();
const authB = makeClient();
const anon = makeClient();

const signIn = async (client, account) => {
  const { data, error } = await client.auth.signInWithPassword(account);
  assert(!error && data.session, `Sign-in failed for ${account.email}: ${error?.message ?? "no session"}`);
  return { user: data.user, token: data.session.access_token };
};

const a = await signIn(authA, credentials.a);
const b = await signIn(authB, credentials.b);
assert(a.user.id !== b.user.id, "E2E_USER_A and E2E_USER_B must be different Supabase users.");

const created = await api(a.token, "/artifacts", {
  method: "POST",
  body: JSON.stringify({ title: `RLS proof ${Date.now()}` })
});
assert(created.status === 201, `User A could not create an Artifact: ${created.status} ${JSON.stringify(created.body)}`);
const artifact = created.body.artifact;
assert(artifact?.id, "Created Artifact response did not include an id.");

const ownRead = await api(a.token, `/artifacts/${artifact.id}`);
assert(ownRead.status === 200, `Owner read failed with ${ownRead.status}.`);

const foreignRead = await api(b.token, `/artifacts/${artifact.id}`);
assert(foreignRead.status === 404, `User B read User A's Artifact: expected 404, got ${foreignRead.status}.`);

const foreignList = await authB.from("artifacts").select("id").eq("id", artifact.id);
assert(!foreignList.error, `User B direct Artifact select errored unexpectedly: ${foreignList.error?.message}`);
assert((foreignList.data ?? []).length === 0, "RLS leaked User A's Artifact to User B through a direct select.");

const foreignUpdate = await authB
  .from("artifacts")
  .update({ state: { kind: "checklist", title: "tampered", items: [] } })
  .eq("id", artifact.id)
  .select();
assert(
  foreignUpdate.error || (foreignUpdate.data ?? []).length === 0,
  "RLS allowed User B to update User A's Artifact."
);

const foreignInsert = await authB.from("artifacts").insert({
  owner_id: a.user.id,
  template_ref: "meeting-follow-up/v1",
  state: { kind: "checklist", title: "forged", items: [] },
  version: 1
});
assert(foreignInsert.error, "RLS allowed User B to insert an Artifact owned by User A.");

const foreignRpc = await authB.rpc("safi_mutate_artifact", {
  p_artifact_id: artifact.id,
  p_expected_version: artifact.version,
  p_state: { kind: "checklist", title: "tampered", items: [] },
  p_mutation: { op: "set_title", title: "tampered" }
});
assert(foreignRpc.error, "The mutation RPC allowed User B to mutate User A's Artifact.");

const versionsRead = await authA
  .from("artifact_versions")
  .select("id, version")
  .eq("artifact_id", artifact.id);
assert(!versionsRead.error, `Owner history read failed: ${versionsRead.error?.message}`);
assert((versionsRead.data ?? []).some((row) => row.version === 1), "Version 1 history is missing.");

const foreignVersions = await authB
  .from("artifact_versions")
  .select("id")
  .eq("artifact_id", artifact.id);
assert(!foreignVersions.error, `User B history select errored unexpectedly: ${foreignVersions.error?.message}`);
assert((foreignVersions.data ?? []).length === 0, "RLS leaked Artifact history to User B.");

const anonRead = await anon.from("artifacts").select("id").eq("id", artifact.id);
assert(
  anonRead.error || (anonRead.data ?? []).length === 0,
  "Anonymous caller could read a private Artifact."
);

console.log("PASS: owner reads, cross-user denial, RPC denial, history isolation, and anonymous denial.");
