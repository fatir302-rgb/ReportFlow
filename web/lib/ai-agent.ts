import {
  getProject,
  getReportConfiguration,
  getReportSchedule,
  getReportDeliveryConfiguration,
  listProjects,
  listAIConversationMessages,
  listDeliveryConnections,
} from "@/lib/db";
import type { AIChangePlan, AgentSnapshot } from "@/lib/types";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "answer", "summary", "explanation", "riskLevel", "requiresApproval", "changes"],
  properties: {
    intent: { type: "string", enum: ["answer", "change_request", "unsupported"] },
    answer: { type: "string" },
    summary: { type: "string" },
    explanation: { type: "string" },
    riskLevel: { type: "string", enum: ["none", "low", "medium", "high"] },
    requiresApproval: { type: "boolean" },
    changes: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scope", "reportType", "action", "path", "field", "currentValue", "proposedValue", "reason"],
        properties: {
          scope: {
            type: "string",
            enum: ["project", "report", "schedule", "delivery", "source_mapping", "template"],
          },
          reportType: { type: "string", enum: ["none", "weekly", "monthly", "both"] },
          action: { type: "string", enum: ["set", "add", "remove", "replace", "upload_required"] },
          path: { type: "string", enum: [
            "project.name", "project.description", "project.sourceProjectIds",
            "report.enabled", "report.outputFormat", "report.filenamePattern", "report.sourceMode", "report.sourceProjectIds",
            "schedule.enabled", "schedule.runMode", "schedule.timezone", "schedule.weeklyStartDay", "schedule.weeklyEndDay", "schedule.shiftStartTime", "schedule.shiftEndTime", "schedule.runDelayMinutes", "schedule.maxAttempts", "schedule.retryDelayMinutes",
            "delivery.enabled", "delivery.provider", "delivery.to", "delivery.cc", "delivery.bcc", "delivery.subjectTemplate", "delivery.bodyTemplate", "delivery.attachReport",
            "template.upload"
          ] },
          field: { type: "string" },
          currentValue: { type: "string" },
          proposedValue: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

function cleanReport(config: any, schedule: any, delivery: any) {
  return {
    configured: Boolean(config),
    enabled: config?.enabled ?? null,
    outputFormat: config?.outputFormat ?? null,
    filenamePattern: config?.filenamePattern ?? null,
    sourceMode: config?.sourceMode ?? null,
    sourceProjectIds: config?.sourceProjectIds ?? [],
    template: config
      ? {
          id: config.templateId,
          name: config.templateOriginalName,
          extension: config.templateExtension,
          version: config.templateVersion,
        }
      : null,
    schedule: schedule
      ? {
          enabled: schedule.enabled,
          runMode: schedule.runMode,
          timezone: schedule.timezone,
          weeklyStartDay: schedule.weeklyStartDay,
          weeklyEndDay: schedule.weeklyEndDay,
          shiftStartTime: schedule.shiftStartTime,
          shiftEndTime: schedule.shiftEndTime,
          runDelayMinutes: schedule.runDelayMinutes,
          maxAttempts: schedule.maxAttempts,
          retryDelayMinutes: schedule.retryDelayMinutes,
        }
      : null,
    delivery: delivery
      ? {
          enabled: delivery.enabled,
          provider: delivery.provider,
          connectionId: delivery.connectionId,
          senderDisplayName: delivery.senderDisplayName,
          to: delivery.to,
          cc: delivery.cc,
          bcc: delivery.bcc,
          subjectTemplate: delivery.subjectTemplate,
          bodyTemplate: delivery.bodyTemplate,
          attachReport: delivery.attachReport,
        }
      : null,
  };
}

/**
 * Build the exact configuration snapshot the model is allowed to reason about.
 * Credentials and tokens are deliberately excluded from the model snapshot.
 */
export function buildAgentSnapshot(userId: string, projectId?: string | null): AgentSnapshot {
  const projects = listProjects(userId).map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    workspaceName: project.workspaceName,
    sourceProjectCount: project.sourceProjectCount,
  }));

  if (!projectId) return { projects, selectedProject: null };
  const project = getProject(userId, projectId);
  if (!project) throw new Error("Project not found");

  const weekly = getReportConfiguration(userId, projectId, "weekly");
  const monthly = getReportConfiguration(userId, projectId, "monthly");
  const weeklySchedule = getReportSchedule(userId, projectId, "weekly");
  const monthlySchedule = getReportSchedule(userId, projectId, "monthly");
  const weeklyDelivery = getReportDeliveryConfiguration(userId, projectId, "weekly");
  const monthlyDelivery = getReportDeliveryConfiguration(userId, projectId, "monthly");

  return {
    projects,
    selectedProject: {
      id: project.id,
      name: project.name,
      description: project.description,
      workspaceId: project.workspace_id,
      workspaceName: project.workspace_name,
      sourceProjects: project.sourceProjects,
      availableDeliveryConnections: listDeliveryConnections(userId).map((connection) => ({ id: connection.id, provider: connection.provider, displayName: connection.displayName })),
      weekly: cleanReport(weekly, weeklySchedule, weeklyDelivery),
      monthly: cleanReport(monthly, monthlySchedule, monthlyDelivery),
    },
  };
}

function outputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("The AI provider returned no structured output");
}

function systemInstructions() {
  return `You are ReportFlow's configuration planning agent. You can READ the supplied ReportFlow configuration snapshot and translate the user's natural-language request into either an answer or a proposed configuration change.

Safety and product rules:
1. You NEVER apply a change. You only describe a proposal. Production configuration stays unchanged until a later approval system applies a validated proposal.
2. Treat the supplied JSON snapshot as the source of truth. Do not invent projects, source project IDs, templates, recipients, schedules, or current values.
3. Never ask for or expose OAuth tokens, API keys, passwords, connection credentials, or secrets.
4. If a request is just asking what is configured, answer it with intent=answer and changes=[].
5. If the request would alter project/report/schedule/delivery/source/template configuration, use intent=change_request, requiresApproval=true, and list each concrete change separately.
6. If the request refers to a template/file that has not been uploaded, use scope=template and action=upload_required. Do not pretend you inspected an unavailable file.
7. If a request is ambiguous in a way that could change the wrong client/report/recipient/schedule, do not guess. Use intent=unsupported and explain what is missing.
8. For any change that could send a report to a different person, alter production scheduling, switch test to production, or broaden source data, use riskLevel=high. Delivery copy changes and ordinary formatting/config changes are medium or low as appropriate.
9. Every change MUST use the canonical path that exactly identifies the setting. Never invent a path.
10. proposedValue is machine-readable as well as human-reviewable: booleans are "true"/"false"; integers are decimal strings; times are HH:mm; output format is xlsx/xlsm/pdf; run mode is test/production; sourceMode is all/selected; recipient/source-project arrays are JSON arrays of strings; provider is gmail/outlook. Keep free text literal for names, filename patterns, subjects and bodies.
11. For source project arrays, proposedValue MUST contain source project IDs from the snapshot, not names. For delivery.provider, choose only a provider present in availableDeliveryConnections.
12. currentValue should use the same machine format as proposedValue where applicable.
13. template changes without an already uploaded template use path=template.upload and action=upload_required.
14. Do not write executable SQL, shell commands, or application code in the proposal.`;
}

export async function planWithAI(input: {
  userId: string;
  conversationId: string;
  projectId?: string | null;
  message: string;
  apiKey?: string;
}): Promise<{ plan: AIChangePlan; snapshot: AgentSnapshot; model: string }> {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI is not configured. Connect an OpenAI API key from the Assistant page.");
  const snapshot = buildAgentSnapshot(input.userId, input.projectId);
  const history = listAIConversationMessages(input.userId, input.conversationId, 10)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");

  const model = process.env.REPORTFLOW_AI_MODEL || "gpt-5.6-terra";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: systemInstructions(),
      input: `Current ReportFlow configuration snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nRecent conversation:\n${history || "(none)"}\n\nUser request:\n${input.message}`,
      text: {
        format: {
          type: "json_schema",
          name: "reportflow_change_plan",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}`;
    throw new Error(detail);
  }

  const parsed = JSON.parse(outputText(payload)) as AIChangePlan;
  if (parsed.intent === "change_request") parsed.requiresApproval = true;
  if (parsed.intent !== "change_request") parsed.changes = [];
  return { plan: parsed, snapshot, model };
}
