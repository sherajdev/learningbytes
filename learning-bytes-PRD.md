# Learning Bytes — Product Requirements Document

**Project type:** Personal learning journal blog
**Domain:** learningbytes.sheraj.org
**Target builder:** Claude Code
**Content source:** Notion (Bytes + Sources databases — already built)
**Last updated:** April 2026

---

## 1. Overview

Learning Bytes is a personal blog where the owner documents their learning journey. The unit of content is a "byte" — which can be either a short note (a quick thought, a takeaway, a snippet) or a long-form post (a fuller writeup or tutorial). Each byte may credit one or more sources (articles, videos, books, conversations) that inspired it.

The Notion workspace is the single source of truth. Writing happens in Notion; the website is built statically from the Notion API and deployed to Cloudflare Pages on `learningbytes.sheraj.org`.

The site should feel fast, minimal, and writer-focused, requiring zero ongoing maintenance for routine publishing.

---

## 2. Goals & non-goals

### Goals
- Publish content by writing in Notion — no git commits, no CMS dashboard logins
- Sub-second page loads on mobile and desktop
- Two presentation modes: short notes (minimal layout) and long-form posts (full layout)
- Each byte can credit its sources, with source links visible to readers
- Owner can search, filter by tag, and browse by series
- Visitors can read comfortably in light or dark mode
- Owner can see view counts to understand what resonates
- Deploy to Cloudflare Pages on the existing Cloudflare-managed domain

### Non-goals (v1)
- User accounts, comments, newsletter signup
- Multi-author support
- Monetization, ads, paywalls
- Notion webhook auto-rebuild (manual rebuild trigger is fine for v1)

---

## 3. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Astro** (latest stable) | Content-first, ships zero JS by default, great Markdown/MDX support |
| UI components | **React** islands via `@astrojs/react` | Owner is comfortable with React; use only where interactivity is needed |
| Styling | **Tailwind CSS** via `@astrojs/tailwind` | Fast iteration, easy dark mode |
| Content source | **Notion API** (Bytes + Sources databases) | Already built; owner writes in Notion |
| Notion SDK | `@notionhq/client` + `notion-to-md` | Convert Notion blocks to markdown at build time |
| Search | **Pagefind** | Static, no backend, ~30KB, indexes at build time |
| Analytics | **Cloudflare Web Analytics** | Free, privacy-friendly, no cookie banner needed |
| Hosting | **Cloudflare Pages** | Free tier; owner already uses Cloudflare for the domain |
| DNS | **Cloudflare DNS** (existing) | `learningbytes.sheraj.org` subdomain to be configured |
| File downloads | `public/downloads/` for small files; **Cloudflare R2** later if needed | Zero egress fees on R2; start simple |
| Image handling | **Download to local at build time** (see §7 — critical) | Notion image URLs expire after ~1 hour |

---

## 4. Content model

The Notion workspace contains two databases that are already set up: **Bytes** (the main content) and **Sources** (reference material). Claude Code should treat the schemas below as authoritative and adapt the fetch script if the property names in Notion differ slightly.

### 4.1 Bytes database

| Property | Type | Required | Notes |
|---|---|---|---|
| `Title` | Title | ✅ | Byte title |
| `Slug` | Rich text | ✅ | URL-safe slug, e.g. `learning-astro-islands` |
| `Status` | Select | ✅ | `Draft`, `Published`, `Archived` — only `Published` appears on the site |
| `Format` | Select | ✅ | `Note` (short, minimal layout) or `Post` (long-form, full layout) |
| `Published date` | Date | ✅ | Used for sorting and display |
| `Updated date` | Date | ❌ | Optional; shown if present |
| `Excerpt` | Rich text | ✅ | 1–2 sentence summary for cards and meta description |
| `Tags` | Multi-select | ❌ | e.g. `astro`, `ai`, `productivity` |
| `Series` | Select | ❌ | e.g. `Building Learning Bytes` — groups multi-part posts |
| `Series order` | Number | ❌ | Order within a series (1, 2, 3…) |
| `Cover image` | Files & media | ❌ | Optional hero image |
| `Sources` | Relation → Sources DB | ❌ | One or more linked sources |
| `Reading time` | Number | ❌ | Auto-computed at build if not set |

The byte body lives in the Notion page itself and may contain: headings, paragraphs, lists, code blocks (with language), images, callouts, quotes, dividers, embeds (YouTube, tweets, CodePen), and bookmarks.

### 4.2 Sources database

| Property | Type | Required | Notes |
|---|---|---|---|
| `Title` | Title | ✅ | Source title |
| `Type` | Select | ✅ | `Article`, `Video`, `Book`, `Podcast`, `Course`, `Conversation`, `Other` |
| `URL` | URL | ❌ | Link to the source (if applicable) |
| `Author` | Rich text | ❌ | Author/creator name |
| `Notes` | Rich text | ❌ | Owner's private notes (not shown on site) |

Only `Title`, `Type`, `URL`, and `Author` are exposed on the public site. `Notes` stays private.

---

## 5. Site structure & routes

```
/                           Home — latest bytes mixed feed (notes + posts)
/bytes                      All bytes, paginated
/bytes/[slug]               Individual byte page (layout depends on Format)
/tags                       Tag index
/tags/[tag]                 Bytes filtered by tag
/series                     Series index
/series/[series]            Bytes in a series, ordered
/sources                    Sources index (browse by source)
/sources/[id]               All bytes that reference a given source
/search                     Search results page (Pagefind)
/about                      About page (static markdown)
/rss.xml                    RSS feed
/404                        Custom 404
```

---

## 6. Page-by-page requirements

### 6.1 Home (`/`)
- Site title and 1–2 line tagline
- Theme toggle (light/dark/system) in header
- Search icon in header that opens a Pagefind modal
- "Latest bytes" feed: chronological mix of recent notes and posts (10 items)
  - **Notes** render as inline cards with the full short-form content visible (no click-through needed for the gist)
  - **Posts** render as preview cards with cover image, title, excerpt, and a "Read more" link
- "Browse by series" section: list of series with byte counts
- Footer: copyright, RSS link, link to source repo (optional)

### 6.2 All bytes (`/bytes`)
- Paginated list, 10 items per page
- Same mixed-format feed as home
- Filter chips at top: tag filter, format filter (All / Notes / Posts), source filter
- Pagination controls at bottom

### 6.3 Byte detail (`/bytes/[slug]`)

**Layout differs based on `Format` property:**

**For `Note` (minimal layout):**
- Small header with title, date, tags
- Full body content rendered cleanly
- Sources strip at the bottom: "Inspired by:" followed by source chips with title + type icon + outbound link
- Compact footer with prev/next byte navigation
- No cover image, no reading time, no sharing buttons (keep it light)

**For `Post` (full layout):**
- Cover image (if set), title, published date, updated date (if set), reading time, tags
- If part of a series: a banner at the top showing series name and "Part X of Y" with prev/next links
- Rendered body from Notion
- Code blocks with Shiki syntax highlighting and a copy button
- Embedded YouTube videos render as responsive iframes with lazy loading
- Images use Astro's `<Image />` component for optimization
- "Sources" section at the bottom: full source cards (title, author, type, link)
- Tags, share links (Twitter/X, LinkedIn, copy link)
- "More in this series" or "Related by tag" section
- Open Graph and Twitter Card meta tags

### 6.4 Tag pages (`/tags` and `/tags/[tag]`)
- `/tags`: cloud or list of all tags with byte counts
- `/tags/[tag]`: bytes filtered by that tag, mixed-format feed

### 6.5 Series pages (`/series` and `/series/[series]`)
- `/series`: list all series with description and byte count
- `/series/[series]`: ordered list of bytes in that series

### 6.6 Sources pages (`/sources` and `/sources/[id]`)
- `/sources`: list all sources referenced by published bytes, grouped by Type
- `/sources/[id]`: source details (title, author, type, link) plus a list of every byte that references it
- Sources only appear on the site if at least one Published byte references them

### 6.7 Search (`/search`)
- Pagefind UI, modal-style or dedicated page
- Searches title, excerpt, body, tags
- Results show title, excerpt snippet with highlighted match, format badge, tags

### 6.8 About (`/about`)
- Simple static page; content lives in `src/content/about.md` (not Notion — it changes rarely)

---

## 7. Notion → site build pipeline

### ⚠️ CRITICAL: Notion image expiry

**Notion image URLs expire after approximately 1 hour.** This is the #1 way builds for this kind of project break in production. The fetch script **must** download all images (cover images, inline images from byte bodies) to the local filesystem at build time and rewrite the markdown to reference the local copies. Do NOT leave Notion S3 URLs in the generated markdown — the site will silently break the next time you visit it.

### Build steps

1. On `npm run build`, a script (`scripts/fetch-notion.ts`) runs **before** Astro builds:
   - Authenticates with Notion using `NOTION_API_KEY` (env var)
   - Queries the **Sources** database first and caches all sources to `src/content/sources/[id].json`
   - Queries the **Bytes** database, filtering `Status = Published`
   - For each byte:
     - Fetches the page blocks
     - Converts blocks to markdown using `notion-to-md` or equivalent
     - **Downloads every image** referenced in the body and the cover image to `src/assets/notion/[slug]/`, then rewrites image paths in the markdown to local paths
     - Resolves the `Sources` relation to actual source records
     - Computes reading time if not set
     - Writes a `.md` file with frontmatter (including `format`, `sources`, etc.) to `src/content/bytes/[slug].md`
2. Astro then builds the site from these generated markdown files using a typed content collection
3. Pagefind indexes the built `dist/` folder as a post-build step
4. Output is deployed to Cloudflare Pages

**Important:** The generated `src/content/bytes/`, `src/content/sources/`, and `src/assets/notion/` directories should be `.gitignore`d. The Notion fetch runs fresh on every build.

**Build command for Cloudflare Pages:** `npm run build`
**Build output directory:** `dist`
**Environment variables needed:**
- `NOTION_API_KEY` — Notion integration token
- `NOTION_BYTES_DB_ID` — ID of the Bytes database
- `NOTION_SOURCES_DB_ID` — ID of the Sources database

---

## 8. Theming & design

- **Light and dark mode**, toggle in header. Default to system preference. Persist choice in `localStorage`.
- **Typography:** a clean serif for body (e.g. Source Serif, Lora) and a sans-serif for headings/UI (e.g. Inter). System font fallbacks.
- **Color palette:** neutral, with one accent color the owner can change easily (single CSS variable). Avoid pure black; use a soft off-black like `#1a1a1a` for dark mode background.
- **Format visual distinction:** notes and posts should be visually distinguishable in feeds — e.g. notes have a small "note" badge or a different card background; posts get the full card treatment with cover image.
- **Spacing:** generous line height (1.7+) and reading width capped at ~70ch for body text.
- **Mobile-first:** test at 375px width as the baseline.
- **Accessibility:** WCAG AA contrast minimum, focus rings on interactive elements, semantic HTML, alt text on images (pulled from Notion captions where available).

---

## 9. Analytics

- **Cloudflare Web Analytics** snippet injected into the base layout
- View counts displayed on byte cards and detail pages
- For byte-level view counts, query the Cloudflare Web Analytics GraphQL API at build time and inject counts into the static site. Default to **build-time injection** for v1 — simpler than a runtime worker.
- No third-party trackers, no cookies, no consent banner needed

---

## 10. Performance budget

- Lighthouse Performance score ≥ 95 on mobile
- Largest Contentful Paint < 1.5s on 4G
- Total JS shipped per page ≤ 50KB (excluding optional Pagefind)
- All images served as WebP/AVIF with proper `width`/`height` to prevent layout shift
- Fonts loaded with `font-display: swap` and preloaded

---

## 11. Project structure

```
learning-bytes/
├── astro.config.mjs
├── tailwind.config.cjs
├── tsconfig.json
├── package.json
├── .env.example              # NOTION_API_KEY, NOTION_BYTES_DB_ID, NOTION_SOURCES_DB_ID
├── .gitignore                # includes src/content/bytes/, src/content/sources/, src/assets/notion/
├── public/
│   ├── favicon.svg
│   └── downloads/            # static files for download links
├── scripts/
│   └── fetch-notion.ts       # runs before build
├── src/
│   ├── content/
│   │   ├── config.ts         # content collection schemas (bytes + sources)
│   │   ├── bytes/            # generated from Notion (gitignored)
│   │   ├── sources/          # generated from Notion (gitignored)
│   │   └── about.md
│   ├── assets/
│   │   └── notion/           # downloaded Notion images (gitignored)
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── NoteCard.astro    # inline-render short notes
│   │   ├── PostCard.astro    # preview card for long-form posts
│   │   ├── SourceChip.astro  # compact source link
│   │   ├── SourceCard.astro  # full source card for post pages
│   │   ├── ThemeToggle.tsx   # React island
│   │   ├── SearchModal.tsx   # React island
│   │   ├── SeriesNav.astro
│   │   └── Download.astro    # styled download link card
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   ├── NoteLayout.astro  # minimal layout for short notes
│   │   └── PostLayout.astro  # full layout for long-form posts
│   ├── pages/
│   │   ├── index.astro
│   │   ├── bytes/
│   │   │   ├── index.astro
│   │   │   └── [slug].astro  # routes to NoteLayout or PostLayout based on format
│   │   ├── tags/
│   │   │   ├── index.astro
│   │   │   └── [tag].astro
│   │   ├── series/
│   │   │   ├── index.astro
│   │   │   └── [series].astro
│   │   ├── sources/
│   │   │   ├── index.astro
│   │   │   └── [id].astro
│   │   ├── search.astro
│   │   ├── about.astro
│   │   └── 404.astro
│   └── styles/
│       └── global.css
└── README.md
```

---

## 12. Build & deploy

1. Owner pushes code to GitHub
2. Cloudflare Pages connected to the repo, auto-deploys on push to `main`
3. Build command: `npm run build` (which runs `fetch-notion.ts` then `astro build` then `pagefind`)
4. Custom domain `learningbytes.sheraj.org` configured in Cloudflare Pages — add a CNAME in Cloudflare DNS pointing to the Pages project
5. To publish a new byte: write it in Notion, set Status to `Published`, then trigger a manual rebuild from Cloudflare Pages dashboard. Bookmark the deploy hook URL for one-click rebuilds.

---

## 13. Build order for Claude Code

Build the site in this order. **Do not skip ahead** — each step de-risks the next.

1. **Scaffold the Astro project** with React, Tailwind, MDX, and Sitemap integrations. Verify `npm run dev` shows a blank Astro page.
2. **Set up the content collection schemas** in `src/content/config.ts` with strict TypeScript types matching the Bytes and Sources schemas in §4.
3. **🚨 MILESTONE: Fetch one byte from Notion and print it.** Write `scripts/fetch-notion.ts` and verify it can authenticate, query the Bytes database, fetch one Published byte, and write a single `.md` file. **Do not build any pages until this works.** This is the make-or-break step for this entire project.
4. **Extend the fetch script** to handle all Published bytes, resolve Sources relations, compute reading times, and **download all images locally** (see §7 critical warning).
5. **Build BaseLayout, NoteLayout, and PostLayout** — verify each layout renders one sample byte correctly.
6. **Build the home page** — mixed feed of notes and posts.
7. **Build the byte detail route** (`/bytes/[slug]`) — dispatching to NoteLayout or PostLayout based on Format.
8. **Build `/bytes` index, then tag pages, then series pages, then sources pages.**
9. **Add Pagefind** as the final post-build step.
10. **Add Cloudflare Web Analytics snippet.**
11. **Configure Cloudflare Pages deployment** and connect the custom domain.
12. **Provide a `README.md`** with setup instructions: how to create the Notion integration, share both databases with it, get the database IDs, configure env vars locally, and deploy.

Include an `.env.example` file. Commit a sample `src/content/about.md` so the about page renders on a fresh clone.

---

## 14. Open questions / future versions

- **v1.1:** "More like this" recommendations based on shared tags/sources
- **v1.2:** Newsletter signup (Buttondown or ConvertKit)
- **v1.3:** Comments (Giscus, GitHub Discussions-backed)
- **v2:** Migrate large downloads to Cloudflare R2 if `public/downloads/` exceeds 100MB
- **v2:** Webhook-triggered rebuilds (Notion doesn't natively send webhooks — would need a polling Cloudflare Worker on a cron trigger)
- **v2:** Spaced-repetition review surface for old notes (ties back to the Notion workspace's learning-tracker side)

---

## 15. Acceptance criteria for v1

- [ ] Writing a byte in Notion, marking it Published, and rebuilding produces a live byte on the site
- [ ] Notes render with the minimal layout; Posts render with the full layout
- [ ] Bytes can credit one or more sources, and source links work
- [ ] Sources index page shows all sources referenced by published bytes
- [ ] All Notion images are downloaded locally — no expiring S3 URLs in production HTML
- [ ] Home page shows a mixed feed of latest notes and posts
- [ ] Tag, series, and source filtering all work and link bidirectionally
- [ ] Search returns relevant results from titles, excerpts, and body text
- [ ] Dark mode toggle works and persists across page loads
- [ ] Site achieves ≥95 mobile Lighthouse Performance score on a real byte page
- [ ] Cloudflare Web Analytics shows page views in the dashboard
- [ ] `learningbytes.sheraj.org` serves the site over HTTPS
