import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { createProject, getConnection, listProjects } from "@/lib/db";

export async function GET() {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ projects: listProjects(user.id) });
}

export async function POST(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  if (!body?.name?.trim()) return NextResponse.json({ error: "Project name is required" }, { status: 422 });
  if (!body?.workspace?.id || !body?.workspace?.name) return NextResponse.json({ error: "Clockify workspace is required" }, { status: 422 });
  if (!Array.isArray(body?.sourceProjects) || body.sourceProjects.length === 0) {
    return NextResponse.json({ error: "Select at least one Clockify project" }, { status: 422 });
  }
  const connection = getConnection(user.id, "clockify");
  if (!connection) return NextResponse.json({ error: "Connect Clockify first" }, { status: 409 });

  const id = createProject({
    userId: user.id,
    name: body.name,
    description: body.description ?? null,
    connectionId: connection.id,
    workspaceId: body.workspace.id,
    workspaceName: body.workspace.name,
    sourceProjects: body.sourceProjects,
  });
  return NextResponse.json({ id }, { status: 201 });
}
