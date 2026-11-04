export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface SafiContext {
  sub: string;
  email: string | null;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  jti: string;
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

export interface ArtifactRow {
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

export interface ArtifactVersionRow {
  id: number;
  artifact_id: string;
  version: number;
  state: ChecklistState;
  mutation: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface ArtifactWithVersions {
  artifact: ArtifactRow;
  versions: ArtifactVersionRow[];
}

export interface CalnodeSlot {
  start: string;
  end: string;
  host_ids?: string[];
}

export interface CalnodeBooking {
  id: string;
  event_type_slug?: string;
  start_at: string;
  end_at: string;
  status: string;
  location_value?: string;
  location_type?: string;
  timezone?: string;
}
