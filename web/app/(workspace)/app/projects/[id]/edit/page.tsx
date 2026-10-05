import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getProject } from "@/lib/db";
import { EditProjectForm } from "@/components/edit-project-form";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const user = await requireAppUser(); const project = getProject(user.id, id); if (!project) notFound();
  return <main className="content" style={{ maxWidth: 720 }}><div className="page-head"><div><h1>Edit {project.name}</h1><p className="muted">Change the app project or its Clockify project mapping.</p></div></div><EditProjectForm initial={project} /></main>;
}
