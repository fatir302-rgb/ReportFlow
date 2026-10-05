import { NextResponse } from "next/server";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { currentAppUser } from "@/lib/session";
import { addReportTemplate, deleteReportConfiguration, getProject, getReportConfiguration, saveReportConfiguration } from "@/lib/db";

const REPORT_TYPES = new Set(["weekly", "monthly"]);
const OUTPUT_FORMATS = new Set(["xlsx", "xlsm", "pdf"]);
const TEMPLATE_EXTENSIONS = new Set([".xlsx", ".xlsm"]);
const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

function isReportType(value: string): value is "weekly" | "monthly" {
  return REPORT_TYPES.has(value);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ report: getReportConfiguration(user.id, id, type) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const form = await request.formData();
  const enabled = String(form.get("enabled") ?? "true") !== "false";
  const outputFormat = String(form.get("outputFormat") ?? "xlsx").toLowerCase();
  const filenamePattern = String(form.get("filenamePattern") ?? "").trim();
  const sourceMode = String(form.get("sourceMode") ?? "all") === "selected" ? "selected" : "all";
  let sourceProjectIds: string[] = [];
  try { sourceProjectIds = JSON.parse(String(form.get("sourceProjectIds") ?? "[]")); } catch { sourceProjectIds = []; }
  if (!Array.isArray(sourceProjectIds)) sourceProjectIds = [];
  sourceProjectIds = sourceProjectIds.filter((value): value is string => typeof value === "string");
  if (!OUTPUT_FORMATS.has(outputFormat)) return NextResponse.json({ error: "Invalid output format" }, { status: 422 });
  if (!filenamePattern) return NextResponse.json({ error: "Filename pattern is required" }, { status: 422 });
  if (filenamePattern.length > 180) return NextResponse.json({ error: "Filename pattern is too long" }, { status: 422 });

  const existing = getReportConfiguration(user.id, id, type);
  const template = form.get("template");
  const hasNewTemplate = template instanceof File && template.size > 0;
  if (!existing?.templateId && !hasNewTemplate) {
    return NextResponse.json({ error: "Upload a template before saving this report" }, { status: 422 });
  }

  let templateBytes: Buffer | null = null;
  let extension = "";
  if (hasNewTemplate && template instanceof File) {
    if (template.size > MAX_TEMPLATE_BYTES) return NextResponse.json({ error: "Template must be 15 MB or smaller" }, { status: 422 });
    extension = path.extname(template.name).toLowerCase();
    if (!TEMPLATE_EXTENSIONS.has(extension)) return NextResponse.json({ error: "Template must be an .xlsx or .xlsm file" }, { status: 422 });
    templateBytes = Buffer.from(await template.arrayBuffer());
    if (templateBytes.length < 4 || templateBytes[0] !== 0x50 || templateBytes[1] !== 0x4b) {
      return NextResponse.json({ error: "The uploaded file is not a valid Excel workbook" }, { status: 422 });
    }
  }

  const configId = saveReportConfiguration({
    userId: user.id,
    projectId: id,
    reportType: type,
    enabled,
    outputFormat: outputFormat as "xlsx" | "xlsm" | "pdf",
    filenamePattern,
    sourceMode,
    sourceProjectIds,
  });
  if (!configId) return NextResponse.json({ error: sourceMode === "selected" ? "Select at least one data project" : "Project not found" }, { status: sourceMode === "selected" ? 422 : 404 });

  if (hasNewTemplate && template instanceof File && templateBytes) {
    const root = process.env.REPORTFLOW_TEMPLATE_DIR || "./data/templates";
    const storageDir = path.isAbsolute(root)
      ? root
      : path.join(/* turbopackIgnore: true */ process.cwd(), root);
    const directory = path.join(storageDir, user.id, id, type);
    await mkdir(directory, { recursive: true });
    const storageName = `${randomUUID()}${extension}`;
    const storagePath = path.join(directory, storageName);
    await writeFile(storagePath, templateBytes);

    addReportTemplate({
      userId: user.id,
      projectId: id,
      reportType: type,
      reportConfigurationId: configId,
      originalName: path.basename(template.name),
      storagePath,
      extension,
    });
  }

  return NextResponse.json({ report: getReportConfiguration(user.id, id, type) });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, type } = await params;
  if (!isReportType(type)) return NextResponse.json({ error: "Report type must be weekly or monthly" }, { status: 400 });
  if (!getProject(user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const deleted = deleteReportConfiguration(user.id, id, type);
  if (!deleted) return NextResponse.json({ error: "Report configuration not found" }, { status: 404 });
  await Promise.all(deleted.templatePaths.map((templatePath) => rm(templatePath, { force: true }).catch(() => undefined)));
  return NextResponse.json({ deleted: true });
}
