from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request

from coach.http_errors import env_secret, provider_http_error

_ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
_EVENT_TAG_PATTERN = re.compile(r"\[(?:pause|laughter|music|applause|noise|silence|cough|sigh)[^\]]*\]", re.IGNORECASE)


def _mime_to_filename(mime_type: str) -> tuple[str, str]:
    normalized = mime_type.split(";")[0].strip().lower() or "audio/webm"
    if normalized in {"audio/mp4", "audio/x-m4a"}:
        return "recording.m4a", "audio/mp4"
    if normalized == "audio/mpeg":
        return "recording.mp3", "audio/mpeg"
    if normalized == "audio/wav":
        return "recording.wav", "audio/wav"
    if normalized == "audio/ogg":
        return "recording.ogg", "audio/ogg"
    return "recording.webm", "audio/webm"


def _build_multipart_body(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
) -> tuple[bytes, str]:
    boundary = f"----PhysioBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []

    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )

    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8")
    )
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))

    body = b"".join(parts)
    content_type_header = f"multipart/form-data; boundary={boundary}"
    return body, content_type_header


def _clean_transcript(text: str) -> str:
    cleaned = _EVENT_TAG_PATTERN.sub(" ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _find_ffmpeg() -> str | None:
    env_path = os.getenv("FFMPEG_PATH", "").strip()
    if env_path and Path(env_path).exists():
        return env_path
    found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if found:
        return found
    for candidate in (
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def _ffmpeg_to_wav(audio_bytes: bytes, suffix: str = ".webm") -> bytes | None:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{suffix}"
        dst = Path(tmp) / "output.wav"
        src.write_bytes(audio_bytes)
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(src),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    str(dst),
                ],
                check=True,
                capture_output=True,
                timeout=30,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            return None
        if not dst.exists() or dst.stat().st_size < 500:
            return None
        return dst.read_bytes()


def generate_test_wav(kind: str = "noise", duration_sec: float = 2.0, sample_rate: int = 16000) -> bytes:
    """Build a small WAV for STT pipeline sanity checks (no mic required)."""
    import math
    import random
    import struct

    sample_count = max(1, int(duration_sec * sample_rate))
    samples: list[int] = []

    if kind == "speech_like":
        # TTS-like tone bursts (not real speech — Scribe may still return empty)
        for i in range(sample_count):
            t = i / sample_rate
            amp = 6000 if int(t * 4) % 2 == 0 else 3000
            value = int(amp * math.sin(2 * math.pi * 440 * t))
            samples.append(max(-32767, min(32767, value)))
    else:
        rng = random.Random(42)
        for _ in range(sample_count):
            samples.append(rng.randint(-12000, 12000))

    data_size = sample_count * 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
        b"data",
        data_size,
    )
    body = struct.pack(f"<{sample_count}h", *samples)
    return header + body


def run_stt_sanity_tests() -> dict[str, Any]:
    """Send synthetic WAV + optional TTS clip to ElevenLabs Scribe."""
    from coach.voice_provider import get_voice_provider

    provider = SpeechTranscriptionProvider()
    noise = generate_test_wav("noise", duration_sec=2.0)
    tone = generate_test_wav("speech_like", duration_sec=2.0)

    noise_result = provider.transcribe(noise, "audio/wav")
    tone_result = provider.transcribe(tone, "audio/wav")

    tts_roundtrip: dict[str, Any] = {"skipped": True, "reason": "TTS unavailable"}
    voice = get_voice_provider()
    tts_result = voice.synthesize("This is a test. This is a test.")
    if tts_result.local_file_path and Path(tts_result.local_file_path).exists():
        mp3_bytes = Path(tts_result.local_file_path).read_bytes()
        speech_result = provider.transcribe(mp3_bytes, "audio/mpeg")
        tts_roundtrip = {
            "skipped": False,
            "tts_status": tts_result.status,
            "mp3_bytes": len(mp3_bytes),
            "stt_status": speech_result.get("status"),
            "text": speech_result.get("text") or "",
            "raw_text": (speech_result.get("debug") or {}).get("raw_text", ""),
        }

    return {
        "ok": True,
        "noise": {
            "bytes": len(noise),
            "status": noise_result.get("status"),
            "text": noise_result.get("text") or "",
            "raw_text": (noise_result.get("debug") or {}).get("raw_text", ""),
        },
        "tone_bursts": {
            "bytes": len(tone),
            "status": tone_result.get("status"),
            "text": tone_result.get("text") or "",
            "raw_text": (tone_result.get("debug") or {}).get("raw_text", ""),
        },
        "tts_roundtrip": tts_roundtrip,
        "note": (
            "noise/tone usually return empty_transcript (no words). "
            "tts_roundtrip.text should be non-empty if ElevenLabs STT+TTS are configured."
        ),
    }


class SpeechTranscriptionProvider:
    """Transcribe short patient voice clips via ElevenLabs Scribe."""

    def __init__(self) -> None:
        self.api_key = env_secret("ELEVENLABS_API_KEY")
        self.model_id = os.getenv("ELEVENLABS_STT_MODEL_ID", "scribe_v2").strip()
        self.language_code = os.getenv("ELEVENLABS_STT_LANGUAGE", "en").strip()
        self.timeout_sec = float(os.getenv("ELEVENLABS_STT_TIMEOUT_SEC", "30"))

    def _request_fields(self) -> dict[str, str]:
        fields = {
            "model_id": self.model_id,
            "tag_audio_events": "false",
        }
        if self.language_code:
            fields["language_code"] = self.language_code
        return fields

    def _call_elevenlabs(self, audio_bytes: bytes, mime_type: str) -> tuple[dict[str, Any] | None, str | None]:
        if not self.api_key:
            return None, "Set ELEVENLABS_API_KEY in .env to enable voice transcription."

        filename, content_type = _mime_to_filename(mime_type)
        body, content_type_header = _build_multipart_body(
            fields=self._request_fields(),
            file_field="file",
            filename=filename,
            file_bytes=audio_bytes,
            content_type=content_type,
        )

        request = urllib.request.Request(
            _ELEVENLABS_STT_URL,
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": content_type_header,
                "xi-api-key": self.api_key,
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                return json.loads(response.read().decode("utf-8")), None
        except urllib.error.HTTPError as exc:
            raw = provider_http_error(exc, "elevenlabs_stt")
            if "missing_permissions" in raw and "speech_to_text" in raw:
                raw = (
                    "Your ElevenLabs API key does not have speech_to_text permission. "
                    "Enable Scribe / Speech-to-Text in your ElevenLabs workspace, or create a key with that scope."
                )
            return None, raw
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            return None, str(exc)

    def _extract_text(self, payload: dict[str, Any] | None) -> str:
        if not payload:
            return ""
        text = _clean_transcript(str(payload.get("text") or ""))
        if text:
            return text
        transcripts = payload.get("transcripts")
        if isinstance(transcripts, list):
            chunks = [
                _clean_transcript(str(item.get("text") or ""))
                for item in transcripts
                if isinstance(item, dict)
            ]
            return " ".join(part for part in chunks if part).strip()
        return ""

    def transcribe(self, audio_bytes: bytes, mime_type: str = "audio/webm") -> dict[str, Any]:
        if not audio_bytes:
            return {
                "ok": False,
                "status": "empty_audio",
                "text": "",
                "error_message_sanitized": "No audio received.",
            }

        if len(audio_bytes) < 500:
            return {
                "ok": False,
                "status": "audio_too_short",
                "text": "",
                "error_message_sanitized": "Recording was too short. Hold Record, speak for at least one second, then Stop.",
            }

        payload, error = self._call_elevenlabs(audio_bytes, mime_type)
        if error:
            return {
                "ok": False,
                "status": "transcription_error",
                "text": "",
                "error_message_sanitized": error,
            }

        text = self._extract_text(payload)
        used_wav_fallback = False
        input_format = mime_type

        # Server-side ffmpeg fallback when client sends webm (ffmpeg often missing from PATH on Windows)
        if not text and "webm" in mime_type.split(";")[0].lower():
            suffix = ".webm"
            wav_bytes = _ffmpeg_to_wav(audio_bytes, suffix=suffix)
            if wav_bytes:
                used_wav_fallback = True
                input_format = "audio/wav (server ffmpeg)"
                payload, error = self._call_elevenlabs(wav_bytes, "audio/wav")
                if error:
                    return {
                        "ok": False,
                        "status": "transcription_error",
                        "text": "",
                        "error_message_sanitized": error,
                    }
                text = self._extract_text(payload)

        return {
            "ok": bool(text),
            "status": "ready" if text else "empty_transcript",
            "text": text,
            "provider": "elevenlabs-scribe",
            "model": self.model_id,
            "language_code": payload.get("language_code") if payload else None,
            "debug": {
                "audio_bytes": len(audio_bytes),
                "mime_type": mime_type,
                "input_format": input_format,
                "ffmpeg_path": _find_ffmpeg(),
                "server_wav_fallback": used_wav_fallback,
                "raw_text": str((payload or {}).get("text") or "")[:200],
            },
            "error_message_sanitized": (
                ""
                if text
                else (
                    "No speech detected. Check your mic input device, speak closer to the mic, "
                    "and hold Record for at least 2 seconds before Stop."
                )
            ),
        }
