import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  getProject,
  getReportConfiguration,
  getReportRunExecutionContext,
  listDueReportRuns,
  markReportRunCompleted,
  markReportRunFailed,
  markReportRunProcessing,
  registerRunArtifact,
} from "@/lib/db";
import { deliverReportRun } from "@/lib/run-delivery";
import { generateTestReportAttachment } from "@/lib/test-report-generation";

function generatedRoot() {
  const configured = process.env.REPORTFLOW_GENERATED_DIR || "./data/generated";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

function storedFilename(runId: string, displayName: string) {
  const clean = path.basename(displayName).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const extension = path.extname(clean);
  const stem = path.basename(clean, extension).slice(0, 120) || "report";
  return `${runId}-${stem}${extension}`;
}

export async function generateClaimedReportRun(runId: string) {
  let generated: Awaited<ReturnType<typeof generateTestReportAttachment>> | null = null;
  let durablePath: string | null = null;

  try {
    const context = getReportRunExecutionContext(runId);
    if (!context || context.status !== "processing") throw new Error("Claimed report run could not be found");
    const project = getProject(context.userId, context.projectId);
    const report = getReportConfiguration(context.userId, context.projectId, context.reportType);
    if (!project || !report) throw new Error("The project or report configuration is no longer available");

    generated = await generateTestReportAttachment({
      userId: context.userId,
      userName: context.userName,
      project,
      report,
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      timezone: context.timezone,
    });

    const displayFilename = path.basename(generated.attachment.filename);
    const filename = storedFilename(runId, displayFilename);
    const root = path.resolve(generatedRoot());
    await mkdir(root, { recursive: true });
    durablePath = path.join(root, filename);
    await writeFile(durablePath, generated.attachment.content, { flag: "wx" });
    const artifactId = registerRunArtifact({
      runId,
      filename,
      displayFilename,
      contentType: generated.attachment.contentType,
      byteSize: generated.attachment.content.byteLength,
    });
    if (!artifactId || !markReportRunCompleted(runId)) throw new Error("Unable to register the generated report");
    await generated.cleanup().catch(() => undefined);
    generated = null;
    return { runId, artifactFilename: displayFilename };
  } catch (error) {
    await generated?.cleanup().catch(() => undefined);
    if (durablePath) await rm(durablePath, { force: true }).catch(() => undefined);
    markReportRunFailed(runId, error instanceof Error ? error.message : "Report generation failed");
    throw error;
  }
}

export async function processClaimedReportRun(runId: string) {
  await generateClaimedReportRun(runId);
  try {
    const delivery = await deliverReportRun(runId);
    return { runId, deliveryStatus: delivery.status };
  } catch (error) {
    return {
      runId,
      deliveryStatus: "failed" as const,
      deliveryError: error instanceof Error ? error.message : "Email delivery failed",
    };
  }
}

export async function processDueReportRuns(limit = 10) {
  const dueRuns = listDueReportRuns(new Date(), limit);
  const results: Array<{ runId: string; status: "processed" | "failed" | "claimed_elsewhere"; error?: string }> = [];
  for (const run of dueRuns) {
    if (!markReportRunProcessing(run.id)) {
      results.push({ runId: run.id, status: "claimed_elsewhere" });
      continue;
    }
    try {
      await processClaimedReportRun(run.id);
      results.push({ runId: run.id, status: "processed" });
    } catch (error) {
      results.push({
        runId: run.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Report generation failed",
      });
    }
  }
  return results;
}