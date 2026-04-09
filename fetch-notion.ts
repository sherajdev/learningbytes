/**
 * scripts/fetch-notion.ts
 *
 * Fetches Bytes and Sources from Notion, downloads images locally,
 * and writes typed markdown files for Astro's content collection to consume.
 *
 * Run: tsx scripts/fetch-notion.ts
 * Wired into: `npm run build` (runs before `astro build`)
 *
 * ⚠️ CRITICAL: Notion image URLs expire after ~1 hour. This script downloads
 * every image referenced by a byte (cover + inline body images) to local disk
 * and rewrites the markdown so production HTML never points at expiring URLs.
 *
 * NOTE: This is a SKETCH / reference implementation. Claude Code should adapt
 * it to match the actual Notion property names in the live databases. Property
 * names below are based on PRD §4 — verify against the real databases before
 * trusting them.
 */

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";

// ─── Config ────────────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const BYTES_DB_ID = process.env.NOTION_BYTES_DB_ID;
const SOURCES_DB_ID = process.env.NOTION_SOURCES_DB_ID;

if (!NOTION_API_KEY || !BYTES_DB_ID || !SOURCES_DB_ID) {
  throw new Error(
    "Missing env vars. Need NOTION_API_KEY, NOTION_BYTES_DB_ID, NOTION_SOURCES_DB_ID"
  );
}

const BYTES_OUT_DIR = "src/content/bytes";
const SOURCES_OUT_DIR = "src/content/sources";
const IMAGES_OUT_DIR = "src/assets/notion";

const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ─── Types ─────────────────────────────────────────────────────────────────

type Source = {
  id: string;
  title: string;
  type: string;
  url?: string;
  author?: string;
};

type Byte = {
  id: string;
  title: string;
  slug: string;
  status: string;
  format: "Note" | "Post";
  publishedDate: string;
  updatedDate?: string;
  excerpt: string;
  tags: string[];
  series?: string;
  seriesOrder?: number;
  coverImage?: string; // local path after download
  sourceIds: string[]; // resolved against the sources cache
  readingTime?: number;
  body: string; // markdown
};

// ─── Notion property helpers ───────────────────────────────────────────────
// These pluck values out of Notion's verbose property objects. Adjust the
// property NAMES (the strings) if your Notion databases use different labels.

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

const getCoverUrl = (page: any): string | undefined => {
  const cover = page.properties["Cover image"]?.files?.[0];
  if (!cover) return undefined;
  return cover.type === "external" ? cover.external.url : cover.file?.url;
};

// ─── Image download (the critical bit) ─────────────────────────────────────

/**
 * Downloads an image to src/assets/notion/[slug]/[hash].[ext] and returns
 * the local path that markdown should reference.
 *
 * Hashing the URL means we get content-addressable filenames and can
 * detect duplicates across builds without extra bookkeeping.
 */
async function downloadImage(url: string, slug: string): Promise<string> {
  const dir = join(IMAGES_OUT_DIR, slug);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  // Strip Notion's signed-URL query string before hashing so we get a
  // stable filename across builds (the signature changes every fetch).
  const cleanUrl = url.split("?")[0];
  const hash = createHash("md5").update(cleanUrl).digest("hex").slice(0, 12);
  const ext = extname(new URL(cleanUrl).pathname) || ".png";
  const filename = `${hash}${ext}`;
  const localPath = join(dir, filename);

  if (!existsSync(localPath)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buf);
  }

  // Return path relative to the project root for use in markdown.
  // Astro's content collection will resolve this when bundling.
  return `/${localPath}`;
}

/**
 * Walks markdown body for image references and replaces remote Notion URLs
 * with local paths. Notion-hosted images contain `secure.notion-static.com`
 * or `prod-files-secure.s3` in the host.
 */
async function localizeImagesInMarkdown(
  markdown: string,
  slug: string
): Promise<string> {
  const imageRegex = /!\[(.*?)\]\((https?:\/\/[^)]+)\)/g;
  const matches = [...markdown.matchAll(imageRegex)];

  let result = markdown;
  for (const match of matches) {
    const [full, alt, url] = match;
    const isNotionHosted =
      url.includes("notion-static.com") ||
      url.includes("prod-files-secure") ||
      url.includes("amazonaws.com");

    if (isNotionHosted) {
      const localPath = await downloadImage(url, slug);
      result = result.replace(full, `![${alt}](${localPath})`);
    }
  }
  return result;
}

// ─── Reading time ──────────────────────────────────────────────────────────

const computeReadingTime = (markdown: string): number => {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)); // 200 wpm
};

// ─── Sources fetch ─────────────────────────────────────────────────────────

async function fetchSources(): Promise<Map<string, Source>> {
  console.log("→ Fetching sources from Notion…");
  const sources = new Map<string, Source>();

  let cursor: string | undefined;
  do {
    const response = await notion.databases.query({
      database_id: SOURCES_DB_ID!,
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      const source: Source = {
        id: page.id,
        title: getTitle(page, "Title"),
        type: getSelect(page, "Type") ?? "Other",
        url: getUrl(page, "URL"),
        author: getRichText(page, "Author") || undefined,
      };
      sources.set(page.id, source);
    }

    cursor = response.has_more ? (response.next_cursor as string) : undefined;
  } while (cursor);

  // Persist sources as JSON so the Astro content collection can load them.
  if (!existsSync(SOURCES_OUT_DIR)) {
    await mkdir(SOURCES_OUT_DIR, { recursive: true });
  }
  for (const source of sources.values()) {
    await writeFile(
      join(SOURCES_OUT_DIR, `${source.id}.json`),
      JSON.stringify(source, null, 2)
    );
  }

  console.log(`  ✓ ${sources.size} sources cached`);
  return sources;
}

// ─── Bytes fetch ───────────────────────────────────────────────────────────

async function fetchBytes(sourcesMap: Map<string, Source>): Promise<Byte[]> {
  console.log("→ Fetching published bytes from Notion…");
  const bytes: Byte[] = [];

  let cursor: string | undefined;
  do {
    const response = await notion.databases.query({
      database_id: BYTES_DB_ID!,
      filter: {
        property: "Status",
        select: { equals: "Published" },
      },
      sorts: [{ property: "Published date", direction: "descending" }],
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      const slug = getRichText(page, "Slug");
      if (!slug) {
        console.warn(`  ⚠️  Skipping byte without slug: ${page.id}`);
        continue;
      }

      // Fetch and convert the page body
      const mdblocks = await n2m.pageToMarkdown(page.id);
      const rawMarkdown = n2m.toMarkdownString(mdblocks).parent;

      // Localize all inline images (the critical bit)
      const localizedMarkdown = await localizeImagesInMarkdown(rawMarkdown, slug);

      // Localize the cover image if present
      let coverImage: string | undefined;
      const coverUrl = getCoverUrl(page);
      if (coverUrl) {
        coverImage = await downloadImage(coverUrl, slug);
      }

      const sourceIds = getRelationIds(page, "Sources").filter((id) =>
        sourcesMap.has(id)
      );

      const byte: Byte = {
        id: page.id,
        title: getTitle(page, "Title"),
        slug,
        status: getSelect(page, "Status")!,
        format: (getSelect(page, "Format") as "Note" | "Post") ?? "Note",
        publishedDate: getDate(page, "Published date")!,
        updatedDate: getDate(page, "Updated date"),
        excerpt: getRichText(page, "Excerpt"),
        tags: getMultiSelect(page, "Tags"),
        series: getSelect(page, "Series"),
        seriesOrder: getNumber(page, "Series order"),
        coverImage,
        sourceIds,
        readingTime:
          getNumber(page, "Reading time") ?? computeReadingTime(localizedMarkdown),
        body: localizedMarkdown,
      };

      bytes.push(byte);
    }

    cursor = response.has_more ? (response.next_cursor as string) : undefined;
  } while (cursor);

  console.log(`  ✓ ${bytes.length} bytes fetched`);
  return bytes;
}

// ─── Write bytes as markdown files ─────────────────────────────────────────

async function writeBytes(bytes: Byte[]): Promise<void> {
  if (!existsSync(BYTES_OUT_DIR)) {
    await mkdir(BYTES_OUT_DIR, { recursive: true });
  }

  for (const byte of bytes) {
    const frontmatter = {
      title: byte.title,
      slug: byte.slug,
      format: byte.format,
      publishedDate: byte.publishedDate,
      updatedDate: byte.updatedDate,
      excerpt: byte.excerpt,
      tags: byte.tags,
      series: byte.series,
      seriesOrder: byte.seriesOrder,
      coverImage: byte.coverImage,
      sourceIds: byte.sourceIds,
      readingTime: byte.readingTime,
    };

    // Strip undefined keys so the YAML stays clean
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined)
    );

    const fileContent = matter.stringify(byte.body, cleanFrontmatter);
    await writeFile(join(BYTES_OUT_DIR, `${byte.slug}.md`), fileContent);
  }

  console.log(`  ✓ ${bytes.length} markdown files written to ${BYTES_OUT_DIR}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("📥 Notion → Astro content sync\n");

  // Clean previous output to avoid stale files from deleted/unpublished bytes
  for (const dir of [BYTES_OUT_DIR, SOURCES_OUT_DIR]) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }

  const sources = await fetchSources();
  const bytes = await fetchBytes(sources);
  await writeBytes(bytes);

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Notion sync failed:", err);
  process.exit(1);
});
