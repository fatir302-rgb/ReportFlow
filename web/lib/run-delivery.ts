import path from "node:path";
import { stat } from "node:fs/promises";
import { attachmentFromFile, sendWithDeliveryConnection } from "@/lib/email-delivery";
import { completeDeliveryLog, getDeliveryContextForRun, getDeliveryLogForRun, getRunArtifact, reserveDeliveryLog } from "@/lib/db";
import { deliveryTemplateValues, renderDeliveryTemplate } from "@/lib/delivery-template";

function parsed(value: string | null | undefined): string[] {
  try { const result = JSON.parse(value || "[]"); return Array.isArray(result) ? result.map(String) : []; } catch { return []; }
}

function generatedRoot() {
  const configured = process.env.REPORTFLOW_GENERATED_DIR || "./data/generated";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

function safeArtifactPath(filename: string) {
  const root = path.resolve(generatedRoot());
  const resolved = path.resolve(root, filename);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Invalid generated report filename");
  return resolved;
}

export async function deliverReportRun(runId: string) {
  const context = getDeliveryContextForRun(runId);
  if (!context) throw new Error("Report run not found");
  if (!context.delivery_configuration_id || !context.delivery_enabled || !context.connection_id || !context.provider) {
    return { status: "not_configured" as const };
  }

  const existing = getDeliveryLogForRun(runId);
  if (existing) return { status: "already_recorded" as const, log: existing };

  const to = parsed(context.to_json);
  const cc = parsed(context.cc_json);
  const bcc = parsed(context.bcc_json);
  const values = deliveryTemplateValues({
    projectName: context.project_name,
    reportType: context.report_type,
    periodStart: context.period_start,
    periodEnd: context.period_end,
  });
  const subject = renderDeliveryTemplate(context.subject_template, values);
  const bodyText = renderDeliveryTemplate(context.body_template, values);

  if (context.run_mode !== "production") {
    reserveDeliveryLog({
      runId,
      reportConfigurationId: context.report_configuration_id,
      connectionId: context.connection_id,
      provider: context.provider,
      sender: context.display_name,
      recipients: { to, cc, bcc },
      subject,
      status: "skipped_test",
    });
    return { status: "skipped_test" as const, subject, bodyText };
  }

  let attachment = null;
  if (context.attach_report) {
    const artifact = getRunArtifact(runId);
    if (!artifact) throw new Error("Generated report artifact is not registered yet");
    const filePath = safeArtifactPath(artifact.filename);
    await stat(filePath);
    attachment = await attachmentFromFile(filePath, artifact.display_filename || artifact.filename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, ""), artifact.content_type);
  }

  const logId = reserveDeliveryLog({
    runId,
    reportConfigurationId: context.report_configuration_id,
    connectionId: context.connection_id,
    provider: context.provider,
    sender: context.display_name,
    recipients: { to, cc, bcc },
    subject,
    status: "sending",
  });
  if (!logId) return { status: "already_recorded" as const, log: getDeliveryLogForRun(runId) };

  try {
    const result = await sendWithDeliveryConnection({
      userId: context.user_id,
      connectionId: context.connection_id,
      message: { to, cc, bcc, subject, bodyText, attachment },
    });
    completeDeliveryLog(logId, { status: "sent", providerMessageId: result.providerMessageId });
    return { status: "sent" as const, provider: result.provider, sender: result.sender, providerMessageId: result.providerMessageId };
  } catch (error) {
    completeDeliveryLog(logId, { status: "failed", error: error instanceof Error ? error.message : "Email delivery failed" });
    throw error;
  }
}
