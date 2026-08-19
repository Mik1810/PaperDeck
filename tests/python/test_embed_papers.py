import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import embed_papers


MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def paper(index: int, *, current: bool = True) -> dict[str, object]:
    text = f"Paper {index}\n\nAbstract {index}"
    return {
        "id": str(index),
        "title": f"Paper {index}",
        "abstract": f"Abstract {index}",
        "embedding_model": MODEL if current else "old-model",
        "embedding_content_hash": embed_papers.content_hash(text),
        "ingested_at": f"2026-01-{(index % 28) + 1:02d}",
    }


class FakePaperClient:
    def __init__(
        self,
        missing: list[dict[str, object]],
        embedded: list[dict[str, object]],
    ) -> None:
        self.missing = missing
        self.embedded = embedded
        self.calls: list[tuple[int, str | None, bool]] = []

    def iter_papers(
        self,
        page_size: int,
        embedding_filter: str | None,
        classic_only: bool,
    ):
        self.calls.append((page_size, embedding_filter, classic_only))
        if embedding_filter == "is.null":
            yield from self.missing
        else:
            yield from self.embedded


class PaperCandidateScanTests(unittest.TestCase):
    def test_rest_page_filters_server_side_without_selecting_vectors(self) -> None:
        client = object.__new__(embed_papers.PaperEmbeddingClient)

        with patch.object(client, "request_json", return_value=[]) as request:
            client._select_page(100, 200, "is.null", True)

        _, query = request.call_args.args
        self.assertEqual(query["embedding"], "is.null")
        self.assertEqual(query["is_classic"], "eq.true")
        self.assertNotIn("embedding", query["select"].split(","))
        self.assertEqual(query["order"], "ingested_at.asc,id.asc")

    def test_missing_paper_beyond_old_fresh_window_is_selected(self) -> None:
        client = FakePaperClient(
            missing=[paper(1025)],
            embedded=[paper(index) for index in range(1, 1025)],
        )

        scan = embed_papers.load_candidates(client, MODEL, 256, 1024, False)

        self.assertEqual([candidate.id for candidate in scan.candidates], ["1025"])
        self.assertEqual(scan.inspected, 1025)
        self.assertTrue(scan.scan_complete)
        self.assertEqual(client.calls[0][1], "is.null")

    def test_bounded_runs_make_progress_through_missing_work(self) -> None:
        missing = [paper(index) for index in range(1, 6)]
        embedded: list[dict[str, object]] = []
        selected: list[str] = []

        while missing:
            client = FakePaperClient(missing, embedded)
            scan = embed_papers.load_candidates(client, MODEL, 2, 2, False)
            batch = [candidate.id for candidate in scan.candidates]
            selected.extend(batch)
            embedded.extend(row for row in missing if row["id"] in batch)
            missing = [row for row in missing if row["id"] not in batch]

        self.assertEqual(selected, ["1", "2", "3", "4", "5"])

    def test_embedded_scan_preserves_model_and_content_hash_checks(self) -> None:
        changed = paper(2)
        changed["embedding_content_hash"] = "stale"
        client = FakePaperClient([], [paper(1), changed, paper(3, current=False)])

        scan = embed_papers.load_candidates(client, MODEL, 10, 2, False)

        self.assertEqual(
            [(candidate.id, candidate.stale_reason) for candidate in scan.candidates],
            [("2", "content_changed"), ("3", "model_changed")],
        )
        self.assertTrue(scan.scan_complete)

    def test_classic_scan_propagates_server_filter(self) -> None:
        client = FakePaperClient([paper(99)], [])

        scan = embed_papers.load_candidates(
            client,
            MODEL,
            1,
            100,
            False,
            classic_only=True,
        )

        self.assertEqual(scan.candidates[0].id, "99")
        self.assertEqual(client.calls, [(100, "is.null", True)])

    def test_until_fresh_logs_batches_and_prints_only_final_summary(self) -> None:
        first = embed_papers.PaperCandidate(
            "1", "One", "Abstract", "One\n\nAbstract", "hash-1", "missing_embedding"
        )
        second = embed_papers.PaperCandidate(
            "2", "Two", "Abstract", "Two\n\nAbstract", "hash-2", "missing_embedding"
        )
        scans = [
            embed_papers.CandidateScan([first], 1, False),
            embed_papers.CandidateScan([second], 2, True),
            embed_papers.CandidateScan([], 2, True),
        ]

        class Vector:
            def tolist(self) -> list[float]:
                return [0.0] * embed_papers.EMBEDDING_DIMENSION

        class Model:
            def encode(self, texts, **_kwargs):
                return [Vector() for _text in texts]

        with tempfile.TemporaryDirectory() as directory:
            log_file = Path(directory) / "backfill.log"
            args = SimpleNamespace(
                model=MODEL,
                limit=1,
                table_limit=100,
                force=False,
                classic_only=False,
                dry_run=False,
                until_fresh=True,
                batch_size=1,
                quiet=True,
                max_batches=10,
                log_file=log_file,
            )
            output = io.StringIO()

            with (
                patch.object(embed_papers, "load_local_env"),
                patch.object(embed_papers, "parse_args", return_value=args),
                patch.object(embed_papers, "PaperEmbeddingClient", return_value=object()),
                patch.object(embed_papers, "load_candidates", side_effect=scans),
                patch.object(embed_papers, "load_model", return_value=Model()) as load_model,
                patch.object(embed_papers, "write_embeddings") as write_embeddings,
                redirect_stdout(output),
            ):
                embed_papers.main()

            console_lines = output.getvalue().splitlines()
            log_events = [json.loads(line) for line in log_file.read_text().splitlines()]

        self.assertEqual(len(console_lines), 1)
        self.assertEqual(json.loads(console_lines[0])["status"], "catalog_fully_fresh")
        self.assertEqual(load_model.call_count, 1)
        self.assertEqual(write_embeddings.call_count, 2)
        self.assertEqual(
            [event["event"] for event in log_events],
            ["run_started", "batch_completed", "batch_completed", "run_completed"],
        )

    def test_until_fresh_logs_terminal_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            log_file = Path(directory) / "backfill.log"
            args = SimpleNamespace(
                model=MODEL,
                limit=1,
                table_limit=100,
                force=False,
                classic_only=False,
                dry_run=False,
                until_fresh=True,
                batch_size=1,
                quiet=True,
                max_batches=10,
                log_file=log_file,
            )

            with (
                patch.object(embed_papers, "load_local_env"),
                patch.object(embed_papers, "parse_args", return_value=args),
                patch.object(embed_papers, "PaperEmbeddingClient", return_value=object()),
                patch.object(
                    embed_papers,
                    "load_candidates",
                    side_effect=RuntimeError("network unavailable"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "network unavailable"):
                    embed_papers.main()

            log_events = [json.loads(line) for line in log_file.read_text().splitlines()]

        self.assertEqual(
            [event["event"] for event in log_events],
            ["run_started", "run_failed"],
        )
        self.assertEqual(log_events[-1]["errorType"], "RuntimeError")


if __name__ == "__main__":
    unittest.main()
