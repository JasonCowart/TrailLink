# Connecting the TrailLink community database

Ratings and rider-created trails are saved on each phone until this is done. After it's done they're shared
with every rider. The database is PostgreSQL, hosted by Supabase (free tier to start).

## Owner steps (about 10 minutes)

1. Go to supabase.com and sign up. "Continue with GitHub" is easiest.
2. Create a **New project**: name it `TrailLink`, pick a US region close to Colorado/Utah, and set a database
   password. Save the password somewhere safe. You won't need to give it to anyone.
3. When the project is ready, open **SQL Editor** › **New query**. Paste the whole contents of
   [`supabase/schema.sql`](../supabase/schema.sql) and press **Run**. It should say "Success".
4. Open **Authentication** › **URL Configuration**. Set **Site URL** to `https://jasoncowart.github.io/TrailLink/`.
5. Open **Project Settings** › **API** (or **Data API**). Copy two values and send them to Claude:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - the **anon / public** key

   The anon key is meant to be public: row-level security in the schema decides what it can do.
   **Never share the `service_role` key or the database password.**

## What Claude does next

- Adds a database-backed `Community` implementation next to `LocalCommunity` in `web/src/community.ts`.
- Rider sign-in with an emailed link (no passwords). Riders pick a display name for "created by".
- Uploads ratings and trails saved on the phone so far, then keeps them in sync (offline changes wait in a queue).
- Shows the community score (count of ratings, outlier-resistant average) on every trail.

## Moderation built into the schema

- Riders can change or delete only their own ratings and trails.
- A rider-created trail becomes **verified** after three other riders confirm they rode it.
- Reviewers (set `is_reviewer = true` on a profile in the Table Editor) can verify or hide any rider trail.
  Riders can't make themselves reviewers.
