import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import embed_papers


MODEL = "sentence-transformers/all-MiniLM-L6-v2"
FIXTURE_URL_PREFIX = "https://paperdeck.local/embedding-scan/"


def database_environment() -> dict[str, str]:
    parsed = urlparse(os.environ["PAPERDECK_TEST_DATABASE_URL"])
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Embedding integration test requires a loopback database")
    if parsed.path != "/paperdeck_test":
        raise RuntimeError("Embedding integration test requires paperdeck_test")

    return {
        **os.environ,
        "PGDATABASE": "paperdeck_test",
        "PGHOST": parsed.hostname or "127.0.0.1",
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGPORT": str(parsed.port or 5432),
        "PGSSLMODE": "disable",
        "PGUSER": unquote(parsed.username or ""),
    }


def psql(sql: str) -> list[str]:
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        check=True,
        capture_output=True,
        env=database_environment(),
        text=True,
    )
    return result.stdout.splitlines()


class LocalDatabasePaperClient:
    def iter_papers(
        self,
        page_size: int,
        embedding_filter: str | None,
        classic_only: bool,
    ):
        page_size = min(page_size, 1000)
        offset = 0
        embedding_predicate = {
            "is.null": "embedding is null",
            "not.is.null": "embedding is not null",
            None: "true",
        }[embedding_filter]
        classic_predicate = "and is_classic" if classic_only else ""

        while True:
            rows = psql(
                f"""
                select json_build_object(
                  'id', id,
                  'title', title,
                  'abstract', abstract,
                  'embedding_model', embedding_model,
                  'embedding_content_hash', embedding_content_hash,
                  'ingested_at', ingested_at
                )
                from papers
                where url like '{FIXTURE_URL_PREFIX}%'
                  and {embedding_predicate}
                  {classic_predicate}
                order by ingested_at asc, id asc
                limit {page_size} offset {offset}
                """
            )
            if not rows:
                break
            yield from (json.loads(row) for row in rows)
            offset += len(rows)
            if len(rows) < page_size:
                break


@unittest.skipUnless(
    os.getenv("PAPERDECK_RUN_EMBEDDING_DB_INTEGRATION") == "true",
    "set PAPERDECK_RUN_EMBEDDING_DB_INTEGRATION=true to run",
)
class PaperEmbeddingDatabaseIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        psql(f"delete from papers where url like '{FIXTURE_URL_PREFIX}%'")
        psql(
            f"""
            with fixture as (
              select
                item,
                ('00000000-0000-0000-0000-' || lpad(item::text, 12, '0'))::uuid as id,
                'Fixture paper ' || item as title,
                'Fixture abstract ' || item as abstract
              from generate_series(1, 1027) as item
            )
            insert into papers (
              id, title, abstract, source, url, is_classic, embedding,
              embedding_model, embedding_dimension, embedding_content_hash,
              embedded_at, ingested_at
            )
            select
              id,
              title,
              abstract,
              'arxiv',
              '{FIXTURE_URL_PREFIX}' || item,
              false,
              case when item = 1025 then null
                else array_fill(0::real, array[384])::vector end,
              case when item = 1025 then null
                when item = 1027 then 'old-model'
                else '{MODEL}' end,
              case when item = 1025 then null else 384 end,
              case when item = 1025 then null
                when item = 1026 then 'stale'
                else encode(digest(title || E'\\n\\n' || abstract, 'sha256'), 'hex') end,
              case when item = 1025 then null else now() end,
              timestamptz '2026-01-01 00:00:00Z' + item * interval '1 second'
            from fixture
            """
        )

    @classmethod
    def tearDownClass(cls) -> None:
        psql(f"delete from papers where url like '{FIXTURE_URL_PREFIX}%'")

    def test_mixed_catalog_dry_run_crosses_the_former_prefix(self) -> None:
        before = int(
            psql(
                f"select count(*) from papers where url like '{FIXTURE_URL_PREFIX}%' and embedding is not null"
            )[0]
        )

        scan = embed_papers.load_candidates(
            LocalDatabasePaperClient(),
            MODEL,
            limit=10,
            table_limit=100,
            force=False,
        )

        after = int(
            psql(
                f"select count(*) from papers where url like '{FIXTURE_URL_PREFIX}%' and embedding is not null"
            )[0]
        )
        self.assertEqual(
            [(candidate.id[-4:], candidate.stale_reason) for candidate in scan.candidates],
            [
                ("1025", "missing_embedding"),
                ("1026", "content_changed"),
                ("1027", "model_changed"),
            ],
        )
        self.assertEqual(scan.inspected, 1027)
        self.assertTrue(scan.scan_complete)
        self.assertEqual(before, after)

    def test_semantic_retrieval_keeps_the_current_model_filter(self) -> None:
        current_id = "00000000-0000-0000-0000-000000002001"
        old_id = "00000000-0000-0000-0000-000000002002"
        try:
            psql(
                f"""
                insert into papers (
                  id, title, abstract, source, url, embedding, embedding_model,
                  embedding_dimension, embedding_content_hash, embedded_at
                ) values
                (
                  '{current_id}', 'Current retrieval fixture', 'Abstract',
                  'arxiv', '{FIXTURE_URL_PREFIX}retrieval-current',
                  array_prepend(1::real, array_fill(0::real, array[383]))::vector,
                  '{MODEL}', 384, 'current-hash', now()
                ),
                (
                  '{old_id}', 'Old retrieval fixture', 'Abstract',
                  'arxiv', '{FIXTURE_URL_PREFIX}retrieval-old',
                  array_prepend(1::real, array_fill(0::real, array[383]))::vector,
                  'old-model', 384, 'old-hash', now()
                )
                """
            )
            current_matches = psql(
                f"""
                select paper_id
                from match_papers_by_embedding(
                  array_prepend(1::real, array_fill(0::real, array[383]))::vector,
                  10,
                  '{MODEL}'
                )
                where paper_id in ('{current_id}', '{old_id}')
                """
            )
            old_matches = psql(
                f"""
                select paper_id
                from match_papers_by_embedding(
                  array_prepend(1::real, array_fill(0::real, array[383]))::vector,
                  10,
                  'old-model'
                )
                where paper_id in ('{current_id}', '{old_id}')
                """
            )
        finally:
            psql(
                f"delete from papers where id in ('{current_id}', '{old_id}')"
            )

        self.assertEqual(current_matches, [current_id])
        self.assertEqual(old_matches, [old_id])


if __name__ == "__main__":
    unittest.main()
