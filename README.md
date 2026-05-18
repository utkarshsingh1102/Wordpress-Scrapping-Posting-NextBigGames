# Gamigion → WordPress Auto-Publisher

Scrapes the latest posts from [Gamigion](https://www.gamigion.com/) and republishes them to a WordPress site (via REST API + Application Passwords). See [plan.md](./plan.md) for the original spec.

## Repo layout

```
/backend    Express + TypeScript + Prisma (SQLite)
/frontend   React + Vite + TypeScript + Tailwind
```

## Setup

```bash
# Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev    # creates dev.db
npm run dev               # http://localhost:3001

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Open `http://localhost:5173`. Set up WordPress credentials in the **Settings** page (or in `backend/.env`) and you're ready.

## Configuring WordPress

1. In WP admin, go to **Users → Profile → Application Passwords**.
2. Create a new application password named e.g. "Gamigion Publisher".
3. Either:
   - **Easy path:** Open the dashboard's **Settings** page, fill in URL/username/app password, click Save.
   - **CLI path:** Drop the values into `backend/.env`:
     ```
     WP_URL=https://your-wordpress-site.com
     WP_USERNAME=your-wp-username
     WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
     ```
     On first boot these get auto-migrated into the encrypted DB; .env is then optional.

## How credentials are stored

- WP application password is encrypted with **AES-256-GCM** before storage.
- Encryption key comes from `CRED_ENCRYPTION_KEY` env var (64-char hex). If unset, a key is auto-generated on first boot and saved to `backend/.cred-key` (gitignored, mode 0600).
- To rotate the key: delete `Settings.wpAppPasswordEnc` from DB, re-enter the password in the Settings UI.

## Scheduled scraping

By default the backend runs a scrape every hour at `:00`. Tune via the Settings page or `SCRAPE_CRON` in `.env`. Set `SCRAPE_CRON_ENABLED=false` (or uncheck the box in Settings) to disable.

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/settings` | GET / PUT | Read or update settings (PUT body validated via Zod) |
| `/api/scrape` | POST | Trigger a scrape of the latest 10 homepage posts |
| `/api/scrape-url` | POST | Scrape a single article URL (body: `{url}`) |
| `/api/posts?status=...` | GET | List posts, optionally filtered |
| `/api/posts/:id` | GET | One post with body HTML + images/links arrays |
| `/api/posts/:id` | DELETE | Mark a post as discarded |
| `/api/posts/:id/publish` | POST | Upload media + create WP draft post |
| `/api/jobs` | GET | List recent scrape jobs (newest first) |
| `/api/wp/test` | GET | Test WP credentials |

## Manual test checklist

Run through this after any non-trivial change. The whole list takes ~5 minutes.

**Setup**
- [ ] `cd backend && npm install && npx prisma migrate dev && npm run dev` — backend logs `Backend listening...` and `[cron] scrape scheduler started`
- [ ] `cd frontend && npm install && npm run dev` — Vite logs no warnings
- [ ] Open `http://localhost:5173` → Dashboard shows "0 scraped" with a "Scrape Now" button

**Scraper (Phase 2)**
- [ ] Click **Scrape Now** → "Scrape complete: N new · M skipped" appears within ~10s
- [ ] Re-click **Scrape Now** → all posts skipped (dedup works)
- [ ] Navigate to Review → list populated, click any post → preview pane renders title + featured image + body in iframe
- [ ] Body preview has NO "Share on", "About the author", "More posts" cruft

**Publisher (Phase 3)**
- [ ] In Review, click **Publish to WP (draft)** on a scraped post → success banner shows `WP draft #NNNN · X body images uploaded`
- [ ] Open the WP draft URL (`https://<your-wp>/wp-admin/post.php?post=NNNN&action=edit`) → title, body, featured image, date all match source
- [ ] Click Publish again on same post → button disabled, shows `Published (WP #NNNN)`
- [ ] Click **Discard** on a different post → confirm dialog → post disappears from "scraped" filter; appears in "all" with status=discarded

**Dashboard / Logs (Phase 4)**
- [ ] Dashboard stats (scraped / published / discarded) update after each action
- [ ] Logs page shows every scrape job — manual and scheduled — with correct counts
- [ ] If a job has errors, the "errors" link expands a pre-formatted error log

**Settings (Phase 5)**
- [ ] Settings page shows current values; app password placeholder is masked (`••••••••••••XXXX`)
- [ ] Click **Test connection** → "✓ Connected as <name>"
- [ ] Change cron to `*/5 * * * *`, Save → success banner; backend log shows `[cron] scrape scheduler started (cron='*/5 * * * *')`
- [ ] Restore cron to `0 * * * *`, Save → backend log shows the restart
- [ ] Uncheck Enabled, Save → backend log shows `scheduler disabled`; re-check, Save → starts again
- [ ] Type a new app password (any value), Save → success; click Test connection → still authenticates (you actually changed the stored cipher, so put back the real one if needed)
- [ ] Enter an invalid URL in Source URL → Save shows Zod validation error

**Encryption & key handling (Phase 5)**
- [ ] `backend/.cred-key` exists, mode is `-rw-------` (600)
- [ ] `sqlite3 backend/prisma/dev.db "SELECT length(wpAppPasswordEnc) FROM Settings WHERE id=1;"` returns >0
- [ ] The raw cipher in the DB is NOT plaintext (verify: `sqlite3 ... "SELECT wpAppPasswordEnc FROM Settings;"` returns base64, not the actual password)

**Resilience (Phase 5)**
- [ ] Temporarily set `WP_URL` in Settings to a bogus host like `https://nope.invalid.test` → Publish on a scraped post → after retries (visible in backend log: `[retry...] attempt N/3 failed`), returns a clear "backend unreachable" / "ENOTFOUND" error
- [ ] Restore real WP_URL, verify Publish works again

**Scheduler firing**
- [ ] Set cron to `* * * * *` (every minute), Save, wait ~60s → backend logs `[cron] scheduled scrape starting...` followed by the count line
- [ ] Restore to `0 * * * *`

## Architecture notes

- **Why no Playwright:** Gamigion exposes real image URLs in `data-src` attributes, so cheerio handles lazy-loaded images without a headless browser. If they switch to JS-only lazy loading, add Playwright as a per-URL fallback.
- **Why singleton Settings row:** one app, one config target. Multi-site WP targeting is explicitly out of scope (`plan.md` §2).
- **Why fire-and-wait scrape:** A scrape of 10 posts takes 5–15s. Job polling (Phase 5 alt path) would mean async job orchestration; the current sync path is simpler and acceptable for v1.
- **Why retries are split idempotent/non-idempotent:** GETs retry on 5xx; POSTs (`uploadMedia`, `createPost`) only retry on network errors with no response received — avoids creating duplicate WP media/posts.

## Limits & known issues

- The cron scheduler is in-process. If you `Ctrl+C` the backend, scheduled scrapes stop. Production deployments should use a process supervisor (pm2, systemd, Docker restart policy).
- Concurrent manual scrape + cron firing isn't locked — worst case you get duplicate fetches that all hit the dedup branch and return quickly. No data corruption.
- `confirm()` for discard is a browser dialog. Fine for v1; if you want a custom modal, drop it in `components/`.
- No automated tests. The checklist above is the substitute. If you add `vitest`, the highest-value targets are `src/crypto.ts` (round-trip) and `src/scraper/article.ts` (against fixture HTML).
