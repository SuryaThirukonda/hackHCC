from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path | None = None, override: bool = True) -> None:
    env_path = path or Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (override or key not in os.environ):
            os.environ[key] = value


def configured_secret(name: str) -> bool:
    value = os.getenv(name, "").strip()
    lowered = value.lower()
    return bool(value and not lowered.startswith("your_") and not lowered.startswith("paste_"))


def public_base_url() -> str | None:
    value = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    return value or None
