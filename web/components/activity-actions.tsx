"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ActivityActions({
  runId,
  canRetry,
  retryLabel,
  canResend,
  deliveryFailed,
  canDownload,
  canCorrect = false,
  canApprove = false,
  approvalRecipients = [],
  canDelete = false,
}: {
  runId: string;
  canRetry: boolean;
  retryLabel: string;
  canResend: boolean;
  deliveryFailed: boolean;
  canDownload: boolean;
  canCorrect?: boolean;
  canApprove?: boolean;
  approvalRecipients?: string[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "resend" | "correct" | "approve" | "delete" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function action(kind: "retry" | "resend" | "correct" | "approve" | "delete") {
    if (kind === "resend") {
      const confirmed = window.confirm(
        deliveryFailed
          ? "Push this generated report now using the saved sender and recipients?"
          : "Resend this report using the saved sender and recipients?",
      );
      if (!confirmed) return;
    }
    if (kind === "correct") {
      if (!window.confirm("Generate a fresh report for the same period for review? No email will be sent. The original activity and email will remain unchanged.")) return;
    }
    if (kind === "approve") {
      const recipients = approvalRecipients.join(", ");
      if (!window.confirm(`Send the report file you reviewed to:\n\n${recipients}\n\nThis will send a real email with the saved attachment.`)) return;
    }
    if (kind === "delete" && !window.confirm("Permanently delete this Activity entry, its delivery history, and its generated report file? This cannot be undone.")) return;

    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(`/api/activity/${encodeURIComponent(runId)}/${kind}`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Unable to ${kind} report`);
      if (kind === "delete") {
        router.push("/app/activity");
        router.refresh();
        return;
      }
      if (kind === "correct") {
        setMessage({ kind: "success", text: "Corrected report generated for review. No email was sent." });
        if (payload.runId) router.push(`/app/activity/${payload.runId}`);
        router.refresh();
        return;
      }
      if (kind === "approve") {
        setMessage({ kind: "success", text: "Approved report sent." });
        router.refresh();
        return;
      }
      const retryMessage = payload.deliveryStatus === "sent"
        ? "Report generated and sent."
        : payload.deliveryStatus === "failed"
          ? `Report generated, but email delivery failed.${payload.deliveryError ? ` ${payload.deliveryError}` : ""}`
            : payload.deliveryStatus === "skipped_test"
            ? "Report generated; test mode did not send email."
            : "Report generated for review. No email was sent.";
      setMessage({ kind: payload.deliveryStatus === "failed" ? "error" : "success", text: kind === "retry" ? retryMessage : deliveryFailed ? "Report pushed successfully." : "Report resent." });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : `Unable to ${kind} report` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="activity-action-wrap">
      <div className="activity-actions">
        {canDownload ? <a className="button" href={`/api/activity/${encodeURIComponent(runId)}/download`}>Download</a> : null}
        {canRetry ? <button className="button" disabled={Boolean(busy)} onClick={() => action("retry")}>{busy === "retry" ? "Running…" : retryLabel}</button> : null}
        {canResend ? <button className={`button${deliveryFailed ? " primary" : ""}`} disabled={Boolean(busy)} onClick={() => action("resend")}>{busy === "resend" ? "Sending…" : deliveryFailed ? "Push report now" : "Resend"}</button> : null}
        {canCorrect ? <button className="button" disabled={Boolean(busy)} onClick={() => action("correct")}>{busy === "correct" ? "Generating…" : "Generate corrected copy"}</button> : null}
        {canApprove ? <button className="button primary" disabled={Boolean(busy)} onClick={() => action("approve")}>{busy === "approve" ? "Sending…" : "Approve & send"}</button> : null}
        {canDelete ? <button className="button danger-button" disabled={Boolean(busy)} onClick={() => action("delete")}>{busy === "delete" ? "Deleting…" : "Delete activity"}</button> : null}
      </div>
      {message ? <div className={message.kind} role={message.kind === "error" ? "alert" : undefined} aria-live="polite">{message.text}</div> : null}
    </div>
  );
}
