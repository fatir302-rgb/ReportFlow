import type { AIChangeItem, AIChangeRequest, AgentSnapshot } from "@/lib/types";
import {
  approveAIChangeRequest,
  createAuditLog,
  createConfigurationVersion,
  getAIChangeRequest,
  getConfigurationVersion,
  getProject,
  getProposalGovernance,
  getReportConfiguration,
  listConfigurationVersions,
  markAIChangeRequestApplied,
  runGovernedTransaction,
  saveProposalTest,
  saveProposalValidation,
  saveReportConfiguration,
  saveReportDeliveryConfiguration,
  saveReportSchedule,
  setActiveReportTemplate,
  updateProject,
} from "@/lib/db";
import { buildAgentSnapshot } from "@/lib/ai-agent";
import { isValidTimezone, nextOccurrences } from "@/lib/scheduling";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MutableSnapshot = AgentSnapshot;
type ReportKey = "weekly" | "monthly";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function reportTargets(change: AIChangeItem): ReportKey[] {
  if (change.reportType === "both") return ["weekly", "monthly"];
  if (change.reportType === "weekly" || change.reportType === "monthly") return [change.reportType];
  return [];
}

function parseArray(value: string): string[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("Expected a JSON array of strings.");
  return [...new Set(parsed.map((item) => item.trim()).filter(Boolean))];
}

function parseBoolean(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Expected true or false.");
}

function parseInteger(value: string) {
  if (!/^-?\d+$/.test(value)) throw new Error("Expected an integer.");
  return Number(value);
}

function parseValue(change: AIChangeItem): unknown {
  const p = change.path;
  if (["report.enabled", "schedule.enabled", "delivery.enabled", "delivery.attachReport"].includes(p)) return parseBoolean(change.proposedValue);
  if (["schedule.weeklyStartDay", "schedule.weeklyEndDay", "schedule.runDelayMinutes", "schedule.maxAttempts", "schedule.retryDelayMinutes"].includes(p)) return parseInteger(change.proposedValue);
  if (["project.sourceProjectIds", "report.sourceProjectIds", "delivery.to", "delivery.cc", "delivery.bcc"].includes(p)) return parseArray(change.proposedValue);
  return change.proposedValue;
}

function getProjectSnapshot(snapshot: AgentSnapshot) {
  if (!snapshot.selectedProject) throw new Error("A project-scoped proposal is required for Production changes.");
  return snapshot.selectedProject as any;
}

function readPath(snapshot: AgentSnapshot, reportType: ReportKey | null, path: string): unknown {
  const project = getProjectSnapshot(snapshot);
  if (path === "project.name") return project.name;
  if (path === "project.description") return project.description ?? "";
  if (path === "project.sourceProjectIds") return (project.sourceProjects || []).map((item: any) => item.id).sort();
  if (!reportType) return undefined;
  const report = project[reportType];
  if (!report) return undefined;
  if (path.startsWith("report.")) return report[path.slice("report.".length)];
  if (path.startsWith("schedule.")) return report.schedule?.[path.slice("schedule.".length)];
  if (path.startsWith("delivery.")) return report.delivery?.[path.slice("delivery.".length)];
  if (path === "template.upload") return report.template?.id ?? null;
  return undefined;
}

function writePath(snapshot: MutableSnapshot, reportType: ReportKey | null, change: AIChangeItem, value: unknown) {
  const project = getProjectSnapshot(snapshot);
  const path = change.path;
  if (path === "project.name") { project.name = value; return; }
  if (path === "project.description") { project.description = value; return; }
  if (path === "project.sourceProjectIds") {
    const ids = value as string[];
    const byId = new Map((project.sourceProjects || []).map((item: any) => [item.id, item]));
    // The assistant only knows currently mapped source projects; broadening beyond that requires the normal Project UI.
    project.sourceProjects = ids.map((id) => byId.get(id)).filter(Boolean);
    return;
  }
  if (!reportType) throw new Error(`Path ${path} requires a report type.`);
  const report = project[reportType];
  if (!report?.configured) throw new Error(`${reportType} report is not configured yet.`);
  if (path.startsWith("report.")) { report[path.slice(7)] = value; return; }
  if (path.startsWith("schedule.")) {
    if (!report.schedule) throw new Error(`${reportType} schedule is not configured yet.`);
    report.schedule[path.slice(9)] = value; return;
  }
  if (path.startsWith("delivery.")) {
    if (!report.delivery) throw new Error(`${reportType} delivery is not configured yet.`);
    const key = path.slice(9);
    report.delivery[key] = value;
    if (key === "provider") {
      const connection = (project.availableDeliveryConnections || []).find((item: any) => item.provider === value);
      if (!connection) throw new Error(`No connected ${value} sending account is available.`);
      report.delivery.connectionId = connection.id;
      report.delivery.senderDisplayName = connection.displayName;
    }
    return;
  }
  if (path === "template.upload") throw new Error("A template file must be uploaded before this change can be applied.");
  throw new Error(`Unsupported path: ${path}`);
}

function ensurePathMatchesScope(change: AIChangeItem) {
  const prefix = change.path.split(".")[0];
  const expected = change.scope === "source_mapping" ? (change.path.startsWith("project.") ? "project" : "report") : change.scope;
  if (change.scope === "template") return change.path === "template.upload";
  return prefix === expected;
}

function validateWholeSnapshot(snapshot: AgentSnapshot) {
  const project = getProjectSnapshot(snapshot);
  const errors: string[] = [];
  if (!String(project.name || "").trim()) errors.push("Project name cannot be empty.");
  const mappedIds = new Set((project.sourceProjects || []).map((item: any) => item.id));
  for (const type of ["weekly", "monthly"] as const) {
    const report = project[type];
    if (!report?.configured) continue;
    if (!["xlsx", "xlsm", "pdf"].includes(report.outputFormat)) errors.push(`${type}: unsupported output format.`);
    if (!String(report.filenamePattern || "").trim()) errors.push(`${type}: filename pattern cannot be empty.`);
    if (!["all", "selected"].includes(report.sourceMode)) errors.push(`${type}: invalid source mode.`);
    if (report.sourceMode === "selected") {
      if (!Array.isArray(report.sourceProjectIds) || report.sourceProjectIds.length === 0) errors.push(`${type}: selected source mode needs at least one Clockify project.`);
      for (const id of report.sourceProjectIds || []) if (!mappedIds.has(id)) errors.push(`${type}: source project ${id} is not mapped to this app project.`);
    }
    const schedule = report.schedule;
    if (schedule) {
      if (!isValidTimezone(schedule.timezone)) errors.push(`${type}: invalid timezone.`);
      if (!TIME_RE.test(schedule.shiftStartTime) || !TIME_RE.test(schedule.shiftEndTime)) errors.push(`${type}: shift times must use HH:mm.`);
      if (!Number.isInteger(schedule.weeklyStartDay) || schedule.weeklyStartDay < 0 || schedule.weeklyStartDay > 6) errors.push(`${type}: business week start day must be 0–6.`);
      if (!Number.isInteger(schedule.weeklyEndDay) || schedule.weeklyEndDay < 0 || schedule.weeklyEndDay > 6) errors.push(`${type}: business week end day must be 0–6.`);
      if (type === "weekly" && schedule.weeklyStartDay === schedule.weeklyEndDay) errors.push(`${type}: business week start and end days must differ.`);
      if (!Number.isInteger(schedule.runDelayMinutes) || schedule.runDelayMinutes < 0 || schedule.runDelayMinutes > 1440) errors.push(`${type}: run delay must be 0–1440 minutes.`);
      if (!Number.isInteger(schedule.maxAttempts) || schedule.maxAttempts < 1 || schedule.maxAttempts > 12) errors.push(`${type}: max attempts must be 1–12.`);
      if (!Number.isInteger(schedule.retryDelayMinutes) || schedule.retryDelayMinutes < 1 || schedule.retryDelayMinutes > 1440) errors.push(`${type}: retry delay must be 1–1440 minutes.`);
      if (!["test", "production"].includes(schedule.runMode)) errors.push(`${type}: invalid run mode.`);
    }
    const delivery = report.delivery;
    if (delivery) {
      if (!["gmail", "outlook"].includes(delivery.provider)) errors.push(`${type}: invalid email provider.`);
      const connection = (project.availableDeliveryConnections || []).find((item: any) => item.id === delivery.connectionId && item.provider === delivery.provider);
      if (!connection) errors.push(`${type}: selected sending connection is no longer available.`);
      for (const [kind, values] of [["to", delivery.to], ["cc", delivery.cc], ["bcc", delivery.bcc]] as const) {
        if (!Array.isArray(values) || values.some((email: string) => !EMAIL_RE.test(email))) errors.push(`${type}: ${kind.toUpperCase()} contains an invalid email address.`);
      }
      if (delivery.enabled && (!delivery.to || delivery.to.length === 0)) errors.push(`${type}: enabled delivery needs at least one TO recipient.`);
      if (!String(delivery.subjectTemplate || "").trim()) errors.push(`${type}: email subject cannot be empty.`);
    }
  }
  return errors;
}

export function evaluateProposal(userId: string, proposalId: string) {
  const proposal = getAIChangeRequest(userId, proposalId) as AIChangeRequest | null;
  if (!proposal) throw new Error("Proposal not found.");
  if (!proposal.projectId) throw new Error("Only project-scoped proposals can be applied in Stage 8.");
  if (!["draft", "approved"].includes(proposal.status)) throw new Error(`Proposal is ${proposal.status} and cannot be tested.`);

  const current = buildAgentSnapshot(userId, proposal.projectId);
  const base = proposal.baseSnapshot;
  const proposed = clone(current);
  const conflicts: Array<Record<string, unknown>> = [];
  const blocked: string[] = [];
  const changesPreview: Array<Record<string, unknown>> = [];

  for (const change of proposal.plan.changes) {
    if (!(change as any).path || !ensurePathMatchesScope(change)) {
      blocked.push(`${change.field}: this older/invalid proposal does not contain a safe canonical configuration path.`);
      continue;
    }
    if (change.action === "upload_required" || change.path === "template.upload") {
      blocked.push(`${change.field}: upload the required template first and create a new proposal.`);
      continue;
    }
    if (change.path === "report.outputFormat" && change.proposedValue === "pdf") {
      blocked.push(`${change.field}: PDF generation is not active in the report engine yet. Keep XLSX/XLSM until the PDF renderer is implemented.`);
      continue;
    }
    const targets = change.path.startsWith("project.") ? [null] : reportTargets(change);
    if (!targets.length) { blocked.push(`${change.field}: choose weekly, monthly, or both.`); continue; }
    for (const target of targets) {
      const baseValue = readPath(base, target, change.path);
      const currentValue = readPath(current, target, change.path);
      if (stable(baseValue) !== stable(currentValue)) {
        conflicts.push({ reportType: target || "project", path: change.path, expected: baseValue, current: currentValue });
        continue;
      }
      try {
        const parsed = parseValue(change);
        writePath(proposed, target, change, parsed);
        changesPreview.push({ reportType: target || "project", path: change.path, before: currentValue, after: parsed });
      } catch (error) {
        blocked.push(`${change.field}: ${error instanceof Error ? error.message : "invalid proposed value"}`);
      }
    }
  }

  const errors = blocked.length || conflicts.length ? [] : validateWholeSnapshot(proposed);
  const status: "valid" | "conflict" | "blocked" = conflicts.length ? "conflict" : (blocked.length || errors.length ? "blocked" : "valid");
  const validation = { status, conflicts, blocked: [...blocked, ...errors], changesPreview };
  saveProposalValidation({ userId, proposalId, status, validation });
  return { proposal, current, proposed, validation };
}

export function testProposal(userId: string, proposalId: string) {
  const evaluated = evaluateProposal(userId, proposalId);
  if (evaluated.validation.status !== "valid") {
    const test = { passed: false, reason: "Proposal validation did not pass.", validation: evaluated.validation };
    saveProposalTest({ userId, proposalId, status: "failed", test });
    return { ...evaluated, test };
  }
  const project = getProjectSnapshot(evaluated.proposed);
  const schedulePreview: Record<string, unknown> = {};
  try {
    for (const type of ["weekly", "monthly"] as const) {
      const schedule = project[type]?.schedule;
      if (!schedule?.enabled) continue;
      schedulePreview[type] = nextOccurrences({
        reportType: type,
        timezone: schedule.timezone,
        weeklyStartDay: schedule.weeklyStartDay,
        weeklyEndDay: schedule.weeklyEndDay,
        shiftStartTime: schedule.shiftStartTime,
        shiftEndTime: schedule.shiftEndTime,
        runDelayMinutes: schedule.runDelayMinutes,
      }, 3).map((item) => ({ runAt: item.runAt.toISOString(), periodStart: item.periodStart, periodEnd: item.periodEnd, sourceStartAt: item.sourceStartAt.toISOString(), sourceEndAt: item.sourceEndAt.toISOString() }));
    }
    const test = { passed: true, dryRun: true, note: "Configuration dry-run passed. Production was not modified.", changesPreview: evaluated.validation.changesPreview, schedulePreview };
    saveProposalTest({ userId, proposalId, status: "passed", test });
    createAuditLog({ userId, projectId: evaluated.proposal.projectId, action: "proposal_tested", entityType: "ai_change_request", entityId: proposalId, summary: `Tested proposal: ${evaluated.proposal.summary}`, metadata: { riskLevel: evaluated.proposal.riskLevel } });
    return { ...evaluated, test };
  } catch (error) {
    const test = { passed: false, reason: error instanceof Error ? error.message : "Dry-run failed." };
    saveProposalTest({ userId, proposalId, status: "failed", test });
    return { ...evaluated, test };
  }
}

export function approveProposal(userId: string, proposalId: string) {
  const evaluated = evaluateProposal(userId, proposalId);
  if (evaluated.validation.status !== "valid") throw new Error("Proposal is no longer valid. Run Test & Preview again.");
  const governance = getProposalGovernance(userId, proposalId);
  if (!governance || governance.testStatus !== "passed") throw new Error("Run Test & Preview successfully before approval.");
  if (!approveAIChangeRequest(userId, proposalId)) throw new Error("Proposal could not be approved.");
  createAuditLog({ userId, projectId: evaluated.proposal.projectId, action: "proposal_approved", entityType: "ai_change_request", entityId: proposalId, summary: `Approved proposal: ${evaluated.proposal.summary}`, metadata: { riskLevel: evaluated.proposal.riskLevel } });
  return true;
}

function applySnapshot(userId: string, snapshot: AgentSnapshot) {
  const project = getProjectSnapshot(snapshot);
  const existing = getProject(userId, project.id);
  if (!existing) throw new Error("Project not found.");
  if (!updateProject({
    userId,
    projectId: project.id,
    name: project.name,
    description: project.description,
    workspaceId: project.workspaceId || existing.workspace_id,
    workspaceName: project.workspaceName || existing.workspace_name,
    sourceProjects: project.sourceProjects,
  })) throw new Error("Could not update project.");

  for (const type of ["weekly", "monthly"] as const) {
    const desired = project[type];
    if (!desired?.configured) continue;
    const currentConfig = getReportConfiguration(userId, project.id, type);
    if (!currentConfig) throw new Error(`${type} report is no longer configured.`);
    const configId = saveReportConfiguration({
      userId, projectId: project.id, reportType: type,
      enabled: Boolean(desired.enabled), outputFormat: desired.outputFormat,
      filenamePattern: desired.filenamePattern, sourceMode: desired.sourceMode,
      sourceProjectIds: desired.sourceProjectIds || [],
    });
    if (!configId) throw new Error(`Could not save ${type} report.`);
    if (!setActiveReportTemplate({ userId, projectId: project.id, reportType: type, templateId: desired.template?.id || null })) {
      throw new Error(`Could not restore ${type} template version.`);
    }
    if (desired.schedule) {
      const saved = saveReportSchedule({ userId, projectId: project.id, reportType: type, ...desired.schedule });
      if (!saved) throw new Error(`Could not save ${type} schedule.`);
    }
    if (desired.delivery) {
      const saved = saveReportDeliveryConfiguration({
        userId, projectId: project.id, reportType: type, enabled: Boolean(desired.delivery.enabled),
        connectionId: desired.delivery.connectionId, to: desired.delivery.to || [], cc: desired.delivery.cc || [], bcc: desired.delivery.bcc || [],
        subjectTemplate: desired.delivery.subjectTemplate, bodyTemplate: desired.delivery.bodyTemplate, attachReport: Boolean(desired.delivery.attachReport),
      });
      if (!saved) throw new Error(`Could not save ${type} delivery configuration.`);
    }
  }
}

function ensureBaselineVersion(userId: string, projectId: string, current: AgentSnapshot) {
  const versions = listConfigurationVersions(userId, projectId);
  if (versions.length) return versions[0];
  return createConfigurationVersion({ userId, projectId, source: "baseline", summary: "Baseline before governed changes", snapshot: current as unknown as Record<string, unknown> });
}

export function applyApprovedProposal(userId: string, proposalId: string) {
  const proposal = getAIChangeRequest(userId, proposalId) as AIChangeRequest | null;
  if (!proposal || proposal.status !== "approved" || !proposal.projectId) throw new Error("Proposal must be approved before it can be applied.");
  const evaluated = evaluateProposal(userId, proposalId);
  if (evaluated.validation.status !== "valid") throw new Error("Production configuration changed after approval. Test and approve a fresh proposal.");
  const governance = getProposalGovernance(userId, proposalId);
  if (!governance || governance.testStatus !== "passed") throw new Error("A successful dry-run is required before apply.");

  return runGovernedTransaction(() => {
    ensureBaselineVersion(userId, proposal.projectId!, evaluated.current);
    applySnapshot(userId, evaluated.proposed);
    const finalSnapshot = buildAgentSnapshot(userId, proposal.projectId);
    const version = createConfigurationVersion({ userId, projectId: proposal.projectId!, source: "ai_apply", summary: proposal.summary, snapshot: finalSnapshot as unknown as Record<string, unknown>, proposalId });
    if (!markAIChangeRequestApplied(userId, proposalId, version.id)) throw new Error("Could not finalize proposal state.");
    createAuditLog({ userId, projectId: proposal.projectId, action: "proposal_applied", entityType: "configuration_version", entityId: version.id, summary: `Applied ${proposal.summary} as Version ${version.versionNumber}`, metadata: { proposalId, versionNumber: version.versionNumber, riskLevel: proposal.riskLevel } });
    return version;
  });
}

export function restoreConfigurationVersion(userId: string, versionId: string) {
  const target = getConfigurationVersion(userId, versionId);
  if (!target) throw new Error("Configuration version not found.");
  const snapshot = target.snapshot as AgentSnapshot;
  const project = getProjectSnapshot(snapshot);
  if (project.id !== target.projectId) throw new Error("Version snapshot is invalid.");
  const validationErrors = validateWholeSnapshot(snapshot);
  if (validationErrors.length) throw new Error(`Cannot restore this version: ${validationErrors.join(" ")}`);

  return runGovernedTransaction(() => {
    const current = buildAgentSnapshot(userId, target.projectId);
    ensureBaselineVersion(userId, target.projectId, current);
    applySnapshot(userId, snapshot);
    const finalSnapshot = buildAgentSnapshot(userId, target.projectId);
    const version = createConfigurationVersion({
      userId, projectId: target.projectId, source: "manual_restore",
      summary: `Restored from Version ${target.versionNumber}`, snapshot: finalSnapshot as unknown as Record<string, unknown>, restoredFromVersionId: target.id,
    });
    createAuditLog({ userId, projectId: target.projectId, action: "version_restored", entityType: "configuration_version", entityId: version.id,
      summary: `Restored Version ${target.versionNumber} as new Version ${version.versionNumber}`, metadata: { restoredFromVersionId: target.id, restoredFromVersionNumber: target.versionNumber, newVersionNumber: version.versionNumber } });
    return version;
  });
}
