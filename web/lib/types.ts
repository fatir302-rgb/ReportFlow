export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  workspaceName: string | null;
  sourceProjectCount: number;
  createdAt: string;
  active: boolean;
};

export type ClockifyWorkspace = {
  id: string;
  name: string;
};

export type ClockifyProject = {
  id: string;
  name: string;
  archived?: boolean;
};

export type ReportType = "weekly" | "monthly";
export type ReportOutputFormat = "xlsx" | "xlsm" | "pdf";

export type ReportConfiguration = {
  id: string;
  projectId: string;
  reportType: ReportType;
  enabled: boolean;
  outputFormat: ReportOutputFormat;
  filenamePattern: string;
  sourceMode: "all" | "selected";
  sourceProjectIds: string[];
  templateId: string | null;
  templateOriginalName: string | null;
  templateExtension: string | null;
  templateStatus: string | null;
  templateVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportSchedule = {
  id: string;
  reportConfigurationId: string;
  enabled: boolean;
  runMode: "test" | "production";
  timezone: string;
  weeklyStartDay: number;
  weeklyEndDay: number;
  shiftStartTime: string;
  shiftEndTime: string;
  runDelayMinutes: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  nextRunAt: string | null;
  lastQueuedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRunQueueItem = {
  id: string;
  reportConfigurationId: string;
  scheduleId: string;
  projectId: string;
  projectName: string;
  reportType: ReportType;
  runKey: string;
  periodStart: string;
  periodEnd: string;
  sourceStartAt: string;
  sourceEndAt: string;
  scheduledFor: string;
  runMode: "test" | "production";
  status: "pending" | "processing" | "completed" | "failed";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryConnectionSummary = {
  id: string;
  provider: "gmail" | "outlook";
  displayName: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type ReportDeliveryConfiguration = {
  id: string;
  reportConfigurationId: string;
  enabled: boolean;
  connectionId: string;
  provider: "gmail" | "outlook";
  senderDisplayName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  attachReport: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryLog = {
  id: string;
  runId: string;
  provider: "gmail" | "outlook";
  sender: string | null;
  recipients: { to: string[]; cc: string[]; bcc: string[] };
  subject: string;
  status: "previewed" | "sending" | "sent" | "failed" | "skipped_test";
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperationalRunStatus =
  | "queued"
  | "processing"
  | "generated"
  | "sent"
  | "test"
  | "failed"
  | "delivery_failed";

export type ReportActivityItem = {
  id: string;
  projectId: string;
  projectName: string;
  reportType: ReportType;
  periodStart: string;
  periodEnd: string;
  scheduledFor: string;
  timezone: string;
  runMode: "test" | "production";
  queueStatus: "pending" | "processing" | "completed" | "failed";
  operationalStatus: OperationalRunStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  artifact: null | {
    filename: string;
    contentType: string;
    byteSize: number | null;
    createdAt: string;
  };
  delivery: null | {
    provider: "gmail" | "outlook";
    sender: string | null;
    status: "previewed" | "sending" | "sent" | "failed" | "skipped_test";
    subject: string;
    error: string | null;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ReportRunDetail = ReportActivityItem & {
  sourceStartAt: string | null;
  sourceEndAt: string | null;
  nextAttemptAt: string;
  manualRetryCount: number;
  lastManualRetryAt: string | null;
  deliveryRecipients: null | { to: string[]; cc: string[]; bcc: string[] };
  providerMessageId: string | null;
  resendAttempts: Array<{
    id: string;
    provider: "gmail" | "outlook";
    sender: string | null;
    recipients: { to: string[]; cc: string[]; bcc: string[] };
    subject: string;
    status: "sending" | "sent" | "failed";
    providerMessageId: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};


export type AIChangePath =
  | "project.name" | "project.description" | "project.sourceProjectIds"
  | "report.enabled" | "report.outputFormat" | "report.filenamePattern" | "report.sourceMode" | "report.sourceProjectIds"
  | "schedule.enabled" | "schedule.runMode" | "schedule.timezone" | "schedule.weeklyStartDay" | "schedule.weeklyEndDay" | "schedule.shiftStartTime" | "schedule.shiftEndTime" | "schedule.runDelayMinutes" | "schedule.maxAttempts" | "schedule.retryDelayMinutes"
  | "delivery.enabled" | "delivery.provider" | "delivery.to" | "delivery.cc" | "delivery.bcc" | "delivery.subjectTemplate" | "delivery.bodyTemplate" | "delivery.attachReport"
  | "template.upload";

export type AIChangeItem = {
  scope: "project" | "report" | "schedule" | "delivery" | "source_mapping" | "template";
  reportType: "none" | "weekly" | "monthly" | "both";
  action: "set" | "add" | "remove" | "replace" | "upload_required";
  path: AIChangePath;
  field: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
};

export type AIChangePlan = {
  intent: "answer" | "change_request" | "unsupported";
  answer: string;
  summary: string;
  explanation: string;
  riskLevel: "none" | "low" | "medium" | "high";
  requiresApproval: boolean;
  changes: AIChangeItem[];
};

export type AgentSnapshot = {
  projects: Array<{ id: string; name: string; description: string | null; workspaceName: string | null; sourceProjectCount: number }>;
  selectedProject: null | {
    id: string;
    name: string;
    description: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    sourceProjects: Array<{ id: string; name: string }>;
    availableDeliveryConnections?: Array<{ id: string; provider: "gmail" | "outlook"; displayName: string | null }>;
    weekly: Record<string, unknown>;
    monthly: Record<string, unknown>;
  };
};

export type AIConversationSummary = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AIConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  proposalId: string | null;
  createdAt: string;
};

export type AIChangeRequest = {
  id: string;
  conversationId: string;
  projectId: string | null;
  status: "draft" | "discarded" | "approved" | "applied" | "rejected";
  summary: string;
  explanation: string;
  riskLevel: "none" | "low" | "medium" | "high";
  plan: AIChangePlan;
  baseSnapshot: AgentSnapshot;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};


export type ConfigurationVersionSummary = {
  id: string;
  projectId: string;
  versionNumber: number;
  source: "baseline" | "ai_apply" | "manual_restore";
  summary: string;
  proposalId: string | null;
  restoredFromVersionId: string | null;
  createdAt: string;
};

export type GovernanceStatus = {
  proposalId: string;
  validationStatus: "not_run" | "valid" | "conflict" | "blocked";
  validation: Record<string, unknown> | null;
  testStatus: "not_run" | "passed" | "failed";
  test: Record<string, unknown> | null;
  validatedAt: string | null;
  testedAt: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  appliedVersionId: string | null;
};
