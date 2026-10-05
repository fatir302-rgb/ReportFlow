import { NextResponse } from "next/server";
import { deliverReportRun } from "@/lib/run-delivery";
import { matchesSecret } from "@/lib/request-security";

function authorized(request: Request) {
  const secret = process.env.REPORTFLOW_SCHEDULER_SECRET;
  return matchesSecret(request.headers.get("authorization"), secret ? `Bearer ${secret}` : null);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { runId?: string } | null;
  if (!body?.runId) return NextResponse.json({ error: "runId is required" }, { status: 422 });
  try {
    const result = await deliverReportRun(body.runId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delivery failed" }, { status: 409 });
  }
}
