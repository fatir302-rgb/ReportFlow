import Link from "next/link";
import { requireAppUser } from "@/lib/require-app-user";
import {
  getActivitySummary,
  getConnection,
  listAllReports,
  listDeliveryConnections,
  listProjects,
  listReportActivity,
} from "@/lib/db";
import { RunStatus } from "@/components/run-status";
import { ProjectStatusControl } from "@/components/project-status-control";

export default async function DashboardPage() {
  const user = await requireAppUser();
  const projects = listProjects(user.id);
  const reports = listAllReports(user.id).filter((report) => report.report_type);
  const scheduledReports = reports.filter((report) => report.schedule_enabled);
  const clockifyConnected = Boolean(getConnection(user.id, "clockify"));
  const deliveryConnected = listDeliveryConnections(user.id).length > 0;
  const assistantConfigured = Boolean(getConnection(user.id, "openai") || process.env.OPENAI_API_KEY);
  const summary = getActivitySummary(user.id);
  const recent = listReportActivity({ userId: user.id, limit: 5 });
  const firstName = (user.name || "there").split(" ")[0];
  return <main className="content">
    <div className="page-head"><div><h1>Welcome, {firstName}</h1><p className="muted">Your reporting workspace.</p></div><Link className="button primary" href="/app/projects/new">+ New project</Link></div>
    <section className="getting-started" aria-labelledby="getting-started-title">
      <div className="section-head"><div><h2 id="getting-started-title">How ReportFlow works</h2><p className="muted">Complete these in order. Later areas activate as the required data becomes available.</p></div></div>
      <div className="setup-grid">
        <Link className="setup-card" href="/app/connections">
          <div className="setup-card-head"><strong>1. Connections</strong><span className={`setup-state ${clockifyConnected ? "ready" : "next"}`}>{clockifyConnected ? "Clockify ready" : "Start here"}</span></div>
          <span>Clockify supplies time entries. Gmail or Outlook sends completed reports.</span>
          <small>{deliveryConnected ? "A sending mailbox is connected." : "Email delivery can be connected later."}</small>
        </Link>
        <Link className="setup-card" href={projects.length ? "/app/projects" : "/app/projects/new"}>
          <div className="setup-card-head"><strong>2. Projects</strong><span className={`setup-state ${projects.length ? "ready" : "next"}`}>{projects.length ? `${projects.length} created` : "Not created"}</span></div>
          <span>Group one or more Clockify projects into the client or workstream you report on.</span>
        </Link>
        <Link className="setup-card" href="/app/reports">
          <div className="setup-card-head"><strong>3. Reports</strong><span className={`setup-state ${reports.length ? "ready" : "next"}`}>{reports.length ? `${reports.length} configured` : "Needs a project"}</span></div>
          <span>Upload separate weekly or monthly Excel templates and choose which source data to include.</span>
        </Link>
        <Link className="setup-card" href="/app/activity">
          <div className="setup-card-head"><strong>4. Activity</strong><span className={`setup-state ${scheduledReports.length ? "ready" : "next"}`}>{scheduledReports.length ? `${scheduledReports.length} scheduled` : "Needs a report"}</span></div>
          <span>Track queued, generated, test, sent, and failed report runs.</span>
          <small>Automatic runs require a deployed scheduler and report worker.</small>
        </Link>
        <Link className="setup-card optional" href="/app/assistant">
          <div className="setup-card-head"><strong>Assistant</strong><span className={`setup-state ${assistantConfigured ? "ready" : "optional"}`}>{assistantConfigured ? "Ready" : "Optional"}</span></div>
          <span>Ask configuration questions or draft safe changes. It requires an OpenAI API key.</span>
        </Link>
      </div>
    </section>
    <div className="dashboard-health"><Link href="/app/activity?status=sent"><span>Sent</span><strong>{summary.sent}</strong></Link><Link href="/app/activity?status=test"><span>Test runs</span><strong>{summary.test}</strong></Link><Link href="/app/activity?status=queued"><span>In progress</span><strong>{summary.queued}</strong></Link><Link className={summary.failed ? "needs-attention" : ""} href="/app/activity?status=attention"><span>Needs attention</span><strong>{summary.failed}</strong></Link></div>
    <div className="section-head dashboard-section-head"><div><h2>Projects</h2></div><Link className="inline-link small muted" href="/app/projects">View all</Link></div>
    {projects.length ? <div className="list">{projects.slice(0, 5).map((project) => <div className="project-row" key={project.id}><Link href={`/app/projects/${project.id}`}><div className="project-title">{project.name}</div><div className="meta">{project.sourceProjectCount} Clockify project{project.sourceProjectCount === 1 ? "" : "s"}{project.workspaceName ? ` · ${project.workspaceName}` : ""}</div></Link><ProjectStatusControl projectId={project.id} active={project.active} /></div>)}</div> : <div className="empty"><p>No projects yet.</p><Link className="button" href="/app/projects/new">Create your first project</Link></div>}
    <div className="section-head dashboard-section-head recent-head"><div><h2>Recent activity</h2></div><Link className="inline-link small muted" href="/app/activity">View activity</Link></div>
    {recent.length ? <div className="dashboard-activity">{recent.map((run) => <Link href={`/app/activity/${run.id}`} className="dashboard-activity-row" key={run.id}><div><strong>{run.projectName}</strong><span>{run.reportType === "weekly" ? "Weekly" : "Monthly"} · {run.periodStart} → {run.periodEnd}</span></div><RunStatus status={run.operationalStatus} /></Link>)}</div> : <div className="empty compact-empty">No report runs yet.</div>}
  </main>;
}
