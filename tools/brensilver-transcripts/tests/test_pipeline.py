import tempfile
import unittest
from pathlib import Path

from brensilver_transcripts.pipeline import (
    CorpusPaths,
    Talk,
    build_people_index,
    build_feedback_viewer_data,
    fmt_ts,
    group_suppressed_segments,
    normalize_references,
    parse_duration,
    person_is_supported,
    prune_references_for_segments,
    review_talk,
    safe_talk_id,
    split_windows,
    suppress_transcript_artifacts,
    talk_payload_without_speaker,
    write_json,
)


class PipelineTests(unittest.TestCase):
    def test_safe_talk_id(self):
        self.assertEqual(safe_talk_id("audiodharma:25235"), "audiodharma-25235")

    def test_parse_duration(self):
        self.assertEqual(parse_duration("14:00"), 840)
        self.assertEqual(parse_duration("1:10:39"), 4239)

    def test_fmt_ts(self):
        self.assertEqual(fmt_ts(61), "01:01")
        self.assertEqual(fmt_ts(3661), "01:01:01")

    def test_episode_metadata_prompt_payload_omits_speaker(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        payload = talk_payload_without_speaker(talk)
        self.assertNotIn("speaker", payload)
        self.assertEqual(payload["title"], "Test")

    def test_split_windows_keeps_segments(self):
        segments = [{"segment_id": i, "text": "x" * 30} for i in range(10)]
        windows = split_windows(segments, max_chars=200)
        self.assertEqual(sum(len(window) for window in windows), 10)
        self.assertGreater(len(windows), 1)

    def test_review_flags_suspicious_terms(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = CorpusPaths(Path(tmp))
            corrected = {
                "segments": [
                    {
                        "segment_id": 0,
                        "start": 0,
                        "end": 5,
                        "text": "This mentions dukkah and should be caught.",
                    }
                ]
            }
            write_json(paths.corrected(talk), corrected)
            paths.markdown(talk).parent.mkdir(parents=True, exist_ok=True)
            paths.markdown(talk).write_text("# Test\n", encoding="utf-8")
            issues = review_talk(talk, paths)
            self.assertTrue(any("dukkah" in issue for issue in issues))

    def test_reference_index_skips_review_items(self):
        references = [
            {
                "reference_id": "talk-ref-001",
                "person": "Ajahn Chah",
                "person_role": "Buddhist teacher",
                "confidence": 0.9,
                "needs_review": False,
            },
            {
                "reference_id": "talk-ref-002",
                "person": "Mary Oliver",
                "person_role": "poet",
                "confidence": 0.7,
                "needs_review": True,
            },
        ]
        self.assertEqual(
            [item["name"] for item in build_people_index(references)],
            ["Ajahn Chah"],
        )

    def test_unsupported_person_is_demoted_when_low_confidence(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        segments = [
            {
                "segment_id": 0,
                "start": 0,
                "end": 5,
                "text": "There is a poem here, but no poet is named.",
            }
        ]
        result = normalize_references(
            talk,
            segments,
            {
                "references": [
                    {
                        "reference_type": "direct_quote",
                        "person": "Mary Oliver",
                        "quote_text": "There is a poem here",
                        "reference_summary": "A poem is quoted without a named author.",
                        "segment_ids": [0],
                        "confidence": 0.6,
                    }
                ],
                "people": [],
                "works": [],
                "concepts": [],
                "uncertain_references": [],
            },
            "gpt-5.4-mini",
        )
        self.assertIsNone(result["references"][0]["person"])
        self.assertTrue(result["references"][0]["needs_review"])
        self.assertEqual(result["people_index"], [])

    def test_person_support_accepts_canonical_tokens(self):
        self.assertTrue(person_is_supported("Ajahn Chah", "Ajahn Chah said this."))
        self.assertFalse(person_is_supported("Mary Oliver", "A poet once said this."))

    def test_suppresses_repeated_phrase_in_detected_silence(self):
        segments = [
            {"segment_id": 1, "start": 90.0, "end": 95.0, "text": "The silence beckons us."},
            {"segment_id": 2, "start": 120.0, "end": 125.0, "text": "The silence beckons us."},
            {"segment_id": 3, "start": 150.0, "end": 154.0, "text": "The silence beckons us."},
            {"segment_id": 4, "start": 154.0, "end": 157.0, "text": "The silence beckons us."},
            {"segment_id": 5, "start": 157.0, "end": 160.0, "text": "The silence beckons us."},
        ]
        cleaned, suppressed = suppress_transcript_artifacts(
            segments,
            [(26.0, 92.4), (94.9, 180.0)],
        )
        self.assertEqual([item["segment_id"] for item in cleaned], [1])
        self.assertEqual([item["segment_id"] for item in suppressed], [2, 3, 4, 5])

    def test_groups_suppressed_segments_by_phrase_and_reason(self):
        groups = group_suppressed_segments(
            [
                {
                    "segment_id": 1,
                    "start": 10.0,
                    "end": 12.0,
                    "text": "The silence beckons us.",
                    "suppression_reason": "repeated short phrase aligned with detected silence",
                },
                {
                    "segment_id": 2,
                    "start": 20.0,
                    "end": 22.0,
                    "text": "The silence beckons us.",
                    "suppression_reason": "repeated short phrase aligned with detected silence",
                },
                {
                    "segment_id": 3,
                    "start": 90.0,
                    "end": 92.0,
                    "text": "Satsang with Mooji",
                    "suppression_reason": "known hallucinated boilerplate during silence",
                },
            ]
        )
        self.assertEqual([[item["segment_id"] for item in group] for group in groups], [[1, 2], [3]])

    def test_keeps_repeated_phrase_without_silence_evidence(self):
        segments = [
            {"segment_id": i, "start": i * 5.0, "end": i * 5.0 + 2, "text": "May I be peaceful."}
            for i in range(5)
        ]
        cleaned, suppressed = suppress_transcript_artifacts(segments, [])
        self.assertEqual(len(cleaned), 5)
        self.assertEqual(suppressed, [])

    def test_suppresses_known_boilerplate_without_silence_evidence(self):
        segments = [
            {"segment_id": 1, "start": 0.0, "end": 5.0, "text": "Satsang with Mooji"},
            {"segment_id": 2, "start": 5.0, "end": 10.0, "text": "Actual Dharma sentence."},
        ]
        cleaned, suppressed = suppress_transcript_artifacts(segments, [])
        self.assertEqual([item["segment_id"] for item in cleaned], [2])
        self.assertEqual([item["segment_id"] for item in suppressed], [1])

    def test_suppresses_literal_silence_repetitions(self):
        segments = [
            {"segment_id": i, "start": i * 10.0, "end": i * 10.0 + 3, "text": "Silence."}
            for i in range(5)
        ]
        cleaned, suppressed = suppress_transcript_artifacts(segments, [(0.0, 100.0)])
        self.assertEqual(cleaned, [])
        self.assertEqual(len(suppressed), 5)

    def test_suppresses_single_literal_silence_with_audio_evidence(self):
        segments = [
            {"segment_id": 1, "start": 10.0, "end": 13.0, "text": "Silence."},
        ]
        cleaned, suppressed = suppress_transcript_artifacts(segments, [(0.0, 20.0)])
        self.assertEqual(cleaned, [])
        self.assertEqual([item["segment_id"] for item in suppressed], [1])

    def test_prunes_references_to_suppressed_segments(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        result = prune_references_for_segments(
            talk,
            {
                "references": [
                    {
                        "reference_id": "ref-1",
                        "segment_ids": [1, 2],
                        "person": "Buddha",
                        "confidence": 0.9,
                        "needs_review": False,
                    },
                    {"reference_id": "ref-2", "segment_ids": [3]},
                ]
            },
            [{"segment_id": 1, "start": 10.0, "end": 12.0, "text": "kept"}],
        )
        self.assertEqual(result["references"][0]["segment_ids"], [1])
        self.assertEqual(result["references"][0]["timestamp"], "00:10")
        self.assertEqual([item["reference_id"] for item in result["suppressed_references"]], ["ref-2"])

    def test_prune_demotes_unsupported_person_after_cleanup(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        result = prune_references_for_segments(
            talk,
            {
                "references": [
                    {
                        "reference_id": "ref-1",
                        "segment_ids": [1],
                        "person": "Mooji",
                        "confidence": 0.83,
                        "needs_review": False,
                    }
                ]
            },
            [{"segment_id": 1, "start": 10.0, "end": 12.0, "text": "May I be happy."}],
        )
        self.assertIsNone(result["references"][0]["person"])
        self.assertTrue(result["references"][0]["needs_review"])

    def test_prune_scrubs_artifact_metadata(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        result = prune_references_for_segments(
            talk,
            {
                "references": [
                    {
                        "reference_id": "ref-1",
                        "segment_ids": [1],
                        "person": None,
                        "attribution_cue": "Mooji copyright section",
                        "reference_summary": "A line in the Mooji section.",
                        "person_role": "spiritual teacher",
                    }
                ]
            },
            [{"segment_id": 1, "start": 10.0, "end": 12.0, "text": "May I be happy."}],
        )
        self.assertIsNone(result["references"][0]["attribution_cue"])
        self.assertNotIn("Mooji", result["references"][0]["reference_summary"])

    def test_feedback_viewer_data_includes_review_items(self):
        talk = Talk(
            id="audiodharma:1",
            source="AudioDharma",
            source_id="1",
            title="Test",
            speaker="Matthew Brensilver",
            published_at="2026-01-01T00:00:00+00:00",
            link="https://example.com",
            audio_url="https://example.com/audio.mp3",
            duration="01:00",
            description=None,
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = CorpusPaths(Path(tmp))
            write_json(
                paths.corrected(talk),
                {
                    "segments": [
                        {"segment_id": 1, "start": 10.0, "end": 15.0, "text": "Kept text."}
                    ],
                    "suppressed_segments": [
                        {
                            "segment_id": 2,
                            "start": 20.0,
                            "end": 25.0,
                            "text": "The silence beckons us.",
                            "suppression_reason": "repeated short phrase aligned with detected silence",
                        }
                    ],
                    "uncertain_terms": [
                        {"text": "unclear term", "segment_ids": [1], "reason": "uncertain"}
                    ],
                },
            )
            write_json(
                paths.references(talk),
                {
                    "references": [
                        {
                            "reference_id": "ref-1",
                            "needs_review": True,
                            "start": 10.0,
                            "end": 15.0,
                            "segment_ids": [1],
                            "reference_summary": "Needs review.",
                        }
                    ]
                },
            )
            data = build_feedback_viewer_data([talk], paths)
            self.assertEqual(len(data["items"]), 3)
            self.assertEqual({item["type"] for item in data["items"]}, {"suppressed", "uncertain_term", "reference"})


if __name__ == "__main__":
    unittest.main()
