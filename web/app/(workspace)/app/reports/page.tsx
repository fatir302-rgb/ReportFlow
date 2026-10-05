import Link from "next/link";
import { requireAppUser } from "@/lib/require-app-user";
import { listProjects, listAllReports } from "@/lib/db";

export default async function ReportsPage() {
  const user = await requireAppUser();
  const projects = listProjects(user.id);
  const rows = listAllReports(user.id);
  const byProject = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.report_type) continue;
    const current = byProject.get(row.project_id) || [];
    current.push(row);
    byProject.set(row.project_id, current);
  }
  return (
    <main className="content">
      <div className="page-head"><div><h1>Reports</h1><p className="muted">Weekly and monthly report formats across all of your projects.</p></div></div>
      {!projects.length ? <div className="empty">Create a project first.<div style={{ marginTop: 14 }}><Link className="button" href="/app/projects/new">+ New project</Link></div></div> : (
        <div className="list">
          {projects.map((project) => {
            const configs = byProject.get(project.id) || [];
            const weekly = configs.find((item) => item.report_type === "weekly");
            const monthly = configs.find((item) => item.report_type === "monthly");
            return <div className="reports-project" key={project.id}>
              <div className="reports-project-head"><div><div className="project-title">{project.name}</div><div className="meta">{project.sourceProjectCount} Clockify project{project.sourceProjectCount === 1 ? "" : "s"}</div></div><Link className="button" href={`/app/projects/${project.id}`}>Open project</Link></div>
              <div className="reports-mini-grid">
                <Link className="mini-report" href={`/app/projects/${project.id}/reports/weekly`}><span>Weekly</span><small>{weekly ? `${weekly.output_format.toUpperCase()} · ${weekly.template_original_name || "No template"}` : "Not configured"}</small>{weekly?.schedule_enabled ? <small>Scheduled · {weekly.schedule_timezone}</small> : weekly ? <small>Not scheduled</small> : null}</Link>
                <Link className="mini-report" href={`/app/projects/${project.id}/reports/monthly`}><span>Monthly</span><small>{monthly ? `${monthly.output_format.toUpperCase()} · ${monthly.template_original_name || "No template"}` : "Not configured"}</small>{monthly?.schedule_enabled ? <small>Scheduled · {monthly.schedule_timezone}</small> : monthly ? <small>Not scheduled</small> : null}</Link>
              </div>
            </div>;
          })}
        </div>
      )}
    </main>
  );
}
