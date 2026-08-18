# Local Triage Summary Generation with Unsloth

Last verified: 2026-08-18

This guide describes how to generate PaperDeck triage summaries locally with
Unsloth Studio and `unsloth/gemma-4-E4B-it-GGUF`. The model and prompt were
evaluated in [Session 44](../sessions/SESSION44.md).

The local worker:

- downloads an arXiv PDF when available;
- selects up to 20,000 characters across the opening, method, results, and
  conclusion rather than taking only the start of the paper;
- sends PaperDeck's validated system prompt and strict JSON schema;
- reads the active llama.cpp context size and tokenizes the fully templated
  prompt before inference;
- proportionally trims every selected section when needed, preserving room for
  the JSON response;
- validates the four summary fields before writing them;
- writes only while `triage_summary` is still null, so it does not overwrite a
  summary produced concurrently.

The prompt is part of
[`scripts/generate_summaries_local.py`](../scripts/generate_summaries_local.py).
It does not need to be copied into Unsloth Studio.

## Prerequisites

- Run the commands inside the Ubuntu WSL distribution.
- PaperDeck must be available at `/home/mik/github/PaperDeck` with a configured
  `.env.local` containing the required Supabase server credentials.
- Unsloth Studio must be installed under `/home/mik/.unsloth/studio`.
- The tested GGUF is `unsloth/gemma-4-E4B-it-GGUF`, variant `UD-Q4_K_XL`.

Unsloth stores the downloaded model in the Hugging Face cache. An empty
`models` directory does not mean that the GGUF is missing.

## 1. Start Gemma through Unsloth Studio

Stop any existing Unsloth or directly launched llama.cpp model first. From a
WSL terminal, run:

```bash
cd /home/mik/.unsloth/studio

./unsloth_studio/bin/unsloth studio run \
  --model unsloth/gemma-4-E4B-it-GGUF \
  --gguf-variant UD-Q4_K_XL \
  --max-seq-length 8192 \
  --parallel 1 \
  --gpu-memory-mode auto \
  --speculative-type mtp \
  --spec-draft-n-max 2 \
  --reasoning off
```

Keep this terminal open. The Unsloth interface is available at
<http://localhost:8888>.

These settings were verified on an NVIDIA laptop GPU with 8 GB of VRAM. The
worker adapts the default 20,000-character PDF sample to the active context. It
reserves 1,024 tokens for output plus a 64-token safety margin, then uses
llama.cpp's `/apply-template` and `/tokenize` endpoints to fit the representative
excerpt precisely. This matters because PDF token density varies: observed
20,000-character prompts ranged from 6,020 to more than 8,192 tokens. One
parallel slot keeps the full context available to each request and limits VRAM
pressure. Reasoning is disabled because the worker requests concise structured
JSON.

Unsloth uses `llama-server` internally for GGUF inference. Seeing that child
process is expected; start it through the `unsloth studio run` command above,
not directly.

## 2. Find the internal inference port

Port 8888 belongs to the authenticated Unsloth Studio application. PaperDeck's
local worker currently sends no Studio API key, so using port 8888 produces
HTTP 401. Point the worker at the loopback port of the llama.cpp child managed
by Unsloth instead.

In a second WSL terminal, run:

```bash
UNSLOTH_LLM_PORT="$(
  ps -eo args= |
  sed -nE 's#^.*/llama-server .*--port ([0-9]+).*#\1#p' |
  head -n1
)"

echo "Unsloth inference port: $UNSLOTH_LLM_PORT"
curl "http://127.0.0.1:$UNSLOTH_LLM_PORT/health"
```

Continue only after the health endpoint returns:

```json
{"status":"ok"}
```

The internal port changes when the model restarts, so recover it again after
every restart. If the printed value is empty, Gemma has not finished loading or
has not been started.

## 3. Validate one summary without writing

Run a single end-to-end generation before each long batch:

```bash
cd /home/mik/github/PaperDeck

LLAMA_CPP_URL="http://127.0.0.1:$UNSLOTH_LLM_PORT" \
LLAMA_CPP_MODEL_LABEL="unsloth/gemma-4-E4B-it-GGUF" \
npm run generate:summaries:local -- --no-write --limit 1
```

`--no-write` downloads and samples the PDF, calls Gemma, parses and validates
the JSON, and prints the result without changing Supabase. On the verified
configuration, the test paper completed in 7.2 seconds.

The separate `--dry-run` mode only lists candidates and does not call Gemma.

## 4. Generate batches of 50

After the no-write test succeeds, generate and store 50 summaries:

```bash
cd /home/mik/github/PaperDeck

LLAMA_CPP_URL="http://127.0.0.1:$UNSLOTH_LLM_PORT" \
LLAMA_CPP_MODEL_LABEL="unsloth/gemma-4-E4B-it-GGUF" \
npm run generate:summaries:local -- --limit 50
```

Run the same command again for the next batch. The worker selects the newest
papers whose `triage_summary` is null. As of 2026-08-18, there were 1,093 such
papers, all with an abstract and therefore eligible for the local worker. This
number is a dated snapshot and decreases as batches complete.

For an unattended run, add an atomically updated, secret-free progress report:

```bash
LLAMA_CPP_URL="http://127.0.0.1:$UNSLOTH_LLM_PORT" \
LLAMA_CPP_MODEL_LABEL="unsloth/gemma-4-E4B-it-GGUF" \
npm run generate:summaries:local -- \
  --limit 50 \
  --report /tmp/paperdeck-local-summaries.json
```

## Troubleshooting

### `HTTP Error 401: Unauthorized`

The worker was pointed at `http://127.0.0.1:8888`, which is the authenticated
Studio API. Recover the current internal port and use it in `LLAMA_CPP_URL`.

### Context fitting and `HTTP Error 400: Bad Request`

Confirm that the Unsloth child process contains `-c 8192` and `--parallel 1`:

```bash
ps -eo args= | grep '[l]lama-server'
```

Before every inference, the worker prints the active context, prompt budget, and
actual prompt-token count. Oversized excerpts are reduced automatically while
retaining material from every selected section. llama.cpp error messages are
included in request failures; a paper-specific 400, 413, or 422 is recorded as a
failed paper and does not abort the remaining batch.

A 4,096-token context leaves substantially less paper evidence after reserving
the JSON output budget. Prefer restarting with 8,192 tokens. If that is not
possible, an explicit lower-input fallback remains available:

```bash
npm run generate:summaries:local -- \
  --limit 1 \
  --pdf-chars 8000 \
  --max-tokens 1024
```

### `No JSON object found` or a truncated response

The worker reserves output space before inference and reports a specific error
when llama.cpp returns `finish_reason: length`. A malformed model response is
failed without being written. Use `--debug` to print the first 500 characters of
the local response.

### Empty internal port

Open <http://localhost:8888> and confirm that Gemma is loaded and ready. Also
inspect the terminal running `unsloth studio run` for a model-loading error.

### Mathematical notation rejected by validation

If a complete JSON response contains forbidden equations, LaTeX commands, or
symbolic complexity expressions such as `O(...)`, the worker sends that JSON
through one short edit-only retry. The retry preserves the existing facts and
rewrites only the validation problem in plain English; it does not resend or
regenerate the full paper prompt.

### Inline mathematical notation in an accepted summary

The JSON parser preserves inline notation such as `$z_T$` as an ordinary
string, so it does not break parsing or storage. The current deterministic
math check does not reject every dollar-delimited expression; an otherwise
valid summary can therefore retain that notation even though the prompt asks
Gemma to use plain English.

## Stop the local model

Press `Ctrl+C` in the terminal running `unsloth studio run`. This stops Studio
and the llama.cpp child it manages.
