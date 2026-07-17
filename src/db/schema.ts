import { pgTable, pgPolicy, text, timestamp, foreignKey, unique, uuid, boolean, index, real, integer, uniqueIndex, vector, jsonb, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const interactionType = pgEnum("interaction_type", ['seen', 'open_detail', 'dismiss', 'favorite', 'save_to_playlist', 'read', 'not_interested', 'already_read'])
export const paperAccess = pgEnum("paper_access", ['open', 'publisher', 'unknown'])
export const paperSource = pgEnum("paper_source", ['arxiv', 'semantic_scholar', 'openalex', 'dblp', 'crossref', 'manual'])
export const groupInvitePolicy = pgEnum("group_invite_policy", ['nobody', 'friends_only', 'anyone'])
export const friendRequestStatus = pgEnum("friend_request_status", ['pending', 'accepted', 'declined', 'cancelled'])


export const profiles = pgTable("profiles", {
	ownerId: text("owner_id").primaryKey().notNull(),
	displayName: text("display_name"),
	imageUrl: text("image_url"),
	onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	pgPolicy("profiles_insert_own", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
	pgPolicy("profiles_select_own", { as: "permissive", for: "select", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
	pgPolicy("profiles_update_own", { as: "permissive", for: "update", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
]);

export const collaborationIdentities = pgTable("collaboration_identities", {
	ownerId: text("owner_id").primaryKey().notNull(),
	publicId: uuid("public_id").defaultRandom().notNull(),
	emailLookupHash: text("email_lookup_hash").notNull(),
	emailHashVersion: integer("email_hash_version").default(1).notNull(),
	discoverableByEmail: boolean("discoverable_by_email").default(false).notNull(),
	groupInvitePolicy: groupInvitePolicy("group_invite_policy").default('friends_only').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.ownerId],
		foreignColumns: [profiles.ownerId],
		name: "collaboration_identities_owner_id_fkey"
	}).onDelete("cascade"),
	unique("collaboration_identities_public_id_key").on(table.publicId),
	unique("collaboration_identities_email_lookup_hash_key").on(table.emailLookupHash),
	pgPolicy("collaboration_identities_insert_own", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
	pgPolicy("collaboration_identities_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
	pgPolicy("collaboration_identities_update_own", { as: "permissive", for: "update", to: ["authenticated"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
	pgPolicy("collaboration_identities_delete_own", { as: "permissive", for: "delete", to: ["authenticated"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))` }),
]);

export const collaborationSearchLimits = pgTable("collaboration_search_limits", {
	requesterId: text("requester_id").primaryKey().notNull(),
	windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	attemptCount: integer("attempt_count").default(0).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.requesterId],
		foreignColumns: [profiles.ownerId],
		name: "collaboration_search_limits_requester_id_fkey"
	}).onDelete("cascade"),
]);

export const friendRequests = pgTable("friend_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	requesterId: text("requester_id").notNull(),
	recipientId: text("recipient_id").notNull(),
	status: friendRequestStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.requesterId], foreignColumns: [profiles.ownerId], name: "friend_requests_requester_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.recipientId], foreignColumns: [profiles.ownerId], name: "friend_requests_recipient_id_fkey" }).onDelete("cascade"),
	uniqueIndex("friend_requests_one_pending_pair_idx").on(sql`least(${table.requesterId}, ${table.recipientId})`, sql`greatest(${table.requesterId}, ${table.recipientId})`).where(sql`${table.status} = 'pending'`),
	index("friend_requests_requester_created_idx").on(table.requesterId, table.createdAt.desc()),
	index("friend_requests_recipient_status_idx").on(table.recipientId, table.status, table.createdAt.desc()),
	pgPolicy("friend_requests_participant_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((auth.jwt() ->> 'sub'::text) IN (requester_id, recipient_id))` }),
]);

export const friendships = pgTable("friendships", {
	userLowId: text("user_low_id").notNull(),
	userHighId: text("user_high_id").notNull(),
	acceptedRequestId: uuid("accepted_request_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.userLowId], foreignColumns: [profiles.ownerId], name: "friendships_user_low_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.userHighId], foreignColumns: [profiles.ownerId], name: "friendships_user_high_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.acceptedRequestId], foreignColumns: [friendRequests.id], name: "friendships_accepted_request_id_fkey" }).onDelete("set null"),
	primaryKey({ columns: [table.userLowId, table.userHighId], name: "friendships_pkey" }),
	index("friendships_high_user_idx").on(table.userHighId, table.createdAt.desc()),
	pgPolicy("friendships_participant_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((auth.jwt() ->> 'sub'::text) IN (user_low_id, user_high_id))` }),
]);

export const userBlocks = pgTable("user_blocks", {
	blockerId: text("blocker_id").notNull(),
	blockedId: text("blocked_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.blockerId], foreignColumns: [profiles.ownerId], name: "user_blocks_blocker_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.blockedId], foreignColumns: [profiles.ownerId], name: "user_blocks_blocked_id_fkey" }).onDelete("cascade"),
	primaryKey({ columns: [table.blockerId, table.blockedId], name: "user_blocks_pkey" }),
	index("user_blocks_blocked_idx").on(table.blockedId),
	pgPolicy("user_blocks_blocker_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(blocker_id = (auth.jwt() ->> 'sub'::text))` }),
]);

export const playlists = pgTable("playlists", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	name: text().notNull(),
	description: text(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "playlists_owner_id_fkey"
		}).onDelete("cascade"),
	unique("playlists_owner_id_name_key").on(table.ownerId, table.name),
	pgPolicy("playlists_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const recommendationImpressions = pgTable("recommendation_impressions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	batchId: uuid("batch_id").notNull(),
	rank: integer().notNull(),
	score: real().notNull(),
	scoreComponents: jsonb("score_components").default(sql`'{}'::jsonb`).notNull(),
	modelVersion: text("model_version").notNull(),
	shownAt: timestamp("shown_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recommendation_impressions_owner_batch_rank_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.batchId.asc().nullsLast().op("uuid_ops"), table.rank.asc().nullsLast().op("int4_ops")),
	index("recommendation_impressions_owner_shown_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.shownAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "recommendation_impressions_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "recommendation_impressions_paper_id_fkey"
		}).onDelete("cascade"),
	unique("recommendation_impressions_owner_id_paper_id_batch_id_key").on(table.ownerId, table.paperId, table.batchId),
	pgPolicy("recommendation_impressions_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const userPaperInteractions = pgTable("user_paper_interactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	recommendationImpressionId: uuid("recommendation_impression_id"),
	action: interactionType().notNull(),
	context: text().default('feed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_paper_interactions_owner_created_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("user_paper_interactions_owner_paper_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.paperId.asc().nullsLast().op("uuid_ops")),
	index("user_paper_interactions_recommendation_impression_idx").using("btree", table.recommendationImpressionId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("user_paper_interactions_owner_paper_action_key").on(table.ownerId, table.paperId, table.action),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "user_paper_interactions_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "user_paper_interactions_paper_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recommendationImpressionId],
			foreignColumns: [recommendationImpressions.id],
			name: "user_paper_interactions_recommendation_impression_id_fkey"
		}).onDelete("set null"),
	pgPolicy("user_paper_interactions_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const recommendations = pgTable("recommendations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	score: real().notNull(),
	reason: text(),
	modelVersion: text("model_version"),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	seenAt: timestamp("seen_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("recommendations_owner_model_generated_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.modelVersion.asc().nullsLast().op("text_ops"), table.generatedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("recommendations_owner_score_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.score.desc().nullsFirst().op("float4_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "recommendations_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "recommendations_paper_id_fkey"
		}).onDelete("cascade"),
	unique("recommendations_owner_id_paper_id_generated_at_key").on(table.ownerId, table.paperId, table.generatedAt),
	pgPolicy("recommendations_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const digests = pgTable("digests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	title: text().notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("digests_owner_generated_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.generatedAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "digests_owner_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("digests_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const taxonomyTopics = pgTable("taxonomy_topics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	label: text().notNull(),
	parentId: uuid("parent_id"),
	source: text(),
	arxivCategory: text("arxiv_category"),
	depth: integer().default(0).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("taxonomy_topics_parent_idx").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "taxonomy_topics_parent_id_fkey"
		}).onDelete("set null"),
	unique("taxonomy_topics_slug_key").on(table.slug),
	pgPolicy("taxonomy_topics_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const paperAuthors = pgTable("paper_authors", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paperId: uuid("paper_id").notNull(),
	name: text().notNull(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("paper_authors_paper_idx").using("btree", table.paperId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "paper_authors_paper_id_fkey"
		}).onDelete("cascade"),
	unique("paper_authors_paper_id_position_key").on(table.paperId, table.position),
	pgPolicy("paper_authors_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const papers = pgTable("papers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	abstract: text(),
	year: integer(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	source: paperSource().notNull(),
	doi: text(),
	arxivId: text("arxiv_id"),
	semanticScholarId: text("semantic_scholar_id"),
	openalexId: text("openalex_id"),
	url: text().notNull(),
	pdfUrl: text("pdf_url"),
	venue: text(),
	citationCount: integer("citation_count"),
	isOpenAccess: boolean("is_open_access"),
	access: paperAccess().default('unknown').notNull(),
	isClassic: boolean("is_classic").default(false).notNull(),
	embedding: vector({ dimensions: 384 }),
	embeddingModel: text("embedding_model"),
	embeddingDimension: integer("embedding_dimension"),
	embeddedAt: timestamp("embedded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	embeddingContentHash: text("embedding_content_hash"),
	triageSummary: jsonb("triage_summary"),
	triageSummaryModel: text("triage_summary_model"),
	triageSummaryGeneratedAt: timestamp("triage_summary_generated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("papers_arxiv_unique_idx").using("btree", table.arxivId.asc().nullsLast().op("text_ops")).where(sql`(arxiv_id IS NOT NULL)`),
	uniqueIndex("papers_doi_unique_idx").using("btree", table.doi.asc().nullsLast().op("text_ops")).where(sql`(doi IS NOT NULL)`),
	index("papers_embedding_content_hash_idx").using("btree", table.embeddingContentHash.asc().nullsLast().op("text_ops")).where(sql`(embedding_content_hash IS NOT NULL)`),
	index("papers_embedding_cosine_idx").using("ivfflat", table.embedding.asc().nullsLast().op("vector_cosine_ops")).with({lists: "100"}),
	uniqueIndex("papers_openalex_unique_idx").using("btree", table.openalexId.asc().nullsLast().op("text_ops")).where(sql`(openalex_id IS NOT NULL)`),
	index("papers_published_at_idx").using("btree", table.publishedAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("papers_semantic_scholar_unique_idx").using("btree", table.semanticScholarId.asc().nullsLast().op("text_ops")).where(sql`(semantic_scholar_id IS NOT NULL)`),
	index("papers_source_idx").using("btree", table.source.asc().nullsLast().op("enum_ops")),
	index("papers_year_idx").using("btree", table.year.desc().nullsFirst().op("int4_ops")),
	pgPolicy("papers_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const ingestionRuns = pgTable("ingestion_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	source: paperSource().notNull(),
	status: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	cursorValue: text("cursor_value"),
	importedCount: integer("imported_count").default(0).notNull(),
	errorMessage: text("error_message"),
});

export const favorites = pgTable("favorites", {
	ownerId: text("owner_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "favorites_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "favorites_paper_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.ownerId, table.paperId], name: "favorites_pkey"}),
	pgPolicy("favorites_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const paperNotes = pgTable("paper_notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: text("owner_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	playlistId: uuid("playlist_id"),
	body: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("paper_notes_owner_paper_created_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.paperId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("paper_notes_playlist_idx").using("btree", table.playlistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "paper_notes_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "paper_notes_paper_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playlistId],
			foreignColumns: [playlists.id],
			name: "paper_notes_playlist_id_fkey"
		}).onDelete("set null"),
	pgPolicy("paper_notes_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const userInterests = pgTable("user_interests", {
	ownerId: text("owner_id").notNull(),
	topicId: uuid("topic_id").notNull(),
	weight: real().default(1).notNull(),
	selectedAt: timestamp("selected_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "user_interests_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [taxonomyTopics.id],
			name: "user_interests_topic_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.ownerId, table.topicId], name: "user_interests_pkey"}),
	pgPolicy("user_interests_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const playlistItems = pgTable("playlist_items", {
	playlistId: uuid("playlist_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	position: integer().default(0).notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("playlist_items_paper_idx").using("btree", table.paperId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "playlist_items_paper_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playlistId],
			foreignColumns: [playlists.id],
			name: "playlist_items_playlist_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.playlistId, table.paperId], name: "playlist_items_pkey"}),
	pgPolicy("playlist_items_own", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM playlists
  WHERE ((playlists.id = playlist_items.playlist_id) AND (playlists.owner_id = (auth.jwt() ->> 'sub'::text)))))`, withCheck: sql`(EXISTS ( SELECT 1
   FROM playlists
  WHERE ((playlists.id = playlist_items.playlist_id) AND (playlists.owner_id = (auth.jwt() ->> 'sub'::text)))))`  }),
]);

export const digestItems = pgTable("digest_items", {
	digestId: uuid("digest_id").notNull(),
	paperId: uuid("paper_id").notNull(),
	position: integer().default(0).notNull(),
	reason: text(),
}, (table) => [
	foreignKey({
			columns: [table.digestId],
			foreignColumns: [digests.id],
			name: "digest_items_digest_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "digest_items_paper_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.digestId, table.paperId], name: "digest_items_pkey"}),
	pgPolicy("digest_items_own", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM digests
  WHERE ((digests.id = digest_items.digest_id) AND (digests.owner_id = (auth.jwt() ->> 'sub'::text)))))`, withCheck: sql`(EXISTS ( SELECT 1
   FROM digests
  WHERE ((digests.id = digest_items.digest_id) AND (digests.owner_id = (auth.jwt() ->> 'sub'::text)))))`  }),
]);

export const topicRelations = pgTable("topic_relations", {
	sourceTopicId: uuid("source_topic_id").notNull(),
	targetTopicId: uuid("target_topic_id").notNull(),
	relationType: text("relation_type").notNull(),
	weight: real().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sourceTopicId],
			foreignColumns: [taxonomyTopics.id],
			name: "topic_relations_source_topic_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetTopicId],
			foreignColumns: [taxonomyTopics.id],
			name: "topic_relations_target_topic_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.sourceTopicId, table.targetTopicId, table.relationType], name: "topic_relations_pkey"}),
	pgPolicy("topic_relations_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const paperTopics = pgTable("paper_topics", {
	paperId: uuid("paper_id").notNull(),
	topicId: uuid("topic_id").notNull(),
	confidence: real(),
	source: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("paper_topics_topic_idx").using("btree", table.topicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "paper_topics_paper_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [taxonomyTopics.id],
			name: "paper_topics_topic_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.paperId, table.topicId], name: "paper_topics_pkey"}),
	pgPolicy("paper_topics_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const paperExternalIds = pgTable("paper_external_ids", {
	paperId: uuid("paper_id").notNull(),
	provider: text().notNull(),
	externalId: text("external_id").notNull(),
	url: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.paperId],
			foreignColumns: [papers.id],
			name: "paper_external_ids_paper_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.paperId, table.provider, table.externalId], name: "paper_external_ids_pkey"}),
	pgPolicy("paper_external_ids_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const topicEmbeddings = pgTable("topic_embeddings", {
	topicId: uuid("topic_id").notNull(),
	embedding: vector({ dimensions: 384 }).notNull(),
	embeddingModel: text("embedding_model").notNull(),
	embeddingDimension: integer("embedding_dimension").notNull(),
	embeddingContentHash: text("embedding_content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("topic_embeddings_model_idx").using("btree", table.embeddingModel.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [taxonomyTopics.id],
			name: "topic_embeddings_topic_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.topicId, table.embeddingModel], name: "topic_embeddings_pkey"}),
	pgPolicy("topic_embeddings_read_authenticated", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.jwt() ->> 'sub'::text) IS NOT NULL)` }),
]);

export const userProfileEmbeddings = pgTable("user_profile_embeddings", {
	ownerId: text("owner_id").notNull(),
	embedding: vector({ dimensions: 384 }).notNull(),
	embeddingModel: text("embedding_model").notNull(),
	embeddingDimension: integer("embedding_dimension").notNull(),
	inputSignature: text("input_signature").notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_profile_embeddings_generated_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.generatedAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [profiles.ownerId],
			name: "user_profile_embeddings_owner_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.ownerId, table.embeddingModel], name: "user_profile_embeddings_pkey"}),
	pgPolicy("user_profile_embeddings_own", { as: "permissive", for: "all", to: ["public"], using: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`, withCheck: sql`(owner_id = (auth.jwt() ->> 'sub'::text))`  }),
]);

export const ingestionCursors = pgTable("ingestion_cursors", {
	source: paperSource().notNull(),
	cursorKey: text("cursor_key").notNull(),
	cursorValue: text("cursor_value"),
	lastSeenPublishedAt: timestamp("last_seen_published_at", { withTimezone: true, mode: 'string' }),
	lastSeenExternalId: text("last_seen_external_id"),
	lastSuccessfulRunId: uuid("last_successful_run_id"),
	importedCount: integer("imported_count").default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ingestion_cursors_updated_idx").using("btree", table.updatedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.lastSuccessfulRunId],
			foreignColumns: [ingestionRuns.id],
			name: "ingestion_cursors_last_successful_run_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.source, table.cursorKey], name: "ingestion_cursors_pkey"}),
]);
