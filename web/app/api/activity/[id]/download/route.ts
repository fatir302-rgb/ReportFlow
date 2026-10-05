import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getReportRunDetail, getRunArtifact } from "@/lib/db";
import { generatedArtifactPath } from "@/lib/run-operations";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const run = getReportRunDetail(user.id, id);
  if (!run) return NextResponse.json({ error: "Report run not found" }, { status: 404 });
  if (!run.artifact) return NextResponse.json({ error: "This run has no generated report file" }, { status: 404 });
  try {
    const artifact = getRunArtifact(id);
    if (!artifact) return NextResponse.json({ error: "This run has no generated report file" }, { status: 404 });
    const bytes = await readFile(generatedArtifactPath(artifact.filename));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": artifact.content_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(run.artifact.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "The generated report file is no longer available on storage" }, { status: 410 });
  }
}
