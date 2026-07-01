import Link from "next/link";
import type { ReactNode } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { BookOpenCheck } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";

type AppShellProps = {
  children: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  readLaterCount?: number;
};

const desktopNav = [
  { href: "/feed", label: "Feed" },
  { href: "/onboarding", label: "Topics" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({
  children,
  title,
  subtitle,
  action,
  readLaterCount,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/92 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/feed" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-sm font-black text-white shadow-sm">
              PD
            </div>
            <div>
              <p className="text-base font-black tracking-normal">PaperDeck</p>
              <p className="text-xs font-semibold text-slate-500">
                CS paper discovery
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {desktopNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-black text-white shadow-sm">
                  Sign in
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "h-10 w-10",
                  },
                }}
              />
            </Show>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-5 sm:px-6 md:pb-10 lg:px-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-normal text-slate-950">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {subtitle}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>

        {children}
      </main>

      {typeof readLaterCount === "number" ? (
        <aside className="fixed bottom-20 right-4 hidden rounded-lg border border-slate-200 bg-white p-3 shadow-lg lg:block">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <BookOpenCheck aria-hidden="true" size={18} strokeWidth={2.4} />
            Read later: {readLaterCount}
          </div>
        </aside>
      ) : null}

      <BottomNav />
    </div>
  );
}
