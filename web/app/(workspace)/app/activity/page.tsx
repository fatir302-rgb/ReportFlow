import Link from "next/link";
import { requireAppUser } from "@/lib/require-app-user";
import { getActivitySummary, listProjects, listReportActivity } from "@/lib/db";
import { ActivityActions } from "@/components/activity-actions";
import { RunStatus } from "@/components/run-status";
import type { OperationalRunStatus } from "@/lib/types";

const statuses: OperationalRunStatus[] = ["queued", "processing", "generated", "sent", "test", "failed", "delivery_failed"];

function validStatus(value?: string): OperationalRunStatus | null {
  return value && statuses.includes(value as OperationalRunStatus) ? value as OperationalRunStatus : null;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function fileSize(bytes: number | null) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAppUser();
  const params = await searchParams;
  const projectId = typeof params.project === "string" ? params.project : "";
  const reportType = params.type === "weekly" || params.type === "monthly" ? params.type : "";
  const runMode = params.mode === "test" || params.mode === "production" ? params.mode : "";
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const attentionOnly = rawStatus === "attention";
  const status = attentionOnly ? null : validStatus(rawStatus);
  const query = typeof params.q === "string" ? params.q : "";
  const projects = listProjects(user.id);
  const summary = getActivitySummary(user.id);
  const loadedRuns = listReportActivity({
    userId: user.id,
    projectId: projectId || null,
    reportType: reportType || null,
    runMode: runMode || null,
    status,
    query: query || null,
    limit: 200,
  });
  const runs = attentionOnly ? loadedRuns.filter((item) => item.operationalStatus === "failed" || item.operationalStatus === "delivery_failed") : loadedRuns;

  return (
    <main className="content activity-content">
      <div className="page-head"><div><h1>Activity</h1><p className="muted">Report runs, generated files, delivery status and failures.</p></div></div>

      <div className="activity-stats">
        <div className="stat-card"><span>Runs</span><strong>{summary.total}</strong></div>
        <div className="stat-card"><span>Sent</span><strong>{summary.sent}</strong></div>
        <div className="stat-card"><span>Test</span><strong>{summary.test}</strong></div>
        <div className="stat-card"><span>In progress</span><strong>{summary.queued}</strong></div>
        <div className={`stat-card${summary.failed ? " stat-alert" : ""}`}><span>Needs attention</span><strong>{summary.failed}</strong></div>
      </div>

      <form className="activity-filters" method="get">
        <input className="input activity-search" name="q" defaultValue={query} placeholder="Search project or period…" aria-label="Search project or reporting period" />
        <select className="select" name="project" defaultValue={projectId} aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
        </select>
        <select className="select" name="type" defaultValue={reportType} aria-label="Filter by report type">
          <option value="">Weekly + monthly</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
        <select className="select" name="status" defaultValue={attentionOnly ? "attention" : status || ""} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="attention">Needs attention</option><option value="sent">Sent</option><option value="test">Test</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="generated">Generated</option><option value="failed">Failed</option><option value="delivery_failed">Delivery failed</option>
        </select>
        <select className="select" name="mode" defaultValue={runMode} aria-label="Filter by run mode">
          <option value="">Test + production</option><option value="production">Production</option><option value="test">Test</option>
        </select>
        <button className="button" type="submit">Filter</button>
        {(projectId || reportType || status || attentionOnly || runMode || query) ? <Link className="button" href="/app/activity">Clear</Link> : null}
      </form>

      {runs.length ? <div className="activity-list">
        {runs.map((run) => (
          <div className="activity-row" key={run.id}>
            <Link className="activity-main activity-main-link" href={`/app/activity/${run.id}`}>
              <div className="activity-title-line"><span className="project-title">{run.projectName}</span><span className="report-kind">{run.reportType}</span><RunStatus status={run.operationalStatus} /></div>
              <div className="meta">{fmtDate(run.periodStart)} → {fmtDate(run.periodEnd)} · {run.runMode === "test" ? "Test run" : "Production"}</div>
              {run.lastError ? <div className="activity-error-line">{run.lastError}</div> : null}
            </Link>
            <div className="activity-side">
              {run.artifact ? <div>{run.artifact.filename}{fileSize(run.artifact.byteSize) ? <small>{fileSize(run.artifact.byteSize)}</small> : null}</div> : <div className="muted">No file yet</div>}
              <ActivityActions
                runId={run.id}
                canRetry={run.queueStatus === "pending" || run.queueStatus === "failed"}
                retryLabel={run.queueStatus === "pending" ? "Run now" : "Retry"}
                canResend={false}
                deliveryFailed={false}
                canDownload={false}
                canDelete={run.operationalStatus !== "processing"}
              />
              <Link className="muted" href={`/app/activity/${run.id}`} aria-label={`Open ${run.projectName} report details`}>Details</Link>
            </div>
          </div>
        ))}
      </div> : <div className="empty">No report runs match these filters. Scheduled runs will appear here as soon as they are queued.</div>}
    </main>
  );
}
