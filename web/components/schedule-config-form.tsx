"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportSchedule, ReportType } from "@/lib/types";
import { nextOccurrences, shiftEndDayOffset } from "@/lib/scheduling";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COMMON_TIMEZONES = [
  "Asia/Karachi",
  "UTC",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

function localRunLabel(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ScheduleConfigForm({
  projectId,
  reportType,
  existing,
  reportConfigured,
}: {
  projectId: string;
  reportType: ReportType;
  existing: ReportSchedule | null;
  reportConfigured: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [runMode, setRunMode] = useState<"test" | "production">(existing?.runMode ?? "test");
  const [timezone, setTimezone] = useState(existing?.timezone ?? "UTC");
  const [weeklyStartDay, setWeeklyStartDay] = useState(existing?.weeklyStartDay ?? 1);
  const [weeklyEndDay, setWeeklyEndDay] = useState(existing?.weeklyEndDay ?? 5);
  const [shiftStartTime, setShiftStartTime] = useState(existing?.shiftStartTime ?? "20:00");
  const [shiftEndTime, setShiftEndTime] = useState(existing?.shiftEndTime ?? "05:00");
  const [runDelayMinutes, setRunDelayMinutes] = useState(existing?.runDelayMinutes ?? 5);
  const maxAttempts = existing?.maxAttempts ?? 4;
  const retryDelayMinutes = existing?.retryDelayMinutes ?? 15;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!existing?.timezone) {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    }
  }, [existing?.timezone]);

  const overnight = useMemo(() => {
    try { return shiftEndDayOffset(shiftStartTime, shiftEndTime) === 1; } catch { return false; }
  }, [shiftStartTime, shiftEndTime]);

  const preview = useMemo(() => {
    if (!enabled || !timezone || !/^\d{2}:\d{2}$/.test(shiftStartTime) || !/^\d{2}:\d{2}$/.test(shiftEndTime)) return [];
    try {
      return nextOccurrences({ reportType, timezone, weeklyStartDay, weeklyEndDay, shiftStartTime, shiftEndTime, runDelayMinutes }, 3)
        .map((item) => ({ ...item, runAtIso: item.runAt.toISOString() }));
    } catch { return []; }
  }, [enabled, timezone, weeklyStartDay, weeklyEndDay, shiftStartTime, shiftEndTime, runDelayMinutes, reportType]);

  async function save() {
    setSaving(true); setError(""); setSuccess("");
    const response = await fetch(`/api/projects/${projectId}/reports/${reportType}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, runMode, timezone, weeklyStartDay, weeklyEndDay, shiftStartTime, shiftEndTime, runDelayMinutes, maxAttempts, retryDelayMinutes }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaving(false);
      setError(payload.error || "Unable to save schedule");
      return;
    }
    setSaving(false);
    setSuccess("Schedule saved.");
    router.refresh();
  }

  if (!reportConfigured) {
    return <section className="schedule-section"><div className="section-head"><div><h2>Schedule</h2><p className="muted">Save the report template and format above before scheduling it.</p></div></div><div className="empty schedule-empty">Report configuration required first.</div></section>;
  }

  return (
    <section className="schedule-section">
      <div className="section-head"><div><h2>Schedule</h2><p className="muted">Queue a run after the business shift ends, including overnight shifts.</p></div></div>
      <div className="form schedule-form">
        <div className="report-summary-card">
          <div><div className="detail-label">Automation</div><div className="project-title">{reportType === "weekly" ? "Weekly schedule" : "Month-end schedule"}</div></div>
          <label className="toggle-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{enabled ? "Scheduled" : "Paused"}</span></label>
        </div>

        <fieldset className="field fieldset">
          <legend>Run mode</legend>
          <div className="choice-grid">
            <label className={`choice-card ${runMode === "test" ? "selected" : ""}`}><input type="radio" name={`runMode-${reportType}`} checked={runMode === "test"} onChange={() => setRunMode("test")} /><span><strong>Test</strong><small>Generate and validate, but skip automatic email delivery.</small></span></label>
            <label className={`choice-card ${runMode === "production" ? "selected" : ""}`}><input type="radio" name={`runMode-${reportType}`} checked={runMode === "production"} onChange={() => setRunMode("production")} /><span><strong>Production</strong><small>Eligible for automatic Gmail/Outlook delivery after successful generation and validation.</small></span></label>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={`${reportType}-schedule-timezone`}>Timezone</label>
          <input id={`${reportType}-schedule-timezone`} className="input" list={`timezone-options-${reportType}`} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Karachi" />
          <datalist id={`timezone-options-${reportType}`}>{COMMON_TIMEZONES.map((item) => <option value={item} key={item} />)}</datalist>
          <div className="field-help">Use an IANA timezone. Scheduling stays tied to this timezone even when the server runs elsewhere.</div>
        </div>

        {reportType === "weekly" && <div className="schedule-week-grid">
          <div className="field"><label htmlFor="weekly-schedule-start-day">Working week starts on</label><select id="weekly-schedule-start-day" className="select" value={weeklyStartDay} onChange={(e) => setWeeklyStartDay(Number(e.target.value))}>{WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></div>
          <div className="field"><label htmlFor="weekly-schedule-end-day">Working week ends on</label><select id="weekly-schedule-end-day" className="select" value={weeklyEndDay} onChange={(e) => setWeeklyEndDay(Number(e.target.value))}>{WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></div>
          <div className="field-help">The report covers this working-week range. An overnight final shift remains attached to its starting business day.</div>
        </div>}

        <div className="schedule-time-grid">
          <div className="field"><label htmlFor={`${reportType}-schedule-shift-start`}>Shift starts</label><input id={`${reportType}-schedule-shift-start`} className="input" type="time" value={shiftStartTime} onChange={(e) => setShiftStartTime(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${reportType}-schedule-shift-end`}>Shift ends</label><input id={`${reportType}-schedule-shift-end`} className="input" type="time" value={shiftEndTime} onChange={(e) => setShiftEndTime(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${reportType}-schedule-delay`}>Run after shift</label><div className="number-suffix"><input id={`${reportType}-schedule-delay`} className="input" type="number" min={0} max={1440} value={runDelayMinutes} onChange={(e) => setRunDelayMinutes(Number(e.target.value))} /><span>min</span></div></div>
        </div>
        <div className="field-help shift-note">{overnight ? "Overnight shift detected: the end time is treated as the following calendar day but remains attached to the original business date." : "This shift starts and ends on the same calendar date."}</div>

        {reportType === "monthly" && <div className="card report-period-note"><div className="detail-label">Month-end rule</div><div className="connection-name">Final calendar-day business shift</div><div className="muted">For example, an August 31 night shift that ends September 1 still belongs to the August report.</div></div>}

        <div className="card report-period-note"><div className="detail-label">Deployment requirement</div><div className="connection-name">The scheduler and report worker must both be running.</div><div className="muted">The scheduler queues due runs; the worker generates, validates, and—only in Production mode—delivers them. Saving this form alone does not start those background services.</div></div>

        {enabled && <div className="card next-runs"><div className="detail-label">Next runs</div>{preview.length ? <div className="next-run-list">{preview.map((item) => <div className="next-run" key={item.runAtIso}><div><strong>{localRunLabel(item.runAtIso, timezone)}</strong><small>{item.periodStart} → {item.periodEnd}</small></div></div>)}</div> : <div className="muted">Enter a valid timezone and shift times to preview the schedule.</div>}</div>}

        <div className="form-actions"><button className="button primary" type="button" disabled={saving || !timezone || (reportType === "weekly" && weeklyStartDay === weeklyEndDay)} onClick={save}>{saving ? "Saving…" : "Save schedule"}</button></div>
        {error && <p className="error" role="alert">{error}</p>}
        {success && <p className="success" aria-live="polite">{success}</p>}
      </div>
    </section>
  );
}
