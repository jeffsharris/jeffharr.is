# Brensilver Feed Tool

Builds the static podcast artifacts served from `/brensilver/`:

- `/brensilver/feed.xml`
- `/brensilver/talks.json`
- `/brensilver/index.html`

Run from the repo root:

```sh
python3 scripts/build-brensilver-feed.py
```

The data model intentionally includes a transcript placeholder so a later transcription job can attach OpenAI-hosted transcript output without changing the RSS merge logic.
