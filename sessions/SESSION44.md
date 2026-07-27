# Session 44

## Local Gemma triage-summary evaluation

- Confirmed that Unsloth can expose a local Gemma model through llama.cpp's OpenAI-compatible API.
- Added a `--no-write` mode to the local summary worker so model output can be generated, validated, timed, and inspected without updating Supabase.
- Kept `--dry-run` as candidate discovery only and made it mutually exclusive with `--no-write`.
- Added an all-failed exit status and reported average local inference time.
- Hardened local generation with a strict JSON schema, exact field/type/length validation, source-grounding instructions, and explicit mathematical-notation preservation.
- Hardened JSON parsing so single-backslash LaTeX commands emitted by local models remain literal notation instead of becoming invalid or silently interpreted JSON escapes.
