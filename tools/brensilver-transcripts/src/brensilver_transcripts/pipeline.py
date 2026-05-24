from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


TOOLS_ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = TOOLS_ROOT.parents[1]
DEFAULT_TALKS_JSON = SITE_ROOT / "dharma" / "brensilver" / "talks.json"
DEFAULT_CORPUS_DIR = SITE_ROOT / ".local-corpus" / "brensilver"
DEFAULT_PILOT_CONFIG = TOOLS_ROOT / "config" / "pilot-talks.json"
DEFAULT_BATCH_CONFIG = TOOLS_ROOT / "config" / "twenty-talks.json"
DEFAULT_GLOSSARY = TOOLS_ROOT / "config" / "glossary.json"
DEFAULT_FEED_MEDIA_BASE_URL = "https://jeffharr.is/dharma/brensilver/"
DEFAULT_CORRECT_PROMPT = TOOLS_ROOT / "prompts" / "correct_transcript.md"
DEFAULT_REFERENCES_PROMPT = TOOLS_ROOT / "prompts" / "extract_references.md"
DEFAULT_EPISODE_METADATA_PROMPT = TOOLS_ROOT / "prompts" / "episode_metadata.md"
DEFAULT_DESCRIPTION_SUMMARY_PROMPT = TOOLS_ROOT / "prompts" / "description_summary.md"
DEFAULT_ENV_FILE = SITE_ROOT / ".env.local"
OPENAI_BASE_URL = "https://api.openai.com/v1"
MAX_UPLOAD_BYTES = 24 * 1024 * 1024
CHUNK_SECONDS = int(os.environ.get("BRENSILVER_CHUNK_SECONDS", 20 * 60))
CHUNK_OVERLAP_SECONDS = 3
RUN_CORPUS_LOCK_STALE_SECONDS = 12 * 60 * 60
TEXT_NORMALIZATIONS = {
    "Mother Nature, that's last": "Mother Nature bats last",
    "There are no one Dharma drum": "There's no one Dharma drum",
    "Today's, when": "Today, when",
}
KNOWN_SILENCE_HALLUCINATION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\bsatsang\s+with\s+mooji\b",
        r"\bmooji\s+media\b",
        r"\bsatsang\s+dvd\b",
        r"\bno part of this recording may be reproduced\b",
        r"\ball rights reserved\b",
        r"\bexpress consent\b",
        r"\bvideo extract\b",
        r"\bwww\.mooji\.org\b",
    ]
]
REFERENCE_METADATA_ARTIFACT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\bmooji\b",
        r"\bsatsang\b",
        r"\bcopyright\b",
        r"\bno part of this recording may be reproduced\b",
    ]
]
REPEATED_ARTIFACT_MIN_COUNT = 4
REPEATED_ARTIFACT_MAX_WORDS = 16
REPEATED_ARTIFACT_MAX_GAP_SECONDS = 40.0
SILENCE_OVERLAP_THRESHOLD = 0.75
DEFAULT_IMAGE_STYLE = (
    "Square editorial illustration for a contemplative Dharma podcast. "
    "Simple symbolic composition, quiet natural forms, soft paper texture, "
    "restrained palette of moss green, warm ochre, charcoal, muted blue, and "
    "bone white. No text, no logos, no literal teacher portrait, no ornate "
    "religious iconography. Clear at small podcast thumbnail size."
)
IMAGE_MODEL_FALLBACKS = ["gpt-image-1.5", "gpt-image-1"]


DEFAULT_FALLBACK_ARTWORK_PROMPT = (
    "Square editorial illustration for a contemplative Dharma podcast. "
    "A quiet open gate at the edge of a meadow at dawn, with a simple winding path, "
    "scattered leaves, and a clear spacious sky. The image should evoke trust, release, "
    "and calm awareness through natural forms only. Soft paper texture, restrained "
    "palette of moss green, warm ochre, charcoal, muted blue, and bone white. "
    "No text, no logos, no portrait, no ornate religious iconography. "
    "Clear at small podcast thumbnail size."
)


@dataclass
class CorpusConfig:
    slug: str
    title: str
    teacher: str
    public_base_url: str
    talks_json: Path
    corpus_dir: Path
    feed_media_base_url: str
    feed_build_script: Path
    glossary: Path
    env_file: Path
    correct_prompt: Path
    references_prompt: Path
    episode_metadata_prompt: Path
    description_summary_prompt: Path
    qmd_index: str
    qmd_collection: str
    qmd_context: str
    image_style: str
    fallback_artwork_prompt: str
    whisper_prompt: str
    user_agent: str


def default_corpus_config() -> CorpusConfig:
    return CorpusConfig(
        slug="brensilver",
        title="Matthew Brensilver Dharma Talks",
        teacher="Matthew Brensilver",
        public_base_url="https://jeffharr.is/dharma/brensilver/",
        talks_json=DEFAULT_TALKS_JSON,
        corpus_dir=DEFAULT_CORPUS_DIR,
        feed_media_base_url=DEFAULT_FEED_MEDIA_BASE_URL,
        feed_build_script=SITE_ROOT / "scripts" / "build-brensilver-feed.py",
        glossary=DEFAULT_GLOSSARY,
        env_file=DEFAULT_ENV_FILE,
        correct_prompt=DEFAULT_CORRECT_PROMPT,
        references_prompt=DEFAULT_REFERENCES_PROMPT,
        episode_metadata_prompt=DEFAULT_EPISODE_METADATA_PROMPT,
        description_summary_prompt=DEFAULT_DESCRIPTION_SUMMARY_PROMPT,
        qmd_index="dharma",
        qmd_collection="brensilver",
        qmd_context="Timestamped Matthew Brensilver Dharma talk transcripts.",
        image_style=DEFAULT_IMAGE_STYLE,
        fallback_artwork_prompt=DEFAULT_FALLBACK_ARTWORK_PROMPT,
        whisper_prompt=(
            "{teacher} Dharma talk: {title}. Use Buddhist terms and names accurately. "
            "Terms: {terms}. Names: {people}."
        ),
        user_agent="brensilver-transcripts/0.1 (+https://jeffharr.is/dharma/brensilver/)",
    )


CORPUS = default_corpus_config()


@dataclass
class Talk:
    id: str
    source: str
    source_id: str
    title: str
    speaker: str
    published_at: str
    link: str
    audio_url: str
    duration: str | None
    description: str | None

    @property
    def safe_id(self) -> str:
        return safe_talk_id(self.id)


def talk_payload_without_speaker(talk: Talk) -> dict[str, Any]:
    payload = dict(talk.__dict__)
    payload.pop("speaker", None)
    return payload


def speaker_names_for_talk(talk: Talk) -> list[str]:
    names = [CORPUS.teacher, talk.speaker]
    return [name for name in dict.fromkeys(names) if name]


def scrub_speaker_names(value: str, talk: Talk) -> str:
    text = value
    for name in speaker_names_for_talk(talk):
        text = re.sub(rf"\b{re.escape(name)}\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r",\s*,+", ",", text)
    text = re.sub(r"^\s*[,;:]\s*", "", text)
    text = re.sub(r"^\s*(?:and|&)\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def talk_payload_for_description_summary(talk: Talk) -> dict[str, Any]:
    payload = talk_payload_without_speaker(talk)
    for key in ["title", "description"]:
        value = payload.get(key)
        if isinstance(value, str):
            payload[key] = scrub_speaker_names(value, talk)
    return payload


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_talk_id(talk_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", talk_id).strip("-")


def parse_duration(value: str | None) -> float | None:
    if not value:
        return None
    parts = str(value).split(":")
    try:
        nums = [float(part) for part in parts]
    except ValueError:
        return None
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 1:
        return nums[0]
    return None


def fmt_ts(seconds: float | int | None) -> str:
    seconds = max(0, int(round(seconds or 0)))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def append_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


def load_talks(path: Path) -> dict[str, Talk]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    talks: dict[str, Talk] = {}
    for item in raw:
        if not item.get("audio_url"):
            continue
        talk = Talk(
            id=item["id"],
            source=item.get("source") or "",
            source_id=item.get("source_id") or "",
            title=item.get("title") or "",
            speaker=item.get("speaker") or "",
            published_at=item.get("published_at") or "",
            link=item.get("link") or "",
            audio_url=item.get("audio_url") or "",
            duration=item.get("duration"),
            description=item.get("description"),
        )
        talks[talk.id] = talk
    return talks


class CorpusPaths:
    def __init__(self, root: Path):
        self.root = root

    @property
    def state_path(self) -> Path:
        return self.root / "state" / "pipeline-state.json"

    def metadata(self, talk: Talk) -> Path:
        return self.root / "metadata" / f"{talk.safe_id}.json"

    def audio(self, talk: Talk) -> Path:
        return self.root / "audio" / f"{talk.safe_id}.mp3"

    def chunk_dir(self, talk: Talk) -> Path:
        return self.root / "chunks" / talk.safe_id

    def chunk_manifest(self, talk: Talk) -> Path:
        return self.chunk_dir(talk) / "manifest.json"

    def raw_transcript(self, talk: Talk) -> Path:
        return self.root / "transcripts" / "raw" / f"{talk.safe_id}.json"

    def segments(self, talk: Talk) -> Path:
        return self.root / "transcripts" / "segments" / f"{talk.safe_id}.jsonl"

    def corrected(self, talk: Talk) -> Path:
        return self.root / "transcripts" / "corrected" / f"{talk.safe_id}.json"

    def references(self, talk: Talk) -> Path:
        return self.root / "references" / f"{talk.safe_id}.json"

    def episode_metadata(self, talk: Talk) -> Path:
        return self.root / "episode-metadata" / f"{talk.safe_id}.json"

    def artwork_prompt(self, talk: Talk) -> Path:
        return self.root / "artwork" / "prompts" / f"{talk.safe_id}.json"

    def artwork_image(self, talk: Talk) -> Path:
        return self.root / "artwork" / "images" / f"{talk.safe_id}.jpg"

    def artwork_manifest(self, talk: Talk) -> Path:
        return self.root / "artwork" / "manifests" / f"{talk.safe_id}.json"

    def chapters(self, talk: Talk) -> Path:
        return self.root / "chapters" / f"{talk.safe_id}.json"

    def markdown(self, talk: Talk) -> Path:
        return self.root / "transcripts" / "markdown" / f"{talk.safe_id}.md"

    @property
    def markdown_dir(self) -> Path:
        return self.root / "transcripts" / "markdown"

    @property
    def review_dir(self) -> Path:
        return self.root / "review"

    @property
    def viewer_dir(self) -> Path:
        return self.root / "viewer"

    @property
    def feedback_viewer_dir(self) -> Path:
        return self.root / "feedback-viewer"


class PipelineState:
    def __init__(self, path: Path):
        self.path = path
        self.data = load_json(path, {"talks": {}})

    def get(self, talk: Talk) -> dict[str, Any]:
        return self.data.setdefault("talks", {}).setdefault(talk.safe_id, {})

    def mark(self, talk: Talk, **fields: Any) -> None:
        row = self.get(talk)
        row.update(fields)
        if fields.get("status") and fields.get("status") != "failed":
            row.pop("error", None)
            row.pop("failed_at", None)
        row["talk_id"] = talk.id
        row["updated_at"] = now_iso()
        write_json(self.path, self.data)


def require_executable(name: str) -> None:
    if not shutil.which(name):
        raise SystemExit(f"Missing required executable on PATH: {name}")


def require_openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit(
            "OPENAI_API_KEY is not set. Export it in this shell before running transcription."
        )
    return key


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name and name not in os.environ:
            os.environ[name] = value


def load_corpus_config(path: Path | None) -> CorpusConfig:
    if path is None:
        return default_corpus_config()

    raw = load_json(path, {})
    if not isinstance(raw, dict):
        raise SystemExit(f"Corpus config must be a JSON object: {path}")

    prompts = raw.get("prompts") or {}
    qmd = raw.get("qmd") or {}
    defaults = default_corpus_config()
    base_dir = path.parent

    slug = str(raw.get("slug") or defaults.slug)
    title = str(raw.get("title") or defaults.title)
    teacher = str(raw.get("teacher") or raw.get("speaker") or defaults.teacher)
    public_base_url = str(raw.get("public_base_url") or defaults.public_base_url)

    return CorpusConfig(
        slug=slug,
        title=title,
        teacher=teacher,
        public_base_url=public_base_url,
        talks_json=resolve_config_path(raw.get("talks_json"), base_dir, defaults.talks_json),
        corpus_dir=resolve_config_path(raw.get("corpus_dir"), base_dir, defaults.corpus_dir),
        feed_media_base_url=str(raw.get("feed_media_base_url") or public_base_url),
        feed_build_script=resolve_config_path(
            raw.get("feed_build_script"),
            base_dir,
            defaults.feed_build_script,
        ),
        glossary=resolve_config_path(raw.get("glossary"), base_dir, defaults.glossary),
        env_file=resolve_config_path(raw.get("env_file"), base_dir, defaults.env_file),
        correct_prompt=resolve_config_path(
            prompts.get("correct"),
            base_dir,
            defaults.correct_prompt,
        ),
        references_prompt=resolve_config_path(
            prompts.get("references"),
            base_dir,
            defaults.references_prompt,
        ),
        episode_metadata_prompt=resolve_config_path(
            prompts.get("episode_metadata"),
            base_dir,
            defaults.episode_metadata_prompt,
        ),
        description_summary_prompt=resolve_config_path(
            prompts.get("description_summary"),
            base_dir,
            defaults.description_summary_prompt,
        ),
        qmd_index=str(qmd.get("index") or defaults.qmd_index),
        qmd_collection=str(qmd.get("collection") or slug),
        qmd_context=str(
            qmd.get("context") or f"Timestamped {teacher} talk transcripts."
        ),
        image_style=str(raw.get("image_style") or defaults.image_style),
        fallback_artwork_prompt=str(
            raw.get("fallback_artwork_prompt") or defaults.fallback_artwork_prompt
        ),
        whisper_prompt=str(raw.get("whisper_prompt") or defaults.whisper_prompt),
        user_agent=str(raw.get("user_agent") or f"{slug}-transcripts/0.1 (+{public_base_url})"),
    )


def resolve_config_path(value: object, base_dir: Path, default: Path) -> Path:
    if value is None:
        return default
    path = Path(str(value))
    if path.is_absolute():
        return path
    base_candidate = (base_dir / path).resolve()
    if base_candidate.exists():
        return base_candidate
    return (SITE_ROOT / path).resolve()


def set_current_corpus(corpus: CorpusConfig) -> None:
    global CORPUS
    CORPUS = corpus


def render_prompt(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    replacements = {
        "teacher": CORPUS.teacher,
        "teacher_possessive": possessive(CORPUS.teacher),
        "corpus_title": CORPUS.title,
    }
    for key, value in replacements.items():
        text = text.replace(f"{{{key}}}", value)
    return text


def possessive(name: str) -> str:
    name = name.strip()
    if not name:
        return "the speaker's"
    return f"{name}'" if name.endswith("s") else f"{name}'s"


def url_basename(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    name = Path(path).name
    return name or "audio.mp3"


def download_audio(talk: Talk, paths: CorpusPaths, force: bool = False) -> Path:
    dest = paths.audio(talk)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(".download")
    req = urllib.request.Request(
        talk.audio_url,
        headers={"User-Agent": CORPUS.user_agent},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        with temp.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    temp.replace(dest)
    return dest


def ffprobe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def detect_silence_points(path: Path) -> list[float]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "silencedetect=noise=-35dB:d=0.5",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    text = result.stderr + "\n" + result.stdout
    points = []
    for match in re.finditer(r"silence_start:\s*([0-9.]+)", text):
        points.append(float(match.group(1)))
    return sorted(set(points))


def choose_split_time(silence_points: list[float], start: float, duration: float) -> float:
    target = min(duration, start + CHUNK_SECONDS)
    if target >= duration:
        return duration
    earliest = start + CHUNK_SECONDS * 0.65
    latest = min(duration, start + CHUNK_SECONDS + 60)
    candidates = [point for point in silence_points if earliest <= point <= latest]
    if candidates:
        return min(candidates, key=lambda point: abs(point - target))
    return target


def make_chunks(talk: Talk, paths: CorpusPaths, force: bool = False) -> list[dict[str, Any]]:
    manifest_path = paths.chunk_manifest(talk)
    if manifest_path.exists() and not force:
        data = load_json(manifest_path, {})
        chunks = data.get("chunks") or []
        if chunks and all((paths.chunk_dir(talk) / chunk["file"]).exists() for chunk in chunks):
            return chunks

    audio_path = paths.audio(talk)
    duration = ffprobe_duration(audio_path)
    silence_points = detect_silence_points(audio_path)
    chunk_dir = paths.chunk_dir(talk)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[dict[str, Any]] = []

    nominal_start = 0.0
    index = 0
    while nominal_start < duration:
        split_time = choose_split_time(silence_points, nominal_start, duration)
        if split_time <= nominal_start + 1:
            split_time = min(duration, nominal_start + CHUNK_SECONDS)
        start = max(0.0, nominal_start - (CHUNK_OVERLAP_SECONDS if index > 0 else 0.0))
        emit_after = nominal_start if index > 0 else 0.0
        chunk_duration = split_time - start
        filename = f"chunk-{index:03d}.mp3"
        output = chunk_dir / filename
        if force or not output.exists() or output.stat().st_size == 0:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-ss",
                    f"{start:.3f}",
                    "-t",
                    f"{chunk_duration:.3f}",
                    "-i",
                    str(audio_path),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-b:a",
                    "64k",
                    str(output),
                ],
                check=True,
            )
        size = output.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            raise RuntimeError(
                f"Chunk {output} is {size} bytes, above upload safety limit {MAX_UPLOAD_BYTES}"
            )
        chunks.append(
            {
                "index": index,
                "file": filename,
                "start": round(start, 3),
                "end": round(split_time, 3),
                "duration": round(chunk_duration, 3),
                "emit_after": round(emit_after, 3),
                "size": size,
            }
        )
        index += 1
        nominal_start = split_time

    write_json(
        manifest_path,
        {
            "talk_id": talk.id,
            "source_audio": str(audio_path),
            "duration": duration,
            "chunk_seconds": CHUNK_SECONDS,
            "overlap_seconds": CHUNK_OVERLAP_SECONDS,
            "split_strategy": "silence-near-target-with-fixed-fallback",
            "silence_points_detected": len(silence_points),
            "created_at": now_iso(),
            "chunks": chunks,
        },
    )
    return chunks


def multipart_request(
    url: str,
    api_key: str,
    fields: list[tuple[str, str]],
    files: list[tuple[str, Path, str]],
) -> dict[str, Any]:
    return curl_multipart_request(url, api_key, fields, files)


def curl_multipart_request(
    url: str,
    api_key: str,
    fields: list[tuple[str, str]],
    files: list[tuple[str, Path, str]],
) -> dict[str, Any]:
    if not shutil.which("curl"):
        raise RuntimeError("Missing required executable on PATH: curl")

    command = [
        "curl",
        "--config",
        "-",
        "--http2",
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--max-time",
        "300",
        "--retry",
        "3",
        "--retry-all-errors",
        "--retry-delay",
        "1",
        "--write-out",
        (
            "%{stderr}\\nopenai_multipart_transport=curl "
            "http_version=%{http_version} "
            "http_code=%{http_code} "
            "time_total=%{time_total} "
            "size_upload=%{size_upload}\\n"
        ),
    ]
    for name, value in fields:
        command.extend(["--form-string", f"{name}={value}"])
    for name, path, content_type in files:
        command.extend(["--form", f"{name}=@{path};type={content_type}"])
    command.append(url)

    curl_config = f'header = "Authorization: Bearer {api_key}"\n'
    result = subprocess.run(
        command,
        input=curl_config,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode != 0:
        detail = "\n".join(part for part in [result.stderr, result.stdout[:1000]] if part)
        raise RuntimeError(f"OpenAI multipart curl request failed: {detail}")
    return parse_curl_json_stdout(result.stdout)


def parse_curl_json_stdout(stdout: str) -> dict[str, Any]:
    lines = stdout.rstrip("\n").splitlines()
    if lines and lines[-1].startswith("openai_multipart_transport="):
        print(lines[-1], file=sys.stderr)
        stdout = "\n".join(lines[:-1])
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as error:
        detail = stdout[:1000]
        raise RuntimeError(f"OpenAI multipart curl returned invalid JSON: {error}: {detail}") from error


def json_request(url: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    return openai_json(req)


def openai_binary_image_request(
    api_key: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return json_request(f"{OPENAI_BASE_URL}/images/generations", api_key, payload)


def openai_json(req: urllib.request.Request, retries: int = 4) -> dict[str, Any]:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code in {429, 500, 502, 503, 504} and attempt < retries - 1:
                time.sleep(2**attempt)
                continue
            raise RuntimeError(f"OpenAI API error {error.code}: {detail}") from error
        except OSError as error:
            if attempt < retries - 1:
                time.sleep(2**attempt)
                continue
            raise RuntimeError(f"OpenAI API request failed: {error}") from error
    raise RuntimeError("OpenAI API request failed after retries")


def build_whisper_prompt(talk: Talk, glossary: dict[str, Any]) -> str:
    terms = ", ".join(glossary.get("dharma_terms", [])[:40])
    people = ", ".join(glossary.get("people_and_places", [])[:30])
    return CORPUS.whisper_prompt.format(
        teacher=CORPUS.teacher,
        speaker=talk.speaker or CORPUS.teacher,
        title=talk.title,
        terms=terms,
        people=people,
    )


def transcribe_chunks(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    glossary: dict[str, Any],
    force: bool = False,
) -> list[dict[str, Any]]:
    raw_path = paths.raw_transcript(talk)
    segments_path = paths.segments(talk)
    if raw_path.exists() and segments_path.exists() and not force:
        return read_jsonl(segments_path)

    chunks = make_chunks(talk, paths, force=force)
    prompt = build_whisper_prompt(talk, glossary)
    raw_chunks: list[dict[str, Any]] = []
    merged_segments: list[dict[str, Any]] = []
    segment_id = 0

    for chunk in chunks:
        chunk_path = paths.chunk_dir(talk) / chunk["file"]
        transcript = multipart_request(
            f"{OPENAI_BASE_URL}/audio/transcriptions",
            api_key,
            fields=[
                ("model", "whisper-1"),
                ("response_format", "verbose_json"),
                ("timestamp_granularities[]", "segment"),
                ("prompt", prompt),
            ],
            files=[("file", chunk_path, "audio/mpeg")],
        )
        raw_chunks.append({"chunk": chunk, "response": transcript})
        for item in transcript.get("segments", []):
            local_start = float(item.get("start", 0))
            local_end = float(item.get("end", local_start))
            global_start = float(chunk["start"]) + local_start
            global_end = float(chunk["start"]) + local_end
            if global_start + 0.25 < float(chunk["emit_after"]):
                continue
            text = clean_space(item.get("text", ""))
            if not text:
                continue
            merged_segments.append(
                {
                    "segment_id": segment_id,
                    "talk_id": talk.id,
                    "source": talk.source,
                    "start": round(global_start, 3),
                    "end": round(global_end, 3),
                    "timestamp": fmt_ts(global_start),
                    "text": text,
                    "chunk_index": chunk["index"],
                }
            )
            segment_id += 1

    write_json(
        raw_path,
        {
            "talk": talk.__dict__,
            "model": "whisper-1",
            "timestamp_granularities": ["segment"],
            "created_at": now_iso(),
            "chunks": raw_chunks,
        },
    )
    append_jsonl(segments_path, merged_segments)
    return merged_segments


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_text(value: str) -> str:
    for old, new in TEXT_NORMALIZATIONS.items():
        value = value.replace(old, new)
    return value


def transcript_phrase_key(text: str) -> str:
    text = normalize_text(clean_space(text)).lower()
    text = re.sub(r"[^a-z0-9']+", " ", text)
    return clean_space(text)


def silence_overlap_ratio(
    start: float,
    end: float,
    silence_intervals: list[tuple[float, float]],
) -> float:
    duration = max(0.001, end - start)
    overlap = 0.0
    for silence_start, silence_end in silence_intervals:
        if silence_end <= start:
            continue
        if silence_start >= end:
            break
        overlap += max(0.0, min(end, silence_end) - max(start, silence_start))
    return min(1.0, overlap / duration)


def detect_silence_intervals(audio_path: Path) -> list[tuple[float, float]]:
    if not audio_path.exists():
        return []
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(audio_path),
            "-vn",
            "-af",
            "silencedetect=noise=-40dB:d=1",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    intervals: list[tuple[float, float]] = []
    current_start: float | None = None
    for line in (result.stdout + result.stderr).splitlines():
        start_match = re.search(r"silence_start:\s*([0-9.]+)", line)
        if start_match:
            current_start = float(start_match.group(1))
            continue
        end_match = re.search(r"silence_end:\s*([0-9.]+)", line)
        if end_match and current_start is not None:
            end = float(end_match.group(1))
            if end > current_start:
                intervals.append((current_start, end))
            current_start = None
    return intervals


def suppress_transcript_artifacts(
    segments: list[dict[str, Any]],
    silence_intervals: list[tuple[float, float]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    silence_intervals = sorted(silence_intervals or [])
    suppressions: dict[int, str] = {}

    for segment in segments:
        segment_id = int(segment.get("segment_id", -1))
        text = normalize_text(clean_space(str(segment.get("text", ""))))
        if not text or not re.search(r"[A-Za-z0-9]", text):
            suppressions[segment_id] = "punctuation-only transcript artifact"
            continue
        start = float(segment.get("start", 0))
        end = float(segment.get("end", start))
        silence_ratio = silence_overlap_ratio(start, end, silence_intervals)
        if transcript_phrase_key(text) == "silence" and silence_ratio >= SILENCE_OVERLAP_THRESHOLD:
            suppressions[segment_id] = "literal silence marker aligned with detected silence"
            continue
        if any(pattern.search(text) for pattern in KNOWN_SILENCE_HALLUCINATION_PATTERNS):
            suppressions[segment_id] = "known hallucinated boilerplate during silence"

    by_key: dict[str, list[dict[str, Any]]] = {}
    for segment in segments:
        key = transcript_phrase_key(str(segment.get("text", "")))
        word_count = len(key.split())
        if (key == "silence") or (3 <= word_count <= REPEATED_ARTIFACT_MAX_WORDS):
            by_key.setdefault(key, []).append(segment)

    for key, occurrences in by_key.items():
        occurrences = sorted(occurrences, key=lambda item: float(item.get("start", 0)))
        run: list[dict[str, Any]] = []
        for occurrence in occurrences:
            if not run:
                run = [occurrence]
                continue
            previous = run[-1]
            gap = float(occurrence.get("start", 0)) - float(previous.get("end", 0))
            if gap <= REPEATED_ARTIFACT_MAX_GAP_SECONDS:
                run.append(occurrence)
                continue
            mark_repeated_silence_run(run, silence_intervals, suppressions)
            run = [occurrence]
        mark_repeated_silence_run(run, silence_intervals, suppressions)

    cleaned: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []
    for segment in segments:
        segment_id = int(segment.get("segment_id", -1))
        reason = suppressions.get(segment_id)
        if reason:
            suppressed_segment = dict(segment)
            suppressed_segment["suppression_reason"] = reason
            suppressed.append(suppressed_segment)
        else:
            cleaned.append(segment)
    return cleaned, suppressed


def mark_repeated_silence_run(
    run: list[dict[str, Any]],
    silence_intervals: list[tuple[float, float]],
    suppressions: dict[int, str],
) -> None:
    if len(run) < REPEATED_ARTIFACT_MIN_COUNT or not silence_intervals:
        return
    for segment in run:
        start = float(segment.get("start", 0))
        end = float(segment.get("end", start))
        if silence_overlap_ratio(start, end, silence_intervals) >= SILENCE_OVERLAP_THRESHOLD:
            segment_id = int(segment.get("segment_id", -1))
            suppressions.setdefault(
                segment_id,
                "repeated short phrase aligned with detected silence",
            )


def split_windows(segments: list[dict[str, Any]], max_chars: int = 24000) -> list[list[dict[str, Any]]]:
    windows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for segment in segments:
        size = len(segment.get("text", "")) + 80
        if current and current_chars + size > max_chars:
            windows.append(current)
            current = []
            current_chars = 0
        current.append(segment)
        current_chars += size
    if current:
        windows.append(current)
    return windows


def extract_chat_content(response: dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        raise RuntimeError(f"OpenAI chat response had no choices: {response}")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str):
        raise RuntimeError(f"OpenAI chat response had no text content: {response}")
    return content


def parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def correct_segments(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    glossary: dict[str, Any],
    model: str,
    force: bool = False,
) -> dict[str, Any]:
    corrected_path = paths.corrected(talk)
    if corrected_path.exists() and not force:
        existing = load_json(corrected_path, {})
        if existing.get("segments") and existing.get("correction_model"):
            return existing

    segments = read_jsonl(paths.segments(talk))
    if not segments:
        raise RuntimeError(f"No transcript segments found for {talk.id}")

    system_prompt = render_prompt(CORPUS.correct_prompt)
    windows = split_windows(segments)
    corrected_by_id: dict[int, str] = {}
    annotations: dict[str, list[dict[str, Any]]] = {
        "uncertain_terms": [],
        "corrections": [],
    }
    glossary_text = json.dumps(glossary, sort_keys=True)

    for window_index, window in enumerate(windows):
        user_payload = {
            "talk": talk.__dict__,
            "window_index": window_index,
            "window_count": len(windows),
            "glossary": glossary,
            "segments": [
                {
                    "segment_id": item["segment_id"],
                    "timestamp": item["timestamp"],
                    "start": item["start"],
                    "end": item["end"],
                    "text": item["text"],
                }
                for item in window
            ],
        }
        response = json_request(
            f"{OPENAI_BASE_URL}/chat/completions",
            api_key,
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": (
                            "Correct this transcript window only. "
                            "Return JSON with keys corrected_segments, "
                            "uncertain_terms, corrections. "
                            "Glossary JSON follows for emphasis: "
                            f"{glossary_text}\n\n"
                            f"{json.dumps(user_payload, ensure_ascii=False)}"
                        ),
                    },
                ],
                "response_format": {"type": "json_object"},
                "max_completion_tokens": 6000,
            },
        )
        parsed = parse_json_object(extract_chat_content(response))
        for corrected in parsed.get("corrected_segments", []):
            try:
                seg_id = int(corrected["segment_id"])
            except (KeyError, TypeError, ValueError):
                continue
            corrected_text = clean_space(corrected.get("corrected_text", ""))
            if corrected_text:
                corrected_by_id[seg_id] = corrected_text
        for key in annotations:
            values = parsed.get(key, [])
            if isinstance(values, list):
                annotations[key].extend(values)

    corrected_segments: list[dict[str, Any]] = []
    corrections = annotations.get("corrections", [])
    for segment in segments:
        updated = dict(segment)
        updated["raw_text"] = segment["text"]
        text = corrected_by_id.get(segment["segment_id"], segment["text"])
        text = apply_segment_corrections(segment["segment_id"], text, corrections)
        updated["text"] = text
        corrected_segments.append(updated)

    silence_intervals = detect_silence_intervals(paths.audio(talk))
    corrected_segments, suppressed_segments = suppress_transcript_artifacts(
        corrected_segments,
        silence_intervals,
    )

    result = {
        "talk": talk.__dict__,
        "created_at": now_iso(),
        "transcript_model": "whisper-1",
        "correction_model": model,
        "segments": corrected_segments,
        "suppressed_segments": suppressed_segments,
        "corrections": dedupe_annotations(annotations).get("corrections", []),
        "uncertain_terms": dedupe_annotations(annotations).get("uncertain_terms", []),
    }
    write_json(corrected_path, result)
    return result


def extract_references(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    glossary: dict[str, Any],
    model: str,
    force: bool = False,
) -> dict[str, Any]:
    references_path = paths.references(talk)
    if references_path.exists() and not force:
        return load_json(references_path, {})

    corrected = load_json(paths.corrected(talk), {})
    segments = corrected.get("segments") or read_jsonl(paths.segments(talk))
    if not segments:
        raise RuntimeError(f"No corrected transcript segments found for {talk.id}")

    system_prompt = render_prompt(CORPUS.references_prompt)
    windows = split_windows(segments, max_chars=32000)
    collected: dict[str, list[dict[str, Any]]] = {
        "references": [],
        "people": [],
        "works": [],
        "concepts": [],
        "uncertain_references": [],
    }
    glossary_text = json.dumps(glossary, sort_keys=True)

    for window_index, window in enumerate(windows):
        parsed_windows = extract_reference_window(
            talk=talk,
            window=window,
            window_index=window_index,
            window_count=len(windows),
            glossary=glossary,
            glossary_text=glossary_text,
            system_prompt=system_prompt,
            api_key=api_key,
            model=model,
        )
        for parsed in parsed_windows:
            for key in collected:
                values = parsed.get(key, [])
                if isinstance(values, list):
                    collected[key].extend(value for value in values if isinstance(value, dict))

    result = normalize_references(talk, segments, collected, model)
    write_json(references_path, result)
    return result


def extract_reference_window(
    talk: Talk,
    window: list[dict[str, Any]],
    window_index: int,
    window_count: int,
    glossary: dict[str, Any],
    glossary_text: str,
    system_prompt: str,
    api_key: str,
    model: str,
    depth: int = 0,
) -> list[dict[str, Any]]:
    user_payload = {
        "talk": talk.__dict__,
        "window_index": window_index,
        "window_count": window_count,
        "segments": [
            {
                "segment_id": item["segment_id"],
                "timestamp": item["timestamp"],
                "start": item["start"],
                "end": item["end"],
                "text": item["text"],
            }
            for item in window
        ],
    }
    response = json_request(
        f"{OPENAI_BASE_URL}/chat/completions",
        api_key,
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        "Extract holistic external reference moments from this corrected "
                        "transcript window. Include attribution segments before quoted or "
                        "paraphrased material when needed. Be concise. Return valid JSON "
                        "only. Glossary JSON follows for "
                        f"emphasis: {glossary_text}\n\n"
                        f"{json.dumps(user_payload, ensure_ascii=False)}"
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 6000,
        },
    )
    try:
        return [parse_json_object(extract_chat_content(response))]
    except json.JSONDecodeError:
        if len(window) > 8 and depth < 4:
            midpoint = len(window) // 2
            return extract_reference_window(
                talk,
                window[:midpoint],
                window_index,
                window_count,
                glossary,
                glossary_text,
                system_prompt,
                api_key,
                model,
                depth + 1,
            ) + extract_reference_window(
                talk,
                window[midpoint:],
                window_index,
                window_count,
                glossary,
                glossary_text,
                system_prompt,
                api_key,
                model,
                depth + 1,
            )
        snippet = extract_chat_content(response)[:500]
        raise RuntimeError(f"Reference extraction returned invalid JSON: {snippet!r}")


def normalize_references(
    talk: Talk,
    segments: list[dict[str, Any]],
    collected: dict[str, list[dict[str, Any]]],
    model: str,
) -> dict[str, Any]:
    segment_by_id = {int(item["segment_id"]): item for item in segments}
    references: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in collected.get("references", []):
        segment_ids = normalize_segment_ids(raw.get("segment_ids"))
        start, end = reference_bounds(segment_ids, segment_by_id, raw)
        person = normalize_optional(raw.get("person"))
        evidence_text = reference_evidence_text(segment_ids, segment_by_id)
        unsupported_person = person and not person_is_supported(person, evidence_text)
        work_title = normalize_optional(raw.get("work_title"))
        quote_text = normalize_optional(raw.get("quote_text"))
        reference_title = normalize_optional(raw.get("reference_title"))
        reference_annotation = normalize_optional(raw.get("reference_annotation"))
        selected_material = normalize_optional(raw.get("selected_material"))
        summary = (
            reference_annotation
            or normalize_optional(raw.get("reference_summary"))
            or selected_material
        )
        needs_review = bool(raw.get("needs_review", False))
        confidence = coerce_confidence(raw.get("confidence"))
        if unsupported_person:
            needs_review = True
            if confidence < 0.8:
                person = None
        marker = "|".join(
            [
                normalize_optional(raw.get("reference_type")) or "",
                person or "",
                work_title or "",
                reference_title or "",
                summary or "",
                selected_material or "",
                ",".join(str(item) for item in segment_ids),
            ]
        )
        if marker in seen:
            continue
        seen.add(marker)
        reference = {
            "reference_id": f"{talk.safe_id}-ref-{len(references) + 1:03d}",
            "talk_id": talk.id,
            "reference_type": normalize_optional(raw.get("reference_type")) or "reference",
            "person": person,
            "person_role": normalize_optional(raw.get("person_role")),
            "work_title": work_title,
            "work_type": normalize_optional(raw.get("work_type")),
            "quote_text": quote_text,
            "reference_title": reference_title,
            "reference_annotation": reference_annotation,
            "selected_material": selected_material,
            "reference_summary": summary,
            "attribution_cue": normalize_optional(raw.get("attribution_cue")),
            "segment_ids": segment_ids,
            "start": start,
            "end": end,
            "timestamp": fmt_ts(start),
            "confidence": confidence,
            "needs_review": needs_review,
        }
        references.append(reference)

    result = {
        "talk": talk.__dict__,
        "created_at": now_iso(),
        "reference_model": model,
        "references": references,
        "people": dedupe_reference_entities(collected.get("people", []), "name"),
        "works": dedupe_reference_entities(collected.get("works", []), "title"),
        "concepts": dedupe_reference_entities(collected.get("concepts", []), "name"),
        "uncertain_references": dedupe_reference_entities(
            collected.get("uncertain_references", []), "text"
        ),
    }
    result["people_index"] = build_people_index(references)
    result["works_index"] = build_works_index(references)
    return result


def reference_evidence_text(
    segment_ids: list[int],
    segment_by_id: dict[int, dict[str, Any]],
) -> str:
    return " ".join(
        str(segment_by_id[segment_id].get("text", ""))
        for segment_id in segment_ids
        if segment_id in segment_by_id
    )


def person_is_supported(person: str, evidence_text: str) -> bool:
    evidence = evidence_text.lower()
    person_lower = person.lower()
    tokens = [
        token
        for token in re.split(r"[^a-zA-Z]+", person_lower)
        if len(token) >= 4 and token not in {"maharaj", "teacher", "buddhist"}
    ]
    if person_lower in evidence:
        return True
    if tokens and any(token in evidence for token in tokens):
        return True
    if person_lower in {"buddha", "the buddha"}:
        return any(
            cue in evidence
            for cue in [
                "buddha",
                "first noble truth",
                "noble truth",
                "dukkha",
                "anatta",
                "anicca",
                "dhamma",
                "dharma",
                "sutta",
                "nibbana",
            ]
        )
    return False


def normalize_segment_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    ids: list[int] = []
    for item in value:
        try:
            ids.append(int(item))
        except (TypeError, ValueError):
            continue
    return sorted(set(ids))


def reference_bounds(
    segment_ids: list[int],
    segment_by_id: dict[int, dict[str, Any]],
    raw: dict[str, Any],
) -> tuple[float, float]:
    starts = [
        float(segment_by_id[segment_id].get("start", 0))
        for segment_id in segment_ids
        if segment_id in segment_by_id
    ]
    ends = [
        float(segment_by_id[segment_id].get("end", segment_by_id[segment_id].get("start", 0)))
        for segment_id in segment_ids
        if segment_id in segment_by_id
    ]
    if starts and ends:
        return round(min(starts), 3), round(max(ends), 3)
    try:
        start = float(raw.get("start", 0))
        end = float(raw.get("end", start))
    except (TypeError, ValueError):
        start = 0.0
        end = 0.0
    return round(start, 3), round(end, 3)


def normalize_optional(value: Any) -> str | None:
    if value is None:
        return None
    text = normalize_text(clean_space(str(value)))
    if not text or text.lower() in {"none", "null", "unknown"}:
        return None
    return text


def coerce_confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, round(float(value), 3)))
    except (TypeError, ValueError):
        return 0.5


def dedupe_reference_entities(values: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        label = normalize_optional(value.get(key))
        if not label:
            continue
        marker = label.lower()
        if marker in seen:
            continue
        seen.add(marker)
        cleaned = dict(value)
        cleaned[key] = label
        output.append(cleaned)
    return output


def build_people_index(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for ref in references:
        if ref.get("needs_review") or coerce_confidence(ref.get("confidence")) < 0.65:
            continue
        person = ref.get("person")
        if not person:
            continue
        row = grouped.setdefault(
            person,
            {
                "name": person,
                "role": ref.get("person_role"),
                "reference_ids": [],
                "count": 0,
            },
        )
        row["reference_ids"].append(ref["reference_id"])
        row["count"] += 1
        if not row.get("role") and ref.get("person_role"):
            row["role"] = ref["person_role"]
    return sorted(grouped.values(), key=lambda item: (-item["count"], item["name"]))


def build_works_index(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for ref in references:
        if ref.get("needs_review") or coerce_confidence(ref.get("confidence")) < 0.65:
            continue
        title = ref.get("work_title")
        if not title:
            continue
        row = grouped.setdefault(
            title,
            {
                "title": title,
                "creator": ref.get("person"),
                "work_type": ref.get("work_type"),
                "reference_ids": [],
                "count": 0,
            },
        )
        row["reference_ids"].append(ref["reference_id"])
        row["count"] += 1
    return sorted(grouped.values(), key=lambda item: (-item["count"], item["title"]))


def generate_episode_metadata(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    model: str,
    force: bool = False,
) -> dict[str, Any]:
    output_path = paths.episode_metadata(talk)
    if output_path.exists() and not force:
        existing = load_json(output_path, {})
        if existing.get("description") and existing.get("chapters"):
            return existing

    corrected = load_json(paths.corrected(talk), {})
    segments = corrected.get("segments") or []
    if not segments:
        raise RuntimeError(f"No corrected transcript found for {talk.id}")
    references_doc = load_json(paths.references(talk), {})
    prompt = render_prompt(CORPUS.episode_metadata_prompt)
    payload = {
        "talk": talk_payload_without_speaker(talk),
        "shared_image_style": CORPUS.image_style,
        "segments": compact_segments_for_model(segments),
        "references": compact_references_for_model(references_doc.get("references", [])),
        "uncertain_terms": corrected.get("uncertain_terms", [])[:25],
        "suppressed_segments_count": len(corrected.get("suppressed_segments", [])),
    }
    response = json_request(
        f"{OPENAI_BASE_URL}/chat/completions",
        api_key,
        {
            "model": model,
            "messages": [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        "Create podcast episode metadata, chapters, and an image prompt "
                        "for this talk. Return valid JSON only.\n\n"
                        f"{json.dumps(payload, ensure_ascii=False)}"
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 6000,
        },
    )
    parsed = parse_json_object(extract_chat_content(response))
    result = normalize_episode_metadata(talk, parsed, segments, model)
    write_json(output_path, result)
    write_json(paths.chapters(talk), {"talk": talk.__dict__, "chapters": result["chapters"]})
    write_json(
        paths.artwork_prompt(talk),
        {
            "talk": talk.__dict__,
            "created_at": result["created_at"],
            "model": model,
            "image_brief": result.get("image_brief"),
            "image_prompt": result.get("image_prompt"),
            "style": CORPUS.image_style,
        },
    )
    return result


def compact_segments_for_model(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "segment_id": item.get("segment_id"),
            "start": item.get("start"),
            "end": item.get("end"),
            "timestamp": fmt_ts(item.get("start")),
            "text": normalize_text(clean_space(str(item.get("text", "")))),
        }
        for item in segments
    ]


def compact_references_for_model(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for ref in references:
        output.append(
            {
                "reference_id": ref.get("reference_id"),
                "reference_type": ref.get("reference_type"),
                "person": ref.get("person"),
                "work_title": ref.get("work_title"),
                "reference_title": ref.get("reference_title"),
                "reference_annotation": ref.get("reference_annotation")
                or ref.get("reference_summary"),
                "selected_material": ref.get("selected_material") or ref.get("quote_text"),
                "start": ref.get("start"),
                "end": ref.get("end"),
                "timestamp": ref.get("timestamp"),
                "confidence": ref.get("confidence"),
                "needs_review": ref.get("needs_review"),
            }
        )
    return output


def generate_description_summary(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    model: str,
) -> dict[str, str]:
    corrected = load_json(paths.corrected(talk), {})
    segments = corrected.get("segments") or []
    if not segments:
        raise RuntimeError(f"No corrected transcript found for {talk.id}")
    if not paths.episode_metadata(talk).exists():
        raise RuntimeError(f"No episode metadata found for {talk.id}")

    references_doc = load_json(paths.references(talk), {})
    prompt = render_prompt(CORPUS.description_summary_prompt)
    payload = {
        "talk": talk_payload_for_description_summary(talk),
        "segments": compact_segments_for_model(segments),
        "references": compact_references_for_model(references_doc.get("references", [])),
        "uncertain_terms": corrected.get("uncertain_terms", [])[:25],
        "suppressed_segments_count": len(corrected.get("suppressed_segments", [])),
    }
    response = json_request(
        f"{OPENAI_BASE_URL}/chat/completions",
        api_key,
        {
            "model": model,
            "messages": [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        "Create only the podcast description and short summary "
                        "for this talk. Return valid JSON only.\n\n"
                        f"{json.dumps(payload, ensure_ascii=False)}"
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 1200,
        },
    )
    parsed = parse_json_object(extract_chat_content(response))
    return normalize_description_summary(parsed, talk)


def normalize_description_summary(raw: dict[str, Any], talk: Talk) -> dict[str, str]:
    description = normalize_optional(raw.get("description")) or talk.description or talk.title
    short_summary = normalize_optional(raw.get("short_summary")) or description.split(".")[0]
    return {
        "description": normalize_text(clean_space(description)),
        "short_summary": normalize_text(clean_space(short_summary)),
    }


def merge_description_summary_metadata(
    metadata: dict[str, Any],
    generated: dict[str, str],
) -> dict[str, Any]:
    updated = dict(metadata)
    updated["description"] = generated["description"]
    updated["short_summary"] = generated["short_summary"]
    return updated


def select_description_summary_talks(
    talks: dict[str, Talk],
    paths: CorpusPaths,
    talk_ids: list[str] | None,
    limit: int | None,
) -> list[Talk]:
    selected: list[Talk] = []
    candidates = select_talks(talks, paths, talk_ids, None, True) if talk_ids else list(talks.values())
    for talk in candidates:
        if not paths.corrected(talk).exists() or not paths.episode_metadata(talk).exists():
            continue
        selected.append(talk)
        if limit and len(selected) >= limit:
            break
    return selected


def normalize_episode_metadata(
    talk: Talk,
    raw: dict[str, Any],
    segments: list[dict[str, Any]],
    model: str,
) -> dict[str, Any]:
    description = normalize_optional(raw.get("description")) or talk.description or talk.title
    short_summary = normalize_optional(raw.get("short_summary")) or description.split(".")[0]
    chapters = normalize_chapters(raw.get("chapters"), segments)
    if not chapters and segments:
        chapters = [
            {
                "start": float(segments[0].get("start", 0)),
                "end": float(segments[-1].get("end", segments[-1].get("start", 0))),
                "timestamp": fmt_ts(segments[0].get("start")),
                "title": "Talk",
                "description": short_summary,
            }
        ]
    description_with_timestamps = normalize_optional(raw.get("description_with_timestamps"))
    if not description_with_timestamps:
        description_with_timestamps = build_description_with_timestamps(description, chapters)
    topics = [
        normalize_text(clean_space(str(item)))
        for item in raw.get("topics", [])
        if normalize_optional(item)
    ][:12]
    image_brief = normalize_optional(raw.get("image_brief")) or short_summary
    image_prompt = normalize_optional(raw.get("image_prompt")) or image_brief
    if "no text" not in image_prompt.lower():
        image_prompt = f"{image_prompt}\n\nShared style: {CORPUS.image_style}"
    source_caveats = [
        normalize_text(clean_space(str(item)))
        for item in raw.get("source_caveats", [])
        if normalize_optional(item)
    ]
    return {
        "talk": talk.__dict__,
        "created_at": now_iso(),
        "metadata_model": model,
        "description": description,
        "short_summary": short_summary,
        "description_with_timestamps": description_with_timestamps,
        "chapters": chapters,
        "topics": topics,
        "image_brief": image_brief,
        "image_prompt": image_prompt,
        "source_caveats": source_caveats,
        "metadata_needs_review": bool(raw.get("metadata_needs_review") or source_caveats),
    }


def normalize_chapters(value: Any, segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    duration_end = float(segments[-1].get("end", segments[-1].get("start", 0))) if segments else 0.0
    starts = [float(item.get("start", 0)) for item in segments if item.get("start") is not None]
    chapters: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start", 0))
        except (TypeError, ValueError):
            continue
        if starts:
            start = min(starts, key=lambda candidate: abs(candidate - start))
        title = normalize_optional(item.get("title")) or "Section"
        description = normalize_optional(item.get("description")) or title
        chapters.append(
            {
                "start": round(max(0.0, start), 3),
                "end": round(max(0.0, coerce_float(item.get("end"), duration_end)), 3),
                "timestamp": fmt_ts(start),
                "title": title,
                "description": description,
            }
        )
    chapters.sort(key=lambda item: item["start"])
    cleaned: list[dict[str, Any]] = []
    seen_starts: set[float] = set()
    for index, chapter in enumerate(chapters):
        if chapter["start"] in seen_starts:
            continue
        seen_starts.add(chapter["start"])
        next_start = chapters[index + 1]["start"] if index + 1 < len(chapters) else duration_end
        if chapter["end"] <= chapter["start"] or chapter["end"] > next_start:
            chapter["end"] = round(max(chapter["start"], next_start), 3)
        cleaned.append(chapter)
    return cleaned[:9]


def coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_description_with_timestamps(description: str, chapters: list[dict[str, Any]]) -> str:
    lines = [description.strip(), "", "Timestamps"]
    for chapter in chapters:
        lines.append(
            f"[{fmt_ts(chapter.get('start'))}] {chapter.get('title')}: {chapter.get('description')}"
        )
    return "\n".join(lines).strip()


def generate_artwork(
    talk: Talk,
    paths: CorpusPaths,
    api_key: str,
    image_model: str,
    image_size: str = "1024x1024",
    image_quality: str = "low",
    force: bool = False,
) -> dict[str, Any]:
    image_path = paths.artwork_image(talk)
    manifest_path = paths.artwork_manifest(talk)
    if image_path.exists() and manifest_path.exists() and not force:
        return load_json(manifest_path, {})
    metadata = load_json(paths.episode_metadata(talk), {})
    prompt = normalize_optional(metadata.get("image_prompt"))
    if not prompt:
        raise RuntimeError(f"No image prompt found for {talk.id}; run metadata first")

    prompt_options = [("metadata", prompt)]
    fallback_prompt = safe_artwork_fallback_prompt()
    if fallback_prompt.strip() != prompt.strip():
        prompt_options.append(("safe_fallback", fallback_prompt))

    candidates = [image_model]
    for fallback in IMAGE_MODEL_FALLBACKS:
        if fallback not in candidates:
            candidates.append(fallback)

    errors: list[str] = []
    for prompt_source, prompt_text in prompt_options:
        prompt_rejected_for_safety = False
        for model in candidates:
            payloads = [
                {
                    "model": model,
                    "prompt": prompt_text,
                    "size": image_size,
                    "quality": image_quality,
                    "output_format": "jpeg",
                },
                {
                    "model": model,
                    "prompt": prompt_text,
                    "size": image_size,
                    "quality": image_quality,
                },
            ]
            for payload in payloads:
                try:
                    response = openai_binary_image_request(api_key, payload)
                    image_bytes = extract_image_bytes(response)
                    image_path.parent.mkdir(parents=True, exist_ok=True)
                    image_path.write_bytes(image_bytes)
                    manifest = {
                        "talk": talk.__dict__,
                        "created_at": now_iso(),
                        "image_model": model,
                        "requested_image_model": image_model,
                        "size": image_size,
                        "quality": image_quality,
                        "image_path": str(image_path),
                        "relative_image_src": f"../artwork/images/{image_path.name}",
                        "prompt": prompt_text,
                        "prompt_source": prompt_source,
                    }
                    write_json(manifest_path, manifest)
                    return manifest
                except RuntimeError as error:
                    message = str(error)
                    errors.append(f"{prompt_source}/{model}: {message[:300]}")
                    if is_image_safety_error(message):
                        prompt_rejected_for_safety = True
                        break
                    if "invalid_request_error" not in message and "unknown_parameter" not in message:
                        break
            if prompt_rejected_for_safety:
                break
    raise RuntimeError("Image generation failed: " + " | ".join(errors))


def safe_artwork_fallback_prompt() -> str:
    return CORPUS.fallback_artwork_prompt


def is_image_safety_error(message: str) -> bool:
    lowered = message.lower()
    return "safety" in lowered or "rejected" in lowered


def extract_image_bytes(response: dict[str, Any]) -> bytes:
    data = response.get("data") or []
    if not data:
        raise RuntimeError(f"Image response had no data: {response}")
    first = data[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"])
    if first.get("url"):
        with urllib.request.urlopen(first["url"], timeout=120) as image_response:
            return image_response.read()
    raise RuntimeError(f"Image response had no b64_json or url: {response}")


def apply_segment_corrections(
    segment_id: int,
    text: str,
    corrections: list[dict[str, Any]],
) -> str:
    for correction in corrections:
        if correction.get("segment_id") != segment_id:
            continue
        old = correction.get("from")
        new = correction.get("to")
        if not old or not new or not isinstance(old, str) or not isinstance(new, str):
            continue
        if old in text:
            text = text.replace(old, new)
    return normalize_text(text)


def annotation_key(value: dict[str, Any]) -> str:
    label = (
        value.get("name")
        or value.get("label")
        or value.get("term")
        or value.get("theme")
        or value.get("concept")
        or value.get("title")
        or value.get("attributed_to")
        or value.get("attribution")
        or value.get("issue")
        or value.get("text")
        or json.dumps(value, sort_keys=True)
    )
    segment_ids = value.get("segment_ids") or value.get("evidence_segment_ids") or []
    return f"{label}|{segment_ids}"


def dedupe_annotations(annotations: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {}
    for key, values in annotations.items():
        seen: set[str] = set()
        clean_values: list[dict[str, Any]] = []
        for value in values:
            if not isinstance(value, dict):
                continue
            marker = annotation_key(value)
            if marker in seen:
                continue
            seen.add(marker)
            clean_values.append(value)
        output[key] = clean_values
    return output


def yaml_scalar(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def annotation_label(value: dict[str, Any]) -> str:
    return normalize_text(str(
        value.get("name")
        or value.get("label")
        or value.get("term")
        or value.get("theme")
        or value.get("concept")
        or value.get("title")
        or value.get("attributed_to")
        or value.get("attribution")
        or value.get("issue")
        or value.get("text")
        or "annotation"
    ))


def annotation_line(key: str, value: dict[str, Any]) -> str:
    confidence = value.get("confidence")
    conf = f" confidence={confidence}" if confidence is not None else ""
    start = value.get("start") or value.get("start_seconds")
    if start is None and isinstance(value.get("timestamp_range"), dict):
        start = value["timestamp_range"].get("start")
    suffix = f" [{fmt_ts(start)}]" if isinstance(start, (int, float)) else ""

    if key == "quote_candidates":
        who = value.get("attributed_to") or value.get("attribution") or annotation_label(value)
        text = value.get("text")
        who = normalize_text(str(who))
        text = normalize_text(str(text)) if text else text
        return f"{who}: {text}{suffix}{conf}" if text else f"{who}{suffix}{conf}"
    if key == "teacher_passages":
        text = normalize_text(str(value.get("text") or annotation_label(value)))
        return f"{text}{suffix}{conf}"
    if key == "works":
        title = normalize_text(str(value.get("title") or annotation_label(value)))
        creator = value.get("creator")
        byline = f" by {creator}" if creator else ""
        return f"{title}{byline}{suffix}{conf}"
    return f"{annotation_label(value)}{suffix}{conf}"


def segment_link(talk: Talk, seconds: float) -> str:
    return f"{CORPUS.public_base_url.rstrip('/')}/talks/{talk.safe_id}/?t={int(seconds)}"


def write_markdown(
    talk: Talk,
    paths: CorpusPaths,
    corrected: dict[str, Any],
    references_doc: dict[str, Any] | None = None,
) -> Path:
    references_doc = references_doc or load_json(paths.references(talk), {})
    episode_metadata = load_json(paths.episode_metadata(talk), {})
    segments = corrected.get("segments", [])
    references = references_doc.get("references", [])
    concepts = [annotation_label(item) for item in references_doc.get("concepts", [])[:30]]
    people = [item.get("name") for item in references_doc.get("people_index", [])[:30]]
    works = [item.get("title") for item in references_doc.get("works_index", [])[:30]]
    lines = [
        "---",
        f"talk_id: {yaml_scalar(talk.id)}",
        f"source: {yaml_scalar(talk.source)}",
        f"source_id: {yaml_scalar(talk.source_id)}",
        f"teacher: {yaml_scalar(CORPUS.teacher)}",
        f"speaker: {yaml_scalar(talk.speaker)}",
        f"title: {yaml_scalar(talk.title)}",
        f"published_at: {yaml_scalar(talk.published_at)}",
        f"duration: {yaml_scalar(talk.duration)}",
        f"page_url: {yaml_scalar(talk.link)}",
        f"audio_url: {yaml_scalar(talk.audio_url)}",
        f"podcast_description: {yaml_scalar(episode_metadata.get('description'))}",
        f"concepts: {yaml_scalar(concepts)}",
        f"people: {yaml_scalar(people)}",
        f"works: {yaml_scalar(works)}",
        "---",
        "",
        f"# {talk.title}",
        "",
        f"- Source: {talk.source}",
        f"- Published: {talk.published_at}",
        f"- Page: {talk.link}",
        "",
    ]
    if episode_metadata.get("description"):
        lines.extend(["## Episode Description", "", episode_metadata["description"], ""])
    if episode_metadata.get("chapters"):
        lines.extend(["## Podcast Chapters", ""])
        for chapter in episode_metadata.get("chapters", []):
            lines.append(
                f"- [{fmt_ts(chapter.get('start'))}] {chapter.get('title')}: "
                f"{chapter.get('description')}"
            )
        lines.append("")
    lines.extend(["## Transcript", ""])
    for segment in segments:
        ts = fmt_ts(segment.get("start"))
        text = normalize_text(clean_space(segment.get("text", "")))
        lines.append(f"[{ts}] {text}")
        lines.append("")

    if references:
        lines.extend(["## References", ""])
        for ref in references:
            timestamp = fmt_ts(ref.get("start"))
            who = ref.get("person") or ref.get("work_title") or "External reference"
            kind = ref.get("reference_type") or "reference"
            text = (
                ref.get("reference_annotation")
                or ref.get("reference_summary")
                or ref.get("selected_material")
                or ref.get("quote_text")
                or ""
            )
            confidence = ref.get("confidence")
            review = " review-needed" if ref.get("needs_review") else ""
            conf = f" confidence={confidence}" if confidence is not None else ""
            lines.append(
                f"- [{timestamp}] {who} ({kind}{review}{conf}): "
                f"{normalize_text(clean_space(str(text)))}"
            )
        lines.append("")

    if references_doc.get("people_index"):
        lines.extend(["## Referenced People", ""])
        for person in references_doc.get("people_index", []):
            role = f" - {person.get('role')}" if person.get("role") else ""
            lines.append(f"- {person.get('name')}{role} ({person.get('count')} references)")
        lines.append("")

    if references_doc.get("works_index"):
        lines.extend(["## Referenced Works", ""])
        for work in references_doc.get("works_index", []):
            creator = f" by {work.get('creator')}" if work.get("creator") else ""
            lines.append(f"- {work.get('title')}{creator} ({work.get('count')} references)")
        lines.append("")

    path = paths.markdown(talk)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path


def process_talk(
    talk: Talk,
    paths: CorpusPaths,
    state: PipelineState,
    api_key: str,
    glossary: dict[str, Any],
    correction_model: str,
    reference_model: str,
    force: bool = False,
    prepare_only: bool = False,
    skip_correct: bool = False,
    skip_references: bool = False,
) -> None:
    existing = state.get(talk)
    is_complete = (
        paths.markdown(talk).exists()
        and paths.corrected(talk).exists()
        and (skip_references or paths.references(talk).exists())
    )
    if existing.get("status") == "indexed" and is_complete and not force:
        print(f"skip indexed {talk.id}")
        return

    print(f"metadata {talk.id} {talk.title}")
    write_json(paths.metadata(talk), talk.__dict__)
    state.mark(talk, status="metadata")

    print(f"download {talk.id}")
    download_audio(talk, paths, force=force)
    state.mark(talk, status="downloaded", audio=str(paths.audio(talk)))

    print(f"chunk {talk.id}")
    make_chunks(talk, paths, force=force)
    state.mark(talk, status="chunked", chunks=str(paths.chunk_manifest(talk)))

    if prepare_only:
        state.mark(talk, status="prepared")
        return

    print(f"transcribe {talk.id}")
    transcribe_chunks(talk, paths, api_key, glossary, force=force)
    state.mark(talk, status="transcribed", segments=str(paths.segments(talk)))

    if skip_correct:
        state.mark(talk, status="transcribed_uncorrected")
        return

    print(f"correct {talk.id}")
    corrected = correct_segments(talk, paths, api_key, glossary, correction_model, force=force)
    state.mark(talk, status="corrected", corrected=str(paths.corrected(talk)))

    references_doc: dict[str, Any] = {}
    if not skip_references:
        print(f"references {talk.id}")
        references_doc = extract_references(
            talk,
            paths,
            api_key,
            glossary,
            reference_model,
            force=force,
        )
        state.mark(talk, status="referenced", references=str(paths.references(talk)))

    print(f"markdown {talk.id}")
    markdown_path = write_markdown(talk, paths, corrected, references_doc)
    state.mark(talk, status="indexed", markdown=str(markdown_path))


def process_enriched_talk(
    talk: Talk,
    paths: CorpusPaths,
    state: PipelineState,
    api_key: str,
    glossary: dict[str, Any],
    correction_model: str,
    reference_model: str,
    metadata_model: str,
    image_model: str,
    image_size: str,
    image_quality: str,
    force: bool = False,
    skip_artwork: bool = False,
) -> None:
    print(f"metadata {talk.id} {talk.title}")
    write_json(paths.metadata(talk), talk.__dict__)
    state.mark(talk, status="metadata")

    print(f"download {talk.id}")
    download_audio(talk, paths, force=force)
    state.mark(talk, status="downloaded", audio=str(paths.audio(talk)))

    print(f"chunk {talk.id}")
    make_chunks(talk, paths, force=force)
    state.mark(talk, status="chunked", chunks=str(paths.chunk_manifest(talk)))

    print(f"transcribe {talk.id}")
    transcribe_chunks(talk, paths, api_key, glossary, force=force)
    state.mark(talk, status="transcribed", segments=str(paths.segments(talk)))

    print(f"correct {talk.id}")
    corrected = correct_segments(talk, paths, api_key, glossary, correction_model, force=force)
    state.mark(talk, status="corrected", corrected=str(paths.corrected(talk)))

    print(f"references {talk.id}")
    references_doc = extract_references(
        talk,
        paths,
        api_key,
        glossary,
        reference_model,
        force=force,
    )
    state.mark(talk, status="referenced", references=str(paths.references(talk)))

    print(f"episode-metadata {talk.id}")
    episode_metadata = generate_episode_metadata(
        talk,
        paths,
        api_key,
        metadata_model,
        force=force,
    )
    state.mark(
        talk,
        status="episode_metadata",
        episode_metadata=str(paths.episode_metadata(talk)),
        chapters=len(episode_metadata.get("chapters", [])),
    )

    if not skip_artwork:
        print(f"artwork {talk.id}")
        manifest = generate_artwork(
            talk,
            paths,
            api_key,
            image_model,
            image_size=image_size,
            image_quality=image_quality,
            force=force,
        )
        state.mark(
            talk,
            status="artwork",
            artwork=str(paths.artwork_image(talk)),
            artwork_model=manifest.get("image_model"),
        )

    print(f"markdown {talk.id}")
    markdown_path = write_markdown(talk, paths, corrected, references_doc)
    state.mark(
        talk,
        status="enriched",
        markdown=str(markdown_path),
        enriched_at=now_iso(),
    )


def talk_is_enriched(talk: Talk, paths: CorpusPaths, skip_artwork: bool = False) -> bool:
    required = [
        paths.corrected(talk),
        paths.references(talk),
        paths.episode_metadata(talk),
        paths.markdown(talk),
    ]
    if not skip_artwork:
        required.append(paths.artwork_image(talk))
    return all(path.exists() and path.stat().st_size > 0 for path in required)


def select_enrichment_talks(
    talks: dict[str, Talk],
    paths: CorpusPaths,
    limit: int | None,
    force: bool,
    skip_artwork: bool = False,
) -> list[Talk]:
    if limit is not None and limit <= 0:
        return []
    selected: list[Talk] = []
    for talk in talks.values():
        if force or not talk_is_enriched(talk, paths, skip_artwork=skip_artwork):
            selected.append(talk)
        if limit and len(selected) >= limit:
            break
    return selected


def rebuild_public_feed(
    talks_json: Path,
    media_base_url: str,
    copy_artwork: bool,
    artwork_base_url: str | None = None,
    chapters_base_url: str | None = None,
) -> None:
    command = [
        sys.executable,
        str(CORPUS.feed_build_script),
        "--talks-json",
        str(talks_json),
        "--media-base-url",
        media_base_url,
    ]
    if artwork_base_url:
        command.extend(["--artwork-base-url", artwork_base_url])
    if chapters_base_url:
        command.extend(["--chapters-base-url", chapters_base_url])
    if copy_artwork:
        command.append("--copy-artwork")
    subprocess.run(command, cwd=SITE_ROOT, check=True)


def run_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_description_summary_command(
    args: argparse.Namespace,
    talks: dict[str, Talk],
    paths: CorpusPaths,
) -> int:
    talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
    selected = select_description_summary_talks(talks, paths, talk_ids, args.limit)
    timestamp = run_timestamp()
    report_path = (
        args.report_path
        if args.report_path
        else paths.root / "description-summary-reports" / f"{timestamp}.json"
    )
    backup_dir = args.backup_dir if args.backup_dir else paths.root / "description-summary-backups" / timestamp
    report: dict[str, Any] = {
        "created_at": now_iso(),
        "corpus": CORPUS.slug,
        "model": args.metadata_model,
        "dry_run": bool(args.dry_run),
        "selected_count": len(selected),
        "jobs": max(1, int(args.jobs or 1)),
        "items": [],
        "failures": [],
    }
    if not selected:
        print("No talks selected for description/summary regeneration.")
        write_json(report_path, report)
        print(report_path)
        return 0

    print(
        f"Selected {len(selected)} talks for description/summary regeneration "
        f"({report['jobs']} job{'s' if report['jobs'] != 1 else ''})."
    )
    if args.dry_run:
        for talk in selected:
            report["items"].append(
                {
                    "talk_id": talk.id,
                    "safe_id": talk.safe_id,
                    "title": talk.title,
                    "metadata_path": str(paths.episode_metadata(talk)),
                    "status": "dry-run",
                }
            )
            print(f"dry-run {talk.id} {talk.title}")
        write_json(report_path, report)
        print(report_path)
        return 0

    api_key = require_openai_key()

    def process_one(talk: Talk) -> dict[str, Any]:
        metadata_path = paths.episode_metadata(talk)
        original = load_json(metadata_path, {})
        if not isinstance(original, dict) or not original:
            raise RuntimeError(f"No episode metadata found for {talk.id}")
        generated = generate_description_summary(talk, paths, api_key, args.metadata_model)
        backup_path = backup_dir / f"{talk.safe_id}.json"
        write_json(backup_path, original)
        write_json(metadata_path, merge_description_summary_metadata(original, generated))
        return {
            "talk_id": talk.id,
            "safe_id": talk.safe_id,
            "title": talk.title,
            "metadata_path": str(metadata_path),
            "backup_path": str(backup_path),
            "old_description": original.get("description"),
            "old_short_summary": original.get("short_summary"),
            "new_description": generated["description"],
            "new_short_summary": generated["short_summary"],
            "status": "updated",
        }

    jobs = max(1, int(args.jobs or 1))
    if jobs == 1:
        for index, talk in enumerate(selected, start=1):
            print(f"[{index}/{len(selected)}] description-summary {talk.id}")
            try:
                report["items"].append(process_one(talk))
            except Exception as error:
                failure = {"talk_id": talk.id, "safe_id": talk.safe_id, "error": str(error)}
                report["failures"].append(failure)
                print(f"failed {talk.id}: {error}", file=sys.stderr)
                if args.stop_on_error:
                    raise
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
            future_to_talk = {executor.submit(process_one, talk): talk for talk in selected}
            completed = 0
            for future in concurrent.futures.as_completed(future_to_talk):
                talk = future_to_talk[future]
                completed += 1
                try:
                    row = future.result()
                    report["items"].append(row)
                    print(f"[{completed}/{len(selected)}] description-summary {talk.id}")
                except Exception as error:
                    failure = {"talk_id": talk.id, "safe_id": talk.safe_id, "error": str(error)}
                    report["failures"].append(failure)
                    print(f"failed {talk.id}: {error}", file=sys.stderr)
                    if args.stop_on_error:
                        raise

    report["updated_count"] = len(report["items"])
    report["failure_count"] = len(report["failures"])
    write_json(report_path, report)
    print(report_path)

    if args.rebuild_feed:
        rebuild_public_feed(
            args.talks_json,
            args.media_base_url,
            args.copy_artwork,
            artwork_base_url=args.artwork_base_url,
            chapters_base_url=args.chapters_base_url,
        )

    failures = len(report["failures"])
    print(f"Updated {len(report['items'])} talks. Failures: {failures}.")
    return 1 if failures else 0


def clear_lock_dir(lock_dir: Path) -> None:
    if lock_dir.exists():
        shutil.rmtree(lock_dir)


@contextlib.contextmanager
def corpus_run_lock(paths: CorpusPaths) -> Iterable[None]:
    lock_dir = paths.root / "state" / "run-corpus.lock"
    lock_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock_dir.mkdir()
    except FileExistsError:
        age = time.time() - lock_dir.stat().st_mtime
        if age > RUN_CORPUS_LOCK_STALE_SECONDS:
            clear_lock_dir(lock_dir)
            lock_dir.mkdir()
        else:
            raise SystemExit(
                "Another run-corpus job appears to be running. "
                f"Lock: {lock_dir}. Age: {int(age)} seconds."
            )
    write_json(lock_dir / "owner.json", {"pid": os.getpid(), "created_at": now_iso()})
    try:
        yield
    finally:
        clear_lock_dir(lock_dir)


def run_corpus_command(
    args: argparse.Namespace,
    talks: dict[str, Talk],
    paths: CorpusPaths,
    glossary: dict[str, Any],
) -> int:
    require_executable("ffmpeg")
    require_executable("ffprobe")
    if args.update_qmd:
        require_executable("qmd")
    state = PipelineState(paths.state_path)
    selected = select_enrichment_talks(
        talks,
        paths,
        args.limit,
        args.force,
        skip_artwork=args.skip_artwork,
    )
    if not selected:
        print("No pending talks need enrichment.")
        rebuild_public_feed(
            args.talks_json,
            args.media_base_url,
            args.copy_artwork and not args.skip_artwork,
            artwork_base_url=args.artwork_base_url,
            chapters_base_url=args.chapters_base_url,
        )
        return 0

    api_key = require_openai_key()
    feed_every = max(1, int(args.feed_every or 20))
    processed_since_feed = 0
    processed: list[Talk] = []
    failures: list[dict[str, str]] = []
    print(
        f"Selected {len(selected)} talks for enrichment "
        f"(feed rebuild every {feed_every})."
    )
    for index, talk in enumerate(selected, start=1):
        print(f"[{index}/{len(selected)}] enrich {talk.id} {talk.title}")
        try:
            process_enriched_talk(
                talk,
                paths,
                state,
                api_key,
                glossary,
                args.correction_model,
                args.reference_model,
                args.metadata_model,
                args.image_model,
                args.image_size,
                args.image_quality,
                force=args.force,
                skip_artwork=args.skip_artwork,
            )
            processed.append(talk)
            processed_since_feed += 1
        except Exception as error:
            state.mark(
                talk,
                status="failed",
                error=str(error),
                failed_at=now_iso(),
            )
            failures.append({"talk_id": talk.id, "error": str(error)})
            print(f"failed {talk.id}: {error}", file=sys.stderr)
            if args.stop_on_error:
                raise
            continue

        if processed_since_feed >= feed_every:
            if args.update_qmd:
                run_qmd(paths)
            rebuild_public_feed(
                args.talks_json,
                args.media_base_url,
                args.copy_artwork and not args.skip_artwork,
                artwork_base_url=args.artwork_base_url,
                chapters_base_url=args.chapters_base_url,
            )
            processed_since_feed = 0

    if processed_since_feed:
        if args.update_qmd:
            run_qmd(paths)
        rebuild_public_feed(
            args.talks_json,
            args.media_base_url,
            args.copy_artwork and not args.skip_artwork,
            artwork_base_url=args.artwork_base_url,
            chapters_base_url=args.chapters_base_url,
        )
    if args.build_feedback_viewer and processed:
        print(write_feedback_viewer(processed, paths))

    print(f"Processed {len(processed)} talks. Failures: {len(failures)}.")
    for failure in failures:
        print(f"FAILED {failure['talk_id']}: {failure['error']}", file=sys.stderr)
    return 1 if failures and not processed else 0


def clean_existing_transcript(talk: Talk, paths: CorpusPaths) -> dict[str, Any]:
    corrected = load_json(paths.corrected(talk), {})
    if not corrected.get("segments"):
        raise RuntimeError(f"No corrected transcript found for {talk.id}")
    silence_intervals = detect_silence_intervals(paths.audio(talk))
    segments, suppressed = suppress_transcript_artifacts(
        corrected.get("segments", []),
        silence_intervals,
    )
    prior_suppressed = corrected.get("suppressed_segments", [])
    seen_suppressed = {
        int(item.get("segment_id", -1))
        for item in suppressed
        if item.get("segment_id") is not None
    }
    for item in prior_suppressed:
        try:
            segment_id = int(item.get("segment_id", -1))
        except (TypeError, ValueError):
            continue
        if segment_id not in seen_suppressed:
            suppressed.append(item)
            seen_suppressed.add(segment_id)
    corrected["segments"] = segments
    corrected["suppressed_segments"] = sorted(
        suppressed,
        key=lambda item: float(item.get("start", 0)),
    )
    corrected["cleaned_at"] = now_iso()
    write_json(paths.corrected(talk), corrected)
    return corrected


def prune_references_for_segments(
    talk: Talk,
    references_doc: dict[str, Any],
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    if not references_doc:
        return references_doc
    segment_by_id = {int(item["segment_id"]): item for item in segments}
    kept_references: list[dict[str, Any]] = []
    suppressed_references: list[dict[str, Any]] = []
    for raw in references_doc.get("references", []):
        segment_ids = [
            segment_id
            for segment_id in normalize_segment_ids(raw.get("segment_ids"))
            if segment_id in segment_by_id
        ]
        if not segment_ids:
            suppressed_references.append(raw)
            continue
        reference = dict(raw)
        start, end = reference_bounds(segment_ids, segment_by_id, raw)
        person = normalize_optional(reference.get("person"))
        if person and not person_is_supported(person, reference_evidence_text(segment_ids, segment_by_id)):
            reference["person"] = None
            reference["needs_review"] = True
        scrub_reference_artifact_metadata(reference)
        reference["segment_ids"] = segment_ids
        reference["start"] = start
        reference["end"] = end
        reference["timestamp"] = fmt_ts(start)
        kept_references.append(reference)

    result = dict(references_doc)
    result["talk"] = talk.__dict__
    result["references"] = kept_references
    result["suppressed_references"] = suppressed_references
    result["people_index"] = build_people_index(kept_references)
    result["works_index"] = build_works_index(kept_references)
    result["cleaned_at"] = now_iso()
    return result


def scrub_reference_artifact_metadata(reference: dict[str, Any]) -> None:
    for field in ["attribution_cue", "reference_summary", "person_role"]:
        value = reference.get(field)
        if not isinstance(value, str):
            continue
        if any(pattern.search(value) for pattern in REFERENCE_METADATA_ARTIFACT_PATTERNS):
            if field == "reference_summary":
                reference[field] = "Attribution metadata removed after transcript cleanup."
            else:
                reference[field] = None


def load_pilot_ids(path: Path) -> list[str]:
    data = load_json(path, {})
    return [item["id"] for item in data.get("talks", [])]


def select_talks(
    talks: dict[str, Talk],
    paths: CorpusPaths,
    talk_ids: list[str] | None,
    limit: int | None,
    force: bool,
) -> list[Talk]:
    if talk_ids:
        missing = [talk_id for talk_id in talk_ids if talk_id not in talks]
        if missing:
            raise SystemExit(f"Talk ids not found in talks.json: {', '.join(missing)}")
        return [talks[talk_id] for talk_id in talk_ids]

    state = PipelineState(paths.state_path)
    selected: list[Talk] = []
    for talk in talks.values():
        row = state.get(talk)
        if force or row.get("status") != "indexed" or not paths.markdown(talk).exists():
            selected.append(talk)
        if limit and len(selected) >= limit:
            break
    return selected


def run_qmd(paths: CorpusPaths) -> None:
    markdown_dir = paths.markdown_dir
    markdown_dir.mkdir(parents=True, exist_ok=True)
    commands = [
        [
            "qmd",
            "--index",
            CORPUS.qmd_index,
            "collection",
            "add",
            str(markdown_dir),
            "--name",
            CORPUS.qmd_collection,
        ],
        [
            "qmd",
            "--index",
            CORPUS.qmd_index,
            "context",
            "add",
            f"qmd://{CORPUS.qmd_collection}",
            CORPUS.qmd_context,
        ],
        ["qmd", "--index", CORPUS.qmd_index, "update"],
        ["qmd", "--index", CORPUS.qmd_index, "embed"],
    ]
    for command in commands:
        print(" ".join(command))
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            combined = result.stdout + result.stderr
            if "already exists" in combined:
                print(combined.strip())
                continue
            raise subprocess.CalledProcessError(
                result.returncode,
                command,
                output=result.stdout,
                stderr=result.stderr,
            )
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)


def review_talk(talk: Talk, paths: CorpusPaths) -> list[str]:
    issues: list[str] = []
    segments = read_jsonl(paths.segments(talk))
    corrected = load_json(paths.corrected(talk), {})
    markdown = paths.markdown(talk)
    if not segments:
        issues.append("no raw segments")
    if not corrected.get("segments"):
        issues.append("no corrected segments")
    if not markdown.exists():
        issues.append("no markdown")
    last_end = -1.0
    for segment in corrected.get("segments", segments):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", start))
        text = segment.get("text", "")
        if start + 2 < last_end:
            issues.append(f"timestamp regression at {fmt_ts(start)}")
            break
        if end < start:
            issues.append(f"negative segment duration at {fmt_ts(start)}")
            break
        if len(text) > 1200:
            issues.append(f"very long segment at {fmt_ts(start)}")
        last_end = max(last_end, end)
    joined = " ".join(s.get("text", "") for s in corrected.get("segments", segments)).lower()
    suspicious = [
        r"\bdukkah\b",
        r"\bdukha\b",
        r"\bduka\b",
        r"\bdarma\b",
        r"\bajan\b",
        r"\bachan chah\b",
    ]
    for pattern in suspicious:
        if re.search(pattern, joined):
            issues.append(f"suspicious term remains: {pattern}")
    return issues


def write_review(talks: list[Talk], paths: CorpusPaths) -> Path:
    paths.review_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Brensilver Pilot Review",
        "",
        f"Generated: {now_iso()}",
        "",
    ]
    for talk in talks:
        corrected = load_json(paths.corrected(talk), {})
        segments = corrected.get("segments") or read_jsonl(paths.segments(talk))
        references_doc = load_json(paths.references(talk), {})
        issues = review_talk(talk, paths)
        lines.extend(
            [
                f"## {talk.id} - {talk.title}",
                "",
                f"- Source: {talk.source}",
                f"- Duration: {talk.duration}",
                f"- Markdown: {paths.markdown(talk)}",
                f"- Review: {'OK' if not issues else '; '.join(issues)}",
                "",
                "### First Transcript Excerpt",
                "",
            ]
        )
        for segment in segments[:8]:
            lines.append(
                f"[{fmt_ts(segment.get('start'))}] "
                f"{normalize_text(str(segment.get('text', '')))}"
            )
            lines.append("")
        if corrected.get("corrections"):
            lines.append("### Corrections")
            for value in corrected.get("corrections", [])[:8]:
                lines.append(
                    f"- {fmt_ts(segment_start(value, segments))}: "
                    f"{value.get('from')} -> {value.get('to')}"
                )
            lines.append("")
        if corrected.get("uncertain_terms"):
            lines.append("### Uncertain Terms")
            for value in corrected.get("uncertain_terms", [])[:8]:
                lines.append(f"- {annotation_label(value)}")
            lines.append("")
        if references_doc.get("people_index"):
            lines.append("### Referenced People")
            for person in references_doc.get("people_index", [])[:10]:
                lines.append(f"- {person.get('name')} ({person.get('count')})")
            lines.append("")
        if references_doc.get("works_index"):
            lines.append("### Referenced Works")
            for work in references_doc.get("works_index", [])[:10]:
                lines.append(f"- {work.get('title')} ({work.get('count')})")
            lines.append("")
        if references_doc.get("references"):
            lines.append("### References")
            for ref in references_doc.get("references", [])[:12]:
                who = (
                    ref.get("reference_title")
                    or ref.get("person")
                    or ref.get("work_title")
                    or "External reference"
                )
                text = (
                    ref.get("reference_annotation")
                    or ref.get("reference_summary")
                    or ref.get("selected_material")
                    or ref.get("quote_text")
                    or ""
                )
                lines.append(
                    f"- [{fmt_ts(ref.get('start'))}] {who}: "
                    f"{normalize_text(clean_space(str(text)))}"
                )
            lines.append("")
    review_path = paths.review_dir / "pilot-review.md"
    review_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return review_path


def segment_start(value: dict[str, Any], segments: list[dict[str, Any]]) -> float:
    segment_ids = normalize_segment_ids(value.get("segment_ids"))
    if not segment_ids and value.get("segment_id") is not None:
        segment_ids = normalize_segment_ids([value.get("segment_id")])
    by_id = {int(segment.get("segment_id", -1)): segment for segment in segments}
    for segment_id in segment_ids:
        if segment_id in by_id:
            return float(by_id[segment_id].get("start", 0))
    return 0.0


def write_reference_report(talks: list[Talk], paths: CorpusPaths) -> Path:
    paths.review_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Brensilver Reference Extraction Report",
        "",
        f"Generated: {now_iso()}",
        "",
    ]
    total_refs = 0
    needs_review = 0
    for talk in talks:
        refs = load_json(paths.references(talk), {})
        references = refs.get("references", [])
        total_refs += len(references)
        needs_review += sum(1 for ref in references if ref.get("needs_review"))
        lines.extend(
            [
                f"## {talk.id} - {talk.title}",
                "",
                f"- References: {len(references)}",
                f"- Needs review: {sum(1 for ref in references if ref.get('needs_review'))}",
                f"- People: {', '.join(item.get('name', '') for item in refs.get('people_index', [])[:8]) or 'None'}",
                "",
            ]
        )
        for ref in references[:12]:
            who = (
                ref.get("reference_title")
                or ref.get("person")
                or ref.get("work_title")
                or "External reference"
            )
            text = (
                ref.get("reference_annotation")
                or ref.get("reference_summary")
                or ref.get("selected_material")
                or ref.get("quote_text")
                or ""
            )
            flag = " review" if ref.get("needs_review") else ""
            lines.append(
                f"- [{fmt_ts(ref.get('start'))}] {who}{flag}: "
                f"{normalize_text(clean_space(str(text)))}"
            )
        lines.append("")
    lines.insert(4, f"Total references: {total_refs}")
    lines.insert(5, f"Needs review: {needs_review}")
    lines.insert(6, "")
    report_path = paths.review_dir / "reference-report.md"
    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return report_path


def write_prepare_report(talks: list[Talk], paths: CorpusPaths) -> Path:
    paths.review_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Brensilver Pilot Prepare Report",
        "",
        f"Generated: {now_iso()}",
        "",
    ]
    for talk in talks:
        manifest = load_json(paths.chunk_manifest(talk), {})
        chunks = manifest.get("chunks", [])
        max_size = max((chunk.get("size", 0) for chunk in chunks), default=0)
        lines.extend(
            [
                f"## {talk.id} - {talk.title}",
                "",
                f"- Source: {talk.source}",
                f"- Duration: {talk.duration}",
                f"- Audio: {paths.audio(talk)}",
                f"- Chunks: {len(chunks)}",
                f"- Max chunk size MB: {max_size / 1024 / 1024:.2f}",
                "",
            ]
        )
        for chunk in chunks:
            lines.append(
                f"- {chunk['file']}: {fmt_ts(chunk['start'])}-{fmt_ts(chunk['end'])}, "
                f"{chunk['size'] / 1024 / 1024:.2f} MB"
            )
        lines.append("")
    report_path = paths.review_dir / "pilot-prepare-report.md"
    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return report_path


def write_viewer(talks: list[Talk], paths: CorpusPaths) -> Path:
    paths.viewer_dir.mkdir(parents=True, exist_ok=True)
    data = build_viewer_data(talks, paths)
    html = build_viewer_html(data)
    output = paths.viewer_dir / "index.html"
    output.write_text(html, encoding="utf-8")
    return output


def build_viewer_data(talks: list[Talk], paths: CorpusPaths) -> dict[str, Any]:
    viewer_talks: list[dict[str, Any]] = []
    for talk in talks:
        corrected = load_json(paths.corrected(talk), {})
        segments = corrected.get("segments") or []
        if not segments:
            continue
        refs = load_json(paths.references(talk), {})
        viewer_talks.append(
            {
                "id": talk.id,
                "safe_id": talk.safe_id,
                "title": talk.title,
                "source": talk.source,
                "speaker": talk.speaker,
                "published_at": talk.published_at,
                "duration": talk.duration,
                "page_url": talk.link,
                "audio_url": talk.audio_url,
                "segments": [
                    {
                        "segment_id": item.get("segment_id"),
                        "start": item.get("start"),
                        "end": item.get("end"),
                        "timestamp": fmt_ts(item.get("start")),
                        "text": normalize_text(clean_space(str(item.get("text", "")))),
                    }
                    for item in segments
                ],
                "references": refs.get("references", []),
                "people_index": refs.get("people_index", []),
                "works_index": refs.get("works_index", []),
            }
        )
    return {
        "generated_at": now_iso(),
        "talks": viewer_talks,
    }


def build_viewer_html(data: dict[str, Any]) -> str:
    data_json = json.dumps(data, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brensilver Dharma Talk Viewer</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #20211d;
      --muted: #6d7168;
      --line: #d9dccf;
      --paper: #fbfaf5;
      --panel: #ffffff;
      --soft: #eef2e4;
      --accent: #2f6f5e;
      --accent-strong: #174d3f;
      --warm: #b35a32;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    .app {{
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
    }}
    aside {{
      border-right: 1px solid var(--line);
      background: #f4f3eb;
      padding: 18px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }}
    .brand {{
      margin: 0 0 14px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }}
    .search {{
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
    }}
    .talk-list {{
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }}
    .talk-button {{
      display: block;
      width: 100%;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 10px;
      text-align: left;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
    }}
    .talk-button:hover {{ background: rgba(47,111,94,.08); }}
    .talk-button.active {{
      background: var(--panel);
      border-color: var(--accent);
      box-shadow: 0 1px 0 rgba(0,0,0,.04);
    }}
    .talk-title {{ font-weight: 700; line-height: 1.25; }}
    .talk-meta {{ margin-top: 4px; color: var(--muted); font-size: 13px; }}
    main {{
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr;
    }}
    .player {{
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(251,250,245,.94);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line);
      padding: 18px clamp(18px, 4vw, 46px);
    }}
    h1 {{
      margin: 0;
      max-width: 980px;
      font-size: clamp(24px, 3vw, 40px);
      line-height: 1.1;
      letter-spacing: 0;
    }}
    .subhead {{
      margin-top: 8px;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 14px;
    }}
    audio {{
      width: 100%;
      margin-top: 16px;
      display: block;
    }}
    .content {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
      gap: clamp(18px, 3vw, 34px);
      padding: 28px clamp(18px, 4vw, 46px) 48px;
      align-items: start;
    }}
    .transcript {{
      max-width: 920px;
      display: grid;
      gap: 8px;
    }}
    .segment {{
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 14px;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 9px 11px;
      background: transparent;
      cursor: pointer;
      text-align: left;
      color: var(--ink);
      font: inherit;
    }}
    .segment:hover {{ background: var(--soft); }}
    .segment.active {{
      background: #ffffff;
      border-color: rgba(47,111,94,.42);
      box-shadow: 0 1px 0 rgba(0,0,0,.04);
    }}
    .time {{
      color: var(--accent-strong);
      font-variant-numeric: tabular-nums;
      font-size: 14px;
      padding-top: 1px;
    }}
    .text {{ min-width: 0; }}
    .refs {{
      position: sticky;
      top: 132px;
      border-left: 1px solid var(--line);
      padding-left: 20px;
      max-height: calc(100vh - 154px);
      overflow: auto;
    }}
    .refs h2 {{
      margin: 0 0 10px;
      font-size: 16px;
      letter-spacing: 0;
    }}
    .ref-group {{ margin: 0 0 18px; }}
    .ref-button {{
      width: 100%;
      display: block;
      border: 0;
      border-radius: 8px;
      background: transparent;
      padding: 8px;
      text-align: left;
      color: var(--ink);
      cursor: pointer;
      font: inherit;
    }}
    .ref-button:hover {{ background: var(--soft); }}
    .ref-person {{ font-weight: 700; color: var(--accent-strong); }}
    .ref-text {{ margin-top: 3px; color: var(--muted); font-size: 13px; }}
    .empty {{
      color: var(--muted);
      padding: 24px 0;
    }}
    @media (max-width: 900px) {{
      .app {{ grid-template-columns: 1fr; }}
      aside {{
        position: relative;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }}
      .content {{ grid-template-columns: 1fr; }}
      .refs {{
        position: static;
        max-height: none;
        border-left: 0;
        border-top: 1px solid var(--line);
        padding: 20px 0 0;
      }}
    }}
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <h2 class="brand">Brensilver Talks</h2>
      <input class="search" id="search" type="search" placeholder="Search talks, references, transcript">
      <div class="talk-list" id="talkList"></div>
    </aside>
    <main>
      <section class="player">
        <h1 id="title"></h1>
        <div class="subhead" id="meta"></div>
        <audio id="audio" controls preload="metadata"></audio>
      </section>
      <section class="content">
        <div class="transcript" id="transcript"></div>
        <div class="refs" id="references"></div>
      </section>
    </main>
  </div>
  <script id="viewer-data" type="application/json">{data_json}</script>
  <script>
    const data = JSON.parse(document.getElementById('viewer-data').textContent);
    const talkList = document.getElementById('talkList');
    const search = document.getElementById('search');
    const title = document.getElementById('title');
    const meta = document.getElementById('meta');
    const audio = document.getElementById('audio');
    const transcript = document.getElementById('transcript');
    const references = document.getElementById('references');
    let currentTalk = data.talks[0] || null;
    let activeSegmentId = null;

    function matches(talk, query) {{
      if (!query) return true;
      const hay = [
        talk.title,
        talk.source,
        talk.published_at,
        talk.segments.map(s => s.text).join(' '),
        talk.references.map(r => [r.person, r.work_title, r.quote_text, r.reference_summary].join(' ')).join(' ')
      ].join(' ').toLowerCase();
      return hay.includes(query.toLowerCase());
    }}

    function renderTalkList() {{
      const query = search.value.trim();
      talkList.innerHTML = '';
      data.talks.filter(t => matches(t, query)).forEach(talk => {{
        const button = document.createElement('button');
        button.className = 'talk-button' + (currentTalk && talk.id === currentTalk.id ? ' active' : '');
        button.dataset.talkId = talk.id;
        button.innerHTML = `<div class="talk-title">${{escapeHtml(talk.title)}}</div><div class="talk-meta">${{escapeHtml(talk.source)}} · ${{escapeHtml(talk.duration || '')}}</div>`;
        button.addEventListener('click', () => loadTalk(talk.id));
        talkList.appendChild(button);
      }});
    }}

    function loadTalk(id) {{
      currentTalk = data.talks.find(t => t.id === id) || data.talks[0];
      activeSegmentId = null;
      title.textContent = currentTalk.title;
      meta.innerHTML = `<span>${{escapeHtml(currentTalk.source)}}</span><span>${{escapeHtml(currentTalk.duration || '')}}</span><span>${{escapeHtml((currentTalk.published_at || '').slice(0, 10))}}</span>`;
      audio.src = currentTalk.audio_url;
      renderTalkList();
      renderTranscript();
      renderReferences();
      history.replaceState(null, '', '#' + currentTalk.safe_id);
    }}

    function setActiveSegment(segmentId, reveal) {{
      activeSegmentId = segmentId;
      document.querySelectorAll('.segment.active').forEach(el => el.classList.remove('active'));
      const active = document.querySelector(`.segment[data-segment-id="${{activeSegmentId}}"]`);
      if (active) {{
        active.classList.add('active');
        if (reveal) active.scrollIntoView({{ block: 'center', behavior: 'smooth' }});
      }}
    }}

    function seekTo(seconds) {{
      const target = Math.max(0, Number(seconds) || 0);
      audio.currentTime = target;
      const segment = currentTalk.segments.find(s => target >= s.start && target < s.end);
      if (segment) setActiveSegment(segment.segment_id, true);
      audio.play().catch(() => {{}});
    }}

    function renderTranscript() {{
      transcript.innerHTML = '';
      if (!currentTalk) return;
      currentTalk.segments.forEach(segment => {{
        const button = document.createElement('button');
        button.className = 'segment' + (segment.segment_id === activeSegmentId ? ' active' : '');
        button.dataset.start = segment.start;
        button.dataset.segmentId = segment.segment_id;
        button.innerHTML = `<span class="time">${{escapeHtml(segment.timestamp)}}</span><span class="text">${{escapeHtml(segment.text)}}</span>`;
        button.addEventListener('click', () => seekTo(segment.start));
        transcript.appendChild(button);
      }});
    }}

    function renderReferences() {{
      references.innerHTML = '<h2>References</h2>';
      if (!currentTalk || !currentTalk.references.length) {{
        references.insertAdjacentHTML('beforeend', '<div class="empty">No references extracted yet.</div>');
        return;
      }}
      const groups = new Map();
      currentTalk.references.forEach(ref => {{
        const key = ref.person || ref.work_title || 'External references';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ref);
      }});
      groups.forEach((items, key) => {{
        const group = document.createElement('div');
        group.className = 'ref-group';
        group.innerHTML = `<h2>${{escapeHtml(key)}}</h2>`;
        items.forEach(ref => {{
          const button = document.createElement('button');
          button.className = 'ref-button';
          button.dataset.refId = ref.reference_id || '';
          button.dataset.start = ref.start;
          const text = ref.quote_text || ref.reference_summary || ref.reference_type || '';
          button.innerHTML = `<div class="ref-person">${{escapeHtml(ref.timestamp || '')}} · ${{escapeHtml(ref.reference_type || 'reference')}}</div><div class="ref-text">${{escapeHtml(text)}}</div>`;
          button.addEventListener('click', () => seekTo(ref.start));
          group.appendChild(button);
        }});
        references.appendChild(group);
      }});
    }}

    function updateActiveSegment() {{
      if (!currentTalk) return;
      const time = audio.currentTime;
      const segment = currentTalk.segments.find(s => time >= s.start && time < s.end);
      if (!segment || segment.segment_id === activeSegmentId) return;
      setActiveSegment(segment.segment_id, false);
    }}

    function escapeHtml(value) {{
      return String(value || '').replace(/[&<>"']/g, ch => ({{
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }}[ch]));
    }}

    search.addEventListener('input', renderTalkList);
    audio.addEventListener('timeupdate', updateActiveSegment);
    const hash = location.hash.replace('#', '');
    const initial = data.talks.find(t => t.safe_id === hash) || data.talks[0];
    if (initial) loadTalk(initial.id);
  </script>
</body>
</html>
"""


def write_feedback_viewer(talks: list[Talk], paths: CorpusPaths) -> Path:
    paths.feedback_viewer_dir.mkdir(parents=True, exist_ok=True)
    data = build_feedback_viewer_data(talks, paths)
    html = build_feedback_viewer_html(data)
    output = paths.feedback_viewer_dir / "index.html"
    output.write_text(html, encoding="utf-8")
    return output


def build_feedback_viewer_data(talks: list[Talk], paths: CorpusPaths) -> dict[str, Any]:
    viewer_talks: dict[str, dict[str, Any]] = {}
    items: list[dict[str, Any]] = []
    for talk in talks:
        corrected = load_json(paths.corrected(talk), {})
        segments = corrected.get("segments") or []
        if not segments:
            continue
        references_doc = load_json(paths.references(talk), {})
        episode_metadata = load_json(paths.episode_metadata(talk), {})
        artwork_manifest = load_json(paths.artwork_manifest(talk), {})
        talk_record = {
            "id": talk.id,
            "safe_id": talk.safe_id,
            "title": talk.title,
            "source": talk.source,
            "duration": talk.duration,
            "published_at": talk.published_at,
            "audio_url": talk.audio_url,
            "segments": [
                {
                    "segment_id": item.get("segment_id"),
                    "start": item.get("start"),
                    "end": item.get("end"),
                    "timestamp": fmt_ts(item.get("start")),
                    "text": normalize_text(clean_space(str(item.get("text", "")))),
                }
                for item in segments
            ],
            "suppressed_segments": [
                {
                    "segment_id": item.get("segment_id"),
                    "start": item.get("start"),
                    "end": item.get("end"),
                    "timestamp": fmt_ts(item.get("start")),
                    "text": normalize_text(clean_space(str(item.get("text", "")))),
                    "reason": item.get("suppression_reason"),
                }
                for item in corrected.get("suppressed_segments", [])
            ],
            "references": references_doc.get("references", []),
            "episode_metadata": episode_metadata,
            "artwork": artwork_manifest,
        }
        viewer_talks[talk.id] = talk_record
        items.extend(build_feedback_items_for_talk(talk, corrected, references_doc, episode_metadata, artwork_manifest))

    priority_order = {"needs_review": 0, "audit": 1, "context": 2}
    items.sort(
        key=lambda item: (
            priority_order.get(item.get("review_status"), 3),
            item["talk_title"].lower(),
            item["start"],
            item["type"],
        )
    )
    return {
        "generated_at": now_iso(),
        "talks": viewer_talks,
        "items": items,
    }


def build_feedback_items_for_talk(
    talk: Talk,
    corrected: dict[str, Any],
    references_doc: dict[str, Any],
    episode_metadata: dict[str, Any],
    artwork_manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    segments = corrected.get("segments") or []
    items: list[dict[str, Any]] = []
    if episode_metadata:
        chapters = episode_metadata.get("chapters") or []
        start = float(chapters[0].get("start", 0)) if chapters else 0.0
        end = float(chapters[-1].get("end", start)) if chapters else start
        chapter_text = "\n".join(
            f"[{fmt_ts(chapter.get('start'))}] {chapter.get('title')}: {chapter.get('description')}"
            for chapter in chapters
        )
        items.append(
            feedback_item(
                talk,
                item_id=f"{talk.safe_id}-episode-metadata",
                item_type="episode_metadata",
                start=start,
                end=end,
                title="Episode description and chapters",
                summary=episode_metadata.get("description") or talk.title,
                text=chapter_text,
                segment_ids=[],
                suppressed_segment_ids=[],
                context_segments=segments,
                review_status=(
                    "needs_review"
                    if episode_metadata.get("metadata_needs_review")
                    else "audit"
                ),
                review_reason=(
                    "Metadata model flagged source caveats"
                    if episode_metadata.get("metadata_needs_review")
                    else "Pilot metadata audit"
                ),
                detail={
                    "short_summary": episode_metadata.get("short_summary"),
                    "topics": episode_metadata.get("topics"),
                    "source_caveats": episode_metadata.get("source_caveats"),
                    "metadata_needs_review": episode_metadata.get("metadata_needs_review"),
                },
            )
        )
    if artwork_manifest:
        items.append(
            feedback_item(
                talk,
                item_id=f"{talk.safe_id}-artwork",
                item_type="artwork",
                start=0.0,
                end=0.0,
                title="Episode artwork",
                summary=Path(artwork_manifest.get("image_path", "")).name or "Generated artwork",
                text=artwork_manifest.get("prompt") or "",
                segment_ids=[],
                suppressed_segment_ids=[],
                context_segments=segments,
                review_status="audit",
                review_reason="Pilot artwork audit",
                detail={
                    "image_src": artwork_manifest.get("relative_image_src"),
                    "image_model": artwork_manifest.get("image_model"),
                    "requested_image_model": artwork_manifest.get("requested_image_model"),
                    "quality": artwork_manifest.get("quality"),
                },
            )
        )

    for index, group in enumerate(group_suppressed_segments(corrected.get("suppressed_segments", [])), 1):
        start = min(float(item.get("start", 0)) for item in group)
        end = max(float(item.get("end", start)) for item in group)
        reason = group[0].get("suppression_reason") or "suppressed transcript"
        phrase = normalize_text(clean_space(str(group[0].get("text", ""))))
        items.append(
            feedback_item(
                talk,
                item_id=f"{talk.safe_id}-suppressed-{index:03d}",
                item_type="suppressed",
                start=start,
                end=end,
                title=suppression_title(reason),
                summary=phrase or reason,
                text="\n".join(
                    f"[{fmt_ts(item.get('start'))}] {normalize_text(clean_space(str(item.get('text', ''))))}"
                    for item in group[:8]
                ),
                segment_ids=[],
                suppressed_segment_ids=[
                    int(item["segment_id"])
                    for item in group
                    if item.get("segment_id") is not None
                ],
                context_segments=segments,
                review_status="needs_review",
                review_reason="Suppressed transcript span should be spot-checked",
                detail={"reason": reason, "count": len(group)},
            )
        )

    for index, term in enumerate(corrected.get("uncertain_terms", []), 1):
        start = segment_start(term, segments)
        text = annotation_label(term)
        items.append(
            feedback_item(
                talk,
                item_id=f"{talk.safe_id}-uncertain-{index:03d}",
                item_type="uncertain_term",
                start=start,
                end=start + 10,
                title="Uncertain transcript term",
                summary=text,
                text=normalize_text(clean_space(str(term.get("reason") or text))),
                segment_ids=normalize_segment_ids(term.get("segment_ids")),
                suppressed_segment_ids=[],
                context_segments=segments,
                review_status="needs_review",
                review_reason="Correction model marked this transcript term as uncertain",
                detail=term,
            )
        )

    for ref in references_doc.get("references", []):
        start = float(ref.get("start", 0))
        end = float(ref.get("end", start))
        who = (
            ref.get("reference_title")
            or ref.get("person")
            or ref.get("work_title")
            or "External reference"
        )
        text = (
            ref.get("reference_annotation")
            or ref.get("reference_summary")
            or ref.get("selected_material")
            or ref.get("quote_text")
            or ""
        )
        items.append(
            feedback_item(
                talk,
                item_id=ref.get("reference_id") or f"{talk.safe_id}-reference-{len(items) + 1:03d}",
                item_type="reference",
                start=start,
                end=end,
                title=f"{'Reference review' if ref.get('needs_review') else 'Reference'}: {who}",
                summary=normalize_text(clean_space(str(text))),
                text=normalize_text(clean_space(str(ref.get("selected_material") or ref.get("attribution_cue") or text))),
                segment_ids=normalize_segment_ids(ref.get("segment_ids")),
                suppressed_segment_ids=[],
                context_segments=segments,
                review_status=(
                    "needs_review"
                    if ref.get("needs_review") or coerce_confidence(ref.get("confidence")) < 0.65
                    else "audit"
                ),
                review_reason=(
                    "Reference attribution or span is uncertain"
                    if ref.get("needs_review") or coerce_confidence(ref.get("confidence")) < 0.65
                    else "Reference moment audit"
                ),
                detail={
                    "confidence": ref.get("confidence"),
                    "needs_review": ref.get("needs_review"),
                    "reference_type": ref.get("reference_type"),
                    "reference_title": ref.get("reference_title"),
                    "person": ref.get("person"),
                    "person_role": ref.get("person_role"),
                    "work_title": ref.get("work_title"),
                    "work_type": ref.get("work_type"),
                },
            )
        )
    return items


def feedback_item(
    talk: Talk,
    item_id: str,
    item_type: str,
    start: float,
    end: float,
    title: str,
    summary: str,
    text: str,
    segment_ids: list[int],
    suppressed_segment_ids: list[int],
    context_segments: list[dict[str, Any]],
    review_status: str,
    review_reason: str,
    detail: dict[str, Any],
) -> dict[str, Any]:
    context_start, context_end = feedback_context_bounds(start, end, context_segments)
    return {
        "id": item_id,
        "type": item_type,
        "talk_id": talk.id,
        "talk_title": talk.title,
        "source": talk.source,
        "start": round(start, 3),
        "end": round(max(end, start), 3),
        "timestamp": fmt_ts(start),
        "context_start": context_start,
        "context_end": context_end,
        "title": title,
        "summary": summary,
        "text": text,
        "segment_ids": segment_ids,
        "suppressed_segment_ids": suppressed_segment_ids,
        "review_status": review_status,
        "review_reason": review_reason,
        "detail": detail,
    }


def feedback_context_bounds(
    start: float,
    end: float,
    segments: list[dict[str, Any]],
    padding: float = 45.0,
) -> tuple[float, float]:
    if not segments:
        return max(0.0, start - padding), end + padding
    lower = max(0.0, start - padding)
    upper = end + padding
    nearby = [
        item
        for item in segments
        if float(item.get("end", 0)) >= lower and float(item.get("start", 0)) <= upper
    ]
    if not nearby:
        return lower, upper
    return (
        max(0.0, min(float(item.get("start", 0)) for item in nearby) - 2),
        max(float(item.get("end", 0)) for item in nearby) + 2,
    )


def group_suppressed_segments(values: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_key: tuple[str, str] | None = None
    for item in sorted(values, key=lambda row: float(row.get("start", 0))):
        key = (
            str(item.get("suppression_reason") or ""),
            transcript_phrase_key(str(item.get("text", ""))),
        )
        if current and current_key == key:
            gap = float(item.get("start", 0)) - float(current[-1].get("end", 0))
            if gap <= REPEATED_ARTIFACT_MAX_GAP_SECONDS:
                current.append(item)
                continue
        if current:
            groups.append(current)
        current = [item]
        current_key = key
    if current:
        groups.append(current)
    return groups


def suppression_title(reason: str) -> str:
    if "boilerplate" in reason:
        return "Suppressed boilerplate"
    if "repeated" in reason:
        return "Suppressed repeated phrase"
    if "silence" in reason:
        return "Suppressed silence artifact"
    if "punctuation" in reason:
        return "Suppressed punctuation artifact"
    return "Suppressed transcript span"


def build_feedback_viewer_html(data: dict[str, Any]) -> str:
    data_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brensilver Review Queue</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f211d;
      --muted: #697064;
      --paper: #fbfaf4;
      --panel: #ffffff;
      --soft: #edf2e4;
      --line: #d8ddcf;
      --accent: #285f52;
      --accent-2: #8d4e2f;
      --warn: #f7eadb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr) minmax(260px, 340px);
    }
    aside, .inspector {
      height: 100vh;
      overflow: auto;
      position: sticky;
      top: 0;
      background: #f2f1e9;
      padding: 18px;
    }
    aside { border-right: 1px solid var(--line); }
    .inspector { border-left: 1px solid var(--line); }
    h1, h2, h3 { letter-spacing: 0; line-height: 1.15; }
    h1 { margin: 0; font-size: 30px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    .toolbar {
      display: grid;
      gap: 8px;
      margin: 14px 0;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
      padding: 10px 11px;
    }
    textarea {
      min-height: 150px;
      resize: vertical;
    }
    .queue {
      display: grid;
      gap: 8px;
    }
    .item {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--ink);
      padding: 10px;
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .item:hover { background: rgba(40, 95, 82, .08); }
    .item.needs-review { box-shadow: inset 3px 0 0 rgba(141,78,47,.72); }
    .item.active {
      background: var(--panel);
      border-color: var(--accent);
      box-shadow: 0 1px 0 rgba(0,0,0,.04);
    }
    .item.done { opacity: .56; }
    .item-title { font-weight: 750; line-height: 1.25; }
    .item-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 1px 8px;
      color: var(--muted);
      font-size: 12px;
      background: rgba(255,255,255,.58);
    }
    main {
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .player {
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(251,250,244,.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line);
      padding: 20px clamp(18px, 4vw, 46px);
    }
    .meta {
      margin-top: 8px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      color: var(--muted);
    }
    audio {
      display: block;
      width: 100%;
      margin-top: 16px;
    }
    .focus {
      padding: 24px clamp(18px, 4vw, 46px) 50px;
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .item-copy {
      max-width: 900px;
      border-left: 3px solid var(--accent);
      padding-left: 14px;
    }
    .item-copy .summary {
      font-size: 18px;
      line-height: 1.45;
    }
    .context {
      max-width: 980px;
      display: grid;
      gap: 7px;
    }
    .row {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 14px;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 9px 11px;
      background: transparent;
      color: var(--ink);
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .row:hover { background: var(--soft); }
    .row.target {
      border-color: rgba(40,95,82,.45);
      background: #ffffff;
    }
    .row.suppressed {
      background: var(--warn);
      border-color: rgba(141,78,47,.35);
    }
    .row.active { outline: 2px solid rgba(40,95,82,.35); }
    .time {
      color: var(--accent);
      font-variant-numeric: tabular-nums;
      font-size: 13px;
    }
    .row-text { min-width: 0; }
    .subtle {
      color: var(--muted);
      font-size: 13px;
      margin-top: 2px;
    }
    .status-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 12px 0;
    }
    .status-button, .export {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 9px 10px;
      color: var(--ink);
      cursor: pointer;
      font: inherit;
    }
    .status-button.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .export { width: 100%; margin-top: 12px; }
    .art-preview {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--line);
      margin: 0 0 12px;
      background: var(--soft);
    }
    .empty {
      color: var(--muted);
      padding: 24px 0;
    }
    @media (max-width: 1050px) {
      .app { grid-template-columns: 1fr; }
      aside, .inspector {
        position: relative;
        height: auto;
        border: 0;
        border-bottom: 1px solid var(--line);
      }
      aside {
        max-height: 42vh;
      }
      .inspector {
        border-top: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <h2>Review Queue</h2>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search">
        <select id="typeFilter">
          <option value="all">All items</option>
          <option value="episode_metadata">Descriptions & chapters</option>
          <option value="artwork">Artwork</option>
          <option value="reference">References</option>
          <option value="suppressed">Suppressed transcript</option>
          <option value="uncertain_term">Uncertain terms</option>
        </select>
        <select id="priorityFilter">
          <option value="all">All priorities</option>
          <option value="needs_review">Needs review</option>
          <option value="audit">Audit</option>
          <option value="context">Context</option>
        </select>
        <select id="stateFilter">
          <option value="all">All states</option>
          <option value="open">Open</option>
          <option value="ok">OK</option>
          <option value="fix">Needs fix</option>
          <option value="restore">Restore</option>
          <option value="skip">Skip</option>
        </select>
      </div>
      <div class="queue" id="queue"></div>
    </aside>
    <main>
      <section class="player">
        <h1 id="talkTitle"></h1>
        <div class="meta" id="talkMeta"></div>
        <audio id="audio" controls preload="metadata"></audio>
      </section>
      <section class="focus">
        <div class="item-copy">
          <div class="meta" id="itemMeta"></div>
          <div class="summary" id="itemSummary"></div>
          <div class="subtle" id="itemText"></div>
        </div>
        <div class="context" id="context"></div>
      </section>
    </main>
    <section class="inspector">
      <h2>Feedback</h2>
      <div id="detail"></div>
      <div class="status-grid" id="statusButtons"></div>
      <textarea id="note" placeholder="Note or correction"></textarea>
      <button class="export" id="exportButton">Export JSON</button>
    </section>
  </div>
  <script id="viewer-data" type="application/json">__DATA__</script>
  <script>
    const data = JSON.parse(document.getElementById('viewer-data').textContent);
    const queue = document.getElementById('queue');
    const search = document.getElementById('search');
    const typeFilter = document.getElementById('typeFilter');
    const priorityFilter = document.getElementById('priorityFilter');
    const stateFilter = document.getElementById('stateFilter');
    const talkTitle = document.getElementById('talkTitle');
    const talkMeta = document.getElementById('talkMeta');
    const itemMeta = document.getElementById('itemMeta');
    const itemSummary = document.getElementById('itemSummary');
    const itemText = document.getElementById('itemText');
    const context = document.getElementById('context');
    const audio = document.getElementById('audio');
    const detail = document.getElementById('detail');
    const statusButtons = document.getElementById('statusButtons');
    const note = document.getElementById('note');
    const exportButton = document.getElementById('exportButton');
    const feedbackKey = '__FEEDBACK_KEY__';
    const feedback = JSON.parse(localStorage.getItem(feedbackKey) || '{}');
    const statuses = [
      ['ok', 'OK'],
      ['fix', 'Needs fix'],
      ['restore', 'Restore'],
      ['skip', 'Skip']
    ];
    let currentItem = null;
    let currentTalk = null;

    function saveFeedback() {
      localStorage.setItem(feedbackKey, JSON.stringify(feedback));
    }

    function getState(id) {
      return feedback[id] || { status: 'open', note: '' };
    }

    function matches(item) {
      const state = getState(item.id);
      const query = search.value.trim().toLowerCase();
      if (typeFilter.value !== 'all' && item.type !== typeFilter.value) return false;
      if (priorityFilter.value !== 'all' && item.review_status !== priorityFilter.value) return false;
      if (stateFilter.value !== 'all' && state.status !== stateFilter.value) return false;
      if (!query) return true;
      return [item.talk_title, item.title, item.summary, item.text, item.source, item.timestamp, item.review_status, item.review_reason]
        .join(' ')
        .toLowerCase()
        .includes(query);
    }

    function renderQueue() {
      queue.innerHTML = '';
      const visible = data.items.filter(matches);
      if (!visible.length) {
        queue.innerHTML = '<div class="empty">No matching items.</div>';
        return;
      }
      visible.forEach(item => {
        const state = getState(item.id);
        const button = document.createElement('button');
        button.className = 'item' +
          (item.review_status === 'needs_review' ? ' needs-review' : '') +
          (currentItem && item.id === currentItem.id ? ' active' : '') +
          (state.status !== 'open' ? ' done' : '');
        button.innerHTML = `<div class="item-title">${escapeHtml(item.title)}</div>
          <div class="item-meta"><span>${escapeHtml(item.talk_title)}</span><span>${escapeHtml(item.timestamp)}</span><span>${escapeHtml(item.review_status || 'audit')}</span><span>${escapeHtml(state.status)}</span></div>`;
        button.addEventListener('click', () => loadItem(item.id, true));
        queue.appendChild(button);
      });
    }

    function loadItem(id, shouldPlay) {
      currentItem = data.items.find(item => item.id === id) || data.items[0];
      currentTalk = data.talks[currentItem.talk_id];
      talkTitle.textContent = currentTalk.title;
      talkMeta.innerHTML = `<span>${escapeHtml(currentTalk.source)}</span><span>${escapeHtml(currentTalk.duration || '')}</span><span>${escapeHtml((currentTalk.published_at || '').slice(0, 10))}</span>`;
      audio.src = currentTalk.audio_url;
      const seekTarget = Math.max(0, Number(currentItem.start || 0) - 4);
      audio.currentTime = seekTarget;
      itemMeta.innerHTML = `<span class="pill">${escapeHtml(currentItem.type)}</span><span class="pill">${escapeHtml(currentItem.timestamp)}</span><span class="pill">${escapeHtml(currentItem.review_status || 'audit')}</span>`;
      itemSummary.textContent = currentItem.summary || currentItem.title;
      itemText.textContent = currentItem.text || '';
      renderContext();
      renderInspector();
      renderQueue();
      history.replaceState(null, '', '#' + currentItem.id);
      if (shouldPlay) audio.play().catch(() => {});
    }

    function renderContext() {
      context.innerHTML = '';
      const rows = [];
      currentTalk.segments.forEach(segment => {
        if (segment.end >= currentItem.context_start && segment.start <= currentItem.context_end) {
          rows.push({ kind: 'segment', ...segment });
        }
      });
      currentTalk.suppressed_segments.forEach(segment => {
        if (segment.end >= currentItem.context_start && segment.start <= currentItem.context_end) {
          rows.push({ kind: 'suppressed', ...segment });
        }
      });
      rows.sort((a, b) => Number(a.start) - Number(b.start));
      if (!rows.length) {
        context.innerHTML = '<div class="empty">No context.</div>';
        return;
      }
      rows.forEach(row => {
        const button = document.createElement('button');
        const isTarget = (row.kind === 'segment' && currentItem.segment_ids.includes(row.segment_id)) ||
          (row.kind === 'suppressed' && currentItem.suppressed_segment_ids.includes(row.segment_id));
        button.className = `row ${row.kind === 'suppressed' ? 'suppressed' : ''} ${isTarget ? 'target' : ''}`;
        button.dataset.start = row.start;
        button.innerHTML = `<span class="time">${escapeHtml(row.timestamp)}</span>
          <span class="row-text">${escapeHtml(row.text)}${row.kind === 'suppressed' ? `<div class="subtle">${escapeHtml(row.reason || 'suppressed')}</div>` : ''}</span>`;
        button.addEventListener('click', () => {
          audio.currentTime = Math.max(0, Number(row.start) || 0);
          audio.play().catch(() => {});
          document.querySelectorAll('.row.active').forEach(el => el.classList.remove('active'));
          button.classList.add('active');
        });
        context.appendChild(button);
      });
    }

    function renderInspector() {
      const state = getState(currentItem.id);
      const image = currentItem.detail && currentItem.detail.image_src
        ? `<img class="art-preview" src="${escapeHtml(currentItem.detail.image_src)}" alt="">`
        : '';
      detail.innerHTML = `${image}<h3>${escapeHtml(currentItem.title)}</h3>
        <div class="subtle">${escapeHtml(currentItem.talk_title)}</div>
        <div class="subtle">${escapeHtml(currentItem.review_reason || '')}</div>
        <pre class="subtle">${escapeHtml(JSON.stringify(currentItem.detail || {}, null, 2))}</pre>`;
      statusButtons.innerHTML = '';
      statuses.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.className = 'status-button' + (state.status === value ? ' active' : '');
        button.textContent = label;
        button.addEventListener('click', () => {
          feedback[currentItem.id] = { ...getState(currentItem.id), status: value, updated_at: new Date().toISOString() };
          saveFeedback();
          renderInspector();
          renderQueue();
        });
        statusButtons.appendChild(button);
      });
      note.value = state.note || '';
    }

    note.addEventListener('input', () => {
      if (!currentItem) return;
      feedback[currentItem.id] = { ...getState(currentItem.id), note: note.value, updated_at: new Date().toISOString() };
      saveFeedback();
    });

    exportButton.addEventListener('click', () => {
      const payload = {
        exported_at: new Date().toISOString(),
        items: data.items.map(item => ({ ...item, feedback: getState(item.id) }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '__FEEDBACK_EXPORT__';
      link.click();
      URL.revokeObjectURL(url);
    });

    function updateActiveRow() {
      const time = audio.currentTime;
      let best = null;
      currentTalk.segments.forEach(segment => {
        if (time >= segment.start && time < segment.end) best = segment;
      });
      if (!best) return;
      document.querySelectorAll('.row.active').forEach(el => el.classList.remove('active'));
      const row = Array.from(document.querySelectorAll('.row')).find(el => Number(el.dataset.start) === Number(best.start));
      if (row) row.classList.add('active');
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }

    [search, typeFilter, priorityFilter, stateFilter].forEach(el => el.addEventListener('input', renderQueue));
    audio.addEventListener('timeupdate', updateActiveRow);
    const hash = location.hash.replace('#', '');
    loadItem((data.items.find(item => item.id === hash) || data.items[0] || {}).id, false);
  </script>
</body>
</html>
"""
    return (
        html.replace("__DATA__", data_json)
        .replace("__FEEDBACK_KEY__", f"{CORPUS.slug}-review-feedback-v1")
        .replace("__FEEDBACK_EXPORT__", f"{CORPUS.slug}-feedback.json")
    )


def apply_corpus_defaults(args: argparse.Namespace, corpus: CorpusConfig) -> None:
    if not args.corpus_config:
        return
    if args.talks_json == DEFAULT_TALKS_JSON:
        args.talks_json = corpus.talks_json
    if args.corpus_dir == DEFAULT_CORPUS_DIR:
        args.corpus_dir = corpus.corpus_dir
    if args.glossary == DEFAULT_GLOSSARY:
        args.glossary = corpus.glossary
    if args.env_file == DEFAULT_ENV_FILE:
        args.env_file = corpus.env_file
    if (
        hasattr(args, "media_base_url")
        and args.media_base_url == DEFAULT_FEED_MEDIA_BASE_URL
    ):
        args.media_base_url = corpus.feed_media_base_url


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local transcript pipeline for configured audio corpora")
    parser.add_argument("--corpus-config", type=Path)
    parser.add_argument("--talks-json", type=Path, default=DEFAULT_TALKS_JSON)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--glossary", type=Path, default=DEFAULT_GLOSSARY)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--correction-model", default="gpt-5.4-mini")
    parser.add_argument("--reference-model", default="gpt-5.4-mini")
    parser.add_argument("--metadata-model", default="gpt-5.4-mini")
    parser.add_argument("--force", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    pilot = subparsers.add_parser("pilot", help="Process the configured five-talk pilot")
    pilot.add_argument("--pilot-config", type=Path, default=DEFAULT_PILOT_CONFIG)
    pilot.add_argument("--prepare-only", action="store_true")
    pilot.add_argument("--skip-correct", action="store_true")
    pilot.add_argument("--skip-references", action="store_true")
    pilot.add_argument("--update-qmd", action="store_true")

    batch = subparsers.add_parser("batch", help="Process talks from a batch config")
    batch.add_argument("--config", type=Path, default=DEFAULT_BATCH_CONFIG)
    batch.add_argument("--prepare-only", action="store_true")
    batch.add_argument("--skip-correct", action="store_true")
    batch.add_argument("--skip-references", action="store_true")
    batch.add_argument("--update-qmd", action="store_true")

    sync = subparsers.add_parser("sync", help="Process pending talks")
    sync.add_argument("--talk-id", action="append", default=[])
    sync.add_argument("--limit", type=int)
    sync.add_argument("--prepare-only", action="store_true")
    sync.add_argument("--skip-correct", action="store_true")
    sync.add_argument("--skip-references", action="store_true")
    sync.add_argument("--update-qmd", action="store_true")

    correct = subparsers.add_parser("correct", help="Rerun correction from existing segments")
    correct.add_argument("--talk-id", action="append", default=[])
    correct.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    correct.add_argument("--batch", action="store_true")
    correct.add_argument("--update-qmd", action="store_true")

    refs = subparsers.add_parser("extract-references", help="Extract references from corrected transcripts")
    refs.add_argument("--talk-id", action="append", default=[])
    refs.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    refs.add_argument("--batch", action="store_true")
    refs.add_argument("--update-qmd", action="store_true")

    metadata = subparsers.add_parser("metadata", help="Generate podcast descriptions and chapters")
    metadata.add_argument("--talk-id", action="append", default=[])
    metadata.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    metadata.add_argument("--batch", action="store_true")
    metadata.add_argument("--update-qmd", action="store_true")
    metadata.add_argument("--build-feedback-viewer", action="store_true")

    description_summary = subparsers.add_parser(
        "description-summary",
        help="Regenerate only podcast descriptions and short summaries",
    )
    description_summary.add_argument("--talk-id", action="append", default=[])
    description_summary.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    description_summary.add_argument("--batch", action="store_true")
    description_summary.add_argument("--limit", type=int)
    description_summary.add_argument("--jobs", type=int, default=1)
    description_summary.add_argument("--dry-run", action="store_true")
    description_summary.add_argument("--stop-on-error", action="store_true")
    description_summary.add_argument("--report-path", type=Path)
    description_summary.add_argument("--backup-dir", type=Path)
    description_summary.add_argument("--rebuild-feed", action="store_true")
    description_summary.add_argument("--media-base-url", default=DEFAULT_FEED_MEDIA_BASE_URL)
    description_summary.add_argument("--artwork-base-url")
    description_summary.add_argument("--chapters-base-url")
    description_summary.add_argument("--copy-artwork", action="store_true")

    artwork = subparsers.add_parser("generate-artwork", help="Generate episode artwork images")
    artwork.add_argument("--talk-id", action="append", default=[])
    artwork.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    artwork.add_argument("--batch", action="store_true")
    artwork.add_argument("--image-model", default="gpt-image-2")
    artwork.add_argument("--image-size", default="1024x1024")
    artwork.add_argument("--image-quality", default="low")
    artwork.add_argument("--build-feedback-viewer", action="store_true")

    corpus = subparsers.add_parser(
        "run-corpus",
        help="Process pending talks through enrichment and rebuild the public feed in batches",
    )
    corpus.add_argument("--limit", type=int)
    corpus.add_argument("--feed-every", type=int, default=20)
    corpus.add_argument("--media-base-url", default=DEFAULT_FEED_MEDIA_BASE_URL)
    corpus.add_argument("--artwork-base-url")
    corpus.add_argument("--chapters-base-url")
    corpus.add_argument("--copy-artwork", action="store_true")
    corpus.add_argument("--skip-artwork", action="store_true")
    corpus.add_argument("--update-qmd", action="store_true")
    corpus.add_argument("--build-feedback-viewer", action="store_true")
    corpus.add_argument("--image-model", default="gpt-image-2")
    corpus.add_argument("--image-size", default="1024x1024")
    corpus.add_argument("--image-quality", default="low")
    corpus.add_argument(
        "--stop-on-error",
        action="store_true",
        help="Stop the batch at the first failed talk instead of recording the failure and continuing",
    )

    clean = subparsers.add_parser("clean", help="Apply local transcript cleanup to corrected artifacts")
    clean.add_argument("--talk-id", action="append", default=[])
    clean.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)
    clean.add_argument("--batch", action="store_true")
    clean.add_argument("--update-qmd", action="store_true")
    clean.add_argument("--build-viewer", action="store_true")

    viewer = subparsers.add_parser("build-viewer", help="Build local transcript viewer")
    viewer.add_argument("--config", type=Path)

    feedback_viewer = subparsers.add_parser("build-feedback-viewer", help="Build local feedback review viewer")
    feedback_viewer.add_argument("--config", type=Path)

    subparsers.add_parser("setup-qmd", help="Configure and refresh the configured QMD collection")

    review = subparsers.add_parser("review", help="Review pilot artifacts")
    review.add_argument("--config", type=Path, default=DEFAULT_PILOT_CONFIG)

    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    args = build_parser().parse_args(argv)
    corpus = load_corpus_config(args.corpus_config)
    set_current_corpus(corpus)
    apply_corpus_defaults(args, corpus)
    load_env_file(args.env_file)
    paths = CorpusPaths(args.corpus_dir.resolve())
    glossary = load_json(args.glossary, {})

    if args.command == "setup-qmd":
        require_executable("qmd")
        run_qmd(paths)
        return 0

    talks = load_talks(args.talks_json)

    if args.command == "review":
        selected = select_talks(talks, paths, load_pilot_ids(args.config), None, True)
        print(write_review(selected, paths))
        print(write_reference_report(selected, paths))
        return 0

    if args.command == "build-viewer":
        talk_ids = load_pilot_ids(args.config) if args.config else None
        selected = select_talks(talks, paths, talk_ids, None, True)
        print(write_viewer(selected, paths))
        return 0

    if args.command == "build-feedback-viewer":
        talk_ids = load_pilot_ids(args.config) if args.config else None
        selected = select_talks(talks, paths, talk_ids, None, True)
        print(write_feedback_viewer(selected, paths))
        return 0

    if args.command == "clean":
        require_executable("ffmpeg")
        talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
        if not talk_ids:
            raise SystemExit("clean requires --talk-id or --batch")
        selected = select_talks(talks, paths, talk_ids, None, True)
        state = PipelineState(paths.state_path)
        for talk in selected:
            print(f"clean {talk.id}")
            corrected = clean_existing_transcript(talk, paths)
            references_doc = load_json(paths.references(talk), {})
            if references_doc:
                references_doc = prune_references_for_segments(
                    talk,
                    references_doc,
                    corrected.get("segments", []),
                )
                write_json(paths.references(talk), references_doc)
            print(f"markdown {talk.id}")
            markdown_path = write_markdown(talk, paths, corrected, references_doc)
            state.mark(talk, status="indexed", markdown=str(markdown_path))
        if args.update_qmd:
            require_executable("qmd")
            run_qmd(paths)
        if args.build_viewer:
            print(write_viewer(selected, paths))
        return 0

    if args.command == "run-corpus":
        with corpus_run_lock(paths):
            return run_corpus_command(args, talks, paths, glossary)

    if args.command == "description-summary":
        return run_description_summary_command(args, talks, paths)

    if args.command not in {
        "correct",
        "extract-references",
        "metadata",
        "description-summary",
        "generate-artwork",
    }:
        require_executable("ffmpeg")
        require_executable("ffprobe")
    prepare_only = bool(getattr(args, "prepare_only", False))
    api_key = "" if prepare_only else require_openai_key()
    state = PipelineState(paths.state_path)

    if args.command == "pilot":
        selected = select_talks(talks, paths, load_pilot_ids(args.pilot_config), None, args.force)
        skip_correct = args.skip_correct
        skip_references = args.skip_references
        update_qmd = args.update_qmd
    elif args.command == "batch":
        selected = select_talks(talks, paths, load_pilot_ids(args.config), None, args.force)
        skip_correct = args.skip_correct
        skip_references = args.skip_references
        update_qmd = args.update_qmd
    elif args.command == "sync":
        selected = select_talks(talks, paths, args.talk_id or None, args.limit, args.force)
        skip_correct = args.skip_correct
        skip_references = args.skip_references
        update_qmd = args.update_qmd
    elif args.command == "correct":
        talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
        selected = select_talks(talks, paths, talk_ids, None, True)
        for talk in selected:
            print(f"correct {talk.id}")
            corrected = correct_segments(
                talk,
                paths,
                api_key,
                glossary,
                args.correction_model,
                force=True,
            )
            print(f"markdown {talk.id}")
            markdown_path = write_markdown(
                talk,
                paths,
                corrected,
                load_json(paths.references(talk), {}),
            )
            state.mark(talk, status="indexed", markdown=str(markdown_path))
        if args.update_qmd:
            require_executable("qmd")
            run_qmd(paths)
        if args.batch:
            print(write_review(selected, paths))
        return 0
    elif args.command == "extract-references":
        talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
        selected = select_talks(talks, paths, talk_ids, None, True)
        for talk in selected:
            print(f"references {talk.id}")
            references_doc = extract_references(
                talk,
                paths,
                api_key,
                glossary,
                args.reference_model,
                force=True,
            )
            print(f"markdown {talk.id}")
            markdown_path = write_markdown(
                talk,
                paths,
                load_json(paths.corrected(talk), {}),
                references_doc,
            )
            state.mark(
                talk,
                status="indexed",
                references=str(paths.references(talk)),
                markdown=str(markdown_path),
            )
        if args.update_qmd:
            require_executable("qmd")
            run_qmd(paths)
        if args.batch:
            print(write_reference_report(selected, paths))
        return 0
    elif args.command == "metadata":
        talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
        selected = select_talks(talks, paths, talk_ids, None, True)
        for talk in selected:
            print(f"metadata {talk.id}")
            episode_metadata = generate_episode_metadata(
                talk,
                paths,
                api_key,
                args.metadata_model,
                force=True,
            )
            print(f"markdown {talk.id}")
            markdown_path = write_markdown(
                talk,
                paths,
                load_json(paths.corrected(talk), {}),
                load_json(paths.references(talk), {}),
            )
            state.mark(
                talk,
                status="indexed",
                episode_metadata=str(paths.episode_metadata(talk)),
                markdown=str(markdown_path),
            )
            print(f"chapters {len(episode_metadata.get('chapters', []))}")
        if args.update_qmd:
            require_executable("qmd")
            run_qmd(paths)
        if args.build_feedback_viewer:
            print(write_feedback_viewer(selected, paths))
        return 0
    elif args.command == "generate-artwork":
        talk_ids = load_pilot_ids(args.config) if args.batch else (args.talk_id or None)
        selected = select_talks(talks, paths, talk_ids, None, True)
        for talk in selected:
            print(f"artwork {talk.id}")
            manifest = generate_artwork(
                talk,
                paths,
                api_key,
                args.image_model,
                image_size=args.image_size,
                image_quality=args.image_quality,
                force=True,
            )
            state.mark(
                talk,
                status="indexed",
                artwork=str(paths.artwork_image(talk)),
                artwork_model=manifest.get("image_model"),
            )
        if args.build_feedback_viewer:
            print(write_feedback_viewer(selected, paths))
        return 0
    else:
        raise SystemExit(f"Unknown command: {args.command}")

    if not selected:
        print("No talks selected.")
        return 0

    for talk in selected:
        process_talk(
            talk,
            paths,
            state,
            api_key,
            glossary,
            args.correction_model,
            args.reference_model,
            force=args.force,
            prepare_only=prepare_only,
            skip_correct=skip_correct,
            skip_references=skip_references,
        )

    if update_qmd:
        require_executable("qmd")
        run_qmd(paths)

    if args.command in {"pilot", "batch"}:
        if prepare_only:
            print(write_prepare_report(selected, paths))
        else:
            print(write_review(selected, paths))
            print(write_reference_report(selected, paths))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
