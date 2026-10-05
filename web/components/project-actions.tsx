"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function ProjectActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!window.confirm("Delete this project? Its source mapping, report configurations, schedules, delivery settings, and uploaded templates will also be removed. This cannot be undone.")) return;
    setDeleting(true);
    const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (!response.ok) { setDeleting(false); return window.alert("Unable to delete project."); }
    router.push("/app/projects"); router.refresh();
  }
  return <div style={{ display: "flex", gap: 8 }}><Link className="button" href={`/app/projects/${projectId}/edit`}>Edit</Link><button className="button" onClick={remove} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button></div>;
}
