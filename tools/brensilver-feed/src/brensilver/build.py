from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List

from brensilver.models import Talk
from brensilver.rss import build_rss, merge_talks
from brensilver.sources import fetch_audiodharma_talks, fetch_dharmaseed_talks


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the merged Brensilver podcast feed.")
    parser.add_argument("--config", default="config/sources.json")
    parser.add_argument("--out-dir", default="public/brensilver")
    parser.add_argument("--probe-lengths", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    talks = collect_talks(config, probe_lengths=args.probe_lengths)
    talks = merge_talks(talks)
    max_items = int(config.get("feed", {}).get("max_items", len(talks)))
    feed_talks = talks[:max_items]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "feed.xml").write_text(build_rss(feed_talks, config["site"]), encoding="utf-8")
    (out_dir / "talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in talks], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (out_dir / "index.html").write_text(render_index(config, talks, feed_talks), encoding="utf-8")

    print(f"Wrote {len(feed_talks)} feed items from {len(talks)} total talks to {out_dir}")
    return 0


def collect_talks(config: Dict, probe_lengths: bool = False) -> List[Talk]:
    talks: List[Talk] = []
    for source in config["sources"]:
        if source["type"] == "dharmaseed":
            talks.extend(fetch_dharmaseed_talks(source))
        elif source["type"] == "audiodharma":
            talks.extend(fetch_audiodharma_talks(source, probe_lengths=probe_lengths))
        else:
            raise ValueError(f"Unknown source type: {source['type']}")
    return talks


def render_index(config: Dict, all_talks: List[Talk], feed_talks: List[Talk]) -> str:
    site = config["site"]
    latest = feed_talks[0] if feed_talks else None
    latest_date = latest.published_at.date().isoformat() if latest else "n/a"
    source_counts = {}
    for talk in all_talks:
        source_counts[talk.source] = source_counts.get(talk.source, 0) + 1

    rows = "\n".join(
        f"<li><strong>{_escape(name)}</strong>: {count} talks</li>"
        for name, count in sorted(source_counts.items())
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_escape(site["title"])}</title>
  <link rel="alternate" type="application/rss+xml" title="{_escape(site["title"])}" href="feed.xml">
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #f8f7f3;
      --ink: #1f2933;
      --muted: #52616b;
      --line: #d8d2c4;
      --accent: #2f6f73;
      --panel: #ffffff;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #111816;
        --ink: #eef2ed;
        --muted: #b2beb6;
        --line: #39443f;
        --accent: #79b7aa;
        --panel: #18211e;
      }}
    }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }}
    main {{
      max-width: 760px;
      margin: 0 auto;
      padding: 56px 22px;
    }}
    h1 {{
      margin: 0 0 14px;
      font-size: clamp(2rem, 8vw, 4.5rem);
      line-height: 0.95;
      letter-spacing: 0;
    }}
    p {{
      color: var(--muted);
      font-size: 1.05rem;
    }}
    a {{
      color: var(--accent);
      font-weight: 700;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin: 30px 0;
    }}
    .button {{
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      text-decoration: none;
    }}
    section {{
      border-top: 1px solid var(--line);
      margin-top: 34px;
      padding-top: 24px;
    }}
    ul {{
      padding-left: 20px;
    }}
    code {{
      overflow-wrap: anywhere;
    }}
  </style>
</head>
<body>
  <main>
    <h1>{_escape(site["title"])}</h1>
    <p>{_escape(site["description"])}</p>
    <div class="actions">
      <a class="button" href="feed.xml">Podcast RSS</a>
      <a class="button" href="talks.json">Talk data</a>
    </div>
    <section>
      <h2>Feed Status</h2>
      <p>Latest item date: <strong>{latest_date}</strong>. Feed items: <strong>{len(feed_talks)}</strong>. Indexed talks: <strong>{len(all_talks)}</strong>.</p>
      <ul>
        {rows}
      </ul>
    </section>
    <section>
      <h2>Subscribe</h2>
      <p>Use this URL in a podcast player such as Overcast:</p>
      <p><code>{_escape(site["feed_url"])}</code></p>
    </section>
  </main>
</body>
</html>
"""


def _escape(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
