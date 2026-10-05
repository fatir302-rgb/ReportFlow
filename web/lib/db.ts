import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AppUser, ProjectSummary, ReportConfiguration, ReportSchedule, ReportRunQueueItem, ReportDeliveryConfiguration, DeliveryConnectionSummary, DeliveryLog, ReportActivityItem, ReportRunDetail, OperationalRunStatus } from "@/lib/types";
import { nextOccurrence, occurrenceAtOrBeforeNextRun, type ScheduleRule } from "@/lib/scheduling";

const configuredPath = process.env.REPORTFLOW_DB_PATH || "./data/reportflow.sqlite";
const dbPath = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.join(/* turbopackIgnore: true */ process.cwd(), configuredPath);
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT,
  credentials_enc TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  workspace_id TEXT,
  workspace_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_source_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_project_id TEXT NOT NULL,
  source_project_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, source_project_id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_source_project_parent ON project_source_projects(project_id);
`);

// Lightweight migrations for databases created by earlier ReportFlow stages.
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "display_name")) {
  db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
}
const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
if (!projectColumns.some((column) => column.name === "active")) {
  db.exec("ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}

function now() {
  return new Date().toISOString();
}

export function upsertOAuthUser(input: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: string;
  providerAccountId: string;
}): AppUser {
  const normalizedEmail = input.email.trim().toLowerCase();
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail) as any;
  const timestamp = now();

  if (!user) {
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, email, name, image, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, normalizedEmail, input.name ?? null, input.image ?? null, timestamp, timestamp);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  } else {
    db.prepare("UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image), updated_at = ? WHERE id = ?")
      .run(input.name ?? null, input.image ?? null, timestamp, user.id);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as any;
  }

  const identity = db.prepare(
    "SELECT id, user_id FROM auth_identities WHERE provider = ? AND provider_account_id = ?"
  ).get(input.provider, input.providerAccountId) as any;

  if (!identity) {
    db.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_account_id, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), user.id, input.provider, input.providerAccountId, timestamp);
  } else if (identity.user_id !== user.id) {
    throw new Error("This login identity is already linked to another ReportFlow user.");
  }

  return { id: user.id, email: user.email, name: user.display_name || user.name, image: user.image };
}

export function getUserByEmail(email: string): AppUser | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as any;
  return row ? { id: row.id, email: row.email, name: row.display_name || row.name, image: row.image } : null;
}

export function updateUserDisplayName(userId: string, displayName: string): AppUser | null {
  const value = displayName.trim();
  const result = db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(value, now(), userId);
  if (!result.changes) return null;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
  return { id: row.id, email: row.email, name: row.display_name || row.name, image: row.image };
}

export function ensureDevUser(): AppUser {
  const email = "preview@reportflow.local";
  const existing = getUserByEmail(email);
  if (existing) return existing;
  const timestamp = now();
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, email, name, image, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, email, "Preview User", null, timestamp, timestamp);
  return { id, email, name: "Preview User", image: null };
}

export function saveConnection(input: {
  userId: string;
  provider: string;
  displayName: string;
  credentialsEnc: string;
  metadata?: Record<string, unknown>;
}) {
  const existing = db.prepare("SELECT id FROM connections WHERE user_id = ? AND provider = ?")
    .get(input.userId, input.provider) as any;
  const timestamp = now();
  if (existing) {
    db.prepare(`UPDATE connections
      SET display_name = ?, credentials_enc = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?`)
      .run(input.displayName, input.credentialsEnc, JSON.stringify(input.metadata ?? {}), timestamp, existing.id);
    return existing.id as string;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO connections
    (id, user_id, provider, display_name, credentials_enc, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.userId, input.provider, input.displayName, input.credentialsEnc,
      JSON.stringify(input.metadata ?? {}), timestamp, timestamp);
  return id;
}

export function getConnection(userId: string, provider: string) {
  return db.prepare("SELECT * FROM connections WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as any | undefined;
}

export function listConnections(userId: string) {
  return db.prepare(`SELECT id, provider, display_name, metadata_json, created_at, updated_at
    FROM connections WHERE user_id = ? ORDER BY provider`).all(userId) as any[];
}

export function createProject(input: {
  userId: string;
  name: string;
  description?: string | null;
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  sourceProjects: Array<{ id: string; name: string }>;
}) {
  const id = randomUUID();
  const timestamp = now();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO projects
      (id, user_id, name, description, connection_id, workspace_id, workspace_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.userId, input.name.trim(), input.description?.trim() || null,
        input.connectionId, input.workspaceId, input.workspaceName, timestamp, timestamp);
    const insertSource = db.prepare(`INSERT INTO project_source_projects
      (id, project_id, source_project_id, source_project_name, created_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (const source of input.sourceProjects) {
      insertSource.run(randomUUID(), id, source.id, source.name, timestamp);
    }
  });
  tx();
  return id;
}

export function listProjects(userId: string): ProjectSummary[] {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.description, p.workspace_name, p.active,
           p.created_at, COUNT(s.id) AS source_project_count
    FROM projects p
    LEFT JOIN project_source_projects s ON s.project_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all(userId) as any[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    workspaceName: row.workspace_name,
    sourceProjectCount: Number(row.source_project_count),
    createdAt: row.created_at,
    active: Boolean(row.active),
  }));
}

export function setProjectActive(userId: string, projectId: string, active: boolean) {
  const result = db.prepare("UPDATE projects SET active = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(active ? 1 : 0, now(), projectId, userId);
  return result.changes > 0;
}

export function getProject(userId: string, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(projectId, userId) as any | undefined;
  if (!project) return null;
  const sourceProjects = db.prepare(`SELECT source_project_id AS id, source_project_name AS name
    FROM project_source_projects WHERE project_id = ? ORDER BY source_project_name`)
    .all(projectId) as Array<{ id: string; name: string }>;
  return { ...project, sourceProjects };
}

export function updateProject(input: {
  userId: string;
  projectId: string;
  name: string;
  description?: string | null;
  workspaceId: string;
  workspaceName: string;
  sourceProjects: Array<{ id: string; name: string }>;
}) {
  const existing = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .get(input.projectId, input.userId) as any | undefined;
  if (!existing) return false;
  const timestamp = now();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE projects SET name = ?, description = ?, workspace_id = ?, workspace_name = ?, updated_at = ?
                WHERE id = ? AND user_id = ?`)
      .run(input.name.trim(), input.description?.trim() || null, input.workspaceId, input.workspaceName,
        timestamp, input.projectId, input.userId);
    db.prepare("DELETE FROM project_source_projects WHERE project_id = ?").run(input.projectId);
    const insertSource = db.prepare(`INSERT INTO project_source_projects
      (id, project_id, source_project_id, source_project_name, created_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (const source of input.sourceProjects) {
      insertSource.run(randomUUID(), input.projectId, source.id, source.name, timestamp);
    }
  });
  tx();
  return true;
}

export function deleteProject(userId: string, projectId: string) {
  const templatePaths = (db.prepare(`
    SELECT templates.storage_path
    FROM report_templates templates
    JOIN report_configurations reports ON reports.id = templates.report_configuration_id
    JOIN projects ON projects.id = reports.project_id
    WHERE projects.id = ? AND projects.user_id = ?
  `).all(projectId, userId) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  const result = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(projectId, userId);
  return result.changes > 0 ? { templatePaths } : null;
}

// Stage 3: per-project weekly/monthly report configuration and template history.
db.exec(`
CREATE TABLE IF NOT EXISTS report_configurations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK(report_type IN ('weekly','monthly')),
  enabled INTEGER NOT NULL DEFAULT 1,
  output_format TEXT NOT NULL DEFAULT 'xlsx' CHECK(output_format IN ('xlsx','xlsm','pdf')),
  filename_pattern TEXT NOT NULL,
  source_mode TEXT NOT NULL DEFAULT 'all' CHECK(source_mode IN ('all','selected')),
  active_template_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, report_type)
);

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  report_configuration_id TEXT NOT NULL REFERENCES report_configurations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  extension TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  analysis_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(report_configuration_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_report_configs_project ON report_configurations(project_id);
CREATE TABLE IF NOT EXISTS report_source_projects (
  id TEXT PRIMARY KEY,
  report_configuration_id TEXT NOT NULL REFERENCES report_configurations(id) ON DELETE CASCADE,
  source_project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(report_configuration_id, source_project_id)
);

CREATE INDEX IF NOT EXISTS idx_report_templates_config ON report_templates(report_configuration_id);
CREATE INDEX IF NOT EXISTS idx_report_sources_config ON report_source_projects(report_configuration_id);
`);

const reportConfigColumns = db.prepare("PRAGMA table_info(report_configurations)").all() as Array<{ name: string }>;
if (!reportConfigColumns.some((column) => column.name === "source_mode")) {
  db.exec("ALTER TABLE report_configurations ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'all'");
}

export function getReportConfiguration(userId: string, projectId: string, reportType: "weekly" | "monthly"): ReportConfiguration | null {
  const row = db.prepare(`
    SELECT rc.*, rt.original_name AS template_original_name, rt.extension AS template_extension,
           rt.status AS template_status, rt.version_number AS template_version
    FROM report_configurations rc
    JOIN projects p ON p.id = rc.project_id
    LEFT JOIN report_templates rt ON rt.id = rc.active_template_id
    WHERE rc.project_id = ? AND rc.report_type = ? AND p.user_id = ?
  `).get(projectId, reportType, userId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    reportType: row.report_type as "weekly" | "monthly",
    enabled: Boolean(row.enabled),
    outputFormat: row.output_format as "xlsx" | "xlsm" | "pdf",
    filenamePattern: row.filename_pattern,
    sourceMode: row.source_mode === "selected" ? "selected" : "all",
    sourceProjectIds: (db.prepare("SELECT source_project_id FROM report_source_projects WHERE report_configuration_id = ? ORDER BY source_project_id").all(row.id) as Array<{ source_project_id: string }>).map((item) => item.source_project_id),
    templateId: row.active_template_id,
    templateOriginalName: row.template_original_name,
    templateExtension: row.template_extension,
    templateStatus: row.template_status,
    templateVersion: row.template_version == null ? null : Number(row.template_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listReportConfigurations(userId: string, projectId: string) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any | undefined;
  if (!project) return [];
  return (["weekly", "monthly"] as const).map((type) => getReportConfiguration(userId, projectId, type));
}

export function deleteReportConfiguration(userId: string, projectId: string, reportType: "weekly" | "monthly") {
  const report = db.prepare(`SELECT rc.id FROM report_configurations rc
    JOIN projects p ON p.id = rc.project_id
    WHERE rc.project_id = ? AND rc.report_type = ? AND p.user_id = ?`)
    .get(projectId, reportType, userId) as { id: string } | undefined;
  if (!report) return null;
  const templatePaths = (db.prepare("SELECT storage_path FROM report_templates WHERE report_configuration_id = ?")
    .all(report.id) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  db.prepare("DELETE FROM report_configurations WHERE id = ?").run(report.id);
  return { templatePaths };
}

export function saveReportConfiguration(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
  enabled: boolean;
  outputFormat: "xlsx" | "xlsm" | "pdf";
  filenamePattern: string;
  sourceMode: "all" | "selected";
  sourceProjectIds: string[];
}) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(input.projectId, input.userId) as any | undefined;
  if (!project) return null;

  const allowedSources = new Set((db.prepare("SELECT source_project_id FROM project_source_projects WHERE project_id = ?")
    .all(input.projectId) as Array<{ source_project_id: string }>).map((row) => row.source_project_id));
  const selectedSources = [...new Set(input.sourceProjectIds)].filter((id) => allowedSources.has(id));
  if (input.sourceMode === "selected" && selectedSources.length === 0) return null;

  const existing = db.prepare("SELECT id FROM report_configurations WHERE project_id = ? AND report_type = ?")
    .get(input.projectId, input.reportType) as any | undefined;
  const timestamp = now();
  const id = existing?.id as string | undefined || randomUUID();
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`UPDATE report_configurations SET enabled = ?, output_format = ?, filename_pattern = ?, source_mode = ?, updated_at = ? WHERE id = ?`)
        .run(input.enabled ? 1 : 0, input.outputFormat, input.filenamePattern, input.sourceMode, timestamp, id);
    } else {
      db.prepare(`INSERT INTO report_configurations
        (id, project_id, report_type, enabled, output_format, filename_pattern, source_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.projectId, input.reportType, input.enabled ? 1 : 0, input.outputFormat,
          input.filenamePattern, input.sourceMode, timestamp, timestamp);
    }
    db.prepare("DELETE FROM report_source_projects WHERE report_configuration_id = ?").run(id);
    if (input.sourceMode === "selected") {
      const insert = db.prepare(`INSERT INTO report_source_projects (id, report_configuration_id, source_project_id, created_at) VALUES (?, ?, ?, ?)`);
      for (const sourceId of selectedSources) insert.run(randomUUID(), id, sourceId, timestamp);
    }
  });
  tx();
  return id;
}

export function addReportTemplate(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
  reportConfigurationId: string;
  originalName: string;
  storagePath: string;
  extension: string;
  analysis?: Record<string, unknown> | null;
}) {
  const owned = db.prepare(`SELECT rc.id FROM report_configurations rc JOIN projects p ON p.id = rc.project_id
    WHERE rc.id = ? AND rc.project_id = ? AND rc.report_type = ? AND p.user_id = ?`)
    .get(input.reportConfigurationId, input.projectId, input.reportType, input.userId) as any | undefined;
  if (!owned) return null;
  const versionRow = db.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM report_templates WHERE report_configuration_id = ?")
    .get(input.reportConfigurationId) as any;
  const version = Number(versionRow.next_version);
  const id = randomUUID();
  const timestamp = now();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO report_templates
      (id, report_configuration_id, version_number, original_name, storage_path, extension, status, analysis_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.reportConfigurationId, version, input.originalName, input.storagePath, input.extension,
        input.analysis ? "analyzed" : "uploaded", input.analysis ? JSON.stringify(input.analysis) : null, timestamp);
    db.prepare("UPDATE report_configurations SET active_template_id = ?, updated_at = ? WHERE id = ?")
      .run(id, timestamp, input.reportConfigurationId);
  });
  tx();
  return { id, version };
}

export function getReportTemplate(userId: string, templateId: string) {
  return db.prepare(`SELECT rt.* FROM report_templates rt
    JOIN report_configurations rc ON rc.id = rt.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    WHERE rt.id = ? AND p.user_id = ?`).get(templateId, userId) as any | undefined;
}

export function listAllReports(userId: string) {
  return db.prepare(`
    SELECT p.id AS project_id, p.name AS project_name, rc.report_type, rc.enabled,
           rc.output_format, rc.updated_at, rt.original_name AS template_original_name,
           rt.version_number AS template_version, rs.enabled AS schedule_enabled,
           rs.timezone AS schedule_timezone, rs.next_run_at AS next_run_at
    FROM projects p
    LEFT JOIN report_configurations rc ON rc.project_id = p.id
    LEFT JOIN report_templates rt ON rt.id = rc.active_template_id
    LEFT JOIN report_schedules rs ON rs.report_configuration_id = rc.id
    WHERE p.user_id = ?
    ORDER BY p.name COLLATE NOCASE, rc.report_type
  `).all(userId) as any[];
}


// Stage 4: shift-aware scheduling and a deduplicated execution queue.
db.exec(`
CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY,
  report_configuration_id TEXT NOT NULL UNIQUE REFERENCES report_configurations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  run_mode TEXT NOT NULL DEFAULT 'test' CHECK(run_mode IN ('test','production')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  weekly_start_day INTEGER NOT NULL DEFAULT 1 CHECK(weekly_start_day BETWEEN 0 AND 6),
  weekly_end_day INTEGER NOT NULL DEFAULT 5 CHECK(weekly_end_day BETWEEN 0 AND 6),
  shift_start_time TEXT NOT NULL DEFAULT '09:00',
  shift_end_time TEXT NOT NULL DEFAULT '17:00',
  run_delay_minutes INTEGER NOT NULL DEFAULT 5 CHECK(run_delay_minutes BETWEEN 0 AND 1440),
  max_attempts INTEGER NOT NULL DEFAULT 4 CHECK(max_attempts BETWEEN 1 AND 12),
  retry_delay_minutes INTEGER NOT NULL DEFAULT 15 CHECK(retry_delay_minutes BETWEEN 1 AND 1440),
  next_run_at TEXT,
  last_queued_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_run_queue (
  id TEXT PRIMARY KEY,
  report_configuration_id TEXT NOT NULL REFERENCES report_configurations(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  run_key TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  source_start_at TEXT,
  source_end_at TEXT,
  scheduled_for TEXT NOT NULL,
  run_mode TEXT NOT NULL DEFAULT 'test' CHECK(run_mode IN ('test','production')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  retry_delay_minutes INTEGER NOT NULL DEFAULT 15,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run ON report_schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_report_run_queue_due ON report_run_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_report_run_queue_config ON report_run_queue(report_configuration_id, scheduled_for);
`);

const scheduleColumns = db.prepare("PRAGMA table_info(report_schedules)").all() as Array<{ name: string }>;
if (!scheduleColumns.some((column) => column.name === "run_mode")) {
  db.exec("ALTER TABLE report_schedules ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'test'");
}
if (!scheduleColumns.some((column) => column.name === "weekly_start_day")) {
  db.exec("ALTER TABLE report_schedules ADD COLUMN weekly_start_day INTEGER");
}
const queueColumns = db.prepare("PRAGMA table_info(report_run_queue)").all() as Array<{ name: string }>;
if (!queueColumns.some((column) => column.name === "run_mode")) {
  db.exec("ALTER TABLE report_run_queue ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'test'");
}
if (!queueColumns.some((column) => column.name === "source_start_at")) {
  db.exec("ALTER TABLE report_run_queue ADD COLUMN source_start_at TEXT");
}
if (!queueColumns.some((column) => column.name === "source_end_at")) {
  db.exec("ALTER TABLE report_run_queue ADD COLUMN source_end_at TEXT");
}

function scheduleFromRow(row: any): ReportSchedule {
  return {
    id: row.id,
    reportConfigurationId: row.report_configuration_id,
    enabled: Boolean(row.enabled),
    runMode: row.run_mode === "production" ? "production" : "test",
    timezone: row.timezone,
    weeklyStartDay: row.weekly_start_day == null ? (Number(row.weekly_end_day) + 3) % 7 : Number(row.weekly_start_day),
    weeklyEndDay: Number(row.weekly_end_day),
    shiftStartTime: row.shift_start_time,
    shiftEndTime: row.shift_end_time,
    runDelayMinutes: Number(row.run_delay_minutes),
    maxAttempts: Number(row.max_attempts),
    retryDelayMinutes: Number(row.retry_delay_minutes),
    nextRunAt: row.next_run_at,
    lastQueuedAt: row.last_queued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleRuleFromRow(row: any): ScheduleRule {
  return {
    reportType: row.report_type,
    timezone: row.timezone,
    weeklyStartDay: row.weekly_start_day == null ? (Number(row.weekly_end_day) + 3) % 7 : Number(row.weekly_start_day),
    weeklyEndDay: Number(row.weekly_end_day),
    shiftStartTime: row.shift_start_time,
    shiftEndTime: row.shift_end_time,
    runDelayMinutes: Number(row.run_delay_minutes),
  };
}

export function getReportSchedule(userId: string, projectId: string, reportType: "weekly" | "monthly"): ReportSchedule | null {
  const row = db.prepare(`
    SELECT rs.* FROM report_schedules rs
    JOIN report_configurations rc ON rc.id = rs.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?
  `).get(userId, projectId, reportType) as any | undefined;
  return row ? scheduleFromRow(row) : null;
}

export function saveReportSchedule(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
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
}) {
  const config = db.prepare(`
    SELECT rc.id, rc.report_type FROM report_configurations rc
    JOIN projects p ON p.id = rc.project_id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?
  `).get(input.userId, input.projectId, input.reportType) as any | undefined;
  if (!config) return null;

  const existing = db.prepare("SELECT id FROM report_schedules WHERE report_configuration_id = ?")
    .get(config.id) as any | undefined;
  const id = existing?.id || randomUUID();
  const timestamp = now();
  const rule: ScheduleRule = {
    reportType: input.reportType,
    timezone: input.timezone,
    weeklyStartDay: input.weeklyStartDay,
    weeklyEndDay: input.weeklyEndDay,
    shiftStartTime: input.shiftStartTime,
    shiftEndTime: input.shiftEndTime,
    runDelayMinutes: input.runDelayMinutes,
  };
  const nextRunAt = input.enabled ? nextOccurrence(rule, new Date()).runAt.toISOString() : null;

  if (existing) {
    db.prepare(`UPDATE report_schedules SET enabled = ?, run_mode = ?, timezone = ?, weekly_start_day = ?, weekly_end_day = ?,
      shift_start_time = ?, shift_end_time = ?, run_delay_minutes = ?, max_attempts = ?,
      retry_delay_minutes = ?, next_run_at = ?, updated_at = ? WHERE id = ?`)
      .run(input.enabled ? 1 : 0, input.runMode, input.timezone, input.weeklyStartDay, input.weeklyEndDay, input.shiftStartTime,
        input.shiftEndTime, input.runDelayMinutes, input.maxAttempts, input.retryDelayMinutes,
        nextRunAt, timestamp, id);
  } else {
    db.prepare(`INSERT INTO report_schedules
      (id, report_configuration_id, enabled, run_mode, timezone, weekly_start_day, weekly_end_day, shift_start_time,
       shift_end_time, run_delay_minutes, max_attempts, retry_delay_minutes, next_run_at,
       last_queued_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(id, config.id, input.enabled ? 1 : 0, input.runMode, input.timezone, input.weeklyStartDay, input.weeklyEndDay,
        input.shiftStartTime, input.shiftEndTime, input.runDelayMinutes, input.maxAttempts,
        input.retryDelayMinutes, nextRunAt, timestamp, timestamp);
  }
  return getReportSchedule(input.userId, input.projectId, input.reportType);
}

/**
 * Queue all report occurrences whose persisted next_run_at is due. The unique run_key makes this
 * safe to call repeatedly from a cron service. A bounded catch-up loop queues missed periods after downtime.
 */
export function enqueueDueReportRuns(at: Date = new Date(), catchUpLimitPerSchedule = 12) {
  const dueSchedules = db.prepare(`
    SELECT rs.*, rc.report_type, rc.enabled AS report_enabled, rc.active_template_id,
           p.id AS project_id, p.name AS project_name
    FROM report_schedules rs
    JOIN report_configurations rc ON rc.id = rs.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    WHERE p.active = 1 AND rs.enabled = 1 AND rc.enabled = 1 AND rc.active_template_id IS NOT NULL
      AND rs.next_run_at IS NOT NULL AND rs.next_run_at <= ?
    ORDER BY rs.next_run_at ASC
  `).all(at.toISOString()) as any[];

  let queued = 0;
  const tx = db.transaction(() => {
    for (const schedule of dueSchedules) {
      const rule = scheduleRuleFromRow(schedule);
      let nextRun = new Date(schedule.next_run_at);
      let caughtUp = 0;
      while (nextRun.getTime() <= at.getTime() && caughtUp < catchUpLimitPerSchedule) {
        const occurrence = occurrenceAtOrBeforeNextRun(rule, nextRun);
        const runKey = `${schedule.report_configuration_id}:${occurrence.periodStart}:${occurrence.periodEnd}`;
        const timestamp = now();
        const result = db.prepare(`INSERT OR IGNORE INTO report_run_queue
          (id, report_configuration_id, schedule_id, run_key, period_start, period_end, source_start_at, source_end_at,
           scheduled_for, run_mode, status, attempt_count, max_attempts, retry_delay_minutes,
           next_attempt_at, last_error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, NULL, ?, ?)`)
          .run(randomUUID(), schedule.report_configuration_id, schedule.id, runKey,
            occurrence.periodStart, occurrence.periodEnd, occurrence.sourceStartAt.toISOString(), occurrence.sourceEndAt.toISOString(),
            occurrence.runAt.toISOString(), schedule.run_mode,
            schedule.max_attempts, schedule.retry_delay_minutes, occurrence.runAt.toISOString(),
            timestamp, timestamp);
        if (result.changes > 0) queued += 1;
        const following = nextOccurrence(rule, new Date(occurrence.runAt.getTime() + 1000));
        nextRun = following.runAt;
        caughtUp += 1;
      }
      db.prepare("UPDATE report_schedules SET next_run_at = ?, last_queued_at = ?, updated_at = ? WHERE id = ?")
        .run(nextRun.toISOString(), at.toISOString(), now(), schedule.id);
    }
  });
  tx();
  return { schedulesChecked: dueSchedules.length, runsQueued: queued };
}

export function listDueReportRuns(at: Date = new Date(), limit = 50): ReportRunQueueItem[] {
  const rows = db.prepare(`
    SELECT rrq.*, rc.report_type, p.id AS project_id, p.name AS project_name
    FROM report_run_queue rrq
    JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    WHERE p.active = 1 AND rrq.status = 'pending' AND rrq.next_attempt_at <= ?
    ORDER BY rrq.next_attempt_at ASC
    LIMIT ?
  `).all(at.toISOString(), Math.max(1, Math.min(limit, 200))) as any[];
  return rows.map((row) => ({
    id: row.id,
    reportConfigurationId: row.report_configuration_id,
    scheduleId: row.schedule_id,
    projectId: row.project_id,
    projectName: row.project_name,
    reportType: row.report_type,
    runKey: row.run_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    sourceStartAt: row.source_start_at,
    sourceEndAt: row.source_end_at,
    scheduledFor: row.scheduled_for,
    runMode: row.run_mode === "production" ? "production" : "test",
    status: row.status,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getReportRunExecutionContext(runId: string) {
  const row = db.prepare(`
    SELECT rrq.id, rrq.status, rrq.period_start, rrq.period_end,
           rc.report_type, p.id AS project_id, p.user_id,
           COALESCE(NULLIF(u.display_name, ''), u.name, u.email) AS user_name,
           rs.timezone
    FROM report_run_queue rrq
    JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    JOIN users u ON u.id = p.user_id
    JOIN report_schedules rs ON rs.id = rrq.schedule_id
    WHERE rrq.id = ?
  `).get(runId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    status: row.status as string,
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    reportType: row.report_type as "weekly" | "monthly",
    projectId: row.project_id as string,
    userId: row.user_id as string,
    userName: row.user_name as string,
    timezone: row.timezone as string,
  };
}

/**
 * Atomically claim a production run for an explicit reporting period. The canonical run key is
 * shared with scheduled runs, preventing a later scheduler pass from sending the same period twice.
 */
export function claimManualReportRun(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  sourceStartAt: Date;
  sourceEndAt: Date;
}) {
  const owned = db.prepare(`
    SELECT rc.id AS report_configuration_id, rs.id AS schedule_id
    FROM report_configurations rc
    JOIN projects p ON p.id = rc.project_id
    JOIN report_schedules rs ON rs.report_configuration_id = rc.id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?
  `).get(input.userId, input.projectId, input.reportType) as any | undefined;
  if (!owned) return { ok: false as const, reason: "not_found" as const, runId: null };

  const runKey = `${owned.report_configuration_id}:${input.periodStart}:${input.periodEnd}`;
  const timestamp = now();
  return db.transaction(() => {
    const existing = db.prepare("SELECT id, status FROM report_run_queue WHERE run_key = ?")
      .get(runKey) as { id: string; status: string } | undefined;
    if (existing) {
      if (existing.status === "pending" || existing.status === "failed") {
        const claimed = db.prepare(`UPDATE report_run_queue
          SET status = 'processing', run_mode = 'production', attempt_count = attempt_count + 1,
              max_attempts = attempt_count + 1, period_start = ?, period_end = ?, source_start_at = ?, source_end_at = ?,
              scheduled_for = ?, next_attempt_at = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND status IN ('pending','failed')`)
          .run(input.periodStart, input.periodEnd, input.sourceStartAt.toISOString(), input.sourceEndAt.toISOString(),
            timestamp, timestamp, timestamp, existing.id);
        if (claimed.changes > 0) return { ok: true as const, created: false, runId: existing.id };
      }
      return { ok: false as const, reason: "already_exists" as const, runId: existing.id };
    }

    const runId = randomUUID();
    db.prepare(`INSERT INTO report_run_queue
      (id, report_configuration_id, schedule_id, run_key, period_start, period_end, source_start_at, source_end_at,
       scheduled_for, run_mode, status, attempt_count, max_attempts, retry_delay_minutes,
       next_attempt_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'production', 'processing', 1, 1, 15, ?, NULL, ?, ?)`)
      .run(runId, owned.report_configuration_id, owned.schedule_id, runKey, input.periodStart, input.periodEnd,
        input.sourceStartAt.toISOString(), input.sourceEndAt.toISOString(), timestamp, timestamp, timestamp, timestamp);
    return { ok: true as const, created: true, runId };
  })();
}

export function createCorrectedReportRun(userId: string, runId: string) {
  const timestamp = now();
  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT rrq.*, rc.report_type, rc.id AS report_configuration_id, rs.id AS schedule_id,
             rdc.enabled AS delivery_enabled, rdc.to_json
      FROM report_run_queue rrq
      JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
      JOIN projects p ON p.id = rc.project_id
      JOIN report_schedules rs ON rs.id = rrq.schedule_id
      LEFT JOIN report_delivery_configurations rdc ON rdc.report_configuration_id = rc.id
      WHERE p.user_id = ? AND rrq.id = ?
    `).get(userId, runId) as any | undefined;
    if (!existing) return { ok: false as const, reason: "not_found" as const };
    if (existing.status !== "completed" || existing.run_mode !== "production") {
      return { ok: false as const, reason: "not_completed_production" as const };
    }
    let recipients: string[] = [];
    try { recipients = JSON.parse(existing.to_json || "[]"); } catch { recipients = []; }
    if (!existing.delivery_enabled || !Array.isArray(recipients) || recipients.length === 0) {
      return { ok: false as const, reason: "delivery_not_configured" as const };
    }

    const correctedRunId = randomUUID();
    const runKey = `${existing.report_configuration_id}:${existing.period_start}:${existing.period_end}:correction:${correctedRunId}`;
    db.prepare(`INSERT INTO report_run_queue
      (id, report_configuration_id, schedule_id, run_key, period_start, period_end, source_start_at, source_end_at,
       scheduled_for, run_mode, status, attempt_count, max_attempts, retry_delay_minutes,
       next_attempt_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'production', 'processing', 1, 1, 15, ?, NULL, ?, ?)`)
      .run(correctedRunId, existing.report_configuration_id, existing.schedule_id, runKey,
        existing.period_start, existing.period_end, existing.source_start_at, existing.source_end_at,
        timestamp, timestamp, timestamp, timestamp);
    return { ok: true as const, runId: correctedRunId, recipients };
  })();
}

export function markReportRunProcessing(runId: string) {
  const result = db.prepare(`UPDATE report_run_queue SET status = 'processing', attempt_count = attempt_count + 1,
    updated_at = ? WHERE id = ? AND status = 'pending'`).run(now(), runId);
  return result.changes > 0;
}

export function markReportRunCompleted(runId: string) {
  const result = db.prepare("UPDATE report_run_queue SET status = 'completed', updated_at = ? WHERE id = ?")
    .run(now(), runId);
  return result.changes > 0;
}

export function markReportRunFailed(runId: string, error: string, failedAt: Date = new Date()) {
  const row = db.prepare("SELECT * FROM report_run_queue WHERE id = ?").get(runId) as any | undefined;
  if (!row) return null;
  const attempts = Number(row.attempt_count);
  if (attempts >= Number(row.max_attempts)) {
    db.prepare("UPDATE report_run_queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 2000), failedAt.toISOString(), runId);
    return { status: "failed" as const, nextAttemptAt: null };
  }
  // Exponential retry delay: 15, 30, 60... when the configured base is 15 minutes.
  const delay = Number(row.retry_delay_minutes) * Math.pow(2, Math.max(0, attempts - 1));
  const nextAttemptAt = new Date(failedAt.getTime() + delay * 60_000).toISOString();
  db.prepare(`UPDATE report_run_queue SET status = 'pending', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(nextAttemptAt, error.slice(0, 2000), failedAt.toISOString(), runId);
  return { status: "pending" as const, nextAttemptAt };
}


// Stage 5: Gmail/Outlook delivery connections, per-report email configuration, and idempotent delivery logs.
db.exec(`
CREATE TABLE IF NOT EXISTS report_delivery_configurations (
  id TEXT PRIMARY KEY,
  report_configuration_id TEXT NOT NULL UNIQUE REFERENCES report_configurations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  attach_report INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_delivery_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES report_run_queue(id) ON DELETE CASCADE,
  report_configuration_id TEXT NOT NULL REFERENCES report_configurations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider IN ('gmail','outlook')),
  sender TEXT,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('previewed','sending','sent','failed','skipped_test')),
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_config_report ON report_delivery_configurations(report_configuration_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_run ON report_delivery_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON report_delivery_logs(status, updated_at);
`);

export function getConnectionById(userId: string, connectionId: string) {
  return db.prepare("SELECT * FROM connections WHERE id = ? AND user_id = ?").get(connectionId, userId) as any | undefined;
}

export function updateConnectionCredentials(input: {
  userId: string;
  connectionId: string;
  credentialsEnc: string;
}) {
  const result = db.prepare("UPDATE connections SET credentials_enc = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(input.credentialsEnc, now(), input.connectionId, input.userId);
  return result.changes > 0;
}

export function deleteConnection(userId: string, provider: string) {
  const connection = db.prepare("SELECT id FROM connections WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as any | undefined;
  if (!connection) return false;
  const used = db.prepare("SELECT COUNT(*) AS count FROM report_delivery_configurations WHERE connection_id = ?")
    .get(connection.id) as any;
  if (Number(used?.count || 0) > 0) throw new Error("This sending account is still used by one or more report delivery settings.");
  const result = db.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?").run(connection.id, userId);
  return result.changes > 0;
}

export function listDeliveryConnections(userId: string): DeliveryConnectionSummary[] {
  const rows = db.prepare(`SELECT id, provider, display_name, metadata_json, updated_at
    FROM connections WHERE user_id = ? AND provider IN ('gmail','outlook') ORDER BY provider`).all(userId) as any[];
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider as "gmail" | "outlook",
    displayName: row.display_name,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    updatedAt: row.updated_at,
  }));
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function deliveryFromRow(row: any): ReportDeliveryConfiguration {
  return {
    id: row.id,
    reportConfigurationId: row.report_configuration_id,
    enabled: Boolean(row.enabled),
    connectionId: row.connection_id,
    provider: row.provider as "gmail" | "outlook",
    senderDisplayName: row.display_name,
    to: parseStringArray(row.to_json),
    cc: parseStringArray(row.cc_json),
    bcc: parseStringArray(row.bcc_json),
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    attachReport: Boolean(row.attach_report),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getReportDeliveryConfiguration(userId: string, projectId: string, reportType: "weekly" | "monthly"): ReportDeliveryConfiguration | null {
  const row = db.prepare(`SELECT rdc.*, c.provider, c.display_name
    FROM report_delivery_configurations rdc
    JOIN report_configurations rc ON rc.id = rdc.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    JOIN connections c ON c.id = rdc.connection_id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?`)
    .get(userId, projectId, reportType) as any | undefined;
  return row ? deliveryFromRow(row) : null;
}

export function saveReportDeliveryConfiguration(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
  enabled: boolean;
  connectionId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  attachReport: boolean;
}) {
  const row = db.prepare(`SELECT rc.id AS report_configuration_id
    FROM report_configurations rc JOIN projects p ON p.id = rc.project_id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?`)
    .get(input.userId, input.projectId, input.reportType) as any | undefined;
  if (!row) return null;
  const connection = getConnectionById(input.userId, input.connectionId);
  if (!connection || (connection.provider !== "gmail" && connection.provider !== "outlook")) return null;
  const timestamp = now();
  const existing = db.prepare("SELECT id FROM report_delivery_configurations WHERE report_configuration_id = ?")
    .get(row.report_configuration_id) as any | undefined;
  const id = existing?.id || randomUUID();
  const values = [
    input.enabled ? 1 : 0,
    input.connectionId,
    JSON.stringify(input.to),
    JSON.stringify(input.cc),
    JSON.stringify(input.bcc),
    input.subjectTemplate,
    input.bodyTemplate,
    input.attachReport ? 1 : 0,
    timestamp,
  ];
  if (existing) {
    db.prepare(`UPDATE report_delivery_configurations SET enabled = ?, connection_id = ?, to_json = ?, cc_json = ?, bcc_json = ?,
      subject_template = ?, body_template = ?, attach_report = ?, updated_at = ? WHERE id = ?`)
      .run(...values, id);
  } else {
    db.prepare(`INSERT INTO report_delivery_configurations
      (id, report_configuration_id, enabled, connection_id, to_json, cc_json, bcc_json, subject_template, body_template, attach_report, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, row.report_configuration_id, input.enabled ? 1 : 0, input.connectionId, JSON.stringify(input.to), JSON.stringify(input.cc), JSON.stringify(input.bcc),
        input.subjectTemplate, input.bodyTemplate, input.attachReport ? 1 : 0, timestamp, timestamp);
  }
  return getReportDeliveryConfiguration(input.userId, input.projectId, input.reportType);
}

export function getDeliveryContextForRun(runId: string) {
  return db.prepare(`SELECT rrq.*, rc.report_type, rc.filename_pattern, rc.output_format,
      p.id AS project_id, p.user_id, p.name AS project_name,
      rdc.id AS delivery_configuration_id, rdc.enabled AS delivery_enabled, rdc.connection_id,
      rdc.to_json, rdc.cc_json, rdc.bcc_json, rdc.subject_template, rdc.body_template, rdc.attach_report,
      c.provider, c.display_name
    FROM report_run_queue rrq
    JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
    JOIN projects p ON p.id = rc.project_id
    LEFT JOIN report_delivery_configurations rdc ON rdc.report_configuration_id = rc.id
    LEFT JOIN connections c ON c.id = rdc.connection_id
    WHERE rrq.id = ?`).get(runId) as any | undefined;
}

export function reserveDeliveryLog(input: {
  runId: string;
  reportConfigurationId: string;
  connectionId: string;
  provider: "gmail" | "outlook";
  sender: string | null;
  recipients: { to: string[]; cc: string[]; bcc: string[] };
  subject: string;
  status: "previewed" | "sending" | "sent" | "failed" | "skipped_test";
}) {
  const timestamp = now();
  const id = randomUUID();
  const result = db.prepare(`INSERT OR IGNORE INTO report_delivery_logs
    (id, run_id, report_configuration_id, connection_id, provider, sender, recipients_json, subject, status, provider_message_id, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
    .run(id, input.runId, input.reportConfigurationId, input.connectionId, input.provider, input.sender,
      JSON.stringify(input.recipients), input.subject, input.status, timestamp, timestamp);
  if (result.changes === 0) return null;
  return id;
}

export function completeDeliveryLog(logId: string, input: { status: "sent" | "failed" | "skipped_test" | "previewed"; providerMessageId?: string | null; error?: string | null }) {
  const result = db.prepare(`UPDATE report_delivery_logs SET status = ?, provider_message_id = ?, error = ?, updated_at = ? WHERE id = ?`)
    .run(input.status, input.providerMessageId ?? null, input.error?.slice(0, 2000) ?? null, now(), logId);
  return result.changes > 0;
}

export function getDeliveryLogForRun(runId: string): DeliveryLog | null {
  const row = db.prepare("SELECT * FROM report_delivery_logs WHERE run_id = ?").get(runId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    sender: row.sender,
    recipients: JSON.parse(row.recipients_json),
    subject: row.subject,
    status: row.status,
    providerMessageId: row.provider_message_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


// Stage 5 artifact handoff: report generation can register one generated file for a queued run.
db.exec(`
CREATE TABLE IF NOT EXISTS report_run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES report_run_queue(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  display_filename TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_artifact_run ON report_run_artifacts(run_id);
`);

const artifactColumns = db.prepare("PRAGMA table_info(report_run_artifacts)").all() as Array<{ name: string }>;
if (!artifactColumns.some((column) => column.name === "display_filename")) {
  db.exec("ALTER TABLE report_run_artifacts ADD COLUMN display_filename TEXT");
}

function friendlyArtifactFilename(displayFilename: string | null | undefined, storageFilename: string) {
  if (displayFilename?.trim()) return displayFilename;
  return storageFilename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

export function registerRunArtifact(input: { runId: string; filename: string; displayFilename?: string; contentType: string; byteSize?: number | null }) {
  const run = db.prepare("SELECT id FROM report_run_queue WHERE id = ?").get(input.runId) as any | undefined;
  if (!run) return null;
  const existing = db.prepare("SELECT id FROM report_run_artifacts WHERE run_id = ?").get(input.runId) as any | undefined;
  const id = existing?.id || randomUUID();
  if (existing) {
    db.prepare("UPDATE report_run_artifacts SET filename = ?, display_filename = ?, content_type = ?, byte_size = ?, created_at = ? WHERE id = ?")
      .run(input.filename, input.displayFilename || null, input.contentType, input.byteSize ?? null, now(), id);
  } else {
    db.prepare(`INSERT INTO report_run_artifacts (id, run_id, filename, display_filename, content_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.runId, input.filename, input.displayFilename || null, input.contentType, input.byteSize ?? null, now());
  }
  return id;
}

export function getRunArtifact(runId: string) {
  return db.prepare("SELECT * FROM report_run_artifacts WHERE run_id = ?").get(runId) as any | undefined;
}

// Stage 6: user-facing run history and explicit operational actions.
const stage6QueueColumns = db.prepare("PRAGMA table_info(report_run_queue)").all() as Array<{ name: string }>;
if (!stage6QueueColumns.some((column) => column.name === "manual_retry_count")) {
  db.exec("ALTER TABLE report_run_queue ADD COLUMN manual_retry_count INTEGER NOT NULL DEFAULT 0");
}
if (!stage6QueueColumns.some((column) => column.name === "last_manual_retry_at")) {
  db.exec("ALTER TABLE report_run_queue ADD COLUMN last_manual_retry_at TEXT");
}

db.exec(`
CREATE TABLE IF NOT EXISTS report_resend_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES report_run_queue(id) ON DELETE CASCADE,
  report_configuration_id TEXT NOT NULL REFERENCES report_configurations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider IN ('gmail','outlook')),
  sender TEXT,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resend_logs_run ON report_resend_logs(run_id, created_at DESC);
`);

function safeRecipients(value: string | null | undefined) {
  if (!value) return { to: [], cc: [], bcc: [] };
  try {
    const parsed = JSON.parse(value);
    return {
      to: Array.isArray(parsed?.to) ? parsed.to.map(String) : [],
      cc: Array.isArray(parsed?.cc) ? parsed.cc.map(String) : [],
      bcc: Array.isArray(parsed?.bcc) ? parsed.bcc.map(String) : [],
    };
  } catch {
    return { to: [], cc: [], bcc: [] };
  }
}

function operationalStatus(row: any): OperationalRunStatus {
  if (row.queue_status === "failed") return "failed";
  if (row.queue_status === "processing") return "processing";
  if (row.queue_status === "pending") return "queued";
  if (row.delivery_status === "sending") return "processing";
  // A successful manual resend resolves an earlier delivery failure while
  // retaining the original failure and all retry attempts in the audit log.
  if (row.delivery_status === "failed" && row.latest_resend_status === "sent") return "sent";
  if (row.delivery_status === "failed") return "delivery_failed";
  if (row.delivery_status === "sent") return "sent";
  if (row.delivery_status === "skipped_test" || row.run_mode === "test") return "test";
  return row.artifact_filename ? "generated" : "generated";
}

function activityFromRow(row: any): ReportActivityItem {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    scheduledFor: row.scheduled_for,
    timezone: row.timezone || "UTC",
    runMode: row.run_mode === "production" ? "production" : "test",
    queueStatus: row.queue_status,
    operationalStatus: operationalStatus(row),
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lastError: row.last_error,
    artifact: row.artifact_filename ? {
      filename: friendlyArtifactFilename(row.artifact_display_filename, row.artifact_filename),
      contentType: row.artifact_content_type,
      byteSize: row.artifact_byte_size == null ? null : Number(row.artifact_byte_size),
      createdAt: row.artifact_created_at,
    } : null,
    delivery: row.delivery_status ? {
      provider: row.delivery_provider,
      sender: row.delivery_sender,
      status: row.delivery_status,
      subject: row.delivery_subject,
      error: row.delivery_error,
      updatedAt: row.delivery_updated_at,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const activitySelect = `
  SELECT rrq.id, rrq.report_configuration_id, rrq.schedule_id, rrq.period_start, rrq.period_end,
         rrq.source_start_at, rrq.source_end_at, rrq.scheduled_for, rrq.run_mode,
         rrq.status AS queue_status, rrq.attempt_count, rrq.max_attempts, rrq.next_attempt_at,
         rrq.last_error, rrq.manual_retry_count, rrq.last_manual_retry_at, rrq.created_at, rrq.updated_at,
         rc.report_type, rs.timezone, p.id AS project_id, p.name AS project_name,
         a.filename AS artifact_filename, a.display_filename AS artifact_display_filename, a.content_type AS artifact_content_type,
         a.byte_size AS artifact_byte_size, a.created_at AS artifact_created_at,
         dl.provider AS delivery_provider, dl.sender AS delivery_sender, dl.recipients_json AS delivery_recipients_json,
         dl.subject AS delivery_subject, dl.status AS delivery_status, dl.provider_message_id,
         dl.error AS delivery_error, dl.updated_at AS delivery_updated_at,
         (SELECT rsl.status FROM report_resend_logs rsl
          WHERE rsl.run_id = rrq.id ORDER BY rsl.created_at DESC LIMIT 1) AS latest_resend_status
  FROM report_run_queue rrq
  JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
  JOIN projects p ON p.id = rc.project_id
  JOIN report_schedules rs ON rs.id = rrq.schedule_id
  LEFT JOIN report_run_artifacts a ON a.run_id = rrq.id
  LEFT JOIN report_delivery_logs dl ON dl.run_id = rrq.id
`;

export function listReportActivity(input: {
  userId: string;
  projectId?: string | null;
  reportType?: "weekly" | "monthly" | null;
  runMode?: "test" | "production" | null;
  status?: OperationalRunStatus | null;
  query?: string | null;
  limit?: number;
}): ReportActivityItem[] {
  const conditions = ["p.user_id = ?"];
  const values: unknown[] = [input.userId];
  if (input.projectId) { conditions.push("p.id = ?"); values.push(input.projectId); }
  if (input.reportType) { conditions.push("rc.report_type = ?"); values.push(input.reportType); }
  if (input.runMode) { conditions.push("rrq.run_mode = ?"); values.push(input.runMode); }
  if (input.query?.trim()) {
    conditions.push("(p.name LIKE ? OR rrq.period_start LIKE ? OR rrq.period_end LIKE ?)");
    const query = `%${input.query.trim()}%`;
    values.push(query, query, query);
  }
  const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
  values.push(limit);
  const rows = db.prepare(`${activitySelect} WHERE ${conditions.join(" AND ")} ORDER BY rrq.scheduled_for DESC LIMIT ?`).all(...values) as any[];
  const mapped = rows.map(activityFromRow);
  return input.status ? mapped.filter((item) => item.operationalStatus === input.status) : mapped;
}

export function getReportRunDetail(userId: string, runId: string): ReportRunDetail | null {
  const row = db.prepare(`${activitySelect} WHERE p.user_id = ? AND rrq.id = ?`).get(userId, runId) as any | undefined;
  if (!row) return null;
  const base = activityFromRow(row);
  const resendRows = db.prepare("SELECT * FROM report_resend_logs WHERE run_id = ? ORDER BY created_at DESC")
    .all(runId) as any[];
  return {
    ...base,
    sourceStartAt: row.source_start_at,
    sourceEndAt: row.source_end_at,
    nextAttemptAt: row.next_attempt_at,
    manualRetryCount: Number(row.manual_retry_count || 0),
    lastManualRetryAt: row.last_manual_retry_at,
    deliveryRecipients: row.delivery_recipients_json ? safeRecipients(row.delivery_recipients_json) : null,
    providerMessageId: row.provider_message_id,
    resendAttempts: resendRows.map((item) => ({
      id: item.id,
      provider: item.provider,
      sender: item.sender,
      recipients: safeRecipients(item.recipients_json),
      subject: item.subject,
      status: item.status,
      providerMessageId: item.provider_message_id,
      error: item.error,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  };
}

export function deleteReportRun(userId: string, runId: string) {
  return db.transaction(() => {
    const row = db.prepare(`SELECT rrq.status, a.filename,
        dl.status AS delivery_status,
        EXISTS(SELECT 1 FROM report_resend_logs rsl WHERE rsl.run_id = rrq.id AND rsl.status = 'sending') AS resend_sending
      FROM report_run_queue rrq
      JOIN report_configurations rc ON rc.id = rrq.report_configuration_id
      JOIN projects p ON p.id = rc.project_id
      LEFT JOIN report_run_artifacts a ON a.run_id = rrq.id
      LEFT JOIN report_delivery_logs dl ON dl.run_id = rrq.id
      WHERE p.user_id = ? AND rrq.id = ?`).get(userId, runId) as any | undefined;
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status === "processing" || row.delivery_status === "sending" || row.resend_sending) {
      return { ok: false as const, reason: "in_progress" as const };
    }
    db.prepare("DELETE FROM report_run_queue WHERE id = ?").run(runId);
    return { ok: true as const, filename: row.filename as string | null };
  })();
}

export function getActivitySummary(userId: string) {
  const items = listReportActivity({ userId, limit: 500 });
  return {
    total: items.length,
    sent: items.filter((item) => item.operationalStatus === "sent").length,
    test: items.filter((item) => item.operationalStatus === "test").length,
    queued: items.filter((item) => item.operationalStatus === "queued" || item.operationalStatus === "processing").length,
    failed: items.filter((item) => item.operationalStatus === "failed" || item.operationalStatus === "delivery_failed").length,
  };
}

export function retryFailedReportRun(userId: string, runId: string) {
  const row = db.prepare(`${activitySelect} WHERE p.user_id = ? AND rrq.id = ?`).get(userId, runId) as any | undefined;
  if (!row) return { ok: false as const, reason: "not_found" as const };
  if (row.queue_status !== "failed" && row.queue_status !== "pending") {
    return { ok: false as const, reason: "not_failed" as const };
  }
  const timestamp = now();
  db.prepare(`UPDATE report_run_queue SET status = 'pending', attempt_count = 0, next_attempt_at = ?, last_error = NULL,
    manual_retry_count = manual_retry_count + 1, last_manual_retry_at = ?, updated_at = ? WHERE id = ?`)
    .run(timestamp, timestamp, timestamp, runId);
  return { ok: true as const };
}

export function createResendLog(input: {
  runId: string;
  reportConfigurationId: string;
  connectionId: string;
  provider: "gmail" | "outlook";
  sender: string | null;
  recipients: { to: string[]; cc: string[]; bcc: string[] };
  subject: string;
}) {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO report_resend_logs
    (id, run_id, report_configuration_id, connection_id, provider, sender, recipients_json, subject,
     status, provider_message_id, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending', NULL, NULL, ?, ?)`)
    .run(id, input.runId, input.reportConfigurationId, input.connectionId, input.provider, input.sender,
      JSON.stringify(input.recipients), input.subject, timestamp, timestamp);
  return id;
}

export function completeResendLog(logId: string, input: { status: "sent" | "failed"; providerMessageId?: string | null; error?: string | null }) {
  const result = db.prepare("UPDATE report_resend_logs SET status = ?, provider_message_id = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(input.status, input.providerMessageId ?? null, input.error?.slice(0, 2000) ?? null, now(), logId);
  return result.changes > 0;
}

// Stage 7: AI conversations and immutable draft change proposals.
// The AI layer can write only conversation/proposal records. It does not mutate production configuration tables.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_change_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','discarded','approved','applied','rejected')),
  summary TEXT NOT NULL,
  explanation TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('none','low','medium','high')),
  plan_json TEXT NOT NULL,
  base_snapshot_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  proposal_id TEXT REFERENCES ai_change_requests(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_change_requests_user ON ai_change_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_change_requests_conversation ON ai_change_requests(conversation_id, created_at);
`);

export function createAIConversation(input: { userId: string; projectId?: string | null; title?: string | null }) {
  if (input.projectId) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(input.projectId, input.userId) as any | undefined;
    if (!project) throw new Error("Project not found");
  }
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO ai_conversations (id, user_id, project_id, title, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, input.userId, input.projectId || null, input.title?.trim() || "New conversation", timestamp, timestamp);
  return id;
}

export function getAIConversation(userId: string, conversationId: string) {
  const row = db.prepare(`SELECT c.*, p.name AS project_name
    FROM ai_conversations c LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.id = ? AND c.user_id = ?`).get(conversationId, userId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    projectId: row.project_id as string | null,
    projectName: row.project_name as string | null,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listAIConversations(userId: string, limit = 30) {
  const rows = db.prepare(`SELECT c.*, p.name AS project_name
    FROM ai_conversations c LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ?`)
    .all(userId, Math.max(1, Math.min(limit, 100))) as any[];
  return rows.map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string | null,
    projectName: row.project_name as string | null,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export function addAIConversationMessage(input: {
  userId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  proposalId?: string | null;
}) {
  const conversation = db.prepare("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?")
    .get(input.conversationId, input.userId) as any | undefined;
  if (!conversation) throw new Error("Conversation not found");
  const timestamp = now();
  const id = randomUUID();
  db.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, proposal_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, input.conversationId, input.role, input.content, input.proposalId || null, timestamp);
  db.prepare("UPDATE ai_conversations SET updated_at = ? WHERE id = ?").run(timestamp, input.conversationId);
  return id;
}

export function listAIConversationMessages(userId: string, conversationId: string, limit = 100) {
  const conversation = db.prepare("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?")
    .get(conversationId, userId) as any | undefined;
  if (!conversation) return [];
  const rows = db.prepare(`SELECT * FROM (
      SELECT id, conversation_id, role, content, proposal_id, created_at
      FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC`).all(conversationId, Math.max(1, Math.min(limit, 200))) as any[];
  return rows.map((row) => ({
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    proposalId: row.proposal_id as string | null,
    createdAt: row.created_at as string,
  }));
}

export function renameAIConversationFromFirstMessage(userId: string, conversationId: string, message: string) {
  const row = db.prepare("SELECT title FROM ai_conversations WHERE id = ? AND user_id = ?")
    .get(conversationId, userId) as any | undefined;
  if (!row || row.title !== "New conversation") return;
  const title = message.replace(/\s+/g, " ").trim().slice(0, 54) || "New conversation";
  db.prepare("UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title, now(), conversationId, userId);
}

export function createAIChangeRequest(input: {
  userId: string;
  conversationId: string;
  projectId?: string | null;
  summary: string;
  explanation: string;
  riskLevel: "none" | "low" | "medium" | "high";
  plan: Record<string, unknown>;
  baseSnapshot: Record<string, unknown>;
  model?: string | null;
}) {
  const conversation = db.prepare("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?")
    .get(input.conversationId, input.userId) as any | undefined;
  if (!conversation) throw new Error("Conversation not found");
  if (input.projectId) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(input.projectId, input.userId) as any | undefined;
    if (!project) throw new Error("Project not found");
  }
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO ai_change_requests
    (id, conversation_id, user_id, project_id, status, summary, explanation, risk_level, plan_json, base_snapshot_json, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.conversationId, input.userId, input.projectId || null, input.summary, input.explanation,
      input.riskLevel, JSON.stringify(input.plan), JSON.stringify(input.baseSnapshot), input.model || null, timestamp, timestamp);
  return id;
}

export function getAIChangeRequest(userId: string, proposalId: string) {
  const row = db.prepare(`SELECT r.*, p.name AS project_name
    FROM ai_change_requests r LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.id = ? AND r.user_id = ?`).get(proposalId, userId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    projectId: row.project_id as string | null,
    projectName: row.project_name as string | null,
    status: row.status as "draft" | "discarded" | "approved" | "applied" | "rejected",
    summary: row.summary as string,
    explanation: row.explanation as string,
    riskLevel: row.risk_level as "none" | "low" | "medium" | "high",
    plan: JSON.parse(row.plan_json),
    baseSnapshot: JSON.parse(row.base_snapshot_json),
    model: row.model as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listAIChangeRequestsForConversation(userId: string, conversationId: string) {
  const rows = db.prepare(`SELECT id FROM ai_change_requests WHERE user_id = ? AND conversation_id = ? ORDER BY created_at DESC`)
    .all(userId, conversationId) as Array<{ id: string }>;
  return rows.map((row) => getAIChangeRequest(userId, row.id)).filter(Boolean);
}

export function discardAIChangeRequest(userId: string, proposalId: string) {
  const result = db.prepare(`UPDATE ai_change_requests SET status = 'discarded', updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'draft'`).run(now(), proposalId, userId);
  return result.changes > 0;
}

// Stage 8: governance, immutable configuration versions, proposal validation/test state and audit history.
db.exec(`
CREATE TABLE IF NOT EXISTS proposal_governance (
  proposal_id TEXT PRIMARY KEY REFERENCES ai_change_requests(id) ON DELETE CASCADE,
  validation_status TEXT NOT NULL DEFAULT 'not_run' CHECK(validation_status IN ('not_run','valid','conflict','blocked')),
  validation_json TEXT,
  test_status TEXT NOT NULL DEFAULT 'not_run' CHECK(test_status IN ('not_run','passed','failed')),
  test_json TEXT,
  validated_at TEXT,
  tested_at TEXT,
  approved_at TEXT,
  applied_at TEXT,
  applied_version_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuration_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('baseline','ai_apply','manual_restore')),
  summary TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  proposal_id TEXT REFERENCES ai_change_requests(id) ON DELETE SET NULL,
  restored_from_version_id TEXT REFERENCES configuration_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_number)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_versions_project ON configuration_versions(project_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
`);

export function runGovernedTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function getProposalGovernance(userId: string, proposalId: string) {
  const owned = db.prepare("SELECT id FROM ai_change_requests WHERE id = ? AND user_id = ?").get(proposalId, userId) as any | undefined;
  if (!owned) return null;
  const row = db.prepare("SELECT * FROM proposal_governance WHERE proposal_id = ?").get(proposalId) as any | undefined;
  if (!row) return {
    proposalId,
    validationStatus: "not_run" as const,
    validation: null,
    testStatus: "not_run" as const,
    test: null,
    validatedAt: null,
    testedAt: null,
    approvedAt: null,
    appliedAt: null,
    appliedVersionId: null,
  };
  return {
    proposalId,
    validationStatus: row.validation_status,
    validation: row.validation_json ? JSON.parse(row.validation_json) : null,
    testStatus: row.test_status,
    test: row.test_json ? JSON.parse(row.test_json) : null,
    validatedAt: row.validated_at,
    testedAt: row.tested_at,
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    appliedVersionId: row.applied_version_id,
  };
}

export function saveProposalValidation(input: {
  userId: string;
  proposalId: string;
  status: "valid" | "conflict" | "blocked";
  validation: Record<string, unknown>;
}) {
  const owned = db.prepare("SELECT id FROM ai_change_requests WHERE id = ? AND user_id = ?").get(input.proposalId, input.userId) as any | undefined;
  if (!owned) return false;
  const timestamp = now();
  db.prepare(`INSERT INTO proposal_governance
    (proposal_id, validation_status, validation_json, test_status, test_json, validated_at, tested_at, approved_at, applied_at, applied_version_id, updated_at)
    VALUES (?, ?, ?, 'not_run', NULL, ?, NULL, NULL, NULL, NULL, ?)
    ON CONFLICT(proposal_id) DO UPDATE SET validation_status=excluded.validation_status,
      validation_json=excluded.validation_json,
      test_status=CASE WHEN excluded.validation_status='valid' THEN proposal_governance.test_status ELSE 'not_run' END,
      test_json=CASE WHEN excluded.validation_status='valid' THEN proposal_governance.test_json ELSE NULL END,
      validated_at=excluded.validated_at,
      tested_at=CASE WHEN excluded.validation_status='valid' THEN proposal_governance.tested_at ELSE NULL END,
      approved_at=CASE WHEN excluded.validation_status='valid' THEN proposal_governance.approved_at ELSE NULL END,
      updated_at=excluded.updated_at`)
    .run(input.proposalId, input.status, JSON.stringify(input.validation), timestamp, timestamp);
  // A newly detected conflict invalidates any prior approval.
  if (input.status !== "valid") {
    db.prepare("UPDATE ai_change_requests SET status = 'draft', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'")
      .run(timestamp, input.proposalId, input.userId);
  }
  return true;
}

export function saveProposalTest(input: {
  userId: string;
  proposalId: string;
  status: "passed" | "failed";
  test: Record<string, unknown>;
}) {
  const owned = db.prepare("SELECT id FROM ai_change_requests WHERE id = ? AND user_id = ?").get(input.proposalId, input.userId) as any | undefined;
  if (!owned) return false;
  const timestamp = now();
  db.prepare(`INSERT INTO proposal_governance
    (proposal_id, validation_status, validation_json, test_status, test_json, validated_at, tested_at, approved_at, applied_at, applied_version_id, updated_at)
    VALUES (?, 'not_run', NULL, ?, ?, NULL, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(proposal_id) DO UPDATE SET test_status=excluded.test_status, test_json=excluded.test_json,
      tested_at=excluded.tested_at, approved_at=NULL, updated_at=excluded.updated_at`)
    .run(input.proposalId, input.status, JSON.stringify(input.test), timestamp, timestamp);
  db.prepare("UPDATE ai_change_requests SET status = 'draft', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'")
    .run(timestamp, input.proposalId, input.userId);
  return true;
}

export function approveAIChangeRequest(userId: string, proposalId: string) {
  const governance = getProposalGovernance(userId, proposalId);
  if (!governance || governance.validationStatus !== "valid" || governance.testStatus !== "passed") return false;
  const timestamp = now();
  const result = db.prepare("UPDATE ai_change_requests SET status = 'approved', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'draft'")
    .run(timestamp, proposalId, userId);
  if (!result.changes) return false;
  db.prepare("UPDATE proposal_governance SET approved_at = ?, updated_at = ? WHERE proposal_id = ?")
    .run(timestamp, timestamp, proposalId);
  return true;
}

export function markAIChangeRequestApplied(userId: string, proposalId: string, versionId: string) {
  const timestamp = now();
  const result = db.prepare("UPDATE ai_change_requests SET status = 'applied', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'")
    .run(timestamp, proposalId, userId);
  if (!result.changes) return false;
  db.prepare("UPDATE proposal_governance SET applied_at = ?, applied_version_id = ?, updated_at = ? WHERE proposal_id = ?")
    .run(timestamp, versionId, timestamp, proposalId);
  return true;
}

export function createConfigurationVersion(input: {
  userId: string;
  projectId: string;
  source: "baseline" | "ai_apply" | "manual_restore";
  summary: string;
  snapshot: Record<string, unknown>;
  proposalId?: string | null;
  restoredFromVersionId?: string | null;
}) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(input.projectId, input.userId) as any | undefined;
  if (!project) throw new Error("Project not found");
  const next = db.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM configuration_versions WHERE project_id = ?")
    .get(input.projectId) as any;
  const id = randomUUID();
  db.prepare(`INSERT INTO configuration_versions
    (id, user_id, project_id, version_number, source, summary, snapshot_json, proposal_id, restored_from_version_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.userId, input.projectId, Number(next.n), input.source, input.summary, JSON.stringify(input.snapshot),
      input.proposalId || null, input.restoredFromVersionId || null, now());
  return { id, versionNumber: Number(next.n) };
}

export function listConfigurationVersions(userId: string, projectId: string) {
  return db.prepare(`SELECT cv.id, cv.project_id, cv.version_number, cv.source, cv.summary, cv.proposal_id,
      cv.restored_from_version_id, cv.created_at
    FROM configuration_versions cv JOIN projects p ON p.id = cv.project_id
    WHERE cv.project_id = ? AND p.user_id = ? ORDER BY cv.version_number DESC`)
    .all(projectId, userId).map((row: any) => ({
      id: row.id, projectId: row.project_id, versionNumber: Number(row.version_number), source: row.source,
      summary: row.summary, proposalId: row.proposal_id, restoredFromVersionId: row.restored_from_version_id, createdAt: row.created_at,
    }));
}

export function getConfigurationVersion(userId: string, versionId: string) {
  const row = db.prepare(`SELECT cv.* FROM configuration_versions cv JOIN projects p ON p.id = cv.project_id
    WHERE cv.id = ? AND p.user_id = ?`).get(versionId, userId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    versionNumber: Number(row.version_number),
    source: row.source as "baseline" | "ai_apply" | "manual_restore",
    summary: row.summary as string,
    snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>,
    proposalId: row.proposal_id as string | null,
    restoredFromVersionId: row.restored_from_version_id as string | null,
    createdAt: row.created_at as string,
  };
}

export function createAuditLog(input: {
  userId: string;
  projectId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO audit_logs (id, user_id, project_id, action, entity_type, entity_id, summary, metadata_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.userId, input.projectId || null, input.action, input.entityType, input.entityId || null,
      input.summary, input.metadata ? JSON.stringify(input.metadata) : null, now());
  return id;
}

export function listAuditLogs(userId: string, projectId?: string | null, limit = 100) {
  const rows = projectId
    ? db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, projectId, limit)
    : db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
  return (rows as any[]).map((row) => ({
    id: row.id as string, projectId: row.project_id as string | null, action: row.action as string,
    entityType: row.entity_type as string, entityId: row.entity_id as string | null, summary: row.summary as string,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null, createdAt: row.created_at as string,
  }));
}

export function setActiveReportTemplate(input: {
  userId: string;
  projectId: string;
  reportType: "weekly" | "monthly";
  templateId: string | null;
}) {
  const config = db.prepare(`SELECT rc.id FROM report_configurations rc JOIN projects p ON p.id = rc.project_id
    WHERE p.user_id = ? AND p.id = ? AND rc.report_type = ?`).get(input.userId, input.projectId, input.reportType) as any | undefined;
  if (!config) return false;
  if (input.templateId) {
    const template = db.prepare("SELECT id FROM report_templates WHERE id = ? AND report_configuration_id = ?")
      .get(input.templateId, config.id) as any | undefined;
    if (!template) return false;
  }
  const result = db.prepare("UPDATE report_configurations SET active_template_id = ?, updated_at = ? WHERE id = ?")
    .run(input.templateId, now(), config.id);
  return result.changes > 0;
}
