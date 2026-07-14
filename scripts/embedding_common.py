from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384


def load_local_env(path: Path = Path(".env.local")) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name: str) -> str:
    value = os.getenv(name)

    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")

    return value


class SupabaseRestClient:
    def __init__(self) -> None:
        self.base_url = require_env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
        self.service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    def headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if prefer:
            headers["Prefer"] = prefer

        return headers

    def request_json(
        self,
        path: str,
        query: dict[str, str] | None = None,
        method: str = "GET",
        payload: dict[str, Any] | list[dict[str, Any]] | None = None,
        prefer: str | None = None,
        range_header: str | None = None,
    ) -> Any:
        encoded_query = urllib.parse.urlencode(query or {})
        url = f"{self.base_url}/rest/v1/{path}"

        if encoded_query:
            url = f"{url}?{encoded_query}"

        headers = self.headers(prefer=prefer)
        if range_header:
            headers["Range"] = range_header

        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            error_body = error.read().decode("utf-8")
            raise RuntimeError(f"Supabase REST error {error.code}: {error_body}") from error

        if not response_body:
            return None

        return json.loads(response_body)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_model(model_name: str) -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
