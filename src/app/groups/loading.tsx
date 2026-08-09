export default function ResearchGroupsLoading() {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <main
        aria-busy="true"
        aria-label="Loading research groups"
        className="mx-auto w-full max-w-7xl animate-pulse px-4 py-5 sm:px-6 lg:px-8"
      >
        <div className="h-8 w-48 rounded bg-slate-200" />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-36 rounded-lg bg-slate-100" />
          ))}
        </div>
      </main>
    </div>
  );
}
