import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { requireAppUser } from "@/lib/require-app-user";

export default async function SettingsPage() {
  const user = await requireAppUser();
  return <main className="content">
    <div className="page-head"><div><h1>Settings</h1><p className="muted">Manage your ReportFlow profile.</p></div></div>
    <ProfileSettingsForm name={user.name || ""} email={user.email} />
  </main>;
}
