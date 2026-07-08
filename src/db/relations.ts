import { relations } from "drizzle-orm/relations";
import { profiles, playlists, recommendationImpressions, userPaperInteractions, papers, recommendations, digests, taxonomyTopics, paperAuthors, favorites, userInterests, playlistItems, digestItems, topicRelations, paperTopics, paperExternalIds, topicEmbeddings, userProfileEmbeddings, ingestionRuns, ingestionCursors, paperNotes } from "./schema";

export const playlistsRelations = relations(playlists, ({one, many}) => ({
	profile: one(profiles, {
		fields: [playlists.ownerId],
		references: [profiles.ownerId]
	}),
	playlistItems: many(playlistItems),
	paperNotes: many(paperNotes),
}));

export const paperNotesRelations = relations(paperNotes, ({one}) => ({
	profile: one(profiles, {
		fields: [paperNotes.ownerId],
		references: [profiles.ownerId]
	}),
	paper: one(papers, {
		fields: [paperNotes.paperId],
		references: [papers.id]
	}),
	playlist: one(playlists, {
		fields: [paperNotes.playlistId],
		references: [playlists.id]
	}),
}));

export const profilesRelations = relations(profiles, ({many}) => ({
	playlists: many(playlists),
	recommendationImpressions: many(recommendationImpressions),
	userPaperInteractions: many(userPaperInteractions),
	recommendations: many(recommendations),
	digests: many(digests),
	favorites: many(favorites),
	userInterests: many(userInterests),
	userProfileEmbeddings: many(userProfileEmbeddings),
	paperNotes: many(paperNotes),
}));

export const recommendationImpressionsRelations = relations(recommendationImpressions, ({one, many}) => ({
	profile: one(profiles, {
		fields: [recommendationImpressions.ownerId],
		references: [profiles.ownerId]
	}),
	paper: one(papers, {
		fields: [recommendationImpressions.paperId],
		references: [papers.id]
	}),
	userPaperInteractions: many(userPaperInteractions),
}));

export const userPaperInteractionsRelations = relations(userPaperInteractions, ({one}) => ({
	profile: one(profiles, {
		fields: [userPaperInteractions.ownerId],
		references: [profiles.ownerId]
	}),
	paper: one(papers, {
		fields: [userPaperInteractions.paperId],
		references: [papers.id]
	}),
	recommendationImpression: one(recommendationImpressions, {
		fields: [userPaperInteractions.recommendationImpressionId],
		references: [recommendationImpressions.id]
	}),
}));

export const papersRelations = relations(papers, ({many}) => ({
	recommendationImpressions: many(recommendationImpressions),
	userPaperInteractions: many(userPaperInteractions),
	recommendations: many(recommendations),
	paperAuthors: many(paperAuthors),
	favorites: many(favorites),
	playlistItems: many(playlistItems),
	digestItems: many(digestItems),
	paperTopics: many(paperTopics),
	paperExternalIds: many(paperExternalIds),
	paperNotes: many(paperNotes),
}));

export const recommendationsRelations = relations(recommendations, ({one}) => ({
	profile: one(profiles, {
		fields: [recommendations.ownerId],
		references: [profiles.ownerId]
	}),
	paper: one(papers, {
		fields: [recommendations.paperId],
		references: [papers.id]
	}),
}));

export const digestsRelations = relations(digests, ({one, many}) => ({
	profile: one(profiles, {
		fields: [digests.ownerId],
		references: [profiles.ownerId]
	}),
	digestItems: many(digestItems),
}));

export const taxonomyTopicsRelations = relations(taxonomyTopics, ({one, many}) => ({
	taxonomyTopic: one(taxonomyTopics, {
		fields: [taxonomyTopics.parentId],
		references: [taxonomyTopics.id],
		relationName: "taxonomyTopics_parentId_taxonomyTopics_id"
	}),
	taxonomyTopics: many(taxonomyTopics, {
		relationName: "taxonomyTopics_parentId_taxonomyTopics_id"
	}),
	userInterests: many(userInterests),
	topicRelations_sourceTopicId: many(topicRelations, {
		relationName: "topicRelations_sourceTopicId_taxonomyTopics_id"
	}),
	topicRelations_targetTopicId: many(topicRelations, {
		relationName: "topicRelations_targetTopicId_taxonomyTopics_id"
	}),
	paperTopics: many(paperTopics),
	topicEmbeddings: many(topicEmbeddings),
}));

export const paperAuthorsRelations = relations(paperAuthors, ({one}) => ({
	paper: one(papers, {
		fields: [paperAuthors.paperId],
		references: [papers.id]
	}),
}));

export const favoritesRelations = relations(favorites, ({one}) => ({
	profile: one(profiles, {
		fields: [favorites.ownerId],
		references: [profiles.ownerId]
	}),
	paper: one(papers, {
		fields: [favorites.paperId],
		references: [papers.id]
	}),
}));

export const userInterestsRelations = relations(userInterests, ({one}) => ({
	profile: one(profiles, {
		fields: [userInterests.ownerId],
		references: [profiles.ownerId]
	}),
	taxonomyTopic: one(taxonomyTopics, {
		fields: [userInterests.topicId],
		references: [taxonomyTopics.id]
	}),
}));

export const playlistItemsRelations = relations(playlistItems, ({one}) => ({
	paper: one(papers, {
		fields: [playlistItems.paperId],
		references: [papers.id]
	}),
	playlist: one(playlists, {
		fields: [playlistItems.playlistId],
		references: [playlists.id]
	}),
}));

export const digestItemsRelations = relations(digestItems, ({one}) => ({
	digest: one(digests, {
		fields: [digestItems.digestId],
		references: [digests.id]
	}),
	paper: one(papers, {
		fields: [digestItems.paperId],
		references: [papers.id]
	}),
}));

export const topicRelationsRelations = relations(topicRelations, ({one}) => ({
	taxonomyTopic_sourceTopicId: one(taxonomyTopics, {
		fields: [topicRelations.sourceTopicId],
		references: [taxonomyTopics.id],
		relationName: "topicRelations_sourceTopicId_taxonomyTopics_id"
	}),
	taxonomyTopic_targetTopicId: one(taxonomyTopics, {
		fields: [topicRelations.targetTopicId],
		references: [taxonomyTopics.id],
		relationName: "topicRelations_targetTopicId_taxonomyTopics_id"
	}),
}));

export const paperTopicsRelations = relations(paperTopics, ({one}) => ({
	paper: one(papers, {
		fields: [paperTopics.paperId],
		references: [papers.id]
	}),
	taxonomyTopic: one(taxonomyTopics, {
		fields: [paperTopics.topicId],
		references: [taxonomyTopics.id]
	}),
}));

export const paperExternalIdsRelations = relations(paperExternalIds, ({one}) => ({
	paper: one(papers, {
		fields: [paperExternalIds.paperId],
		references: [papers.id]
	}),
}));

export const topicEmbeddingsRelations = relations(topicEmbeddings, ({one}) => ({
	taxonomyTopic: one(taxonomyTopics, {
		fields: [topicEmbeddings.topicId],
		references: [taxonomyTopics.id]
	}),
}));

export const userProfileEmbeddingsRelations = relations(userProfileEmbeddings, ({one}) => ({
	profile: one(profiles, {
		fields: [userProfileEmbeddings.ownerId],
		references: [profiles.ownerId]
	}),
}));

export const ingestionCursorsRelations = relations(ingestionCursors, ({one}) => ({
	ingestionRun: one(ingestionRuns, {
		fields: [ingestionCursors.lastSuccessfulRunId],
		references: [ingestionRuns.id]
	}),
}));

export const ingestionRunsRelations = relations(ingestionRuns, ({many}) => ({
	ingestionCursors: many(ingestionCursors),
}));
