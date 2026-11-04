import { config } from "./config.js";
import { HttpError } from "./http-error.js";
import type { CalnodeBooking, CalnodeSlot } from "./types.js";

interface CalnodeSlotsResponse {
  slots?: CalnodeSlot[];
  hosts?: Record<string, unknown>;
  degraded?: boolean;
}

interface BookingInput {
  startAt: string;
  timezone: string;
  name: string;
  email: string;
  eventTypeSlug?: string;
}

function baseUrl(): string {
  return config.calnode.baseUrl.replace(/\/+$/, "");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.calnode.apiKey}`,
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(20_000)
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : typeof payload === "string" && payload
          ? payload
          : `Calnode returned HTTP ${response.status}`;

    if (response.status === 409) {
      throw new HttpError(409, "calnode_slot_taken", "That Calnode slot is no longer available.", payload);
    }
    if (response.status === 404) {
      throw new HttpError(404, "calnode_not_found", message, payload);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "calnode_auth_failed", "The trusted API could not authenticate to Calnode.");
    }
    throw new HttpError(502, "calnode_error", message, payload);
  }

  return payload as T;
}

export async function listSlots(input: {
  eventTypeSlug?: string;
  from: string;
  to: string;
  timezone: string;
}): Promise<{ slots: CalnodeSlot[]; degraded: boolean }> {
  const slug = input.eventTypeSlug ?? config.calnode.eventSlug;
  const query = new URLSearchParams({
    from: input.from,
    to: input.to,
    tz: input.timezone
  });

  const result = await request<CalnodeSlotsResponse>(
    `/v1/event-types/${encodeURIComponent(slug)}/slots?${query.toString()}`,
    { method: "GET" }
  );

  return {
    slots: Array.isArray(result.slots) ? result.slots : [],
    degraded: result.degraded === true
  };
}

export async function createBooking(input: BookingInput, idempotencyKey: string): Promise<CalnodeBooking> {
  const slug = input.eventTypeSlug ?? config.calnode.eventSlug;

  return request<CalnodeBooking>("/v1/bookings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify({
      event_type_slug: slug,
      start_at: input.startAt,
      name: input.name,
      email: input.email,
      timezone: input.timezone
    })
  });
}

export async function getBooking(bookingId: string): Promise<CalnodeBooking> {
  return request<CalnodeBooking>(`/v1/bookings/${encodeURIComponent(bookingId)}`, { method: "GET" });
}
