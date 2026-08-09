export default function ResearchGroupLoading() {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <main
        aria-busy="true"
        aria-label="Loading research group"
        className="mx-auto grid w-full max-w-7xl animate-pulse gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_20rem] sm:px-6 lg:px-8"
      >
        <div className="space-y-3">
          <div className="h-9 w-56 rounded bg-slate-200" />
          {[0, 1].map((item) => (
            <div key={item} className="h-52 rounded-lg bg-slate-100" />
          ))}
        </div>
        <div className="h-80 rounded-lg bg-slate-100" />
      </main>
    </div>
  );
}
