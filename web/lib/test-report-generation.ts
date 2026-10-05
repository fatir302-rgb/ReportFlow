import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { decryptSecret } from "@/lib/crypto";
import { getConnection, getReportTemplate } from "@/lib/db";
import { attachmentFromFile, type EmailAttachment } from "@/lib/email-delivery";

type TestReportInput = {
  userId: string;
  userName: string;
  project: any;
  report: any;
  periodStart: string;
  periodEnd: string;
  timezone: string;
};

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function pythonExecutable(repoRoot: string) {
  const configured = process.env.REPORTFLOW_PYTHON?.trim();
  if (configured) return configured;
  const localPython = process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  if (existsSync(localPython)) return localPython;
  return process.platform === "win32" ? "python" : "python3";
}

function safeFilename(pattern: string, values: Record<string, string>, extension: string) {
  let name = pattern.replace(/\{([a-z_]+)\}/g, (_, key) => values[key] ?? `{${key}}`);
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "ReportFlow_test_report";
  if (!name.toLowerCase().endsWith(extension)) name += extension;
  return name;
}

export async function generateTestReportAttachment(input: TestReportInput): Promise<{ attachment: EmailAttachment; cleanup: () => Promise<void> }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)) throw new Error("Invalid test report period");
  if (!input.report.templateId) throw new Error("Upload a report template before sending a test report");
  if (input.report.outputFormat === "pdf") throw new Error("Test report attachment generation currently supports XLSX/XLSM, not PDF");
  const template = getReportTemplate(input.userId, input.report.templateId);
  if (!template) throw new Error("The active report template could not be found");
  const clockifyConnection = getConnection(input.userId, "clockify");
  if (!clockifyConnection) throw new Error("Connect Clockify before generating a test report");

  const projectIds = input.report.sourceMode === "selected"
    ? input.report.sourceProjectIds
    : input.project.sourceProjects.map((item: any) => item.id);
  if (!projectIds.length) throw new Error("Select at least one Clockify project before generating a test report");
  const clockifyApiKey = decryptSecret(clockifyConnection.credentials_enc);
  const extension = input.report.outputFormat === "xlsm" ? ".xlsm" : ".xlsx";
  const generatedRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.REPORTFLOW_GENERATED_DIR || "./data/generated",
  );
  const testDir = path.join(generatedRoot, "test-email");
  await mkdir(testDir, { recursive: true });
  const outputPath = path.join(testDir, `${randomUUID()}${extension}`);
  const repoRoot = path.resolve(process.cwd(), "..");
  const payload = {
    api_key: clockifyApiKey,
    workspace_id: input.project.workspace_id,
    project_ids: projectIds,
    date_start: `${input.periodStart}T00:00:00`,
    date_end: `${nextDate(input.periodEnd)}T00:00:00`,
    timezone: input.timezone,
    template_path: template.storage_path,
    output_path: outputPath,
    employee_name: input.userName,
    project_name: input.project.name,
    report_type: input.report.reportType,
  };

  let generationResult: { employee_name?: string } = {};
  try {
    generationResult = await new Promise<{ employee_name?: string }>((resolve, reject) => {
      const child = execFile(/* turbopackIgnore: true */ pythonExecutable(repoRoot), ["-m", "app.generate_test_report"], { cwd: repoRoot, windowsHide: true }, (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr.trim().split(/\r?\n/).pop() || "Test report generation failed"));
        else {
          try { resolve(JSON.parse(_stdout.trim() || "{}")); }
          catch { reject(new Error("Report generator returned an invalid result")); }
        }
      });
      child.stdin?.end(JSON.stringify(payload));
    });
    await readFile(outputPath);
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }

  const start = new Date(`${input.periodStart}T00:00:00`);
  const firstThursday = new Date(start.getFullYear(), 0, 4);
  const week = Math.ceil((((start.getTime() - firstThursday.getTime()) / 86400000) + firstThursday.getDay() + 1) / 7);
  const values = {
    project: input.project.name,
    employee: generationResult.employee_name || input.userName,
    report_type: input.report.reportType,
    week: String(week),
    month: start.toLocaleString("en", { month: "long" }),
    year: String(start.getFullYear()),
    start_date: input.periodStart,
    end_date: input.periodEnd,
    period_start: input.periodStart,
    period_end: input.periodEnd,
  };
  const filename = safeFilename(input.report.filenamePattern, values, extension);
  const contentType = extension === ".xlsm"
    ? "application/vnd.ms-excel.sheet.macroEnabled.12"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const attachment = await attachmentFromFile(outputPath, filename, contentType);
  return { attachment, cleanup: () => rm(outputPath, { force: true }) };
}
