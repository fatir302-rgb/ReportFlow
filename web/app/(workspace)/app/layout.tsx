import { requireAppUser } from "@/lib/require-app-user";
import { MobileNav, Sidebar } from "@/components/sidebar";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser();
  const initial = (user.name || user.email).slice(0, 1).toUpperCase();
  return (
    <div className="shell">
      <Sidebar user={user} />
      <div className="main">
        <header className="topbar"><MobileNav /><div className="topbar-account"><span className="workspace-status"><i />Workspace online</span><div className="avatar" title={user.email} aria-label={`Signed in as ${user.email}`}>{initial}</div></div></header>
        {children}
      </div>
    </div>
  );
}
