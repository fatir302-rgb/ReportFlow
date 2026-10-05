"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EmailConnectionActions({ provider, connected, displayName, configured = true }: { provider: "gmail" | "outlook"; connected: boolean; displayName?: string | null; configured?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = provider === "gmail" ? "Google Gmail" : "Microsoft Outlook";

  async function disconnect() {
    setBusy(true);
    const response = await fetch("/api/connections/email/disconnect", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      window.alert(payload.error || "Unable to disconnect");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card">
      <div className="connection-row">
        <div>
          <div className="connection-name">{label}</div>
          {connected
            ? <><div className="status">Connected</div><div className="muted small connection-email">{displayName}</div></>
            : <div className="muted small">{configured ? "Send report emails from this account." : "OAuth setup required in web/.env.local."}</div>}
        </div>
        {connected
          ? <div className="connection-actions"><a className="button" href={`/api/connections/${provider}/start`}>Reconnect</a><button className="button" type="button" disabled={busy} onClick={disconnect}>{busy ? "Disconnecting…" : "Disconnect"}</button></div>
          : configured
            ? <a className="button" href={`/api/connections/${provider}/start`}>Connect</a>
            : <button className="button" type="button" disabled title="Add the Microsoft Entra client ID and secret to web/.env.local">Not configured</button>}
      </div>
    </div>
  );
}
