# AQHA Live Scoring — Launch Guide

A real web app for running AQHA shows: coordinators create events and enter
scores; spectators watch live scoring, the current draw, and scratches update
on their phones in real time.

You don't need to write any code to launch this. Budget about 30–45 minutes.

## What you'll create (all free)

1. A **GitHub** account — stores the code (github.com)
2. A **Supabase** account — the database + coordinator logins (supabase.com)
3. A **Vercel** account — hosts the website (vercel.com)

---

## Step 1 — Put the code on GitHub

1. Sign in to github.com → click **+** (top right) → **New repository**
2. Name it `aqha-live-scoring`, leave everything else default → **Create repository**
3. On the new repo page click **uploading an existing file**
4. Drag in ALL files and folders from this project → **Commit changes**

## Step 2 — Create the database (Supabase)

1. Sign in to supabase.com → **New project**
   - Name: `aqha-live` · set a database password (save it somewhere) · pick the
     region closest to you (Sydney for AU) → **Create**
2. Wait ~2 minutes for it to provision.
3. Left sidebar → **SQL Editor** → **New query**
4. Open `supabase/schema.sql` from this project, copy ALL of it, paste, click **Run**.
   You should see "Success". This creates the tables, security rules, live
   syncing, and one sample event so the app isn't empty.
5. Create your coordinator login: left sidebar → **Authentication** → **Users**
   → **Add user** → enter your email + a password → **Create user**.
   (Add one for each staff member who should be able to score.)
6. Get your keys: **Project Settings** (gear icon) → **API**. Keep this page
   open — you need two values in Step 3:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (long string)

## Step 3 — Put it online (Vercel)

1. Sign in to vercel.com **with your GitHub account** → **Add New → Project**
2. Pick your `aqha-live-scoring` repository → **Import**
3. Before deploying, open **Environment Variables** and add both:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL from Step 2.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon public key from Step 2.6 |

4. Click **Deploy**. Two minutes later you get a live URL like
   `aqha-live-scoring.vercel.app`.

## Step 4 — Test it

1. Open your URL → you should see the sample "Sun Valley Summer Circuit" event.
2. Open it — that's the spectator view. This is the link/QR code you share.
3. Go to `/coordinator` (link on the home page) → sign in with the email +
   password you created in Step 2.5.
4. Enter a score and watch the spectator view (open it on a second phone!)
   update by itself within a second. Try a scratch and a draw reorder too.

## Day-to-day use

- **New show**: Coordinator dashboard → "+ New event", then "+ Add class" and
  "+ Entry" for each class. (Quick prompts for now — a nicer bulk-entry form
  is a good next upgrade.)
- **Share with exhibitors**: the event page URL. Make a QR code at any free
  QR generator and print it on the show program.
- **On the day**: score from any phone or laptop. Scratches, draw changes,
  and class reordering all sync live.

## Not included yet (next phases)

- **Push notifications** ("now showing" alerts) — needs a small extra service
  (web push); worth adding once the core app is proven at a real show.
- **Pattern uploads** — the database has a `pattern_url` field ready; the
  upload button needs Supabase Storage wired up.
- **Spreadsheet entry import, schedule page, past-event archive pages** —
  straightforward additions once you've used it once and know what you want.

When you're ready for any of these, bring this project back to Claude and ask.
