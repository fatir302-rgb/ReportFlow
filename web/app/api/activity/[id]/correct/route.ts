import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { createCorrectedReportRun } from "@/lib/db";
import { generateClaimedReportRun } from "@/lib/report-runner";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const created = createCorrectedReportRun(user.id, id);
  if (!created.ok) {
    if (created.reason === "not_found") return NextResponse.json({ error: "Report run not found" }, { status: 404 });
    if (created.reason === "delivery_not_configured") {
      return NextResponse.json({ error: "Enable email delivery and add a To recipient before generating a corrected report." }, { status: 422 });
    }
    return NextResponse.json({ error: "A corrected copy can only be generated from a completed Production run." }, { status: 409 });
  }
  try {
    const result = await generateClaimedReportRun(created.runId);
    return NextResponse.json({ ok: true, ...result, previewReady: true, recipients: created.recipients });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Corrected report generation failed",
      runId: created.runId,
    }, { status: 400 });
  }
}