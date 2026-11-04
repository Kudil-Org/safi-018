# AWS-only deployment overlay (deviation from SOW 018)

This directory deploys the whole SAFI pilot on **one EC2 instance** with Docker
Compose: self-hosted Supabase (Postgres + GoTrue + PostgREST), Caddy, Windmill,
Calnode, the trusted API and a LiteLLM proxy backed by **Amazon Bedrock
(Nova Lite)**. No managed Supabase project, no external LLM vendor and no load
balancer.

> **SOW note.** SOW 018 section 3/E11 excludes customer AWS and mandates a
> managed Supabase project and an approved LLM key. This overlay is an optional
> operator-requested variant, not a SOW-compliant delivery. Do not claim E01-E12
> acceptance or start the SOW clock on it without a written change order.

## What runs

| Service | Image | Purpose |
| --- | --- | --- |
| `supabase_db` | `postgres:16.4-alpine` | Supabase database |
| `supabase_auth` | `supabase/gotrue:v2.197.0` | `/auth/v1` email/password auth |
| `supabase_bootstrap` | `postgres:16.4-alpine` | one-shot roles, `auth.uid()`, migration, grants |
| `supabase_rest` | `postgrest/postgrest:v16.5` | `/rest/v1` with RLS |
| `litellm` | `litellm/litellm:v1.108.0` | OpenAI-compatible proxy to Bedrock |
| `web` | `deploy/aws/Dockerfile.edge` | Caddy: SPA, `/api`, `/wm`, all hostnames, internal gateway |

Only the `web` container publishes host ports (80/443). Everything else uses
Compose-internal networking.

## 1. Prerequisites

- AWS account, region **us-east-1**, Bedrock **model access enabled for Amazon
  Nova Lite** (`amazon.nova-lite-v1:0`).
- A domain you control. Four hostnames: platform, Supabase, Windmill, booking.
- EC2: Ubuntu 24.04 LTS, `t3.large` (2 vCPU / 8 GB) or larger, 40 GB gp3,
  Elastic IP.
- Security group: inbound 443 and 80 from the internet, 22 from your IP only.
- Docker Engine and the Compose plugin on the instance.
- Node.js 22 on the host for key generation, seeding and fixtures.

Nova Lite is billed per token. There is no permanent free tier; new AWS accounts
usually have promotional credits that cover a pilot. Cap spend with an AWS
budget before the acceptance run.

### Instance profile (no static AWS keys)

Create an IAM role with this inline policy and attach it to the instance:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:Converse",
        "bedrock:ConverseStream"
      ],
      "Resource": "*"
    }
  ]
}
```

LiteLLM uses boto3's default credential chain and reads the instance profile via
IMDS. Do not put AWS access keys in `.env`.

## 2. DNS

Point all four names at the Elastic IP:

```
platform.example.com   A  <elastic-ip>
supabase.example.com   A  <elastic-ip>
wm.example.com         A  <elastic-ip>
booking.example.com    A  <elastic-ip>
```

Caddy obtains and renews certificates automatically. Ports 80 and 443 must be
reachable for the HTTP-01 challenge.

## 3. Configure `.env`

Start from the base example, then append the overlay values:

```bash
cp .env.example .env
cp deploy/aws/env.example /tmp/aws.env   # reference only
```

Fill every base value (Windmill passwords, Calnode keys, `SAFI_CONTEXT_SECRET`,
`SAFI_INTERNAL_TOKEN`, `CADDY_EMAIL`, …). AWS-specific values:

```dotenv
SUPABASE_HOST=supabase.example.com
PUBLIC_PLATFORM_URL=https://platform.example.com
PUBLIC_SUPABASE_URL=https://supabase.example.com
SUPABASE_URL=http://supabase_gateway:8000
```

`SUPABASE_URL` is internal so the trusted API never leaves the Docker network;
`PUBLIC_SUPABASE_URL` is what `/api/config` returns to the browser. On managed
Supabase both are the same public URL.

Generate the self-hosted secrets and paste the output into `.env`:

```bash
node deploy/aws/gen-supabase-keys.mjs >> .env
```

This emits `POSTGRES_PASSWORD`, `AUTHENTICATOR_PASSWORD`, `SUPABASE_JWT_SECRET`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `LITELLM_MASTER_KEY`. The
generated passwords are hex so they are safe inside URLs. Never commit `.env`.

`SUPABASE_DB_URL` from the base example is only used by the managed-Supabase
migration flow. The overlay applies `supabase/migrations/0001_artifacts.sql`
automatically, so leave `SUPABASE_DB_URL` unset or unused here.

## 4. Start

```bash
COMPOSE="docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml"

$COMPOSE pull
$COMPOSE build
$COMPOSE up -d
$COMPOSE ps
$COMPOSE logs -f supabase_bootstrap
```

Wait for `bootstrap: complete`. PostgREST only starts after the bootstrap exits
successfully. If the bootstrap failed, read its log, fix the cause, then:

```bash
$COMPOSE up -d --force-recreate supabase_bootstrap
$COMPOSE up -d supabase_rest
```

## 5. Verify

```bash
curl -fsS "https://platform.example.com/api/healthz"
curl -fsS "https://platform.example.com/api/config"   # supabaseUrl must be the public Supabase host
curl -fsS "https://wm.example.com/api/version"
curl -fsS "https://booking.example.com/healthz"
curl -fsS "https://supabase.example.com/auth/v1/health"
```

Check the internal path the trusted API uses:

```bash
$COMPOSE exec trusted_api node -e \
  "fetch('http://supabase_gateway:8000/auth/v1/health').then(r=>r.text()).then(console.log)"
```

## 6. Users, Windmill, Calnode

1. Create the two acceptance users (the script now prefers
   `PUBLIC_SUPABASE_URL` when present):
   ```bash
   npm --prefix scripts run seed:supabase
   ```
2. Open the Windmill host, create workspace `safi`, and create the OpenAI
   resource `f/safi/llm`:
   - `api_key`: the generated `LITELLM_MASTER_KEY`
   - `base_url`: `http://litellm:4000/v1`
   - `organization_id`: leave empty
3. Import `windmill/flows/safi_assistant.flow.json`, set the Flow env
   `SAFI_API_URL=http://trusted_api:8080` and the worker's
   `SAFI_INTERNAL_TOKEN`, add the `f/safi/calnode_event_slug` variable, enable
   Chat mode, deploy, and create the narrow chat token. Put it in
   `WINDMILL_CHAT_TOKEN` and restart `trusted_api`.
4. Calnode: open the booking host, complete first-run setup, create the
   30-minute `follow-up-30` event type and an API key. Set `CALNODE_API_KEY`,
   then restart `trusted_api`. Run `npm --prefix scripts run fixture:create` and
   `npm --prefix scripts run fixture:verify` (expect HTTP 409).

The Flow keeps the model name `gpt-4o-mini`; LiteLLM maps it to
`bedrock/amazon.nova-lite-v1:0`. To use a different model, edit
`deploy/aws/litellm/config.yaml` and add the id to
`manifest/pinned-versions.json` `awsOnly.bedrockModel`.

## 7. Operations

```bash
COMPOSE="docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml"

$COMPOSE logs -f trusted_api
$COMPOSE restart windmill_server windmill_worker calnode trusted_api
$COMPOSE down                 # keeps named volumes
$COMPOSE down -v              # destroys data, including Postgres and Caddy certs
```

- `supabase_bootstrap` is idempotent and safe to re-run.
- Rotating `POSTGRES_PASSWORD` requires changing it inside Postgres as well;
  editing `.env` alone is not enough for an existing volume.
- Back up `supabase_db_data`, `windmill_db_data`, `calnode_data` and `caddy_data`.
- LiteLLM is not published by Caddy. Only containers on the Compose network can
  reach `litellm:4000`, and it still requires `LITELLM_MASTER_KEY`.

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Bootstrap says `auth.users was not created` | GoTrue is still migrating or crashed; check `logs supabase_auth`, then rerun the bootstrap. |
| Trusted API gets 401 from `/auth/v1` | `SUPABASE_JWT_SECRET` in `.env` differs from the one used to sign the anon/service keys; regenerate both together. |
| PostgREST returns 401/403 | `SUPABASE_ANON_KEY` was generated with a different secret, or the bootstrap grants did not run. |
| Browser CORS error | `PUBLIC_PLATFORM_URL` must be exactly the platform origin; Caddy only allows that origin on the Supabase host. |
| AI step fails on Bedrock | Model access not enabled, wrong region, or the instance has no profile/IMDS access. Check `logs litellm`. |
| AI step calls `/v1/responses` and gets 404 | Use a LiteLLM build that supports the Responses API, or pin the Flow provider to chat completions (`base_url` must end in `/v1`). |
| ACME certificate failure | DNS not pointing at the Elastic IP, or port 80 blocked. |
