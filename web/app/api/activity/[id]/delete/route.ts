import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { deleteReportRun } from "@/lib/db";
import { generatedArtifactPath } from "@/lib/run-operations";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deleted = deleteReportRun(user.id, id);
  if (!deleted.ok) {
    if (deleted.reason === "not_found") return NextResponse.json({ error: "Report run not found" }, { status: 404 });
    return NextResponse.json({ error: "A report cannot be deleted while generation or email delivery is in progress." }, { status: 409 });
  }
  if (deleted.filename) {
    await rm(generatedArtifactPath(deleted.filename), { force: true }).catch(() => undefined);
  }
  return NextResponse.json({ deleted: true });
}