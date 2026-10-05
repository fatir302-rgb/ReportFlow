"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliveryConnectionSummary, ReportDeliveryConfiguration, ReportType } from "@/lib/types";
import { renderDeliveryTemplate } from "@/lib/delivery-template";

function splitAddresses(text: string) {
  return [...new Set(text.split(/[\n,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function EmailDeliveryForm({
  projectId,
  projectName,
  reportType,
  existing,
  connections,
}: {
  projectId: string;
  projectName: string;
  reportType: ReportType;
  existing: ReportDeliveryConfiguration | null;
  connections: DeliveryConnectionSummary[];
}) {
  const router = useRouter();
  const defaultSubject = `{project} ${reportType === "weekly" ? "Weekly" : "Monthly"} Report - {period_start} to {period_end}`;
  const defaultBody = `Hi,\n\nPlease find attached the ${reportType} report for {project}, covering {period_start} to {period_end}.\n\nRegards`;
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [connectionId, setConnectionId] = useState(existing?.connectionId ?? connections[0]?.id ?? "");
  const [toText, setToText] = useState(existing?.to.join(", ") ?? "");
  const [ccText, setCcText] = useState(existing?.cc.join(", ") ?? "");
  const [bccText, setBccText] = useState(existing?.bcc.join(", ") ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(existing?.subjectTemplate ?? defaultSubject);
  const [bodyTemplate, setBodyTemplate] = useState(existing?.bodyTemplate ?? defaultBody);
  const [attachReport, setAttachReport] = useState(existing?.attachReport ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const previewValues = useMemo(() => {
    const today = new Date();
    if (reportType === "monthly") {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        project: projectName,
        report_type: reportType,
        period_start: localDate(start),
        period_end: localDate(end),
        week: String(Math.ceil(end.getDate() / 7)),
        month: start.toLocaleString("en", { month: "long" }),
        year: String(start.getFullYear()),
      } as const;
    }
    const end = new Date(today);
    end.setDate(today.getDate() - today.getDay());
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return {
      project: projectName,
      report_type: reportType,
      period_start: localDate(start),
      period_end: localDate(end),
      week: String(Math.ceil(end.getDate() / 7)),
      month: end.toLocaleString("en", { month: "long" }),
      year: String(end.getFullYear()),
    } as const;
  }, [projectName, reportType]);

  const previewSubject = renderDeliveryTemplate(subjectTemplate, previewValues);
  const previewBody = renderDeliveryTemplate(bodyTemplate, previewValues);

  async function save() {
    setSaving(true); setMessage(null);
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}/delivery`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        connectionId,
        to: splitAddresses(toText),
        cc: splitAddresses(ccText),
        bcc: splitAddresses(bccText),
        subjectTemplate,
        bodyTemplate,
        attachReport,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setMessage({ kind: "error", text: payload.error || "Unable to save delivery settings" }); return; }
    setMessage({ kind: "success", text: "Delivery settings saved." });
    router.refresh();
  }

  async function sendTest() {
    setTesting(true); setMessage(null);
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}/delivery/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId,
        to: splitAddresses(toText),
        cc: splitAddresses(ccText),
        bcc: splitAddresses(bccText),
        subject: previewSubject,
        bodyText: previewBody,
        attachReport,
        periodStart: previewValues.period_start,
        periodEnd: previewValues.period_end,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setTesting(false);
    if (!response.ok) { setMessage({ kind: "error", text: payload.error || "Test email failed" }); return; }
    setMessage({ kind: "success", text: `Test email accepted by ${payload.provider === "gmail" ? "Gmail" : "Outlook"}.` });
  }

  if (!connections.length) {
    return (
      <section className="delivery-section">
        <div className="section-head"><div><h2>Delivery</h2><p className="muted">Connect Gmail or Outlook before configuring automatic email delivery.</p></div></div>
        <div className="empty schedule-empty">No sending account connected. <Link className="inline-link" href="/app/connections">Open Connections →</Link></div>
      </section>
    );
  }

  return (
    <section className="delivery-section">
      <div className="section-head"><div><h2>Delivery</h2><p className="muted">Choose who receives this report and which connected mailbox sends it.</p></div></div>
      <div className="form delivery-form">
        <div className="report-summary-card">
          <div><div className="detail-label">Email delivery</div><div className="project-title">{reportType === "weekly" ? "Weekly delivery" : "Monthly delivery"}</div></div>
          <label className="toggle-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{enabled ? "Enabled" : "Disabled"}</span></label>
        </div>

        <div className="field">
          <label htmlFor={`${reportType}-delivery-sender`}>Send from</label>
          <select id={`${reportType}-delivery-sender`} className="select" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.provider === "gmail" ? "Gmail" : "Outlook"} · {connection.displayName}</option>)}
          </select>
          <div className="field-help">This is independent from the account used to sign in to ReportFlow.</div>
        </div>

        <div className="field"><label htmlFor={`${reportType}-delivery-to`}>To</label><input id={`${reportType}-delivery-to`} className="input" value={toText} onChange={(e) => setToText(e.target.value)} placeholder="client@example.com, manager@example.com" /><div className="field-help">Separate multiple addresses with commas.</div></div>
        <div className="delivery-address-grid">
          <div className="field"><label htmlFor={`${reportType}-delivery-cc`}>CC <span className="optional">Optional</span></label><input id={`${reportType}-delivery-cc`} className="input" value={ccText} onChange={(e) => setCcText(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${reportType}-delivery-bcc`}>BCC <span className="optional">Optional</span></label><input id={`${reportType}-delivery-bcc`} className="input" value={bccText} onChange={(e) => setBccText(e.target.value)} /></div>
        </div>

        <div className="field"><label htmlFor={`${reportType}-delivery-subject`}>Subject</label><input id={`${reportType}-delivery-subject`} className="input" value={subjectTemplate} onChange={(e) => setSubjectTemplate(e.target.value)} /><div className="field-help">Variables: {"{project}"}, {"{report_type}"}, {"{period_start}"}, {"{period_end}"}, {"{week}"}, {"{month}"}, {"{year}"}</div></div>
        <div className="field"><label htmlFor={`${reportType}-delivery-body`}>Email body</label><textarea id={`${reportType}-delivery-body`} className="textarea delivery-body" value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} /></div>
        <label className="check-line"><input type="checkbox" checked={attachReport} onChange={(e) => setAttachReport(e.target.checked)} /><span>Attach the generated report file</span></label>

        <div className="card email-preview">
          <div className="detail-label">Preview with sample dates</div>
          <div className="email-preview-subject">{previewSubject || "No subject"}</div>
          <pre>{previewBody || "No email body"}</pre>
        </div>

        <div className="delivery-mode-note"><strong>Test schedule:</strong> generates/validates but automatic delivery is skipped. <strong>Production schedule:</strong> sends only after a successful report generation and validation.</div>
        <div className="form-actions"><button className="button" type="button" disabled={testing || !connectionId || !splitAddresses(toText).length} onClick={sendTest}>{testing ? "Generating and sending…" : "Send test report"}</button><button className="button primary" type="button" disabled={saving || !connectionId || (enabled && !splitAddresses(toText).length)} onClick={save}>{saving ? "Saving…" : "Save delivery"}</button></div>
        {message && <p className={message.kind === "error" ? "error" : "success"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      </div>
    </section>
  );
}
