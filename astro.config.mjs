// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Astro 6 + Tailwind v4 note (since you're new to Astro):
// Tailwind is now wired in via Vite's plugin pipeline (`@tailwindcss/vite`)
// rather than the old `@astrojs/tailwind` integration. The Vite plugin scans
// your CSS for `@import "tailwindcss";` and generates utilities on demand.
// See `src/styles/global.css`.
//
// React is added as an Astro "integration" so we can drop React components
// into pages as islands (with a `client:*` directive to hydrate them).
export default defineConfig({
  site: "https://learningbytes.sheraj.org",
  integrations: [react(), mdx(), sitemap()],
  vite: {
    // The Tailwind v4 vite plugin's typed return is `Plugin[]` whereas Vite's
    // PluginOption slot wants a single PluginOption — runtime is fine, this
    // cast just satisfies the strict types.
    plugins: [/** @type {any} */ (tailwindcss())],
    build: {
      rollupOptions: {
        // Pagefind writes its runtime into `dist/pagefind/` AFTER astro build,
        // so the dynamic `import("/pagefind/pagefind.js")` in src/pages/search.astro
        // must be treated as an external — Rollup shouldn't try to resolve or
        // bundle it at build time. The browser loads it at runtime.
        external: ["/pagefind/pagefind.js"],
      },
    },
  },
});
