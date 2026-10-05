"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssistantChat({ conversationId, projectId, configured }: { conversationId?: string | null; projectId?: string | null; configured: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: conversationId || null, projectId: projectId || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Assistant request failed");
      setMessage("");
      if (!conversationId) router.push(`/app/assistant?conversation=${encodeURIComponent(result.conversationId)}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="assistant-composer" onSubmit={submit}>
      {!configured ? <div className="connection-notice error" role="status">Connect an OpenAI API key above to activate the Assistant.</div> : null}
      <textarea
        className="assistant-input"
        aria-label="Message ReportFlow Assistant"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder='Ask ReportFlow… e.g. “Change the weekly report to XLSX”'
        rows={3}
        disabled={!configured}
      />
      <div className="assistant-compose-foot">
        <span className="muted">AI creates drafts only. Nothing is applied automatically.</span>
        <button className="button primary" type="submit" disabled={!configured || busy || !message.trim()}>{busy ? "Thinking…" : "Send"}</button>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
    </form>
  );
}
