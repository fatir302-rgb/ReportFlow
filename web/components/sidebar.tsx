import Link from "next/link";
import type { AppUser } from "@/lib/types";
import { signOut } from "@/auth";
import { DesktopNavLink, MobileNavLink, MobileNavMenu } from "@/components/mobile-nav-link";

const links = [
  ["⌂", "Home", "/app"],
  ["□", "Projects", "/app/projects"],
  ["↔", "Connections", "/app/connections"],
  ["≡", "Reports", "/app/reports"],
  ["◷", "Activity", "/app/activity"],
  ["✦", "Assistant", "/app/assistant"],
  ["⚙", "Settings", "/app/settings"],
];

export function Sidebar({ user }: { user: AppUser }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link className="brand" href="/app"><span className="brand-mark" aria-hidden="true">R</span><span className="brand-copy"><strong>ReportFlow</strong><small>Reporting workspace</small></span></Link>
      </div>
      <nav className="nav" aria-label="Workspace navigation">
        {links.map(([icon, label, href]) => <DesktopNavLink icon={icon} label={label} href={href} key={href} />)}
      </nav>
      <div className="sidebar-user">
        <span className="sidebar-user-avatar" aria-hidden="true">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
        <div className="sidebar-user-copy"><strong>{user.name || user.email}</strong><small>{user.email}</small></div>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}><button className="sidebar-signout" type="submit">Sign out</button></form>
      </div>
    </aside>
  );
}

export function MobileNav() {
  return (
    <div className="mobile-nav-wrap">
      <Link className="mobile-logo brand" href="/app"><span className="brand-mark" aria-hidden="true">R</span><span>ReportFlow</span></Link>
      <MobileNavMenu>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {links.map(([icon, label, href]) => <MobileNavLink href={href} icon={icon} key={href} label={label} />)}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="nav-link mobile-signout" type="submit"><span className="nav-dot" aria-hidden="true">↪</span>Sign out</button>
          </form>
        </nav>
      </MobileNavMenu>
    </div>
  );
}
