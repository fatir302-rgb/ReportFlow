"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportType } from "@/lib/types";
import { occurrenceForReferenceDate } from "@/lib/scheduling";

function dateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

export function RunReportNow({
  projectId,
  projectName,
  reportType,
  defaultReferenceDate,
  timezone,
  weeklyStartDay,
  weeklyEndDay,
  shiftStartTime,
  shiftEndTime,
  runDelayMinutes,
  nowIso,
  sender,
  recipients,
  unavailableReasons,
}: {
  projectId: string;
  projectName: string;
  reportType: ReportType;
  defaultReferenceDate: string;
  timezone: string;
  weeklyStartDay: number;
  weeklyEndDay: number;
  shiftStartTime: string;
  shiftEndTime: string;
  runDelayMinutes: number;
  nowIso: string;
  sender: string | null;
  recipients: string[];
  unavailableReasons: string[];
}) {
  const router = useRouter();
  const [referenceDate, setReferenceDate] = useState(defaultReferenceDate);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string; runId?: string } | null>(null);
  const occurrence = useMemo(() => {
    try {
      return occurrenceForReferenceDate({
        reportType,
        timezone,
        weeklyStartDay,
        weeklyEndDay,
        shiftStartTime,
        shiftEndTime,
        runDelayMinutes,
      }, referenceDate);
    } catch {
      return null;
    }
  }, [referenceDate, reportType, timezone, weeklyStartDay, weeklyEndDay, shiftStartTime, shiftEndTime, runDelayMinutes]);
  const early = Boolean(occurrence && occurrence.sourceEndAt.getTime() > new Date(nowIso).getTime());
  const ready = unavailableReasons.length === 0 && Boolean(occurrence) && referenceDate <= defaultReferenceDate;

  async function runNow() {
    if (!occurrence) return;
    const period = `${occurrence.periodStart} to ${occurrence.periodEnd}`;
    const earlyWarning = early
      ? `\n\nThe final shift has not ended yet. The preview will use Clockify data available now for ${period}. Review the file before approving any email.`
      : "";
    const confirmed = window.confirm(
      `Generate the ${projectName} ${reportType} report for ${period} for review?${earlyWarning}\n\nNo email will be sent until you inspect the workbook in Activity and approve sending.`,
    );
    if (!confirmed) return;
    setRunning(true);
    setMessage(null);
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}/run-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referenceDate, confirmed: true, allowEarly: early }),
    });
    const payload = await response.json().catch(() => ({}));
    setRunning(false);
    if (!response.ok) {
      setMessage({ kind: "error", text: payload.error || "Unable to generate and send the report", runId: payload.runId });
      return;
    }
    setMessage({ kind: "success", text: "Report generated for review. No email was sent. Opening Activity…", runId: payload.runId });
    router.push(`/app/activity/${payload.runId}`);
    router.refresh();
  }

  return (
    <section className="run-now-section">
      <div className="section-head">
        <div>
          <h2>Run now</h2>
          <p className="muted">Generate a workbook first. Review and download it in Activity before approving email delivery.</p>
        </div>
      </div>
      <div className="form run-now-form">
        <div className="run-now-grid">
          <div className="field">
            <label htmlFor={`${reportType}-run-reference-date`}>Date in the reporting period</label>
            <input
              id={`${reportType}-run-reference-date`}
              className="input"
              type="date"
              max={defaultReferenceDate}
              value={referenceDate}
              onChange={(event) => setReferenceDate(event.target.value)}
            />
            <div className="field-help">Choose today for this week/month, or a past date for a missed period. ReportFlow maps it to your saved working calendar.</div>
          </div>
          <div className="card run-now-summary">
            <div><span className="detail-label">Reporting period</span><strong>{occurrence ? `${occurrence.periodStart} → ${occurrence.periodEnd}` : "Choose a valid date"}</strong></div>
            <div><span className="detail-label">Scheduled completion</span><strong>{occurrence ? dateTime(occurrence.sourceEndAt, timezone) : "—"}</strong></div>
            <div><span className="detail-label">Send from</span><strong>{sender || "Not configured"}</strong></div>
            <div><span className="detail-label">Recipients if approved</span><strong>{recipients.length ? recipients.join(", ") : "Not configured"}</strong></div>
          </div>
        </div>
        {unavailableReasons.length ? (
          <div className="delivery-mode-note"><strong>Complete setup first:</strong> {unavailableReasons.join(" ")}</div>
        ) : early ? (
          <div className="run-now-warning"><strong>Early preview:</strong> the final shift is still open. The workbook will include Clockify data currently available; review it before approving any email.</div>
        ) : (
          <div className="delivery-mode-note"><strong>Review before sending:</strong> generation creates a saved Activity item. No email is sent until you approve it there.</div>
        )}
        {referenceDate > defaultReferenceDate ? <p className="error" role="alert">Choose today or an earlier date.</p> : null}
        <div className="form-actions">
          <button className="button primary" type="button" disabled={!ready || running} onClick={runNow}>
            {running ? "Generating preview…" : early ? "Generate early preview" : "Generate for review"}
          </button>
        </div>
        {message && (
          <p className={message.kind === "error" ? "error" : "success"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}{message.runId ? <> <Link className="inline-link" href={`/app/activity/${message.runId}`}>Open Activity →</Link></> : null}
          </p>
        )}
      </div>
    </section>
  );
}
