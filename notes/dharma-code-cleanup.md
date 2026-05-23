# Dharma Code Cleanup Notes

Created during a holistic cleanup pass after adding multi-corpus archive search,
favorites, and arbitrary feed generation.

## Current Shape

- Public static Dharma archive/feed generation lives in `tools/dharma-feed/`.
- Local transcript, metadata, artwork, markdown, and QMD orchestration lives in
  `tools/brensilver-transcripts/`. The package name is historical; configs make
  the pipeline corpus-aware.
- Public archive pages and canonical corpus feeds are generated static files
  under `dharma/{corpus}/`.
- Arbitrary user-facing podcast feeds are served dynamically by
  `functions/api/feeds/dharma.xml.js`.
- Favorites are stored generically in D1 as `items` plus `list_entries` in the
  `starred` list. Public read state and admin-only writes are intentionally
  separate.

## Changes Made In This Pass

- Renamed the generic public feed tool from `tools/brensilver-feed/` to
  `tools/dharma-feed/`.
- Renamed its Python package from `brensilver` to `dharma_feed`.
- Kept existing wrapper script names such as `scripts/build-brensilver-feed.py`
  because the transcript pipeline configs call them directly.
- Consolidated duplicated build-wrapper logic into
  `scripts/lib/dharma_feed_runner.py`.
- Moved the shared starred-feed title prefix into
  `functions/api/dharma/feed-constants.js`.
- Updated feed-tool and repo-agent documentation to use corpus-generic language.

## Useful Invariants

- Public URLs stay under `/dharma/{corpus}/`.
- Existing wrapper scripts stay stable unless all transcript configs are updated
  in the same change.
- Static corpus feeds are build artifacts; do not hand-edit generated files in
  `dharma/{corpus}/`.
- Dynamic feeds should continue to accept `corpus`, `scope`, `q`, `starred`, and
  `limit` query params.
- Favorite state is public to read for rendered content, but saving or removing
  favorites remains admin-only.

## Deferred Cleanup Opportunities

1. Split `tools/dharma-feed/src/dharma_feed/build.py`.

   This file owns CLI orchestration, feed classification, static HTML, archive
   CSS, archive JavaScript, talk-page rendering, and metadata wiring. A cleaner
   shape would be:

   - `cli.py` for argument parsing and top-level orchestration.
   - `archive.py` for index/talk page rendering.
   - `classification.py` for guided-vs-talk split rules.
   - `assets.py` for artwork/chapter/media manifest wiring.

   Do this only with generated-artifact regression checks, because small HTML or
   JavaScript changes can affect all corpus pages.

2. Add browser-level tests before splitting `js/favorites.js`.

   The current file handles admin write controls, public read indicators,
   Dharma detail buttons, Dharma archive/list indicators, poem favorites, share
   page favorites, and mutation observation. That is a lot for one file, but it
   also encodes subtle visibility rules: non-admin users see starred state, do
   not see empty stars on unstarred items, and cannot mutate favorites.

   A safer sequence is:

   - Add focused DOM tests or Playwright checks for Dharma detail pages, Dharma
     archive rows, poem pages, and non-admin/admin states.
   - Extract pure helpers for favorite refs and visibility decisions.
   - Split surface-specific DOM injection after tests exist.

3. Keep dynamic arbitrary feeds as one route for now.

   `functions/api/feeds/dharma.xml.js` is compact enough to remain a single
   route, and it already centralizes the arbitrary feed query model. Extract
   shared modules only when another route needs the same parsing or rendering.

4. Consider a generic transcript package rename later.

   Renaming `tools/brensilver-transcripts/` and the `brensilver_transcripts`
   module would make the system more semantically consistent, but it touches
   many runbooks, launchd files, scripts, and operator muscle memory. The public
   feed-tool rename was lower-risk and handles the most visible mismatch first.

5. Add generated artifact smoke tests.

   A small test that builds from committed `talks.json` fixtures and checks for
   expected feed links, archive filter controls, favorite data attributes, and
   canonical talk pages would make future refactors much safer.
