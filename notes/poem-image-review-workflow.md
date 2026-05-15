# Poem Image Review Workflow

Use the file-backed review server for image iteration work:

```sh
npm run poem-images:review
```

Open the URL it prints, usually:

```text
http://127.0.0.1:8766/notes/poem-image-prompt-review.html
```

When the page is served this way, every edit autosaves these local JSON files:

- `notes/poem-image-iteration-state.json` - raw UI state
- `notes/poem-image-iteration-handoff.json` - agent-ready feedback and candidate context
- `notes/poem-image-publish-plan.json` - finalized replacements ready to publish

These files are gitignored workflow state. Do not use Chrome LocalStorage or browser automation to extract feedback when the file-backed server is available.

## Future Agent Playbook

1. Start or reuse the review server with `npm run poem-images:review`.
2. Read `notes/poem-image-iteration-handoff.json`.
3. Generate only `handoff.iterating` entries where `feedback.trim()` is non-empty for `currentContender`.
4. Treat `candidateNotes` and `feedbackHistory` as history attached to specific images; do not overwrite or collapse feedback across candidates.
5. After generating a new pass, append candidates to `notes/poem-image-review-data.js`, update `preferredCandidateIds` for the regenerated slugs, and bump the review data cache query in `notes/poem-image-prompt-review.html`.
6. Verify the review page through the local server, then run `npm test`.

For publishing finalized replacements, read `notes/poem-image-publish-plan.json`, copy only the listed replacements into `poems/images/`, run visual checks and tests, then commit and push.
