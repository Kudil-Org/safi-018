# Fixtures

The SOW requires one deliberate conflicting-slot fixture before acceptance. It is a **real Calnode booking**, not a mock.

## Create the fixture

1. Complete Calnode first-run setup and create the `follow-up-30` event type with an open weekday availability window.
2. Put the public Calnode origin and API key in `.env`:

   ```bash
   CALNODE_PUBLIC_URL=https://booking.example.com
   CALNODE_API_KEY=...
   CALNODE_EVENT_SLUG=follow-up-30
   CALNODE_TIMEZONE=UTC
   ```

3. Create the booking:

   ```bash
   npm --prefix scripts run fixture:create
   ```

   The script writes `fixtures/conflicting-slot.json` (gitignored) with the real booking id, start/end timestamps and event type. It reuses an existing confirmed fixture unless `--force` is passed.

4. Verify the double-booking guard immediately before acceptance:

   ```bash
   npm --prefix scripts run fixture:verify
   ```

   Expected: Calnode returns HTTP 409 for the already-booked slot and no duplicate booking is created.

## Record it

In `END_USER_ACCEPTANCE.md`, record the fixture booking id and slot in the environment evidence, then use it for E09. Keep `conflicting-slot.json` out of git; the schema is documented by `conflicting-slot.example.json`.
