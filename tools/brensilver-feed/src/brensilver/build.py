from __future__ import annotations

import argparse
import json
import re
import urllib.parse
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List

from brensilver.metadata import enrich_talks, safe_id, write_episode_media
from brensilver.models import PodcastChapter, Talk, TranscriptRef
from brensilver.rss import build_rss, merge_talks
from brensilver.sources import (
    fetch_audiodharma_talks,
    fetch_dharmaseed_player_talks,
    fetch_dharmaseed_talks,
    fetch_podcast_rss_talks,
)

GUIDED_FEED_TITLE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\bguided\b",
        r"\bguded\s+meditation\b",
        r"^walking meditation\b",
        r"^metta practice\b",
        r"^morning (instructions|sit with instruction)\b",
        r"^(monday|wednesday|friday) morning instructions\b",
        r"^day \d+:? (morning )?instructions and sitting\b",
        r"^day \d+: sitting with instructions\b",
        r"\bsit with (instructions|guidance)\b",
        r"\bsitting with instructions\b",
        r"\bpractice session\b",
        r"^formal opening part 1 \(sit\)$",
        r"^tuesday sit with instructions\b",
    ]
]

DHARMA_FEED_TITLE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\btalk and short guided meditation\b",
    ]
]


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the merged Brensilver podcast feed.")
    parser.add_argument("--config", default="config/sources.json")
    parser.add_argument("--out-dir", default="public/brensilver")
    parser.add_argument("--talks-json")
    parser.add_argument("--seed-talks-json", action="append", default=[])
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
    if not args.talks_json:
        talks.extend(load_seed_talks(args.seed_talks_json))
    talks = merge_talks(talks)
    talks = apply_source_metadata(talks)
    talks = apply_site_image(talks, config["site"].get("image_url"))
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
    if guided_feed_enabled(config["site"]):
        dharma_talks, guided_talks = split_talks_for_feeds(talks)
        feed_talks = dharma_talks[:max_items]
        guided_feed_talks = guided_talks[:max_items]
        guided_site = build_guided_site(config["site"])
    else:
        dharma_talks = talks
        guided_talks = []
        feed_talks = talks[:max_items]
        guided_feed_talks = []
        guided_site = None

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "feed.xml").write_text(build_rss(feed_talks, config["site"]), encoding="utf-8")
    if guided_site:
        (out_dir / "guided-feed.xml").write_text(
            build_rss(guided_feed_talks, guided_site),
            encoding="utf-8",
        )
    (out_dir / "talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in talks], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if guided_site:
        (out_dir / "dharma-talks.json").write_text(
            json.dumps(
                [talk.to_json_dict() for talk in dharma_talks],
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        (out_dir / "guided-talks.json").write_text(
            json.dumps(
                [talk.to_json_dict() for talk in guided_talks],
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
    media_counts = write_episode_media(
        talks,
        out_dir=out_dir,
        corpus_dir=corpus_dir,
        copy_artwork=args.copy_artwork,
    )
    write_site_assets(out_dir)
    write_talk_pages(out_dir, config, talks)
    (out_dir / "index.html").write_text(
        render_index(config, talks, feed_talks, guided_feed_talks, guided_site),
        encoding="utf-8",
    )

    if guided_site:
        print(
            f"Wrote {len(feed_talks)} Dharma feed items and {len(guided_feed_talks)} guided feed items "
            f"from {len(talks)} total talks to {out_dir} "
            f"({media_counts['chapters']} chapter files, {media_counts['artwork']} artwork files)"
        )
    else:
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
        elif source["type"] == "dharmaseed_player":
            talks.extend(fetch_dharmaseed_player_talks(source))
        elif source["type"] == "audiodharma":
            talks.extend(fetch_audiodharma_talks(source, probe_lengths=probe_lengths))
        elif source["type"] == "podcast_rss":
            talks.extend(fetch_podcast_rss_talks(source))
        else:
            raise ValueError(f"Unknown source type: {source['type']}")
    return talks


def load_seed_talks(paths: Iterable[str]) -> List[Talk]:
    talks: List[Talk] = []
    loaded_paths = set()
    for raw_path in paths:
        path = Path(raw_path)
        if path in loaded_paths or not path.exists():
            continue
        loaded_paths.add(path)
        talks.extend(load_talks_json(path))
    return talks


def apply_site_image(talks: List[Talk], image_url: str | None) -> List[Talk]:
    if not image_url:
        return talks
    return [replace(talk, image_url=image_url) for talk in talks]


def apply_source_metadata(talks: List[Talk]) -> List[Talk]:
    return [
        replace(
            talk,
            venue=talk.venue or venue_from_description(talk.description),
            series=talk.series or series_from_title(talk.title),
            co_teachers=talk.co_teachers or co_teachers_from_title(talk.title),
        )
        for talk in talks
    ]


def venue_from_description(description: str | None) -> str | None:
    if not description:
        return None
    match = re.match(r"^\(([^)]+)\)", description.strip())
    if not match:
        return None
    venue = " ".join(match.group(1).split())
    return venue or None


def series_from_title(title: str) -> str | None:
    for value in re.findall(r"\(([^)]+)\)", title):
        context = " ".join(value.split())
        if re.search(r"\b(retreat|daylong|drop-in)\b", context, re.IGNORECASE):
            return context
    return None


def co_teachers_from_title(title: str) -> List[str]:
    prefix = title.split(":", 1)[0]
    if "," not in prefix or not re.search(r"\bBrensilver\b", prefix, re.IGNORECASE):
        return []

    names = []
    for raw_name in prefix.split(","):
        name = " ".join(raw_name.split())
        if not name or re.search(r"\bMatthew\s+Brensilver\b", name, re.IGNORECASE):
            continue
        names.append(name)
    return names


def build_guided_site(site: Dict) -> Dict:
    guided = dict(site)
    guided["title"] = site.get("guided_title", "Matthew Brensilver Guided Meditations")
    guided["description"] = site.get(
        "guided_description",
        "A companion feed of Matthew Brensilver guided meditations and practice instructions.",
    )
    guided["feed_url"] = site.get("guided_feed_url", site["base_url"] + "guided-feed.xml")
    return guided


def guided_feed_enabled(site: Dict) -> bool:
    return bool(
        site.get("guided_feed_url")
        or site.get("guided_title")
        or site.get("guided_description")
    )


def split_talks_for_feeds(talks: List[Talk]) -> tuple[List[Talk], List[Talk]]:
    dharma_talks: List[Talk] = []
    guided_talks: List[Talk] = []
    for talk in talks:
        if is_guided_practice(talk):
            guided_talks.append(talk)
        else:
            dharma_talks.append(talk)
    return dharma_talks, guided_talks


def is_guided_practice(talk: Talk) -> bool:
    title = " ".join(talk.title.split())
    if any(pattern.search(title) for pattern in DHARMA_FEED_TITLE_PATTERNS):
        return False
    return any(pattern.search(title) for pattern in GUIDED_FEED_TITLE_PATTERNS)


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
                canonical_url=item.get("canonical_url"),
                podcast_description=item.get("podcast_description"),
                short_summary=item.get("short_summary"),
                episode_image_url=item.get("episode_image_url"),
                chapters_url=item.get("chapters_url"),
                chapters=load_chapters(item.get("chapters")),
                venue=item.get("venue"),
                series=item.get("series"),
                co_teachers=item.get("co_teachers") or [],
                tags=item.get("tags") or [],
                transcript=load_transcript(item.get("transcript")),
            )
        )
    return talks


def load_chapters(raw: object) -> List[PodcastChapter]:
    if not isinstance(raw, list):
        return []
    chapters: List[PodcastChapter] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        chapters.append(
            PodcastChapter(
                start=coerce_float(item.get("start", item.get("startTime"))),
                title=str(item.get("title") or "Section"),
                description=item.get("description"),
                url=item.get("url"),
                img=item.get("img"),
                toc=bool(item.get("toc", True)),
            )
        )
    return chapters


def load_transcript(raw: object) -> TranscriptRef:
    if not isinstance(raw, dict):
        return TranscriptRef()
    return TranscriptRef(
        status=str(raw.get("status") or "pending"),
        url=raw.get("url"),
        text_path=raw.get("text_path"),
    )


def coerce_float(value: object) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def render_index(
    config: Dict,
    all_talks: List[Talk],
    feed_talks: List[Talk],
    guided_feed_talks: List[Talk],
    guided_site: Dict | None,
) -> str:
    site = config["site"]
    page_title = str(
        site.get("page_title")
        or re.sub(r"\s+(Dharma Talks|Talks|Podcast Feed|Podcast)$", "", str(site["title"]))
    ).strip()
    portrait_src = html_media_url(site, site.get("image_url"))
    has_guided_feed = guided_site is not None
    corpus_slug = corpus_slug_from_site(site)
    guided_alternate_link = ""
    main_feed_label = site.get("feed_label") or (
        "Dharma talks" if has_guided_feed else "Podcast feed"
    )
    archive_scopes = {
        "all": {
            "title": "All",
            "url": "talks.json",
            "count": len(all_talks),
        }
    }
    scope_switch = ""
    if guided_site:
        guided_alternate_link = (
            f'  <link rel="alternate" type="application/rss+xml" '
            f'title="{_escape(guided_site["title"])}" href="guided-feed.xml">\n'
        )
        archive_scopes["dharma"] = {
            "title": main_feed_label,
            "url": "dharma-talks.json" if has_guided_feed else "talks.json",
            "count": len(feed_talks),
        }
        archive_scopes["guided"] = {
            "title": "Guided meditations",
            "url": "guided-talks.json",
            "count": len(guided_feed_talks),
        }
        scope_switch = render_scope_switch(archive_scopes)
    archive_config_json = json.dumps(
        {
            "corpus": corpus_slug,
            "defaultScope": "all",
            "feedEndpoint": "/api/feeds/dharma.xml",
            "siteBaseUrl": str(site.get("base_url") or ""),
            "talkPathPrefix": "talks/",
            "scopes": archive_scopes,
        }
    )
    portrait_html = (
        f"""<img class="portrait" src="{_escape(portrait_src)}" alt="{_escape(page_title)}">"""
        if portrait_src
        else ""
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_escape(page_title)}</title>
  <link rel="alternate" type="application/rss+xml" title="{_escape(site["title"])}" href="feed.xml">
{guided_alternate_link}  <style>
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
      max-width: 960px;
      margin: 0 auto;
      padding: 56px 22px 72px;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(2.7rem, 8vw, 5.6rem);
      line-height: 0.95;
      letter-spacing: 0;
    }}
    h2 {{
      font-size: clamp(1.55rem, 3vw, 2.25rem);
      line-height: 1.1;
      letter-spacing: 0;
      margin: 0 0 8px;
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
      grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
      gap: 34px;
      align-items: center;
      padding-bottom: 42px;
    }}
    .portrait {{
      justify-self: end;
      width: 100%;
      max-width: 280px;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--line);
      box-shadow: 0 18px 48px var(--shadow);
    }}
    .archive-query {{
      display: grid;
      gap: 14px;
      margin: 20px 0 14px;
    }}
    .scope-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }}
    .scope-switch {{
      display: inline-grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(118px, 1fr);
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 72%, var(--bg));
    }}
    .scope-chip,
    .starred-toggle {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 46px;
      padding: 0 12px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-weight: 800;
      text-align: left;
    }}
    .scope-chip strong {{
      color: inherit;
      font-size: 0.95rem;
    }}
    .scope-chip.is-active,
    .starred-toggle.is-active {{
      background: var(--accent-strong);
      color: #ffffff;
      box-shadow: 0 8px 22px var(--shadow);
    }}
    .starred-toggle {{
      grid-template-columns: auto;
      border: 1px solid var(--line);
      background: color-mix(in srgb, var(--panel) 78%, var(--bg));
      color: var(--accent);
    }}
    .result-bar {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      align-items: baseline;
      justify-content: space-between;
      margin: 4px 0 12px;
    }}
    .result-bar p {{
      margin: 0;
    }}
    .subscribe-current {{
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(320px, 2fr);
      gap: 18px;
      align-items: center;
      margin: 22px 0 24px;
      padding: 18px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }}
    .subscribe-current h3 {{
      margin: 0;
      font-size: 1.08rem;
      line-height: 1.2;
      letter-spacing: 0;
    }}
    .subscribe-copy {{
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }}
    .listen-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(140px, 1fr));
      gap: 12px;
    }}
    .listen-badge {{
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
    .listen-badge img {{
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
    }}
    .listen-badge.pocket {{ background: #d9443f; }}
    .listen-badge.apple {{ background: #872ec4; }}
    .listen-badge.youtube {{ background: #c4302b; }}
    .copy-status {{
      min-height: 1.4em;
      margin: 8px 0 0;
      color: var(--accent);
      font-size: 0.95rem;
      font-weight: 700;
    }}
{landing_archive_css()}
    @media (max-width: 880px) {{
      .hero {{ grid-template-columns: 1fr; gap: 26px; }}
      .portrait {{ justify-self: start; max-width: 240px; }}
      .subscribe-current {{ grid-template-columns: 1fr; align-items: start; }}
      .listen-grid {{ grid-template-columns: repeat(2, minmax(140px, 1fr)); }}
    }}
    @media (max-width: 520px) {{
      main {{ padding: 34px 18px 56px; }}
      .scope-row {{ display: grid; grid-template-columns: 1fr; }}
      .scope-switch {{ grid-auto-flow: row; grid-auto-columns: auto; grid-template-columns: 1fr; width: auto; }}
      .listen-grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="page-shell">
  <main>
    <section class="hero" aria-labelledby="page-title">
      <div>
        <h1 id="page-title">{_escape(page_title)}</h1>
      </div>
      {portrait_html}
    </section>
    <section class="archive" aria-labelledby="archive-heading">
      <p class="archive-kicker">Archive</p>
      <h2 id="archive-heading">Browse and listen</h2>
      <div class="archive-query">
        <label class="archive-search" for="archive-search">
          <span class="sr-only">Search talks</span>
          <input id="archive-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search titles, descriptions, chapters">
        </label>
        <div class="scope-row">
{scope_switch}
          <button class="starred-toggle" type="button" aria-pressed="false" data-starred-toggle>Starred</button>
        </div>
      </div>
      <div class="result-bar">
        <p id="archive-summary" class="archive-copy">Play talks here or download the audio.</p>
        <p id="archive-search-status" class="archive-search-status" aria-live="polite"></p>
      </div>
      <section class="subscribe-current" aria-labelledby="subscribe-current-heading">
        <div>
          <h3 id="subscribe-current-heading">Subscribe to results</h3>
          <p id="feed-copy" class="subscribe-copy">RSS reflects the current search.</p>
          <p id="copy-status" class="copy-status" aria-live="polite"></p>
        </div>
        <div class="listen-grid">
          <a class="listen-badge overcast" href="#" data-subscribe-target="overcast">
            <img src="https://cdn.simpleicons.org/overcast/FFFFFF?viewbox=auto" alt="">
            <span>Overcast</span>
          </a>
          <a class="listen-badge pocket" href="#" data-subscribe-target="pocket">
            <img src="https://cdn.simpleicons.org/pocketcasts/FFFFFF?viewbox=auto" alt="">
            <span>Pocket Casts</span>
          </a>
          <button class="listen-badge apple" type="button" data-copy-current-feed data-copy-message="RSS URL copied. In Apple Podcasts, choose Library, then Add a Show by URL.">
            <img src="https://cdn.simpleicons.org/applepodcasts/FFFFFF?viewbox=auto" alt="">
            <span>Apple Podcasts</span>
          </button>
          <button class="listen-badge youtube" type="button" data-copy-current-feed data-copy-message="RSS URL copied. In YouTube Music, choose Library, Podcasts, then Add podcast by RSS feed.">
            <img src="https://cdn.simpleicons.org/youtubemusic/FFFFFF?viewbox=auto" alt="">
            <span>YouTube Music</span>
          </button>
        </div>
      </section>
      <div id="talk-list" class="talk-list"></div>
      <div id="talk-loader" class="talk-loader" aria-live="polite">Loading talks...</div>
    </section>
  </main>
  </div>
  <script>
    window.TALK_ARCHIVE_CONFIG = {archive_config_json};
  </script>
  <script src="archive-browser.js"></script>
  <script src="/js/admin-presence.js?v=2"></script>
</body>
</html>
"""


def render_scope_switch(scopes: Dict[str, Dict[str, object]]) -> str:
    buttons = []
    for key in ["all", "dharma", "guided"]:
        if key not in scopes:
            continue
        scope = scopes[key]
        active = key == "all"
        buttons.append(
            f"""          <button class="scope-chip{' is-active' if active else ''}" type="button" role="tab" aria-selected="{str(active).lower()}" data-scope="{_escape(key)}">
            <span>{_escape(str(scope["title"]))}</span>
            <strong>{int(scope["count"])}</strong>
          </button>"""
        )
    return f"""          <div class="scope-switch" role="tablist" aria-label="Choose archive scope">
{chr(10).join(buttons)}
          </div>"""


def corpus_slug_from_site(site: Dict) -> str:
    base_url = str(site.get("base_url") or "")
    match = re.search(r"/dharma/([^/]+)/?", base_url)
    if match:
        return match.group(1)
    return re.sub(r"[^a-z0-9]+", "-", str(site.get("author") or site.get("title") or "dharma").lower()).strip("-")


def landing_archive_css() -> str:
    return """    .archive {
      border-top: 1px solid var(--line);
      margin-top: 34px;
      padding-top: 34px;
    }
    .archive-kicker {
      margin: 0 0 6px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .archive-copy {
      max-width: 620px;
      margin: 0 0 22px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .archive-tools {
      display: grid;
      grid-template-columns: minmax(240px, 520px) minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      margin: 10px 0 4px;
    }
    .archive-search {
      position: relative;
      display: block;
    }
    .archive-search::before,
    .archive-search::after {
      position: absolute;
      content: "";
      pointer-events: none;
    }
    .archive-search::before {
      top: 15px;
      left: 17px;
      width: 13px;
      height: 13px;
      border: 2px solid var(--accent);
      border-radius: 50%;
      opacity: 0.86;
    }
    .archive-search::after {
      top: 29px;
      left: 30px;
      width: 9px;
      height: 2px;
      border-radius: 2px;
      background: var(--accent);
      transform: rotate(45deg);
      transform-origin: left center;
      opacity: 0.86;
    }
    .archive-search input {
      width: 100%;
      min-height: 48px;
      box-sizing: border-box;
      padding: 0 16px 0 47px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
      color: var(--ink);
      font: inherit;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
    }
    .archive-search input::placeholder {
      color: color-mix(in srgb, var(--muted) 78%, transparent);
    }
    .archive-search input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .archive-search-status {
      justify-self: end;
      margin: 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .talk-list {
      display: grid;
      gap: 14px;
      margin-top: 20px;
    }
    .talk-card {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr);
      gap: 16px;
      align-items: start;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 86%, var(--bg));
    }
    .talk-card img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .talk-card h3 {
      margin: 0;
      font-size: 1.14rem;
      line-height: 1.18;
      letter-spacing: 0;
    }
    .talk-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 7px 0 8px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .talk-card-description {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
      margin: 0;
      color: var(--muted);
      font-size: 0.98rem;
    }
    .talk-card-player {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      margin-top: 12px;
    }
    .talk-card-player audio {
      min-width: 0;
    }
    .talk-card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .archive-link,
    .download-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--accent);
      text-decoration: none;
      white-space: nowrap;
      background: color-mix(in srgb, var(--panel) 78%, var(--bg));
    }
    .talk-loader {
      min-height: 56px;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 0.95rem;
    }
    @media (max-width: 760px) {
      .archive-tools { grid-template-columns: 1fr; }
      .archive-search-status { justify-self: start; min-height: 1.3em; }
      .talk-card-player { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .talk-card { grid-template-columns: 82px minmax(0, 1fr); gap: 12px; padding: 12px; }
      .talk-card-description { -webkit-line-clamp: 4; }
      .talk-card-actions { display: grid; grid-template-columns: 1fr; }
    }
"""


def write_site_assets(out_dir: Path) -> None:
    (out_dir / "talk-page.css").write_text(talk_page_css(), encoding="utf-8")
    (out_dir / "archive-browser.js").write_text(archive_browser_js(), encoding="utf-8")


def talk_page_css() -> str:
    return """    :root {
      color-scheme: light dark;
      --bg: #fbfaf4;
      --ink: #20231f;
      --muted: #5d665e;
      --line: #d9d4c7;
      --accent: #285f52;
      --panel: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111816;
        --ink: #eef2ed;
        --muted: #b2beb6;
        --line: #39443f;
        --accent: #8ec7ba;
        --panel: #18211e;
      }
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 17px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 34px 20px 64px;
    }
    a { color: var(--accent); font-weight: 750; }
    .back { display: inline-block; margin-bottom: 28px; }
    h1 { margin: 0; font-size: clamp(2rem, 7vw, 4.2rem); line-height: 1; letter-spacing: 0; }
    h2 { margin-top: 34px; }
    .meta {
      margin: 10px 0 22px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
      gap: 24px;
      align-items: start;
    }
    .art {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--line);
    }
    audio { width: 100%; }
    .primary-player {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      margin: 22px 0;
    }
    .download-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--accent);
      text-decoration: none;
      white-space: nowrap;
    }
    section { border-top: 1px solid var(--line); margin-top: 26px; padding-top: 8px; }
    .chapters { padding-left: 24px; }
    .chapters li { margin: 12px 0; }
    .description { max-width: 680px; }
    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .art { max-width: 260px; }
      .primary-player { grid-template-columns: 1fr; }
      .download-link { width: auto; }
    }
"""


def archive_browser_js() -> str:
    return """(() => {
  const config = window.TALK_ARCHIVE_CONFIG || {};
  const scopes = config.scopes || {};
  const talkList = document.getElementById('talk-list');
  const talkLoader = document.getElementById('talk-loader');
  const archiveSummary = document.getElementById('archive-summary');
  const archiveSearch = document.getElementById('archive-search');
  const archiveSearchStatus = document.getElementById('archive-search-status');
  const starredToggle = document.querySelector('[data-starred-toggle]');
  const copyStatus = document.getElementById('copy-status');
  const feedCopy = document.getElementById('feed-copy');
  const siteBaseUrl = config.siteBaseUrl || '';
  const scopeKeys = Object.keys(scopes);
  const stateByScope = new Map();
  const favoriteStateByKey = new Map();
  const favoriteRequests = new Set();
  const talkBatchSize = 12;
  let currentScope = config.defaultScope || scopeKeys[0] || '';
  let searchQuery = '';
  let starredOnly = false;
  let observer = null;

  function initialStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const requestedScope = params.get('scope') || currentScope;
    return {
      scope: scopes[requestedScope] ? requestedScope : currentScope,
      query: params.get('q') || '',
      starred: params.get('starred') === '1',
    };
  }

  function mediaUrl(url) {
    if (!url) return '';
    if (siteBaseUrl && url.startsWith(siteBaseUrl)) {
      try {
        return new URL(url).pathname;
      } catch (error) {
        return url;
      }
    }
    return url;
  }

  function talkHref(talk) {
    const url = talk.canonical_url || '';
    if (siteBaseUrl && url.startsWith(siteBaseUrl)) {
      try {
        return new URL(url).pathname;
      } catch (error) {
        return url;
      }
    }
    return url || (config.talkPathPrefix || 'talks/') + String(talk.id || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '/';
  }

  function talkSafeId(talk) {
    const href = talkHref(talk);
    try {
      const parsed = new URL(href, location.href);
      return parsed.pathname.match(/\\/talks\\/([^/]+)\\/?$/)?.[1] || '';
    } catch (error) {
      return String(href || '').match(/\\/?talks\\/([^/]+)\\/?$/)?.[1] || '';
    }
  }

  function talkDescription(talk) {
    return talk.podcast_description || talk.short_summary || talk.description || '';
  }

  function talkDate(talk) {
    const value = talk.published_at ? new Date(talk.published_at) : null;
    if (!value || Number.isNaN(value.getTime())) return '';
    return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase();
  }

  function chapterSearchText(talk) {
    const chapters = Array.isArray(talk.chapters) ? talk.chapters : [];
    return chapters
      .map(chapter => [chapter.title, chapter.description].filter(Boolean).join(' '))
      .join(' ');
  }

  function talkSearchText(talk) {
    if (!talk.__archiveSearchText) {
      talk.__archiveSearchText = normalizeSearch([
        talk.title,
        talkDescription(talk),
        chapterSearchText(talk),
        talk.speaker,
        talk.source,
        talk.venue,
        talk.series,
        ...(Array.isArray(talk.tags) ? talk.tags : []),
      ].filter(Boolean).join(' '));
    }
    return talk.__archiveSearchText;
  }

  function addText(parent, tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text || '';
    parent.appendChild(el);
    return el;
  }

  function stateFor(key) {
    if (!stateByScope.has(key)) {
      stateByScope.set(key, {
        talks: null,
        filteredTalks: null,
        nextIndex: 0,
        loading: false,
      });
    }
    return stateByScope.get(key);
  }

  function activeTalks(state) {
    return state.filteredTalks || state.talks || [];
  }

  async function applyFilters(state) {
    if (!state.talks) {
      state.filteredTalks = null;
      state.nextIndex = 0;
      return;
    }
    const terms = normalizeSearch(searchQuery).split(/\\s+/).filter(Boolean);
    let talks = terms.length
      ? state.talks.filter(talk => terms.every(term => talkSearchText(talk).includes(term)))
      : state.talks;
    if (starredOnly) {
      await ensureFavoriteStates(state.talks);
      talks = talks.filter(isTalkFavorited);
    } else {
      ensureFavoriteStates(state.talks).catch(() => {});
    }
    state.filteredTalks = talks;
    state.nextIndex = 0;
  }

  function updateSearchStatus(key) {
    if (!archiveSearchStatus) return;
    const state = stateFor(key);
    if (!state.talks) {
      archiveSearchStatus.textContent = '';
      return;
    }
    const matches = activeTalks(state).length;
    const total = state.talks.length;
    const noun = matches === 1 ? 'match' : 'matches';
    archiveSearchStatus.textContent = (searchQuery.trim() || starredOnly)
      ? `${matches} of ${total} ${noun}`
      : '';
  }

  function updateSummary(key) {
    if (!archiveSummary) return;
    const scope = scopes[key] || {};
    const state = stateFor(key);
    const count = activeTalks(state).length || Number(scope.count || 0);
    const noun = count === 1 ? 'recording' : 'recordings';
    archiveSummary.textContent = count
      ? `${count} ${noun}. Play talks here or download the audio.`
      : 'Play talks here or download the audio.';
    updateSearchStatus(key);
    updateSubscribeLinks();
  }

  function renderTalkBatch(key = currentScope) {
    const state = stateFor(key);
    if (!state.talks || !talkList || !talkLoader || key !== currentScope) return;
    const fragment = document.createDocumentFragment();
    const talks = activeTalks(state);
    if (!talks.length) {
      talkLoader.textContent = searchQuery.trim() || starredOnly ? 'No recordings match this search.' : 'No recordings are available yet.';
      updateSearchStatus(key);
      updateSubscribeLinks();
      return;
    }
    const end = Math.min(state.nextIndex + talkBatchSize, talks.length);
    for (let index = state.nextIndex; index < end; index += 1) {
      const talk = talks[index];
      const card = document.createElement('article');
      card.className = 'talk-card';

      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = mediaUrl(talk.episode_image_url || talk.image_url);
      card.appendChild(img);

      const body = document.createElement('div');
      const title = addText(body, 'h3', '', '');
      const titleLink = document.createElement('a');
      titleLink.href = talkHref(talk);
      titleLink.textContent = talk.title || 'Untitled talk';
      title.appendChild(titleLink);

      const meta = document.createElement('div');
      meta.className = 'talk-card-meta';
      [talkDate(talk), talk.duration, talk.source].filter(Boolean).forEach(value => {
        addText(meta, 'span', '', value);
      });
      body.appendChild(meta);
      addText(body, 'p', 'talk-card-description', talkDescription(talk));

      const player = document.createElement('div');
      player.className = 'talk-card-player';
      const itemAudio = document.createElement('audio');
      itemAudio.controls = true;
      itemAudio.preload = 'none';
      itemAudio.src = talk.audio_url || '';
      player.appendChild(itemAudio);
      const actions = document.createElement('div');
      actions.className = 'talk-card-actions';
      const details = document.createElement('a');
      details.className = 'archive-link';
      details.href = talkHref(talk);
      details.textContent = 'Details';
      actions.appendChild(details);
      const download = document.createElement('a');
      download.className = 'download-link';
      download.href = talk.audio_url || '#';
      download.download = '';
      download.textContent = 'Download';
      actions.appendChild(download);
      player.appendChild(actions);
      body.appendChild(player);
      card.appendChild(body);
      fragment.appendChild(card);
    }
    state.nextIndex = end;
    talkList.appendChild(fragment);
    talkLoader.textContent = state.nextIndex >= talks.length
      ? (searchQuery.trim() || starredOnly ? 'End of matches' : 'End of archive')
      : 'Loading more talks...';
    updateSearchStatus(key);
    updateSubscribeLinks();
  }

  async function loadTalkArchive(key = currentScope) {
    if (!talkList || !talkLoader) return;
    const scope = scopes[key];
    if (!scope) return;
    currentScope = key;
    updateControls();
    updateSummary(key);
    const state = stateFor(key);
    talkList.replaceChildren();
    state.nextIndex = 0;
    talkLoader.textContent = 'Loading talks...';
    try {
      if (!state.talks) {
        state.loading = true;
        const response = await fetch(scope.url, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Could not load talk archive');
        const talks = await response.json();
        state.talks = talks
          .filter(talk => talk && talk.audio_url)
          .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
      }
      state.loading = false;
      await applyFilters(state);
      updateSummary(key);
      renderTalkBatch(key);
      if (!observer) {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            renderTalkBatch();
          }
        }, { rootMargin: '800px 0px' });
        observer.observe(talkLoader);
      }
    } catch (error) {
      state.loading = false;
      if (key === currentScope) {
        talkLoader.textContent = 'Talks could not be loaded right now.';
      }
    }
  }

  function favoriteKeyForTalk(talk) {
    const corpus = config.corpus || location.pathname.match(/^\\/dharma\\/([^/]+)/)?.[1] || '';
    const id = talkSafeId(talk);
    return corpus && id ? `dharma_talk:${corpus}:${id}` : '';
  }

  function favoritePayloadForTalk(talk) {
    const corpus = config.corpus || location.pathname.match(/^\\/dharma\\/([^/]+)/)?.[1] || '';
    const id = talkSafeId(talk);
    if (!corpus || !id) return null;
    const key = `dharma_talk:${corpus}:${id}`;
    return { key, ref: { kind: 'dharma_talk', corpus, id } };
  }

  function isTalkFavorited(talk) {
    const key = favoriteKeyForTalk(talk);
    return Boolean(key && favoriteStateByKey.get(key)?.favorited);
  }

  async function ensureFavoriteStates(talks) {
    const refs = talks
      .map(favoritePayloadForTalk)
      .filter(Boolean)
      .filter(ref => !favoriteStateByKey.has(ref.key) && !favoriteRequests.has(ref.key));
    if (!refs.length) return;
    refs.forEach(ref => favoriteRequests.add(ref.key));
    try {
      for (let index = 0; index < refs.length; index += 500) {
        const chunk = refs.slice(index, index + 500);
        const response = await fetch('/api/public/favorites/state', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify({ refs: chunk })
        });
        if (!response.ok) continue;
        const body = await response.json().catch(() => null);
        for (const state of body?.states || []) {
          if (state?.key) favoriteStateByKey.set(state.key, state);
        }
      }
    } finally {
      refs.forEach(ref => favoriteRequests.delete(ref.key));
    }
  }

  function currentFeedUrl() {
    const endpoint = config.feedEndpoint || '/api/feeds/dharma.xml';
    const url = new URL(endpoint, location.origin);
    url.searchParams.set('corpus', config.corpus || location.pathname.match(/^\\/dharma\\/([^/]+)/)?.[1] || '');
    url.searchParams.set('scope', currentScope || 'all');
    if (searchQuery.trim()) url.searchParams.set('q', searchQuery.trim());
    if (starredOnly) url.searchParams.set('starred', '1');
    return url.href;
  }

  function updateSubscribeLinks() {
    const feedUrl = currentFeedUrl();
    document.querySelectorAll('[data-subscribe-target]').forEach(link => {
      if (link.dataset.subscribeTarget === 'overcast') {
        link.href = `overcast://x-callback-url/add?url=${encodeURIComponent(feedUrl)}`;
      }
      if (link.dataset.subscribeTarget === 'pocket') {
        link.href = `pktc://subscribe/${feedUrl.replace(/^https?:\\/\\//, '')}`;
      }
    });
    if (feedCopy) {
      const state = stateFor(currentScope);
      const count = activeTalks(state).length || Number(scopes[currentScope]?.count || 0);
      const noun = count === 1 ? 'recording' : 'recordings';
      feedCopy.textContent = `${count} ${noun} in this RSS feed.`;
    }
  }

  async function copyCurrentFeed(button) {
    const feedUrl = currentFeedUrl();
    try {
      await navigator.clipboard.writeText(feedUrl);
      if (copyStatus) copyStatus.textContent = button?.dataset?.copyMessage || 'RSS URL copied.';
    } catch (error) {
      if (copyStatus) copyStatus.textContent = feedUrl;
    }
  }

  function updateControls() {
    document.querySelectorAll('[data-scope]').forEach(button => {
      const selected = button.dataset.scope === currentScope;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (starredToggle) {
      starredToggle.classList.toggle('is-active', starredOnly);
      starredToggle.setAttribute('aria-pressed', String(starredOnly));
    }
    if (archiveSearch && archiveSearch.value !== searchQuery) {
      archiveSearch.value = searchQuery;
    }
    if (copyStatus) copyStatus.textContent = '';
    updateSubscribeLinks();
  }

  function writeUrl({ replace = true } = {}) {
    const url = new URL(location.href);
    if (currentScope && currentScope !== (config.defaultScope || 'all')) {
      url.searchParams.set('scope', currentScope);
    } else {
      url.searchParams.delete('scope');
    }
    if (searchQuery.trim()) {
      url.searchParams.set('q', searchQuery.trim());
    } else {
      url.searchParams.delete('q');
    }
    if (starredOnly) {
      url.searchParams.set('starred', '1');
    } else {
      url.searchParams.delete('starred');
    }
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  archiveSearch?.addEventListener('input', () => {
    searchQuery = archiveSearch.value || '';
    writeUrl({ replace: true });
    loadTalkArchive(currentScope);
  });

  document.querySelectorAll('[data-scope]').forEach(button => {
    button.addEventListener('click', () => {
      if (!scopes[button.dataset.scope]) return;
      currentScope = button.dataset.scope;
      writeUrl({ replace: false });
      loadTalkArchive(currentScope);
    });
  });

  starredToggle?.addEventListener('click', () => {
    starredOnly = !starredOnly;
    writeUrl({ replace: false });
    loadTalkArchive(currentScope);
  });

  document.querySelectorAll('[data-copy-current-feed]').forEach(button => {
    button.addEventListener('click', () => copyCurrentFeed(button));
  });

  window.addEventListener('popstate', () => {
    const state = initialStateFromUrl();
    currentScope = state.scope;
    searchQuery = state.query;
    starredOnly = state.starred;
    loadTalkArchive(currentScope);
  });

  window.addEventListener('favorites:changed', event => {
    const state = event.detail?.state;
    if (event.detail?.key && state) favoriteStateByKey.set(event.detail.key, state);
    if (starredOnly) loadTalkArchive(currentScope);
  });

  window.talkArchiveBrowser = {
    selectScope(key) {
      if (scopes[key]) {
        loadTalkArchive(key);
      }
    },
  };

  document.addEventListener('play', event => {
    if (event.target instanceof HTMLAudioElement) {
      document.querySelectorAll('audio').forEach(player => {
        if (player !== event.target) player.pause();
      });
    }
  }, true);

  const initial = initialStateFromUrl();
  currentScope = initial.scope;
  searchQuery = initial.query;
  starredOnly = initial.starred;
  updateControls();
  if (archiveSearch) archiveSearch.value = searchQuery;

  if (currentScope) {
    loadTalkArchive(currentScope);
  } else if (talkLoader) {
    talkLoader.textContent = 'No recordings are available yet.';
  }
})();
"""


def talk_seek_script() -> str:
    return """  <script>
    const audio = document.getElementById('audio');
    function seekFromLocation() {
      if (!audio) return;
      const value = new URLSearchParams(location.search).get('t');
      const seconds = Number(value || 0);
      if (Number.isFinite(seconds) && seconds > 0) {
        audio.currentTime = seconds;
      }
    }
    document.querySelectorAll('[data-start]').forEach(link => {
      link.addEventListener('click', event => {
        if (!audio) return;
        event.preventDefault();
        const seconds = Number(link.dataset.start || 0);
        history.replaceState(null, '', '?t=' + Math.round(seconds));
        audio.currentTime = seconds;
        audio.play().catch(() => {});
      });
    });
    audio?.addEventListener('loadedmetadata', seekFromLocation, { once: true });
  </script>"""


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
    canonical_url = talk.canonical_url or urllib.parse.urljoin(
        str(site["base_url"]), f"talks/{safe_id(talk.id)}/"
    )
    page_title = f"{talk.title} - {site['title']}"
    social_description = " ".join(str(description).split())
    social_image_url = absolute_media_url(site, image_url)
    social_image_meta = (
        f"""  <meta property="og:image" content="{_escape(social_image_url)}">
  <meta property="og:image:secure_url" content="{_escape(social_image_url)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1024">
  <meta property="og:image:height" content="1024">
  <meta name="twitter:image" content="{_escape(social_image_url)}">"""
        if social_image_url
        else ""
    )
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
  <title>{_escape(page_title)}</title>
  <link rel="canonical" href="{_escape(canonical_url)}">
  <meta name="description" content="{_escape(social_description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="{_escape(site["title"])}">
  <meta property="og:title" content="{_escape(talk.title)}">
  <meta property="og:description" content="{_escape(social_description)}">
  <meta property="og:url" content="{_escape(canonical_url)}">
{social_image_meta}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{_escape(talk.title)}">
  <meta name="twitter:description" content="{_escape(social_description)}">
  <link rel="stylesheet" href="../../talk-page.css">
</head>
<body>
  <main>
    <a class="back" href="../../">{_escape(site["title"])}</a>
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
    <div class="primary-player">
      <audio id="audio" controls preload="none" src="{_escape(talk.audio_url)}"></audio>
      <a class="download-link" href="{_escape(talk.audio_url)}" download>Download MP3</a>
    </div>
    {chapters_section}
    <section>
      <h2>Source</h2>
      <p><a href="{_escape(talk.link)}">Original talk page</a></p>
    </section>
  </main>
{talk_seek_script()}
  <script src="/js/admin-presence.js?v=2"></script>
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


def absolute_media_url(site: Dict, url: str | None) -> str | None:
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme and parsed.netloc:
        return url
    return urllib.parse.urljoin(str(site.get("base_url") or ""), url)


def _escape(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
