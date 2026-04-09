/**
 * scripts/fetch-notion.ts — STEP 4 (image-free variant)
 *
 * Fetches every Published byte from the Notion Bytes database, caches all
 * Sources, resolves the Sources relation per byte, computes reading time
 * when missing, and writes typed markdown files for Astro's content
 * collection to consume.
 *
 * Deliberately NOT in this version (per owner decision — no images yet):
 *   - Cover image handling
 *   - 🚨 Inline image local-download (PRD §7)
 *
 * As a safety net, the script FAILS HARD if it ever encounters a Notion-hosted
 * image URL in the generated markdown — that would be the canary for "we
 * forgot to enable image localization before adding an image to a byte". The
 * moment that fails, re-enable the image pipeline before shipping.
 *
 * Run: `npm run fetch`
 */

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const BYTES_DB_ID = process.env.NOTION_BYTES_DB_ID;
const SOURCES_DB_ID = process.env.NOTION_SOURCES_DB_ID;

if (!NOTION_API_KEY || !BYTES_DB_ID || !SOURCES_DB_ID) {
  throw new Error(
    "Missing env vars. Need NOTION_API_KEY, NOTION_BYTES_DB_ID, NOTION_SOURCES_DB_ID in .env"
  );
}

const BYTES_OUT_DIR = "src/content/bytes";
const SOURCES_OUT_DIR = "src/content/sources";

const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ─── Types ─────────────────────────────────────────────────────────────────

type Source = {
  id: string;
  title: string;
  type:
    | "Article"
    | "Video"
    | "Book"
    | "Podcast"
    | "Course"
    | "Conversation"
    | "Other";
  url?: string;
  author?: string;
};

type Byte = {
  id: string;
  title: string;
  slug: string;
  format: "Note" | "Post";
  publishedDate: string;
  updatedDate?: string;
  excerpt: string;
  tags: string[];
  series?: string;
  seriesOrder?: number;
  sourceIds: string[];
  readingTime: number;
  body: string;
};

// ─── Notion property helpers ───────────────────────────────────────────────
//
// Property name strings here (`"Title"`, `"Slug"`, etc.) come from PRD §4 and
// have been validated against the live Bytes database for the fields exercised
// by the step 3 milestone byte. Adjust strings here if any column gets renamed.

const getTitle = (page: any, prop: string): string =>
  page.properties[prop]?.title?.[0]?.plain_text ?? "";

const getRichText = (page: any, prop: string): string =>
  page.properties[prop]?.rich_text?.map((t: any) => t.plain_text).join("") ?? "";

const getSelect = (page: any, prop: string): string | undefined =>
  page.properties[prop]?.select?.name;

const getMultiSelect = (page: any, prop: string): string[] =>
  page.properties[prop]?.multi_select?.map((s: any) => s.name) ?? [];

const getDate = (page: any, prop: string): string | undefined =>
  page.properties[prop]?.date?.start;

const getNumber = (page: any, prop: string): number | undefined =>
  page.properties[prop]?.number ?? undefined;

const getUrl = (page: any, prop: string): string | undefined =>
  page.properties[prop]?.url ?? undefined;

const getRelationIds = (page: any, prop: string): string[] =>
  page.properties[prop]?.relation?.map((r: any) => r.id) ?? [];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ─── Reading time ──────────────────────────────────────────────────────────

const computeReadingTime = (markdown: string): number => {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200)); // 200 wpm
};

// ─── Image-leak tripwire ───────────────────────────────────────────────────
//
// Until we wire up the image-localization pipeline (PRD §7), the only safe
// state is "no Notion-hosted image URLs in any generated markdown". If one
// appears, fail the build immediately so we never accidentally ship HTML
// pointing at a URL that's going to expire in an hour.

const NOTION_IMAGE_HOSTS = [
  "notion-static.com",
  "prod-files-secure",
  "amazonaws.com",
];

function assertNoNotionImages(slug: string, markdown: string): void {
  // Look at all markdown image refs of the form ![alt](url)
  const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(imageRegex)) {
    const url = match[1];
    if (NOTION_IMAGE_HOSTS.some((h) => url.includes(h))) {
      throw new Error(
        `Byte "${slug}" contains a Notion-hosted image URL:\n  ${url}\n` +
          "These URLs expire in ~1 hour and cannot be shipped. Re-enable the\n" +
          "image-localization pipeline (PRD §7) before continuing."
      );
    }
  }
}

// ─── Sources ───────────────────────────────────────────────────────────────

async function resolveDataSourceId(databaseId: string): Promise<string> {
  // Notion API note: as of @notionhq/client v3+, queries hit a "data source"
  // not a database directly. A normal Notion DB has one data source, so [0]
  // is safe. See the step-3 commit for the longer explanation.
  const dbInfo = (await notion.databases.retrieve({
    database_id: databaseId,
  })) as any;
  const dataSourceId: string | undefined = dbInfo.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error(
      `No data source found on database ${databaseId}. Confirm the integration` +
        " has access to it."
    );
  }
  return dataSourceId;
}

async function fetchSources(): Promise<Map<string, Source>> {
  console.log("→ Fetching Sources database…");
  const dataSourceId = await resolveDataSourceId(SOURCES_DB_ID!);

  const sources = new Map<string, Source>();
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      const source: Source = {
        id: page.id,
        title: getTitle(page, "Title"),
        type: (getSelect(page, "Type") as Source["type"]) ?? "Other",
        url: getUrl(page, "URL"),
        author: getRichText(page, "Author") || undefined,
      };
      sources.set(page.id, source);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  // Persist as JSON so the Astro `sources` data-collection can load them.
  await mkdir(SOURCES_OUT_DIR, { recursive: true });
  for (const source of sources.values()) {
    // Strip undefined keys so Astro's strict schema doesn't trip on `url: null`.
    const clean = Object.fromEntries(
      Object.entries(source).filter(([, v]) => v !== undefined)
    );
    await writeFile(
      join(SOURCES_OUT_DIR, `${source.id}.json`),
      JSON.stringify(clean, null, 2)
    );
  }

  console.log(`  ✓ ${sources.size} sources cached`);
  return sources;
}

// ─── Bytes ─────────────────────────────────────────────────────────────────

async function fetchBytes(sourcesMap: Map<string, Source>): Promise<Byte[]> {
  console.log("→ Fetching Published bytes…");
  const dataSourceId = await resolveDataSourceId(BYTES_DB_ID!);

  const bytes: Byte[] = [];
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: "Status",
        select: { equals: "Published" },
      },
      sorts: [{ property: "Published date", direction: "descending" }],
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      const title = getTitle(page, "Title");
      const slug = getRichText(page, "Slug") || slugify(title);
      if (!slug) {
        console.warn(`  ⚠️  Skipping byte without slug or title: ${page.id}`);
        continue;
      }

      const mdblocks = await n2m.pageToMarkdown(page.id);
      const body = (n2m.toMarkdownString(mdblocks).parent ?? "").trim();

      // PRD §7 tripwire — fail loud if any Notion image URL slipped through.
      assertNoNotionImages(slug, body);

      // Resolve Sources relation against the cache. Filter out any IDs the
      // cache doesn't have (e.g., a relation pointing at a deleted source).
      const sourceIds = getRelationIds(page, "Sources").filter((id) =>
        sourcesMap.has(id)
      );

      const publishedDate = getDate(page, "Published date");
      if (!publishedDate) {
        console.warn(`  ⚠️  Skipping "${title}" — missing Published date`);
        continue;
      }

      const byte: Byte = {
        id: page.id,
        title,
        slug,
        format: (getSelect(page, "Format") as "Note" | "Post") ?? "Note",
        publishedDate,
        updatedDate: getDate(page, "Updated date"),
        excerpt: getRichText(page, "Excerpt"),
        tags: getMultiSelect(page, "Tags"),
        series: getSelect(page, "Series"),
        seriesOrder: getNumber(page, "Series order"),
        sourceIds,
        readingTime:
          getNumber(page, "Reading time") ?? computeReadingTime(body),
        body,
      };

      bytes.push(byte);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  console.log(`  ✓ ${bytes.length} bytes fetched`);
  return bytes;
}

// ─── Write bytes ───────────────────────────────────────────────────────────

async function writeBytes(bytes: Byte[]): Promise<void> {
  await mkdir(BYTES_OUT_DIR, { recursive: true });

  for (const byte of bytes) {
    const frontmatter = Object.fromEntries(
      Object.entries({
        title: byte.title,
        slug: byte.slug,
        format: byte.format,
        publishedDate: byte.publishedDate,
        updatedDate: byte.updatedDate,
        excerpt: byte.excerpt,
        tags: byte.tags,
        series: byte.series,
        seriesOrder: byte.seriesOrder,
        sourceIds: byte.sourceIds,
        readingTime: byte.readingTime,
      }).filter(([, v]) => v !== undefined && v !== "")
    );

    const fileContent = matter.stringify(byte.body, frontmatter);
    await writeFile(join(BYTES_OUT_DIR, `${byte.slug}.md`), fileContent);
  }

  console.log(`  ✓ ${bytes.length} markdown files written to ${BYTES_OUT_DIR}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("📥 Notion → Astro content sync\n");

  // Wipe previous output so a stale file from a deleted/unpublished byte
  // can never linger across builds.
  for (const dir of [BYTES_OUT_DIR, SOURCES_OUT_DIR]) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }

  const sources = await fetchSources();
  const bytes = await fetchBytes(sources);
  await writeBytes(bytes);

  console.log("\n✅ Done.");
  console.log(
    "\nℹ️  Image localization is OFF (no images in any byte yet). The script\n" +
      "   will fail loudly the moment a Notion-hosted image URL appears in\n" +
      "   generated markdown — that's your signal to wire up PRD §7."
  );
}

main().catch((err) => {
  console.error("❌ Notion sync failed:", err.message ?? err);
  process.exit(1);
});
