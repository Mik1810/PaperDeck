import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  paperFromRow,
  type PaperPresentationRow,
  type PaperPresentationTopic,
} from "@/lib/repositories/catalog";
import {
  RESEARCH_GROUP_PAPER_LIMIT,
  type ResearchGroupPaperNotificationPreference,
} from "@/lib/repositories/research-group-papers";
import {
  type ResearchGroupMemberSummary,
  type ResearchGroupSummary,
} from "@/lib/repositories/research-groups";
import { requireOwnerId } from "@/lib/repositories/owner-guard";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import type { Paper } from "@/types/paper";

type WorkspacePaperProjection = PaperPresentationRow & {
  authors: string[];
  topics: PaperPresentationTopic[];
};

type WorkspacePaperRow = {
  paper: WorkspacePaperProjection;
  contributor: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  } | null;
  addedAt: string;
  canRemove: boolean;
};

type WorkspaceRow = {
  id: string;
  name: string;
  description: string | null;
  role: ResearchGroupSummary["role"];
  revision: string;
  created_at: string;
  updated_at: string;
  paper_notification_preference: ResearchGroupPaperNotificationPreference;
  papers: WorkspacePaperRow[];
  members: ResearchGroupMemberSummary[];
  read_later_count: number;
};

export type ResearchGroupWorkspace = {
  group: ResearchGroupSummary;
  papers: Array<{
    paper: Paper;
    contributor: WorkspacePaperRow["contributor"];
    addedAt: string;
    canRemove: boolean;
  }>;
  members: ResearchGroupMemberSummary[];
  preference: ResearchGroupPaperNotificationPreference;
  readLaterCount: number;
};

/**
 * Loads the complete visible group workspace in one authorized PostgreSQL
 * statement. The materialized CTE is the only root for every nested result, so
 * an inactive group, disabled read switch, or revoked membership yields no
 * group, paper, member, or private-library data.
 */
/** @user-scoped */
export async function loadResearchGroupWorkspace(
  actorOwnerId: string,
  groupId: string,
): Promise<ResearchGroupWorkspace> {
  requireOwnerId(actorOwnerId, "loadResearchGroupWorkspace");

  const rows = await db.execute<WorkspaceRow>(sql`
    with authorized_group as materialized (
      select
        group_row.id,
        group_row.name,
        group_row.description,
        group_row.revision,
        group_row.created_at,
        group_row.updated_at,
        actor_membership.role,
        actor_membership.paper_notification_preference
      from research_groups as group_row
      inner join research_group_members as actor_membership
        on actor_membership.group_id = group_row.id
       and actor_membership.member_id = ${actorOwnerId}
       and actor_membership.revoked_at is null
      inner join private.research_group_runtime_settings as runtime_settings
        on runtime_settings.singleton
       and runtime_settings.reads_enabled
      where group_row.id = ${groupId}::uuid
        and group_row.state = 'active'
      limit 1
    ),
    limited_group_papers as materialized (
      select
        group_paper.group_id,
        group_paper.paper_id,
        group_paper.added_by,
        group_paper.added_at
      from research_group_paper_items as group_paper
      inner join authorized_group
        on authorized_group.id = group_paper.group_id
      order by group_paper.added_at desc, group_paper.paper_id desc
      limit ${RESEARCH_GROUP_PAPER_LIMIT}
    ),
    paper_authors_by_paper as (
      select
        author.paper_id,
        jsonb_agg(author.name order by author.position) as authors
      from paper_authors as author
      inner join limited_group_papers as selected_paper
        on selected_paper.paper_id = author.paper_id
      group by author.paper_id
    ),
    paper_topics_by_paper as (
      select
        paper_topic.paper_id,
        jsonb_agg(
          jsonb_build_object(
            'id', topic.id,
            'label', topic.label,
            'parentId', topic.parent_id,
            'arxivCategory', topic.arxiv_category
          )
          order by topic.sort_order, topic.id
        ) as topics
      from paper_topics as paper_topic
      inner join limited_group_papers as selected_paper
        on selected_paper.paper_id = paper_topic.paper_id
      inner join taxonomy_topics as topic
        on topic.id = paper_topic.topic_id
      group by paper_topic.paper_id
    )
    select
      authorized_group.id,
      authorized_group.name,
      authorized_group.description,
      authorized_group.role,
      authorized_group.revision::text as revision,
      authorized_group.created_at,
      authorized_group.updated_at,
      authorized_group.paper_notification_preference,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'paper', jsonb_build_object(
              'id', paper.id,
              'title', paper.title,
              'abstract', paper.abstract,
              'year', paper.year,
              'source', paper.source,
              'url', paper.url,
              'pdfUrl', paper.pdf_url,
              'venue', paper.venue,
              'doi', paper.doi,
              'citationCount', paper.citation_count,
              'isClassic', paper.is_classic,
              'access', paper.access,
              'triageSummary', paper.triage_summary,
              'authors', coalesce(author_bundle.authors, '[]'::jsonb),
              'topics', coalesce(topic_bundle.topics, '[]'::jsonb)
            ),
            'contributor', case
              when contributor_identity.public_id is null then null
              else jsonb_build_object(
                'publicId', contributor_identity.public_id,
                'displayName', contributor_profile.display_name,
                'imageUrl', contributor_profile.image_url
              )
            end,
            'addedAt', group_paper.added_at,
            'canRemove',
              authorized_group.role in ('owner', 'admin')
              or group_paper.added_by = ${actorOwnerId}
          )
          order by group_paper.added_at desc, group_paper.paper_id desc
        )
        from limited_group_papers as group_paper
        inner join papers as paper
          on paper.id = group_paper.paper_id
        left join paper_authors_by_paper as author_bundle
          on author_bundle.paper_id = group_paper.paper_id
        left join paper_topics_by_paper as topic_bundle
          on topic_bundle.paper_id = group_paper.paper_id
        left join research_group_members as contributor_membership
          on contributor_membership.group_id = group_paper.group_id
         and contributor_membership.member_id = group_paper.added_by
         and contributor_membership.revoked_at is null
        left join profiles as contributor_profile
          on contributor_profile.owner_id = contributor_membership.member_id
        left join collaboration_identities as contributor_identity
          on contributor_identity.owner_id = contributor_membership.member_id
      ), '[]'::jsonb) as papers,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'publicId', member_identity.public_id,
            'displayName', member_profile.display_name,
            'imageUrl', member_profile.image_url,
            'role', member_row.role,
            'joinedAt', member_row.joined_at,
            'isCurrentUser', member_row.member_id = ${actorOwnerId}
          )
          order by
            case member_row.role
              when 'owner' then 1
              when 'admin' then 2
              else 3
            end,
            member_row.joined_at,
            member_identity.public_id
        )
        from research_group_members as member_row
        inner join profiles as member_profile
          on member_profile.owner_id = member_row.member_id
        inner join collaboration_identities as member_identity
          on member_identity.owner_id = member_row.member_id
        where member_row.group_id = authorized_group.id
          and member_row.revoked_at is null
      ), '[]'::jsonb) as members,
      (
        select count(*)::integer
        from playlists as read_later
        inner join playlist_items as read_later_item
          on read_later_item.playlist_id = read_later.id
        where read_later.owner_id = ${actorOwnerId}
          and read_later.name = 'Read later'
          and authorized_group.id = ${groupId}::uuid
      ) as read_later_count
    from authorized_group
  `);
  const row = rows[0];

  if (!row) {
    throw new ResearchGroupUnavailableError();
  }

  return {
    group: {
      id: row.id,
      name: row.name,
      description: row.description,
      role: row.role,
      revision: Number(row.revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    papers: row.papers.map((item) => ({
      paper: paperFromRow(
        item.paper,
        item.paper.authors,
        item.paper.topics,
      ),
      contributor: item.contributor,
      addedAt: item.addedAt,
      canRemove: item.canRemove,
    })),
    members: row.members,
    preference: row.paper_notification_preference,
    readLaterCount: Number(row.read_later_count),
  };
}
