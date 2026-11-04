import crypto from "node:crypto";
import fs from "node:fs";
import {
  loadDotEnv,
  optionalEnv,
  readJson,
  repoPath,
  requiredEnv,
  stripTrailingSlash
} from "./lib/common.mjs";

loadDotEnv();

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function calnodeBaseUrl() {
  const publicUrl = optionalEnv("CALNODE_PUBLIC_URL") ?? optionalEnv("PUBLIC_BOOKING_URL");
  if (publicUrl) {
    return stripTrailingSlash(publicUrl);
  }

  const internalUrl = optionalEnv("CALNODE_BASE_URL");
  if (internalUrl && !internalUrl.includes("//calnode:")) {
    return stripTrailingSlash(internalUrl);
  }

  throw new Error(
    "Set CALNODE_PUBLIC_URL or PUBLIC_BOOKING_URL to the Calnode HTTPS origin before verifying the fixture."
  );
}

async function main() {
  const fixturePath = argumentValue("--fixture") ?? repoPath("fixtures/conflicting-slot.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found at ${fixturePath}. Run npm --prefix scripts run fixture:create first.`);
  }

  const fixture = readJson(fixturePath);
  if (!fixture.booking_id || !fixture.start_at) {
    throw new Error(`Fixture at ${fixturePath} is missing booking_id or start_at.`);
  }

  const baseUrl = calnodeBaseUrl();
  const apiKey = requiredEnv("CALNODE_API_KEY");
  const timezone = fixture.timezone ?? requiredEnv("CALNODE_TIMEZONE");

  const response = await fetch(`${baseUrl}/v1/bookings`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `safi-fixture-verify-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      event_type_slug: fixture.event_type_slug,
      start_at: fixture.start_at,
      name: "SAFI Fixture Verification",
      email: "safi-fixture-verify@example.com",
      timezone
    }),
    signal: AbortSignal.timeout(20_000)
  });

  const text = await response.text();
  if (response.status === 409) {
    console.log(
      `PASS: Calnode rejected the duplicate booking for ${fixture.start_at} with HTTP 409 (fixture ${fixture.booking_id}).`
    );
    return;
  }

  throw new Error(
    `Expected HTTP 409 for the already-booked fixture slot, got ${response.status}: ${text.slice(0, 500)}`
  );
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
