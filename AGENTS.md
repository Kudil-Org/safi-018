# Agent notes

This repository implements one bounded SOW 018 pilot. Keep changes inside the existing boundaries.

- Do not introduce mocks for Windmill, Calnode, Supabase or the LLM. Fail closed when a dependency is missing.
- Never put a privileged token (Supabase service_role, Windmill admin, Calnode API key) in `apps/web` or any `VITE_*` variable.
- Every Artifact write must go through `mutateArtifact` in `services/trusted-api/src/artifacts.ts` and the `safi_mutate_artifact` SQL RPC.
- Keep container tags pinned; `:latest` is forbidden in delivered manifests.
- Do not start or claim the SOW clock unless all section 2 prerequisites exist.
- Run `npm --prefix services/trusted-api run typecheck` and `npm --prefix apps/web run build` before claiming code correctness.
