import { notFound, redirect } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getConnection, getProject, getReportConfiguration, getReportSchedule, getReportDeliveryConfiguration, listDeliveryConnections } from "@/lib/db";
import { ReportConfigForm } from "@/components/report-config-form";
import { ScheduleConfigForm } from "@/components/schedule-config-form";
import { EmailDeliveryForm } from "@/components/email-delivery-form";
import { RunReportNow } from "@/components/run-report-now";
import { currentOccurrence, localDateInTimezone } from "@/lib/scheduling";
import type { ReportType } from "@/lib/types";

export default async function ReportConfigPage({ params }: { params: Promise<{ id: string; type: string }> }) {
  const { id, type } = await params;
  if (type !== "weekly" && type !== "monthly") redirect(`/app/projects/${id}`);
  const reportType = type as ReportType;
  const user = await requireAppUser();
  const project = getProject(user.id, id);
  if (!project) notFound();
  const existing = getReportConfiguration(user.id, id, reportType);
  const schedule = getReportSchedule(user.id, id, reportType);
  const delivery = getReportDeliveryConfiguration(user.id, id, reportType);
  const deliveryConnections = listDeliveryConnections(user.id);
  const clockify = getConnection(user.id, "clockify");
  const unavailableReasons: string[] = [];
  if (!existing) unavailableReasons.push("Save the report configuration.");
  else {
    if (!existing.enabled) unavailableReasons.push("Enable the report.");
    if (!existing.templateId) unavailableReasons.push("Upload a template.");
    if (existing.outputFormat === "pdf") unavailableReasons.push("Choose XLSX or XLSM output; on-demand PDF generation is not available yet.");
  }
  if (!clockify) unavailableReasons.push("Connect Clockify.");
  if (!schedule) unavailableReasons.push("Save the schedule.");
  if (!delivery?.enabled) unavailableReasons.push("Enable and save delivery.");
  if (delivery && !delivery.to.length) unavailableReasons.push("Add at least one To recipient.");
  const now = new Date();
  let defaultReferenceDate = now.toISOString().slice(0, 10);
  if (schedule) {
    try {
      const rule = {
        reportType,
        timezone: schedule.timezone,
        weeklyStartDay: schedule.weeklyStartDay,
        weeklyEndDay: schedule.weeklyEndDay,
        shiftStartTime: schedule.shiftStartTime,
        shiftEndTime: schedule.shiftEndTime,
        runDelayMinutes: schedule.runDelayMinutes,
      };
      currentOccurrence(rule, now);
      defaultReferenceDate = localDateInTimezone(now, schedule.timezone);
    } catch {
      unavailableReasons.push("Correct and save the schedule timezone and shift settings.");
    }
  }
  return (
    <main className="content" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1>{reportType === "weekly" ? "Weekly report" : "Monthly report"}</h1><p className="muted">Configure this report independently for {project.name}.</p></div></div>
      <ReportConfigForm projectId={project.id} projectName={project.name} reportType={reportType} existing={existing} sourceProjects={project.sourceProjects} />
      <ScheduleConfigForm projectId={project.id} reportType={reportType} existing={schedule} reportConfigured={Boolean(existing)} />
      <EmailDeliveryForm projectId={project.id} projectName={project.name} reportType={reportType} existing={delivery} connections={deliveryConnections} />
      <RunReportNow
        projectId={project.id}
        projectName={project.name}
        reportType={reportType}
        defaultReferenceDate={defaultReferenceDate}
        timezone={schedule?.timezone || "UTC"}
        weeklyStartDay={schedule?.weeklyStartDay ?? 1}
        weeklyEndDay={schedule?.weeklyEndDay ?? 5}
        shiftStartTime={schedule?.shiftStartTime || "09:00"}
        shiftEndTime={schedule?.shiftEndTime || "17:00"}
        runDelayMinutes={schedule?.runDelayMinutes ?? 5}
        nowIso={now.toISOString()}
        sender={delivery?.senderDisplayName || null}
        recipients={delivery?.to || []}
        unavailableReasons={unavailableReasons}
      />
    </main>
  );
}
