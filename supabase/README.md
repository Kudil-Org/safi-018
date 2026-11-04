# Supabase setup

1. Create one SAFI-owned managed Supabase project.
2. Apply the migration:

   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_artifacts.sql
   ```

   or, with the Supabase CLI linked to the project:

   ```bash
   supabase db push
   ```

3. Create two unrelated test users (User A and User B) under Authentication > Users, or seed them with the same environment variables the tests use:

   ```bash
   npm --prefix scripts run seed:supabase
   ```

   The seed script requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_USER_A_EMAIL`, `E2E_USER_A_PASSWORD`, `E2E_USER_B_EMAIL` and `E2E_USER_B_PASSWORD` in `.env`. Use ordinary email/password accounts with no admin role. The service-role key stays local and is never delivered to the browser.
4. Copy the project URL and anon key into the trusted API and the SPA config source. The service-role key is used only by `services/trusted-api`; it is never delivered to the browser.
5. Verify RLS:

   ```bash
   npm --prefix tests install
   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
   E2E_USER_A_EMAIL=... E2E_USER_A_PASSWORD=... \
   E2E_USER_B_EMAIL=... E2E_USER_B_PASSWORD=... \
   npm --prefix tests run test:security
   ```

Expected: User A can read/write only A's Artifacts and version history; User B receives zero rows or a permission error; anon is denied; service_role succeeds only when it supplies the actor UUID; stale expected versions raise `40001` and append nothing.
