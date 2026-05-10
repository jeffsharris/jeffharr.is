from __future__ import annotations

import argparse
import json
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List

from brensilver.metadata import enrich_talks, safe_id, write_episode_media
from brensilver.models import Talk
from brensilver.rss import build_rss, merge_talks
from brensilver.sources import fetch_audiodharma_talks, fetch_dharmaseed_talks


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the merged Brensilver podcast feed.")
    parser.add_argument("--config", default="config/sources.json")
    parser.add_argument("--out-dir", default="public/brensilver")
    parser.add_argument("--talks-json")
    parser.add_argument("--corpus-dir", default=".local-corpus/brensilver")
    parser.add_argument("--media-base-url")
    parser.add_argument("--copy-artwork", action="store_true")
    parser.add_argument("--no-enrich", action="store_true")
    parser.add_argument("--probe-lengths", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    talks = (
        load_talks_json(Path(args.talks_json))
        if args.talks_json
        else collect_talks(config, probe_lengths=args.probe_lengths)
    )
    talks = merge_talks(talks)
    corpus_dir = Path(args.corpus_dir)
    media_base_url = (
        args.media_base_url
        or config["site"].get("media_base_url")
        or config["site"]["base_url"]
    )
    if not args.no_enrich and corpus_dir.exists():
        talks = enrich_talks(
            talks,
            corpus_dir=corpus_dir,
            media_base_url=media_base_url,
            site_base_url=config["site"]["base_url"],
        )
    max_items = int(config.get("feed", {}).get("max_items", len(talks)))
    feed_talks = talks[:max_items]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "feed.xml").write_text(build_rss(feed_talks, config["site"]), encoding="utf-8")
    (out_dir / "talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in talks], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    media_counts = write_episode_media(
        talks,
        out_dir=out_dir,
        corpus_dir=corpus_dir,
        copy_artwork=args.copy_artwork,
    )
    write_talk_pages(out_dir, config, talks)
    (out_dir / "index.html").write_text(render_index(config, talks, feed_talks), encoding="utf-8")

    print(
        f"Wrote {len(feed_talks)} feed items from {len(talks)} total talks to {out_dir} "
        f"({media_counts['chapters']} chapter files, {media_counts['artwork']} artwork files)"
    )
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


def load_talks_json(path: Path) -> List[Talk]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    talks: List[Talk] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        talks.append(
            Talk(
                id=str(item["id"]),
                source=str(item["source"]),
                source_id=str(item["source_id"]),
                title=str(item["title"]),
                speaker=str(item.get("speaker") or "Matthew Brensilver"),
                published_at=datetime.fromisoformat(str(item["published_at"])),
                link=str(item["link"]),
                audio_url=str(item["audio_url"]),
                audio_type=str(item.get("audio_type") or "audio/mpeg"),
                audio_length=item.get("audio_length"),
                duration=item.get("duration"),
                description=item.get("description"),
                image_url=item.get("image_url"),
                venue=item.get("venue"),
                series=item.get("series"),
                tags=item.get("tags") or [],
            )
        )
    return talks


def render_index(config: Dict, all_talks: List[Talk], feed_talks: List[Talk]) -> str:
    site = config["site"]
    latest = feed_talks[0] if feed_talks else None
    featured = next((talk for talk in feed_talks if talk.episode_image_url), latest)
    featured_image = (
        (featured.episode_image_url or featured.image_url)
        if featured
        else site.get("image_url")
    )
    featured_image_src = html_media_url(site, featured_image)
    featured_title = featured.title if featured else site["title"]
    featured_url = (
        featured.canonical_url
        or f"{site['base_url']}talks/{safe_id(featured.id)}/"
        if featured
        else site["base_url"]
    )
    latest_date = latest.published_at.date().isoformat() if latest else "n/a"
    enriched_count = sum(
        1 for talk in all_talks if talk.podcast_description or talk.chapters or talk.episode_image_url
    )
    artwork_count = sum(1 for talk in all_talks if talk.episode_image_url)
    source_counts = {}
    for talk in all_talks:
        source_counts[talk.source] = source_counts.get(talk.source, 0) + 1

    source_rows = "\n".join(
        f"""<div class="stat">
          <span>{_escape(name)}</span>
          <strong>{count}</strong>
        </div>"""
        for name, count in sorted(source_counts.items())
    )
    overcast_url = (
        "overcast://x-callback-url/add?url="
        + urllib.parse.quote(str(site["feed_url"]), safe="")
    )
    feed_json = json.dumps(site["feed_url"])
    featured_image_html = (
        f"""<a class="cover-link" href="{_escape(featured_url)}" aria-label="Open featured talk">
          <img class="cover" src="{_escape(featured_image_src)}" alt="">
        </a>"""
        if featured_image_src
        else ""
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
      --accent: #226f63;
      --accent-strong: #174f47;
      --rust: #a15c38;
      --gold: #b28a31;
      --blue: #3d6c93;
      --panel: #ffffff;
      --shadow: rgba(31, 41, 51, 0.12);
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #111816;
        --ink: #eef2ed;
        --muted: #b2beb6;
        --line: #39443f;
        --accent: #79b7aa;
        --accent-strong: #9fd7cc;
        --rust: #d38a67;
        --gold: #dfbd64;
        --blue: #8ab5da;
        --panel: #18211e;
        --shadow: rgba(0, 0, 0, 0.32);
      }}
    }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }}
    .page-shell {{
      min-height: 100vh;
    }}
    main {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 52px 22px 72px;
    }}
    .eyebrow {{
      color: var(--rust);
      font-size: 0.82rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin: 0 0 12px;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 0 0 14px;
      font-size: clamp(2.35rem, 7vw, 5.75rem);
      line-height: 0.95;
      letter-spacing: 0;
      max-width: 840px;
    }}
    h2 {{
      font-size: clamp(1.45rem, 3vw, 2.15rem);
      line-height: 1.1;
      letter-spacing: 0;
      margin: 0 0 16px;
    }}
    p {{
      color: var(--muted);
      font-size: 1.05rem;
    }}
    a {{
      color: var(--accent);
      font-weight: 700;
    }}
    .hero {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 360px);
      gap: 42px;
      align-items: end;
      padding-bottom: 36px;
    }}
    .lede {{
      max-width: 700px;
      font-size: clamp(1.08rem, 2vw, 1.34rem);
    }}
    .cover-link {{
      display: block;
      align-self: center;
      justify-self: end;
      max-width: 360px;
      width: 100%;
      text-decoration: none;
    }}
    .cover {{
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--line);
      box-shadow: 0 18px 48px var(--shadow);
    }}
    .subscribe-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      gap: 12px;
      margin: 24px 0 12px;
    }}
    .player-button {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 52px;
      padding: 0 14px;
      border: 0;
      border-radius: 6px;
      background: var(--accent-strong);
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-size: 0.96rem;
      font-weight: 800;
      text-decoration: none;
    }}
    .player-button img {{
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
    }}
    .player-button.apple {{ background: #872ec4; }}
    .player-button.pocket {{ background: #c1435b; }}
    .player-button.rss {{ background: var(--rust); }}
    .copy-status {{
      min-height: 1.4em;
      margin: 8px 0 0;
      color: var(--accent);
      font-size: 0.95rem;
      font-weight: 700;
    }}
    .feed-url {{
      display: block;
      max-width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: color-mix(in srgb, var(--panel) 82%, var(--bg));
      overflow-wrap: anywhere;
    }}
    section:not(.hero) {{
      border-top: 1px solid var(--line);
      margin-top: 36px;
      padding-top: 30px;
    }}
    .stats {{
      display: grid;
      grid-template-columns: repeat(4, minmax(130px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }}
    .stat {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
    }}
    .stat span {{
      display: block;
      color: var(--muted);
      font-size: 0.88rem;
      margin-bottom: 6px;
    }}
    .stat strong {{
      display: block;
      color: var(--ink);
      font-size: 1.55rem;
      line-height: 1;
    }}
    .latest {{
      margin-top: 18px;
    }}
    code {{
      overflow-wrap: anywhere;
    }}
    @media (max-width: 880px) {{
      .hero {{ grid-template-columns: 1fr; gap: 24px; }}
      .cover-link {{ justify-self: start; max-width: 260px; }}
      .subscribe-grid {{ grid-template-columns: repeat(2, minmax(140px, 1fr)); }}
      .stats {{ grid-template-columns: repeat(2, minmax(140px, 1fr)); }}
    }}
    @media (max-width: 520px) {{
      main {{ padding: 34px 18px 56px; }}
      .subscribe-grid {{ grid-template-columns: 1fr; }}
      .stats {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="page-shell">
  <main>
    <section class="hero" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">Merged podcast feed</p>
        <h1 id="page-title">{_escape(site["title"])}</h1>
        <p class="lede">{_escape(site["description"])} New transcript-derived descriptions, chapters, and episode artwork are added as the local corpus pipeline finishes each batch.</p>
      </div>
      {featured_image_html}
    </section>
    <section aria-labelledby="subscribe-heading">
      <h2 id="subscribe-heading">Subscribe</h2>
      <p>Overcast can add the feed directly. For Apple Podcasts, Pocket Casts, and other players, copy the RSS URL and add it as a custom feed.</p>
      <div class="subscribe-grid">
        <a class="player-button overcast" href="{_escape(overcast_url)}">
          <img src="https://cdn.simpleicons.org/overcast/FFFFFF?viewbox=auto" alt="">
          <span>Add to Overcast</span>
        </a>
        <button class="player-button apple" type="button" data-copy="feed">
          <img src="https://cdn.simpleicons.org/applepodcasts/FFFFFF?viewbox=auto" alt="">
          <span>Copy for Apple</span>
        </button>
        <button class="player-button pocket" type="button" data-copy="feed">
          <img src="https://cdn.simpleicons.org/pocketcasts/FFFFFF?viewbox=auto" alt="">
          <span>Copy for Pocket</span>
        </button>
        <a class="player-button rss" href="feed.xml">
          <img src="https://cdn.simpleicons.org/rss/FFFFFF?viewbox=auto" alt="">
          <span>RSS Feed</span>
        </a>
      </div>
      <p id="copy-status" class="copy-status" aria-live="polite"></p>
      <code class="feed-url">{_escape(site["feed_url"])}</code>
    </section>
    <section>
      <h2>Feed Status</h2>
      <p class="latest">Latest item date: <strong>{latest_date}</strong>. Featured talk: <a href="{_escape(featured_url)}">{_escape(featured_title)}</a>.</p>
      <div class="stats">
        <div class="stat"><span>Feed items</span><strong>{len(feed_talks)}</strong></div>
        <div class="stat"><span>Indexed talks</span><strong>{len(all_talks)}</strong></div>
        <div class="stat"><span>Enriched talks</span><strong>{enriched_count}</strong></div>
        <div class="stat"><span>Artwork</span><strong>{artwork_count}</strong></div>
        {source_rows}
      </div>
    </section>
    <section>
      <h2>Data</h2>
      <p><a href="talks.json">Talk data</a> includes source metadata plus transcript-enriched episode descriptions, chapter links, and artwork URLs as each talk is processed.</p>
    </section>
  </main>
  </div>
  <script>
    const feedUrl = {feed_json};
    const status = document.getElementById('copy-status');
    async function copyFeedUrl() {{
      try {{
        await navigator.clipboard.writeText(feedUrl);
        status.textContent = 'RSS URL copied.';
      }} catch (error) {{
        status.textContent = feedUrl;
      }}
    }}
    document.querySelectorAll('[data-copy]').forEach(button => {{
      button.addEventListener('click', copyFeedUrl);
    }});
  </script>
</body>
</html>
"""


def write_talk_pages(out_dir: Path, config: Dict, talks: List[Talk]) -> None:
    talks_dir = out_dir / "talks"
    for talk in talks:
        page_dir = talks_dir / safe_id(talk.id)
        page_dir.mkdir(parents=True, exist_ok=True)
        (page_dir / "index.html").write_text(render_talk_page(config, talk), encoding="utf-8")


def render_talk_page(config: Dict, talk: Talk) -> str:
    site = config["site"]
    image_url = talk.episode_image_url or talk.image_url
    image_src = html_media_url(site, image_url)
    description = talk.podcast_description or talk.description or site["description"]
    chapters = "\n".join(
        f"""<li><a href="?t={int(round(chapter.start))}" data-start="{chapter.start}">{_escape(format_timestamp(chapter.start))}</a> <strong>{_escape(chapter.title)}</strong>{chapter_description(chapter.description)}</li>"""
        for chapter in talk.chapters
    )
    chapters_section = (
        f"""<section>
      <h2>Chapters</h2>
      <ol class="chapters">
        {chapters}
      </ol>
    </section>"""
        if chapters
        else ""
    )
    image = (
        f"""<img class="art" src="{_escape(image_src)}" alt="">"""
        if image_src
        else ""
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_escape(talk.title)} - {_escape(site["title"])}</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #fbfaf4;
      --ink: #20231f;
      --muted: #5d665e;
      --line: #d9d4c7;
      --accent: #285f52;
      --panel: #ffffff;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #111816;
        --ink: #eef2ed;
        --muted: #b2beb6;
        --line: #39443f;
        --accent: #8ec7ba;
        --panel: #18211e;
      }}
    }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 17px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    main {{
      max-width: 860px;
      margin: 0 auto;
      padding: 34px 20px 64px;
    }}
    a {{ color: var(--accent); font-weight: 750; }}
    .back {{ display: inline-block; margin-bottom: 28px; }}
    h1 {{ margin: 0; font-size: clamp(2rem, 7vw, 4.2rem); line-height: 1; letter-spacing: 0; }}
    h2 {{ margin-top: 34px; }}
    .meta {{
      margin: 10px 0 22px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
    }}
    .hero {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
      gap: 24px;
      align-items: start;
    }}
    .art {{
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--line);
    }}
    audio {{ width: 100%; margin: 22px 0; }}
    section {{ border-top: 1px solid var(--line); margin-top: 26px; padding-top: 8px; }}
    .chapters {{ padding-left: 24px; }}
    .chapters li {{ margin: 12px 0; }}
    .description {{ max-width: 680px; }}
    @media (max-width: 760px) {{
      .hero {{ grid-template-columns: 1fr; }}
      .art {{ max-width: 260px; }}
    }}
  </style>
</head>
<body>
  <main>
    <a class="back" href="../../">Matthew Brensilver Dharma Talks</a>
    <div class="hero">
      <div>
        <h1>{_escape(talk.title)}</h1>
        <div class="meta">
          <span>{_escape(talk.source)}</span>
          <span>{_escape(talk.duration or "")}</span>
          <span>{_escape(talk.published_at.date().isoformat())}</span>
        </div>
        <p class="description">{_escape(description)}</p>
      </div>
      {image}
    </div>
    <audio id="audio" controls preload="metadata" src="{_escape(talk.audio_url)}"></audio>
    {chapters_section}
    <section>
      <h2>Source</h2>
      <p><a href="{_escape(talk.link)}">Original talk page</a></p>
    </section>
  </main>
  <script>
    const audio = document.getElementById('audio');
    function seekFromLocation() {{
      const value = new URLSearchParams(location.search).get('t');
      const seconds = Number(value || 0);
      if (Number.isFinite(seconds) && seconds > 0) {{
        audio.currentTime = seconds;
      }}
    }}
    document.querySelectorAll('[data-start]').forEach(link => {{
      link.addEventListener('click', event => {{
        event.preventDefault();
        const seconds = Number(link.dataset.start || 0);
        history.replaceState(null, '', '?t=' + Math.round(seconds));
        audio.currentTime = seconds;
        audio.play().catch(() => {{}});
      }});
    }});
    audio.addEventListener('loadedmetadata', seekFromLocation, {{ once: true }});
  </script>
</body>
</html>
"""


def chapter_description(description: object) -> str:
    if not description:
        return ""
    return f" - {_escape(description)}"


def format_timestamp(seconds: float) -> str:
    total = int(round(max(0, seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def html_media_url(site: Dict, url: str | None) -> str | None:
    if not url:
        return None
    base_url = str(site.get("base_url") or "")
    if base_url and url.startswith(base_url):
        parsed = urllib.parse.urlparse(url)
        if parsed.path:
            return parsed.path
    return url


def _escape(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
