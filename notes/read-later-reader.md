# Read Later Reader: Findings + Next Ideas

## What happened
- Some sites (ex: LessWrong) deliver minimal HTML with most content embedded in client-side data blobs.
- `@mozilla/readability` on the raw HTML can return `null` or extremely low word counts because the readable DOM is not present server-side.
- The reader endpoint currently tries Readability first, then falls back to Cloudflare Browser Rendering (Puppeteer) if the word count is too low.
- Even with Browser Rendering, some pages can still fail if content loads late, uses shadow DOM, or requires explicit user interaction to render the article body.

## Generic strategies to improve extraction (not site-specific)
- Use Browser Rendering as the primary fetch for known client-rendered pages, or when a HEAD/GET indicates a JS app (Next/React/Vite).
- Increase render waits based on heuristics:
  - Wait for a stable `document.body.innerText.length` or a min word count rather than only `networkidle2`.
  - Add a short loop: sample `document.body.innerText.length` every 500ms and proceed once it stabilizes for ~1-2s.
- Implement a "first meaningful content" selector search:
  - Look for common content containers (`article`, `[role="main"]`, `main`, `[itemprop="articleBody"]`).
  - If found, pass only that subtree to Readability to avoid navigation/sidebar noise.
- Evaluate post-render Readability thresholds:
  - If Readability returns very low word counts but a container exists, try a fallback that extracts and sanitizes the container HTML directly.
- Normalize reader output:
  - Convert relative URLs and `srcset` values.
  - Strip scripts/forms/iframes and inline handlers.
  - Promote lazy image attributes (`data-src`, `data-original`) into `src`.

## Practical Browser Rendering notes
- Use the Cloudflare Browser Rendering binding (`[browser] binding = "BROWSER"`).
- Keep `nodejs_compat` enabled in `wrangler.toml` when using Puppeteer.
- Ensure `pages_build_output_dir = "."` so Pages reads `wrangler.toml`.
- Use a realistic User-Agent and a viewport big enough to avoid mobile-only layouts.
- Consider a two-pass render:
  1) `page.goto(url, { waitUntil: "networkidle2" })`
  2) `page.waitForTimeout(1000)` plus content-length stabilization

## Current implementation (2025-02)
- Detect likely client-rendered HTML by looking for common hydration markers (ex: Next/React/Nuxt bundles).
- If client-rendered, prefer Browser Rendering first; otherwise try Readability on the raw HTML.
- During Browser Rendering, wait for common content selectors and for `document.body.innerText.length` to stabilize before capturing HTML.
- Extraction flow: Readability on full document -> Readability on best content container -> sanitized container fallback.
- This pipeline successfully extracts long-form LessWrong posts that previously returned near-empty content.

## Kindle delivery (Resend)
- On save, the backend extracts reader content synchronously and emails a Kindle-friendly attachment via Resend.
- EPUB is attempted first (with embedded images when under the 50 MB email limit); if the EPUB build fails or exceeds the size cap, it falls back to the HTML attachment.
- When over the size cap, inline images are replaced with placeholder text and only the cover image is retained (if possible).
- Cover pages include the article title text above the first image to keep Kindle cover thumbnails on raster images.
- If reader extraction fails, the item is saved but no email is sent (status becomes `needs-content`).
- Failed sends are stored on the item and can be retried via the read-later UI.
- Required environment variables (Cloudflare): `RESEND_API_KEY` (secret), `KINDLE_TO_EMAIL`, `KINDLE_FROM_EMAIL`.
- The `KINDLE_FROM_EMAIL` must be a verified Resend sender and approved in Amazon's "Personal Document Settings".

## Save URLs (current flow)
- The canonical save entry point is the Read Later list page with query params:
  - `https://jeffharr.is/read-later/?url=<ENCODED_URL>&title=<ENCODED_TITLE>`
- Bookmarklet (single-line, JavaScript URL):
  - `javascript:(()=>{const u=encodeURIComponent(location.href);const t=encodeURIComponent(document.title||'');location.href=\`https://jeffharr.is/read-later/?url=${u}&title=${t}\`;})();`

## Debug ideas for next session
- Capture and store a compact debug record per failed extraction:
  - `status`, `readabilityWordCount`, `renderedWordCount`, `renderedHtmlLength`
  - Helps identify if the issue is "no content rendered" vs "rendered but Readability missed".
- Add an internal-only query param (ex: `?debug=1`) to return these fields for inspection.
