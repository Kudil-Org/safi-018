# Environment evidence - TO_BE_RECORDED

- Captured at: TO_BE_RECORDED
- Repository SHA: TO_BE_RECORDED
- Branch: TO_BE_RECORDED
- Working tree: clean / dirty
- Node: TO_BE_RECORDED
- npm: TO_BE_RECORDED
- Manifest release: TO_BE_RECORDED
- SOW: SAFI-SERVICE-SOW-018

## URLs

- Platform: `https://${PLATFORM_HOST}/`
- Windmill: `https://${WINDMILL_HOST}/`
- Booking: `https://${BOOKING_HOST}/`

## Service checks

| Check | Command | Result |
| --- | --- | --- |
| Platform health | `curl -fsS https://${PLATFORM_HOST}/api/healthz` | TO_BE_RECORDED |
| Windmill version | `curl -fsS https://${WINDMILL_HOST}/api/version` | TO_BE_RECORDED |
| Calnode health | `curl -fsS https://${BOOKING_HOST}/healthz` | TO_BE_RECORDED |
| Compose services | `docker compose ps` | TO_BE_RECORDED |

## Prerequisites

- [ ] Supabase project and migration applied
- [ ] User A and User B exist and are distinct
- [ ] Windmill Flow `f/safi/safi_assistant` deployed in chat mode
- [ ] Calnode event type `follow-up-30` with availability
- [ ] Conflicting-slot fixture created and verified with HTTP 409
- [ ] Named End User, observer and Chrome mobile device reserved

This template contains no credentials. Attach screenshots and command output to the same run directory.
