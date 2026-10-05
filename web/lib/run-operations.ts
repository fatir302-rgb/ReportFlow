import path from "node:path";
import { stat } from "node:fs/promises";
import { attachmentFromFile, sendWithDeliveryConnection } from "@/lib/email-delivery";
import { deliveryTemplateValues, renderDeliveryTemplate } from "@/lib/delivery-template";
import {
  completeResendLog,
  createResendLog,
  getDeliveryContextForRun,
  getReportRunDetail,
  getRunArtifact,
} from "@/lib/db";

function parsed(value: string | null | undefined): string[] {
  try {
    const result = JSON.parse(value || "[]");
    return Array.isArray(result) ? result.map(String) : [];
  } catch {
    return [];
  }
}

export function generatedRoot() {
  const configured = process.env.REPORTFLOW_GENERATED_DIR || "./data/generated";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function generatedArtifactPath(filename: string) {
  const root = path.resolve(generatedRoot());
  const resolved = path.resolve(root, filename);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Invalid generated report filename");
  return resolved;
}

/**
 * Explicit human resend. This intentionally bypasses Stage 5's one-automatic-delivery-per-run guard,
 * but records every resend as its own attempt so an intentional resend never looks like an automatic duplicate.
 */
export async function resendReportRun(userId: string, runId: string) {
  const run = getReportRunDetail(userId, runId);
  if (!run) throw new Error("Report run not found");
  if (run.runMode !== "production") throw new Error("Test runs cannot be resent to clients. Switch to Production and run a new report instead.");
  if (run.queueStatus !== "completed") throw new Error("Only completed report runs can be resent");

  const context = getDeliveryContextForRun(runId);
  if (!context || context.user_id !== userId) throw new Error("Report run not found");
  if (!context.delivery_configuration_id || !context.delivery_enabled || !context.connection_id || !context.provider) {
    throw new Error("Email delivery is not configured for this report");
  }

  const to = parsed(context.to_json);
  const cc = parsed(context.cc_json);
  const bcc = parsed(context.bcc_json);
  if (!to.length) throw new Error("This report has no To recipient configured");

  const values = deliveryTemplateValues({
    projectName: context.project_name,
    reportType: context.report_type,
    periodStart: context.period_start,
    periodEnd: context.period_end,
  });
  const subject = renderDeliveryTemplate(context.subject_template, values);
  const bodyText = renderDeliveryTemplate(context.body_template, values);

  let attachment = null;
  if (context.attach_report) {
    const artifact = getRunArtifact(runId);
    if (!artifact) throw new Error("Generated report artifact is unavailable");
    const filePath = generatedArtifactPath(artifact.filename);
    await stat(filePath);
    attachment = await attachmentFromFile(filePath, artifact.display_filename || artifact.filename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, ""), artifact.content_type);
  }

  const logId = createResendLog({
    runId,
    reportConfigurationId: context.report_configuration_id,
    connectionId: context.connection_id,
    provider: context.provider,
    sender: context.display_name,
    recipients: { to, cc, bcc },
    subject,
  });

  try {
    const result = await sendWithDeliveryConnection({
      userId,
      connectionId: context.connection_id,
      message: { to, cc, bcc, subject, bodyText, attachment },
    });
    completeResendLog(logId, { status: "sent", providerMessageId: result.providerMessageId });
    return { status: "sent" as const, provider: result.provider, sender: result.sender, providerMessageId: result.providerMessageId };
  } catch (error) {
    completeResendLog(logId, { status: "failed", error: error instanceof Error ? error.message : "Resend failed" });
    throw error;
  }
}
