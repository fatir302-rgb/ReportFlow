"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNavLink({ icon, label, href }: { icon: string; label: string; href: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link className={`nav-link${active ? " active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      <span className="nav-dot" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

export function MobileNavMenu({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return <MobileNavMenuDetails key={pathname}>{children}</MobileNavMenuDetails>;
}

function MobileNavMenuDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="mobile-menu"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label="Open navigation menu">Menu</summary>
      {children}
    </details>
  );
}

export function MobileNavLink({
  icon,
  label,
  href,
}: {
  icon: string;
  label: string;
  href: string;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      className={`nav-link${active ? " active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-dot" aria-hidden="true">{icon}</span>
      {label}
    </Link>
  );
}
