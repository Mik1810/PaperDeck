import io
import socket
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import embedding_common


def client() -> embedding_common.SupabaseRestClient:
    instance = object.__new__(embedding_common.SupabaseRestClient)
    instance.base_url = "https://example.supabase.co"
    instance.service_role_key = "test-key"
    return instance


def response(body: bytes = b"[]") -> MagicMock:
    result = MagicMock()
    result.__enter__.return_value.read.return_value = body
    return result


class SupabaseRestRetryTests(unittest.TestCase):
    def test_retries_temporary_dns_failure(self) -> None:
        error = urllib.error.URLError(
            socket.gaierror(-3, "Temporary failure in name resolution")
        )
        with (
            patch.object(
                embedding_common.urllib.request,
                "urlopen",
                side_effect=[error, response()],
            ) as urlopen,
            patch.object(embedding_common.time, "sleep") as sleep,
        ):
            result = client().request_json("papers")

        self.assertEqual(result, [])
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1.0)

    def test_retries_retryable_http_status(self) -> None:
        error = urllib.error.HTTPError(
            "https://example.supabase.co/rest/v1/papers",
            503,
            "Unavailable",
            {},
            io.BytesIO(b'{"message":"temporary"}'),
        )
        with (
            patch.object(
                embedding_common.urllib.request,
                "urlopen",
                side_effect=[error, response(b'{"ok":true}')],
            ) as urlopen,
            patch.object(embedding_common.time, "sleep") as sleep,
        ):
            result = client().request_json("papers")

        self.assertEqual(result, {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1.0)

    def test_does_not_retry_permanent_http_status(self) -> None:
        error = urllib.error.HTTPError(
            "https://example.supabase.co/rest/v1/papers",
            400,
            "Bad Request",
            {},
            io.BytesIO(b'{"message":"invalid"}'),
        )
        with (
            patch.object(
                embedding_common.urllib.request,
                "urlopen",
                side_effect=error,
            ) as urlopen,
            patch.object(embedding_common.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(RuntimeError, "Supabase REST error 400"):
                client().request_json("papers")

        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
