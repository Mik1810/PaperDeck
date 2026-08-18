# Session 92

## Local Unsloth summary-generation runbook

### Context

- Investigated the scheduled summary backlog and prepared the existing local
  Gemma workflow as a free fallback for summary generation.
- Confirmed that Unsloth Studio and its managed llama.cpp child must be treated
  as separate endpoints: Studio listens on authenticated port 8888, while the
  PaperDeck worker currently uses the child's loopback port.
- Confirmed that the Gemma GGUF is stored in the Hugging Face cache rather than
  the empty user-facing `models` directory.

### Verified local configuration

- Started `unsloth/gemma-4-E4B-it-GGUF`, variant `UD-Q4_K_XL`, through
  `unsloth studio run` rather than launching llama.cpp directly.
- Used an 8,192-token context, one parallel slot, automatic GPU placement, MTP
  speculative decoding with two draft tokens, and reasoning disabled.
- Diagnosed HTTP 401 as an unauthenticated request to the Studio endpoint.
- Diagnosed HTTP 400 from the managed llama.cpp log: a 4,873-token request
  exceeded the earlier 4,096-token context.
- Verified the internal health endpoint and completed one 20,000-character PDF
  no-write summary in 7.2 seconds with valid structured JSON.
- Observed that dollar-delimited inline notation can survive the current math
  validator as an ordinary JSON string; this does not break parsing or storage.

### Data snapshot

- A read-only exact Supabase count on 2026-08-18 found 1,093 papers with a null
  `triage_summary`.
- All 1,093 also had an abstract and were eligible for the local worker.
- No production summary batch was run as part of this documentation change.

### Documentation

- Added `docs/local-summary-generation.md` with the complete WSL workflow:
  Unsloth startup, internal-port discovery, health check, no-write validation,
  batches of 50, optional checkpoint reporting, shutdown, and troubleshooting
  for HTTP 401, HTTP 400, empty ports, and the PyMuPDF warning.
- Linked the runbook to the prompt implementation and the earlier Session 44
  evaluation so the operational command and validated summarization behavior
  remain traceable.

### Validation

- Confirmed both relative documentation links resolve to existing files.
- `git diff --check`: passed.
