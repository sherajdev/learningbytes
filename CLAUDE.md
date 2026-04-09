# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo is **pre-scaffold**. Only the spec and a reference script exist:

- `learning-bytes-PRD.md` — the authoritative spec. Read it end to end before writing code.
- `KICKOFF.md` — initial instructions from the owner, including a strict stop-point at build-order step 3.
- `fetch-notion.ts` — a **sketch / reference implementation** of `scripts/fetch-notion.ts`, not yet wired into a project. Adapt it; don't assume the Notion property names match the live databases.

The Astro project itself (package.json, astro.config.mjs, src/, etc.) has not been created yet. Build it following PRD §13 build order.

## What this project is

**Learning Bytes** is a static personal blog for `learningbytes.sheraj.org`. Notion is the sole source of truth — two pre-built Notion databases (**Bytes** and **Sources**) are pulled at build time, converted to markdown, and rendered by Astro, then deployed to Cloudflare Pages.

Stack: Astro + React islands (`@astrojs/react`) + Tailwind + MDX + Pagefind (search) + Cloudflare Web Analytics + Cloudflare Pages hosting. Notion SDK: `@notionhq/client` + `notion-to-md`.

## Critical architectural constraints

These are the things that will silently break the site if ignored:

1. **Notion image URLs expire (~1 hour).** The fetch script MUST download every referenced image (cover + inline body images) to `src/assets/notion/[slug]/` and rewrite markdown to point at local paths. Never leave `notion-static.com` / `prod-files-secure` / `amazonaws.com` URLs in generated markdown. See PRD §7 and the `downloadImage` / `localizeImagesInMarkdown` helpers in `fetch-notion.ts`.

2. **Two layouts, one route.** `/bytes/[slug]` dispatches to `NoteLayout` (minimal, inline-readable) or `PostLayout` (full, cover image, reading time, series nav, sources section) based on the `Format` property (`Note` | `Post`). This duality shows up in feeds too — notes render inline with full content; posts render as preview cards.

3. **Generated content is gitignored.** `src/content/bytes/`, `src/content/sources/`, and `src/assets/notion/` are fresh output of every build. The content collection schema in `src/content/config.ts` is the typed contract between the fetch script and Astro.

4. **Sources are fetched first.** The Sources DB is queried and cached to `src/content/sources/[id].json` before Bytes, so the Bytes fetch can resolve `Sources` relation IDs against the cache. A source only appears on the public site if at least one Published byte references it.

5. **Build pipeline order:** `fetch-notion.ts` → `astro build` → `pagefind` (indexes `dist/`). `npm run build` must chain all three.

## Build order (from PRD §13) — do not skip ahead

The owner explicitly wants step 3 treated as a hard milestone:

1. Scaffold Astro (React, Tailwind, MDX, Sitemap).
2. Content collection schemas in `src/content/config.ts` strictly typed to PRD §4.
3. **🚨 STOP HERE on a fresh build.** Prove the Notion connection: fetch exactly one Published byte and write one `.md` file. Show the owner the result and the reproduction command before continuing.
4. Extend fetch: all Published bytes, resolve Sources relations, compute reading time, download all images.
5. BaseLayout, NoteLayout, PostLayout (render one sample byte in each).
6. Home (mixed feed).
7. `/bytes/[slug]` dispatching by Format.
8. `/bytes` index, tags, series, sources pages.
9. Pagefind as post-build step.
10. Cloudflare Web Analytics snippet.
11. Cloudflare Pages deployment + custom domain.
12. `README.md` with Notion integration setup instructions.

## Environment variables

Required (put in `.env`, template in `.env.example`, `.env` gitignored):

- `NOTION_API_KEY` — Notion integration token
- `NOTION_BYTES_DB_ID` — Bytes database ID
- `NOTION_SOURCES_DB_ID` — Sources database ID

Do not install or commit secrets — the owner fills in real values.

## Commands (once scaffolded)

- `npm run dev` — Astro dev server
- `npm run build` — runs `fetch-notion.ts`, then `astro build`, then `pagefind`
- `tsx scripts/fetch-notion.ts` — run the Notion sync standalone (useful for debugging the pipeline in isolation)

Cloudflare Pages build command: `npm run build`. Output directory: `dist`.

## Notion property name caveat

`fetch-notion.ts` uses property name strings (`"Title"`, `"Slug"`, `"Status"`, `"Format"`, `"Published date"`, `"Updated date"`, `"Excerpt"`, `"Tags"`, `"Series"`, `"Series order"`, `"Cover image"`, `"Sources"`, `"Reading time"`) that come from PRD §4. If the live Notion databases use different labels, adjust the strings in the helper calls, not the schema — the PRD schema is authoritative but property labels may drift.

## Owner context and collaboration style

- Owner is comfortable with React/Next.js but **Astro is new to them**. When making non-obvious Astro choices (content collections, islands hydration directives, build hooks, image pipeline), leave a brief inline comment explaining what's happening.
- Owner self-describes as a "vibe coder" — lean toward clarity and explanation at decision points over cleverness.
- Always stop at the PRD §13 milestones and show concrete output (generated file contents, exact reproduction command, any assumptions made about Notion schema) before proceeding.
