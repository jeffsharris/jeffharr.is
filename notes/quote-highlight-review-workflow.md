# Quote Highlight Review Workflow

Use the local review server for Kindle highlight selection:

```sh
npm run quotes:review
```

Open the URL it prints, usually:

```text
http://127.0.0.1:8767/notes/quote-highlight-review.html
```

Paste the contents of a Kindle `My Clippings.txt` export into the import box.
The tool imports highlights only; Kindle notes and bookmarks are ignored.

Review state is saved to:

- `notes/kindle-highlights-state.json`

That file is gitignored because Kindle highlights can contain private reading
history and notes. Re-importing the same clipping export merges by stable
highlight identity and preserves include/skip/edit decisions.

When ready, use **Export selected** in the UI. It writes generated Kindle
highlight sections to `notes/quotes-collection.md`:

- confirmed selections go under `Kindle Highlight Selections`
- selected items without confirmed attribution go under
  `Kindle Highlights Needing Attribution Review`

The hand-maintained quotes and the existing `Needs Attribution Review` list are
left intact.
