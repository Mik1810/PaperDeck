import io
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import generate_summaries_local as summaries


class LocalSummaryGenerationTests(unittest.TestCase):
    def test_context_size_uses_llama_props_envelope(self) -> None:
        props = {"default_generation_settings": {"params": {}, "n_ctx": 8192}}
        with patch.object(summaries, "request_json", return_value=props):
            self.assertEqual(summaries.get_context_size(), 8192)

    def test_shrink_excerpt_preserves_representative_sections(self) -> None:
        excerpt = "\n\n".join(
            [
                "[OPENING]\n" + "a" * 100,
                "[METHOD]\n" + "b" * 100,
                "[RESULTS]\n" + "c" * 100,
                "[CONCLUSION]\n" + "d" * 100,
            ]
        )

        shortened = summaries.shrink_excerpt(excerpt, 240)

        self.assertLessEqual(len(shortened), 240)
        for heading in ("[OPENING]", "[METHOD]", "[RESULTS]", "[CONCLUSION]"):
            self.assertIn(heading, shortened)

    def test_fit_text_uses_prompt_token_budget(self) -> None:
        excerpt = "\n\n".join(
            [
                "[OPENING]\n" + "a" * 4000,
                "[METHOD]\n" + "b" * 4000,
                "[RESULTS]\n" + "c" * 4000,
                "[CONCLUSION]\n" + "d" * 4000,
            ]
        )

        def fake_count(messages: list[dict[str, str]]) -> int:
            return 500 + len(messages[1]["content"]) // 4

        with patch.object(summaries, "count_prompt_tokens", side_effect=fake_count):
            fitted, prompt_tokens = summaries.fit_text_to_context(
                "Title",
                excerpt,
                context_size=4096,
                max_tokens=1024,
                context_margin=64,
            )

        self.assertLess(len(fitted), len(excerpt))
        self.assertLessEqual(prompt_tokens, 3008)
        self.assertGreater(prompt_tokens, 2950)
        for heading in ("[OPENING]", "[METHOD]", "[RESULTS]", "[CONCLUSION]"):
            self.assertIn(heading, fitted)

    def test_http_error_detail_extracts_llama_message(self) -> None:
        error = urllib.error.HTTPError(
            "http://localhost/v1/chat/completions",
            400,
            "Bad Request",
            {},
            io.BytesIO(
                b'{"error":{"message":"request exceeds context",'
                b'"type":"exceed_context_size_error"}}'
            ),
        )

        self.assertEqual(
            summaries.http_error_detail(error),
            "HTTP 400: request exceeds context (exceed_context_size_error)",
        )

    def test_rejected_generation_request_is_recoverable(self) -> None:
        error = urllib.error.HTTPError(
            "http://localhost/v1/chat/completions",
            400,
            "Bad Request",
            {},
            io.BytesIO(b'{"error":{"message":"too many tokens"}}'),
        )

        with patch.object(summaries.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(summaries.LlmRequestError, "too many tokens"):
                summaries.request_json("/v1/chat/completions", {"messages": []})

    def test_correction_edits_previous_json_instead_of_resending_paper(self) -> None:
        response = summaries.LlmResponse("{}", "stop", 20, 5)
        with patch.object(summaries, "request_completion", return_value=response) as request:
            actual = summaries.correct_llm_response(
                '{"main_contribution":"O(n)"}',
                "main_contribution contains a forbidden mathematical expression",
                1024,
            )

        self.assertEqual(actual, response)
        messages = request.call_args.args[0]
        self.assertIn('{"main_contribution":"O(n)"}', messages[1]["content"])
        self.assertNotIn("Paper title:", messages[1]["content"])


if __name__ == "__main__":
    unittest.main()
