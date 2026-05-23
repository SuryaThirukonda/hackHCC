"""Quick smoke test for /api/ai/speech-to-text."""
from __future__ import annotations

import json
import sys
import uuid
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coach.speech_transcription import SpeechTranscriptionProvider


def test_provider_empty() -> None:
    provider = SpeechTranscriptionProvider()
    result = provider.transcribe(b"", "audio/webm")
    assert result["status"] == "empty_audio", result
    print("  ok: empty audio rejected")


def test_backend_route() -> None:
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="audio"; filename="recording.webm"\r\n'
        f"Content-Type: audio/webm\r\n\r\n"
        f"fakeaudio"
        f"\r\n--{boundary}--\r\n"
    ).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:8000/api/ai/speech-to-text",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            print("  backend response:", json.dumps(payload)[:300])
            assert "text" in payload
            print("  ok: backend route reachable")
    except urllib.error.HTTPError as exc:
        print("  backend HTTP", exc.code, exc.read().decode("utf-8")[:300])
        raise


if __name__ == "__main__":
    print("speech-to-text smoke tests")
    test_provider_empty()
    try:
        test_backend_route()
    except urllib.error.URLError as exc:
        print("  skip backend route (server offline):", exc)
    print("done")
