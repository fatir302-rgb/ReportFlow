import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getProject, getReportConfiguration } from "@/lib/db";
import { sendWithDeliveryConnection } from "@/lib/email-delivery";
import { generateTestReportAttachment } from "@/lib/test-report-generation";

function isReportType(value: string): value is "weekly" | "monthly" { return value === "weekly" || value === "monthly"; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emails(value: unknown) { return Array.isArray(value) ? [...new Set(value.map(String).map((v) => v.trim().toLowerCase()).filter(Boolean))] : []; }

export async function POST(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
  const project = getProject(user.id, id);
  const report = getReportConfiguration(user.id, id, type);
  if (!project || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const body = await request.json().catch(() => null) as any;
  const connectionId = String(body?.connectionId || "");
  const to = emails(body?.to);
  const cc = emails(body?.cc);
  const bcc = emails(body?.bcc);
  if (!connectionId || !to.length) return NextResponse.json({ error: "Choose a sender and add at least one To recipient" }, { status: 422 });
  const invalid = [...to, ...cc, ...bcc].find((email) => !EMAIL_RE.test(email));
  if (invalid) return NextResponse.json({ error: `Invalid email address: ${invalid}` }, { status: 422 });

  let generated: Awaited<ReturnType<typeof generateTestReportAttachment>> | null = null;
  try {
    if (body?.attachReport !== false) {
      generated = await generateTestReportAttachment({
        userId: user.id,
        userName: user.name || user.email,
        project,
        report,
        periodStart: String(body?.periodStart || ""),
        periodEnd: String(body?.periodEnd || ""),
        timezone: String(body?.timezone || "UTC"),
      });
    }
    const result = await sendWithDeliveryConnection({
      userId: user.id,
      connectionId,
      message: {
        to, cc, bcc,
        subject: `[ReportFlow test] ${String(body?.subject || `${project.name} ${type} report`)}`,
        bodyText: `${String(body?.bodyText || "This is a ReportFlow delivery test.")}\n\n---\nTest delivery — ${generated ? "the generated report is attached" : "attachment disabled"}.`,
        attachment: generated?.attachment,
      },
    });
    await generated?.cleanup();
    return NextResponse.json({ sent: true, provider: result.provider, sender: result.sender });
  } catch (error) {
    await generated?.cleanup();
    return NextResponse.json({ error: error instanceof Error ? error.message : "Test email failed" }, { status: 400 });
  }
}
