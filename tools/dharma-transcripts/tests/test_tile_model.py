import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


class TileModelTests(unittest.TestCase):
    def test_landing_tiles_use_sunburst_with_existing_output_settings(self):
        root = Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location("dharma_tiles", root / "scripts/generate-dharma-tiles.py")
        tiles = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tiles)
        self.assertEqual(tiles.MODEL_FALLBACKS[0], "gpt-image-2.6-sunburst")
        self.assertNotIn("gpt-image-1", tiles.MODEL_FALLBACKS)
        with patch.object(tiles.urllib.request, "urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b'{"data":[{"b64_json":"aW1hZ2U="}]}'
            image = tiles.call_openai("test-key", tiles.MODEL_FALLBACKS[0], "A single leaf")
            payload = json.loads(urlopen.call_args.args[0].data)
            self.assertEqual(payload["model"], "gpt-image-2.6-sunburst")
            self.assertEqual(payload["size"], "1024x1536")
            self.assertEqual(payload["quality"], "high")
            self.assertEqual(payload["output_format"], "jpeg")
            self.assertEqual(image, b"image")
