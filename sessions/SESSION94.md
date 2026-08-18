# Session 94

## Local summary context and validation recovery

- Reproduced two local Gemma failures against the active Unsloth-managed
  llama.cpp server. A nominal 20,000-character excerpt used 7,905 prompt tokens
  and left only 287 tokens for output, truncating the JSON; another prompt used
  8,374 tokens and was rejected by the 8,192-token context.
- Added exact preflight budgeting through llama.cpp `/props`, `/apply-template`,
  and `/tokenize`. The worker reserves its configured output budget and safety
  margin, then proportionally reduces labeled opening, method, results, and
  conclusion excerpts only when required.
- Preserved server error details while treating paper-specific HTTP 400, 413,
  and 422 responses as recoverable batch failures. Connectivity, authorization,
  and invalid server envelopes remain fatal configuration/runtime failures.
- Changed the mathematical-notation retry to edit the completed JSON directly
  instead of regenerating from the full paper. Added explicit detection for
  `finish_reason: length` and moved PyMuPDF to its supported `pymupdf` import.
- Added deterministic Python unit coverage for proportional excerpt shrinking,
  token budgeting, HTTP error extraction/classification, and response-only
  correction.

## Validation

- `uv run --with-requirements requirements-summaries.txt python -m unittest discover -s tests/python -p 'test_*.py'`
- Live `--no-write` reproduction for arXiv `2608.12150`: input reduced from
  20,000 to 17,538 characters, prompt fit at 7,104 of 7,104 budgeted tokens, and
  complete validated JSON generated.
- Live `--no-write` reproduction for arXiv `2608.12194`: original 6,020-token
  prompt fit without trimming; response-only retry replaced both forbidden
  complexity expressions and produced validated JSON.
