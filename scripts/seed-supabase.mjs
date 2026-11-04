import { loadDotEnv, optionalEnv, requiredEnv, stripTrailingSlash } from "./lib/common.mjs";

loadDotEnv();

const perPage = 100;

async function adminRequest(supabaseUrl, serviceRoleKey, path, init = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(20_000)
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String(body.message)
        : typeof body === "string" && body
          ? body
          : `Supabase admin API returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return body;
}

async function listUsers(supabaseUrl, serviceRoleKey) {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await adminRequest(
      supabaseUrl,
      serviceRoleKey,
      `/auth/v1/admin/users?page=${page}&per_page=${perPage}`
    );
    const batch = Array.isArray(result?.users) ? result.users : [];
    users.push(...batch);
    if (batch.length < perPage) {
      break;
    }
  }
  return users;
}

async function ensureUser(supabaseUrl, serviceRoleKey, label) {
  const email = requiredEnv(`E2E_USER_${label}_EMAIL`);
  const password = requiredEnv(`E2E_USER_${label}_PASSWORD`);
  const users = await listUsers(supabaseUrl, serviceRoleKey);
  const existing = users.find((user) => String(user.email ?? "").toLowerCase() === email.toLowerCase());

  if (existing) {
    await adminRequest(supabaseUrl, serviceRoleKey, `/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, {
      method: "PUT",
      body: JSON.stringify({ password })
    });
    return { label, email, id: existing.id, action: "updated" };
  }

  const created = await adminRequest(supabaseUrl, serviceRoleKey, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { safi_acceptance_user: true }
    })
  });

  if (!created?.id) {
    throw new Error(`Supabase did not return an id for User ${label}.`);
  }

  return { label, email, id: created.id, action: "created" };
}

async function main() {
  const supabaseUrl = stripTrailingSlash(optionalEnv("PUBLIC_SUPABASE_URL") ?? requiredEnv("SUPABASE_URL"));
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const accounts = [
    await ensureUser(supabaseUrl, serviceRoleKey, "A"),
    await ensureUser(supabaseUrl, serviceRoleKey, "B")
  ];

  if (accounts[0].id === accounts[1].id) {
    throw new Error("E2E_USER_A and E2E_USER_B resolved to the same Supabase user.");
  }

  for (const account of accounts) {
    console.log(`User ${account.label}: ${account.email} (${account.action}, id ${account.id})`);
  }
  console.log("Supabase acceptance users are ready. Passwords were not printed.");
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
