from __future__ import annotations

import urllib.error


def provider_http_error(exc: urllib.error.HTTPError, provider: str) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""
    body = " ".join(body.split())
    if len(body) > 500:
        body = body[:497].rstrip() + "..."
    return f"{provider}_http_{exc.code}: {body or exc.reason}"


def env_secret(name: str) -> str | None:
    value = __import__("os").getenv(name, "").strip()
    lowered = value.lower()
    if not value or lowered.startswith("your_") or lowered.startswith("paste_"):
        return None
    return value
