import tempfile
import unittest
from pathlib import Path

from dharma_feed.freshness import (
    feed_enrichment_issues,
    generated_feed_guids,
    latest_upstream_expectations,
)


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

    def test_feed_enrichment_issues_accepts_fully_enriched_feed_items(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            out_dir = Path(raw_dir)
            image_url = "https://example.test/dharma/brensilver/artwork/audiodharma-11.jpg"
            chapters_url = "https://example.test/dharma/brensilver/chapters/audiodharma-11.json"
            (out_dir / "feed.xml").write_text(
                f"""<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
                         xmlns:podcast="https://podcastindex.org/namespace/1.0">
                  <channel>
                    <item>
                      <title>Latest AudioDharma</title>
                      <guid>audiodharma:11</guid>
                      <itunes:image href="{image_url}" />
                      <podcast:chapters url="{chapters_url}" type="application/json+chapters" />
                    </item>
                  </channel>
                </rss>""",
                encoding="utf-8",
            )
            (out_dir / "talks.json").write_text(
                f"""[
                  {{
                    "id": "audiodharma:11",
                    "title": "Latest AudioDharma",
                    "podcast_description": "A generated episode description.",
                    "episode_image_url": "{image_url}",
                    "chapters_url": "{chapters_url}",
                    "chapters": [{{"start": 0, "title": "Beginning"}}]
                  }}
                ]""",
                encoding="utf-8",
            )
            (out_dir / "artwork").mkdir()
            (out_dir / "artwork" / "audiodharma-11.jpg").write_bytes(b"image")
            (out_dir / "chapters").mkdir()
            (out_dir / "chapters" / "audiodharma-11.json").write_text(
                """{"version":"1.2.0","chapters":[{"startTime":0,"title":"Beginning"}]}""",
                encoding="utf-8",
            )

            self.assertEqual(feed_enrichment_issues(out_dir), [])

    def test_feed_enrichment_issues_reports_feed_only_items(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            out_dir = Path(raw_dir)
            (out_dir / "feed.xml").write_text(
                """<rss><channel>
                  <item><title>Latest AudioDharma</title><guid>audiodharma:11</guid></item>
                </channel></rss>""",
                encoding="utf-8",
            )
            (out_dir / "talks.json").write_text(
                """[
                  {"id": "audiodharma:11", "title": "Latest AudioDharma"}
                ]""",
                encoding="utf-8",
            )

            issues = feed_enrichment_issues(out_dir)

            self.assertEqual(len(issues), 1)
            self.assertEqual(issues[0].id, "audiodharma:11")
            self.assertEqual(
                issues[0].missing_requirements,
                ("podcast_description", "episode_image_url", "chapters_url", "chapters"),
            )

    def test_feed_enrichment_issues_reports_stale_rss_media_tags(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            out_dir = Path(raw_dir)
            image_url = "https://example.test/dharma/brensilver/artwork/audiodharma-11.jpg"
            chapters_url = "https://example.test/dharma/brensilver/chapters/audiodharma-11.json"
            (out_dir / "feed.xml").write_text(
                """<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
                         xmlns:podcast="https://podcastindex.org/namespace/1.0">
                  <channel>
                    <item>
                      <title>Latest AudioDharma</title>
                      <guid>audiodharma:11</guid>
                      <itunes:image href="https://example.test/default.jpg" />
                      <podcast:chapters url="https://example.test/default.json" type="application/json+chapters" />
                    </item>
                  </channel>
                </rss>""",
                encoding="utf-8",
            )
            (out_dir / "talks.json").write_text(
                f"""[
                  {{
                    "id": "audiodharma:11",
                    "title": "Latest AudioDharma",
                    "podcast_description": "A generated episode description.",
                    "episode_image_url": "{image_url}",
                    "chapters_url": "{chapters_url}",
                    "chapters": [{{"start": 0, "title": "Beginning"}}]
                  }}
                ]""",
                encoding="utf-8",
            )

            issues = feed_enrichment_issues(out_dir)

            self.assertEqual(len(issues), 1)
            self.assertIn("artwork/audiodharma-11.jpg", issues[0].missing_requirements)
            self.assertIn("chapters/audiodharma-11.json", issues[0].missing_requirements)
            self.assertIn("rss itunes:image", issues[0].missing_requirements)
            self.assertIn("rss podcast:chapters", issues[0].missing_requirements)


if __name__ == "__main__":
    unittest.main()
