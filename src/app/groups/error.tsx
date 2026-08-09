"use client";

export default function ResearchGroupsError({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] px-4 py-8 text-slate-950 sm:px-6">
      <main className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-black">Research groups</h1>
        <div
          role="alert"
          className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-5"
        >
          <h2 className="text-base font-black text-rose-900">
            Research groups are unavailable
          </h2>
          <p className="mt-2 text-sm text-rose-800">
            No group or personal data was changed. Try loading the workspace again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-lg bg-rose-900 px-4 py-2 text-sm font-black text-white hover:bg-rose-800"
          >
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
