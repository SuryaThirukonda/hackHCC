from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from coach.http_errors import env_secret, provider_http_error

_LIVEAVATAR_CONTEXT_URL = "https://api.liveavatar.com/v1/contexts"
_LIVEAVATAR_EMBED_URL = "https://api.liveavatar.com/v2/embeddings"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 PhysioCoach/1.0"
)


def _liveavatar_headers(api_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-KEY": api_key,
        "User-Agent": _USER_AGENT,
    }


def _request_json(
    url: str,
    api_key: str,
    *,
    method: str = "POST",
    body: dict[str, Any] | None = None,
    timeout_sec: float = 10,
) -> dict[str, Any]:
    payload = json.dumps(body or {}).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers=_liveavatar_headers(api_key),
    )
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        parsed = json.loads(response.read().decode("utf-8"))
    data = parsed.get("data") or parsed
    if not isinstance(data, dict):
        raise ValueError("liveavatar_invalid_response")
    return data


def _embed_html_from_data(embed_data: dict[str, Any]) -> str | None:
    embed_html = embed_data.get("script")
    if embed_html:
        return str(embed_html)
    url = embed_data.get("url")
    if url:
        return (
            f'<iframe src="{url}" allow="microphone" '
            'title="LiveAvatar Embed" style="aspect-ratio: 16/9;"></iframe>'
        )
    return None


def _context_body(coach_context: dict[str, Any]) -> dict[str, str]:
    session_id = str(coach_context.get("session_id") or "coach")
    return {
        "name": f"Physio session {session_id[:12]}",
        "prompt": coach_context.get("live_avatar_prompt") or "",
        "opening_text": coach_context.get("opening_message") or coach_context.get("spoken_intro") or "",
    }


def sync_liveavatar_context(coach_context: dict[str, Any]) -> dict[str, Any]:
    """
    Push session/exercise knowledge into LiveAvatar.
    Requires LIVEAVATAR_API_KEY from app.liveavatar.com (HeyGen keys do not work here).
    """
    api_key = env_secret("LIVEAVATAR_API_KEY")
    if not api_key:
        return {
            "ok": False,
            "context_applied": False,
            "reason": "missing_liveavatar_api_key",
            "error_message_sanitized": (
                "LiveAvatar API key missing. Get one at app.liveavatar.com and set LIVEAVATAR_API_KEY in physio/.env."
            ),
        }

    timeout_sec = float(os.getenv("LIVEAVATAR_TIMEOUT_SEC", os.getenv("HEYGEN_TIMEOUT_SEC", "15")))
    context_id = env_secret("LIVEAVATAR_CONTEXT_ID")
    avatar_id = env_secret("LIVEAVATAR_AVATAR_ID")
    voice_id = env_secret("LIVEAVATAR_VOICE_ID") or env_secret("HEYGEN_VOICE_ID")
    orientation = os.getenv("LIVEAVATAR_ORIENTATION", "horizontal").strip() or "horizontal"
    body = _context_body(coach_context)

    try:
        if context_id:
            _request_json(
                f"{_LIVEAVATAR_CONTEXT_URL}/{context_id}",
                api_key,
                method="PATCH",
                body=body,
                timeout_sec=timeout_sec,
            )
            return {
                "ok": True,
                "context_applied": True,
                "context_id": context_id,
                "embed_html": None,
                "reason": "updated_existing_context",
            }

        if not avatar_id:
            return {
                "ok": False,
                "context_applied": False,
                "reason": "missing_liveavatar_context_or_avatar",
                "error_message_sanitized": (
                    "Set LIVEAVATAR_CONTEXT_ID (from app.liveavatar.com/contexts, linked to your embed) "
                    "or LIVEAVATAR_AVATAR_ID to create a per-session embed."
                ),
            }

        context_data = _request_json(_LIVEAVATAR_CONTEXT_URL, api_key, body=body, timeout_sec=timeout_sec)
        new_context_id = context_data.get("id") or context_data.get("context_id")
        if not new_context_id:
            raise ValueError("liveavatar_missing_context_id")

        embed_body: dict[str, Any] = {
            "avatar_id": avatar_id,
            "context_id": new_context_id,
            "orientation": orientation,
            "is_sandbox": os.getenv("LIVEAVATAR_SANDBOX", "true").lower() in {"1", "true", "yes"},
        }
        if voice_id:
            embed_body["voice_id"] = voice_id

        embed_data = _request_json(_LIVEAVATAR_EMBED_URL, api_key, body=embed_body, timeout_sec=timeout_sec)
        embed_html = _embed_html_from_data(embed_data)
        if not embed_html:
            raise ValueError("liveavatar_missing_embed_html")

        return {
            "ok": True,
            "context_applied": True,
            "context_id": new_context_id,
            "embed_html": embed_html,
            "reason": "created_context_and_embed",
        }
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        error_message = provider_http_error(exc, "liveavatar") if isinstance(exc, urllib.error.HTTPError) else str(exc)
        print(f"[LiveAvatar] context sync failed: {error_message}")
        return {
            "ok": False,
            "context_applied": False,
            "reason": "liveavatar_sync_failed",
            "error_message_sanitized": error_message,
        }


def extract_embed_id(embed_html: str) -> str | None:
    match = re.search(r"embed\.liveavatar\.com/v1/([0-9a-f-]{36})", embed_html, re.IGNORECASE)
    return match.group(1) if match else None


def create_session_embed(coach_context: dict[str, Any]) -> dict[str, Any]:
    """
    Sync session knowledge into LiveAvatar, then return the iframe to mount.
    Static EMBED in .env is only used as fallback when LiveAvatar sync is unavailable.
    """
    static_embed = os.getenv("EMBED", "").strip()
    sync = sync_liveavatar_context(coach_context)

    if sync.get("context_applied"):
        embed_html = sync.get("embed_html") or static_embed
        return {
            "embed_html": embed_html or None,
            "context_applied": True,
            "context_id": sync.get("context_id"),
            "context_sync_reason": sync.get("reason"),
            "coach_context": coach_context,
            "embed_mount_key": coach_context.get("session_id") or "coach",
            "liveavatar_configured": True,
        }

    return {
        "embed_html": static_embed or None,
        "context_applied": False,
        "context_id": None,
        "context_sync_reason": sync.get("reason"),
        "coach_context": coach_context,
        "embed_mount_key": None,
        "liveavatar_configured": bool(env_secret("LIVEAVATAR_API_KEY")),
        "error_message_sanitized": sync.get("error_message_sanitized"),
        "setup_hint": (
            "The static LiveAvatar iframe does not receive Physio session data automatically. "
            "Add LIVEAVATAR_API_KEY plus LIVEAVATAR_CONTEXT_ID from app.liveavatar.com/contexts "
            "(the context linked to your embed), then start a new Chat now session."
        ),
    }
