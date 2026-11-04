# End User Acceptance - SOW 018 (E01-E12)

**Repository SHA:** `TO_BE_RECORDED`  
**Platform URL:** `https://${PLATFORM_HOST}/`  
**Date/Time:** `TO_BE_RECORDED`  
**Independent End User:** `TO_BE_RECORDED`  
**Observer:** `TO_BE_RECORDED`  
**Chrome mobile device:** `TO_BE_RECORDED`  
**Test users:** User A / User B (separate Supabase accounts)

> Do not start the SOW clock until all section 2 prerequisites are satisfied. All actions below use real services (no mocks). The Assistant cannot book: approval is explicit in the UI.

## Environment evidence (record before testing)
- [ ] Docker: `docker compose ps` attached
- [ ] Health: `curl -fsS https://${PLATFORM_HOST}/api/healthz`
- [ ] Supabase users exist and are distinct
- [ ] Windmill Flow `f/safi/safi_assistant` deployed in chat mode
- [ ] Calnode event type `follow-up-30` exists with open availability
- [ ] Conflicting slot fixture created and identified (booking id: ____________)
- [ ] Artifacts table + RLS + `safi_mutate_artifact` applied

## Acceptance steps
| ID | Step | Expected | Pass/Fail | Evidence (screenshot/log) |
|---|------|----------|-----------|---------------------------|
| E01 | Sign in as User A with provided credentials | Authenticated; SPA loads Assistant + Checklist panes | [ ] |  |
| E02 | Add a checklist item manually (Add button) | Item appears in checklist; progress updates | [ ] |  |
| E03 | Ask the real Assistant: "Call apply_checklist_change exactly once with op \"add_item\" and text \"<unique>\". Do not add any other item. Reply with one short sentence." | Assistant replies; new item appears without page reload; version increments | [ ] |  |
| E04 | Toggle an item done/undone; verify in the UI | Checkbox state changes; version history records change | [ ] |  |
| E05 | Reload page; sign out and sign in again as User A | Checklist items and states persist (version history visible) | [ ] |  |
| E06 | Load Calnode slots; select one real slot; fill name/email; click "Approve and book this slot" | Slot changes to "Confirmed" with Booking ID; persisted after reload; booking exists in Calnode | [ ] |  |
| E07 | In a separate browser/context, sign in as User B | User B cannot see User A's Artifact/items/booking (empty different checklist) | [ ] |  |
| E08 | Attempt to call the API as User B for User A's Artifact id (document request) | 404 or access denied; no data returned | [ ] |  |
| E09 | Try to book with an already-taken/fixture conflicting slot (run `npm --prefix scripts run fixture:verify` immediately before this step) | Booking is rejected with a clear error; no duplicate booking created | [ ] |  |
| E10 | Open on a real Chrome mobile device (portrait) | Layout is usable; can add item, see slots, approve booking | [ ] |  |
| E11 | Restart proof: `docker compose restart windmill_server windmill_worker calnode trusted_api` then sign in again | Checklist + booking remain; chat/session still works | [ ] |  |
| E12 | Security check: confirm no privileged tokens in browser storage/network requests for /api paths | Network shows only Supabase bearer tokens and calls to /api/* and /api/w/*; no service_role/Windmill admin/Calnode key visible | [ ] |  |

## Result
- **Overall:** PASS / FAIL / BLOCKED
- **Signed by End User:** ___________
- **Signed by Observer:** ___________
- **Notes:** ___________
