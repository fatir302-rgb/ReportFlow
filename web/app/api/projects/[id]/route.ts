import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { currentAppUser } from "@/lib/session";
import { deleteProject, getConnection, getProject, setProjectActive, updateProject } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = getProject(user.id, id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  if (!body?.name?.trim()) return NextResponse.json({ error: "Project name is required" }, { status: 422 });
  if (!body?.workspace?.id || !body?.workspace?.name) return NextResponse.json({ error: "Clockify workspace is required" }, { status: 422 });
  if (!Array.isArray(body?.sourceProjects) || body.sourceProjects.length === 0) return NextResponse.json({ error: "Select at least one Clockify project" }, { status: 422 });
  if (!getConnection(user.id, "clockify")) return NextResponse.json({ error: "Connect Clockify first" }, { status: 409 });
  const updated = updateProject({ userId: user.id, projectId: id, name: body.name, description: body.description, workspaceId: body.workspace.id, workspaceName: body.workspace.name, sourceProjects: body.sourceProjects });
  if (!updated) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ id });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Active must be true or false" }, { status: 422 });
  if (!setProjectActive(user.id, id, body.active)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ active: body.active });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deleted = deleteProject(user.id, id);
  if (!deleted) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  await Promise.all(deleted.templatePaths.map((templatePath) => rm(templatePath, { force: true }).catch(() => undefined)));
  return NextResponse.json({ deleted: true });
}
