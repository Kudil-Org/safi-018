import crypto from "node:crypto";
import fs from "node:fs";
import {
  loadDotEnv,
  optionalEnv,
  readJson,
  repoPath,
  requiredEnv,
  stripTrailingSlash,
  writeJson
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
    "Set CALNODE_PUBLIC_URL or PUBLIC_BOOKING_URL to the Calnode HTTPS origin before creating the fixture."
  );
}

let baseUrl;
let apiKey;
let eventTypeSlug;
let timezone;
let contactName;
let contactEmail;
let days;
let outputPath;
let force;

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
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

  return { ok: response.ok, status: response.status, body, text };
}

function errorMessage(result) {
  if (typeof result.body === "object" && result.body !== null && "error" in result.body) {
    return String(result.body.error);
  }
  return result.text ? result.text.slice(0, 500) : `Calnode returned HTTP ${result.status}`;
}

function dates() {
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function existingFixture() {
  if (force || !fs.existsSync(outputPath)) {
    return null;
  }

  const fixture = readJson(outputPath);
  if (!fixture.booking_id) {
    return null;
  }

  const result = await request(`/v1/bookings/${encodeURIComponent(fixture.booking_id)}`);
  if (result.ok && result.body && result.body.status !== "cancelled") {
    return fixture;
  }
  return null;
}

async function main() {
  baseUrl = calnodeBaseUrl();
  apiKey = requiredEnv("CALNODE_API_KEY");
  eventTypeSlug = requiredEnv("CALNODE_EVENT_SLUG");
  timezone = requiredEnv("CALNODE_TIMEZONE");
  contactName = optionalEnv("FIXTURE_CONTACT_NAME") ?? "SAFI Conflict Fixture";
  contactEmail = optionalEnv("FIXTURE_CONTACT_EMAIL") ?? "safi-fixture@example.com";
  days = Number.parseInt(optionalEnv("FIXTURE_DAYS") ?? "14", 10);
  outputPath = argumentValue("--output") ?? repoPath("fixtures/conflicting-slot.json");
  force = process.argv.includes("--force");
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    throw new Error("FIXTURE_DAYS must be an integer between 1 and 90.");
  }

  const reusable = await existingFixture();
  if (reusable) {
    console.log(
      `Fixture already exists: booking ${reusable.booking_id} at ${reusable.start_at}. Use --force to create another.`
    );
    console.log(`Next: npm --prefix scripts run fixture:verify`);
    return;
  }

  const range = dates();
  const slotsPath = `/v1/event-types/${encodeURIComponent(eventTypeSlug)}/slots?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(timezone)}`;
  const slotsResult = await request(slotsPath);
  if (!slotsResult.ok) {
    throw new Error(`Could not list Calnode slots: ${errorMessage(slotsResult)}`);
  }

  const slots = Array.isArray(slotsResult.body?.slots) ? slotsResult.body.slots : [];
  if (slots.length === 0) {
    throw new Error(
      `Calnode returned no availability for ${eventTypeSlug} between ${range.from} and ${range.to}. Create the event type and availability window first.`
    );
  }

  for (const slot of slots.slice(0, 5)) {
    if (!slot?.start) {
      continue;
    }

    const result = await request("/v1/bookings", {
      method: "POST",
      headers: { "idempotency-key": `safi-fixture-${crypto.randomUUID()}` },
      body: JSON.stringify({
        event_type_slug: eventTypeSlug,
        start_at: slot.start,
        name: contactName,
        email: contactEmail,
        timezone
      })
    });

    if (result.ok && result.body?.id) {
      const fixture = {
        fixture: "conflicting-slot",
        generated_at: new Date().toISOString(),
        source: "calnode",
        event_type_slug: eventTypeSlug,
        timezone,
        booking_id: result.body.id,
        start_at: result.body.start_at ?? slot.start,
        end_at: result.body.end_at ?? slot.end ?? null,
        contact_email: contactEmail,
        note: "Real Calnode booking reserved for E09. Re-run fixture:verify immediately before acceptance."
      };
      writeJson(outputPath, fixture);
      console.log(`Fixture created: booking ${fixture.booking_id} at ${fixture.start_at}.`);
      console.log(`Wrote ${outputPath}`);
      console.log(`Next: npm --prefix scripts run fixture:verify`);
      return;
    }

    if (result.status === 409) {
      continue;
    }

    throw new Error(`Could not create the fixture booking: ${errorMessage(result)}`);
  }

  throw new Error("Every sampled slot was already taken. Widen availability and try again.");
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
