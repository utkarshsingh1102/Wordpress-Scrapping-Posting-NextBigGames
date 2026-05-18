# Deployment Guide

This project has two pieces with different deployment needs:

- **Frontend** (Vite/React SPA) → **Vercel**
- **Backend** (Express + Prisma + SQLite + node-cron + file storage) → **Railway / Render / Fly.io**

Vercel alone is **not** suitable for the backend because:
- SQLite (`prisma/dev.db`) requires a persistent filesystem; Vercel serverless functions are ephemeral.
- `node-cron` runs in-process and won't fire on stateless serverless.
- Generated images live on local disk (`storage/generated/`) and need to be served at stable URLs that WordPress can fetch.
- Scrape + image regeneration can take 60–180 s, exceeding Vercel's function timeout (max 60 s on Pro).

Railway is recommended below because it supports persistent disks, long-running processes, and zero-config Node deploys.

---

## 1. Backend → Railway

1. Create a new project at https://railway.app → **Deploy from GitHub repo** → select this repo, root directory `/backend`.
2. Railway auto-detects Node. It will run `npm install && npm run build`, then `npm run start`.
3. **Add a Volume** (Railway → service → Settings → Volumes): mount path `/app/prisma` and `/app/storage` so the SQLite DB and generated images survive redeploys.
4. **Environment variables** (Railway → service → Variables):
   ```
   DATABASE_URL=file:/app/prisma/prod.db
   CRED_ENCRYPTION_KEY=<run `openssl rand -hex 32` and paste the output>
   SOURCE_URL=https://www.gamigion.com/
   SCRAPE_CRON=0 * * * *
   SCRAPE_CRON_ENABLED=true
   PUBLIC_BASE_URL=https://<your-railway-service>.up.railway.app
   CORS_ORIGIN=https://<your-vercel-frontend>.vercel.app
   ```
   You can leave WP credentials blank and enter them in the Settings UI after deploy.
5. Deploy. Note the assigned public URL — you'll need it for the frontend env.

### Alternative: Render

Same idea: create a Web Service, root `/backend`, build `npm install && npm run build`, start `npm run start`, add a **Disk** mounted at `/opt/render/project/src/backend/prisma` and `/opt/render/project/src/backend/storage`. Set the same env vars.

---

## 2. Frontend → Vercel

1. Go to https://vercel.com → **Add New** → **Project** → import this repo.
2. **Root directory:** `frontend`
3. Vercel auto-detects Vite. The included `frontend/vercel.json` sets framework, build command, output, and SPA rewrites.
4. **Environment variables** (Project Settings → Environment Variables):
   ```
   VITE_API_URL=https://<your-railway-backend>.up.railway.app
   ```
   (no trailing slash, no `/api` suffix — the frontend adds `/api` itself)
5. Deploy.

---

## 3. Wire them together

After both are live, update the backend env one more time:
- `CORS_ORIGIN` → the actual Vercel URL (e.g. `https://gamigion-wp.vercel.app`)
- `PUBLIC_BASE_URL` → the actual Railway URL

Redeploy backend. Open the frontend, go to **Settings**, paste your WordPress URL / username / Application Password, **Save**, then **Test connection**.

---

## 4. Verify

- Open frontend → Dashboard → **Scrape Now** → posts appear.
- Review a post → **Publish to WP (draft)** → check WP admin for the new draft.
- Logs page shows scheduled cron firings (default: top of every hour).
- For generated images: regenerate one in Review; the public URL passed to WordPress must point at `PUBLIC_BASE_URL`, not `localhost`.

---

## Why not all-Vercel?

If you really want everything on Vercel, the backend would need a substantial rewrite:
- Replace SQLite with Postgres (Neon, Supabase, or Vercel Postgres).
- Move generated images to Vercel Blob, S3, or R2.
- Replace `node-cron` with [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) calling a `/api/cron/scrape` route.
- Split the Express app into individual serverless functions, and accept that image regeneration (60–180 s) won't fit unless you're on Enterprise.

For a single-user internal tool, Railway + Vercel is dramatically simpler and ~$5/mo.
