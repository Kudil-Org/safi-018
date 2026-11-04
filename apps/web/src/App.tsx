import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createArtifact,
  getArtifact,
  getConfig,
  getWindmillSession,
  listArtifacts,
  mutateArtifact,
  setAccessToken
} from "./lib/api";
import { getSupabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { AssistantPane } from "./components/AssistantPane";
import { ArtifactPane } from "./components/ArtifactPane";
import type { ArtifactBundle, ArtifactMutation, BookingResponse, PlatformConfig } from "./types";

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Something went wrong.";
}

export function App() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactBundle["artifact"][]>([]);
  const [bundle, setBundle] = useState<ArtifactBundle | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [windmill, setWindmill] = useState<Awaited<ReturnType<typeof getWindmillSession>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingArtifact = useRef(false);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((loadError) => setError(resolveErrorMessage(loadError)));
  }, []);

  const supabase = useMemo(() => (config ? getSupabase(config) : null), [config]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (session?.access_token) {
      setAccessToken(session.access_token);
      return;
    }
    setAccessToken(null);
  }, [session]);

  const refreshArtifacts = useCallback(async () => {
    if (!session) {
      return;
    }
    const result = await listArtifacts();
    setArtifacts(result.artifacts);
    if (!selectedId && result.artifacts[0]) {
      setSelectedId(result.artifacts[0].id);
    }
  }, [session, selectedId]);

  const loadBundle = useCallback(
    async (id: string) => {
      const next = await getArtifact(id);
      setBundle(next);
      setSelectedId(id);
    },
    []
  );

  const ensureArtifact = useCallback(async () => {
    if (!session || selectedId || creatingArtifact.current) {
      return;
    }
    creatingArtifact.current = true;
    try {
      const created = await createArtifact("Meeting checklist");
      setArtifacts((current) => [created.artifact, ...current]);
      setSelectedId(created.artifact.id);
      setBundle(created);
    } catch (createError) {
      setError(resolveErrorMessage(createError));
    } finally {
      creatingArtifact.current = false;
    }
  }, [session, selectedId]);

  const initialize = useCallback(async () => {
    if (!session) {
      setArtifacts([]);
      setBundle(null);
      setSelectedId(null);
      setWindmill(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [artifactList, windmillSession] = await Promise.all([
        listArtifacts(),
        getWindmillSession()
      ]);
      setArtifacts(artifactList.artifacts);
      setWindmill(windmillSession);
      const firstId = artifactList.artifacts[0]?.id ?? null;
      setSelectedId(firstId);
      if (firstId) {
        setBundle(await getArtifact(firstId));
      } else {
        setBundle(null);
      }
    } catch (initError) {
      setError(resolveErrorMessage(initError));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!session || selectedId || artifacts.length > 0) {
      return;
    }
    void ensureArtifact();
  }, [session, selectedId, artifacts.length, ensureArtifact]);

  useEffect(() => {
    if (!session || !selectedId || bundle?.artifact.id === selectedId) {
      return;
    }
    void loadBundle(selectedId);
  }, [session, selectedId, bundle?.artifact.id, loadBundle]);

  const handleMutate = useCallback(
    async (mutation: ArtifactMutation) => {
      if (!bundle || busy) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const next = await mutateArtifact(bundle.artifact.id, bundle.artifact.version, mutation);
        setBundle(next);
        await refreshArtifacts();
      } catch (mutateError) {
        setError(resolveErrorMessage(mutateError));
        throw mutateError;
      } finally {
        setBusy(false);
      }
    },
    [bundle, busy, refreshArtifacts]
  );

  const handleRefresh = useCallback(async () => {
    if (!selectedId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setBundle(await getArtifact(selectedId));
      await refreshArtifacts();
    } catch (refreshError) {
      setError(resolveErrorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  }, [selectedId, refreshArtifacts]);

  const handleBooked = useCallback(
    (result: BookingResponse) => {
      setBundle({
        artifact: result.artifact,
        versions: result.versions
      });
      void refreshArtifacts();
    },
    [refreshArtifacts]
  );

  const handleArtifactChanged = useCallback(() => {
    void handleRefresh();
  }, [handleRefresh]);

  const getAccessToken = useCallback(async () => {
    if (!supabase) {
      throw new Error("Supabase client not ready.");
    }
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }, [supabase]);

  if (!config || !supabase) {
    return (
      <main className="loading-screen">
        <div className="loading-card">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <p>Loading SAFI Platform...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return <Login supabase={supabase} />;
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="loading-card">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <p>Preparing your workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <div>
            <p className="eyebrow">SAFI Platform v0.1</p>
            <h1>Assistant + Checklist + Booking</h1>
          </div>
        </div>
        <div className="header-meta">
          {artifacts.length > 1 ? (
            <label className="artifact-select">
              <span>Artifact</span>
              <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
                {artifacts.map((artifact) => (
                  <option key={artifact.id} value={artifact.id}>
                    {artifact.state.title} · v{artifact.version}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="user-pill">
            <span className="user-dot" />
            <span>{session.user.email ?? session.user.id}</span>
          </div>
          <button className="ghost-button" type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          <p>{error}</p>
          <button className="ghost-button" type="button" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      ) : null}

      <main className="workspace">
        {windmill && bundle ? (
          <AssistantPane
            session={windmill}
            userId={session.user.id}
            artifactId={bundle.artifact.id}
            getAccessToken={getAccessToken}
            onArtifactChanged={handleArtifactChanged}
          />
        ) : (
          <section className="chat-thread placeholder-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Assistant</p>
                <h2>Connecting to Windmill</h2>
              </div>
            </div>
            <div className="placeholder-body">
              <p>Establishing the chat session and checklist.</p>
            </div>
          </section>
        )}

        {bundle ? (
          <ArtifactPane
            bundle={bundle}
            busy={busy}
            defaultName={session.user.user_metadata?.full_name ?? session.user.email ?? ""}
            defaultEmail={session.user.email ?? ""}
            onMutate={handleMutate}
            onRefresh={handleRefresh}
            onBooked={handleBooked}
          />
        ) : (
          <section className="artifact-pane placeholder-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Artifact</p>
                <h2>Preparing checklist</h2>
              </div>
            </div>
            <div className="placeholder-body">
              <p>Creating your first meeting checklist Artifact.</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
