"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportConfiguration, ReportType } from "@/lib/types";

export function ReportConfigForm({
  projectId,
  projectName,
  reportType,
  existing,
  sourceProjects,
}: {
  projectId: string;
  projectName: string;
  reportType: ReportType;
  existing: ReportConfiguration | null;
  sourceProjects: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const title = reportType === "weekly" ? "Weekly report" : "Monthly report";
  const defaultPattern = reportType === "weekly"
    ? "{project} - Week {week} - {employee}"
    : "{project} - {month} {year} - {employee}";
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [outputFormat, setOutputFormat] = useState(existing?.outputFormat ?? "xlsx");
  const [filenamePattern, setFilenamePattern] = useState(existing?.filenamePattern ?? defaultPattern);
  const [template, setTemplate] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"all" | "selected">(existing?.sourceMode ?? "all");
  const [sourceProjectIds, setSourceProjectIds] = useState<string[]>(existing?.sourceProjectIds ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save() {
    setSaving(true); setError(""); setSuccess("");
    const form = new FormData();
    form.set("enabled", String(enabled));
    form.set("outputFormat", outputFormat);
    form.set("filenamePattern", filenamePattern);
    form.set("sourceMode", sourceMode);
    form.set("sourceProjectIds", JSON.stringify(sourceProjectIds));
    if (template) form.set("template", template);
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}`, { method: "PUT", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaving(false);
      setError(payload.error || "Unable to save report configuration");
      return;
    }
    setTemplate(null);
    setSuccess("Report configuration saved.");
    setSaving(false);
    router.refresh();
  }

  async function removeReport() {
    const confirmed = window.confirm(`Delete this ${reportType} report configuration? Its template, schedule, and delivery settings will be removed. The project and its ${reportType === "weekly" ? "monthly" : "weekly"} report will remain.`);
    if (!confirmed) return;
    setDeleting(true); setError(""); setSuccess("");
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setDeleting(false);
      setError(payload.error || "Unable to delete report configuration");
      return;
    }
    router.push(`/app/projects/${projectId}`);
    router.refresh();
  }

  return (
    <div className="form">
      <div className="report-summary-card">
        <div>
          <div className="detail-label">Report</div>
          <div className="project-title">{title}</div>
          <div className="muted">{projectName}</div>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      <div className="field">
        <label htmlFor={`${reportType}-report-template`}>Template</label>
        {existing?.templateOriginalName && !template && (
          <div className="current-template">
            <div><strong>{existing.templateOriginalName}</strong><div className="field-help">Active template · Version {existing.templateVersion}</div></div>
            {existing.templateId && <a className="button" href={`/api/report-templates/${existing.templateId}/download`}>Download</a>}
          </div>
        )}
        <label className="upload-box">
          <input id={`${reportType}-report-template`} type="file" accept=".xlsx,.xlsm" onChange={(e) => setTemplate(e.target.files?.[0] ?? null)} />
          <span className="upload-title">{template ? template.name : existing?.templateOriginalName ? "Replace template" : "Upload report template"}</span>
          <span className="field-help">Excel .xlsx or .xlsm · up to 15 MB. Weekly and monthly templates are stored separately.</span>
        </label>
      </div>

      <fieldset className="field fieldset">
        <legend>Data included in this report</legend>
        <div className="choice-grid">
          <label className={`choice-card ${sourceMode === "all" ? "selected" : ""}`}><input type="radio" name="sourceMode" checked={sourceMode === "all"} onChange={() => setSourceMode("all")} /><span><strong>All mapped project data</strong><small>Use every Clockify project connected to {projectName}.</small></span></label>
          <label className={`choice-card ${sourceMode === "selected" ? "selected" : ""}`}><input type="radio" name="sourceMode" checked={sourceMode === "selected"} onChange={() => setSourceMode("selected")} /><span><strong>Selected data only</strong><small>Use a smaller set for this {reportType} report.</small></span></label>
        </div>
        {sourceMode === "selected" && <div className="checklist report-source-checklist">{sourceProjects.map((source) => <label className="check-row" key={source.id}><input type="checkbox" checked={sourceProjectIds.includes(source.id)} onChange={() => setSourceProjectIds((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} /><span>{source.name}</span></label>)}</div>}
      </fieldset>

      <div className="field">
        <label htmlFor={`${reportType}-report-output-format`}>Output file type</label>
        <select id={`${reportType}-report-output-format`} className="select" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as "xlsx" | "xlsm" | "pdf")}>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="xlsm">Excel Macro-Enabled (.xlsm)</option>
          <option value="pdf" disabled={outputFormat !== "pdf"}>PDF (.pdf) — coming soon</option>
        </select>
        {outputFormat === "pdf"
          ? <div className="field-help">This saved configuration uses PDF, but generation is not available yet. Choose an Excel format before running or scheduling it.</div>
          : <div className="field-help">PDF generation is coming soon. Current report runs support Excel only.</div>}
      </div>

      <div className="field">
        <label htmlFor={`${reportType}-report-filename-pattern`}>Filename pattern</label>
        <input id={`${reportType}-report-filename-pattern`} className="input" value={filenamePattern} onChange={(e) => setFilenamePattern(e.target.value)} />
        <div className="field-help">Available placeholders: {"{project}"}, {"{employee}"}, {"{week}"}, {"{month}"}, {"{year}"}, {"{start_date}"}, {"{end_date}"}.</div>
      </div>

      <div className="card report-period-note">
        <div className="detail-label">Reporting period</div>
        <div className="connection-name">{reportType === "weekly" ? "One business week" : "One calendar month"}</div>
        <div className="muted">{reportType === "weekly" ? "The schedule below controls the exact business week-end day and shift-end timing." : "The schedule below handles a final month-end shift that finishes after midnight."}</div>
      </div>

      <div className="form-actions">
        {existing && <button className="button danger-button" type="button" disabled={saving || deleting} onClick={removeReport}>{deleting ? "Deleting…" : `Delete ${reportType} report`}</button>}
        <button className="button" type="button" onClick={() => router.push(`/app/projects/${projectId}`)}>Cancel</button>
        <button className="button primary" type="button" disabled={saving || !filenamePattern.trim() || (sourceMode === "selected" && sourceProjectIds.length === 0)} onClick={save}>{saving ? "Saving…" : "Save report"}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" aria-live="polite">{success}</p>}
    </div>
  );
}
