import { requireAppUser } from "@/lib/require-app-user";
import { getConnection } from "@/lib/db";
import { NewProjectWizard } from "@/components/new-project-wizard";

export default async function NewProjectPage() {
  const user = await requireAppUser();
  const clockify = getConnection(user.id, "clockify");
  return (
    <main className="content" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1>New project</h1><p className="muted">Create the client/project and map the Clockify projects that belong to it. Weekly and monthly formats can be configured after creation.</p></div></div>
      <NewProjectWizard clockifyConnected={Boolean(clockify)} />
    </main>
  );
}
