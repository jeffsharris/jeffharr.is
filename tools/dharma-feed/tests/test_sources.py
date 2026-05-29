import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from dharma_feed.artifacts import format_prune_report, plan_generated_artifact_prune
from dharma_feed.build import (
    apply_site_image,
    apply_source_metadata,
    archive_browser_js,
    is_guided_practice,
    load_talks_json,
    render_index,
    render_talk_page,
    split_talks_for_feeds,
)
from dharma_feed.metadata import enrich_talks, write_episode_media
from dharma_feed.models import PodcastChapter, Talk
from dharma_feed.rss import build_rss
from dharma_feed.rss import merge_talks
from dharma_feed.sources.audiodharma import parse_audiodharma_listing
from dharma_feed.sources.dharmaseed import parse_dharmaseed_feed, parse_dharmaseed_player
from dharma_feed.sources.podcast_rss import parse_podcast_rss_feed


class SourceParsingTests(unittest.TestCase):
    def test_audiodharma_listing_parser_extracts_audio_rows(self):
        html = """
        <table>
          <tr>
            <td class="playable-table-name"><a href="/talks/24555">Anatta</a></td>
            <td class="playable-table-speaker"><a href="/speakers/231">Matthew Brensilver</a></td>
            <td class="d-none d-md-table-cell playable-table-date">2026.01.07</td>
            <td class="d-none d-md-table-cell">16:01</td>
            <td>
              <a class="js-audio-select"
                 data-download-url="/talks/24555/download"
                 data-url="https://example.test/talk.mp3"
                 data-speakers="Matthew Brensilver"
                 data-title="Anatta"
                 data-type="audio/mp3"
                 data-id="24555"
                 href="#"></a>
            </td>
          </tr>
        </table>
        """
        talks = list(
            parse_audiodharma_listing(
                html,
                {
                    "name": "AudioDharma",
                    "speaker": "Matthew Brensilver",
                    "listing_url": "https://www.audiodharma.org/speakers/231",
                },
            )
        )
        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].id, "audiodharma:24555")
        self.assertEqual(talks[0].duration, "16:01")
        self.assertEqual(talks[0].audio_type, "audio/mpeg")
        self.assertIsNone(talks[0].image_url)

    def test_dharmaseed_feed_parser_extracts_items(self):
        xml = """<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
          <channel>
            <itunes:image href="https://example.test/image.png" />
            <item>
              <title>Matthew Brensilver: Wise Intention</title>
              <link>https://dharmaseed.org/talks/94445/</link>
              <description>(Spirit Rock Meditation Center)</description>
              <pubDate>Mon, 22 Dec 2025 06:30:00 +0000</pubDate>
              <guid isPermaLink="false">wise.mp3</guid>
              <enclosure length="58189947" type="audio/mpeg" url="https://dharmaseed.org//talks/94445/wise.mp3?rss=" />
              <itunes:author>Matthew Brensilver</itunes:author>
              <itunes:duration>1:36:52</itunes:duration>
            </item>
            <item>
              <title>Other Teacher: Retreat Instructions</title>
              <link>https://dharmaseed.org/talks/94446/</link>
              <description>(Spirit Rock Meditation Center)</description>
              <pubDate>Mon, 22 Dec 2025 07:30:00 +0000</pubDate>
              <guid isPermaLink="false">other.mp3</guid>
              <enclosure length="1234" type="audio/mpeg" url="https://example.test/other.mp3" />
              <itunes:author>Other Teacher</itunes:author>
              <itunes:duration>10:00</itunes:duration>
            </item>
          </channel>
        </rss>
        """
        talks = list(
            parse_dharmaseed_feed(
                xml,
                {
                    "name": "Dharma Seed",
                    "feed_url": "https://dharmaseed.org/feeds/teacher/496/?max-entries=all",
                    "access_key": "private-key",
                    "include_speakers": ["Matthew Brensilver"],
                },
            )
        )
        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].id, "dharmaseed:94445")
        self.assertEqual(talks[0].title, "Wise Intention")
        self.assertEqual(talks[0].audio_length, 58189947)
        self.assertEqual(talks[0].image_url, "https://example.test/image.png")
        self.assertEqual(talks[0].venue, "Spirit Rock Meditation Center")
        self.assertIn("access_key=private-key", talks[0].link)
        self.assertIn("access_key=private-key", talks[0].audio_url)

    def test_dharmaseed_feed_parser_strips_current_speaker_prefix(self):
        xml = """<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
          <channel>
            <item>
              <title>Rob Burbea: True to Your Deepest Desires</title>
              <link>https://dharmaseed.org/talks/12345/</link>
              <description>(Gaia House)</description>
              <pubDate>Mon, 01 Jan 2024 06:30:00 +0000</pubDate>
              <enclosure length="12345" type="audio/mpeg" url="https://dharmaseed.org/talks/12345/talk.mp3?rss=" />
              <itunes:author>Rob Burbea</itunes:author>
              <itunes:duration>1:00:00</itunes:duration>
            </item>
          </channel>
        </rss>
        """
        talks = list(
            parse_dharmaseed_feed(
                xml,
                {
                    "name": "Dharma Seed",
                    "feed_url": "https://www.dharmaseed.org/feeds/teacher_all/210/",
                },
            )
        )

        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].speaker, "Rob Burbea")
        self.assertEqual(talks[0].title, "True to Your Deepest Desires")

    def test_dharmaseed_private_player_parser_extracts_access_key_audio(self):
        html = """
        <html>
          <head><title>Matthew Brensilver : Dharma Talk (Retreat at Spirit Rock)</title></head>
          <body>
            <script>
              var playlist = [{
                mp3: '/talks/96948/20260504-Matthew_Brensilver-SR-dharma_talk_retreat_at_spirit_rock-96948.mp3?access_key=private-key',
                title: '47:22 Dharma Talk (Retreat at Spirit Rock)',
                time: '47:22',
                date: '2026-05-04',
                artist: 'Matthew Brensilver',
                venue: 'Spirit Rock Meditation Center',
                retreat: ': Spring Insight Retreat 2026',
                thumb: 'https://media.dharmaseed.org/uploads/photos/teacher_496_125_0.png'
              }];
            </script>
          </body>
        </html>
        """

        talk = parse_dharmaseed_player(
            html,
            {"name": "Dharma Seed", "audio_length": 12345},
            "https://dharmaseed.org/talks/player/96948.html?access_key=private-key",
        )

        self.assertIsNotNone(talk)
        assert talk is not None
        self.assertEqual(talk.id, "dharmaseed:96948")
        self.assertEqual(talk.title, "Dharma Talk (Retreat at Spirit Rock)")
        self.assertEqual(talk.duration, "47:22")
        self.assertEqual(talk.published_at.date().isoformat(), "2026-05-04")
        self.assertEqual(
            talk.image_url,
            "https://media.dharmaseed.org/uploads/photos/teacher_496_125_0.png",
        )
        self.assertEqual(talk.venue, "Spirit Rock Meditation Center")
        self.assertIn("access_key=private-key", talk.audio_url)

    def test_json_shape_contains_transcript_placeholder(self):
        html = """
        <tr>
          <td><a href="/talks/1">Talk</a></td>
          <td></td>
          <td class="d-none d-md-table-cell playable-table-date">2026.01.01</td>
          <td class="d-none d-md-table-cell">10:00</td>
          <td><a class="js-audio-select" data-url="https://example.test/1.mp3" data-title="Talk" data-id="1"></a></td>
        </tr>
        """
        talk = list(
            parse_audiodharma_listing(
                html,
                {
                    "name": "AudioDharma",
                    "speaker": "Matthew Brensilver",
                    "listing_url": "https://www.audiodharma.org/speakers/231",
                },
            )
        )[0]
        data = talk.to_json_dict()
        self.assertEqual(data["transcript"]["status"], "pending")
        json.dumps(data)

    def test_podcast_rss_parser_extracts_and_cleans_archive_titles(self):
        xml = """<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
          <channel>
            <itunes:image href="https://example.test/show.jpg" />
            <item>
              <title>BB0527_01 Intro to Way Beyond the West</title>
              <link>https://drive.google.com/uc?export=download&amp;id=abc123</link>
              <pubDate>Fri, 06 Nov 1959 00:00:00 GMT</pubDate>
              <description>Intro to Way Beyond the West</description>
              <enclosure url="https://drive.google.com/uc?export=download&amp;id=abc123" length="28495314" type="audio/mpeg" />
              <guid>https://drive.google.com/uc?export=download&amp;id=abc123</guid>
              <itunes:duration>29:40</itunes:duration>
            </item>
          </channel>
        </rss>
        """
        [talk] = list(
            parse_podcast_rss_feed(
                xml,
                {
                    "name": "KPFA Archive",
                    "id_prefix": "watts",
                    "speaker": "Alan Watts",
                    "archive_id_regex": r"^([A-Z]{2}\d{4}[A-Za-z]?(?:_\d+)?)\s+",
                    "strip_title_prefix": True,
                },
            )
        )

        self.assertEqual(talk.id, "watts:bb0527-01")
        self.assertEqual(talk.title, "Intro to Way Beyond the West")
        self.assertEqual(talk.speaker, "Alan Watts")
        self.assertEqual(talk.source, "KPFA Archive")
        self.assertEqual(talk.duration, "29:40")
        self.assertEqual(talk.published_at.date().isoformat(), "1959-11-06")
        self.assertEqual(talk.image_url, "https://example.test/show.jpg")

    def test_podcast_rss_parser_filters_speakers_and_extracts_link_id(self):
        xml = """<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
          <channel>
            <item>
              <title>Opening Session</title>
              <link>https://irc.audiodharma.org/talks/23112</link>
              <pubDate>Sat, 31 May 2025 20:16:11 -0700</pubDate>
              <description>Retreat opening session.</description>
              <enclosure url="https://example.test/23112.mp3" length="3461" type="audio/mp3" />
              <itunes:author>Matthew Brensilver</itunes:author>
              <itunes:duration>57:41</itunes:duration>
            </item>
            <item>
              <title>Other Teacher</title>
              <link>https://irc.audiodharma.org/talks/23113</link>
              <pubDate>Sat, 31 May 2025 21:16:11 -0700</pubDate>
              <enclosure url="https://example.test/23113.mp3" length="3000" type="audio/mp3" />
              <itunes:author>Other Teacher</itunes:author>
              <itunes:duration>50:00</itunes:duration>
            </item>
          </channel>
        </rss>
        """
        talks = list(
            parse_podcast_rss_feed(
                xml,
                {
                    "name": "AudioDharma",
                    "id_prefix": "audiodharma",
                    "source_id_regex": "/talks/(\\d+)",
                    "include_speakers": ["Matthew Brensilver"],
                },
            )
        )

        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].id, "audiodharma:23112")
        self.assertEqual(talks[0].audio_type, "audio/mp3")
        self.assertEqual(talks[0].duration, "57:41")


class MergeTests(unittest.TestCase):
    def test_merge_prefers_dharmaseed_for_same_date_and_title(self):
        html = """
        <tr>
          <td><a href="/talks/1">Wise Intention</a></td>
          <td></td>
          <td class="d-none d-md-table-cell playable-table-date">2025.12.22</td>
          <td class="d-none d-md-table-cell">10:00</td>
          <td><a class="js-audio-select" data-url="https://example.test/1.mp3" data-title="Wise Intention" data-id="1"></a></td>
        </tr>
        """
        audio = list(
            parse_audiodharma_listing(
                html,
                {
                    "name": "AudioDharma",
                    "speaker": "Matthew Brensilver",
                    "listing_url": "https://www.audiodharma.org/speakers/231",
                },
            )
        )[0]
        seed_xml = """<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
          <channel><item>
            <title>Matthew Brensilver: Wise Intention</title>
            <link>https://dharmaseed.org/talks/94445/</link>
            <pubDate>Mon, 22 Dec 2025 06:30:00 +0000</pubDate>
            <enclosure length="1" type="audio/mpeg" url="https://example.test/seed.mp3" />
          </item></channel>
        </rss>
        """
        seed = list(parse_dharmaseed_feed(seed_xml, {"name": "Dharma Seed"}))[0]
        merged = merge_talks([audio, seed])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].source, "Dharma Seed")

    def test_merge_preserves_seed_metadata_for_live_duplicate_id(self):
        live = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Updated Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://dharmaseed.org/talks/1/",
            audio_url="https://example.test/live.mp3",
        )
        seed = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://dharmaseed.org/talks/1/",
            audio_url="https://example.test/seed.mp3",
            canonical_url="https://jeffharr.is/dharma/brensilver/talks/dharmaseed-1/",
            podcast_description="A preserved generated description.",
            episode_image_url="https://media.example/artwork/dharmaseed-1.jpg",
            chapters_url="https://media.example/chapters/dharmaseed-1.json",
            chapters=[PodcastChapter(start=10, title="Opening")],
            venue="Spirit Rock Meditation Center",
        )

        [merged] = merge_talks([live, seed])

        self.assertEqual(merged.title, "Updated Practice")
        self.assertEqual(merged.audio_url, "https://example.test/live.mp3")
        self.assertEqual(merged.podcast_description, "A preserved generated description.")
        self.assertEqual(merged.episode_image_url, "https://media.example/artwork/dharmaseed-1.jpg")
        self.assertEqual(merged.chapters[0].title, "Opening")
        self.assertEqual(merged.venue, "Spirit Rock Meditation Center")

    def test_merge_prefers_access_key_audio_url_for_same_id(self):
        public = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://dharmaseed.org/talks/1/",
            audio_url="https://dharmaseed.org/talks/1/practice.mp3?rss=",
        )
        private = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://dharmaseed.org/talks/1/?access_key=private-key",
            audio_url="https://dharmaseed.org/talks/1/practice.mp3?rss=&access_key=private-key",
        )

        [merged] = merge_talks([public, private])

        self.assertIn("access_key=private-key", merged.link)
        self.assertIn("access_key=private-key", merged.audio_url)


class PodcastMetadataTests(unittest.TestCase):
    def test_landing_page_includes_archive_search(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
        )

        html = render_index(
            {
                "site": {
                    "title": "Matthew Brensilver Dharma Talks",
                    "base_url": "https://jeffharr.is/dharma/brensilver/",
                    "feed_url": "https://jeffharr.is/dharma/brensilver/feed.xml",
                    "description": "Merged talks.",
                    "image_url": "https://jeffharr.is/dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
                }
            },
            [talk],
            [talk],
            [],
            None,
        )

        self.assertIn('id="archive-search"', html)
        self.assertIn('type="search"', html)
        self.assertIn('placeholder="Search"', html)
        self.assertIn("Search titles, descriptions, chapters", html)
        self.assertIn('data-mobile-placeholder="Search"', html)
        self.assertIn('id="archive-search-status"', html)
        self.assertIn(
            '<link rel="apple-touch-icon" sizes="180x180" href="/dharma/brensilver/apple-touch-icon.png">',
            html,
        )
        self.assertIn(
            '<meta name="apple-mobile-web-app-title" content="Matthew Brensilver">',
            html,
        )

    def test_landing_page_embeds_compact_filter_pills_when_guided_feed_exists(self):
        dharma_talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
        )
        guided_talk = Talk(
            id="audiodharma:2",
            source="AudioDharma",
            source_id="2",
            title="Guided Meditation",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            link="https://example.test/guided",
            audio_url="https://example.test/guided.mp3",
        )

        html = render_index(
            {
                "site": {
                    "title": "Matthew Brensilver Dharma Talks",
                    "base_url": "https://jeffharr.is/dharma/brensilver/",
                    "feed_url": "https://jeffharr.is/dharma/brensilver/feed.xml",
                    "description": "Merged talks.",
                    "guided_title": "Matthew Brensilver Guided Meditations",
                    "guided_feed_url": "https://jeffharr.is/dharma/brensilver/guided-feed.xml",
                }
            },
            [dharma_talk, guided_talk],
            [dharma_talk],
            [guided_talk],
            {"title": "Matthew Brensilver Guided Meditations"},
        )

        self.assertIn('"defaultScope": "dharma"', html)
        self.assertIn('data-scope-option="dharma">Talks</button>', html)
        self.assertIn('data-scope-option="guided">Guided</button>', html)
        self.assertNotIn("data-starred-toggle", html)
        self.assertNotIn("<strong>1</strong>", html)

    def test_archive_browser_searches_chapter_text(self):
        js = archive_browser_js()

        self.assertIn("chapterSearchText", js)
        self.assertIn("talk.chapters", js)
        self.assertIn("No recordings match this search.", js)

    def test_archive_browser_keeps_at_least_one_scope_selected(self):
        js = archive_browser_js()

        self.assertIn("function toggleScopeOption(option)", js)
        self.assertIn("if (selected.size === 1) return false;", js)
        self.assertIn("if (keys.length === selectableScopeKeys.length && scopes.all) return 'all';", js)

    def test_archive_browser_revalidates_talk_json(self):
        js = archive_browser_js()

        self.assertIn("fetch(scope.url, { cache: 'no-cache' })", js)

    def test_archive_browser_uses_short_mobile_search_placeholder(self):
        js = archive_browser_js()

        self.assertIn("function updateSearchPlaceholder()", js)
        self.assertIn("window.matchMedia('(max-width: 640px)')", js)
        self.assertIn("archiveSearch.dataset.mobilePlaceholder || 'Search'", js)

    def test_site_image_becomes_talk_fallback_image(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
            image_url="https://example.test/source-speaker.jpg",
            episode_image_url="https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )

        [normalized] = apply_site_image(
            [talk],
            "https://jeffharr.is/dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        )

        self.assertEqual(
            normalized.image_url,
            "https://jeffharr.is/dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        )
        self.assertEqual(
            normalized.episode_image_url,
            "https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )

    def test_source_metadata_derives_venue_from_description(self):
        talk = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Brian Lesage, Matthew Brensilver: Practice (Retreat at Spirit Rock)",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
            description="(Spirit Rock Meditation Center)",
        )

        [normalized] = apply_source_metadata([talk])

        self.assertEqual(normalized.venue, "Spirit Rock Meditation Center")
        self.assertEqual(normalized.series, "Retreat at Spirit Rock")
        self.assertEqual(normalized.co_teachers, ["Brian Lesage"])

    def test_seed_talk_json_preserves_enriched_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "talks.json"
            path.write_text(
                json.dumps(
                    [
                        {
                            "id": "dharmaseed:1",
                            "source": "Dharma Seed",
                            "source_id": "1",
                            "title": "Practice",
                            "speaker": "Matthew Brensilver",
                            "published_at": "2026-01-01T00:00:00+00:00",
                            "link": "https://example.test/source",
                            "audio_url": "https://example.test/audio.mp3",
                            "canonical_url": "https://jeffharr.is/dharma/brensilver/talks/dharmaseed-1/",
                            "podcast_description": "A preserved description.",
                            "short_summary": "Preserved.",
                            "episode_image_url": "https://media.example/artwork/dharmaseed-1.jpg",
                            "chapters_url": "https://media.example/chapters/dharmaseed-1.json",
                            "chapters": [
                                {
                                    "start": 12.5,
                                    "title": "Opening",
                                    "description": "Settling in.",
                                    "url": "https://example.test?t=12",
                                }
                            ],
                            "venue": "Spirit Rock Meditation Center",
                            "series": "Retreat at Spirit Rock",
                            "co_teachers": ["Sylvia Boorstein"],
                            "transcript": {
                                "status": "ready",
                                "url": "https://example.test/transcript.json",
                                "text_path": "transcripts/dharmaseed-1.md",
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            [talk] = load_talks_json(path)

            self.assertEqual(talk.podcast_description, "A preserved description.")
            self.assertEqual(talk.episode_image_url, "https://media.example/artwork/dharmaseed-1.jpg")
            self.assertEqual(talk.chapters[0].start, 12.5)
            self.assertEqual(talk.chapters[0].title, "Opening")
            self.assertEqual(talk.venue, "Spirit Rock Meditation Center")
            self.assertEqual(talk.series, "Retreat at Spirit Rock")
            self.assertEqual(talk.co_teachers, ["Sylvia Boorstein"])
            self.assertEqual(talk.transcript.status, "ready")

    def test_guided_practice_feed_classifier(self):
        base = {
            "id": "audiodharma:1",
            "source": "AudioDharma",
            "source_id": "1",
            "speaker": "Matthew Brensilver",
            "published_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "link": "https://example.test/source",
            "audio_url": "https://example.test/audio.mp3",
        }
        guided_titles = [
            "Guided Meditation: Breath",
            "Lightly Guided Meditation",
            "Guded Meditation (Day 2): Breath",
            "Day 1: Instructions and Guided Meditation",
            "Thursday Guided Meditation",
            "Morning Instructions",
            "Sitting with Instructions",
            "Matthew Brensilver: Day 2: Morning Practice Session",
            "Walking Meditation",
            "Metta Practice",
        ]
        dharma_titles = [
            "Dharmette: Meditation is so many things",
            "Monday Night Meditation Talk",
            "Dharma Practice and the Cultivation of Power",
            "Practice Questions",
            "True to Your Deepest Desires (Talk and Short Guided Meditation)",
        ]

        for title in guided_titles:
            self.assertTrue(is_guided_practice(Talk(title=title, **base)), title)
        for title in dharma_titles:
            self.assertFalse(is_guided_practice(Talk(title=title, **base)), title)

    def test_split_talks_for_feeds(self):
        base = {
            "source": "AudioDharma",
            "source_id": "1",
            "speaker": "Matthew Brensilver",
            "published_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "link": "https://example.test/source",
            "audio_url": "https://example.test/audio.mp3",
        }
        talks = [
            Talk(id="talk", title="The Dharma of Practice", **base),
            Talk(id="guided", title="Guided Meditation: Breath", **base),
        ]

        dharma, guided = split_talks_for_feeds(talks)

        self.assertEqual([talk.id for talk in dharma], ["talk"])
        self.assertEqual([talk.id for talk in guided], ["guided"])

    def test_metadata_enrichment_writes_chapters_and_episode_artwork(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus = root / "corpus"
            (corpus / "episode-metadata").mkdir(parents=True)
            (corpus / "artwork" / "images").mkdir(parents=True)
            (corpus / "episode-metadata" / "audiodharma-1.json").write_text(
                json.dumps(
                    {
                        "description": "A talk about practice.",
                        "short_summary": "Practice talk.",
                        "chapters": [
                            {
                                "start": 12.4,
                                "title": "Settling",
                                "description": "The opening movement.",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (corpus / "artwork" / "images" / "audiodharma-1.jpg").write_bytes(b"jpg")
            talk = Talk(
                id="audiodharma:1",
                source="AudioDharma",
                source_id="1",
                title="Practice",
                speaker="Matthew Brensilver",
                published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                link="https://example.test/source",
                audio_url="https://example.test/audio.mp3",
            )

            enriched = enrich_talks(
                [talk],
                corpus_dir=corpus,
                media_base_url="https://media.example/brensilver",
                site_base_url="https://jeffharr.is/dharma/brensilver/",
            )[0]
            self.assertEqual(enriched.podcast_description, "A talk about practice.")
            self.assertEqual(
                enriched.episode_image_url,
                "https://media.example/brensilver/artwork/audiodharma-1.jpg",
            )
            self.assertEqual(
                enriched.chapters_url,
                "https://media.example/brensilver/chapters/audiodharma-1.json",
            )
            self.assertEqual(
                enriched.chapters[0].url,
                "https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/?t=12",
            )

            out_dir = root / "out"
            counts = write_episode_media([enriched], out_dir, corpus, copy_artwork=True)
            self.assertEqual(counts, {"chapters": 1, "artwork": 1})
            chapters = json.loads((out_dir / "chapters" / "audiodharma-1.json").read_text())
            self.assertEqual(chapters["chapters"][0]["startTime"], 12.4)
            self.assertEqual(chapters["chapters"][0]["title"], "Settling")
            self.assertTrue((out_dir / "artwork" / "audiodharma-1.jpg").exists())

    def test_metadata_enrichment_can_split_artwork_and_chapter_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus = root / "corpus"
            (corpus / "episode-metadata").mkdir(parents=True)
            (corpus / "artwork" / "images").mkdir(parents=True)
            (corpus / "episode-metadata" / "audiodharma-1.json").write_text(
                json.dumps(
                    {
                        "chapters": [
                            {
                                "start": 0,
                                "title": "Opening",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (corpus / "artwork" / "images" / "audiodharma-1.jpg").write_bytes(b"jpg")
            talk = Talk(
                id="audiodharma:1",
                source="AudioDharma",
                source_id="1",
                title="Practice",
                speaker="Matthew Brensilver",
                published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                link="https://example.test/source",
                audio_url="https://example.test/audio.mp3",
            )

            enriched = enrich_talks(
                [talk],
                corpus_dir=corpus,
                site_base_url="https://jeffharr.is/dharma/brensilver/",
                artwork_base_url="https://media.jeffharr.is/brensilver/",
                chapters_base_url="https://jeffharr.is/dharma/brensilver/",
            )[0]

            self.assertEqual(
                enriched.episode_image_url,
                "https://media.jeffharr.is/brensilver/artwork/audiodharma-1.jpg",
            )
            self.assertEqual(
                enriched.chapters_url,
                "https://jeffharr.is/dharma/brensilver/chapters/audiodharma-1.json",
            )

    def test_generated_artifact_prune_report_is_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "out"
            (out_dir / "talks" / "audiodharma-1").mkdir(parents=True)
            (out_dir / "talks" / "audiodharma-1" / "index.html").write_text("keep")
            (out_dir / "talks" / "audiodharma-2").mkdir(parents=True)
            (out_dir / "talks" / "audiodharma-2" / "index.html").write_text("stale")
            (out_dir / "chapters").mkdir()
            (out_dir / "chapters" / "audiodharma-1.json").write_text("{}")
            (out_dir / "chapters" / "audiodharma-2.json").write_text("{}")
            (out_dir / "artwork").mkdir()
            (out_dir / "artwork" / "audiodharma-1.jpg").write_bytes(b"keep")
            (out_dir / "artwork" / "audiodharma-2.jpg").write_bytes(b"stale")
            (out_dir / "artwork" / "teacher-podcast-cover.jpg").write_bytes(b"protected")
            talk = Talk(
                id="audiodharma:1",
                source="AudioDharma",
                source_id="1",
                title="Practice",
                speaker="Matthew Brensilver",
                published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                link="https://example.test/source",
                audio_url="https://example.test/audio.mp3",
                episode_image_url="https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg",
                chapters=[
                    PodcastChapter(
                        start=0,
                        title="Opening",
                        url="https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/?t=0",
                    )
                ],
            )

            report = plan_generated_artifact_prune([talk], out_dir, copy_artwork=True)
            formatted = format_prune_report(report)

            self.assertEqual(
                [path.relative_to(out_dir).as_posix() for path in report.stale_talk_pages],
                ["talks/audiodharma-2/index.html"],
            )
            self.assertEqual(
                [path.relative_to(out_dir).as_posix() for path in report.stale_chapters],
                ["chapters/audiodharma-2.json"],
            )
            self.assertEqual(
                [path.relative_to(out_dir).as_posix() for path in report.stale_artwork],
                ["artwork/audiodharma-2.jpg"],
            )
            self.assertEqual(len(report.protected_artwork), 1)
            self.assertIn("stale talk pages: 1", formatted)
            self.assertTrue((out_dir / "talks" / "audiodharma-2" / "index.html").exists())

    def test_rss_includes_episode_metadata_tags(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
            canonical_url="https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/",
            podcast_description="A talk about practice.",
            venue="Spirit Rock Meditation Center",
            series="Retreat at Spirit Rock",
            co_teachers=["Sylvia Boorstein"],
            episode_image_url="https://media.example/brensilver/artwork/audiodharma-1.jpg",
            chapters_url="https://media.example/brensilver/chapters/audiodharma-1.json",
            chapters=[
                PodcastChapter(
                    start=121,
                    title="Wisdom from ordinariness",
                    url="https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/?t=121",
                )
            ],
        )
        xml = build_rss(
            [talk],
            {
                "title": "Feed",
                "base_url": "https://jeffharr.is/dharma/brensilver/",
                "feed_url": "https://jeffharr.is/dharma/brensilver/feed.xml",
                "description": "Merged talks.",
            },
        )
        root = ET.fromstring(xml)
        namespaces = {
            "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
            "media": "http://search.yahoo.com/mrss/",
            "podcast": "https://podcastindex.org/namespace/1.0",
        }
        item = root.find("./channel/item")
        self.assertIsNotNone(item)
        description = item.findtext("description")
        summary = item.findtext("itunes:summary", namespaces=namespaces)
        self.assertEqual(item.findtext("link"), "https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/")
        self.assertIn("A talk about practice.", description)
        self.assertIn("Location: Spirit Rock Meditation Center", description)
        self.assertIn("Additional teachers: Sylvia Boorstein", description)
        self.assertNotIn("Location: Spirit Rock Meditation Center (Retreat at Spirit Rock)", description)
        self.assertIn("Location: Spirit Rock Meditation Center", summary)
        self.assertIn("Additional teachers: Sylvia Boorstein", summary)
        self.assertNotIn("Location: Spirit Rock Meditation Center (Retreat at Spirit Rock)", summary)
        self.assertIn("02:01 Wisdom from ordinariness", description)
        self.assertNotIn("https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/?t=121", description)
        self.assertIn("02:01 Wisdom from ordinariness", summary)
        self.assertNotIn("https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/?t=121", summary)
        self.assertEqual(
            item.find("itunes:image", namespaces).attrib["href"],
            "https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )
        self.assertEqual(
            item.find("media:thumbnail", namespaces).attrib["url"],
            "https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )
        self.assertEqual(
            item.find("podcast:chapters", namespaces).attrib["type"],
            "application/json+chapters",
        )

    def test_talk_page_social_preview_uses_episode_artwork(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Practice & Release",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
            canonical_url="https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/",
            podcast_description="A talk about practice, release, and attention.",
            image_url="https://jeffharr.is/dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
            episode_image_url="https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg",
        )

        html = render_talk_page(
            {
                "site": {
                    "title": "Matthew Brensilver Dharma Talks",
                    "base_url": "https://jeffharr.is/dharma/brensilver/",
                    "description": "Merged talks.",
                }
            },
            talk,
        )

        self.assertIn(
            '<link rel="canonical" href="https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/">',
            html,
        )
        self.assertIn(
            '<meta property="og:image" content="https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg">',
            html,
        )
        self.assertIn(
            '<meta name="twitter:image" content="https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg">',
            html,
        )
        self.assertIn(
            '<link rel="apple-touch-icon" sizes="180x180" href="/dharma/brensilver/touch-icons/audiodharma-1.png">',
            html,
        )
        self.assertIn(
            '<meta name="apple-mobile-web-app-title" content="Practice &amp; Release">',
            html,
        )
        self.assertIn('<img class="art" src="/dharma/brensilver/artwork/audiodharma-1.jpg"', html)
        self.assertNotIn("MatthewBrensilver_small", html)

    def test_rss_summary_normalizes_source_venue_without_episode_metadata(self):
        talk = Talk(
            id="dharmaseed:1",
            source="Dharma Seed",
            source_id="1",
            title="Practice",
            speaker="Matthew Brensilver",
            published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            link="https://example.test/source",
            audio_url="https://example.test/audio.mp3",
            description="(Spirit Rock Meditation Center)",
            venue="Spirit Rock Meditation Center",
            series="Retreat at Spirit Rock",
        )
        xml = build_rss(
            [talk],
            {
                "title": "Feed",
                "base_url": "https://jeffharr.is/dharma/brensilver/",
                "feed_url": "https://jeffharr.is/dharma/brensilver/feed.xml",
                "description": "Merged talks.",
            },
        )
        root = ET.fromstring(xml)
        namespaces = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
        item = root.find("./channel/item")

        self.assertIn(
            "Location: Spirit Rock Meditation Center",
            item.findtext("description"),
        )
        self.assertEqual(
            item.findtext("itunes:summary", namespaces=namespaces),
            "Location: Spirit Rock Meditation Center. Source: Dharma Seed.",
        )


if __name__ == "__main__":
    unittest.main()
