import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getReportDeliveryConfiguration, getReportRunDetail } from "@/lib/db";
import { RunStatus } from "@/components/run-status";
import { ActivityActions } from "@/components/activity-actions";

function dateOnly(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function dateTime(value: string | null, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAppUser();
  const run = getReportRunDetail(user.id, id);
  if (!run) notFound();
  const currentDelivery = getReportDeliveryConfiguration(user.id, run.projectId, run.reportType);

  const canRetry = run.queueStatus === "failed" || run.queueStatus === "pending";
  const canResend = run.runMode === "production" && run.queueStatus === "completed" && Boolean(run.delivery?.status === "sent" || run.delivery?.status === "failed") && Boolean(run.artifact);
  const canCorrect = run.runMode === "production" && run.queueStatus === "completed" && Boolean(currentDelivery?.enabled && currentDelivery.to.length);
  const canApprove = run.runMode === "production" && run.queueStatus === "completed" && Boolean(run.artifact) && !run.delivery && run.resendAttempts.length === 0 && Boolean(currentDelivery?.enabled && currentDelivery.to.length);
  const canDelete = run.operationalStatus !== "processing";
  const correctionRecipients = currentDelivery
    ? [...currentDelivery.to, ...currentDelivery.cc, ...currentDelivery.bcc]
    : [];
  const deliveryFailed = run.delivery?.status === "failed" && run.operationalStatus === "delivery_failed";

  return (
    <main className="content activity-detail">
      <div className="crumb"><Link href="/app/activity">Activity</Link><span>›</span><span>{run.projectName}</span></div>
      <div className="page-head">
        <div><div className="activity-title-line detail-title-line"><h1>{run.projectName} · {run.reportType === "weekly" ? "Weekly" : "Monthly"}</h1><RunStatus status={run.operationalStatus} /></div><p className="muted">{dateOnly(run.periodStart)} → {dateOnly(run.periodEnd)}</p></div>
        <ActivityActions runId={run.id} canRetry={canRetry} retryLabel={run.queueStatus === "pending" ? "Run now" : "Retry"} canResend={canResend} deliveryFailed={deliveryFailed} canDownload={Boolean(run.artifact)} canCorrect={canCorrect} canApprove={canApprove} approvalRecipients={correctionRecipients} canDelete={canDelete} />
      </div>

      <div className="detail-grid run-detail-grid">
        <div className="card"><div className="detail-label">Mode</div><div className="connection-name">{run.runMode === "production" ? "Production" : "Test"}</div><div className="muted">{run.runMode === "test" ? "Automatic email suppressed" : canApprove ? "Generated for review; not sent" : "Production delivery"}</div></div>
        <div className="card"><div className="detail-label">Scheduled for</div><div className="connection-name">{dateTime(run.scheduledFor, run.timezone)}</div><div className="muted">{run.timezone}</div></div>
        <div className="card"><div className="detail-label">Attempts</div><div className="connection-name">{run.attemptCount} / {run.maxAttempts}</div><div className="muted">Manual retries: {run.manualRetryCount}</div></div>
        <div className="card"><div className="detail-label">Generated file</div><div className="connection-name">{run.artifact?.filename || "Not generated"}</div><div className="muted">{run.artifact?.byteSize ? `${Math.round(run.artifact.byteSize / 1024)} KB` : run.artifact ? run.artifact.contentType : "—"}</div></div>
      </div>

      <section className="section-block">
        <div className="section-head"><div><h2>Source window</h2><p className="muted">Exact Clockify timestamps used for this business reporting period.</p></div></div>
        <div className="card operation-table">
          <div><span>Period</span><strong>{dateOnly(run.periodStart)} → {dateOnly(run.periodEnd)}</strong></div>
          <div><span>Source starts</span><strong>{dateTime(run.sourceStartAt, run.timezone)}</strong></div>
          <div><span>Source ends</span><strong>{dateTime(run.sourceEndAt, run.timezone)}</strong></div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-head"><div><h2>Delivery</h2><p className="muted">Automatic delivery state for this run.</p></div></div>
        {deliveryFailed && run.artifact ? <div className="delivery-recovery-note" role="alert"><strong>Delivery failed, but the generated report is safe.</strong><span>Use <b>Push report now</b> above to send it again with the saved sender and recipients. The attempt will be recorded below.</span></div> : null}
        {canApprove ? <div className="delivery-recovery-note"><strong>Review before sending</strong><span>Download and inspect the generated workbook. ReportFlow will send it only after you select <b>Approve &amp; send</b>.</span><span>Current recipients: {correctionRecipients.join(", ")}</span></div> : null}
        {run.delivery ? <div className="card operation-table">
          <div><span>Status</span><strong>{run.operationalStatus === "sent" && run.delivery.status === "failed" ? "resolved (sent on retry)" : run.delivery.status.replaceAll("_", " ")}</strong></div>
          <div><span>Provider</span><strong>{run.delivery.provider === "gmail" ? "Gmail" : "Outlook"}</strong></div>
          <div><span>Sender</span><strong>{run.delivery.sender || "—"}</strong></div>
          <div><span>To</span><strong>{run.deliveryRecipients?.to.join(", ") || "—"}</strong></div>
          {run.deliveryRecipients?.cc.length ? <div><span>CC</span><strong>{run.deliveryRecipients.cc.join(", ")}</strong></div> : null}
          {run.deliveryRecipients?.bcc.length ? <div><span>BCC</span><strong>{run.deliveryRecipients.bcc.join(", ")}</strong></div> : null}
          <div><span>Subject</span><strong>{run.delivery.subject}</strong></div>
          {run.delivery.error ? <div className="operation-error"><span>Error</span><strong>{run.delivery.error}</strong></div> : null}
        </div> : <div className="empty">{canApprove ? "No email has been sent. This report is waiting for your review and approval." : "No delivery record exists for this run yet."}</div>}
      </section>

      {run.lastError ? <section className="section-block"><div className="section-head"><div><h2>Run error</h2></div></div><div className="error-panel">{run.lastError}</div></section> : null}

      <section className="section-block">
        <div className="section-head"><div><h2>Manual resends</h2><p className="muted">Explicit resends are recorded separately from automatic delivery.</p></div></div>
        {run.resendAttempts.length ? <div className="resend-list">{run.resendAttempts.map((attempt) => <div className="resend-row" key={attempt.id}><div><strong>{attempt.status === "sent" ? "Sent" : attempt.status === "failed" ? "Failed" : "Sending"}</strong><span>{attempt.provider === "gmail" ? "Gmail" : "Outlook"} · {attempt.recipients.to.join(", ")}</span>{attempt.error ? <span className="error">{attempt.error}</span> : null}</div><small>{dateTime(attempt.updatedAt, run.timezone)}</small></div>)}</div> : <div className="empty compact-empty">No manual resends.</div>}
      </section>
    </main>
  );
}
