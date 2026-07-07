"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers3, Library, Search, SlidersHorizontal } from "lucide-react";

const navItems = [
  { href: "/feed", label: "Feed", icon: Layers3 },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_32px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/feed" && pathname.startsWith("/papers/"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-bold ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
