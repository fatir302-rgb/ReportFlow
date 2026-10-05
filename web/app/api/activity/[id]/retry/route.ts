import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { markReportRunProcessing, retryFailedReportRun } from "@/lib/db";
import { generateClaimedReportRun } from "@/lib/report-runner";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = retryFailedReportRun(user.id, id);
  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ error: "Report run not found" }, { status: 404 });
    return NextResponse.json({ error: "This report is already being processed or has completed" }, { status: 409 });
  }
  if (!markReportRunProcessing(id)) {
    return NextResponse.json({ error: "This report was claimed by another worker" }, { status: 409 });
  }
  try {
    const result = await generateClaimedReportRun(id);
    return NextResponse.json({ ok: true, ...result, previewReady: true });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Report retry failed",
      runId: id,
    }, { status: 400 });
  }
}
