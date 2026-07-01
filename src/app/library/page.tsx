import { AppShell } from "@/components/app-shell";
import { PaperListItem } from "@/components/paper-list-item";
import { mockPapers, mockPlaylists } from "@/lib/mock-data";

export default function LibraryPage() {
  const readLater = mockPlaylists.find((playlist) => playlist.id === "read-later");
  const savedPapers = mockPapers.filter((paper) =>
    readLater?.paperIds.includes(paper.id),
  );
  const favoritePaper = mockPapers[0];

  return (
    <AppShell
      title="Library"
      subtitle="Favorites and private reading lists stay separate from lightweight open signals."
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          {mockPlaylists.map((playlist) => (
            <button
              key={playlist.id}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
            >
              <span className="font-black text-slate-900">{playlist.name}</span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                {playlist.paperIds.length}
              </span>
            </button>
          ))}
        </aside>

        <section className="space-y-5">
          <div>
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Favorites
            </h2>
            <div className="mt-3">
              <PaperListItem paper={favoritePaper} />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Read later
            </h2>
            <div className="mt-3 space-y-3">
              {savedPapers.map((paper) => (
                <PaperListItem key={paper.id} paper={paper} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
