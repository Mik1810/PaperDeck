export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f8f3] text-[#18201c]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-[#d9ded3] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#0f766e] text-sm font-black text-white shadow-sm">
              PD
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-normal">PaperDeck</h1>
              <p className="text-xs font-medium text-[#657165]">
                CS paper discovery
              </p>
            </div>
          </div>
          <button className="h-10 rounded-lg border border-[#c8d0c2] px-4 text-sm font-semibold text-[#1f2a23]">
            Sign in
          </button>
        </header>

        <div className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-h-[640px] items-center justify-center">
            <article className="flex h-[min(760px,calc(100vh-128px))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#d7ddd2] bg-white shadow-[0_18px_48px_rgba(25,33,28,0.16)]">
              <div className="flex items-center justify-between border-b border-[#e6e9e2] px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-normal text-[#0f766e]">
                    Recommended for complexity theory
                  </p>
                  <p className="mt-1 text-xs text-[#667063]">
                    Classic paper cap: 15%
                  </p>
                </div>
                <span className="rounded-md bg-[#fff1e8] px-2.5 py-1 text-xs font-bold text-[#b45309]">
                  arXiv
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="mb-4 flex flex-wrap gap-2">
                  <span className="rounded-md bg-[#ecfdf5] px-2.5 py-1 text-xs font-semibold text-[#047857]">
                    algorithms
                  </span>
                  <span className="rounded-md bg-[#eef2ff] px-2.5 py-1 text-xs font-semibold text-[#4338ca]">
                    complexity
                  </span>
                  <span className="rounded-md bg-[#fef3c7] px-2.5 py-1 text-xs font-semibold text-[#92400e]">
                    theory
                  </span>
                </div>

                <h2 className="text-2xl font-bold leading-8 tracking-normal text-[#111827]">
                  A sample paper card for ranking-driven discovery
                </h2>
                <p className="mt-3 text-sm font-medium text-[#5f6b61]">
                  A. Researcher, B. Theorist - 2026
                </p>

                <div className="mt-6 space-y-4 text-[15px] leading-7 text-[#344037]">
                  <p>
                    This placeholder card represents the first PaperDeck feed
                    surface: a single mobile-first paper card with title,
                    authors, topics, source, and an abstract preview.
                  </p>
                  <p>
                    In the MVP, abstracts will be truncated to around ten lines
                    on mobile and expandable inside the same scrollable card.
                    Swipe right opens the detail view, while heart and bookmark
                    remain explicit save actions.
                  </p>
                  <button className="text-sm font-bold text-[#0f766e]">
                    more
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 border-t border-[#e6e9e2] bg-[#fbfcf8] p-3">
                <button className="h-12 rounded-lg border border-[#e5b6b0] bg-white text-sm font-bold text-[#b42318]">
                  Skip
                </button>
                <button className="h-12 rounded-lg border border-[#c7d2fe] bg-white text-sm font-bold text-[#3730a3]">
                  Open
                </button>
                <button className="h-12 rounded-lg border border-[#f5c2cc] bg-white text-sm font-bold text-[#be123c]">
                  Heart
                </button>
                <button className="h-12 rounded-lg border border-[#badbcc] bg-white text-sm font-bold text-[#047857]">
                  Save
                </button>
              </div>
            </article>
          </section>

          <aside className="hidden border-l border-[#d9ded3] pl-6 lg:block">
            <div className="sticky top-6 space-y-8">
              <section>
                <h2 className="text-sm font-bold uppercase tracking-normal text-[#657165]">
                  MVP stack
                </h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#344037]">
                  <li>Next.js, TypeScript, Tailwind</li>
                  <li>Clerk Google auth</li>
                  <li>Supabase Postgres + pgvector</li>
                  <li>GitHub Actions ingestion worker</li>
                </ul>
              </section>
              <section>
                <h2 className="text-sm font-bold uppercase tracking-normal text-[#657165]">
                  Ranking signals
                </h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#344037]">
                  <li>Selected CS interests</li>
                  <li>BGE-small embeddings</li>
                  <li>Dismiss, open, favorite, save</li>
                  <li>Classic papers capped at 10-15%</li>
                </ul>
              </section>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
