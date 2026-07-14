import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes } from "react";

type AppNavLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

export function AppNavLink({ prefetch = false, ...props }: AppNavLinkProps) {
  return <Link prefetch={prefetch} {...props} />;
}
