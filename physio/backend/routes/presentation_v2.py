from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter

from coach.avatar_provider import HeyGenAvatarProvider, get_avatar_provider
from coach.base import clean_coach_text, clean_spoken_summary_text
from coach.gemini_coach import GeminiCoachProvider
from coach.voice_provider import get_voice_provider

router = APIRouter(prefix="/api/presentation/v2", tags=["presentation-v2"])


@router.get("/status")
def presentation_status() -> dict[str, Any]:
    gem_status = GeminiCoachProvider.debug_status()
    avatar_provider_name = os.getenv("AVATAR_PROVIDER", "mock").lower()
    voice_provider_name = os.getenv("VOICE_PROVIDER", "mock").lower()
    embed_html = os.getenv("EMBED", "")
    return {
        "ok": True,
        "voice_provider": voice_provider_name,
        "avatar_provider": avatar_provider_name,
        "gemini_ready": gem_status.get("vertex_enabled", False),
        "elevenlabs_configured": bool(os.getenv("ELEVENLABS_API_KEY")),
        "heygen_configured": bool(os.getenv("HEYGEN_API_KEY")) and bool(os.getenv("HEYGEN_AVATAR_ID")),
        "liveavatar_embed_available": bool(embed_html.strip()),
        "liveavatar_embed_html": embed_html.strip() if embed_html.strip() else None,
    }


@router.post("/elevenlabs-summary")
def elevenlabs_summary(payload: dict[str, Any]) -> dict[str, Any]:
    """Synthesise the Gemini spoken_summary via ElevenLabs."""
    text = clean_spoken_summary_text(str((payload or {}).get("text") or ""), "")
    if not text:
        return {"ok": False, "status": "empty_text", "audio_url": None, "error_message_sanitized": "No text provided"}
    voice = get_voice_provider()
    result = voice.synthesize(text)
    return {
        "ok": result.status == "ready",
        "status": result.status,
        "audio_url": result.audio_url,
        "error_message_sanitized": result.error_message,
    }


@router.post("/heygen-session-coach")
def heygen_session_coach(payload: dict[str, Any]) -> dict[str, Any]:
    """Request a HeyGen video or return LiveAvatar embed for the session summary."""
    text = clean_coach_text(str((payload or {}).get("spoken_summary") or ""), "")
    audio_url = str((payload or {}).get("audio_url") or "") or None
    embed_html = os.getenv("EMBED", "").strip()

    embed_response = {
        "embed_available": bool(embed_html),
        "embed_html": embed_html or None,
    }

    if not text:
        return {
            "ok": True,
            "status": "embed_only",
            "video_url": None,
            "error_message_sanitized": None,
            **embed_response,
        }

    avatar = get_avatar_provider()
    result = avatar.speak(text, optional_audio_url=audio_url)

    return {
        "ok": True,
        "status": result.status,
        "video_url": result.avatar_url,
        "avatar_session_id": result.avatar_session_id,
        "generate_time_ms": result.generate_time_ms,
        "error_message_sanitized": result.error_message,
        **embed_response,
    }


@router.get("/heygen-video-status/{video_id}")
def heygen_video_status(video_id: str) -> dict[str, Any]:
    """
    Poll HeyGen for the processing status of a previously queued video.
    Frontend calls this every ~5s until status is 'completed' or 'failed'.
    HeyGen statuses: pending | processing | completed | failed
    """
    avatar = get_avatar_provider()
    if not isinstance(avatar, HeyGenAvatarProvider):
        return {
            "ok": False,
            "status": "unavailable",
            "video_url": None,
            "error": "HeyGen not configured (AVATAR_PROVIDER != heygen)",
        }

    poll = avatar.poll_video_status(video_id)
    heygen_status = poll.get("status", "unknown")
    return {
        "ok": True,
        "status": heygen_status,
        "video_url": poll.get("video_url"),
        "thumbnail_url": poll.get("thumbnail_url"),
        "duration": poll.get("duration"),
        "poll_time_ms": poll.get("poll_time_ms"),
        "error": poll.get("error"),
    }
