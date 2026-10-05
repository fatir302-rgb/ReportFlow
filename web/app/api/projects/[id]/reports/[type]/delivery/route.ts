import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getProject, getReportConfiguration, getReportDeliveryConfiguration, saveReportDeliveryConfiguration } from "@/lib/db";

function isReportType(value: string): value is "weekly" | "monthly" {
  return value === "weekly" || value === "monthly";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanEmails(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ delivery: getReportDeliveryConfiguration(user.id, id, type) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!getReportConfiguration(user.id, id, type)) return NextResponse.json({ error: "Configure this report first" }, { status: 409 });

  const body = await request.json().catch(() => null) as any;
  const enabled = body?.enabled !== false;
  const connectionId = String(body?.connectionId || "").trim();
  const to = cleanEmails(body?.to);
  const cc = cleanEmails(body?.cc);
  const bcc = cleanEmails(body?.bcc);
  const subjectTemplate = String(body?.subjectTemplate || "").trim();
  const bodyTemplate = String(body?.bodyTemplate || "").trim();
  const attachReport = body?.attachReport !== false;

  if (!connectionId) return NextResponse.json({ error: "Choose a Gmail or Outlook sending account" }, { status: 422 });
  const invalid = [...to, ...cc, ...bcc].find((email) => !EMAIL_RE.test(email));
  if (invalid) return NextResponse.json({ error: `Invalid email address: ${invalid}` }, { status: 422 });
  if (enabled && to.length === 0) return NextResponse.json({ error: "Add at least one recipient" }, { status: 422 });
  if (!subjectTemplate) return NextResponse.json({ error: "Email subject is required" }, { status: 422 });
  if (!bodyTemplate) return NextResponse.json({ error: "Email body is required" }, { status: 422 });

  const delivery = saveReportDeliveryConfiguration({
    userId: user.id,
    projectId: id,
    reportType: type,
    enabled,
    connectionId,
    to, cc, bcc,
    subjectTemplate,
    bodyTemplate,
    attachReport,
  });
  if (!delivery) return NextResponse.json({ error: "Sending account or report configuration not found" }, { status: 404 });
  return NextResponse.json({ delivery });
}
