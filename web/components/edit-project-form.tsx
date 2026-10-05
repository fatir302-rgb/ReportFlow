"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClockifyProject, ClockifyWorkspace } from "@/lib/types";

type InitialProject = {
  id: string; name: string; description: string | null; workspace_id: string; workspace_name: string;
  sourceProjects: Array<{ id: string; name: string }>;
};

export function EditProjectForm({ initial }: { initial: InitialProject }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description || "");
  const [workspaces, setWorkspaces] = useState<ClockifyWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(initial.workspace_id);
  const [projects, setProjects] = useState<ClockifyProject[]>([]);
  const [selected, setSelected] = useState(initial.sourceProjects.map((p) => p.id));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/clockify/workspaces").then(async (r) => { const p = await r.json(); if (!r.ok) throw new Error(p.error); return p.workspaces || []; }),
      fetch(`/api/clockify/projects?workspaceId=${encodeURIComponent(initial.workspace_id)}`).then(async (r) => { const p = await r.json(); if (!r.ok) throw new Error(p.error); return p.projects || []; }),
    ]).then(([ws, ps]) => { setWorkspaces(ws); setProjects(ps); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [initial.workspace_id]);

  async function changeWorkspace(id: string) {
    setWorkspaceId(id); setSelected([]); setProjects([]); setLoading(true); setError("");
    try { const r = await fetch(`/api/clockify/projects?workspaceId=${encodeURIComponent(id)}`); const p = await r.json(); if (!r.ok) throw new Error(p.error); setProjects(p.projects || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load projects"); }
    finally { setLoading(false); }
  }
  const visible = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [projects, search]);
  function toggle(id: string) { setSelected((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); const workspace = workspaces.find((w) => w.id === workspaceId) || { id: initial.workspace_id, name: initial.workspace_name };
    setLoading(true); setError("");
    const response = await fetch(`/api/projects/${initial.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, workspace, sourceProjects: projects.filter((p) => selected.includes(p.id)).map(({ id, name }) => ({ id, name })) }) });
    const payload = await response.json();
    if (!response.ok) { setLoading(false); return setError(payload.error || "Unable to save project"); }
    router.push(`/app/projects/${initial.id}`); router.refresh();
  }
  return <form className="form" onSubmit={save}>
    <div className="field"><label htmlFor="edit-project-name">Project name</label><input id="edit-project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
    <div className="field"><label htmlFor="edit-project-description">Description <span className="muted">Optional</span></label><textarea id="edit-project-description" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
    <div className="field"><label htmlFor="edit-project-workspace">Clockify workspace</label><select id="edit-project-workspace" className="select" value={workspaceId} onChange={(e) => changeWorkspace(e.target.value)}>{workspaces.length ? workspaces.map((w) => <option value={w.id} key={w.id}>{w.name}</option>) : <option value={initial.workspace_id}>{initial.workspace_name}</option>}</select></div>
    <div className="field"><label htmlFor="edit-project-source-search">Included Clockify projects</label><input id="edit-project-source-search" className="input search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="checklist">{visible.map((p) => <label className="check-row" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /><span>{p.name}</span></label>)}</div><div className="field-help">You can change this mapping whenever the client gains or loses a Clockify project.</div></div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="form-actions"><button className="button" type="button" onClick={() => router.back()}>Cancel</button><button className="button primary" type="submit" disabled={loading || !name.trim() || !selected.length}>{loading ? "Saving…" : "Save changes"}</button></div>
  </form>;
}
