import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getProject, getReportConfiguration, getReportSchedule } from "@/lib/db";
import { ProjectActions } from "@/components/project-actions";

function ReportCard({ projectId, type, config, schedule }: { projectId: string; type: "weekly" | "monthly"; config: any; schedule: any }) {
  const label = type === "weekly" ? "Weekly report" : "Monthly report";
  return (
    <div className="report-row">
      <div>
        <div className="project-title">{label}</div>
        {config ? (
          <>
            <div className="meta">{config.enabled ? "Enabled" : "Disabled"} · {config.outputFormat.toUpperCase()} · {config.templateOriginalName || "Template not uploaded"}</div>
            <div className="schedule-meta">{schedule?.enabled ? `Scheduled · ${schedule.timezone}${schedule.nextRunAt ? ` · Next ${new Date(schedule.nextRunAt).toLocaleString("en", { timeZone: schedule.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}` : schedule ? "Schedule paused" : "Not scheduled"}</div>
          </>
        ) : <div className="meta">Not configured</div>}
      </div>
      <Link className="button" href={`/app/projects/${projectId}/reports/${type}`}>{config ? "Edit" : "Configure"} →</Link>
    </div>
  );
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAppUser();
  const project = getProject(user.id, id);
  if (!project) notFound();
  const weekly = getReportConfiguration(user.id, id, "weekly");
  const monthly = getReportConfiguration(user.id, id, "monthly");
  const weeklySchedule = getReportSchedule(user.id, id, "weekly");
  const monthlySchedule = getReportSchedule(user.id, id, "monthly");
  const configuredCount = Number(Boolean(weekly)) + Number(Boolean(monthly));

  return (
    <main className="content">
      <div className="page-head"><div><h1>{project.name}</h1><p className="muted">{project.description || "Project configuration"}</p></div><div className="page-actions"><Link className="button" href={`/app/projects/${project.id}/versions`}>Versions</Link><Link className="button" href={`/app/projects/${project.id}/audit`}>Audit</Link><Link className="button" href={`/app/assistant?project=${project.id}`}>✦ Ask ReportFlow</Link><ProjectActions projectId={project.id} /></div></div>
      <div className="detail-grid">
        <div className="card"><div className="detail-label">Data source</div><div className="connection-name">Clockify</div><div className="muted">{project.workspace_name}</div></div>
        <div className="card"><div className="detail-label">Reports</div><div className="connection-name">{configuredCount} of 2 configured</div><div className="muted">Weekly and monthly are configured independently.</div></div>
      </div>

      <section className="section-block">
        <div className="section-head"><div><h2>Reports</h2><p className="muted">Upload a different client template for each report type.</p></div></div>
        <div className="report-list">
          <ReportCard projectId={project.id} type="weekly" config={weekly} schedule={weeklySchedule} />
          <ReportCard projectId={project.id} type="monthly" config={monthly} schedule={monthlySchedule} />
        </div>
      </section>

      <div className="card" style={{ marginTop: 24 }}><div className="detail-label">Included Clockify projects</div><ul className="source-list">{project.sourceProjects.map((source: { id: string; name: string }) => <li key={source.id}>{source.name}</li>)}</ul></div>
    </main>
  );
}
