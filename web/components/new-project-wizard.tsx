"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClockifyProject, ClockifyWorkspace } from "@/lib/types";

export function NewProjectWizard({ clockifyConnected }: { clockifyConnected: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspaces, setWorkspaces] = useState<ClockifyWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projects, setProjects] = useState<ClockifyProject[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clockifyConnected || step < 2 || workspaces.length) return;
    setLoading(true);
    fetch("/api/clockify/workspaces").then(async (r) => {
      const p = await r.json(); if (!r.ok) throw new Error(p.error); return p;
    }).then((p) => setWorkspaces(p.workspaces || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [clockifyConnected, step, workspaces.length]);

  useEffect(() => {
    if (!workspaceId) { setProjects([]); setSelected([]); return; }
    setLoading(true); setError("");
    fetch(`/api/clockify/projects?workspaceId=${encodeURIComponent(workspaceId)}`).then(async (r) => {
      const p = await r.json(); if (!r.ok) throw new Error(p.error); return p;
    }).then((p) => { setProjects(p.projects || []); setSelected([]); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [workspaceId]);

  const visible = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [projects, search]);
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]); }

  async function save() {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return;
    const sourceProjects = projects.filter((p) => selected.includes(p.id)).map(({ id, name }) => ({ id, name }));
    setLoading(true); setError("");
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, workspace, sourceProjects }) });
    const payload = await response.json();
    if (!response.ok) { setLoading(false); return setError(payload.error || "Unable to create project"); }
    router.push(`/app/projects/${payload.id}`); router.refresh();
  }

  return (
    <div>
      <div className="steps">
        <div className={`step ${step === 1 ? "active" : ""}`}><span className="step-index">1</span>Project</div><span className="step-line" />
        <div className={`step ${step === 2 ? "active" : ""}`}><span className="step-index">2</span>Data source</div><span className="step-line" />
        <div className={`step ${step === 3 ? "active" : ""}`}><span className="step-index">3</span>Review</div>
      </div>

      {step === 1 && <div className="form">
        <div className="field"><label htmlFor="new-project-name">Project name</label><input id="new-project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ATM Link" autoFocus /></div>
        <div className="field"><label htmlFor="new-project-description">Description <span className="muted">Optional</span></label><textarea id="new-project-description" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything useful about this client or project" /></div>
        <div className="form-actions"><button className="button primary" disabled={!name.trim()} onClick={() => setStep(2)}>Continue →</button></div>
      </div>}

      {step === 2 && <div className="form">
        {!clockifyConnected ? <div className="empty">Clockify is not connected yet.<div style={{ marginTop: 14 }}><a className="button" href="/app/connections">Connect Clockify</a></div></div> : <>
          <div className="field"><label htmlFor="new-project-workspace">Clockify workspace</label><select id="new-project-workspace" className="select" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}><option value="">Select workspace…</option>{workspaces.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}</select></div>
          {workspaceId && <div className="field"><label htmlFor="new-project-source-search">Which Clockify projects belong to {name}?</label><input id="new-project-source-search" className="input search" placeholder="Search Clockify projects" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="checklist">{visible.map((project) => <label className="check-row" key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={() => toggle(project.id)} /><span>{project.name}</span></label>)}{!visible.length && <div className="check-row muted">No matching projects</div>}</div>
            <div className="field-help">Select one or many. This is the data mapping for this app project; you can change it later.</div>
          </div>}
          <div className="form-actions"><button className="button" onClick={() => setStep(1)}>← Back</button><button className="button primary" disabled={!workspaceId || !selected.length || loading} onClick={() => setStep(3)}>Continue →</button></div>
        </>}
      </div>}

      {step === 3 && <div className="form">
        <div className="card"><div className="detail-label">Project</div><div className="project-title">{name}</div>{description && <div className="muted">{description}</div>}</div>
        <div className="card"><div className="detail-label">Clockify workspace</div><div>{workspaces.find((w) => w.id === workspaceId)?.name}</div><div className="detail-label" style={{ marginTop: 16 }}>Included Clockify projects</div><ul className="source-list">{projects.filter((p) => selected.includes(p.id)).map((p) => <li key={p.id}>{p.name}</li>)}</ul></div>
        <div className="form-actions"><button className="button" onClick={() => setStep(2)}>← Back</button><button className="button primary" disabled={loading} onClick={save}>{loading ? "Creating…" : "Create project"}</button></div>
      </div>}
      {loading && step !== 3 && <p className="muted">Loading…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
