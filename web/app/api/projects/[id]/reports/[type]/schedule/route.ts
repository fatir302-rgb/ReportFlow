import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getProject, getReportConfiguration, getReportSchedule, saveReportSchedule } from "@/lib/db";
import { isValidTimezone, nextOccurrences } from "@/lib/scheduling";

function isReportType(value: string): value is "weekly" | "monthly" {
  return value === "weekly" || value === "monthly";
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET(_: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ schedule: getReportSchedule(user.id, id, type) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!getReportConfiguration(user.id, id, type)) {
    return NextResponse.json({ error: "Configure and save this report before adding a schedule" }, { status: 409 });
  }

  const body = await request.json().catch(() => null) as any;
  const enabled = body?.enabled !== false;
  const runMode = body?.runMode === "production" ? "production" : "test";
  const timezone = String(body?.timezone || "").trim();
  const weeklyStartDay = Number(body?.weeklyStartDay ?? 1);
  const weeklyEndDay = Number(body?.weeklyEndDay ?? 5);
  const shiftStartTime = String(body?.shiftStartTime || "");
  const shiftEndTime = String(body?.shiftEndTime || "");
  const runDelayMinutes = Number(body?.runDelayMinutes ?? 5);
  const maxAttempts = Number(body?.maxAttempts ?? 4);
  const retryDelayMinutes = Number(body?.retryDelayMinutes ?? 15);

  if (!timezone || !isValidTimezone(timezone)) return NextResponse.json({ error: "Enter a valid IANA timezone, for example Asia/Karachi" }, { status: 422 });
  if (!Number.isInteger(weeklyStartDay) || weeklyStartDay < 0 || weeklyStartDay > 6) return NextResponse.json({ error: "Choose a valid business week start day" }, { status: 422 });
  if (!Number.isInteger(weeklyEndDay) || weeklyEndDay < 0 || weeklyEndDay > 6) return NextResponse.json({ error: "Choose a valid business week end day" }, { status: 422 });
  if (type === "weekly" && weeklyStartDay === weeklyEndDay) return NextResponse.json({ error: "Business week start and end days must be different" }, { status: 422 });
  if (!TIME_RE.test(shiftStartTime) || !TIME_RE.test(shiftEndTime)) return NextResponse.json({ error: "Shift times must use HH:mm" }, { status: 422 });
  if (!Number.isInteger(runDelayMinutes) || runDelayMinutes < 0 || runDelayMinutes > 1440) return NextResponse.json({ error: "Run delay must be between 0 and 1440 minutes" }, { status: 422 });
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12) return NextResponse.json({ error: "Retry attempts must be between 1 and 12" }, { status: 422 });
  if (!Number.isInteger(retryDelayMinutes) || retryDelayMinutes < 1 || retryDelayMinutes > 1440) return NextResponse.json({ error: "Retry delay must be between 1 and 1440 minutes" }, { status: 422 });

  const schedule = saveReportSchedule({
    userId: user.id,
    projectId: id,
    reportType: type,
    enabled,
    runMode,
    timezone,
    weeklyStartDay,
    weeklyEndDay,
    shiftStartTime,
    shiftEndTime,
    runDelayMinutes,
    maxAttempts,
    retryDelayMinutes,
  });
  if (!schedule) return NextResponse.json({ error: "Report configuration not found" }, { status: 404 });

  const preview = enabled ? nextOccurrences({ reportType: type, timezone, weeklyStartDay, weeklyEndDay, shiftStartTime, shiftEndTime, runDelayMinutes }, 3) : [];
  return NextResponse.json({ schedule, preview: preview.map((item) => ({ ...item, runAt: item.runAt.toISOString() })) });
}
