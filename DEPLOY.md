# Deployment Guide — Render + Neon (free tier, $0/mo)

Stack:
- **Frontend** → Render Static Site (free, always-on)
- **Backend** → Render Web Service (free; sleeps after 15 min idle)
- **Database** → Neon Postgres (free, 0.5 GB)
- **Generated images** → ephemeral local disk on Render (regenerated images won't persist across restarts; published WP drafts already store the image in WordPress, so this only affects the "Regenerated image" preview pane)

The repo includes a `render.yaml` Blueprint that defines both services. You can either use the Blueprint flow (one click) or set up each service manually.

---

## Step 1 — Create the database on Neon

1. Go to **https://console.neon.tech** → sign up (GitHub login is fine).
2. Click **Create Project**.
   - Project name: `gamigion-wp` (or anything)
   - Postgres version: leave default (16+)
   - Region: pick the same region you'll use for Render (e.g. `AWS us-east-1`)
3. After creation, you'll see a **Connection string** like:
   ```
   postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
4. **Copy it.** This is your `DATABASE_URL`.

---

## Step 2 — Generate a credential encryption key

Run locally (or use any 64-char hex generator):

```bash
openssl rand -hex 32
```

Copy the output. This is your `CRED_ENCRYPTION_KEY`. **Save it somewhere safe** — losing it means losing your stored WP password.

---

## Step 3 — Deploy on Render

### Option A: Blueprint (one-click, uses render.yaml)

1. Go to **https://dashboard.render.com/blueprints** → **New Blueprint Instance**.
2. Connect your GitHub if needed → select `Wordpress-Scrapping-Posting-NextBigGames`.
3. Render reads `render.yaml` and proposes two services. Click **Apply**.
4. Render will prompt for the secret env vars marked `sync: false`. Fill in:
   - **Backend `DATABASE_URL`**: paste your Neon connection string from Step 1.
   - **Backend `CRED_ENCRYPTION_KEY`**: paste the hex string from Step 2.
   - **Backend `PUBLIC_BASE_URL`**: *leave blank for now*, we'll fill after first deploy.
   - **Backend `CORS_ORIGIN`**: *leave blank for now*.
   - **Frontend `VITE_API_URL`**: *leave blank for now*.
5. Click **Create New Resources**. Render starts building both services.

### Option B: Manual (if Blueprint flow misbehaves)

**Backend (Web Service):**
1. **New +** → **Web Service** → select repo.
2. Root Directory: `backend`
3. Runtime: `Node`
4. Build Command: `npm install && npm run build`
5. Start Command: `npm run start`
6. Plan: **Free**
7. Environment variables: add `DATABASE_URL`, `CRED_ENCRYPTION_KEY`, `SOURCE_URL=https://www.gamigion.com/`, `SCRAPE_CRON=0 * * * *`, `SCRAPE_CRON_ENABLED=true`, `NODE_ENV=production`.
8. Create.

**Frontend (Static Site):**
1. **New +** → **Static Site** → same repo.
2. Root Directory: `frontend`
3. Build Command: `npm install && npm run build`
4. Publish Directory: `dist`
5. Rewrites/Redirects (Settings tab after creation): add `/* → /index.html` (Rewrite) for SPA routing.
6. Environment variables: add `VITE_API_URL` (leave blank for now).
7. Create.

---

## Step 4 — Wire the URLs together

Once both services finish deploying, Render gives each a URL:
- Backend: `https://gamigion-wp-backend.onrender.com`
- Frontend: `https://gamigion-wp-frontend.onrender.com`

Go back and set the cross-references:

**On the backend service** (Environment tab):
```
PUBLIC_BASE_URL = https://gamigion-wp-backend.onrender.com
CORS_ORIGIN     = https://gamigion-wp-frontend.onrender.com
```
Click **Save Changes** → it auto-redeploys.

**On the frontend service** (Environment tab):
```
VITE_API_URL = https://gamigion-wp-backend.onrender.com
```
Click **Save Changes** → **Manual Deploy** → **Deploy latest commit** (Vite env vars are baked at build time, must rebuild).

---

## Step 5 — Verify

1. Open `https://gamigion-wp-backend.onrender.com/api/health` → should return `{"ok":true,"time":"..."}`. First request may take 30–60 s as the free instance cold-starts.
2. Open the frontend URL → Dashboard should load (0 scraped initially).
3. Go to **Settings** → fill in WP URL, username, Application Password → **Save** → **Test connection** → "✓ Connected".
4. Dashboard → **Scrape Now** → should populate posts in 10–30 s.
5. Review a post → **Publish to WP (draft)** → check WordPress admin for the draft.

---

## Known limits on the free tier

| Limit | Impact |
|---|---|
| Backend sleeps after 15 min idle | First request after sleep takes ~30 s. Cron in-process **will not fire** while sleeping — manual scrape still works any time. |
| 750 backend hours/month | ~31 days × 24 h = 744. You won't hit this unless you have multiple free services. |
| 100 GB egress/month | Plenty for personal use. |
| Render disk = ephemeral | Generated images don't survive restart. Acceptable because images get uploaded to WordPress anyway during publish. |
| Neon free 0.5 GB | Tens of thousands of posts before this is a concern. |

If you outgrow this:
- **$7/mo backend Starter** = always-on, cron fires reliably, no cold-starts.
- **$1/mo persistent disk** = generated images persist between restarts.

---

## Local development — isolate dev DB from prod (Neon branches)

You can no longer just `npm run dev` without a Postgres. The recommended setup is a **Neon branch** so your local work doesn't write to production data:

1. Open the Neon console → your project (`wordpress-scrape-posting`).
2. Click **Branches** (left nav) → **Create branch**.
3. Name: `dev`. Parent: `main`. **Create branch**.
4. Click the new `dev` branch → copy its **Connection string** (looks identical to main but the host has a different `ep-...` prefix).
5. Edit `backend/.env` locally → set `DATABASE_URL="<that dev connection string>"`.
6. `cd backend && npx prisma db push` → applies the schema to the dev branch.
7. `npm run dev` — local backend now reads/writes the `dev` branch, completely isolated from production.

Branches in Neon are **copy-on-write** — they share storage until you diverge, so a dev branch is effectively free.

### Alternative: local Postgres via Docker

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17
```

Set `DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres` in `backend/.env`, then `npx prisma db push`.

### Render keeps pointing at `main`

Your Render service has the production connection string in its env vars and never sees `backend/.env`. As long as you only change the *local* `.env`, production is untouched.

---

## Why this isn't on Vercel

Vercel's serverless model breaks four things this backend needs: persistent filesystem (SQLite, generated images, `.cred-key`), long-running process (cron), and 60–180s execution times (image regen). Putting it on Vercel would mean rewriting all of that. Render's Web Service is a real always-on (or sleep-able) container, which fits the code as written.
