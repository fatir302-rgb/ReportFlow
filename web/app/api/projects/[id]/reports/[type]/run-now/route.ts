import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import {
  claimManualReportRun,
  createAuditLog,
  getProject,
  getReportConfiguration,
  getReportSchedule,
} from "@/lib/db";
import { localDateInTimezone, occurrenceForReferenceDate } from "@/lib/scheduling";
import { generateClaimedReportRun } from "@/lib/report-runner";

function isReportType(value: string): value is "weekly" | "monthly" {
  return value === "weekly" || value === "monthly";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Invalid report type" }, { status: 400 });

  const project = getProject(user.id, id);
  const report = getReportConfiguration(user.id, id, type);
  const schedule = getReportSchedule(user.id, id, type);
  if (!project || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!report.enabled || !report.templateId) {
    return NextResponse.json({ error: "Enable the report and upload a template first." }, { status: 422 });
  }
  if (report.outputFormat === "pdf") {
    return NextResponse.json({ error: "Generate & send now currently supports XLSX and XLSM reports, not PDF." }, { status: 422 });
  }
  if (!schedule) return NextResponse.json({ error: "Save the report schedule first." }, { status: 422 });
  const body = await request.json().catch(() => null) as { referenceDate?: unknown; confirmed?: unknown; allowEarly?: unknown } | null;
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Confirm report generation before continuing." }, { status: 422 });
  }

  let occurrence;
  const referenceDate = String(body?.referenceDate || "");
  const today = localDateInTimezone(new Date(), schedule.timezone);
  if (referenceDate > today) {
    return NextResponse.json({ error: "Choose today or an earlier date." }, { status: 422 });
  }
  try {
    occurrence = occurrenceForReferenceDate({
      reportType: type,
      timezone: schedule.timezone,
      weeklyStartDay: schedule.weeklyStartDay,
      weeklyEndDay: schedule.weeklyEndDay,
      shiftStartTime: schedule.shiftStartTime,
      shiftEndTime: schedule.shiftEndTime,
      runDelayMinutes: schedule.runDelayMinutes,
    }, referenceDate);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid reporting period" }, { status: 422 });
  }
  const early = occurrence.sourceEndAt.getTime() > Date.now();
  if (early && body?.allowEarly !== true) {
    return NextResponse.json({
      error: "The final shift is still open. Confirm an early preview using the Clockify data currently available.",
      early: true,
    }, { status: 422 });
  }

  const claim = claimManualReportRun({
    userId: user.id,
    projectId: id,
    reportType: type,
    periodStart: occurrence.periodStart,
    periodEnd: occurrence.periodEnd,
    sourceStartAt: occurrence.sourceStartAt,
    sourceEndAt: occurrence.sourceEndAt,
  });
  if (!claim.ok) {
    if (claim.reason === "already_exists") {
      return NextResponse.json({
        error: "A run for this reporting period already exists. Open it in Activity to review, retry, or resend it.",
        runId: claim.runId,
      }, { status: 409 });
    }
    return NextResponse.json({ error: "Report schedule not found" }, { status: 404 });
  }

  const runId = claim.runId;
  try {
    const generated = await generateClaimedReportRun(runId);
    createAuditLog({
      userId: user.id,
      projectId: id,
      action: "report_run_preview_generated",
      entityType: "report_run",
      entityId: runId,
      summary: `Generated ${type} report for review for ${occurrence.periodStart} to ${occurrence.periodEnd}`,
      metadata: { periodStart: occurrence.periodStart, periodEnd: occurrence.periodEnd, early },
    });
    return NextResponse.json({ ok: true, runId, artifactFilename: generated.artifactFilename, previewReady: true, early });
  } catch (error) {
    createAuditLog({
      userId: user.id,
      projectId: id,
      action: "report_run_now_failed",
      entityType: "report_run",
      entityId: runId,
      summary: `Failed to generate ${type} report on demand`,
      metadata: { periodStart: occurrence.periodStart, periodEnd: occurrence.periodEnd },
    });
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Manual report generation failed",
      runId,
    }, { status: 400 });
  }
}
