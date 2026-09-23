# Website Audit: September 22, 2026

## Executive assessment

The site's strongest asset is the collection itself: poems, quotations, Dharma,
and saved reading make a much more personal destination than a conventional
portfolio. Its weakness is fragmentation. Each collection feels like a separate
application, and the homepage says less about Jeff's own work and perspective than
the depth of the archive suggests.

The urgent engineering findings were real: public mutation and paid-generation
endpoints, unbounded remote downloads, and deployment of internal project files.
This pass addresses those findings and several avoidable performance costs while
preserving the existing visual direction. A framework rewrite is not a prerequisite
for the next round; coherent navigation and a shared content model matter more.

## Scope and method

- Reviewed Pages Functions, shared content storage, Read Later extraction and
  Kindle generation, queue consumers, authentication, deployment configuration,
  public collection loaders, and the Sukha client transport.
- Browsed homepage, Poems, Quotes, Dharma, and Read Later; tested mobile and desktop
  layouts, searching, poem detail, back navigation, and theme persistence.
- Used source inspection, live read-only responses, local Pages execution, SQL
  tests, unit tests, simulator tests, and screenshots. No destructive production
  probing, load test, or third-party account penetration testing was performed.
- Local credential-signature patterns were scanned without printing values. The
  only match was a PEM-delimiter parser, not an embedded private key. This is not
  proof that every historical commit or external secret store is clean.
- An external Claude consultation was not run because the permission system did
  not authorize sending project context to that service.

## Security findings and fixes

### S1: Public write and paid-operation access (critical)

Previously, a caller could modify/delete saved items, register push devices, request
audio generation, and trigger repeated Kindle/cover work without owner authentication.

Implemented centralized authorization for mutations and expensive reads; verified
Cloudflare Access JWT signatures, issuer, audience, numeric expiry, activation time,
and the configured owner allowlist. The two former authentication implementations
now share one verifier. Cross-origin writes are rejected and actual request bodies
are limited to 256 KiB, including requests without Content-Length.

Public favorite lookups and public browsing remain available. Anonymous requests
cannot refresh article extraction or cause X video enrichment. Cached reader
content remains publicly readable; an uncached extraction requires a trusted client.

**Explicit convenience exception:** Jeff asked to keep saving without signing in.
`POST /api/read-later` therefore remains an add-only public intake. It accepts a URL
and bounded title, enforces 10 submissions per IP/hour and 30 total/day in atomic
database counters, and cannot change/unarchive/requeue an existing saved item.
Owner sessions and connected Sukha devices bypass these anonymous submission limits.
New public submissions still enter normal cover/Kindle processing. This bounds
abuse; it does not make a public intake abuse-proof. An attacker could consume the
daily quota or add unwanted items. Requiring a device-specific save credential is
the stronger alternative if that tradeoff becomes unacceptable.

### S2: Internal files in published deployments (high)

Confirmed that an internal push runbook was publicly served. The build now creates
an explicit public-assets-only `dist/`; notes, tools, tests, source functions,
dependencies, local files, and project configuration are excluded. Middleware also
rejects internal paths as defense in depth. The build has automated exclusion tests.

**Historical exposure remains pending approval:** immutable old Pages deployment
URLs still serve old code and assets. Protecting `*.jeffharr-is.pages.dev` with the
existing owner allowlist was blocked by auto-review and requires explicit approval.
The current custom-domain deployment alone cannot remove that historical exposure.
Do not roll back to a pre-audit build, since that would restore the vulnerabilities.

### S3: Unsafe/unbounded remote content retrieval (high)

Introduced one bounded outbound-fetch helper. It rejects credential-bearing URLs,
IP literals (including normalized/encoded alternatives), local/internal hostnames,
non-HTTP schemes, and unexpected ports. Every redirect is checked again, credentials
are removed on cross-origin redirects, and both streamed byte limits and full-body
timeouts are enforced. HTML, podcast feeds, source previews, EPUB images, and PDFs
use this boundary with appropriate size limits. Browser-rendering subrequests are
also filtered.

Limit: this is not a DNS-pinning proxy. DNS rebinding/network-level destination
restrictions still depend on Cloudflare's execution environment. Only trusted
clients or bounded public intake can initiate expensive extraction.

### S4: Browser security policies and unsafe links (medium)

Pages `_headers` do not cover function-generated responses. Middleware now supplies
security headers to dynamic responses too, preserving stricter endpoint policies.
Static and dynamic responses gain HSTS, anti-framing, nosniff, referrer, and
permissions policies. Read Later has a stricter script/content policy that does
not permit inline scripts. Shared metadata links reject executable URL schemes;
reader sanitization has active-content regression tests. OAuth callback responses
are non-cacheable, non-indexable, and do not send referrers.

Other legacy pages still have inline scripts and a baseline, not a strict
script-allowlist CSP. This is defense-in-depth work remaining for the shared-shell
rebuild, not a claim that all XSS classes are mathematically eliminated.

### S5: Vulnerable dependencies (high advisory severity)

Updated Readability to 0.6 and compatible dependency patches, including fflate.
The directly reachable Readability regular-expression denial-of-service advisory
is addressed. Root and Functions dependency declarations remain synchronized.

Three high-severity npm findings remain in the Cloudflare Puppeteer browser-download
dependency chain through `extract-zip`. The current compatible Cloudflare release
still pins that chain. Those Node downloader modules were absent from the compiled
Worker bundle; extraction uses the remote Browser Rendering binding instead. No
forced downgrade or unreviewed dependency substitution was applied. Recheck upstream
and keep package installation isolated from developer secrets. The dependency tree
is not being represented as vulnerability-free.

### S6: Native client compatibility

Sukha previously supplied no authentication. Its update adds a system web-auth
session, fixed callback destination, random state, S256 PKCE, and single-use
two-minute authorization codes. After explicit owner confirmation, a scoped
180-day credential is stored in the device-only Keychain; only its hash is stored
server-side. Revocation is performed on disconnect, and changing the owner
allowlist also invalidates credentials for removed owners. The credential cannot
authorize unrelated admin/favorites operations.

JSON requests and audio manifest/chunk requests use the same credential boundary.
Credentials are attached only to HTTPS API requests on `jeffharr.is`. Expired or
rejected connections show a reconnect state without discarding pending offline
changes. Read-only browsing continues when disconnected. Existing installed app
versions need the update and one initial connection before protected operations work.

## Performance improvements

| Area | Before | After |
| --- | --- | --- |
| Dharma teacher counts | 3 full indexes, 6,590,694 bytes | 1 count file, 43 bytes |
| Poems collection startup | Manifest plus 55 individual Markdown requests | One 70,714-byte collection index |
| Homepage portrait | About 165 KB | 12.6 KB WebP |
| Four collection images | About 1.85 MB of original JPEGs | About 102 KB at the smaller responsive size; larger variants available |
| Lately data loading | Wait for the slowest source | Progressive rendering with a 12-second client timeout |
| Public social integrations | Upstream work on uncached invocations | Edge-cache reuse for successful public feed responses |
| External downloads | Header-only timeout/unbounded reads | Time and byte bounds through body completion |

These are asset/request measurements, not invented Lighthouse scores or field
Core Web Vitals. Individual Dharma corpus views still load their full indexes;
incremental search/index loading is a further opportunity. Reader word counts now
count words instead of using Readability's character count for newly extracted items.

## Journey audit

1. **Homepage: good identity, weak orientation.** The portrait and personal
   introduction establish a clear person. On mobile, large atmospheric collection
   tiles require considerable scrolling before the full set and current activity
   are discoverable. The page would benefit from concise, immediately accessible
   collection navigation and a visible statement of current projects.
2. **Poems search: useful and now much quicker to populate.** Title, author, and text
   search work; 55 poems are available. The image-led collection has personality,
   but labels and action contrast should be evaluated with actual contrast tooling.
3. **Poem detail: attractive reading surface, incomplete accessibility semantics.**
   Text and artwork render cleanly; back navigation closes the reader. The observed
   detail overlay has no dialog semantics and leaves focus on the underlying opener.
   A proper dialog/focus-return/inert-background treatment is a high-priority next
   improvement, with keyboard and screen-reader tests.
4. **Quotes: quick discovery, curation quality needs attention.** Searching
   "attention" revealed a duplicate Susan Piver quotation. Search should be paired
   with normalization, duplicate detection, consistent attribution, and source links.
5. **Dharma: unusually valuable content, mobile hierarchy can improve.** Teacher
   selection is clear, but large artwork and subscription controls push useful
   results down. Querying compassion returned 105 talks. Put search, duration, and
   relevant results first; make subscription a secondary action after discovery.
6. **Read Later: capable but too operational.** The former public view exposed
   archive/delete/Kindle controls to anonymous visitors. Those owner controls are now
   hidden and server-protected. Reading/Watch/Archive are useful modes, but a
   resume-first presentation and consistent queue actions would make this a daily
   destination instead of a maintenance list.

Accepted screenshots, captured during this audit, are saved locally under
`tmp/site-audit/`: `08-home-mobile-after.png`, `09-home-desktop-after.png`,
`10-poem-reader-after.png`, `04-quotes-mobile.png`, `05-dharma-mobile.png`,
`06-dharma-search-mobile.png`, and `07-read-later-mobile-before.png`.
The initial full-page homepage capture and loading-state poem screenshot were
rejected and are not evidence. Screenshots alone do not establish WCAG compliance.

## Ranked investments for round two

1. **One coherent personal library and public front door.** Shared navigation,
   predictable back behavior, consistent collection actions, clear public versus
   owner state, and a common content vocabulary. Keep the site's personal atmosphere
   while eliminating the feeling of several unrelated apps. Highest leverage;
   medium-to-large investment. Include the dialog/focus accessibility fixes here.
2. **A resume-first private home.** Continue the article, talk, or video you left;
   synchronize progress between browser, Sukha, and listening surfaces; show the
   next small set of intentional choices. This most directly makes the site a
   destination for Jeff. Depends on the authentication foundation; medium-to-large.
3. **Jeff's own voice: Now, projects, and annotations.** A small, maintained account
   of what you are building/thinking about, with "why this matters to me" notes on
   selected collection entries. This would improve representation more than a
   more elaborate activity feed. Small-to-medium technical effort, ongoing editorial
   commitment.
4. **One search across the whole library.** Search articles, poems, quotes, and
   talks together; filter by format, time available, author/teacher, and topic.
   Source-backed excerpts and useful cross-links, not a chat box pasted on top.
   Private transcripts must remain private unless explicitly approved for publication.
   Large investment with strong repeat-use value.
5. **An exceptional common reading/listening experience.** Stable typography,
   keyboard and screen-reader navigation, sensible focus mode, reliable resumption,
   and consistent source/share/bookmark behavior across formats. Medium-to-large.
6. **Curated trails through ideas.** Short, shareable sequences mixing poems,
   talks, quotations, and essays, with your connective notes. This turns a repository
   of material into a representation of your perspective. Medium investment once
   content relationships and navigation are shared.
7. **A quieter, more deliberate visual system.** Tighten contrast, spacing,
   typography, mobile result density, image treatment, and motion. Retain what feels
   personal; do not replace it with a generic SaaS dashboard. Medium investment,
   best done in service of the flows above rather than as an isolated reskin.

## Verification and operational limits

- Website JavaScript tests, Dharma-feed tests, and transcript tests pass; new cases
  cover signature failures, CSRF, private URLs/redirects, body limits/timeouts,
  deployment exclusions, public-save limits, duplicate preservation, credential
  scope, PKCE, expiry, and code replay.
- Local Pages responses verified public routes, public favorite lookup, private-path
  rejection, protected paid generation, and dynamic security headers.
- Sukha: 23 unit tests (29 parameterized executions) and three targeted fixture UI
  tests passed on iPhone 17 Pro / iOS 26.3.1. The connection-sheet screenshot was
  inspected. An existing linker flag was corrected for this machine's Xcode.
- The real owner sign-in, physical-device APNs, Kindle delivery, and provider billing
  are not proven by unit tests. Do not label those as end-to-end verified without
  performing the corresponding production checks.
- Pages and the Read Later queue Worker are separate deployments. The shared fetch
  changes require updating the queue Worker too. Push Worker behavior did not change.
- Preserve D1/R2 data; the new database migrations add only client-credential and
  anonymous-submission-limit tables. No existing content migration is required.
- This is a thorough application pass, not a guarantee of perfect security. No
  disaster-recovery drill, full historical secret audit, sustained abuse test, or
  full assistive-technology conformance audit was performed.

## References

- [Cloudflare Pages header behavior](https://developers.cloudflare.com/pages/configuration/headers/)
- [Validating Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Protecting preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Apple system web authentication](https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service)
- [Device-only background-accessible Keychain items](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)
