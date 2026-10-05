"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssistantConnection({ source, maskedKey }: { source: "personal" | "server" | "none"; maskedKey?: string | null }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const value = apiKey.trim();
    if (!value || busy) return;
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/assistant/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to connect OpenAI");
      setApiKey("");
      setMessage({ kind: "success", text: "OpenAI connected. The Assistant is ready." });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to connect OpenAI" });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy || !window.confirm("Remove your saved OpenAI API key from ReportFlow?")) return;
    setBusy("remove");
    setMessage(null);
    try {
      const response = await fetch("/api/assistant/connection", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to remove OpenAI connection");
      setMessage({ kind: "success", text: payload.configured ? "Personal key removed. The managed server key will now be used." : "OpenAI key removed." });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to remove OpenAI connection" });
    } finally {
      setBusy(null);
    }
  }

  const connected = source !== "none";
  return (
    <section className={`assistant-connection${connected ? " connected" : ""}`} aria-labelledby="assistant-connection-title">
      <div className="assistant-connection-copy">
        <div className="assistant-connection-heading">
          <h2 id="assistant-connection-title">OpenAI connection</h2>
          <span className={`setup-state ${connected ? "ready" : "next"}`}>{connected ? "Connected" : "Required"}</span>
        </div>
        <p className="muted">
          {source === "personal"
            ? `Using your encrypted key${maskedKey ? ` ending in ${maskedKey}` : ""}.`
            : source === "server"
              ? "Using an API key managed by your ReportFlow administrator."
              : "Add your own API key to activate the Assistant. It stays encrypted and is never shown again."}
        </p>
      </div>
      <form className="assistant-key-form" onSubmit={save}>
        <label className="sr-only" htmlFor="assistant-api-key">OpenAI API key</label>
        <input id="assistant-api-key" className="input" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={source === "personal" ? "Paste a new key to replace it" : "Paste your OpenAI API key"} />
        <button className="button primary" type="submit" disabled={Boolean(busy) || !apiKey.trim()}>{busy === "save" ? "Checking…" : source === "personal" ? "Replace key" : "Connect"}</button>
        {source === "personal" ? <button className="button" type="button" disabled={Boolean(busy)} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove"}</button> : null}
      </form>
      <div className="assistant-key-help">Create a key in <a className="inline-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API keys ↗</a>. OpenAI usage is billed to that account.</div>
      {message ? <div className={message.kind} role={message.kind === "error" ? "alert" : undefined} aria-live="polite">{message.text}</div> : null}
    </section>
  );
}
