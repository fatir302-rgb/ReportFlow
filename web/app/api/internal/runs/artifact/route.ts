import path from "node:path";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { registerRunArtifact } from "@/lib/db";
import { matchesSecret } from "@/lib/request-security";

function authorized(request: Request) {
  const secret = process.env.REPORTFLOW_SCHEDULER_SECRET;
  return matchesSecret(request.headers.get("authorization"), secret ? `Bearer ${secret}` : null);
}
function rootDir() {
  const configured = process.env.REPORTFLOW_GENERATED_DIR || "./data/generated";
  return path.resolve(
    path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured),
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { runId?: string; filename?: string; contentType?: string } | null;
  const runId = String(body?.runId || "").trim();
  const filename = String(body?.filename || "").trim();
  const contentType = String(body?.contentType || "application/octet-stream").trim();
  if (!runId || !filename || filename !== path.basename(filename)) return NextResponse.json({ error: "Valid runId and filename are required" }, { status: 422 });
  const filePath = path.resolve(rootDir(), filename);
  if (!filePath.startsWith(rootDir() + path.sep)) return NextResponse.json({ error: "Invalid filename" }, { status: 422 });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Artifact is not a file");
    const id = registerRunArtifact({ runId, filename, contentType, byteSize: info.size });
    if (!id) return NextResponse.json({ error: "Report run not found" }, { status: 404 });
    return NextResponse.json({ registered: true, id, byteSize: info.size });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generated report file not found" }, { status: 404 });
  }
}
