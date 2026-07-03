# ChatGPT Summary Workflow

## 1. Generate the prompt

```bash
npm run generate:chatgpt-prompt
# → writes prompts/chatgpt_summary_prompt.txt (20 papers, title + abstract)
```

To customize the count:

```bash
uv run scripts/dump_papers_for_chatgpt.py --limit 10 --output prompts/chatgpt_summary_prompt.txt
```

## 2. Paste into ChatGPT

- Open `prompts/chatgpt_summary_prompt.txt`
- Copy the entire content
- Paste into a **new ChatGPT conversation** (use GPT-4o or GPT-4.1)
- ChatGPT will respond with a JSON array

## 3. Save ChatGPT output

Copy the JSON array from ChatGPT and save it to a file:

```bash
# Paste into a new file
cat > /tmp/chatgpt_output.json
# Paste JSON, then Ctrl+D
```

**Expected format:**

```json
[
  {
    "arxiv_id": "2607.01842",
    "why_it_matters": "...",
    "main_contribution": "...",
    "prerequisites": "...",
    "read_if_you_care_about": "..."
  },
  ...
]
```

## 4. Validate (dry-run)

```bash
uv run scripts/import_chatgpt_summaries.py /tmp/chatgpt_output.json --dry-run
```

Or via npm:

```bash
npm run import:chatgpt-summaries -- /tmp/chatgpt_output.json --dry-run
```

## 5. Import into Supabase

```bash
uv run scripts/import_chatgpt_summaries.py /tmp/chatgpt_output.json
```

The script will:
- Parse the JSON array (handles markdown fence wrapping)
- Look up each paper by `arxiv_id` in Supabase
- Validate all 4 fields are present and non-empty
- Write `triage_summary`, `triage_summary_model` (`chatgpt:manual`), and timestamp
- Report OK / skipped / failed counts
