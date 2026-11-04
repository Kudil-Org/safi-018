# SAFI Service SOW 018 - Platform Foundation & Assembly

Proprietary and Copyright 2026 B. Gopinath. Do not copy or distribute without written permission.

One integrated SAFI Platform v0.1 pilot:

- React + TypeScript + Vite SPA with one `assistant-ui` conversation pane and one interactive checklist Artifact pane.
- Supabase Auth + Postgres + RLS for Artifact state, immutable versions and owner isolation.
- Windmill chat-mode Flow (server + worker + its own Postgres) backing the real Assistant.
- Calnode (single container + persistent SQLite) as the authoritative booking system.
- A small trusted API that verifies the Supabase session server-side and holds every privileged credential.

> Status in this repository: **IMPLEMENTATION PRESENT / UNVERIFIED DEPLOYMENT**. The code, contracts, migrations, Compose files and tests are present, but no real deployment has been performed. The SOW clock has not started because the mandatory prerequisites in section 2 are not yet supplied. Real deployment and End User acceptance are **BLOCKED** until they are. Mocks are deliberately not provided: the code targets the real services and fails closed when they are absent.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | SOW 019-style React/Vite SPA, `assistant-ui` + `@windmill-labs/chat-sdk/assistant-ui` |
| `services/trusted-api` | Supabase session verification, Windmill token-injecting chat proxy, Calnode proxy, Artifact mutation boundary |
| `supabase/migrations` | Artifact/version schema, RLS, immutable history, optimistic-concurrency RPC |
| `windmill/flows` | Chat-mode Windmill Flow export with AI agent step and real tool scripts |
| `deploy` | Caddy TLS/reverse-proxy configuration |
| `openapi.yaml` | Smallest trusted-operations contract |
| `tests` | Playwright acceptance tests + RLS isolation tests |
| `scripts` | Provisioning, digest pinning, release checks |
| `manifest` | Pinned SPA/container manifest |
| `evidence` | Evidence capture instructions and output location |
| `platform-config.example` | Non-secret deployment configuration template |
| `END_USER_ACCEPTANCE.md` | E01-E12 independent acceptance record |

## Mandatory prerequisites (SOW section 2)

Do not start the clock until all of these exist:

1. Accepted SOW 019 template repository, exact SHA, pinned lockfile and reusable UI shell (Chat + Artifact placeholders). This repository scaffolds an equivalent shell; replace it with the accepted SOW 019 SHA before delivery.
2. A **different** fixed public HTTPS Platform URL with DNS/TLS and SAFI hosting. Never overwrite the SOW 019 acceptance URL.
3. SAFI-controlled Linux/Docker host with Docker Compose and capacity; SAFI-owned managed Supabase project with two separate test users and credentials held securely.
4. Approved LLM/API key with capped spend; Windmill administrator bootstrap access; Calnode test workspace; network paths/ports approved.
5. A 30-minute unbooked test slot and a deliberate conflicting-slot fixture.
6. A named independent End User, an observer and a real Chrome mobile device reserved for at least 30 minutes before H6.

If any item is missing, report `BLOCKED BEFORE START`. Do not substitute mocks.

## Local development

```bash
cp .env.example .env
# edit .env with real Supabase / Windmill / Calnode credentials
npm --prefix services/trusted-api install
npm --prefix apps/web install
npm --prefix services/trusted-api run dev      # http://localhost:8080
npm --prefix apps/web run dev                  # http://localhost:5173 (proxies /api)
```

Apply the Supabase migration before starting the API:

```bash
supabase db push            # or psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_artifacts.sql
```

Create the two test users with `scripts/seed-supabase.mjs` (uses the service-role key locally only) or in the Supabase dashboard:

```bash
npm --prefix scripts run seed:supabase
```

## Production deployment (SAFI host)

```bash
cp .env.example .env
# fill every value; generate Calnode secrets with: openssl rand -hex 32
docker compose pull
docker compose build
docker compose up -d
docker compose ps
curl -fsS "https://${PLATFORM_HOST}/api/healthz"
curl -fsS "https://${WINDMILL_HOST}/api/version"
curl -fsS "https://${BOOKING_HOST}/healthz"
```

DNS/TLS:

- `PLATFORM_HOST` -> Caddy -> SPA static + `/api` trusted API + `/wm` Windmill.
- `WINDMILL_HOST` -> optional direct Windmill access for administrators.
- `BOOKING_HOST` -> Calnode admin/public booking pages.
- `SUPABASE_HOST` -> only with the AWS-only overlay (self-hosted Supabase API).

### AWS-only variant (deviation)

`deploy/aws/` deploys the pilot on a single EC2 host with self-hosted Supabase
and Amazon Bedrock (Nova Lite) through LiteLLM. It exists because the operator
asked for everything on AWS, but it **deviates from SOW 018**: section 3/E11
excludes customer AWS and the SOW assumes a managed Supabase project and an
approved LLM key. Treat it as a non-SOW variant until a change order exists. See
`deploy/aws/README.md`.

Chat traffic uses `https://${PLATFORM_HOST}/api/w/...`. The trusted API verifies the Supabase session and injects the shared Windmill chat token server-side. The browser never receives that token.

Never expose `trusted_api:8080` or `/internal/*` directly. Caddy explicitly returns 404 for `/internal/*` on the public host.

## First-run setup sequence

1. **Supabase**: create project, apply `supabase/migrations/0001_artifacts.sql`, create User A and User B (distinct emails/passwords). Record their UUIDs.
2. **Windmill**: start Compose, create workspace `safi`, create the OpenAI-compatible resource `f/safi/llm`, workspace variables `f/safi/calnode_event_slug` (default `follow-up-30`), and the Flow from `windmill/flows/safi_assistant.flow.json`. Enable Chat mode and deploy. Create a **narrow** token scoped to `jobs:run:flows:f/safi/safi_assistant` and copy it to `WINDMILL_CHAT_TOKEN`.
3. **Calnode**: open `https://${BOOKING_HOST}/`, complete first-run owner setup, create a 30-minute event type `follow-up-30` with a weekday availability window, then create an API key. Put the key in `CALNODE_API_KEY` and set `CALNODE_PUBLIC_URL`. Run `npm --prefix scripts run fixture:create` for the real conflicting-slot fixture, then `npm --prefix scripts run fixture:verify` and expect HTTP 409.
4. **Trusted API**: set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SAFI_CONTEXT_SECRET`, `SAFI_INTERNAL_TOKEN` (shared only with Windmill Flow env), `WINDMILL_CHAT_TOKEN`, `CALNODE_*`.
5. **Restart proof**: `docker compose restart windmill_server windmill_worker calnode` then confirm the same booking and Artifact reopen.
6. **Independent acceptance**: follow `END_USER_ACCEPTANCE.md` E01-E12 with the named tester and observer.

## Security boundary

- Browser receives only the Supabase anon key and the user's Supabase session. It never receives the Supabase `service_role` key, the Windmill admin/chat token, or the Calnode API key. Windmill chat calls go through `/api/w/...`, where the trusted API injects the token.
- Every `/api/*` and `/internal/*` operation verifies a Supabase JWT or the internal shared secret plus a signed `safi_context` before any Windmill/Calnode/Supabase mutation.
- Artifact reads are owner-scoped in the trusted API and protected by Supabase RLS. Writes go only through `POST /api/artifacts/:id/mutate` or its internal twin; both call the same `mutateArtifact` function and the same SQL RPC with optimistic version checking.
- `artifact_versions` is append-only. There are no update/delete policies and the API never issues such statements.

## Verification commands

```bash
npm --prefix services/trusted-api run typecheck
npm --prefix apps/web run build
npm --prefix tests install
npm --prefix tests run install:browsers
npm --prefix tests run test:security     # needs deployed URL + User A/B credentials
npm --prefix tests run test:e2e          # needs deployed URL + User A/B credentials
npm --prefix scripts run check:pins
npm --prefix scripts run check:release   # after release digests are filled
npm --prefix scripts run evidence:capture
```

## Fixtures and evidence

- `fixtures/README.md`: create and verify the real conflicting-slot booking required by E09. The generated `fixtures/conflicting-slot.json` is gitignored.
- `evidence/README.md`: capture non-secret environment metadata, health checks and compose status under `evidence/runs/`. Attach acceptance screenshots/logs there and complete `END_USER_ACCEPTANCE.md`.
- `sh scripts/pin-digests.sh` (or `npm --prefix scripts run pin:digests`) resolves image digests into `manifest/pinned-versions.json`; use `--require-all` before release.

## SOW boundaries

This is one bounded pilot. It is not the finished SAFI Platform, not a SOW 017 Factory rebuild, not a SOW 019 replacement, not customer AWS, and not a production-hardened multi-tenant service. See section 12 of the SOW for the explicit out-of-scope list.
