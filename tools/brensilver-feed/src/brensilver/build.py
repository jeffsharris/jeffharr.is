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
    dharma_talks, guided_talks = split_talks_for_feeds(talks)
    feed_talks = dharma_talks[:max_items]
    guided_feed_talks = guided_talks[:max_items]
    guided_site = build_guided_site(config["site"])

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "feed.xml").write_text(build_rss(feed_talks, config["site"]), encoding="utf-8")
    (out_dir / "guided-feed.xml").write_text(
        build_rss(guided_feed_talks, guided_site),
        encoding="utf-8",
    )
    (out_dir / "talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in talks], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (out_dir / "dharma-talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in dharma_talks], indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    (out_dir / "guided-talks.json").write_text(
        json.dumps([talk.to_json_dict() for talk in guided_talks], indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    media_counts = write_episode_media(
        talks,
        out_dir=out_dir,
        corpus_dir=corpus_dir,
        copy_artwork=args.copy_artwork,
    )
    write_talk_pages(out_dir, config, talks)
    (out_dir / "index.html").write_text(
        render_index(config, talks, feed_talks, guided_feed_talks, guided_site),
        encoding="utf-8",
    )

    print(
        f"Wrote {len(feed_talks)} Dharma feed items and {len(guided_feed_talks)} guided feed items "
        f"from {len(talks)} total talks to {out_dir} "
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
    overcast_url = (
        "overcast://x-callback-url/add?url="
        + urllib.parse.quote(str(site["feed_url"]), safe="")
    )
    has_guided_feed = guided_site is not None
    feed_key = "dharma" if has_guided_feed else "main"
    feed_urls = {feed_key: site["feed_url"]}
    guided_alternate_link = ""
    main_feed_label = site.get("feed_label") or (
        "Dharma talks" if has_guided_feed else "Podcast feed"
    )
    main_feed_panel = render_subscribe_panel(
        key=feed_key,
        title=main_feed_label,
        count=len(feed_talks),
        feed_url=str(site["feed_url"]),
        feed_href="feed.xml",
        overcast_url=overcast_url,
        active=True,
    )
    guided_feed_panel = ""
    feed_switch = ""
    if guided_site:
        guided_overcast_url = (
            "overcast://x-callback-url/add?url="
            + urllib.parse.quote(str(guided_site["feed_url"]), safe="")
        )
        feed_urls["guided"] = guided_site["feed_url"]
        guided_alternate_link = (
            f'  <link rel="alternate" type="application/rss+xml" '
            f'title="{_escape(guided_site["title"])}" href="guided-feed.xml">\n'
        )
        guided_feed_panel = render_subscribe_panel(
            key="guided",
            title="Guided meditations",
            count=len(guided_feed_talks),
            feed_url=str(guided_site["feed_url"]),
            feed_href="guided-feed.xml",
            overcast_url=guided_overcast_url,
            active=False,
        )
        feed_switch = f"""      <div class="feed-switch" role="tablist" aria-label="Choose a podcast feed">
        <button class="feed-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="panel-{feed_key}" data-feed-tab="{feed_key}">
          <span>{_escape(main_feed_label)}</span>
          <strong>{len(feed_talks)}</strong>
        </button>
        <button class="feed-tab" type="button" role="tab" aria-selected="false" aria-controls="panel-guided" data-feed-tab="guided">
          <span>Guided meditations</span>
          <strong>{len(guided_feed_talks)}</strong>
        </button>
      </div>"""
    feed_urls_json = json.dumps(feed_urls)
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
    .subscribe {{
      border-top: 1px solid var(--line);
      padding-top: 30px;
    }}
    .feed-switch {{
      display: inline-grid;
      grid-template-columns: repeat(2, minmax(150px, 1fr));
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 72%, var(--bg));
      margin-bottom: 24px;
    }}
    .feed-tab {{
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
    .feed-tab strong {{
      color: inherit;
      font-size: 0.95rem;
    }}
    .feed-tab.is-active {{
      background: var(--accent-strong);
      color: #ffffff;
      box-shadow: 0 8px 22px var(--shadow);
    }}
    .feed-panel[hidden] {{
      display: none;
    }}
    .feed-panel {{
      max-width: 760px;
    }}
    .feed-count {{
      margin: 0 0 18px;
      color: var(--muted);
      font-weight: 700;
    }}
    .subscribe-grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(150px, 1fr));
      gap: 12px;
      margin: 20px 0 14px;
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
    .player-button.copy {{ background: var(--blue); }}
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
    code {{
      overflow-wrap: anywhere;
    }}
    @media (max-width: 880px) {{
      .hero {{ grid-template-columns: 1fr; gap: 26px; }}
      .portrait {{ justify-self: start; max-width: 240px; }}
      .subscribe-grid {{ grid-template-columns: repeat(2, minmax(140px, 1fr)); }}
    }}
    @media (max-width: 520px) {{
      main {{ padding: 34px 18px 56px; }}
      .feed-switch {{ display: grid; grid-template-columns: 1fr; width: 100%; }}
      .subscribe-grid {{ grid-template-columns: 1fr; }}
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
    <section class="subscribe">
{feed_switch}
{main_feed_panel}
{guided_feed_panel}
      <p id="copy-status" class="copy-status" aria-live="polite"></p>
    </section>
  </main>
  </div>
  <script>
    const feedUrls = {feed_urls_json};
    const status = document.getElementById('copy-status');
    function selectFeed(key) {{
      document.querySelectorAll('[data-feed-panel]').forEach(panel => {{
        panel.hidden = panel.dataset.feedPanel !== key;
      }});
      document.querySelectorAll('[data-feed-tab]').forEach(tab => {{
        const selected = tab.dataset.feedTab === key;
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-selected', String(selected));
      }});
      status.textContent = '';
    }}
    async function copyFeedUrl(key) {{
      const feedUrl = feedUrls[key] || feedUrls.dharma || feedUrls.main;
      try {{
        await navigator.clipboard.writeText(feedUrl);
        status.textContent = 'RSS URL copied.';
      }} catch (error) {{
        status.textContent = feedUrl;
      }}
    }}
    document.querySelectorAll('[data-copy-feed]').forEach(button => {{
      button.addEventListener('click', () => copyFeedUrl(button.dataset.copyFeed));
    }});
    document.querySelectorAll('[data-feed-tab]').forEach(button => {{
      button.addEventListener('click', () => selectFeed(button.dataset.feedTab));
    }});
  </script>
</body>
</html>
"""


def render_subscribe_panel(
    key: str,
    title: str,
    count: int,
    feed_url: str,
    feed_href: str,
    overcast_url: str,
    active: bool,
) -> str:
    hidden = "" if active else " hidden"
    noun = "episode" if count == 1 else "episodes"
    return f"""      <div class="feed-panel" id="panel-{_escape(key)}" data-feed-panel="{_escape(key)}"{hidden}>
        <h2>{_escape(title)}</h2>
        <p class="feed-count">{count} {noun}</p>
        <div class="subscribe-grid">
          <a class="player-button overcast" href="{_escape(overcast_url)}">
            <img src="https://cdn.simpleicons.org/overcast/FFFFFF?viewbox=auto" alt="">
            <span>Add to Overcast</span>
          </a>
          <button class="player-button copy" type="button" data-copy-feed="{_escape(key)}">
            <span>Copy RSS URL</span>
          </button>
          <a class="player-button rss" href="{_escape(feed_href)}">
            <img src="https://cdn.simpleicons.org/rss/FFFFFF?viewbox=auto" alt="">
            <span>Open RSS</span>
          </a>
        </div>
        <code class="feed-url">{_escape(feed_url)}</code>
      </div>"""


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
