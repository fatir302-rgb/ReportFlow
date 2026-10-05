"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProjectStatusControl({ projectId, active }: { projectId: string; active: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    setSaving(false);
    if (!response.ok) return window.alert(`Unable to ${active ? "stop" : "activate"} project.`);
    router.refresh();
  }

  return (
    <div className="project-status-control">
      <span className={`project-state ${active ? "active" : "stopped"}`}>{active ? "Active" : "Stopped"}</span>
      <button className="button" type="button" onClick={toggle} disabled={saving}>
        {saving ? "Saving…" : active ? "Stop" : "Activate"}
      </button>
    </div>
  );
}
