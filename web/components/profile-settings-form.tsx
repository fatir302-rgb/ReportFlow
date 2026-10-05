"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProfileSettingsForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage("");
    const response = await fetch("/api/settings/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setMessage(payload.error || "Unable to save your name.");
    setMessage("Name saved.");
    router.refresh();
  }

  return <form className="card form" onSubmit={save}>
    <div><div className="connection-name">Profile</div><p className="muted">This name appears in ReportFlow and generated report previews.</p></div>
    <div className="field"><label htmlFor="display-name">Display name</label><input id="display-name" className="input" value={displayName} maxLength={100} onChange={(event) => setDisplayName(event.target.value)} required /></div>
    <div className="field"><label htmlFor="profile-email">Email</label><input id="profile-email" className="input" value={email} disabled /><div className="field-help">Your login email comes from your sign-in provider.</div></div>
    <div className="form-actions"><button className="button primary" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save name"}</button></div>
    {message && <p className={message === "Name saved." ? "success" : "error"} aria-live="polite">{message}</p>}
  </form>;
}
