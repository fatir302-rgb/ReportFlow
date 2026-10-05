import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { getConnection } from "@/lib/db";
import { getClockifyProjects } from "@/lib/clockify";

export async function GET(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 422 });
  const connection = getConnection(user.id, "clockify");
  if (!connection) return NextResponse.json({ error: "Connect Clockify first" }, { status: 409 });
  try {
    const projects = await getClockifyProjects(decryptSecret(connection.credentials_enc), workspaceId);
    return NextResponse.json({ projects: projects.filter((project) => !project.archived) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Clockify projects" }, { status: 400 });
  }
}
