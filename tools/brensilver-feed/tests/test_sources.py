import json
import unittest

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


if __name__ == "__main__":
    unittest.main()
