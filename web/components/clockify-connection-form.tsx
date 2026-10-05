"use client";
import { useState } from "react";

export function ClockifyConnectionForm({ connected, displayName }: { connected: boolean; displayName?: string | null }) {
  const [apiKey, setApiKey] = useState("");
  const [state, setState] = useState<{ loading?: boolean; error?: string; success?: string }>({});
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ loading: true });
    const response = await fetch("/api/connections/clockify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    const payload = await response.json();
    if (!response.ok) return setState({ error: payload.error || "Unable to connect Clockify" });
    setApiKey("");
    setState({ success: `Connected as ${payload.profile?.name || payload.profile?.email || "Clockify user"}. Reloading…` });
    window.setTimeout(() => window.location.reload(), 600);
  }
  return (
    <div className="card">
      <div className="connection-row">
        <div><div className="connection-name">Clockify</div><div className="muted small">Reporting data source</div></div>
        {connected && <span className="status">Connected</span>}
      </div>
      {connected && displayName && <p className="muted">Connected as {displayName}</p>}
      <form className="form" onSubmit={submit} style={{ marginTop: 18 }}>
        <div className="field"><label htmlFor="clockify-api-key">{connected ? "Replace API key" : "Clockify API key"}</label><input id="clockify-api-key" className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your API key" autoComplete="off" /><div className="field-help">The key is validated server-side and stored encrypted. It is never returned to the browser.</div></div>
        <div><button className="button" disabled={!apiKey || state.loading} type="submit">{state.loading ? "Connecting…" : connected ? "Update connection" : "Connect Clockify"}</button></div>
      </form>
      {state.error && <div className="error" role="alert">{state.error}</div>}
      {state.success && <div className="success" aria-live="polite">{state.success}</div>}
    </div>
  );
}
