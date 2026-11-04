export interface PlatformConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  platformUrl: string;
  release: string;
  eventSlug: string;
  timezone: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  updatedAt: string;
}

export interface BookingRef {
  id: string;
  eventTypeSlug: string;
  startAt: string;
  endAt: string;
  timezone: string;
  name?: string | undefined;
  email?: string | undefined;
}

export interface ChecklistState {
  kind: "checklist";
  title: string;
  items: ChecklistItem[];
  booking?: BookingRef | undefined;
}

export interface Artifact {
  id: string;
  owner_id: string;
  template_ref: string;
  state: ChecklistState;
  version: number;
  booking_id: string | null;
  booking_start_at: string | null;
  booking_timezone: string | null;
  event_type_slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: number;
  artifact_id: string;
  version: number;
  state: ChecklistState;
  mutation: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface ArtifactBundle {
  artifact: Artifact;
  versions: ArtifactVersion[];
}

export interface WindmillSession {
  baseUrl: string;
  workspace: string;
  flowPath: string;
  context: string;
  contextExpiresAt: string;
  eventSlug: string;
  timezone: string;
}

export interface Slot {
  start: string;
  end: string;
  host_ids?: string[] | undefined;
}

export interface SlotsResponse {
  eventTypeSlug: string;
  timezone: string;
  slots: Slot[];
  degraded: boolean;
  source: string;
}

export interface BookingResponse {
  booking: BookingRef;
  artifact: Artifact;
  versions: ArtifactVersion[];
  reused: boolean;
}

export type ArtifactMutation =
  | { op: "add_item"; text: string; id?: string }
  | { op: "edit_item"; itemId: string; text: string }
  | { op: "set_item_done"; itemId: string; done: boolean }
  | { op: "remove_item"; itemId: string }
  | { op: "set_title"; title: string }
  | { op: "set_booking"; booking: BookingRef };
