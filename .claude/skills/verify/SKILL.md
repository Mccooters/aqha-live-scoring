---
name: verify
description: How to run and verify changes to this app locally (Next.js + live Supabase, no local secrets)
---

# Verifying changes locally

- `npx next dev -p 3005` — `.env.local` has only the public Supabase URL +
  anon key, and the dev server talks to the LIVE production database
  (read-only for public tables; writes are blocked by RLS). Never create test
  rows in real tables.
- `SUPABASE_SERVICE_ROLE_KEY` lives only on Vercel. To exercise server routes
  that construct the admin client without crashing, start dev with the anon
  key standing in: `SUPABASE_SERVICE_ROLE_KEY="$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY
  .env.local | cut -d= -f2)" npx next dev -p 3005`. Privileged reads/writes
  then fail (RLS), which is enough to verify auth gates and error paths, but
  not service-role behavior.
- Member-portal sessions can't be minted locally (needs the real service
  key). To see signed-in UI states, run a small Node proxy that forwards to
  the dev server but answers `GET /api/account/me` (and, if needed,
  `/api/memberships/check`) with a realistic signed-in payload; drive the
  proxy origin in a browser. Real DB data (classes, membership_types) still
  flows through.
- Browser driving: system Chrome + `playwright-core` (npm i in the
  scratchpad, `chromium.launch({ channel: "chrome", headless: true })`).
  Quick screenshots without Playwright: `"/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=out.png
  --virtual-time-budget=8000 <url>` at `--window-size=430,1400` (mobile-first
  app — verify at phone width).
- Useful flows: `/event/<id>/register` (find an open event via anon query on
  `events`), `/membership`, `/account`. Square checkout/webhook can't be
  driven locally (no Square creds) — verify request shaping only and say so.
