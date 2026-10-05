import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { createAuditLog, getReportRunDetail } from "@/lib/db";
import { deliverReportRun } from "@/lib/run-delivery";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const run = getReportRunDetail(user.id, id);
  if (!run) return NextResponse.json({ error: "Report run not found" }, { status: 404 });
  if (run.runMode !== "production" || run.queueStatus !== "completed" || !run.artifact) {
    return NextResponse.json({ error: "Only a completed Production report with a generated file can be approved." }, { status: 409 });
  }
  if (run.delivery || run.resendAttempts.length) {
    return NextResponse.json({ error: "This report already has a delivery attempt. Use the explicit resend action if another email is intended." }, { status: 409 });
  }

  try {
    const result = await deliverReportRun(id);
    if (result.status === "not_configured") {
      return NextResponse.json({ error: "Email delivery is no longer configured for this report." }, { status: 422 });
    }
    createAuditLog({
      userId: user.id,
      projectId: run.projectId,
      action: "report_run_approved_and_sent",
      entityType: "report_run",
      entityId: id,
      summary: `Approved and sent ${run.reportType} report for ${run.periodStart} to ${run.periodEnd}`,
      metadata: { periodStart: run.periodStart, periodEnd: run.periodEnd, deliveryStatus: result.status },
    });
    return NextResponse.json({ ok: true, deliveryStatus: result.status });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to send the approved report",
    }, { status: 502 });
  }
}