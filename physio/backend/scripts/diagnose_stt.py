"""Diagnose ElevenLabs STT pipeline with known-good and synthetic audio."""
from __future__ import annotations

import json
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from env_loader import load_env_file
from coach.speech_transcription import SpeechTranscriptionProvider, _ffmpeg_to_wav
from coach.voice_provider import ElevenLabsVoiceProvider

load_env_file()


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> None:
    stt = SpeechTranscriptionProvider()
    tts = ElevenLabsVoiceProvider()

    section("Config")
    print("model:", stt.model_id)
    print("language:", stt.language_code)
    print("api_key_present:", bool(stt.api_key))
    print("ffmpeg:", __import__("shutil").which("ffmpeg"))

    section("Round-trip: TTS mp3 -> STT")
    phrase = "this is a test this is a test"
    tts_result = tts.synthesize(phrase)
    print("tts status:", tts_result.status, "path:", tts_result.local_file_path)
    if not tts_result.local_file_path:
        print("TTS failed — cannot run round-trip test")
        return

    mp3_bytes = Path(tts_result.local_file_path).read_bytes()
    print("mp3 bytes:", len(mp3_bytes))

    result_mp3 = stt.transcribe(mp3_bytes, "audio/mpeg")
    print("STT on mp3:", json.dumps(result_mp3, indent=2))

    section("Round-trip: TTS mp3 -> ffmpeg wav -> STT")
    wav = _ffmpeg_to_wav(mp3_bytes, suffix=".mp3")
    print("wav bytes:", len(wav) if wav else None)
    if wav:
        result_wav = stt.transcribe(wav, "audio/wav")
        print("STT on wav:", json.dumps(result_wav, indent=2))

    section("Raw ElevenLabs call on mp3 (full payload)")
    payload, err = stt._call_elevenlabs(mp3_bytes, "audio/mpeg")
    print("error:", err)
    print("payload:", json.dumps(payload, indent=2) if payload else None)

    section("Model variants on mp3")
    for model in ["scribe_v2", "scribe_v1", "scribe_v2_realtime"]:
        old = stt.model_id
        stt.model_id = model
        payload, err = stt._call_elevenlabs(mp3_bytes, "audio/mpeg")
        text = (payload or {}).get("text", "")
        print(f"{model}: err={bool(err)} text={text!r}")
        stt.model_id = old


if __name__ == "__main__":
    main()
