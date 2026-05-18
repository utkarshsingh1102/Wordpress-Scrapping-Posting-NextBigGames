# Project Plan: Gamigion → WordPress Auto-Publisher

## 1. Overview

A web application that scrapes the latest blog post(s) from **https://www.gamigion.com/**, extracts the full content (text, images, links, and styling), and republishes them to a **WordPress site built with the Elementor plugin**. The app includes an interactive frontend dashboard for monitoring, configuring, reviewing, and triggering scrape-and-publish jobs.

> ⚠️ **Note on usage rights:** Scraping and republishing third-party content can raise copyright and terms-of-service issues. Confirm you have permission to repost Gamigion content before deploying this in production.

---

## 2. Goals & Scope

### In Scope
- Scrape latest post(s) from Gamigion (title, body, images, links, author, date, category).
- Preserve inline styling and structure (headings, paragraphs, lists, embeds).
- Download and re-host images on the WordPress media library.
- Create draft or published posts in WordPress via REST API.
- Frontend UI to trigger scrapes, preview content, manage settings, and view logs.
- Scheduled/automated scraping (cron-style).
- Deduplication so the same post isn't published twice.

### Out of Scope (v1)
- Scraping gated/premium Gamigion content (login required).
- Multi-site publishing (only one WordPress target in v1).
- AI rewriting/spinning of content.

---

## 3. Target Site Structure (Gamigion)

From inspection, Gamigion is a WordPress + Elementor site. Key observations for the scraper:

- **Homepage** lists posts in "Highlights", "Journal", "Trending", and "Game Analysis" sections.
- Each post card contains: a link to the post URL, title (in heading tags), author link (`/author/...`), date, and category link (`/category/...`).
- Post URLs follow the pattern: `https://www.gamigion.com/<post-slug>/`
- Images on listing pages are lazy-loaded (base64 SVG placeholders) — the scraper must visit the **individual post page** to get real image `src` URLs.
- Article pages contain Open Graph meta tags (`og:title`, `og:image`, `og:description`, `article:published_time`, `article:modified_time`) — use these as a reliable source of metadata.

### Recommended scrape flow
1. Fetch homepage → parse the post list → collect candidate post URLs (in order).
2. For each new URL, fetch the full article page.
3. Extract from the article page:
   - `og:title` / `<h1>` for the title
   - Main article container for body HTML
   - `og:image` + inline `<img>` tags for images
   - `article:published_time`, author, category from meta + DOM
4. Pass structured data to the WordPress publisher.

---

## 4. Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────────┐
│   Frontend UI   │◄────►│   Backend API    │◄────►│  Scraper Service   │
│  (React/Next)   │      │  (Node/Express)  │      │  (Playwright/      │
│                 │      │                  │      │   Cheerio)         │
└─────────────────┘      └────────┬─────────┘      └────────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐      ┌────────────────────┐
                         │    Database      │      │  WordPress Target  │
                         │  (SQLite/Postgres)│      │  (REST API +       │
                         │  - jobs          │      │   Elementor)       │
                         │  - posts         │      └────────────────────┘
                         │  - settings      │
                         └──────────────────┘
```

### Components
1. **Frontend (React + Vite or Next.js)** — dashboard, preview, settings, logs.
2. **Backend API (Node.js + Express)** — orchestrates scraping, publishing, scheduling, exposes REST endpoints to the frontend.
3. **Scraper Service** — uses **Playwright** (headless browser, handles lazy-loaded images and JS rendering) plus **Cheerio** for fast HTML parsing.
4. **Database** — stores scraped posts, job history, dedupe records, and settings. SQLite for simplicity; Postgres if scaling.
5. **WordPress Publisher** — module that talks to the WordPress REST API.

---

## 5. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS | Fast, simple, good DX |
| Backend | Node.js + Express | Same language across stack |
| Scraping | Playwright + Cheerio | Playwright renders JS/lazy images; Cheerio parses fast |
| Scheduling | node-cron | Simple in-process scheduling |
| Database | SQLite (via Prisma ORM) | Zero-config; Prisma makes Postgres migration easy |
| HTTP client | axios | Familiar, interceptors |
| WP integration | WordPress REST API | Official, supports media + posts |

---

## 6. Scraper Module — Detailed Spec

### Responsibilities
- Fetch the Gamigion homepage and parse the list of latest posts.
- For each post URL, fetch the full article page.
- Extract structured content.

### Extraction targets (per post)
- **Title** — `og:title` meta, fallback to `<h1>`.
- **Slug** — derived from the URL.
- **Body HTML** — the main article/content container. Strip site nav, sidebars, footers, login modals, and ads.
- **Images** — collect every `<img>` real `src` (resolve lazy-load `data-src` / `srcset`). Also grab `og:image` as the featured image.
- **Links** — preserve all `<a href>` inside the body; optionally rewrite relative links to absolute.
- **Styling** — keep semantic HTML tags (`<h2>`, `<strong>`, `<ul>`, `<blockquote>`, etc.). Optionally capture inline `style` attributes and class names. For Elementor, content goes into the post body as HTML — Elementor's theme styles will re-skin standard tags.
- **Metadata** — author, published date, modified date, category/tags from meta tags and DOM.

### Handling lazy-loaded images
The listing page uses base64 SVG placeholders. The scraper **must**:
- Either visit each post's own page where images may be fully loaded, **or**
- Use Playwright to scroll the page and wait for `img` elements to get real `src` values.

### Output format (per post)
```json
{
  "sourceUrl": "https://www.gamigion.com/<slug>/",
  "title": "Post title",
  "slug": "post-slug",
  "author": "Author Name",
  "publishedAt": "2026-05-13T...",
  "category": "Highlights",
  "featuredImage": "https://.../image.png",
  "bodyHtml": "<p>...</p>",
  "images": ["https://.../1.png", "https://.../2.png"],
  "links": ["https://..."]
}
```

---

## 7. WordPress Publisher Module — Detailed Spec

### Authentication
- Use **WordPress Application Passwords** (built into WP 5.6+) with Basic Auth over HTTPS.
- Store credentials securely in environment variables / settings table (encrypted).

### Publishing flow
1. **Dedupe check** — query local DB for `sourceUrl`. Skip if already published.
2. **Upload images** — for each image:
   - Download the binary from Gamigion.
   - `POST /wp-json/wp/v2/media` to upload to the WordPress media library.
   - Capture the new WordPress media URL + ID.
3. **Rewrite body HTML** — replace original Gamigion image URLs with the new WordPress media URLs.
4. **Set featured image** — use the uploaded media ID for `featured_media`.
5. **Create the post** — `POST /wp-json/wp/v2/posts` with:
   - `title`, `content` (rewritten HTML), `status` (`draft` or `publish` — configurable), `categories`, `tags`, `featured_media`, `date`.
6. **Save record** — store the WordPress post ID + source URL in the DB.

### Elementor consideration
- Posts created via REST API use the standard WordPress content field. They will render through Elementor's **Single Post template** if one is configured — standard HTML tags inherit theme/Elementor styling.
- If you need the content itself to be Elementor-editable (drag-and-drop widgets), that requires writing Elementor's `_elementor_data` meta as JSON — significantly more complex. **Recommendation for v1:** publish as standard HTML content and let the Elementor Single Post template handle layout/skin.

### WordPress REST API endpoints used
| Action | Endpoint | Method |
|---|---|---|
| Upload media | `/wp-json/wp/v2/media` | POST |
| Create post | `/wp-json/wp/v2/posts` | POST |
| List/match categories | `/wp-json/wp/v2/categories` | GET |
| Create category | `/wp-json/wp/v2/categories` | POST |

---

## 8. Frontend UI — Detailed Spec

### Pages / Views

**a) Dashboard**
- "Scrape Now" button (triggers a manual scrape).
- Status of the latest job (running / success / failed).
- Stats: total posts scraped, published, skipped (duplicates).

**b) Post Review / Preview**
- List of scraped posts pending review.
- Click a post → preview pane shows rendered title, body, images as they'll appear.
- Per-post actions: **Publish**, **Edit**, **Discard**.
- Toggle: publish as Draft vs. Publish immediately.

**c) Settings**
- WordPress site URL, username, application password.
- Source site URL (default: Gamigion homepage).
- Default post status (draft/publish).
- Default category mapping (Gamigion category → WP category).
- Scrape schedule (e.g., every 6 hours, daily).

**d) Logs / History**
- Table of all jobs: timestamp, posts found, published, skipped, errors.
- Expandable error details.

### UX notes
- Use optimistic UI + toasts for actions.
- Show image previews in the review pane.
- Confirmation modal before publishing.

---

## 9. Database Schema

```
Settings
  id, wpUrl, wpUsername, wpAppPassword (encrypted),
  sourceUrl, defaultStatus, schedule, categoryMap (JSON)

Post
  id, sourceUrl (unique), title, slug, author, publishedAt,
  category, featuredImage, bodyHtml, status
  (scraped|reviewed|published|discarded),
  wpPostId, scrapedAt, publishedAt

Job
  id, type (manual|scheduled), startedAt, finishedAt,
  status, postsFound, postsPublished, postsSkipped, errorLog
```

---

## 10. API Endpoints (Backend)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/scrape` | POST | Trigger a manual scrape |
| `/api/posts` | GET | List scraped posts (filter by status) |
| `/api/posts/:id` | GET | Get one post's full content |
| `/api/posts/:id/publish` | POST | Publish a specific post to WordPress |
| `/api/posts/:id` | DELETE | Discard a scraped post |
| `/api/settings` | GET / PUT | Read or update settings |
| `/api/jobs` | GET | List job history |
| `/api/health` | GET | Health check |

---

## 11. Build Phases

### Phase 1 — Setup & Scaffolding
- Init repo, backend (Express), frontend (React+Vite), Prisma + SQLite.
- Health-check endpoint and basic frontend shell.

### Phase 2 — Scraper
- Implement homepage parsing → list of post URLs.
- Implement article-page extraction (title, body, images, meta).
- Handle lazy-loaded images with Playwright.
- Store scraped posts in DB.

### Phase 3 — WordPress Publisher
- Implement Application Password auth.
- Implement media upload + body image-URL rewriting.
- Implement post creation with categories + featured image.
- Dedupe logic.

### Phase 4 — Frontend
- Dashboard with "Scrape Now".
- Post review/preview with publish/discard.
- Settings page.
- Logs/history view.

### Phase 5 — Scheduling & Polish
- node-cron scheduled scrapes.
- Error handling, retries, rate limiting.
- Encrypt stored credentials.
- End-to-end testing.

---

## 12. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Copyright / ToS violation | Get permission; consider attribution links; keep as draft for human review |
| Gamigion HTML structure changes | Centralize selectors in a config file; add fallback selectors; alert on extraction failure |
| Lazy-loaded images missed | Use Playwright with scroll + wait-for-image; fallback to `og:image` |
| Duplicate posts | Unique constraint on `sourceUrl` + pre-publish dedupe check |
| WordPress auth issues | Use Application Passwords over HTTPS; validate connection in Settings |
| Elementor not styling content | Configure an Elementor Single Post template; publish standard semantic HTML |
| Rate limiting / IP blocks | Throttle requests; respect robots.txt; add delays between fetches |

---

## 13. Environment Variables

```
# Backend
PORT=3001
DATABASE_URL="file:./dev.db"
CRED_ENCRYPTION_KEY=<random-32-byte-key>

# WordPress (can also be set via Settings UI)
WP_URL=https://your-wordpress-site.com
WP_USERNAME=your-wp-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

# Source
SOURCE_URL=https://www.gamigion.com/
```

---

## 14. Deliverables

- `/backend` — Express API, scraper service, WordPress publisher, Prisma schema.
- `/frontend` — React dashboard.
- `README.md` — setup instructions, how to configure WordPress Application Passwords.
- `.env.example` — sample environment file.
- This `plan.md`.
