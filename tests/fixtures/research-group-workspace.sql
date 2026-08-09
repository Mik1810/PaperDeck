-- Synthetic, disposable data for the isolated research-group workspace test.
-- This fixture contains no real account, email, token, or external identifier.

begin;

insert into public.profiles (owner_id, display_name, onboarding_completed_at)
values
  ('local-group-owner', 'Local owner', now()),
  ('local-group-admin', 'Local admin', now()),
  ('local-group-member', 'Local member', now());

insert into public.collaboration_identities (
  owner_id,
  public_id,
  email_lookup_hash,
  discoverable_by_email,
  group_invite_policy
)
values
  (
    'local-group-owner',
    '10000000-0000-4000-8000-000000000001',
    encode(digest('local-group-owner', 'sha256'), 'hex'),
    false,
    'nobody'
  ),
  (
    'local-group-admin',
    '10000000-0000-4000-8000-000000000002',
    encode(digest('local-group-admin', 'sha256'), 'hex'),
    false,
    'nobody'
  ),
  (
    'local-group-member',
    '10000000-0000-4000-8000-000000000003',
    encode(digest('local-group-member', 'sha256'), 'hex'),
    false,
    'nobody'
  );

insert into public.taxonomy_topics (
  id,
  slug,
  label,
  source,
  arxiv_category,
  depth,
  sort_order
)
values (
  '20000000-0000-4000-8000-000000000001',
  'local-systems',
  'Computer Systems',
  'local-fixture',
  'cs.DC',
  0,
  0
);

insert into public.papers (
  id,
  title,
  abstract,
  year,
  source,
  url,
  access,
  is_open_access
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'Synthetic Distributed Systems Baseline',
    'A disposable catalog record used only by the local workspace test.',
    2025,
    'manual',
    'https://example.invalid/papers/local-baseline',
    'open',
    true
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'Synthetic Retrieval for Shared Reading',
    'A second disposable record used to exercise catalog search and group operations.',
    2026,
    'manual',
    'https://example.invalid/papers/local-retrieval',
    'open',
    true
  );

insert into public.paper_authors (paper_id, name, position)
values
  ('30000000-0000-4000-8000-000000000001', 'Synthetic Author A', 0),
  ('30000000-0000-4000-8000-000000000002', 'Synthetic Author B', 0);

insert into public.paper_topics (paper_id, topic_id, confidence, source)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    1,
    'local-fixture'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    1,
    'local-fixture'
  );

insert into public.research_groups (id, name, description)
values (
  '40000000-0000-4000-8000-000000000001',
  'Local research group',
  'Disposable workspace for browser verification.'
);

insert into public.research_group_members (group_id, member_id, role, joined_at)
values
  (
    '40000000-0000-4000-8000-000000000001',
    'local-group-owner',
    'owner',
    now() - interval '3 days'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    'local-group-admin',
    'admin',
    now() - interval '2 days'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    'local-group-member',
    'member',
    now() - interval '1 day'
  );

insert into public.research_group_paper_items (
  group_id,
  paper_id,
  added_by,
  added_at
)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'local-group-admin',
  now() - interval '1 hour'
);

update private.research_group_runtime_settings
set reads_enabled = true,
    writes_enabled = true,
    updated_at = now()
where singleton;

commit;
