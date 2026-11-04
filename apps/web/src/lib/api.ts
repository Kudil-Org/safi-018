import type {
  ArtifactBundle,
  ArtifactMutation,
  BookingResponse,
  PlatformConfig,
  SlotsResponse,
  WindmillSession
} from "../types";

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: { message?: string } }).error.message ?? "Request failed")
        : `Request failed with HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    if (typeof payload === "object" && payload !== null && "error" in payload) {
      const code = (payload as { error: { code?: string } }).error.code;
      if (code) {
        error.code = code;
      }
    }
    throw error;
  }

  return payload as T;
}

export function getConfig(): Promise<PlatformConfig> {
  return request<PlatformConfig>("/api/config");
}

export function getWindmillSession(): Promise<WindmillSession> {
  return request<WindmillSession>("/api/chat-session");
}

export function listArtifacts() {
  return request<{ artifacts: ArtifactBundle["artifact"][] }>("/api/artifacts");
}

export function createArtifact(title: string): Promise<ArtifactBundle> {
  return request<ArtifactBundle>("/api/artifacts", {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export function getArtifact(id: string): Promise<ArtifactBundle> {
  return request<ArtifactBundle>(`/api/artifacts/${encodeURIComponent(id)}`);
}

export function mutateArtifact(
  id: string,
  expectedVersion: number,
  mutation: ArtifactMutation
): Promise<ArtifactBundle> {
  return request<ArtifactBundle>(`/api/artifacts/${encodeURIComponent(id)}/mutate`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, mutation })
  });
}

export function getSlots(id: string, from: string, to: string, timezone: string): Promise<SlotsResponse> {
  const query = new URLSearchParams({ from, to, tz: timezone });
  return request<SlotsResponse>(
    `/api/artifacts/${encodeURIComponent(id)}/slots?${query.toString()}`
  );
}

export function bookSlot(
  id: string,
  input: { startAt: string; timezone: string; name: string; email: string }
): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/artifacts/${encodeURIComponent(id)}/book`, {
    method: "POST",
    body: JSON.stringify({ ...input, approved: true })
  });
}
