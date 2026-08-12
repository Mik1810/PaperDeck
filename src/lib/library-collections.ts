import type { Paper } from "@/types/paper";

export type LibraryCollectionKey =
  | "read-later"
  | "favorites"
  | "ignored"
  | `playlist:${string}`;

export type LibraryPlaylistSummary = {
  count: number;
  id: string;
  isDefault: boolean;
  name: string;
};

export type LibraryCollectionItem = {
  ignoredAction?: "dismiss" | "not_interested";
  ignoredAt?: string;
  paper: Paper;
};

export type LibraryCollectionPage = {
  collectionKey: LibraryCollectionKey;
  items: LibraryCollectionItem[];
  nextCursor: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLibraryCollectionKey(
  value: string,
): value is LibraryCollectionKey {
  return (
    value === "read-later" ||
    value === "favorites" ||
    value === "ignored" ||
    (value.startsWith("playlist:") &&
      uuidPattern.test(value.slice("playlist:".length)))
  );
}
