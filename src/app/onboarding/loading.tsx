export default function OnboardingLoading() {
  return (
    <div className="min-h-screen bg-[#151515] text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-5 sm:px-8">
        <header className="flex h-12 items-center justify-between">
          <p className="text-sm font-black tracking-normal text-zinc-100">
            PaperDeck
          </p>
        </header>

        <div className="flex flex-1 items-center py-8">
          <div className="grid w-full animate-pulse gap-7 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
            <section>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-teal-300" />
                <div className="h-1.5 flex-1 rounded-full bg-zinc-800" />
                <div className="h-1.5 flex-1 rounded-full bg-zinc-800" />
              </div>

              <div className="mt-7">
                <div className="h-3 w-20 rounded bg-zinc-800" />
                <div className="mt-3 h-9 w-48 rounded bg-zinc-800" />
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-14 rounded-lg border border-zinc-800 bg-zinc-900"
                  />
                ))}
              </div>
            </section>

            <div className="border-t border-zinc-800 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <div className="h-11 rounded-lg bg-zinc-800" />
              <div className="mt-2 h-10 rounded-lg bg-zinc-900" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
