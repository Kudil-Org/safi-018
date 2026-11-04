import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { adminClient } from "./supabase.js";
import { HttpError } from "./http-error.js";
import type {
  ArtifactRow,
  ArtifactVersionRow,
  ArtifactWithVersions,
  BookingRef,
  ChecklistItem,
  ChecklistState
} from "./types.js";

export const ItemSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(300),
  done: z.boolean(),
  updatedAt: z.string().min(1)
});

export const BookingSchema = z.object({
  id: z.string().min(1).max(160),
  eventTypeSlug: z.string().min(1).max(120),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  timezone: z.string().min(1).max(80),
  name: z.string().max(160).optional(),
  email: z.string().max(200).optional()
});

export const ChecklistStateSchema = z.object({
  kind: z.literal("checklist"),
  title: z.string().min(1).max(200),
  items: z.array(ItemSchema).max(200),
  booking: BookingSchema.optional()
});

export const MutationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_item"), text: z.string().min(1).max(300), id: z.string().min(1).max(80).optional() }),
  z.object({ op: z.literal("edit_item"), itemId: z.string().min(1).max(80), text: z.string().min(1).max(300) }),
  z.object({ op: z.literal("set_item_done"), itemId: z.string().min(1).max(80), done: z.boolean() }),
  z.object({ op: z.literal("remove_item"), itemId: z.string().min(1).max(80) }),
  z.object({ op: z.literal("set_title"), title: z.string().min(1).max(200) }),
  z.object({ op: z.literal("set_booking"), booking: BookingSchema })
]);

export type ArtifactMutation = z.infer<typeof MutationSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultState(title: string): ChecklistState {
  return {
    kind: "checklist",
    title,
    items: []
  };
}

function applyMutation(state: ChecklistState, mutation: ArtifactMutation): ChecklistState {
  const next: ChecklistState = {
    ...state,
    items: state.items.map((item) => ({ ...item }))
  };

  switch (mutation.op) {
    case "add_item": {
      if (next.items.length >= 200) {
        throw new HttpError(422, "artifact_full", "This Artifact already has the maximum of 200 items.");
      }
      const item: ChecklistItem = {
        id: mutation.id ?? randomUUID(),
        text: mutation.text.trim(),
        done: false,
        updatedAt: nowIso()
      };
      if (!item.text) {
        throw new HttpError(422, "invalid_item", "Checklist item text cannot be empty.");
      }
      next.items.push(item);
      break;
    }
    case "edit_item": {
      const item = next.items.find((candidate) => candidate.id === mutation.itemId);
      if (!item) {
        throw new HttpError(404, "item_not_found", "Checklist item not found.");
      }
      item.text = mutation.text.trim();
      if (!item.text) {
        throw new HttpError(422, "invalid_item", "Checklist item text cannot be empty.");
      }
      item.updatedAt = nowIso();
      break;
    }
    case "set_item_done": {
      const item = next.items.find((candidate) => candidate.id === mutation.itemId);
      if (!item) {
        throw new HttpError(404, "item_not_found", "Checklist item not found.");
      }
      item.done = mutation.done;
      item.updatedAt = nowIso();
      break;
    }
    case "remove_item": {
      const before = next.items.length;
      next.items = next.items.filter((candidate) => candidate.id !== mutation.itemId);
      if (next.items.length === before) {
        throw new HttpError(404, "item_not_found", "Checklist item not found.");
      }
      break;
    }
    case "set_title": {
      next.title = mutation.title.trim();
      if (!next.title) {
        throw new HttpError(422, "invalid_title", "Artifact title cannot be empty.");
      }
      break;
    }
    case "set_booking": {
      next.booking = mutation.booking;
      break;
    }
  }

  return next;
}

function asArtifact(row: unknown): ArtifactRow {
  return row as ArtifactRow;
}

function asVersions(rows: unknown): ArtifactVersionRow[] {
  return (rows ?? []) as ArtifactVersionRow[];
}

export async function listArtifacts(ownerId: string): Promise<ArtifactRow[]> {
  const { data, error } = await adminClient
    .from("artifacts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "artifact_list_failed", error.message);
  }

  return (data ?? []).map(asArtifact);
}

export async function getArtifact(ownerId: string, artifactId: string): Promise<ArtifactWithVersions> {
  const { data, error } = await adminClient
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "artifact_read_failed", error.message);
  }

  if (!data) {
    throw new HttpError(404, "artifact_not_found", "Artifact not found for this user.");
  }

  const { data: versions, error: versionError } = await adminClient
    .from("artifact_versions")
    .select("*")
    .eq("artifact_id", artifactId)
    .order("version", { ascending: false });

  if (versionError) {
    throw new HttpError(500, "artifact_history_failed", versionError.message);
  }

  return {
    artifact: asArtifact(data),
    versions: asVersions(versions)
  };
}

export async function createArtifact(ownerId: string, title: string): Promise<ArtifactWithVersions> {
  const state = defaultState(title.trim() || "Meeting checklist");

  const { data, error } = await adminClient
    .from("artifacts")
    .insert({
      owner_id: ownerId,
      template_ref: config.artifactTemplateRef,
      state,
      version: 1
    })
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, "artifact_create_failed", error.message);
  }

  const artifact = asArtifact(data);

  const { error: versionError } = await adminClient
    .from("artifact_versions")
    .insert({
      artifact_id: artifact.id,
      version: 1,
      state,
      mutation: { op: "create", templateRef: config.artifactTemplateRef },
      created_by: ownerId
    });

  if (versionError) {
    await adminClient.from("artifacts").delete().eq("id", artifact.id).eq("owner_id", ownerId);
    throw new HttpError(500, "artifact_version_create_failed", versionError.message);
  }

  return {
    artifact,
    versions: [
      {
        id: 0,
        artifact_id: artifact.id,
        version: 1,
        state,
        mutation: { op: "create" },
        created_by: ownerId,
        created_at: artifact.created_at
      }
    ]
  };
}

export async function mutateArtifact(
  ownerId: string,
  artifactId: string,
  expectedVersion: number,
  rawMutation: unknown
): Promise<ArtifactWithVersions> {
  const mutation = MutationSchema.parse(rawMutation);
  const current = await getArtifact(ownerId, artifactId);
  const currentState = ChecklistStateSchema.parse(current.artifact.state);

  if (current.artifact.version !== expectedVersion) {
    throw new HttpError(
      409,
      "version_conflict",
      `Artifact is at version ${current.artifact.version}, not ${expectedVersion}. Reload and retry.`,
      { currentVersion: current.artifact.version }
    );
  }

  const nextState = applyMutation(currentState, mutation);

  const { data, error } = await adminClient.rpc("safi_mutate_artifact", {
    p_artifact_id: artifactId,
    p_expected_version: expectedVersion,
    p_state: nextState,
    p_mutation: mutation,
    p_actor: ownerId
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "40001" || error.message.includes("version_conflict")) {
      throw new HttpError(409, "version_conflict", "Another change landed first. Reload and retry.", {
        currentVersion: current.artifact.version
      });
    }
    if (code === "42501" || error.message.includes("not_found_or_forbidden")) {
      throw new HttpError(404, "artifact_not_found", "Artifact not found for this user.");
    }
    if (code === "28000") {
      throw new HttpError(401, "not_authenticated", "No authenticated actor for the mutation.");
    }
    throw new HttpError(500, "artifact_mutate_failed", error.message);
  }

  const updated = asArtifact(Array.isArray(data) ? data[0] : data);

  const { data: versions, error: versionError } = await adminClient
    .from("artifact_versions")
    .select("*")
    .eq("artifact_id", artifactId)
    .order("version", { ascending: false });

  if (versionError) {
    throw new HttpError(500, "artifact_history_failed", versionError.message);
  }

  return {
    artifact: updated,
    versions: asVersions(versions)
  };
}

function bookingFromState(state: ChecklistState): BookingRef | undefined {
  return state.booking;
}

export async function recordBooking(
  ownerId: string,
  artifactId: string,
  booking: BookingRef
): Promise<ArtifactWithVersions> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getArtifact(ownerId, artifactId);
    const currentState = ChecklistStateSchema.parse(current.artifact.state);
    const existing = bookingFromState(currentState);

    if (existing && existing.id === booking.id && existing.startAt === booking.startAt) {
      return current;
    }

    try {
      return await mutateArtifact(ownerId, artifactId, current.artifact.version, {
        op: "set_booking",
        booking
      });
    } catch (error) {
      if (error instanceof HttpError && error.code === "version_conflict" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }

  throw new HttpError(409, "booking_record_conflict", "Could not record the booking after retries.");
}
