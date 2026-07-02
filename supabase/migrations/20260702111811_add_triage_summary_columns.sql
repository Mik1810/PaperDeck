alter table papers
  add column triage_summary jsonb,
  add column triage_summary_model text,
  add column triage_summary_generated_at timestamptz;
