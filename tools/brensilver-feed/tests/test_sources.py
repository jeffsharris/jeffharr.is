import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from brensilver.build import apply_site_image, is_guided_practice, split_talks_for_feeds
from brensilver.metadata import enrich_talks, write_episode_media
from brensilver.models import Talk
from brensilver.rss import build_rss
from brensilver.rss import merge_talks
from brensilver.sources.audiodharma import parse_audiodharma_listing
from brensilver.sources.dharmaseed import parse_dharmaseed_feed


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
                    "listing_url": "https://www.audiodharma.org/speakers/231",
                },
            )
        )
        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].id, "audiodharma:24555")
        self.assertEqual(talks[0].duration, "16:01")
        self.assertEqual(talks[0].audio_type, "audio/mpeg")

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
          </channel>
        </rss>
        """
        talks = list(
            parse_dharmaseed_feed(
                xml,
                {
                    "name": "Dharma Seed",
                    "feed_url": "https://dharmaseed.org/feeds/teacher/496/?max-entries=all",
                },
            )
        )
        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0].id, "dharmaseed:94445")
        self.assertEqual(talks[0].title, "Wise Intention")
        self.assertEqual(talks[0].audio_length, 58189947)

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
                    "listing_url": "https://www.audiodharma.org/speakers/231",
                },
            )
        )[0]
        data = talk.to_json_dict()
        self.assertEqual(data["transcript"]["status"], "pending")
        json.dumps(data)


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


class PodcastMetadataTests(unittest.TestCase):
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
            "https://jeffharr.is/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        )

        self.assertEqual(
            normalized.image_url,
            "https://jeffharr.is/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        )
        self.assertEqual(
            normalized.episode_image_url,
            "https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )

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
                site_base_url="https://jeffharr.is/brensilver/",
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
                "https://jeffharr.is/brensilver/talks/audiodharma-1/?t=12",
            )

            out_dir = root / "out"
            counts = write_episode_media([enriched], out_dir, corpus, copy_artwork=True)
            self.assertEqual(counts, {"chapters": 1, "artwork": 1})
            chapters = json.loads((out_dir / "chapters" / "audiodharma-1.json").read_text())
            self.assertEqual(chapters["chapters"][0]["startTime"], 12.4)
            self.assertEqual(chapters["chapters"][0]["title"], "Settling")
            self.assertTrue((out_dir / "artwork" / "audiodharma-1.jpg").exists())

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
            canonical_url="https://jeffharr.is/brensilver/talks/audiodharma-1/",
            podcast_description="A talk about practice.",
            episode_image_url="https://media.example/brensilver/artwork/audiodharma-1.jpg",
            chapters_url="https://media.example/brensilver/chapters/audiodharma-1.json",
        )
        xml = build_rss(
            [talk],
            {
                "title": "Feed",
                "base_url": "https://jeffharr.is/brensilver/",
                "feed_url": "https://jeffharr.is/brensilver/feed.xml",
                "description": "Merged talks.",
            },
        )
        root = ET.fromstring(xml)
        namespaces = {
            "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
            "podcast": "https://podcastindex.org/namespace/1.0",
        }
        item = root.find("./channel/item")
        self.assertIsNotNone(item)
        self.assertEqual(item.findtext("link"), "https://jeffharr.is/brensilver/talks/audiodharma-1/")
        self.assertIn("A talk about practice.", item.findtext("description"))
        self.assertEqual(
            item.find("itunes:image", namespaces).attrib["href"],
            "https://media.example/brensilver/artwork/audiodharma-1.jpg",
        )
        self.assertEqual(
            item.find("podcast:chapters", namespaces).attrib["type"],
            "application/json+chapters",
        )


if __name__ == "__main__":
    unittest.main()
