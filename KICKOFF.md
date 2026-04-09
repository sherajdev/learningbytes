# Claude Code kickoff prompt — Learning Bytes

Copy-paste this as your first message to Claude Code in a fresh session inside the project directory.

---

I'm building **Learning Bytes**, a personal learning blog that pulls content from a Notion workspace and deploys to Cloudflare Pages on `learningbytes.sheraj.org`. The full spec is in `PRD.md` in this directory.

**Before you write any code, read `PRD.md` from top to bottom.** It has the tech stack, content model, build pipeline, and a build order I want you to follow exactly.

A few things to know upfront:

1. **The Notion databases are already built.** I have a `Bytes` database and a `Sources` database in Notion with the schemas described in §4 of the PRD. Don't try to create them — just consume them via the API.

2. **There is one critical bug to avoid.** Notion image URLs expire after about an hour. The fetch script must download every image to local disk at build time and rewrite the markdown to point at the local copies. This is called out in §7 of the PRD with a 🚨 — please respect it. If you skip this, the site will silently break in production.

3. **Follow the build order in §13 strictly.** Do not skip ahead to building pages. The first real milestone is step 3: prove the Notion connection works by fetching exactly one Published byte and writing it to disk as a markdown file. Stop after that step and show me the result. I want to verify the connection before you build anything else.

4. **I'm a vibe coder.** I know React and Next.js well but Astro is new to me. When you make non-obvious choices (especially around Astro content collections, islands, or build hooks), add a brief comment explaining what's happening so I can learn as we go.

5. **Don't install or commit secrets.** Use `.env.example` for the env var template; the real `.env` should be gitignored. I'll fill in the actual values myself.

**Your first actions:**

1. Read `PRD.md` end to end.
2. Read this file (`KICKOFF.md`) again so you have it loaded alongside the PRD.
3. Confirm back to me, in 3-5 bullet points, what you understand about (a) the tech stack, (b) the content model, (c) the image expiry issue, and (d) the milestone you're stopping at.
4. Then begin step 1 of §13: scaffold the Astro project with React, Tailwind, MDX, and Sitemap integrations. Run `npm run dev` to verify it works.
5. Continue through step 3 of §13. **Stop after step 3** — do not proceed to step 4 until I've reviewed the fetched byte and given you the green light.

When you stop at step 3, show me:
- The contents of the generated markdown file
- The exact command I should run to reproduce the fetch locally
- Any assumptions you made about Notion property names that I should verify against my actual database

Ready when you are.
