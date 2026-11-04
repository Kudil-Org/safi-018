# Evidence

Acceptance evidence is captured under `evidence/runs/<UTC timestamp>-<repo sha>/`. That directory is gitignored because it contains deployment-specific screenshots, logs and URLs.

## Capture metadata

```bash
npm --prefix scripts run evidence:capture
```

The script writes only non-secret data:

- `environment.md` and `environment.json` with repository SHA, runtime versions, public URLs and health results.
- `docker-compose-ps.txt` from `docker compose ps`.
- `manifest.json` snapshot.
- `SHA256SUMS.txt`.

It fails closed when `PUBLIC_PLATFORM_URL`, `PUBLIC_WINDMILL_BASE_URL` or `PUBLIC_BOOKING_URL` is missing, or a public health check fails. It never writes `.env` values, passwords, API keys, service-role keys, tokens or session data.

## Complete the run

1. Attach the E01-E12 screenshots and logs to the run directory.
2. Fill `END_USER_ACCEPTANCE.md` and store the signed copy in the run directory.
3. Record the real Calnode fixture booking id from `fixtures/conflicting-slot.json`.
4. Record the repository SHA from `environment.md`; an uncommitted tree is not a valid acceptance SHA.

Do not commit `evidence/runs/` content. Use `evidence/templates/environment.md` only as a manual fallback if the capture script cannot run.
