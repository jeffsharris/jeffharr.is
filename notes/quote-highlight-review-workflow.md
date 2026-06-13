# Quote Review Workflow

Use the local quote manager for collection triage and source imports:

```sh
npm run quotes:review
```

Open the URL it prints, usually:

```text
http://127.0.0.1:8767/notes/quote-highlight-review.html
```

## Categories

- `Inbox`: uncategorized quotes from import sources.
- `Needs refinement`: quotes Jeff wants to keep, but which need attribution,
  source cleanup, or wording review.
- `Accepted`: quotes ready to appear in the curated collection.
- `Rejected`: quotes intentionally excluded, kept locally for undo/recovery.

On first load, the local state is seeded from `notes/quotes-collection.md`:
the current `Quotes` section becomes `Accepted`, and the review section becomes
`Needs refinement`.

The working database is saved to:

- `notes/quote-review-state.json`

That file is gitignored because imported quote candidates can contain private
reading history. The tracked export remains:

- `notes/quotes-collection.md`

Use **Export collection** in the UI to rewrite the tracked collection from the
local state. Only `Accepted` and `Needs refinement` quotes are exported.

Use the publish command to generate the public quotes page and JSON from the
local state:

```sh
npm run quotes:publish
```

The public page uses `Accepted` quotes only. The command normalizes display
punctuation and capitalization in the generated artifacts without changing the
gitignored review state.

## Kindle Importer Scope

The review UI supports pasted Kindle `My Clippings.txt` content.

- Imports Kindle highlights only.
- Ignores Kindle notes and bookmarks.
- De-duplicates by book title, author, location/page, and highlight text.
- Preserves previous category decisions and edits when the same clipping file is
  imported again.
- Adds new highlights to `Inbox`.
- The `Keep` action moves an Inbox highlight to `Needs refinement`; it does not
  mark the quote as accepted.

Kindle Notebook web exports captured from the signed-in Notebook page can be
merged with:

```sh
npm run quotes:import-kindle-notebook -- /private/tmp/kindle-notebook-export.json
```

Notebook imports preserve attached Kindle notes in the local review state and
also default new highlights to `Inbox`.

Future importers should write candidate items into the same local state shape
and default new candidates to `Inbox`.
