# Learning Bytes

Personal learning blog at [learningbytes.sheraj.org](https://learningbytes.sheraj.org). Notion is the sole source of truth — two Notion databases (**Bytes** and **Sources**) are pulled at build time, converted to Markdown, and rendered as a static site by Astro.

## Stack

- **[Astro](https://astro.build)** — static site generator
- **React** islands via `@astrojs/react` (for interactive bits only)
- **Tailwind CSS v4** — styling
- **MDX** — for the occasional rich content block
- **[Pagefind](https://pagefind.app)** — static search index, built post-`astro build`
- **[@notionhq/client](https://github.com/makenotion/notion-sdk-js)** + **[notion-to-md](https://github.com/souvikinator/notion-to-md)** — Notion → Markdown pipeline
- **[sharp](https://sharp.pixel.lib/)** — Notion image download + responsive WebP conversion at build time
- **Cloudflare Pages** — hosting, CI, custom domain, SSL
- **Cloudflare Web Analytics** — cookieless pageview tracking

## Content model

Content lives in two Notion databases. The build script reads them, so the property names below must match exactly (case-sensitive). See `src/content.config.ts` for the typed schema.

### Bytes database

Each row is one published note or post.

| Property | Type | Notes |
|---|---|---|
| `Title` | Title | |
| `Slug` | Rich text | URL-safe, unique |
| `Status` | Select | Only rows with `Published` are fetched |
| `Format` | Select | `Note` (inline-readable) or `Post` (full layout) |
| `Published date` | Date | |
| `Updated date` | Date | Optional |
| `Excerpt` | Rich text | Optional, shown in feeds |
| `Tags` | Multi-select | |
| `Series` | Select | Optional, groups posts into a sequence |
| `Series order` | Number | Optional, orders posts within a series |
| `Cover image` | Files & media | Optional, downloaded and converted to responsive WebP at build time |
| `Sources` | Relation → Sources DB | Citations for the byte |
| `Reading time` | Number | Auto-computed by the fetch script, leave blank |

### Sources database

Canonical list of books, articles, papers, videos, etc. A source only appears publicly if at least one published byte references it.

| Property | Type |
|---|---|
| `Title` | Title |
| `Author` | Rich text |
| `Type` | Select (book, article, paper, video, etc.) |
| `URL` | URL |
| `Notes` | Rich text |

## Notion integration setup

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration**.
2. Name it (e.g. `Learning Bytes Build`), associate it with your workspace, give it **Read content** capability (no write/comment needed).
3. Copy the **Internal Integration Secret** — this is your `NOTION_API_KEY`.
4. **Share both databases with the integration.** This is the step that's easy to miss:
   - Open the Bytes database in Notion → top-right `...` menu → **Connections** → add the integration.
   - Repeat for the Sources database.
   - Without this, the API returns 404s even though the key is valid.
5. Grab each database ID from its URL. A Notion DB URL looks like `https://www.notion.so/workspace/<DB_ID>?v=...` — the 32-char hex (with or without dashes) before the `?` is the ID.

## Local development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/sherajdev/learningbytes.git
cd learningbytes
npm install
cp .env.example .env
# fill in the values in .env
```

### Environment variables

See `.env.example`. All required values:

| Variable | Purpose |
|---|---|
| `NOTION_API_KEY` | Notion integration secret (step 3 above) |
| `NOTION_BYTES_DB_ID` | Bytes database ID |
| `NOTION_SOURCES_DB_ID` | Sources database ID |
| `PUBLIC_CF_ANALYTICS_TOKEN` | Cloudflare Web Analytics site token (optional in dev) |

The `PUBLIC_` prefix on the analytics token is required — Astro only exposes env vars with that prefix to client-side HTML.

### Commands

```bash
npm run dev      # Astro dev server (skips Notion fetch — uses whatever is in src/content/)
npm run fetch    # Run the Notion sync in isolation (useful for debugging)
npm run build    # Full pipeline: fetch-notion → astro build → pagefind
npm run preview  # Serve the built dist/ locally
```

Important: `npm run dev` does **not** refetch from Notion. If the local content collection is empty, run `npm run fetch` first (or just `npm run build` once). The generated content directories (`src/content/bytes/`, `src/content/sources/`, `src/assets/notion/`) are gitignored — they're rebuilt fresh every time.

## Build pipeline

`npm run build` runs three stages in order:

1. **`tsx scripts/fetch-notion.ts`** — Queries Notion, writes one Markdown file per published byte to `src/content/bytes/`, writes cached source JSON to `src/content/sources/`, and:
   - **Cover images:** Downloads the optional cover image from Notion, converts to responsive WebP at 400w, 800w, 1200w using `sharp`, saves to `src/assets/notion/[slug]/`, and writes the path into byte frontmatter as `coverImage`.
   - **Inline body images:** Finds all Notion-hosted image URLs (`notion-static.com`, `prod-files-secure`, `amazonaws.com`) in the byte body, downloads and converts each to responsive WebP locally, then rewrites the markdown to reference the local files.
   
   This is critical: Notion's hosted image URLs expire roughly an hour after being issued. Shipping them in the built HTML would cause the site to silently break on the next visitor load. All images are persisted to `src/assets/notion/` which is gitignored — they're rebuilt fresh every build.
2. **`astro build`** — Reads the typed content collections and generates static HTML in `dist/`.
3. **`pagefind --site dist`** — Crawls the built HTML and writes a search index to `dist/pagefind/`, which the `/search` page loads client-side.

## Deployment

The site deploys automatically to Cloudflare Pages on every push to `main`:

- **Project:** `learningbytes` on Cloudflare Pages
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Production branch:** `main`
- **Env vars:** Same as `.env.example`, configured under Pages → Settings → Environment variables. `NOTION_API_KEY` is marked as encrypted (secret); the other three are plain.

Preview deployments are generated automatically for every branch and pull request.

### Publishing a byte

Notion is the source of truth, so "publishing" means flipping a row's `Status` to `Published` in the Bytes database. A scheduled GitHub Actions workflow (`.github/workflows/notion-publish-poll.yml`) polls Notion every 10 minutes and, if any Published byte has been edited in the last 15 minutes, POSTs a Cloudflare Pages **deploy hook** to trigger a rebuild. Expect the site to update within ~10–15 minutes of saving the change in Notion.

The same mechanism covers edits to already-published bytes: any save that changes `last_edited_time` on a Published row will trigger a rebuild on the next tick.

**To set this up (one-time):**

1. **Create the deploy hook.** Cloudflare Pages dashboard → your `learningbytes` project → **Settings** → **Builds & deployments** → **Deploy hooks** → **Add deploy hook**. Name it something like `notion-poll`, target the `main` branch, save, and copy the URL. Treat this URL as a secret — anyone with it can trigger builds on your account. Store it in a password manager (e.g. 1Password). Never commit it.
2. **Add GitHub Actions secrets.** Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add three:
   - `CLOUDFLARE_DEPLOY_HOOK_URL` — the URL from step 1
   - `NOTION_API_KEY` — same value as in your local `.env`
   - `NOTION_BYTES_DB_ID` — same value as in your local `.env`
3. **Trigger a test run.** Repo → **Actions** tab → **Notion publish poll** → **Run workflow**. If the job is green and you recently edited a Published byte, you'll see a new Cloudflare Pages deployment start within seconds.

**Manual override.** If the scheduled workflow is paused or broken and you need to force a build right now:

- **Re-run the latest deploy** from the Cloudflare Pages dashboard (Deployments → `...` → Retry), or
- **Dispatch the workflow manually** from the Actions tab (use the `workflow_dispatch` button on the poll workflow).

## Project layout

```
scripts/
  fetch-notion.ts        # Notion → Markdown + local image pipeline (cover + inline)
src/
  content.config.ts      # Typed content collection schemas (authoritative)
  assets/
    notion/              # Downloaded Notion images — gitignored, rebuilt each build
  layouts/
    BaseLayout.astro     # Shell: head, header, footer, analytics beacon
    NoteLayout.astro     # Minimal, inline-readable (Format = Note)
    PostLayout.astro     # Full layout: cover image, reading time, series nav, sources
  pages/
    index.astro          # Home: mixed feed (notes inline, posts as cards with cover image)
    bytes/[slug].astro   # Dispatches to NoteLayout or PostLayout by Format
    bytes/index.astro    # All bytes index
    tags/[tag].astro     # Tag pages with inline Note rendering
    series/[series].astro# Series pages with inline Note rendering
    sources/[id].astro   # Per-source pages
    search.astro         # Pagefind UI
  components/            # Shared Astro components
  styles/global.css      # Tailwind entry + global styles
```

## Reference

- Full spec: `learning-bytes-PRD.md`
- Initial project brief: `KICKOFF.md`
- Claude Code collaboration notes: `CLAUDE.md`
