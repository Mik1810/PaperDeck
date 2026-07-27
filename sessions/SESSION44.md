# Session 44

## Local Gemma triage-summary evaluation

- Confirmed that Unsloth can expose a local Gemma model through llama.cpp's OpenAI-compatible API.
- Added a `--no-write` mode to the local summary worker so model output can be generated, validated, timed, and inspected without updating Supabase.
- Kept `--dry-run` as candidate discovery only and made it mutually exclusive with `--no-write`.
- Added an all-failed exit status and reported average local inference time.
- Hardened local generation with a strict JSON schema, exact field/type/length validation, source-grounding instructions, and a prohibition on reconstructed equations in triage prose.
- Hardened JSON parsing so single-backslash LaTeX commands emitted by local models remain literal notation instead of becoming invalid or silently interpreted JSON escapes.
- Replaced first-characters-only PDF truncation with a bounded section-aware sample covering the opening, method, results/evaluation, and conclusion/limitations, while retaining a `--pdf-strategy first` comparison mode.
- Added stratified method/results/conclusion fallback windows for PDFs whose extracted section headings do not match conventional names.
- Added deterministic rejection of LaTeX commands and symbolic complexity expressions in generated prose, plus one bounded plain-English retry. A model that insists on reconstructing formulas now fails the paper without writing it.
