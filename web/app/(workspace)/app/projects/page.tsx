import Link from "next/link";
import { requireAppUser } from "@/lib/require-app-user";
import { listProjects } from "@/lib/db";
import { ProjectStatusControl } from "@/components/project-status-control";

export default async function ProjectsPage() {
  const user = await requireAppUser();
  const projects = listProjects(user.id);
  return <main className="content">
    <div className="page-head"><div><h1>Projects</h1><p className="muted">Each client can use its own source projects, report formats and rules.</p></div><Link className="button primary" href="/app/projects/new">+ New project</Link></div>
    {projects.length ? <div className="list">{projects.map((project) => <div className="project-row" key={project.id}><Link href={`/app/projects/${project.id}`}><div className="project-title">{project.name}</div><div className="meta">{project.sourceProjectCount} source project{project.sourceProjectCount === 1 ? "" : "s"} · {project.workspaceName || "No workspace"}</div></Link><ProjectStatusControl projectId={project.id} active={project.active} /></div>)}</div> : <div className="empty">Create a project, then map one or more Clockify projects to it.</div>}
  </main>;
}
