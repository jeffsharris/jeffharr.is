import tempfile
import unittest
from pathlib import Path

from dharma_feed.freshness import generated_feed_guids, latest_upstream_expectations


class FreshnessTests(unittest.TestCase):
    def test_latest_upstream_expectations_extracts_checked_sources(self):
        config = {
            "sources": [
                {
                    "type": "dharmaseed",
                    "name": "Dharma Seed",
                    "teacher_id": "496",
                    "feed_url": "https://example.test/dharmaseed.xml",
                },
                {
                    "type": "audiodharma",
                    "name": "AudioDharma",
                    "speaker": "Matthew Brensilver",
                    "listing_url": "https://example.test/audiodharma.html",
                },
                {
                    "type": "dharmaseed",
                    "name": "Dharma Seed",
                    "retreat_id": "6753",
                    "feed_url": "https://example.test/retreat.xml",
                },
            ]
        }
        fixtures = {
            "https://example.test/dharmaseed.xml": """<?xml version="1.0"?>
            <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
              <channel>
                <item>
                  <title>Matthew Brensilver: Older</title>
                  <link>https://dharmaseed.org/talks/1/</link>
                  <pubDate>Wed, 03 Jun 2026 09:55:48 +0000</pubDate>
                  <enclosure url="https://example.test/1.mp3" type="audio/mpeg" />
                  <itunes:author>Matthew Brensilver</itunes:author>
                </item>
                <item>
                  <title>Matthew Brensilver: Latest Dharma Seed</title>
                  <link>https://dharmaseed.org/talks/2/</link>
                  <pubDate>Fri, 05 Jun 2026 09:44:01 +0000</pubDate>
                  <enclosure url="https://example.test/2.mp3" type="audio/mpeg" />
                  <itunes:author>Matthew Brensilver</itunes:author>
                </item>
              </channel>
            </rss>""",
            "https://example.test/audiodharma.html": """
            <table>
              <tr>
                <td><a href="/talks/10">Older AudioDharma</a></td>
                <td class="d-none d-md-table-cell playable-table-date">2026.05.20</td>
                <td class="d-none d-md-table-cell">10:00</td>
                <td>
                  <a class="js-audio-select"
                     data-url="https://example.test/10.mp3"
                     data-speakers="Matthew Brensilver"
                     data-title="Older AudioDharma"
                     data-id="10"></a>
                </td>
              </tr>
              <tr>
                <td><a href="/talks/11">Latest AudioDharma</a></td>
                <td class="d-none d-md-table-cell playable-table-date">2026.05.27</td>
                <td class="d-none d-md-table-cell">41:48</td>
                <td>
                  <a class="js-audio-select"
                     data-url="https://example.test/11.mp3"
                     data-speakers="Matthew Brensilver"
                     data-title="Latest AudioDharma"
                     data-id="11"></a>
                </td>
              </tr>
            </table>""",
        }

        expectations = latest_upstream_expectations(config, fixtures.__getitem__)

        self.assertEqual(
            [(expectation.source, expectation.id) for expectation in expectations],
            [("Dharma Seed", "dharmaseed:2"), ("AudioDharma", "audiodharma:11")],
        )

    def test_generated_feed_guids_reads_main_and_guided_feeds(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            out_dir = Path(raw_dir)
            (out_dir / "feed.xml").write_text(
                """<rss><channel><item><guid>dharmaseed:2</guid></item></channel></rss>""",
                encoding="utf-8",
            )
            (out_dir / "guided-feed.xml").write_text(
                """<rss><channel><item><guid>audiodharma:11</guid></item></channel></rss>""",
                encoding="utf-8",
            )

            self.assertEqual(
                generated_feed_guids(out_dir),
                {"dharmaseed:2", "audiodharma:11"},
            )


if __name__ == "__main__":
    unittest.main()
