import { createHash } from "node:crypto";
import { config } from "./config.js";
import { createBooking } from "./calnode.js";
import { ChecklistStateSchema, getArtifact, recordBooking } from "./artifacts.js";
import type { ArtifactWithVersions, BookingRef } from "./types.js";

export interface ApprovedBookingInput {
  startAt: string;
  timezone: string;
  name: string;
  email: string;
}

export interface ApprovedBookingResult {
  booking: BookingRef;
  artifact: ArtifactWithVersions["artifact"];
  versions: ArtifactWithVersions["versions"];
  reused: boolean;
}

export async function bookApprovedSlot(
  ownerId: string,
  artifactId: string,
  input: ApprovedBookingInput
): Promise<ApprovedBookingResult> {
  const existing = await getArtifact(ownerId, artifactId);
  const state = ChecklistStateSchema.parse(existing.artifact.state);

  if (state.booking) {
    return {
      booking: state.booking,
      artifact: existing.artifact,
      versions: existing.versions,
      reused: true
    };
  }

  const idempotencyKey = createHash("sha256")
    .update(`${ownerId}:${artifactId}:${input.startAt}`)
    .digest("hex");

  const created = await createBooking(
    {
      startAt: input.startAt,
      timezone: input.timezone,
      name: input.name,
      email: input.email,
      eventTypeSlug: config.calnode.eventSlug
    },
    idempotencyKey
  );

  const booking: BookingRef = {
    id: created.id,
    eventTypeSlug: created.event_type_slug ?? config.calnode.eventSlug,
    startAt: created.start_at,
    endAt: created.end_at,
    timezone: input.timezone,
    name: input.name,
    email: input.email
  };

  const updated = await recordBooking(ownerId, artifactId, booking);

  return {
    booking,
    artifact: updated.artifact,
    versions: updated.versions,
    reused: false
  };
}
