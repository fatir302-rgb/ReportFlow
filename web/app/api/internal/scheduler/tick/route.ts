import { NextResponse } from "next/server";
import { enqueueDueReportRuns, listDueReportRuns } from "@/lib/db";
import { matchesSecret } from "@/lib/request-security";
import { processDueReportRuns } from "@/lib/report-runner";

function authorized(request: Request) {
  const configured = process.env.REPORTFLOW_SCHEDULER_SECRET;
  if (!configured) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = request.headers.get("x-reportflow-scheduler-secret");
  return matchesSecret(bearer, configured) || matchesSecret(header, configured);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized scheduler request" }, { status: 401 });
  const queued = enqueueDueReportRuns(new Date());
  const processedRuns = await processDueReportRuns(10);
  const dueRuns = listDueReportRuns(new Date(), 100);
  return NextResponse.json({ ...queued, processedRuns, dueRuns });
}
