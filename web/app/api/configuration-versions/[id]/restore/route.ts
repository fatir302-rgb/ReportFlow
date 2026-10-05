import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getConfigurationVersion } from "@/lib/db";
import { restoreConfigurationVersion } from "@/lib/config-governance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const target = getConfigurationVersion(user.id, id);
  if (!target) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  try {
    const version = restoreConfigurationVersion(user.id, id);
    return NextResponse.redirect(new URL(`/app/projects/${target.projectId}/versions?restored=${version.versionNumber}`, request.url), 303);
  } catch (error) {
    return NextResponse.redirect(new URL(`/app/projects/${target.projectId}/versions?error=${encodeURIComponent(error instanceof Error ? error.message : "Restore failed")}`, request.url), 303);
  }
}
