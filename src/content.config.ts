/*
 * Astro 6 Content Layer API (since this is new to you):
 *
 * In older Astro the convention was `src/content/<name>/` folders that Astro
 * auto-discovered. Astro 5 introduced — and Astro 6 standardizes — the
 * "Content Layer" where you explicitly declare a `loader` per collection.
 * Loaders are pluggable: there are built-in `glob()` and `file()` loaders for
 * filesystem content, and third parties can ship loaders that pull from APIs
 * directly. We use filesystem loaders here because the fetch script writes
 * Notion content to disk first (PRD §7).
 *
 * IMPORTANT: this file MUST live at `src/content.config.ts` (not inside
 * `src/content/`) for Astro to pick it up.
 *
 * The contract with `scripts/fetch-notion.ts`:
 *   - bytes:   one .md per byte under src/content/bytes/<slug>.md
 *   - sources: one .json per source under src/content/sources/<id>.json
 */

import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const bytes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/bytes" }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    format: z.enum(["Note", "Post"]),
    publishedDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    excerpt: z.string(),
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),
    seriesOrder: z.number().optional(),
    coverImage: z.string().optional(),
    sourceIds: z.array(z.string()).default([]),
    readingTime: z.number().optional(),
  }),
});

const sources = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/sources" }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    type: z.enum([
      "Article",
      "Video",
      "Book",
      "Podcast",
      "Course",
      "Conversation",
      "Other",
    ]),
    url: z.string().url().optional(),
    author: z.string().optional(),
  }),
});

export const collections = { bytes, sources };
